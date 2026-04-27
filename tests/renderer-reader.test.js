const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadReaderUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/reader/readerUtils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

async function loadReaderModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/reader/readerController.js');
    const moduleCache = new Map();

    async function buildModuleDataUrl(filePath) {
        const normalizedPath = path.resolve(filePath);
        if (moduleCache.has(normalizedPath)) {
            return moduleCache.get(normalizedPath);
        }

        let source = await fs.readFile(normalizedPath, 'utf8');
        const importMatches = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)];
        for (const match of importMatches) {
            const specifier = match[1];
            const dependencyPath = path.resolve(path.dirname(normalizedPath), specifier);
            const dependencyUrl = await buildModuleDataUrl(dependencyPath);
            source = source.replace(`from '${specifier}'`, `from '${dependencyUrl}'`);
            source = source.replace(`from "${specifier}"`, `from "${dependencyUrl}"`);
        }

        const dataUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
        moduleCache.set(normalizedPath, dataUrl);
        return dataUrl;
    }

    return import(await buildModuleDataUrl(modulePath));
}

test('getReaderLocatorLabel keeps the current page > paragraph > section fallback order', async () => {
    const { getReaderLocatorLabel } = await loadReaderUtilsModule();

    assert.equal(getReaderLocatorLabel({ pageNumber: 7, paragraphIndex: 3, sectionTitle: '导数' }), '第 7 页');
    assert.equal(getReaderLocatorLabel({ paragraphIndex: 12, sectionTitle: '导数' }), '第 12 段');
    assert.equal(getReaderLocatorLabel({ sectionTitle: '导数' }), '导数');
    assert.equal(getReaderLocatorLabel({}), '未定位');
});

test('resolveReaderInitialLocation falls back to the first available locator and switches tabs only when needed', async () => {
    const { resolveReaderInitialLocation } = await loadReaderUtilsModule();

    assert.deepEqual(
        resolveReaderInitialLocation({
            view: {
                type: 'pdf',
                pages: [
                    { pageNumber: 3, paragraphs: [{ index: 11 }] },
                ],
            },
        }),
        {
            activePageNumber: 3,
            activeParagraphIndex: 11,
            activeSectionTitle: null,
            preferredTab: 'guide',
        }
    );

    assert.deepEqual(
        resolveReaderInitialLocation({
            locator: { paragraphIndex: 6, sectionTitle: '极限定义' },
            view: {
                type: 'docx',
                paragraphs: [{ index: 1, sectionTitle: '引言' }],
            },
        }),
        {
            activePageNumber: null,
            activeParagraphIndex: 6,
            activeSectionTitle: '极限定义',
            preferredTab: 'content',
        }
    );
});

test('shouldRefreshReaderGuide only regenerates when guide data is missing or explicitly forced', async () => {
    const { shouldRefreshReaderGuide } = await loadReaderUtilsModule();

    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'done', guideMarkdown: '## ready' }), false);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'idle', guideMarkdown: '' }), true);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'processing', guideMarkdown: '' }), false);
    assert.equal(shouldRefreshReaderGuide({ success: false }, {}), true);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'done', guideMarkdown: 'cached' }, { forceRefresh: true }), true);
});

test('buildReaderSelectionPayload normalizes selection text and preserves location metadata', async () => {
    const { buildReaderSelectionPayload } = await loadReaderUtilsModule();

    assert.deepEqual(
        buildReaderSelectionPayload(
            {
                documentId: 'doc-1',
                documentName: 'lecture.pdf',
                contentType: 'pdf-text',
            },
            {
                selectionText: '  one\n\n two   three  ',
                pageNumber: '4',
                paragraphIndex: '9',
                sectionTitle: '二阶导数',
            }
        ),
        {
            documentId: 'doc-1',
            documentName: 'lecture.pdf',
            contentType: 'pdf-text',
            selectionText: 'one two three',
            snippet: 'one two three',
            pageNumber: 4,
            paragraphIndex: 9,
            sectionTitle: '二阶导数',
        }
    );

    assert.equal(
        buildReaderSelectionPayload({ documentId: null }, { selectionText: 'hello' }),
        null
    );
});

test('getReaderNavigationTarget clamps pdf navigation and returns the next page locator', async () => {
    const { getReaderNavigationTarget } = await loadReaderUtilsModule();

    const readerState = {
        documentId: 'doc-1',
        activePageNumber: 2,
        activeParagraphIndex: 5,
        activeSectionTitle: '第一页',
        view: {
            type: 'pdf',
            pages: [
                { pageNumber: 1, paragraphs: [{ index: 1 }] },
                { pageNumber: 2, paragraphs: [{ index: 5 }] },
                { pageNumber: 3, paragraphs: [{ index: 8 }] },
            ],
        },
    };

    assert.deepEqual(getReaderNavigationTarget(readerState, 1), {
        pageNumber: 3,
        paragraphIndex: 8,
        sectionTitle: '第一页',
    });
    assert.deepEqual(getReaderNavigationTarget(readerState, -10), {
        pageNumber: 1,
        paragraphIndex: 1,
        sectionTitle: '第一页',
    });
});

test('getReaderNavigationTarget advances paragraph readers by paragraph index and section title', async () => {
    const { getReaderNavigationTarget, isReaderSupportedDocument } = await loadReaderUtilsModule();

    const readerState = {
        documentId: 'doc-2',
        activeParagraphIndex: 2,
        view: {
            type: 'docx',
            paragraphs: [
                { index: 1, sectionTitle: '引言' },
                { index: 2, sectionTitle: '引言' },
                { index: 3, sectionTitle: '证明' },
            ],
        },
    };

    assert.deepEqual(getReaderNavigationTarget(readerState, 1), {
        pageNumber: null,
        paragraphIndex: 3,
        sectionTitle: '证明',
    });
    assert.equal(isReaderSupportedDocument({ contentType: 'markdown' }), true);
    assert.equal(isReaderSupportedDocument({ mimeType: 'application/zip' }), false);
});

function createReaderDom() {
    const dom = new JSDOM(`
        <body>
            <h2 id="readerDocumentTitle"></h2>
            <p id="readerDocumentMeta"></p>
            <div id="readerLocationBadge"></div>
            <div id="readerIndexStatusBadge"></div>
            <div id="readerProcessingStatusBadge"></div>
            <div id="readerGuideStatusBadge"></div>
            <button id="readerPrevBtn"></button>
            <button id="readerNextBtn"></button>
            <button id="injectReaderSelectionBtn"></button>
            <button id="clearReaderSelectionBtn"></button>
            <button id="refreshReaderGuideBtn"></button>
            <button id="workspaceReaderBackBtn"></button>
            <button id="leftReaderGuideTabBtn"></button>
            <button id="leftReaderContentTabBtn"></button>
            <div id="readerSelectionBar"></div>
            <div id="readerSelectionSummary"></div>
            <div id="readerGuideContent"></div>
            <div id="readerContent"></div>
        </body>
    `, { pretendToBeVisual: true });

    const { window } = dom;
    window.requestAnimationFrame = (callback) => {
        callback();
        return 1;
    };

    return {
        window,
        document: window.document,
        el: {
            readerDocumentTitle: window.document.getElementById('readerDocumentTitle'),
            readerDocumentMeta: window.document.getElementById('readerDocumentMeta'),
            readerLocationBadge: window.document.getElementById('readerLocationBadge'),
            readerIndexStatusBadge: window.document.getElementById('readerIndexStatusBadge'),
            readerProcessingStatusBadge: window.document.getElementById('readerProcessingStatusBadge'),
            readerGuideStatusBadge: window.document.getElementById('readerGuideStatusBadge'),
            readerPrevBtn: window.document.getElementById('readerPrevBtn'),
            readerNextBtn: window.document.getElementById('readerNextBtn'),
            injectReaderSelectionBtn: window.document.getElementById('injectReaderSelectionBtn'),
            clearReaderSelectionBtn: window.document.getElementById('clearReaderSelectionBtn'),
            refreshReaderGuideBtn: window.document.getElementById('refreshReaderGuideBtn'),
            workspaceReaderBackBtn: window.document.getElementById('workspaceReaderBackBtn'),
            leftReaderGuideTabBtn: window.document.getElementById('leftReaderGuideTabBtn'),
            leftReaderContentTabBtn: window.document.getElementById('leftReaderContentTabBtn'),
            readerSelectionBar: window.document.getElementById('readerSelectionBar'),
            readerSelectionSummary: window.document.getElementById('readerSelectionSummary'),
            readerGuideContent: window.document.getElementById('readerGuideContent'),
            readerContent: window.document.getElementById('readerContent'),
        },
    };
}

function createStore(readerPatch = {}) {
    const state = {
        layout: {
            leftReaderActiveTab: 'content',
        },
        reader: {
            documentId: 'doc-image',
            documentName: 'chapter.png',
            contentType: 'markdown',
            status: 'done',
            isIndexed: true,
            view: {
                type: 'text',
                contentType: 'markdown',
                imagePreviewUrl: 'file:///C:/fixtures/chapter.png',
                paragraphs: [{ index: 1, sectionTitle: null, text: '# 图片概览\n\n正文' }],
            },
            imagePreviewUrl: 'file:///C:/fixtures/chapter.png',
            activePageNumber: null,
            activeParagraphIndex: 1,
            activeSectionTitle: null,
            pendingSelection: null,
            guideStatus: 'done',
            guideMarkdown: '',
            guideGeneratedAt: null,
            guideError: null,
            ...readerPatch,
        },
    };

    return {
        getState() {
            return state;
        },
        patchState(slice, patch) {
            state[slice] = typeof patch === 'function'
                ? patch(state[slice], state)
                : { ...state[slice], ...patch };
            return state[slice];
        },
    };
}

function createUiStub() {
    return {
        toasts: [],
        showToastNotification(message, type) {
            this.toasts.push({ message, type });
        },
    };
}

test('reader renders image source thumbnail below transcribed markdown', async () => {
    const { createReaderController } = await loadReaderModule();
    const { window, document, el } = createReaderDom();
    const controller = createReaderController({
        store: createStore(),
        el,
        chatAPI: {},
        ui: createUiStub(),
        windowObj: window,
        documentObj: document,
        renderMarkdownToSafeHtml: (value) => `<p>${value}</p>`,
        setLeftReaderTab: () => {},
    });

    controller.renderReaderPanel();

    const previewImage = el.readerContent.querySelector('.reader-image-preview img');
    assert.ok(previewImage);
    assert.equal(previewImage.getAttribute('src'), 'file:///C:/fixtures/chapter.png');
});

test('reader title rename locks the original extension', async () => {
    const { createReaderController } = await loadReaderModule();
    const { window, document, el } = createReaderDom();
    const store = createStore();
    const ui = createUiStub();
    const renameCalls = [];
    const sourcePatches = [];
    const controller = createReaderController({
        store,
        el,
        chatAPI: {
            async renameKnowledgeBaseDocument(documentId, payload) {
                renameCalls.push([documentId, payload]);
                return {
                    success: true,
                    item: { id: documentId, name: payload.name },
                };
            },
        },
        ui,
        windowObj: window,
        documentObj: document,
        renderMarkdownToSafeHtml: (value) => `<p>${value}</p>`,
        setLeftReaderTab: () => {},
        patchDocumentNameInSource(documentId, patch) {
            sourcePatches.push([documentId, patch]);
        },
    });

    controller.renderReaderPanel();
    controller.bindEvents();
    el.readerDocumentTitle.click();

    const input = el.readerDocumentTitle.querySelector('input');
    assert.equal(input.value, 'chapter');
    assert.equal(el.readerDocumentTitle.querySelector('.reader-document-title__extension').textContent, '.png');

    input.value = '新标题';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(renameCalls, [['doc-image', { name: '新标题.png' }]]);
    assert.equal(store.getState().reader.documentName, '新标题.png');
    assert.equal(el.readerDocumentTitle.textContent, '新标题.png');
    assert.equal(sourcePatches.length, 1);
    assert.equal(sourcePatches[0][1].name, '新标题.png');
});

test('reader title rename rejects empty names and escape cancels without saving', async () => {
    const { createReaderController } = await loadReaderModule();
    const { window, document, el } = createReaderDom();
    const ui = createUiStub();
    const renameCalls = [];
    const controller = createReaderController({
        store: createStore(),
        el,
        chatAPI: {
            async renameKnowledgeBaseDocument(documentId, payload) {
                renameCalls.push([documentId, payload]);
                return { success: true, item: { id: documentId, name: payload.name } };
            },
        },
        ui,
        windowObj: window,
        documentObj: document,
        renderMarkdownToSafeHtml: (value) => `<p>${value}</p>`,
        setLeftReaderTab: () => {},
    });

    controller.renderReaderPanel();
    controller.bindEvents();
    el.readerDocumentTitle.click();
    let input = el.readerDocumentTitle.querySelector('input');
    input.value = '';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(renameCalls, []);
    assert.equal(ui.toasts[0].type, 'warning');
    assert.ok(el.readerDocumentTitle.querySelector('input'));

    input = el.readerDocumentTitle.querySelector('input');
    input.value = '不会保存';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(renameCalls, []);
    assert.equal(el.readerDocumentTitle.textContent, 'chapter.png');
});

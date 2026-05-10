const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadShelfModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/shelf/shelfController.js');
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

function createDomElements() {
    const dom = new JSDOM(`
        <body>
            <section id="sourceShelfPage"></section>
            <div id="sourceShelfSubtitle"></div>
            <input id="sourceShelfGroupNameInput" />
            <button id="createSourceShelfGroupBtn"></button>
            <button id="renameSourceShelfGroupBtn"></button>
            <button id="deleteSourceShelfGroupBtn"></button>
            <button id="importSourceShelfFilesBtn"></button>
            <input id="hiddenSourceShelfFileInput" type="file" />
            <div id="sourceShelfGroups"></div>
            <div id="sourceShelfDocuments"></div>
            <div id="sourceShelfPickerModal" class="hidden"></div>
            <div id="sourceShelfPickerBackdrop"></div>
            <button id="sourceShelfPickerCloseBtn"></button>
            <button id="sourceShelfPickerCancelBtn"></button>
            <button id="sourceShelfPickerConfirmBtn"></button>
            <div id="sourceShelfPickerSummary"></div>
            <div id="sourceShelfPickerBody"></div>
        </body>
    `, { pretendToBeVisual: true });
    const { window } = dom;
    window.setInterval = () => 1;
    window.clearInterval = () => {};
    global.Element = window.Element;

    return {
        window,
        document: window.document,
        el: {
            sourceShelfPage: window.document.getElementById('sourceShelfPage'),
            sourceShelfSubtitle: window.document.getElementById('sourceShelfSubtitle'),
            sourceShelfGroupNameInput: window.document.getElementById('sourceShelfGroupNameInput'),
            createSourceShelfGroupBtn: window.document.getElementById('createSourceShelfGroupBtn'),
            renameSourceShelfGroupBtn: window.document.getElementById('renameSourceShelfGroupBtn'),
            deleteSourceShelfGroupBtn: window.document.getElementById('deleteSourceShelfGroupBtn'),
            importSourceShelfFilesBtn: window.document.getElementById('importSourceShelfFilesBtn'),
            hiddenSourceShelfFileInput: window.document.getElementById('hiddenSourceShelfFileInput'),
            sourceShelfGroups: window.document.getElementById('sourceShelfGroups'),
            sourceShelfDocuments: window.document.getElementById('sourceShelfDocuments'),
            sourceShelfPickerModal: window.document.getElementById('sourceShelfPickerModal'),
            sourceShelfPickerBackdrop: window.document.getElementById('sourceShelfPickerBackdrop'),
            sourceShelfPickerCloseBtn: window.document.getElementById('sourceShelfPickerCloseBtn'),
            sourceShelfPickerCancelBtn: window.document.getElementById('sourceShelfPickerCancelBtn'),
            sourceShelfPickerConfirmBtn: window.document.getElementById('sourceShelfPickerConfirmBtn'),
            sourceShelfPickerSummary: window.document.getElementById('sourceShelfPickerSummary'),
            sourceShelfPickerBody: window.document.getElementById('sourceShelfPickerBody'),
        },
    };
}

function createState(overrides = {}) {
    return {
        session: {
            currentSelectedItem: { id: 'agent-1', name: '数学' },
            currentTopicId: 'topic-1',
            topics: [
                {
                    id: 'topic-1',
                    name: '函数',
                    knowledgeBaseId: 'kb-topic',
                    selectedKnowledgeBaseDocumentIds: ['existing-topic-doc'],
                },
            ],
        },
        source: {
            topicKnowledgeBaseDocuments: [
                { id: 'existing-topic-doc', name: '已有资料.txt', fileHash: 'hash-existing' },
            ],
        },
        shelf: {
            groups: [],
            selectedGroupId: null,
            documents: [],
            documentsByGroupId: {},
            pickerOpen: false,
            pickerGroups: [],
            pickerDocumentsByGroupId: {},
            pickerSelectedDocumentIds: [],
            activeShelfDocumentMenu: null,
        },
        ...overrides,
    };
}

function createStore(state) {
    return {
        getState() {
            return state;
        },
        patchState(slice, patch) {
            const currentSlice = state[slice] || {};
            state[slice] = typeof patch === 'function'
                ? patch(currentSlice, state)
                : { ...currentSlice, ...patch };
            return state[slice];
        },
        subscribe() {
            return () => {};
        },
    };
}

function createUiStub() {
    return {
        toasts: [],
        showToastNotification(message, type) {
            this.toasts.push({ message, type });
        },
        async showConfirmDialog() {
            return true;
        },
        async showPromptDialog(options = {}) {
            return options.defaultValue || '新分组';
        },
    };
}

test('shelf controller renders groups and bento document states', async () => {
    const { createShelfController } = await loadShelfModule();
    const dom = createDomElements();
    const state = createState();
    const store = createStore(state);
    const ui = createUiStub();
    const docs = [
        { id: 'doc-done', name: '教材.pdf', status: 'done', chunkCount: 3, fileSize: 2048, updatedAt: 100, mimeType: 'application/pdf', extractedText: '# 第一章\n函数的概念、定义域和值域。' },
        { id: 'doc-pdf-by-name', name: '历史资料.pdf', status: 'done', chunkCount: 2, fileSize: 1024, updatedAt: 150, mimeType: '', thumbnailUrl: 'file:///preview/history.png', thumbnailKind: 'pdf' },
        { id: 'doc-processing', name: '试卷.docx', status: 'processing', chunkCount: 0, fileSize: 1024, updatedAt: 200 },
        { id: 'doc-failed', name: '坏文件.txt', status: 'failed', chunkCount: 0, fileSize: 512, updatedAt: 300, lastError: '解析失败' },
    ];
    const thumbnailCalls = [];
    const deleteCalls = [];
    const chatAPI = {
        async listKnowledgeBases(options) {
            assert.deepEqual(options, { kind: 'shelf' });
            return { success: true, items: [{ id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: 4, doneCount: 2 }] };
        },
        async listKnowledgeBaseDocuments(kbId) {
            assert.equal(kbId, 'shelf-1');
            return { success: true, items: docs };
        },
        async getKnowledgeBaseDocumentThumbnail(documentId) {
            thumbnailCalls.push(documentId);
            return { success: false, thumbnailUrl: '', kind: 'none' };
        },
        async deleteKnowledgeBaseDocument(documentId) {
            deleteCalls.push(documentId);
            return { success: true };
        },
    };

    const controller = createShelfController({
        store,
        el: dom.el,
        chatAPI,
        ui,
        windowObj: dom.window,
        documentObj: dom.document,
    });
    await controller.loadShelfGroups();

    assert.match(dom.el.sourceShelfGroups.textContent, /教材/);
    assert.match(dom.el.sourceShelfGroups.textContent, /全部资料/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /教材\.pdf/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /函数的概念、定义域和值域/);
    assert.equal(dom.el.sourceShelfDocuments.querySelector('.source-shelf-card__preview')?.textContent.includes('#'), false);
    assert.match(dom.el.sourceShelfDocuments.textContent, /试卷\.docx/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /坏文件\.txt/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /解析失败/);
    assert.equal(dom.el.sourceShelfDocuments.querySelectorAll('.source-shelf-section').length, 1);
    assert.equal(dom.el.sourceShelfDocuments.querySelectorAll('.source-shelf-upload-card').length, 1);
    assert.equal(dom.el.sourceShelfDocuments.querySelectorAll('.source-shelf-card--has-thumbnail').length, 1);
    assert.match(dom.el.sourceShelfDocuments.querySelector('.source-shelf-upload-card')?.textContent || '', /上传资料/);
    assert.equal(dom.el.sourceShelfDocuments.classList.contains('source-shelf-grid--shelf-view'), true);
    assert.equal(dom.el.renameSourceShelfGroupBtn.disabled, true);
    assert.equal(dom.el.importSourceShelfFilesBtn.disabled, true);

    dom.el.sourceShelfGroups.querySelectorAll('.source-shelf-group-card')[1].click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(dom.el.renameSourceShelfGroupBtn.disabled, false);
    assert.equal(dom.el.importSourceShelfFilesBtn.disabled, false);
    assert.equal(dom.el.sourceShelfDocuments.querySelectorAll('.source-shelf-upload-card').length, 1);
    assert.equal(thumbnailCalls.includes('doc-pdf-by-name'), true);
    assert.equal(dom.el.sourceShelfDocuments.querySelector('[data-shelf-doc-action]'), null);

    const firstCard = dom.el.sourceShelfDocuments.querySelector('article.source-shelf-card');
    firstCard.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
    }));
    const menu = dom.document.getElementById('sourceShelfDocumentActionMenu');
    assert.ok(menu);
    assert.equal(menu.classList.contains('hidden'), false);
    assert.match(menu.textContent, /重命名/);
    assert.match(menu.textContent, /删除/);

    await controller.loadShelfGroups();
    const restoredMenu = dom.document.getElementById('sourceShelfDocumentActionMenu');
    assert.equal(restoredMenu.classList.contains('hidden'), false);
    assert.match(restoredMenu.textContent, /重命名/);
    assert.match(restoredMenu.textContent, /删除/);

    restoredMenu.querySelector('[data-shelf-document-action="delete"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(deleteCalls, ['doc-done']);
});

test('shelf document context menu can move a document to another group', async () => {
    const { createShelfController } = await loadShelfModule();
    const dom = createDomElements();
    const state = createState();
    const store = createStore(state);
    const moveCalls = [];
    let docsByGroup = {
        'shelf-1': [{ id: 'doc-1', kbId: 'shelf-1', name: '教材.pdf', status: 'done', fileHash: 'hash-1', contentType: 'pdf-text' }],
        'shelf-2': [],
    };
    const controller = createShelfController({
        store,
        el: dom.el,
        chatAPI: {
            async listKnowledgeBases() {
                return {
                    success: true,
                    items: [
                        { id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: docsByGroup['shelf-1'].length, doneCount: docsByGroup['shelf-1'].length },
                        { id: 'shelf-2', name: '未归类', kind: 'shelf', documentCount: docsByGroup['shelf-2'].length, doneCount: docsByGroup['shelf-2'].length },
                    ],
                };
            },
            async listKnowledgeBaseDocuments(kbId) {
                return { success: true, items: docsByGroup[kbId] || [] };
            },
            async moveKnowledgeBaseDocumentToShelfGroup(documentId, targetGroupId) {
                moveCalls.push([documentId, targetGroupId]);
                docsByGroup = {
                    'shelf-1': [],
                    'shelf-2': [{ id: documentId, kbId: targetGroupId, name: '教材.pdf', status: 'done', fileHash: 'hash-1', contentType: 'pdf-text' }],
                };
                return { success: true, item: docsByGroup['shelf-2'][0] };
            },
        },
        ui: createUiStub(),
        windowObj: dom.window,
        documentObj: dom.document,
        loadCurrentTopicKnowledgeBaseDocuments: async () => [],
        loadKnowledgeBases: async () => {},
    });

    await controller.loadShelfGroups();
    assert.doesNotMatch(dom.el.sourceShelfGroups.textContent, /未归类/);
    assert.doesNotMatch(dom.el.sourceShelfDocuments.textContent, /未归类/);
    assert.equal(dom.el.sourceShelfDocuments.querySelector('[data-shelf-group-section="shelf-2"]'), null);

    const card = dom.el.sourceShelfDocuments.querySelector('article.source-shelf-card');
    card.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
    }));

    const menu = dom.document.getElementById('sourceShelfDocumentActionMenu');
    menu.querySelector('[data-shelf-document-action="move"]').click();

    await controller.loadShelfGroups();
    const restoredMoveMenu = dom.document.getElementById('sourceShelfDocumentActionMenu');
    assert.equal(restoredMoveMenu.classList.contains('hidden'), false);
    assert.ok(restoredMoveMenu.querySelector('[data-shelf-document-move-group="shelf-2"]'));

    restoredMoveMenu.querySelector('[data-shelf-document-move-group="shelf-2"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(moveCalls, [['doc-1', 'shelf-2']]);
    assert.equal(state.shelf.selectedGroupId, 'shelf-2');
});

test('shelf document cards open the shelf reader only for readable completed documents', async () => {
    const { createShelfController } = await loadShelfModule();
    const dom = createDomElements();
    const state = createState();
    const store = createStore(state);
    const openCalls = [];
    const docs = [
        { id: 'doc-readable', kbId: 'shelf-1', name: '教材.pdf', status: 'done', contentType: 'pdf-text', fileHash: 'hash-readable' },
        { id: 'doc-processing', kbId: 'shelf-1', name: '处理中.pdf', status: 'processing', contentType: 'pdf-text', fileHash: 'hash-processing' },
        { id: 'doc-unreadable', kbId: 'shelf-1', name: '素材.zip', status: 'done', mimeType: 'application/zip', fileHash: 'hash-zip' },
    ];
    const controller = createShelfController({
        store,
        el: dom.el,
        chatAPI: {
            async listKnowledgeBases() {
                return { success: true, items: [{ id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: docs.length, doneCount: 2 }] };
            },
            async listKnowledgeBaseDocuments() {
                return { success: true, items: docs };
            },
        },
        ui: createUiStub(),
        windowObj: dom.window,
        documentObj: dom.document,
        openShelfReaderDocument: async (documentId) => {
            openCalls.push(documentId);
        },
        isShelfReaderDocumentActive: (documentId) => documentId === 'doc-readable',
    });

    await controller.loadShelfGroups();

    const cards = [...dom.el.sourceShelfDocuments.querySelectorAll('article.source-shelf-card')];
    assert.equal(cards.length, 3);
    assert.equal(cards[0].classList.contains('source-shelf-card--clickable'), true);
    assert.equal(cards[0].classList.contains('source-shelf-card--active'), true);
    assert.equal(cards[1].classList.contains('source-shelf-card--clickable'), false);
    assert.equal(cards[2].classList.contains('source-shelf-card--clickable'), false);

    cards[0].click();
    cards[1].click();
    cards[2].click();
    assert.deepEqual(openCalls, ['doc-readable']);

    cards[0].dispatchEvent(new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
    }));
    assert.deepEqual(openCalls, ['doc-readable']);
});

test('shelf picker copies reusable documents into the current topic source', async () => {
    const { createShelfController } = await loadShelfModule();
    const dom = createDomElements();
    const state = createState();
    const store = createStore(state);
    const ui = createUiStub();
    const calls = [];
    const pickerDocs = [
        { id: 'doc-new', name: '新资料.md', status: 'done', fileHash: 'hash-new', chunkCount: 2 },
        { id: 'doc-existing', name: '已有资料.txt', status: 'done', fileHash: 'hash-existing', chunkCount: 1 },
        { id: 'doc-pending', name: '处理中.txt', status: 'processing', fileHash: 'hash-pending', chunkCount: 0 },
    ];
    const chatAPI = {
        async listKnowledgeBases(options) {
            calls.push(['listKnowledgeBases', options]);
            return { success: true, items: [{ id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: 3, doneCount: 2 }] };
        },
        async listKnowledgeBaseDocuments(kbId) {
            calls.push(['listKnowledgeBaseDocuments', kbId]);
            return { success: true, items: pickerDocs };
        },
        async copyKnowledgeBaseDocuments(targetKbId, documentIds) {
            calls.push(['copyKnowledgeBaseDocuments', targetKbId, documentIds]);
            return { success: true, items: [{ id: 'copied-doc', kbId: targetKbId }] };
        },
        async setTopicSourceSelection(agentId, topicId, documentIds) {
            calls.push(['setTopicSourceSelection', agentId, topicId, documentIds]);
            return { success: true, selectedKnowledgeBaseDocumentIds: documentIds };
        },
    };
    let loadedCurrentTopic = false;
    let loadedKnowledgeBases = false;
    const controller = createShelfController({
        store,
        el: dom.el,
        chatAPI,
        ui,
        windowObj: dom.window,
        documentObj: dom.document,
        ensureTopicSource: async () => 'kb-topic',
        loadCurrentTopicKnowledgeBaseDocuments: async () => {
            loadedCurrentTopic = true;
        },
        loadKnowledgeBases: async () => {
            loadedKnowledgeBases = true;
        },
        updateTopicSourceSelection(nextSelection) {
            state.session.topics[0].selectedKnowledgeBaseDocumentIds = nextSelection;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentTopic: () => state.session.topics[0],
    });

    await controller.openShelfPicker();
    controller.togglePickerDocument('doc-new');
    controller.togglePickerDocument('doc-existing');
    controller.togglePickerDocument('doc-pending');
    await controller.confirmPickerSelection();

    assert.deepEqual(
        calls.filter((call) => call[0] === 'copyKnowledgeBaseDocuments'),
        [['copyKnowledgeBaseDocuments', 'kb-topic', ['doc-new']]],
    );
    assert.deepEqual(
        calls.find((call) => call[0] === 'setTopicSourceSelection'),
        ['setTopicSourceSelection', 'agent-1', 'topic-1', ['existing-topic-doc', 'copied-doc']],
    );
    assert.equal(loadedCurrentTopic, true);
    assert.equal(loadedKnowledgeBases, true);
    assert.equal(dom.el.sourceShelfPickerModal.classList.contains('hidden'), true);
});

test('shelf picker disables new selections when the topic source is full', async () => {
    const { createShelfController } = await loadShelfModule();
    const dom = createDomElements();
    const state = createState({
        source: {
            topicKnowledgeBaseDocuments: Array.from({ length: 50 }, (_, index) => ({
                id: `topic-doc-${index}`,
                name: `资料 ${index}.txt`,
                fileHash: `hash-topic-${index}`,
            })),
        },
    });
    const store = createStore(state);
    const ui = createUiStub();
    const calls = [];
    const chatAPI = {
        async listKnowledgeBases() {
            return { success: true, items: [{ id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: 1, doneCount: 1 }] };
        },
        async listKnowledgeBaseDocuments() {
            return { success: true, items: [{ id: 'doc-new', name: '新资料.md', status: 'done', fileHash: 'hash-new', chunkCount: 2 }] };
        },
        async copyKnowledgeBaseDocuments(...args) {
            calls.push(args);
            return { success: true, items: [] };
        },
    };
    const controller = createShelfController({
        store,
        el: dom.el,
        chatAPI,
        ui,
        windowObj: dom.window,
        documentObj: dom.document,
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentTopic: () => state.session.topics[0],
    });

    await controller.openShelfPicker();

    const card = dom.el.sourceShelfPickerBody.querySelector('[data-shelf-picker-doc="doc-new"]');
    assert.equal(card.disabled, true);
    assert.match(dom.el.sourceShelfPickerSummary.textContent, /50 个资料上限/);

    controller.togglePickerDocument('doc-new');
    await controller.confirmPickerSelection();

    assert.deepEqual(state.shelf.pickerSelectedDocumentIds, []);
    assert.deepEqual(calls, []);
    assert.equal(ui.toasts.some((toast) => /最多绑定 50 个资料文件/.test(toast.message)), true);
});

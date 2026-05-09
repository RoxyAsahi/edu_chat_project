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
        { id: 'doc-done', name: '教材.pdf', status: 'done', chunkCount: 3, fileSize: 2048, updatedAt: 100, mimeType: 'application/pdf' },
        { id: 'doc-processing', name: '试卷.docx', status: 'processing', chunkCount: 0, fileSize: 1024, updatedAt: 200 },
        { id: 'doc-failed', name: '坏文件.txt', status: 'failed', chunkCount: 0, fileSize: 512, updatedAt: 300, lastError: '解析失败' },
    ];
    const chatAPI = {
        async listKnowledgeBases(options) {
            assert.deepEqual(options, { kind: 'shelf' });
            return { success: true, items: [{ id: 'shelf-1', name: '教材', kind: 'shelf', documentCount: 3, doneCount: 1 }] };
        },
        async listKnowledgeBaseDocuments(kbId) {
            assert.equal(kbId, 'shelf-1');
            return { success: true, items: docs };
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
    assert.match(dom.el.sourceShelfDocuments.textContent, /教材\.pdf/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /试卷\.docx/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /坏文件\.txt/);
    assert.match(dom.el.sourceShelfDocuments.textContent, /解析失败/);
    assert.equal(dom.el.renameSourceShelfGroupBtn.disabled, false);
    assert.equal(dom.el.importSourceShelfFilesBtn.disabled, false);
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

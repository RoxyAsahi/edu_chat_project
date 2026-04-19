const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadSourceModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/source/sourceController.js');
    const moduleCache = new Map();

    async function buildModuleDataUrl(filePath) {
        const normalizedPath = path.resolve(filePath);
        if (moduleCache.has(normalizedPath)) {
            return moduleCache.get(normalizedPath);
        }

        let source = await fs.readFile(normalizedPath, 'utf8');
        source = source.replace(
            /^import\s+\{\s*positionFloatingElement\s*\}\s+from\s+['"].+?['"];\r?\n/m,
            'const positionFloatingElement = () => {};\n'
        );
        source = source.replace(
            /^import\s+\{\s*isReaderSupportedDocument\s*\}\s+from\s+['"].+?['"];\r?\n/m,
            `const isReaderSupportedDocument = (documentItem = {}) => {
    const contentType = String(documentItem.contentType || '').trim();
    if (['pdf-text', 'docx-text', 'plain', 'markdown', 'html'].includes(contentType)) {
        return true;
    }
    const mimeType = String(documentItem.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('text/')) {
        return true;
    }
    return mimeType === 'application/pdf'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || mimeType === 'application/xml';
};\n`
        );

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
            <div id="sourceFileTooltip"></div>
            <div id="sourceFileActionMenu"></div>
            <div id="knowledgeBaseDebugResults"></div>
            <div id="knowledgeBaseList"></div>
            <div id="knowledgeBaseDocuments"></div>
            <input id="knowledgeBaseNameInput" />
            <button id="runKnowledgeBaseSearchBtn"></button>
            <button id="runKnowledgeBaseDebugBtn"></button>
            <div id="knowledgeBaseSelectionSummary"></div>
            <button id="renameKnowledgeBaseBtn"></button>
            <button id="deleteKnowledgeBaseBtn"></button>
            <button id="importKnowledgeBaseFilesBtn"></button>
            <div id="topicKnowledgeBaseFiles"></div>
            <button id="importTopicKnowledgeBaseFilesBtn"></button>
            <div id="currentTopicKnowledgeBaseStatus"></div>
            <div id="sourcePanelBindingStatus"></div>
            <select id="currentTopicKnowledgeBaseSelect"></select>
            <select id="sourcePanelKnowledgeBaseSelect"></select>
            <button id="openKnowledgeBaseManagerBtn"></button>
            <input id="hiddenTopicKnowledgeBaseFileInput" type="file" />
            <input id="hiddenKnowledgeBaseFileInput" type="file" />
            <textarea id="knowledgeBaseDebugQueryInput"></textarea>
            <button id="createKnowledgeBaseBtn"></button>
        </body>
    `, { pretendToBeVisual: true });

    const { window } = dom;
    window.requestAnimationFrame = (callback) => {
        callback();
        return 1;
    };
    global.Element = window.Element;

    return {
        window,
        document: window.document,
        el: {
            sourceFileTooltip: window.document.getElementById('sourceFileTooltip'),
            sourceFileActionMenu: window.document.getElementById('sourceFileActionMenu'),
            knowledgeBaseDebugResults: window.document.getElementById('knowledgeBaseDebugResults'),
            knowledgeBaseList: window.document.getElementById('knowledgeBaseList'),
            knowledgeBaseDocuments: window.document.getElementById('knowledgeBaseDocuments'),
            knowledgeBaseNameInput: window.document.getElementById('knowledgeBaseNameInput'),
            runKnowledgeBaseSearchBtn: window.document.getElementById('runKnowledgeBaseSearchBtn'),
            runKnowledgeBaseDebugBtn: window.document.getElementById('runKnowledgeBaseDebugBtn'),
            knowledgeBaseSelectionSummary: window.document.getElementById('knowledgeBaseSelectionSummary'),
            renameKnowledgeBaseBtn: window.document.getElementById('renameKnowledgeBaseBtn'),
            deleteKnowledgeBaseBtn: window.document.getElementById('deleteKnowledgeBaseBtn'),
            importKnowledgeBaseFilesBtn: window.document.getElementById('importKnowledgeBaseFilesBtn'),
            topicKnowledgeBaseFiles: window.document.getElementById('topicKnowledgeBaseFiles'),
            importTopicKnowledgeBaseFilesBtn: window.document.getElementById('importTopicKnowledgeBaseFilesBtn'),
            currentTopicKnowledgeBaseStatus: window.document.getElementById('currentTopicKnowledgeBaseStatus'),
            sourcePanelBindingStatus: window.document.getElementById('sourcePanelBindingStatus'),
            currentTopicKnowledgeBaseSelect: window.document.getElementById('currentTopicKnowledgeBaseSelect'),
            sourcePanelKnowledgeBaseSelect: window.document.getElementById('sourcePanelKnowledgeBaseSelect'),
            openKnowledgeBaseManagerBtn: window.document.getElementById('openKnowledgeBaseManagerBtn'),
            hiddenTopicKnowledgeBaseFileInput: window.document.getElementById('hiddenTopicKnowledgeBaseFileInput'),
            hiddenKnowledgeBaseFileInput: window.document.getElementById('hiddenKnowledgeBaseFileInput'),
            knowledgeBaseDebugQueryInput: window.document.getElementById('knowledgeBaseDebugQueryInput'),
            createKnowledgeBaseBtn: window.document.getElementById('createKnowledgeBaseBtn'),
        },
    };
}

function createBaseState(overrides = {}) {
    return {
        settings: {
            settings: {},
            settingsModalSection: 'global',
            promptModule: null,
        },
        layout: {
            sourceListScrollTop: 0,
            leftSidebarMode: 'source-list',
        },
        session: {
            currentSelectedItem: {
                id: 'agent-1',
                name: '数学',
            },
            currentTopicId: 'topic-1',
            topics: [
                {
                    id: 'topic-1',
                    name: '函数',
                    knowledgeBaseId: null,
                },
            ],
        },
        source: {
            knowledgeBases: [],
            knowledgeBaseDocuments: [],
            topicKnowledgeBaseDocuments: [],
            knowledgeBaseDebugResult: null,
            selectedKnowledgeBaseId: null,
            activeSourceFileMenu: null,
        },
        reader: {
            documentId: null,
            status: 'idle',
            isIndexed: false,
            contentType: null,
            guideStatus: 'idle',
            guideMarkdown: '',
            guideGeneratedAt: null,
            guideError: null,
        },
        notes: {},
        composer: {},
        ...overrides,
    };
}

function createStore(initialState) {
    const state = initialState;
    const propertyMap = {
        currentSelectedItem: ['session', 'currentSelectedItem'],
        currentTopicId: ['session', 'currentTopicId'],
        topics: ['session', 'topics'],
        knowledgeBases: ['source', 'knowledgeBases'],
        knowledgeBaseDocuments: ['source', 'knowledgeBaseDocuments'],
        topicKnowledgeBaseDocuments: ['source', 'topicKnowledgeBaseDocuments'],
        knowledgeBaseDebugResult: ['source', 'knowledgeBaseDebugResult'],
        selectedKnowledgeBaseId: ['source', 'selectedKnowledgeBaseId'],
        activeSourceFileMenu: ['source', 'activeSourceFileMenu'],
        sourceListScrollTop: ['layout', 'sourceListScrollTop'],
        leftSidebarMode: ['layout', 'leftSidebarMode'],
        reader: ['reader'],
    };
    const view = new Proxy({}, {
        get(_target, prop) {
            const mapping = propertyMap[prop];
            if (!mapping) {
                return undefined;
            }
            const [slice, key] = mapping;
            return key ? state[slice][key] : state[slice];
        },
        set(_target, prop, value) {
            const mapping = propertyMap[prop];
            if (!mapping) {
                throw new Error(`Unknown test state prop: ${String(prop)}`);
            }
            const [slice, key] = mapping;
            if (key) {
                state[slice][key] = value;
            } else {
                state[slice] = value;
            }
            return true;
        },
    });
    return {
        getState() {
            return state;
        },
        view,
        patchState(slice, patch) {
            const currentSlice = state[slice];
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
    };
}

test('buildTopicSourceName combines agent and topic labels', async () => {
    const { buildTopicSourceName } = await loadSourceModule();

    assert.equal(
        buildTopicSourceName({
            topic: { id: 'topic-1', name: '函数分析' },
            agentName: '数学',
        }),
        '数学 · 函数分析'
    );
});

test('document visual and status helpers preserve current source presentation rules', async () => {
    const {
        formatDocumentStatus,
        getKnowledgeBaseDocumentVisual,
    } = await loadSourceModule();

    assert.equal(
        formatDocumentStatus({
            status: 'processing',
            chunkCount: 12,
            contentType: 'pdf-text',
            attemptCount: 2,
        }),
        '处理中 · 12 chunks · pdf-text · 尝试 2'
    );
    assert.deepEqual(
        getKnowledgeBaseDocumentVisual({
            name: 'chapter-1.pdf',
            mimeType: 'application/pdf',
        }),
        { icon: 'picture_as_pdf', tone: 'pdf', spinning: false }
    );
    assert.deepEqual(
        getKnowledgeBaseDocumentVisual({
            name: '道法海报.png',
            mimeType: 'image/png',
            status: 'processing',
        }),
        { icon: 'progress_activity', tone: 'loading', spinning: true }
    );
});

test('source polling helper only stays active while docs or guides are still pending', async () => {
    const { shouldPollKnowledgeBaseItems } = await loadSourceModule();

    assert.equal(shouldPollKnowledgeBaseItems({
        knowledgeBaseDocuments: [{ status: 'done' }],
        topicKnowledgeBaseDocuments: [{ guideStatus: 'done' }],
    }), false);
    assert.equal(shouldPollKnowledgeBaseItems({
        knowledgeBaseDocuments: [{ status: 'processing' }],
        topicKnowledgeBaseDocuments: [],
    }), true);
    assert.equal(shouldPollKnowledgeBaseItems({
        knowledgeBaseDocuments: [],
        topicKnowledgeBaseDocuments: [{ guideStatus: 'pending' }],
    }), true);
});

test('reuse helper only reuses selected kb docs when the topic binding matches', async () => {
    const { canReuseSelectedKnowledgeBaseDocuments } = await loadSourceModule();

    assert.equal(canReuseSelectedKnowledgeBaseDocuments({
        topicKnowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseId: 'kb-1',
    }), true);
    assert.equal(canReuseSelectedKnowledgeBaseDocuments({
        topicKnowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseId: 'kb-2',
    }), false);
    assert.equal(canReuseSelectedKnowledgeBaseDocuments({
        topicKnowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseId: 'kb-1',
        reuseSelected: false,
    }), false);
});

test('ensureTopicSource creates, binds, and hydrates a topic-scoped source', async () => {
    const { createSourceController } = await loadSourceModule();
    const { window, document, el } = createDomElements();
    const state = createBaseState();
    const store = createStore(state);
    const ui = createUiStub();
    const calls = [];

    const controller = createSourceController({
        store,
        el,
        chatAPI: {
            async createKnowledgeBase(payload) {
                calls.push(['createKnowledgeBase', payload]);
                return {
                    success: true,
                    item: { id: 'kb-topic', name: payload.name },
                };
            },
            async setTopicKnowledgeBase(agentId, topicId, kbId) {
                calls.push(['setTopicKnowledgeBase', agentId, topicId, kbId]);
                return { success: true };
            },
            async listKnowledgeBases() {
                calls.push(['listKnowledgeBases']);
                return {
                    success: true,
                    items: [{ id: 'kb-topic', name: '数学 · 函数', documentCount: 0, failedCount: 0, pendingCount: 0 }],
                };
            },
            async listKnowledgeBaseDocuments(kbId) {
                calls.push(['listKnowledgeBaseDocuments', kbId]);
                return { success: true, items: [] };
            },
        },
        ui,
        windowObj: window,
        documentObj: document,
        renderTopics: () => calls.push(['renderTopics']),
        updateTopicKnowledgeBaseBinding(kbId) {
            state.session.topics = state.session.topics.map((topic) => (
                topic.id === state.session.currentTopicId
                    ? { ...topic, knowledgeBaseId: kbId }
                    : topic
            ));
        },
    });

    const kbId = await controller.ensureTopicSource({ silent: true });

    assert.equal(kbId, 'kb-topic');
    assert.equal(state.session.topics[0].knowledgeBaseId, 'kb-topic');
    assert.equal(state.source.selectedKnowledgeBaseId, 'kb-topic');
    assert.deepEqual(calls.slice(0, 4), [
        ['createKnowledgeBase', { name: '数学 · 函数' }],
        ['setTopicKnowledgeBase', 'agent-1', 'topic-1', 'kb-topic'],
        ['listKnowledgeBases'],
        ['listKnowledgeBaseDocuments', 'kb-topic'],
    ]);
    assert.equal(ui.toasts.length, 0);
});

test('loadCurrentTopicKnowledgeBaseDocuments reuses selected docs when topic and manager target the same kb', async () => {
    const { createSourceController } = await loadSourceModule();
    const { window, document, el } = createDomElements();
    const documents = [
        { id: 'doc-1', name: '函数极限.md', status: 'done', contentType: 'markdown' },
    ];
    const state = createBaseState({
        session: {
            currentSelectedItem: { id: 'agent-1', name: '数学' },
            currentTopicId: 'topic-1',
            topics: [{ id: 'topic-1', name: '函数', knowledgeBaseId: 'kb-1' }],
        },
        source: {
            knowledgeBases: [],
            knowledgeBaseDocuments: documents,
            topicKnowledgeBaseDocuments: [],
            knowledgeBaseDebugResult: null,
            selectedKnowledgeBaseId: 'kb-1',
            activeSourceFileMenu: null,
        },
    });
    const store = createStore(state);
    let listCalls = 0;

    const controller = createSourceController({
        store,
        el,
        chatAPI: {
            async listKnowledgeBaseDocuments() {
                listCalls += 1;
                return { success: true, items: [] };
            },
        },
        ui: createUiStub(),
        windowObj: window,
        documentObj: document,
    });

    const result = await controller.loadCurrentTopicKnowledgeBaseDocuments();

    assert.equal(listCalls, 0);
    assert.deepEqual(result, documents);
    assert.notEqual(result, documents);
    assert.deepEqual(state.source.topicKnowledgeBaseDocuments, documents);
});

test('loadKnowledgeBaseDocuments delegates reader synchronization through injected adapters', async () => {
    const { createSourceController } = await loadSourceModule();
    const { window, document, el } = createDomElements();
    const documents = [
        { id: 'doc-1', name: 'lecture.pdf', status: 'done', contentType: 'pdf-text' },
    ];
    const state = createBaseState({
        session: {
            currentSelectedItem: { id: 'agent-1', name: '数学' },
            currentTopicId: 'topic-1',
            topics: [{ id: 'topic-1', name: '函数', knowledgeBaseId: 'kb-topic' }],
        },
    });
    const store = createStore(state);
    const syncCalls = [];

    const controller = createSourceController({
        store,
        el,
        chatAPI: {
            async listKnowledgeBaseDocuments() {
                return { success: true, items: documents };
            },
        },
        ui: createUiStub(),
        windowObj: window,
        documentObj: document,
        syncReaderFromDocuments(items, options) {
            syncCalls.push({ items, options });
        },
    });

    await controller.loadKnowledgeBaseDocuments('kb-topic', { target: 'topic' });

    assert.deepEqual(state.source.topicKnowledgeBaseDocuments, documents);
    assert.equal(syncCalls.length, 1);
    assert.deepEqual(syncCalls[0], {
        items: documents,
        options: { resetIfMissing: true },
    });
});

test('createSourceController keeps the public facade stable after source surface reduction', async () => {
    const { createSourceController } = await loadSourceModule();
    const { window, document, el } = createDomElements();
    const controller = createSourceController({
        store: createStore(createBaseState()),
        el,
        chatAPI: {},
        ui: createUiStub(),
        windowObj: window,
        documentObj: document,
    });

    [
        'ensureTopicSource',
        'loadKnowledgeBaseDocuments',
        'loadCurrentTopicKnowledgeBaseDocuments',
        'renderTopicKnowledgeBaseFiles',
        'syncCurrentTopicKnowledgeBaseControls',
        'syncKnowledgeBasePolling',
        'bindEvents',
    ].forEach((key) => {
        assert.equal(typeof controller[key], 'function');
    });
});

test('bindEvents routes UI actions through the controller facade methods', async () => {
    const { createSourceController } = await loadSourceModule();
    const { window, document, el } = createDomElements();
    const controller = createSourceController({
        store: createStore(createBaseState()),
        el,
        chatAPI: {},
        ui: createUiStub(),
        windowObj: window,
        documentObj: document,
    });
    const routedCalls = [];

    controller.createKnowledgeBase = async () => {
        routedCalls.push('createKnowledgeBase');
    };
    controller.runKnowledgeBaseSearch = async () => {
        routedCalls.push('runKnowledgeBaseSearch');
    };
    controller.handleTopicKnowledgeBaseChange = async (value) => {
        routedCalls.push(`handleTopicKnowledgeBaseChange:${value}`);
    };

    const option = document.createElement('option');
    option.value = 'kb-2';
    option.textContent = 'kb-2';
    el.currentTopicKnowledgeBaseSelect.appendChild(option);

    controller.bindEvents();

    el.createKnowledgeBaseBtn.click();
    el.runKnowledgeBaseSearchBtn.click();
    el.currentTopicKnowledgeBaseSelect.value = 'kb-2';
    el.currentTopicKnowledgeBaseSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(routedCalls, [
        'createKnowledgeBase',
        'runKnowledgeBaseSearch',
        'handleTopicKnowledgeBaseChange:kb-2',
    ]);
});

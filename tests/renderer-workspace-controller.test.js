const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadWorkspaceModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/workspace/workspaceController.js');
    let source = await fs.readFile(modulePath, 'utf8');
    source = source.replace(
        /^import\s+\{\s*positionFloatingElement\s*\}\s+from\s+['"].+?['"];\r?\n/m,
        'const positionFloatingElement = () => {};\n'
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createStore(initialState) {
    const state = initialState;
    return {
        getState() {
            return state;
        },
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

function createControllerHarness(overrides = {}) {
    const watcherCalls = [];
    const state = {
        settings: {
            settings: {
                userName: 'User',
            },
        },
        layout: {
            workspaceViewMode: 'overview',
        },
        session: {
            agents: [],
            topics: [{ id: 'topic-2', name: 'Topic 2', createdAt: Date.now() }],
            currentTopicId: 'topic-1',
            currentChatHistory: [],
            currentSelectedItem: {
                id: 'agent-1',
                type: 'agent',
                name: 'Agent 1',
                avatarUrl: null,
                config: {
                    agentDataPath: 'C:\\data\\agent-1',
                },
            },
            activeTopicMenu: null,
        },
    };

    const chatAPI = {
        async watcherStop() {
            watcherCalls.push(['stop']);
            return { success: true };
        },
        async watcherStart(filePath, agentId, topicId) {
            watcherCalls.push(['start', filePath, agentId, topicId]);
            return { success: true };
        },
        async getChatHistory() {
            return [];
        },
        async setTopicUnread() {
            return { success: true };
        },
        async saveSettings() {
            return { success: true };
        },
        async getAgentConfig(agentId) {
            return {
                name: agentId,
                avatarUrl: null,
                agentDataPath: 'C:\\data\\agent-1',
            };
        },
        async getAgentTopics() {
            return [{ id: 'topic-2', name: 'Topic 2', createdAt: Date.now() }];
        },
        async getAgents() {
            return [];
        },
        async getUnreadTopicCounts() {
            return { counts: {} };
        },
        async deleteAgent() {
            watcherCalls.push(['delete-agent']);
            return { success: true };
        },
        ...overrides.chatAPI,
    };

    return {
        watcherCalls,
        state,
        deps: {
            store: createStore(state),
            el: {},
            chatAPI,
            ui: {
                showToastNotification() {},
                async showConfirmDialog() {
                    return true;
                },
            },
            windowObj: {
                addEventListener() {},
                setInterval() {
                    return 1;
                },
                clearInterval() {},
            },
            documentObj: { addEventListener() {} },
            renderCurrentHistory: async () => {},
            renderTopicKnowledgeBaseFiles: () => {},
            syncCurrentTopicKnowledgeBaseControls: () => {},
            syncComposerAvailability: () => {},
            renderReaderPanel: () => {},
            refreshAttachmentPreview: () => {},
            resetComposerState: () => {},
            resetNotesState: () => {},
            resetReaderState: () => {},
            setLeftSidebarMode: () => {},
            setLeftReaderTab: () => {},
            setRightPanelMode: () => {},
            ensureTopicSource: async () => null,
            loadCurrentTopicKnowledgeBaseDocuments: async () => {},
            loadTopicNotes: async () => {},
            loadAgentNotes: async () => {},
            populateAgentForm: async () => {},
            setPromptVisible: () => {},
            closeSourceFileActionMenu: () => {},
            hideSourceFileTooltip: () => {},
            clearTopicKnowledgeBaseDocuments: () => {},
            getGlobalSettings: () => state.settings.settings,
            messageRendererApi: {
                setCurrentTopicId() {},
                setCurrentSelectedItem() {},
                setCurrentItemAvatar() {},
                setCurrentItemAvatarColor() {},
            },
        },
    };
}

function createOverviewDom() {
    const dom = new JSDOM(`
        <body>
            <section id="workspaceOverviewPage"></section>
            <main id="workspaceSubjectPage" class="hidden"></main>
            <button id="workspaceOverviewCreateAgentBtn"></button>
            <section class="workspace-overview-page__island-row"><div id="dynamicIsland"></div></section>
            <section id="subjectOverviewGrid"></section>
        </body>
    `);

    return {
        window: dom.window,
        document: dom.window.document,
        el: {
            workspaceOverviewPage: dom.window.document.getElementById('workspaceOverviewPage'),
            workspaceSubjectPage: dom.window.document.getElementById('workspaceSubjectPage'),
            workspaceOverviewCreateAgentBtn: dom.window.document.getElementById('workspaceOverviewCreateAgentBtn'),
            workspaceOverviewIslandRow: dom.window.document.querySelector('.workspace-overview-page__island-row'),
            dynamicIsland: dom.window.document.getElementById('dynamicIsland'),
            subjectOverviewGrid: dom.window.document.getElementById('subjectOverviewGrid'),
        },
    };
}

test('selectTopic stops the previous watcher before starting the next one', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness();
    const controller = createWorkspaceController(harness.deps);

    await controller.selectTopic('topic-2', { fromWatcher: true });

    assert.deepEqual(harness.watcherCalls, [
        ['stop'],
        ['start', 'C:\\data\\agent-1\\topics\\topic-2\\history.json', 'agent-1', 'topic-2'],
    ]);
});

test('clearCurrentConversationView stops the active watcher', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness();
    const controller = createWorkspaceController(harness.deps);

    await controller.clearCurrentConversationView();

    assert.deepEqual(harness.watcherCalls, [['stop']]);
});

test('deleteCurrentAgent stops the watcher before deleting the agent', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness();
    const controller = createWorkspaceController(harness.deps);

    await controller.deleteCurrentAgent();

    assert.deepEqual(harness.watcherCalls, [['stop'], ['delete-agent']]);
});

test('renderSubjectOverview starts a single clock timer and clears it when leaving overview', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness();
    const { window, document, el } = createOverviewDom();
    let intervalCalls = 0;
    const clearedIntervals = [];

    const controller = createWorkspaceController({
        ...harness.deps,
        el: {
            ...harness.deps.el,
            ...el,
        },
        windowObj: window,
        documentObj: document,
        buildSubjectOverviewMarkup: () => ({
            headline: '学科总视图',
            summary: '选择一个学科继续你的学习。',
            clockMarkup: '<section class="overview-clock-panel"><div id="overviewClockTime">00:00</div></section>',
            statsRowMarkup: '<section class="overview-stats-row"><article class="overview-stat-card"><span class="overview-stat-card__label">学科</span><strong>1</strong></article></section>',
            gridMarkup: '<section class="overview-subject-wall"><button id="subjectOverviewCreateCard"></button></section>',
        }),
        nowProvider: () => new Date('2026-04-13T09:05:00'),
        setIntervalFn: (handler) => {
            intervalCalls += 1;
            return { handler, id: intervalCalls };
        },
        clearIntervalFn: (timerId) => {
            clearedIntervals.push(timerId.id);
        },
    });

    controller.renderSubjectOverview();
    controller.renderSubjectOverview();

    assert.equal(intervalCalls, 1);
    assert.equal(document.getElementById('overviewClockTime').textContent, '09:05');
    assert.equal(document.querySelector('.overview-clock-panel')?.nextElementSibling?.className, 'overview-stats-row');
    assert.ok(document.querySelector('.workspace-overview-page__island-row'));

    controller.showSubjectWorkspace();

    assert.deepEqual(clearedIntervals, [1]);
});

test('showSubjectWorkspace requests a deferred desktop layout reset after leaving overview', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness();
    const { window, document, el } = createOverviewDom();
    const syncCalls = [];
    const refreshCalls = [];

    const controller = createWorkspaceController({
        ...harness.deps,
        el: {
            ...harness.deps.el,
            ...el,
        },
        windowObj: window,
        documentObj: document,
        syncMobileWorkspaceLayout: () => {
            syncCalls.push('sync');
        },
        refreshWorkspaceLayout: (options) => {
            refreshCalls.push(options);
        },
    });

    controller.showSubjectWorkspace();

    assert.equal(syncCalls.length, 1);
    assert.deepEqual(refreshCalls, [{
        frames: 2,
        resetDesktopLayout: true,
    }]);
});

test('overview subject cards expose edit from the right-click menu', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const harness = createControllerHarness({
        chatAPI: {
            async getAgentConfig(agentId) {
                return {
                    id: agentId,
                    name: '数学',
                    avatarUrl: null,
                    agentDataPath: `C:\\data\\${agentId}`,
                };
            },
            async getAgentTopics() {
                return [{ id: 'topic-2', name: 'Topic 2', createdAt: Date.now() }];
            },
        },
    });
    const { window, document, el } = createOverviewDom();
    const settingsCalls = [];
    harness.state.session.agents = [{ id: 'math', name: '数学' }];
    harness.state.session.currentSelectedItem = {
        id: null,
        type: 'agent',
        name: null,
        avatarUrl: null,
        config: null,
    };

    const controller = createWorkspaceController({
        ...harness.deps,
        el: {
            ...harness.deps.el,
            ...el,
        },
        windowObj: window,
        documentObj: document,
        buildSubjectOverviewMarkup: () => ({
            headline: '学习工作台',
            summary: '',
            gridMarkup: '<div id="subjectOverviewCollectionHost"></div>',
        }),
        buildSubjectCollectionMarkup: () => `
            <div data-subject-collection>
                <button type="button" data-subject-card data-agent-id="math">数学</button>
            </div>
        `,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
        openSettingsModal: (section) => {
            settingsCalls.push(section);
        },
    });

    controller.renderSubjectOverview();
    const card = document.querySelector('[data-subject-card]');
    card.dispatchEvent(new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
    }));

    const menu = document.querySelector('.subject-action-menu');
    assert.ok(menu);
    assert.match(menu.textContent, /编辑/);
    assert.match(menu.textContent, /删除/);

    menu.querySelector('[data-subject-action="edit"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(settingsCalls, ['agent']);
    assert.equal(harness.state.session.currentSelectedItem.id, 'math');
});

test('createTopic creates a placeholder topic without opening the prompt dialog', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    let promptCalls = 0;
    let createTopicArgs = null;
    const harness = createControllerHarness({
        chatAPI: {
            async createNewTopicForAgent(agentId, topicName, isBranch, locked) {
                createTopicArgs = { agentId, topicName, isBranch, locked };
                return { success: true, topicId: 'topic-new' };
            },
            async getAgentTopics() {
                return [
                    { id: 'topic-new', name: '新对话 2', createdAt: Date.now() },
                    { id: 'topic-2', name: 'Topic 2', createdAt: Date.now() },
                ];
            },
        },
    });

    const controller = createWorkspaceController({
        ...harness.deps,
        ui: {
            ...harness.deps.ui,
            async showPromptDialog() {
                promptCalls += 1;
                return 'should-not-open';
            },
        },
    });

    await controller.createTopic();

    assert.equal(promptCalls, 0);
    assert.deepEqual(createTopicArgs, {
        agentId: 'agent-1',
        topicName: '',
        isBranch: false,
        locked: true,
    });
    assert.equal(harness.state.session.currentTopicId, 'topic-new');
  });

test('syncCurrentTopicHistoryFromFile updates one changed message without reloading the topic', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    let renderCurrentHistoryCalls = 0;
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory(agentId, topicId) {
                assert.equal(agentId, 'agent-1');
                assert.equal(topicId, 'topic-1');
                return [
                    { id: 'm1', role: 'user', content: 'old question' },
                    {
                        id: 'm2',
                        role: 'assistant',
                        content: 'new answer',
                        reasoning_content: 'new reasoning',
                        kbContextRefs: [{ sourceId: 'kb-1' }],
                    },
                ];
            },
        },
    });
    harness.state.session.currentChatHistory = [
        { id: 'm1', role: 'user', content: 'old question' },
        { id: 'm2', role: 'assistant', content: 'old answer' },
    ];

    const controller = createWorkspaceController({
        ...harness.deps,
        renderCurrentHistory: async () => {
            renderCurrentHistoryCalls += 1;
        },
        messageRendererApi: {
            updateMessageContent(messageId, content) {
                calls.push(['update', messageId, content]);
            },
            removeMessageById(messageId, saveHistory) {
                calls.push(['remove', messageId, saveHistory]);
            },
            async renderMessage(message, isInitialLoad) {
                calls.push(['render', message.id, isInitialLoad]);
            },
            getActiveStreamingMessageId() {
                return null;
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, [['update', 'm2', 'new answer']]);
    assert.equal(renderCurrentHistoryCalls, 0);
    assert.deepEqual(harness.watcherCalls, []);
    assert.equal(harness.state.session.currentChatHistory[1].content, 'new answer');
    assert.equal(harness.state.session.currentChatHistory[1].reasoning_content, 'new reasoning');
});

test('syncCurrentTopicHistoryFromFile removes deleted messages and appends new tail messages', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                return [
                    { id: 'm1', role: 'user', content: 'keep' },
                    { id: 'm3', role: 'assistant', content: 'added' },
                ];
            },
        },
    });
    harness.state.session.currentChatHistory = [
        { id: 'm1', role: 'user', content: 'keep' },
        { id: 'm2', role: 'assistant', content: 'delete me' },
    ];

    const controller = createWorkspaceController({
        ...harness.deps,
        messageRendererApi: {
            updateMessageContent(messageId, content) {
                calls.push(['update', messageId, content]);
            },
            removeMessageById(messageId, saveHistory) {
                calls.push(['remove', messageId, saveHistory]);
            },
            async renderMessage(message, isInitialLoad) {
                calls.push(['render', message.id, isInitialLoad]);
            },
            getActiveStreamingMessageId() {
                return null;
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, [
        ['remove', 'm2', false],
        ['render', 'm3', true],
    ]);
    assert.deepEqual(harness.state.session.currentChatHistory.map((message) => message.id), ['m1', 'm3']);
});

test('syncCurrentTopicHistoryFromFile protects the active streaming message from file changes', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                return [
                    { id: 'm1', role: 'user', content: 'keep' },
                    { id: 'm2', role: 'assistant', content: 'disk version' },
                ];
            },
        },
    });
    harness.state.session.currentChatHistory = [
        { id: 'm1', role: 'user', content: 'keep' },
        { id: 'm2', role: 'assistant', content: 'live streaming text' },
    ];

    const controller = createWorkspaceController({
        ...harness.deps,
        messageRendererApi: {
            updateMessageContent(messageId, content) {
                calls.push(['update', messageId, content]);
            },
            removeMessageById(messageId, saveHistory) {
                calls.push(['remove', messageId, saveHistory]);
            },
            async renderMessage(message, isInitialLoad) {
                calls.push(['render', message.id, isInitialLoad]);
            },
            getActiveStreamingMessageId() {
                return 'm2';
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, []);
    assert.equal(harness.state.session.currentChatHistory[1].content, 'live streaming text');
    assert.equal(result.skippedActiveStreamingMessageId, 'm2');
});

test('syncCurrentTopicHistoryFromFile reorders rendered messages without reloading the topic', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    let renderCurrentHistoryCalls = 0;
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                return [
                    { id: 'm2', role: 'assistant', content: 'second' },
                    { id: 'm1', role: 'user', content: 'first' },
                    { id: 'm3', role: 'assistant', content: 'third' },
                ];
            },
        },
    });
    harness.state.session.currentChatHistory = [
        { id: 'm1', role: 'user', content: 'first' },
        { id: 'm2', role: 'assistant', content: 'second' },
        { id: 'm3', role: 'assistant', content: 'third' },
    ];

    const controller = createWorkspaceController({
        ...harness.deps,
        renderCurrentHistory: async () => {
            renderCurrentHistoryCalls += 1;
        },
        messageRendererApi: {
            getActiveStreamingMessageId() {
                return null;
            },
            reorderRenderedMessagesById(ids) {
                calls.push(['reorder', ids]);
                return ids;
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, [['reorder', ['m2', 'm1', 'm3']]]);
    assert.deepEqual(result.reorderedIds, ['m2', 'm1', 'm3']);
    assert.equal(renderCurrentHistoryCalls, 0);
    assert.deepEqual(harness.state.session.currentChatHistory.map((message) => message.id), ['m2', 'm1', 'm3']);
});

test('syncCurrentTopicHistoryFromFile keeps non-rendered window messages memory-only', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    const oldHistory = Array.from({ length: 100 }, (_value, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `old ${index}`,
    }));
    const nextHistory = oldHistory.map((message) => (
        message.id === 'm10'
            ? { ...message, content: 'updated old hidden message' }
            : { ...message }
    ));
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                return nextHistory;
            },
        },
    });
    harness.state.session.currentChatHistory = oldHistory;

    const controller = createWorkspaceController({
        ...harness.deps,
        messageRendererApi: {
            updateMessageContent(messageId, content) {
                calls.push(['update', messageId, content]);
            },
            getActiveStreamingMessageId() {
                return null;
            },
            isHistoryWindowActive() {
                return true;
            },
            getRenderedMessageIds() {
                return Array.from({ length: 30 }, (_value, index) => `m${70 + index}`);
            },
            getHistoryWindowSnapshot() {
                return {
                    active: true,
                    renderedStartIndex: 70,
                    renderedIds: Array.from({ length: 30 }, (_value, index) => `m${70 + index}`),
                    totalCount: 100,
                };
            },
            syncHistoryWindowHistory(history) {
                calls.push(['sync-window', history.length]);
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, [['sync-window', 100]]);
    assert.deepEqual(result.memoryOnlyIds, ['m10']);
    assert.equal(harness.state.session.currentChatHistory[10].content, 'updated old hidden message');
});

test('syncCurrentTopicHistoryFromFile updates visible window messages locally', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const calls = [];
    const oldHistory = Array.from({ length: 100 }, (_value, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `old ${index}`,
    }));
    const nextHistory = oldHistory.map((message) => (
        message.id === 'm72'
            ? { ...message, content: 'updated visible message' }
            : { ...message }
    ));
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                return nextHistory;
            },
        },
    });
    harness.state.session.currentChatHistory = oldHistory;

    const controller = createWorkspaceController({
        ...harness.deps,
        messageRendererApi: {
            updateMessageContent(messageId, content) {
                calls.push(['update', messageId, content]);
            },
            getActiveStreamingMessageId() {
                return null;
            },
            isHistoryWindowActive() {
                return true;
            },
            getRenderedMessageIds() {
                return Array.from({ length: 30 }, (_value, index) => `m${70 + index}`);
            },
            getHistoryWindowSnapshot() {
                return {
                    active: true,
                    renderedStartIndex: 70,
                    renderedIds: Array.from({ length: 30 }, (_value, index) => `m${70 + index}`),
                    totalCount: 100,
                };
            },
            syncHistoryWindowHistory(history) {
                calls.push(['sync-window', history.length]);
            },
        },
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.equal(result.applied, true);
    assert.deepEqual(calls, [
        ['update', 'm72', 'updated visible message'],
        ['sync-window', 100],
    ]);
    assert.deepEqual(result.memoryOnlyIds, []);
});

test('syncCurrentTopicHistoryFromFile skips while a message is being edited', async () => {
    const { createWorkspaceController } = await loadWorkspaceModule();
    const dom = new JSDOM('<body><article class="message-item-editing"></article></body>');
    let getChatHistoryCalls = 0;
    const harness = createControllerHarness({
        chatAPI: {
            async getChatHistory() {
                getChatHistoryCalls += 1;
                return [];
            },
        },
    });

    const controller = createWorkspaceController({
        ...harness.deps,
        documentObj: dom.window.document,
    });

    const result = await controller.syncCurrentTopicHistoryFromFile({
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.deepEqual(result, { applied: false, skipped: true, reason: 'editing' });
    assert.equal(getChatHistoryCalls, 0);
});

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
    assert.equal(document.querySelector('.overview-clock-panel')?.nextElementSibling?.className, 'workspace-overview-page__island-row');

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

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', relativePath);
    let source = await fs.readFile(modulePath, 'utf8');
    if (relativePath.endsWith('app/bootstrap.js')) {
        source = source.replace(/^import\s.+?;\r?\n/gm, '');
    } else if (relativePath.endsWith('app/workspace/workspaceController.js')) {
        source = source.replace(
            /^import\s+\{\s*positionFloatingElement\s*\}\s+from\s+['"].+?['"];\r?\n/m,
            'const positionFloatingElement = () => {};\n'
        );
    }
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('resolveWorkspaceBootstrapPlan requests a default agent before first selection', async () => {
    const { resolveWorkspaceBootstrapPlan } = await loadModule('src/modules/renderer/app/bootstrap.js');

    const emptyPlan = resolveWorkspaceBootstrapPlan({
        agents: [],
        settings: {},
    });
    assert.deepEqual(emptyPlan, {
        createDefaultAgent: true,
        agentId: null,
        topicId: null,
    });

    const afterCreatePlan = resolveWorkspaceBootstrapPlan({
        agents: [{ id: 'agent-1', name: '我的学习' }],
        settings: {},
    });
    assert.deepEqual(afterCreatePlan, {
        createDefaultAgent: false,
        agentId: 'agent-1',
        topicId: null,
    });
});

test('resolveWorkspaceBootstrapPlan restores saved agent and topic when they still exist', async () => {
    const { resolveWorkspaceBootstrapPlan } = await loadModule('src/modules/renderer/app/bootstrap.js');

    const plan = resolveWorkspaceBootstrapPlan({
        agents: [
            { id: 'agent-a', name: '数学' },
            { id: 'agent-b', name: '英语' },
        ],
        settings: {
            lastOpenItemId: 'agent-b',
            lastOpenTopicId: 'topic-42',
        },
    });

    assert.deepEqual(plan, {
        createDefaultAgent: false,
        agentId: 'agent-b',
        topicId: 'topic-42',
    });
});

test('resolveWorkspaceBootstrapPlan falls back to the first available agent when saved state is stale', async () => {
    const { resolveWorkspaceBootstrapPlan } = await loadModule('src/modules/renderer/app/bootstrap.js');

    const plan = resolveWorkspaceBootstrapPlan({
        agents: [
            { id: 'agent-a', name: '数学' },
            { id: 'agent-b', name: '英语' },
        ],
        settings: {
            lastOpenItemId: 'missing-agent',
            lastOpenTopicId: 'missing-topic',
        },
    });

    assert.deepEqual(plan, {
        createDefaultAgent: false,
        agentId: 'agent-a',
        topicId: null,
    });
});

test('shouldPersistTopicSelection skips last-open writes for watcher refreshes', async () => {
    const { shouldPersistTopicSelection } = await loadModule('src/modules/renderer/app/workspace/workspaceController.js');

    assert.equal(shouldPersistTopicSelection(), true);
    assert.equal(shouldPersistTopicSelection({ fromWatcher: false }), true);
    assert.equal(shouldPersistTopicSelection({ fromWatcher: true }), false);
});

test('createAppBootstrap cleans up IPC subscriptions before re-registering them', async () => {
    const { createAppBootstrap } = await loadModule('src/modules/renderer/app/bootstrap.js');
    let themeUnsubscribed = 0;
    let streamUnsubscribed = 0;
    let historyUnsubscribed = 0;
    let bindFeatureEventsCalls = 0;

    const chatAPI = {
        getCurrentTheme: async () => 'light',
        onThemeUpdated: () => () => {
            themeUnsubscribed += 1;
        },
        onVCPStreamEvent: () => () => {
            streamUnsubscribed += 1;
        },
        onHistoryFileUpdated: () => () => {
            historyUnsubscribed += 1;
        },
    };

    const bootstrapApi = createAppBootstrap({
        store: {
            getState: () => ({
                session: {
                    currentSelectedItem: { id: 'agent-1' },
                    currentTopicId: 'topic-1',
                    agents: [{ id: 'agent-1' }],
                },
                settings: {
                    settings: {},
                },
            }),
        },
        chatAPI,
        ui: {},
        windowObj: {
            chatAPI: {},
            electronAPI: {},
            electronPath: {},
        },
        applyTheme: () => {},
        loadSettings: async () => {},
        initializeResizableLayout: () => {},
        loadKnowledgeBases: async () => {},
        initializeAppRuntime: async () => {},
        workspaceController: {
            syncWorkspaceContext() {},
            async loadAgents() {},
            async selectAgent() {},
            async selectTopic() {},
        },
        handleStreamEvent: () => {},
        bindFeatureEvents: () => {
            bindFeatureEventsCalls += 1;
        },
        renderReaderPanel: () => {},
        renderSelectionContextPreview: () => {},
        renderNotesPanel: () => {},
        renderCurrentHistory: async () => {},
        finalizeBootstrap: () => {},
        setLeftSidebarMode: () => {},
        setLeftReaderTab: () => {},
        setRightPanelMode: () => {},
        setPromptVisible: () => {},
    });

    await bootstrapApi.bootstrap();
    await bootstrapApi.bootstrap();

    assert.equal(themeUnsubscribed, 1);
    assert.equal(streamUnsubscribed, 1);
    assert.equal(historyUnsubscribed, 1);
    assert.equal(bindFeatureEventsCalls, 1);
});

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

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
            windowObj: { addEventListener() {} },
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

import { initialize as initializeInterruptHandler } from '../interruptHandler.js';
import { initializeInputEnhancer } from '../inputEnhancerLite.js';
import { createStoreView, RENDERER_WRITABLE_SLICES } from './store/storeView.js';

function resolveWorkspaceBootstrapPlan({ agents = [], settings = {} } = {}) {
    const normalizedAgents = Array.isArray(agents) ? agents.filter(Boolean) : [];
    if (normalizedAgents.length === 0) {
        return {
            createDefaultAgent: true,
            agentId: null,
            topicId: null,
        };
    }

    const savedAgentId = typeof settings?.lastOpenItemId === 'string' ? settings.lastOpenItemId : '';
    if (savedAgentId && normalizedAgents.some((agent) => agent.id === savedAgentId)) {
        return {
            createDefaultAgent: false,
            agentId: savedAgentId,
            topicId: typeof settings?.lastOpenTopicId === 'string' ? settings.lastOpenTopicId : null,
        };
    }

    return {
        createDefaultAgent: false,
        agentId: normalizedAgents[0]?.id || null,
        topicId: null,
    };
}

async function initializeAppRuntime(deps = {}) {
    const store = deps.store;
    const state = createStoreView(store, {
        writableSlices: RENDERER_WRITABLE_SLICES,
    });
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const initMarked = deps.initMarked || (() => null);
    const messageRendererApi = deps.messageRendererApi;
    const interruptRequest = deps.interruptRequest;
    const appendAttachments = deps.appendAttachments;
    const windowObj = deps.windowObj || window;

    const markedInstance = initMarked();
    initializeInterruptHandler(chatAPI);

    messageRendererApi.initializeMessageRenderer({
        currentSelectedItemRef: {
            get: () => state.currentSelectedItem,
            set: (value) => {
                state.currentSelectedItem = value;
            },
        },
        currentTopicIdRef: {
            get: () => state.currentTopicId,
            set: (value) => {
                state.currentTopicId = value;
            },
        },
        currentChatHistoryRef: {
            get: () => state.currentChatHistory,
            set: (value) => {
                state.currentChatHistory = value;
            },
        },
        globalSettingsRef: {
            get: () => state.settings,
            set: (value) => {
                state.settings = value;
            },
        },
        chatMessagesDiv: el.chatMessages,
        electronAPI: chatAPI,
        markedInstance,
        uiHelper: ui,
        interruptHandler: { interrupt: interruptRequest },
        summarizeTopicFromMessages: async () => null,
    });

    if (windowObj.emoticonManager?.initialize) {
        await windowObj.emoticonManager.initialize({
            emoticonPanel: el.emoticonPanel,
            messageInput: el.messageInput,
        });
    }

    initializeInputEnhancer({
        messageInput: el.messageInput,
        dropTargetElement: el.chatInputCard,
        electronAPI: chatAPI,
        electronPath: windowObj.electronPath,
        autoResizeTextarea: ui.autoResizeTextarea,
        appendAttachments,
        getCurrentAgentId: () => state.currentSelectedItem.id,
        getCurrentTopicId: () => state.currentTopicId,
        showToast: (message, type = 'info', duration = 3000) => ui.showToastNotification(message, type, duration),
    });
}

function createAppBootstrap(deps = {}) {
    const windowObj = deps.windowObj || window;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const store = deps.store;
    const state = createStoreView(store, {
        writableSlices: RENDERER_WRITABLE_SLICES,
    });
    const applyTheme = deps.applyTheme;
    const loadSettings = deps.loadSettings;
    const initializeResizableLayout = deps.initializeResizableLayout;
    const loadKnowledgeBases = deps.loadKnowledgeBases || (async () => {});
    const initializeRuntime = deps.initializeAppRuntime || (async () => {});
    const workspaceController = deps.workspaceController;
    const setLeftSidebarMode = deps.setLeftSidebarMode || (() => {});
    const setLeftReaderTab = deps.setLeftReaderTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const renderReaderPanel = deps.renderReaderPanel || (() => {});
    const renderSelectionContextPreview = deps.renderSelectionContextPreview || (() => {});
    const bindFeatureEvents = deps.bindFeatureEvents || (() => {});
    const handleStreamEvent = deps.handleStreamEvent;
    const setPromptVisible = deps.setPromptVisible || (() => {});
    const renderNotesPanel = deps.renderNotesPanel || (() => {});
    const renderCurrentHistory = deps.renderCurrentHistory || (async () => {});
    const finalizeBootstrap = deps.finalizeBootstrap || (() => {});
    const defaultAgentName = deps.defaultAgentName || '我的学习';

    async function bootstrap() {
        const bridgeDiagnostics = {
            chatAPI: Boolean(windowObj.chatAPI),
            electronAPI: Boolean(windowObj.electronAPI),
            electronPath: Boolean(windowObj.electronPath),
        };

        if (!bridgeDiagnostics.chatAPI || !bridgeDiagnostics.electronAPI || !bridgeDiagnostics.electronPath) {
            throw new Error(`Preload bridge missing: ${JSON.stringify(bridgeDiagnostics)}`);
        }

        workspaceController.syncWorkspaceContext();
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        setRightPanelMode('notes');
        renderReaderPanel();
        renderSelectionContextPreview();
        await initializeRuntime();
        await loadSettings();
        initializeResizableLayout();
        await loadKnowledgeBases({ silent: true });

        const theme = await chatAPI.getCurrentTheme().catch(() => 'light');
        applyTheme(theme || 'light');

        chatAPI.onThemeUpdated((nextTheme) => applyTheme(nextTheme));
        chatAPI.onVCPStreamEvent(handleStreamEvent);
        chatAPI.onHistoryFileUpdated(async (payload) => {
            if (payload?.agentId === state.currentSelectedItem.id && payload?.topicId === state.currentTopicId) {
                await workspaceController.selectTopic(state.currentTopicId, { fromWatcher: true });
            }
        });

        bindFeatureEvents();
        await workspaceController.loadAgents();

        if (state.agents.length === 0) {
            const createResult = await chatAPI.createAgent(defaultAgentName, null);
            if (createResult?.agentId) {
                await workspaceController.loadAgents();
            }
        }

        const plan = resolveWorkspaceBootstrapPlan({
            agents: state.agents,
            settings: state.settings,
        });

        if (plan.agentId) {
            await workspaceController.selectAgent(plan.agentId, {
                preferredTopicId: plan.topicId,
            });
        } else {
            setPromptVisible(false);
            renderNotesPanel();
            await renderCurrentHistory();
        }

        finalizeBootstrap();
    }

    return {
        bootstrap,
    };
}

export {
    resolveWorkspaceBootstrapPlan,
    initializeAppRuntime,
    createAppBootstrap,
};

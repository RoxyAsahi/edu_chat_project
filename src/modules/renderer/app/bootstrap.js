import { initialize as initializeInterruptHandler } from '../interruptHandler.js';
import { initializeInputEnhancer } from '../inputEnhancerLite.js';

function getSessionSlice(store) {
    return store.getState().session;
}

function getSettingsSlice(store) {
    return store.getState().settings;
}

function patchSession(store, patch) {
    return store.patchState('session', (current, rootState) => ({
        ...current,
        ...(typeof patch === 'function' ? patch(current, rootState) : patch),
    }));
}

function patchSettingsSlice(store, patch) {
    return store.patchState('settings', (current, rootState) => ({
        ...current,
        ...(typeof patch === 'function' ? patch(current, rootState) : patch),
    }));
}

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
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const initMarked = deps.initMarked || (() => null);
    const messageRendererApi = deps.messageRendererApi;
    const interruptRequest = deps.interruptRequest;
    const appendAttachments = deps.appendAttachments;
    const addEmoticonAttachment = deps.addEmoticonAttachment;
    const generateFollowUpsForAssistantMessage = deps.generateFollowUpsForAssistantMessage || (async () => []);
    const setActiveRequestId = deps.setActiveRequestId || (() => {});
    const windowObj = deps.windowObj || window;

    const markedInstance = initMarked();
    initializeInterruptHandler(chatAPI);

    messageRendererApi.initializeMessageRenderer({
        currentSelectedItemRef: {
            get: () => getSessionSlice(store).currentSelectedItem,
            set: (value) => {
                patchSession(store, { currentSelectedItem: value });
            },
        },
        currentTopicIdRef: {
            get: () => getSessionSlice(store).currentTopicId,
            set: (value) => {
                patchSession(store, { currentTopicId: value });
            },
        },
        currentChatHistoryRef: {
            get: () => getSessionSlice(store).currentChatHistory,
            set: (value) => {
                patchSession(store, { currentChatHistory: value });
            },
        },
        globalSettingsRef: {
            get: () => getSettingsSlice(store).settings,
            set: (value) => {
                patchSettingsSlice(store, { settings: value });
            },
        },
        setActiveRequestId,
        chatMessagesDiv: el.chatMessages,
        electronAPI: chatAPI,
        markedInstance,
        uiHelper: ui,
        interruptHandler: { interrupt: interruptRequest },
        generateFollowUpsForAssistantMessage,
        summarizeTopicFromMessages: async () => null,
    });

    if (windowObj.emoticonManager?.initialize) {
        await windowObj.emoticonManager.initialize({
            emoticonPanel: el.emoticonPanel,
            messageInput: el.messageInput,
            onEmoticonSelected: addEmoticonAttachment,
        });
    }

    initializeInputEnhancer({
        messageInput: el.messageInput,
        dropTargetElement: el.chatInputCard,
        electronAPI: chatAPI,
        electronPath: windowObj.electronPath,
        autoResizeTextarea: ui.autoResizeTextarea,
        appendAttachments,
        getCurrentAgentId: () => getSessionSlice(store).currentSelectedItem.id,
        getCurrentTopicId: () => getSessionSlice(store).currentTopicId,
        showToast: (message, type = 'info', duration = 3000) => ui.showToastNotification(message, type, duration),
    });
}

function createAppBootstrap(deps = {}) {
    const windowObj = deps.windowObj || window;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const store = deps.store;
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
    let bootstrapSubscriptions = [];
    let featureEventsBound = false;

    function cleanupBootstrapSubscriptions() {
        bootstrapSubscriptions.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch (error) {
                console.warn('[UniStudyRenderer] bootstrap unsubscribe failed:', error);
            }
        });
        bootstrapSubscriptions = [];
    }

    function registerBootstrapSubscriptions() {
        cleanupBootstrapSubscriptions();

        bootstrapSubscriptions = [
            chatAPI.onThemeUpdated?.((nextTheme) => applyTheme(nextTheme)),
            chatAPI.onVCPStreamEvent?.(handleStreamEvent),
            chatAPI.onHistoryFileUpdated?.(async (payload) => {
                const session = getSessionSlice(store);
                if (payload?.agentId === session.currentSelectedItem.id && payload?.topicId === session.currentTopicId) {
                    await workspaceController.selectTopic(session.currentTopicId, { fromWatcher: true });
                }
            }),
        ].filter((unsubscribe) => typeof unsubscribe === 'function');
    }

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
        workspaceController.showSubjectWorkspace?.();
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

        registerBootstrapSubscriptions();

        if (!featureEventsBound) {
            bindFeatureEvents();
            featureEventsBound = true;
        }
        await workspaceController.loadAgents();

        if (getSessionSlice(store).agents.length === 0) {
            const createResult = await chatAPI.createAgent(defaultAgentName, null);
            if (createResult?.agentId) {
                await workspaceController.loadAgents();
            }
        }

        const plan = resolveWorkspaceBootstrapPlan({
            agents: getSessionSlice(store).agents,
            settings: getSettingsSlice(store).settings,
        });

        if (plan.agentId) {
            await workspaceController.selectAgent(plan.agentId, {
                preferredTopicId: plan.topicId,
                showSubjectWorkspace: false,
            });
        } else {
            setPromptVisible(false);
            renderNotesPanel();
            await renderCurrentHistory();
        }

        workspaceController.showWorkspaceOverview?.();

        finalizeBootstrap();
    }

    return {
        bootstrap,
        destroy: cleanupBootstrapSubscriptions,
    };
}

export {
    resolveWorkspaceBootstrapPlan,
    initializeAppRuntime,
    createAppBootstrap,
};

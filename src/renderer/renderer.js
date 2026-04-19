
import { interrupt as interruptRequest } from '../modules/renderer/interruptHandler.js';
import * as messageRenderer from '../modules/renderer/messageRenderer.js';
import { renderMarkdownToSafeHtml } from '../modules/renderer/safeHtml.js';
import { createComposerController } from '../modules/renderer/app/composer/composerController.js';
import { normalizeHistory } from '../modules/renderer/app/composer/composerUtils.js';
import { createFlashcardController } from '../modules/renderer/app/flashcards/flashcardController.js';
import { createAppStore, createInitialAppState } from '../modules/renderer/app/store/appStore.js';
import { collectRootElements } from '../modules/renderer/app/dom/collectRootElements.js';
import { createLayoutController } from '../modules/renderer/app/layout/layoutController.js';
import { createMobileWorkspaceController } from '../modules/renderer/app/layout/mobileWorkspaceController.js';
import { createDiaryWallController } from '../modules/renderer/app/diaryWall/diaryWallController.js';
import { createDynamicIslandController } from '../modules/renderer/app/dynamicIsland/dynamicIslandController.js';
import { createFollowUpController } from '../modules/renderer/app/followUps/followUpController.js';
import { createLogsController } from '../modules/renderer/app/logs/logsController.js';
import { createNotesController } from '../modules/renderer/app/notes/notesController.js';
import { createReaderController } from '../modules/renderer/app/reader/readerController.js';
import { createSettingsController } from '../modules/renderer/app/settings/settingsController.js';
import { createSourceController } from '../modules/renderer/app/source/sourceController.js';
import { createTopicTitleController } from '../modules/renderer/app/topicTitles/topicTitleController.js';
import { createWorkspaceController } from '../modules/renderer/app/workspace/workspaceController.js';
import { buildSubjectOverviewMarkup } from '../modules/renderer/app/workspace/workspaceOverview.js';
import { createAppBootstrap, initializeAppRuntime as initializeBootstrapRuntime } from '../modules/renderer/app/bootstrap.js';
import {
    createMarkdownFragmentRenderer,
    createMarkedInitializer,
    extractPromptTextFromLegacyConfig,
    normalizeTopic,
} from '../modules/renderer/app/runtime/rendererRuntimeHelpers.js';

const chatAPI = window.chatAPI || window.electronAPI;
const ui = window.uiHelperFunctions;
const store = createAppStore(createInitialAppState());
let markedInstance;

const el = collectRootElements(document);
const initializeMarked = createMarkedInitializer(window);
const renderMarkdownFragment = createMarkdownFragmentRenderer({
    renderMarkdownToSafeHtml,
    getMarkedInstance: () => markedInstance,
});
let sourceController = null;
let workspaceController = null;
let readerController = null;
let flashcardController = null;
let notesController = null;
let logsController = null;
let diaryWallController = null;
let dynamicIslandController = null;
let composerController = null;
let followUpController = null;
let topicTitleController = null;
const mobileWorkspaceController = createMobileWorkspaceController({
    store,
    el,
    windowObj: window,
    mobileBreakpoint: 1180,
});
const {
    bindEvents: bindMobileWorkspaceEvents,
    isNarrowWorkspaceLayout,
    setMobileWorkspaceTab,
    syncMobileWorkspaceLayout,
} = mobileWorkspaceController;
const layoutController = createLayoutController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    mergeSettingsPatch,
    getPersistedLayoutSettings: () => getSettingsSlice().settings,
});
const {
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    applyLayoutWidths,
    applyLeftSidebarHeights,
    scheduleLayoutRefresh,
    initializeResizableLayout,
    bindEvents: bindLayoutEvents,
} = layoutController;
const settingsController = createSettingsController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    messageRendererApi: messageRenderer,
    syncLayoutSettings: applyStoredLayoutSettings,
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    resolvePromptText: async () => (
        getPromptModule()
            ? await getPromptModule().getPrompt().catch(() => '')
            : (document.getElementById('unistudyPromptFallback')?.value || '').trim()
    ),
    reloadSelectedAgent: async (agentId) => {
        await workspaceController?.loadAgents?.();
        await workspaceController?.selectAgent?.(agentId);
    },
    getBubbleThemePreviewContext: () => {
        const session = getSessionSlice();
        const currentSelectedItem = session.currentSelectedItem || {};
        const currentTopic = session.topics.find((topic) => topic?.id === session.currentTopicId) || null;
        return {
            agentId: currentSelectedItem.id || '',
            agentName: currentSelectedItem.name || '',
            topicId: session.currentTopicId || '',
            topicName: currentTopic?.name || '',
            model: getSettingsSlice().settings.lastModel || getSettingsSlice().settings.defaultModel || '',
        };
    },
    openLogsPanel: async () => {
        setSidePanelTab('notes');
    },
});
const {
    applyTheme,
    applyRendererSettings,
    loadSettings,
    openSettingsModal,
    closeSettingsModal,
    setPromptVisible,
    bindEvents: bindSettingsEvents,
} = settingsController;
composerController = createComposerController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    interruptRequest,
    messageRendererApi: messageRenderer,
    createId: makeId,
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getCurrentChatHistory: () => getSessionSlice().currentChatHistory,
    getGlobalSettings: () => getSettingsSlice().settings,
    getCurrentTopic: (...args) => workspaceController?.getCurrentTopic?.(...args),
    loadTopics: (...args) => workspaceController?.loadTopics?.(...args),
    loadAgents: (...args) => workspaceController?.loadAgents?.(...args),
    buildTopicContext,
    persistHistory,
    resolveLivePrompt: async () => (
        getPromptModule()
            ? await getPromptModule().getPrompt().catch(() => '')
            : (document.getElementById('unistudyPromptFallback')?.value || '').trim()
    ),
    autoResizeTextarea: (node) => ui.autoResizeTextarea(node),
    decorateChatMessages: (...args) => {
        followUpController?.decorateChatMessages?.(...args);
        notesController?.decorateChatMessages?.(...args);
    },
    generateFollowUpsForAssistantMessage: (...args) => followUpController?.generateForAssistantMessage?.(...args),
    generateTopicTitleForAssistantMessage: (...args) => topicTitleController?.generateForAssistantMessage?.(...args),
    updateCurrentChatHistory,
});
followUpController = createFollowUpController({
    store,
    el,
    chatAPI,
    windowObj: window,
    documentObj: document,
    sendFollowUp: (...args) => composerController?.sendFollowUp?.(...args),
    updateCurrentChatHistory,
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getCurrentChatHistory: () => getSessionSlice().currentChatHistory,
});
topicTitleController = createTopicTitleController({
    store,
    chatAPI,
    windowObj: window,
    normalizeTopic,
    renderTopics: (...args) => workspaceController?.renderTopics?.(...args),
    syncWorkspaceContext: (...args) => workspaceController?.syncWorkspaceContext?.(...args),
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getCurrentChatHistory: () => getSessionSlice().currentChatHistory,
});
readerController = createReaderController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    renderMarkdownToSafeHtml,
    getMarkedInstance: () => markedInstance,
    setLeftSidebarMode,
    setLeftReaderTab,
    getLeftReaderActiveTab: () => getLayoutSlice().leftReaderActiveTab,
    renderTopicKnowledgeBaseFiles: (...args) => sourceController?.renderTopicKnowledgeBaseFiles?.(...args),
    syncKnowledgeBasePolling: (...args) => sourceController?.syncKnowledgeBasePolling?.(...args),
    hideSourceFileTooltip: (...args) => sourceController?.hideSourceFileTooltip?.(...args),
    onInjectSelection: (selection) => composerController?.injectSelection?.(selection),
    patchDocumentGuideStateInSource,
});
sourceController = createSourceController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    renderTopics: (...args) => workspaceController?.renderTopics?.(...args),
    openSettingsModal,
    closeTopicActionMenu: (...args) => workspaceController?.closeTopicActionMenu?.(...args),
    openReaderDocument: (...args) => readerController?.openReaderDocument?.(...args),
    isReaderDocumentActive: (...args) => readerController?.isDocumentActive?.(...args),
    syncReaderFromDocuments: (...args) => readerController?.syncFromSourceDocuments?.(...args),
    getNativePathForFile: (...args) => composerController?.getNativePathForFile?.(...args),
    loadTopics: (...args) => workspaceController?.loadTopics?.(...args),
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getTopics: () => getSessionSlice().topics,
    getLeftSidebarMode: () => getLayoutSlice().leftSidebarMode,
    getSourceListScrollTop,
    setSourceListScrollTop,
    updateTopicKnowledgeBaseBinding,
});
const {
    closeSourceFileActionMenu,
    ensureTopicSource,
    hideSourceFileTooltip,
    loadCurrentTopicKnowledgeBaseDocuments,
    loadKnowledgeBases,
    renderTopicKnowledgeBaseFiles,
    syncCurrentTopicKnowledgeBaseControls,
    syncKnowledgeBasePolling,
    bindEvents: bindSourceEvents,
} = sourceController;
flashcardController = createFlashcardController({
    store,
    el,
    chatAPI,
    ui,
    renderMarkdownFragment,
    setRightPanelMode,
    getNoteById: (...args) => notesController?.findNoteById?.(...args),
    normalizeNote: (...args) => notesController?.normalizeNote?.(...args),
    replaceNoteInCollections: (...args) => notesController?.replaceNoteInCollections?.(...args),
    openNoteDetail: (...args) => notesController?.openNoteDetail?.(...args),
    closeNoteDetail: (...args) => notesController?.closeNoteDetail?.(...args),
    renderNotesPanel: (...args) => notesController?.renderNotesPanel?.(...args),
});
notesController = createNotesController({
    store,
    el,
    chatAPI,
    ui,
    renderMarkdownFragment,
    windowObj: window,
    documentObj: document,
    setSidePanelTab,
    setRightPanelMode,
    showManualNotesLibraryPage: (...args) => workspaceController?.showManualNotesLibrary?.(...args),
    syncWorkspaceView: (...args) => workspaceController?.syncWorkspaceView?.(...args),
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getCurrentChatHistory: () => getSessionSlice().currentChatHistory,
    getCurrentTopic: (...args) => workspaceController?.getCurrentTopic?.(...args),
    getCurrentTopicDisplayName: (...args) => workspaceController?.getCurrentTopicDisplayName?.(...args),
    persistHistory,
    buildTopicContext,
    createId: makeId,
    flashcardsApi: flashcardController,
    closeTopicActionMenu: (...args) => workspaceController?.closeTopicActionMenu?.(...args),
    closeSourceFileActionMenu,
    updateCurrentChatHistory,
});
  logsController = createLogsController({
      store,
      el,
      chatAPI,
    ui,
    renderMarkdownFragment,
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
      getCurrentTopicId: () => getSessionSlice().currentTopicId,
      getCurrentTopicName: () => workspaceController?.getCurrentTopicDisplayName?.() || '',
      selectTopic: (...args) => workspaceController?.selectTopic?.(...args),
      openDiaryWall: () => diaryWallController?.open?.(),
      openDiaryManager: () => settingsController.openToolboxDiaryManager(),
  });
diaryWallController = createDiaryWallController({
    el,
    chatAPI,
    ui,
    documentObj: document,
    renderMarkdownFragment,
    getCurrentSelectedItem: () => getSessionSlice().currentSelectedItem,
    getCurrentTopicId: () => getSessionSlice().currentTopicId,
    getCurrentTopicName: () => workspaceController?.getCurrentTopicDisplayName?.() || '',
    selectTopic: (...args) => workspaceController?.selectTopic?.(...args),
    openLogsPanel: async () => {
        setSidePanelTab('notes');
    },
});
dynamicIslandController = createDynamicIslandController({
    store,
    el,
    ui,
    windowObj: window,
    documentObj: document,
});
workspaceController = createWorkspaceController({
    store,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    normalizeTopic,
    normalizeHistory,
    renderCurrentHistory,
    renderTopicKnowledgeBaseFiles,
    syncCurrentTopicKnowledgeBaseControls,
    syncComposerAvailability: (...args) => composerController?.syncComposerAvailability?.(...args),
    renderReaderPanel: (...args) => readerController?.renderReaderPanel?.(...args),
    refreshAttachmentPreview: (...args) => composerController?.refreshAttachmentPreview?.(...args),
    resetComposerState: (...args) => composerController?.resetState?.(...args),
    resetNotesState: (...args) => notesController?.resetState?.(...args),
    resetReaderState: (...args) => readerController?.resetReaderState?.(...args),
    setLeftSidebarMode,
    setLeftReaderTab,
    setRightPanelMode,
    ensureTopicSource,
    loadCurrentTopicKnowledgeBaseDocuments,
    loadTopicNotes: (...args) => notesController?.loadTopicNotes?.(...args),
    loadAgentNotes: (...args) => notesController?.loadAgentNotes?.(...args),
    refreshLogs: (...args) => logsController?.refreshLogs?.(...args),
    populateAgentForm,
    setPromptVisible: (visible) => settingsController.setPromptVisible(visible),
    messageRendererApi: messageRenderer,
    closeSourceFileActionMenu,
    hideSourceFileTooltip,
    clearTopicKnowledgeBaseDocuments,
    getGlobalSettings: () => getSettingsSlice().settings,
    buildSubjectOverviewMarkup,
    syncMobileWorkspaceLayout,
    refreshWorkspaceLayout: scheduleLayoutRefresh,
});
const {
    getCurrentTopic,
    getCurrentTopicDisplayName,
    syncWorkspaceContext,
    renderTopics,
    loadAgents,
    loadTopics,
    renameTopic,
    setTopicUnreadState,
    toggleTopicLockState,
    deleteTopicFromList,
    selectTopic,
    selectAgent,
    createAgent,
    createTopic,
    deleteCurrentAgent,
    exportCurrentTopic,
    closeTopicActionMenu,
    bindEvents: bindWorkspaceEvents,
} = workspaceController;
const {
    bindEvents: bindNotesEvents,
} = notesController;
const {
    bindEvents: bindLogsEvents,
    renderLogsPanel,
} = logsController;
const {
    bindEvents: bindDiaryWallEvents,
} = diaryWallController;
const {
    bindEvents: bindFlashcardEvents,
} = flashcardController;
const {
    bindEvents: bindComposerEvents,
    renderSelectionContextPreview,
    syncComposerAvailability,
    updateSendButtonState,
} = composerController;
const {
    renderReaderPanel,
    resetReaderState,
    bindEvents: bindReaderEvents,
} = readerController;
const { bootstrap } = createAppBootstrap({
    store,
    chatAPI,
    ui,
    applyTheme,
    loadSettings,
    initializeResizableLayout,
    loadKnowledgeBases,
    initializeAppRuntime: () => initializeBootstrapRuntime({
        store,
        el,
        chatAPI,
        ui,
        initMarked,
        messageRendererApi: messageRenderer,
        interruptRequest,
        appendAttachments: (...args) => composerController?.appendStoredAttachments?.(...args),
        addEmoticonAttachment: (...args) => composerController?.addEmoticonAttachment?.(...args),
        generateFollowUpsForAssistantMessage: (...args) => followUpController?.generateForAssistantMessage?.(...args),
        setActiveRequestId: (...args) => composerController?.setActiveRequestId?.(...args),
        windowObj: window,
    }),
    workspaceController,
    setLeftSidebarMode,
    setLeftReaderTab,
    setRightPanelMode,
    renderReaderPanel: (...args) => readerController?.renderReaderPanel?.(...args),
    renderSelectionContextPreview: (...args) => composerController?.renderSelectionContextPreview?.(...args),
    bindFeatureEvents,
    handleStreamEvent: (...args) => composerController?.handleStreamEvent?.(...args),
    setPromptVisible,
    renderNotesPanel: (...args) => notesController?.renderNotesPanel?.(...args),
    renderLogsPanel: (...args) => logsController?.renderLogsPanel?.(...args),
    renderCurrentHistory,
    finalizeBootstrap: () => {
        ui.autoResizeTextarea(el.messageInput);
        updateSendButtonState();
    },
});

const DEFAULT_SEND_BUTTON_HTML = el.sendMessageBtn?.innerHTML || '';
const INTERRUPT_SEND_BUTTON_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect>
    </svg>
`;
let chatLoadingTicket = 0;

function setAppBootLoading(visible) {
    if (!el.appBootLoading) {
        return;
    }

    el.appBootLoading.classList.toggle('hidden', !visible);
    el.appBootLoading.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function setChatLoading(visible, options = {}) {
    if (!el.chatLoadingOverlay) {
        return () => {};
    }

    if (!visible) {
        el.chatLoadingOverlay.classList.add('hidden');
        el.chatLoadingOverlay.setAttribute('aria-hidden', 'true');
        if (el.chatStage) {
            el.chatStage.classList.remove('chat-stage--loading');
        }
        return () => {};
    }

    const ticket = Number.isFinite(options.ticket) ? options.ticket : ++chatLoadingTicket;
    el.chatLoadingOverlay.classList.remove('hidden');
    el.chatLoadingOverlay.setAttribute('aria-hidden', 'false');
    if (el.chatStage) {
        el.chatStage.classList.add('chat-stage--loading');
    }

    return () => {
        if (ticket !== chatLoadingTicket) {
            return;
        }
        el.chatLoadingOverlay.classList.add('hidden');
        el.chatLoadingOverlay.setAttribute('aria-hidden', 'true');
        if (el.chatStage) {
            el.chatStage.classList.remove('chat-stage--loading');
        }
    };
}

function getAppState() { return store.getState(); }
function getSettingsSlice() { return getAppState().settings; }
function getLayoutSlice() { return getAppState().layout; }
function getSessionSlice() { return getAppState().session; }
function getComposerSlice() { return getAppState().composer; }
function getPromptModule() { return getSettingsSlice().promptModule; }

function mergeSettingsPatch(patch = {}) {
    store.patchState('settings', (current) => ({
        ...current,
        settings: {
            ...current.settings,
            ...patch,
        },
    }));
}

function applyStoredLayoutSettings(settings = {}) {
    if (!getLayoutSlice().layoutInitialized) {
        return;
    }

    store.patchState('layout', (current) => ({
        ...current,
        layoutLeftWidth: normalizeStoredLayoutWidth(settings.layoutLeftWidth, current.layoutLeftWidth),
        layoutRightWidth: normalizeStoredLayoutWidth(settings.layoutRightWidth, current.layoutRightWidth),
        layoutLeftTopHeight: normalizeStoredLayoutHeight(settings.layoutLeftTopHeight, current.layoutLeftTopHeight),
    }));
    applyLayoutWidths();
    applyLeftSidebarHeights();
}

function getSourceListScrollTop() {
    return getLayoutSlice().sourceListScrollTop || 0;
}

function setSourceListScrollTop(scrollTop = 0) {
    const nextScrollTop = Number.isFinite(Number(scrollTop)) ? Number(scrollTop) : 0;
    store.patchState('layout', {
        sourceListScrollTop: nextScrollTop,
    });
}

function updateTopicKnowledgeBaseBinding(knowledgeBaseId = null) {
    const session = getSessionSlice();
    if (!session.currentTopicId) {
        return;
    }

    store.patchState('session', (current) => ({
        ...current,
        topics: current.topics.map((topic) => (
            topic.id === current.currentTopicId
                ? { ...topic, knowledgeBaseId }
                : topic
        )),
    }));
}

function clearTopicKnowledgeBaseDocuments() {
    store.patchState('source', {
        topicKnowledgeBaseDocuments: [],
    });
}

function patchDocumentGuideStateInSource(documentId, patch = {}) {
    const applyPatch = (items = []) => items.map((item) => (
        item.id === documentId
            ? { ...item, ...patch }
            : item
    ));

    store.patchState('source', (current) => ({
        ...current,
        knowledgeBaseDocuments: applyPatch(current.knowledgeBaseDocuments),
        topicKnowledgeBaseDocuments: applyPatch(current.topicKnowledgeBaseDocuments),
    }));
}

function updateCurrentChatHistory(updater) {
    const nextSession = store.patchState('session', (current) => ({
        ...current,
        currentChatHistory: typeof updater === 'function'
            ? updater(current.currentChatHistory, current)
            : updater,
    }));
    return nextSession.currentChatHistory;
}

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function initMarked() {
    markedInstance = initializeMarked();
    return markedInstance;
}

function setSidePanelTab(tab) {
    const nextTab = 'notes';
    store.patchState('layout', {
        sidePanelTab: nextTab,
    });
    el.notesPanelTab?.classList.toggle('hidden', nextTab !== 'notes');
    el.notesPanelTab?.classList.toggle('side-panel-pane--active', nextTab === 'notes');
    el.sidePanelNotesTabBtn?.classList.toggle('side-panel-tab--active', nextTab === 'notes');
}

function setRightPanelMode(mode) {
    const nextMode = mode === 'flashcards' ? 'flashcards' : 'notes';

    store.patchState('layout', {
        rightPanelMode: nextMode,
    });
    setSidePanelTab('notes');
    if (isNarrowWorkspaceLayout()) {
        setMobileWorkspaceTab('studio');
    }
    el.noteEditorCard?.classList.toggle('hidden', nextMode !== 'notes');
    el.flashcardsPracticeCard?.classList.toggle('hidden', nextMode !== 'flashcards');
}

function rememberSourceListScrollPosition() {
    if (el.topicKnowledgeBaseFiles) {
        store.patchState('layout', {
            sourceListScrollTop: el.topicKnowledgeBaseFiles.scrollTop,
        });
    }
}

function restoreSourceListScrollPosition() {
    if (!el.topicKnowledgeBaseFiles) {
        return;
    }
    requestAnimationFrame(() => {
        if (el.topicKnowledgeBaseFiles) {
            el.topicKnowledgeBaseFiles.scrollTop = getLayoutSlice().sourceListScrollTop || 0;
        }
    });
}

function setLeftReaderTab(tab) {
    const nextTab = tab === 'content' ? 'content' : 'guide';
    const hasPendingSelection = readerController?.hasPendingSelection?.() || false;
    store.patchState('layout', {
        leftReaderActiveTab: nextTab,
    });

    el.leftReaderGuideTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'guide');
    el.leftReaderContentTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'content');
    el.readerGuidePane?.classList.remove('hidden');
    el.readerGuidePane?.classList.add('workspace-reader-pane--active');
    el.readerContentPane?.classList.remove('hidden');
    el.readerContentPane?.classList.add('workspace-reader-pane--active');
    el.readerSelectionBar?.classList.add('hidden');
}

function setLeftSidebarMode(mode) {
    const nextMode = mode === 'reader' ? 'reader' : 'source-list';
    if (nextMode === 'reader') {
        rememberSourceListScrollPosition();
    }

    store.patchState('layout', {
        leftSidebarMode: nextMode,
    });
    el.workspaceSidebar?.classList.toggle('workspace-sidebar--reader', nextMode === 'reader');
    el.workspaceTopicCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.sourceSidebarCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.workspaceReaderPanel?.classList.toggle('hidden', nextMode !== 'reader');
    el.workspaceVerticalResizeHandle?.classList.toggle('hidden', nextMode !== 'source-list');

    if (nextMode === 'source-list') {
        restoreSourceListScrollPosition();
    }
}

async function ensurePromptModule() {
    if (getPromptModule() || !window.OriginalPromptModule) return;
    store.patchState('settings', (current) => ({
        ...current,
        promptModule: new window.OriginalPromptModule({
            electronAPI: chatAPI,
        }),
    }));
}

async function syncPromptModule(agentId, config) {
    await ensurePromptModule();

    const activePrompt = await chatAPI.getActiveSystemPrompt(agentId).catch(() => null);
    const resolvedPrompt = activePrompt?.success
        ? (activePrompt.systemPrompt || '')
        : extractPromptTextFromLegacyConfig(config);
    const promptModule = getPromptModule();

    if (!promptModule) {
        el.systemPromptContainer.innerHTML = `
            <p class="prompt-text-mode-note">UniStudy 当前仅保留单文本提示词编辑器，旧版模块化提示词会在这里按纯文本展示。</p>
            <textarea id="unistudyPromptFallback" rows="6" placeholder="输入系统提示词...">${resolvedPrompt}</textarea>
        `;
        return;
    }

    promptModule.updateContext(agentId, {
        ...config,
        promptMode: 'original',
        originalSystemPrompt: resolvedPrompt,
        systemPrompt: resolvedPrompt,
    });
    promptModule.render(el.systemPromptContainer);

    const note = document.createElement('p');
    note.className = 'prompt-text-mode-note';
    note.textContent = 'UniStudy 当前仅开放文本提示词模式，旧版模块化或预设提示词会在这里被展开为纯文本。';
    el.systemPromptContainer.prepend(note);
}

async function populateAgentForm(config) {
    const session = getSessionSlice();
    el.editingAgentId.value = session.currentSelectedItem.id;
    el.agentNameInput.value = config.name || '';
    el.agentAvatarPreview.src = config.avatarUrl || '../assets/default_avatar.png';
    el.agentModel.value = config.model || '';
    if (el.agentVcpAliasesInput) {
        el.agentVcpAliasesInput.value = Array.isArray(config.vcpAliases)
            ? config.vcpAliases.join('\n')
            : (typeof config.vcpAliases === 'string' ? config.vcpAliases : '');
    }
    if (el.agentVcpMaidInput) {
        el.agentVcpMaidInput.value = config.vcpMaid || '';
    }
    el.agentTemperature.value = config.temperature ?? 0.7;
    el.agentContextTokenLimit.value = config.contextTokenLimit ?? 4000;
    el.agentMaxOutputTokens.value = config.maxOutputTokens ?? 1000;
    el.agentTopP.value = config.top_p ?? '';
    el.agentTopK.value = config.top_k ?? '';
    el.agentStreamOutputTrue.checked = config.streamOutput !== false;
    el.agentStreamOutputFalse.checked = config.streamOutput === false;
    el.agentAvatarBorderColor.value = config.avatarBorderColor || '#3d5a80';
    el.agentAvatarBorderColorText.value = config.avatarBorderColor || '#3d5a80';
    el.agentNameTextColor.value = config.nameTextColor || '#ffffff';
    el.agentNameTextColorText.value = config.nameTextColor || '#ffffff';
    el.disableCustomColors.checked = config.disableCustomColors === true;
    el.useThemeColorsInChat.checked = config.useThemeColorsInChat === true;
    await syncPromptModule(session.currentSelectedItem.id, config);
}

async function renderCurrentHistory() {
    const session = getSessionSlice();
    const shouldShowLoading = session.currentChatHistory.length > 0;
    const releaseChatLoading = shouldShowLoading
        ? setChatLoading(true, { ticket: ++chatLoadingTicket })
        : () => {};

    try {
        messageRenderer.clearChat({ preserveHistory: true });
        if (session.currentChatHistory.length === 0) {
            el.chatMessages.innerHTML = `<div class="empty-state" style="margin-top: 100px; background: transparent; border: none;">
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; color:var(--accent); margin-bottom:12px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
  <p style="font-size: 16px; font-weight: 500; color: var(--muted);">暂无消息，开始对话吧。</p>
</div>`;
            return;
        }
        await messageRenderer.renderHistory(session.currentChatHistory, true);
        followUpController?.decorateChatMessages?.();
        notesController?.decorateChatMessages?.();
    } finally {
        releaseChatLoading();
    }
}

function buildTopicContext() {
    const session = getSessionSlice();
    return {
        agentId: session.currentSelectedItem.id,
        topicId: session.currentTopicId,
        agentName: session.currentSelectedItem.name,
        avatarUrl: session.currentSelectedItem.avatarUrl,
        avatarColor: session.currentSelectedItem.config?.avatarCalculatedColor || null,
        isGroupMessage: false,
    };
}

async function persistHistory() {
    const session = getSessionSlice();
    if (!session.currentSelectedItem.id || !session.currentTopicId) return;
    await chatAPI.saveChatHistory(session.currentSelectedItem.id, session.currentTopicId, session.currentChatHistory);
}

window.sendMessage = async (prefillText) => composerController?.sendMessage?.(prefillText);
window.sendFollowUp = async (prompt) => composerController?.sendFollowUp?.(prompt);

window.__unistudyDebugState = () => {
    const session = getSessionSlice();
    const composer = getComposerSlice();
    return {
        currentSelectedItemId: session.currentSelectedItem.id,
        currentTopicId: session.currentTopicId,
        activeRequestId: composer.activeRequestId,
        agentCount: session.agents.length,
        topicCount: session.topics.length,
    };
};

window.updateSendButtonState = (...args) => composerController?.updateSendButtonState?.(...args);

let storeSubscriptionsBound = false;

function bindStoreSubscriptions() {
    if (storeSubscriptionsBound) {
        return;
    }

    storeSubscriptionsBound = true;

    store.subscribe('settings', (nextSettingsSlice) => {
        applyRendererSettings();
    });

    store.subscribe('session', () => {
        syncComposerAvailability();
    });

    store.subscribe('source', () => {
        syncCurrentTopicKnowledgeBaseControls();
    });

    store.subscribe('composer', () => {
        renderSelectionContextPreview();
        updateSendButtonState();
    });
}

function bindFeatureEvents() {
    bindStoreSubscriptions();
    bindLayoutEvents();
    bindSettingsEvents();
    bindReaderEvents();
    bindSourceEvents();
    bindWorkspaceEvents();
    bindNotesEvents();
    bindLogsEvents();
    bindDiaryWallEvents();
    dynamicIslandController?.bindEvents?.();
    bindFlashcardEvents();
    bindComposerEvents();
    bindMobileWorkspaceEvents();
    bindShellEvents();
}

function bindShellEvents() {
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (el.settingsModal && !el.settingsModal.classList.contains('hidden')) {
                closeSettingsModal();
            }
        }
    });

    el.agentAvatarInput?.addEventListener('change', () => {
        const file = el.agentAvatarInput.files?.[0];
        if (!file) return;
        el.agentAvatarPreview.src = file.path ? `file://${file.path.replace(/\\/g, '/')}` : URL.createObjectURL(file);
    });

    el.sidePanelNotesTabBtn?.addEventListener('click', () => {
        setSidePanelTab('notes');
    });

    el.minimizeBtn?.addEventListener('click', () => chatAPI.minimizeWindow());
    el.maximizeBtn?.addEventListener('click', () => chatAPI.maximizeWindow());
    el.closeBtn?.addEventListener('click', () => chatAPI.closeWindow());
}

function reportRendererFatalError(payload = {}) {
    const reporter = window.chatAPI?.reportRendererFatalError || window.electronAPI?.reportRendererFatalError;
    if (typeof reporter !== 'function') {
        return;
    }

    Promise.resolve(reporter(payload)).catch((error) => {
        console.error('[UniStudyRenderer] failed to report fatal error:', error);
    });
}

function installRendererFatalErrorReporting() {
    window.addEventListener('error', (event) => {
        const error = event.error;
        reportRendererFatalError({
            phase: 'window-error',
            message: error?.message || event.message || 'Unknown window error',
            stack: error?.stack || '',
            source: [event.filename, event.lineno, event.colno].filter(Boolean).join(':'),
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        reportRendererFatalError({
            phase: 'unhandledrejection',
            message: reason?.message || String(reason || 'Unhandled promise rejection'),
            stack: reason?.stack || '',
            source: 'window.unhandledrejection',
        });
    });
}

setAppBootLoading(true);
installRendererFatalErrorReporting();

bootstrap()
    .catch((error) => {
        console.error('[UniStudyRenderer] bootstrap failed:', error);
        reportRendererFatalError({
            phase: 'bootstrap',
            message: error?.message || 'Renderer bootstrap failed',
            stack: error?.stack || '',
            source: 'bootstrap()',
        });
        ui?.showToastNotification?.(error.message || 'Bootstrap failed', 'error', 5000);
    })
    .finally(() => {
        setAppBootLoading(false);
        syncMobileWorkspaceLayout();
    });

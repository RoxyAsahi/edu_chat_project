
import { interrupt as interruptRequest } from '../modules/renderer/interruptHandler.js';
import * as messageRenderer from '../modules/renderer/messageRenderer.js';
import { renderMarkdownToSafeHtml } from '../modules/renderer/safeHtml.js';
import { createComposerController } from '../modules/renderer/app/composer/composerController.js';
import { normalizeHistory } from '../modules/renderer/app/composer/composerUtils.js';
import { createFlashcardController } from '../modules/renderer/app/flashcards/flashcardController.js';
import { createAppStore, createInitialAppState } from '../modules/renderer/app/store/appStore.js';
import { collectRootElements } from '../modules/renderer/app/dom/collectRootElements.js';
import { createLayoutController } from '../modules/renderer/app/layout/layoutController.js';
import { createNotesController } from '../modules/renderer/app/notes/notesController.js';
import { createReaderController } from '../modules/renderer/app/reader/readerController.js';
import { createSettingsController } from '../modules/renderer/app/settings/settingsController.js';
import { createSourceController } from '../modules/renderer/app/source/sourceController.js';
import { createWorkspaceController } from '../modules/renderer/app/workspace/workspaceController.js';
import { createAppBootstrap, initializeAppRuntime as initializeBootstrapRuntime } from '../modules/renderer/app/bootstrap.js';

const chatAPI = window.chatAPI || window.electronAPI;
const ui = window.uiHelperFunctions;
const appStore = createAppStore(createInitialAppState());
const state = appStore.getState();

const el = collectRootElements(document);
let sourceController = null;
let workspaceController = null;
let readerController = null;
let flashcardController = null;
let notesController = null;
let composerController = null;
const layoutController = createLayoutController({
    state,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
});
const {
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    applyLayoutWidths,
    applyLeftSidebarHeights,
    initializeResizableLayout,
    bindEvents: bindLayoutEvents,
} = layoutController;
const settingsController = createSettingsController({
    state,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    messageRendererApi: messageRenderer,
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    applyLayoutWidths,
    applyLeftSidebarHeights,
    resolvePromptText: async () => (
        state.promptModule
            ? await state.promptModule.getPrompt().catch(() => '')
            : (document.getElementById('litePromptFallback')?.value || '').trim()
    ),
    reloadSelectedAgent: async (agentId) => {
        await workspaceController?.loadAgents?.();
        await workspaceController?.selectAgent?.(agentId);
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
    state,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    interruptRequest,
    messageRendererApi: messageRenderer,
    createId: makeId,
    getCurrentTopic: (...args) => workspaceController?.getCurrentTopic?.(...args),
    loadTopics: (...args) => workspaceController?.loadTopics?.(...args),
    loadAgents: (...args) => workspaceController?.loadAgents?.(...args),
    buildTopicContext,
    persistHistory,
    resolveLivePrompt: async () => (
        state.promptModule
            ? await state.promptModule.getPrompt().catch(() => '')
            : (document.getElementById('litePromptFallback')?.value || '').trim()
    ),
    autoResizeTextarea: (node) => ui.autoResizeTextarea(node),
    decorateChatMessages: (...args) => notesController?.decorateChatMessages?.(...args),
});
readerController = createReaderController({
    state,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
    renderMarkdownToSafeHtml,
    getMarkedInstance: () => markedInstance,
    setLeftSidebarMode,
    setLeftReaderTab,
    renderTopicKnowledgeBaseFiles: (...args) => sourceController?.renderTopicKnowledgeBaseFiles?.(...args),
    syncKnowledgeBasePolling: (...args) => sourceController?.syncKnowledgeBasePolling?.(...args),
    hideSourceFileTooltip: (...args) => sourceController?.hideSourceFileTooltip?.(...args),
    onInjectSelection: (selection) => composerController?.injectSelection?.(selection),
});
sourceController = createSourceController({
    state,
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
    state,
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
    state,
    el,
    chatAPI,
    ui,
    renderMarkdownFragment,
    windowObj: window,
    documentObj: document,
    setSidePanelTab,
    setRightPanelMode,
    getCurrentTopic: (...args) => workspaceController?.getCurrentTopic?.(...args),
    getCurrentTopicDisplayName: (...args) => workspaceController?.getCurrentTopicDisplayName?.(...args),
    persistHistory,
    buildTopicContext,
    createId: makeId,
    flashcardsApi: flashcardController,
    closeTopicActionMenu: (...args) => workspaceController?.closeTopicActionMenu?.(...args),
    closeSourceFileActionMenu,
});
workspaceController = createWorkspaceController({
    state,
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
    populateAgentForm,
    setPromptVisible: (visible) => settingsController.setPromptVisible(visible),
    messageRendererApi: messageRenderer,
    closeSourceFileActionMenu,
    hideSourceFileTooltip,
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
    state,
    chatAPI,
    ui,
    applyTheme,
    loadSettings,
    initializeResizableLayout,
    loadKnowledgeBases,
    initializeAppRuntime: () => initializeBootstrapRuntime({
        state,
        el,
        chatAPI,
        ui,
        initMarked,
        messageRendererApi: messageRenderer,
        interruptRequest,
        appendAttachments: (...args) => composerController?.appendStoredAttachments?.(...args),
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
    renderCurrentHistory,
    finalizeBootstrap: () => {
        ui.autoResizeTextarea(el.messageInput);
        updateSendButtonState();
    },
});

let markedInstance;
const DEFAULT_SEND_BUTTON_HTML = el.sendMessageBtn?.innerHTML || '';
const INTERRUPT_SEND_BUTTON_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect>
    </svg>
`;

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMarkdownFragment(text) {
    const markdown = String(text || '').trim();
    if (!markdown) {
        return '';
    }

    return renderMarkdownToSafeHtml(
        markdown,
        markedInstance || {
            parse(value) {
                return `<p>${escapeHtml(value)}</p>`;
            },
        },
    );
}

function initMarked() {
    if (window.marked && typeof window.marked.Marked === 'function') {
        markedInstance = new window.marked.Marked({
            gfm: true,
            tables: true,
            breaks: true,
            pedantic: false,
            sanitize: false,
            smartLists: true,
            smartypants: false,
            highlight(code, lang) {
                if (window.hljs) {
                    const language = window.hljs.getLanguage(lang) ? lang : 'plaintext';
                return window.hljs.highlight(code, { language }).value;
            }
            return code;
        },
        });
        return markedInstance;
    }

    markedInstance = {
        parse(text) {
            return `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`;
        },
    };
    return markedInstance;
}

function setSidePanelTab(tab) {
    state.sidePanelTab = 'notes';
    el.notesPanelTab?.classList.remove('hidden');
    el.notesPanelTab?.classList.add('side-panel-pane--active');
}

function setRightPanelMode(mode) {
    const nextMode = mode === 'flashcards' ? 'flashcards' : 'notes';

    state.rightPanelMode = nextMode;
    setSidePanelTab('notes');
    el.noteEditorCard?.classList.toggle('hidden', nextMode !== 'notes');
    el.flashcardsPracticeCard?.classList.toggle('hidden', nextMode !== 'flashcards');
}

function rememberSourceListScrollPosition() {
    if (el.topicKnowledgeBaseFiles) {
        state.sourceListScrollTop = el.topicKnowledgeBaseFiles.scrollTop;
    }
}

function restoreSourceListScrollPosition() {
    if (!el.topicKnowledgeBaseFiles) {
        return;
    }
    requestAnimationFrame(() => {
        if (el.topicKnowledgeBaseFiles) {
            el.topicKnowledgeBaseFiles.scrollTop = state.sourceListScrollTop || 0;
        }
    });
}

function setLeftReaderTab(tab) {
    const nextTab = tab === 'content' ? 'content' : 'guide';
    const hasPendingSelection = readerController?.hasPendingSelection?.() || false;
    state.leftReaderActiveTab = nextTab;

    el.leftReaderGuideTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'guide');
    el.leftReaderContentTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'content');
    el.readerGuidePane?.classList.toggle('hidden', nextTab !== 'guide');
    el.readerGuidePane?.classList.toggle('workspace-reader-pane--active', nextTab === 'guide');
    el.readerContentPane?.classList.toggle('hidden', nextTab !== 'content');
    el.readerContentPane?.classList.toggle('workspace-reader-pane--active', nextTab === 'content');
    el.readerSelectionBar?.classList.toggle('hidden', nextTab !== 'content' || !hasPendingSelection);
}

function setLeftSidebarMode(mode) {
    const nextMode = mode === 'reader' ? 'reader' : 'source-list';
    if (nextMode === 'reader') {
        rememberSourceListScrollPosition();
    }

    state.leftSidebarMode = nextMode;
    el.workspaceSidebar?.classList.toggle('workspace-sidebar--reader', nextMode === 'reader');
    el.workspaceTopicCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.sourceSidebarCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.workspaceReaderPanel?.classList.toggle('hidden', nextMode !== 'reader');
    el.workspaceVerticalResizeHandle?.classList.toggle('hidden', nextMode !== 'source-list');

    if (nextMode === 'source-list') {
        restoreSourceListScrollPosition();
    }
}

function normalizeTopic(topic = {}) {
    return {
        ...topic,
        knowledgeBaseId: topic.knowledgeBaseId || null,
    };
}

function extractPromptTextFromLegacyConfig(config = {}) {
    if (typeof config.originalSystemPrompt === 'string' && config.originalSystemPrompt.trim()) {
        return config.originalSystemPrompt;
    }

    if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
        return config.systemPrompt;
    }

    if (config.promptMode === 'modular') {
        const advancedPrompt = config.advancedSystemPrompt;
        if (typeof advancedPrompt === 'string' && advancedPrompt.trim()) {
            return advancedPrompt;
        }
        if (advancedPrompt && typeof advancedPrompt === 'object' && Array.isArray(advancedPrompt.blocks)) {
            return advancedPrompt.blocks
                .filter((block) => block && block.disabled !== true)
                .map((block) => {
                    if (block.type === 'newline') {
                        return '\n';
                    }
                    if (Array.isArray(block.variants) && block.variants.length > 0) {
                        return block.variants[block.selectedVariant || 0] || block.content || '';
                    }
                    return block.content || '';
                })
                .join('');
        }
    }

    if (config.promptMode === 'preset' && typeof config.presetSystemPrompt === 'string') {
        return config.presetSystemPrompt;
    }

    return '';
}

async function ensurePromptModule() {
    if (state.promptModule || !window.OriginalPromptModule) return;
    state.promptModule = new window.OriginalPromptModule({
        electronAPI: chatAPI,
    });
}

async function syncPromptModule(agentId, config) {
    await ensurePromptModule();

    const activePrompt = await chatAPI.getActiveSystemPrompt(agentId).catch(() => null);
    const resolvedPrompt = activePrompt?.success
        ? (activePrompt.systemPrompt || '')
        : extractPromptTextFromLegacyConfig(config);

    if (!state.promptModule) {
        el.systemPromptContainer.innerHTML = `
            <p class="prompt-text-mode-note">UniStudy 当前仅保留单文本提示词编辑器，旧版模块化提示词会在这里按纯文本展示。</p>
            <textarea id="litePromptFallback" rows="6" placeholder="输入系统提示词...">${resolvedPrompt}</textarea>
        `;
        return;
    }

    state.promptModule.updateContext(agentId, {
        ...config,
        promptMode: 'original',
        originalSystemPrompt: resolvedPrompt,
        systemPrompt: resolvedPrompt,
    });
    state.promptModule.render(el.systemPromptContainer);

    const note = document.createElement('p');
    note.className = 'prompt-text-mode-note';
    note.textContent = 'UniStudy 当前仅开放文本提示词模式，旧版模块化或预设提示词会在这里被展开为纯文本。';
    el.systemPromptContainer.prepend(note);
}

async function populateAgentForm(config) {
    el.editingAgentId.value = state.currentSelectedItem.id;
    el.agentNameInput.value = config.name || '';
    el.agentAvatarPreview.src = config.avatarUrl || '../assets/default_avatar.png';
    el.agentModel.value = config.model || '';
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
    await syncPromptModule(state.currentSelectedItem.id, config);
}

async function renderCurrentHistory() {
    messageRenderer.clearChat({ preserveHistory: true });
    if (state.currentChatHistory.length === 0) {
        el.chatMessages.innerHTML = `<div class="empty-state" style="margin-top: 100px; background: transparent; border: none;">
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; color:var(--accent); margin-bottom:12px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
  <p style="font-size: 16px; font-weight: 500; color: var(--muted);">暂无消息，开始对话吧。</p>
</div>`;
        return;
    }
    await messageRenderer.renderHistory(state.currentChatHistory, true);
    notesController?.decorateChatMessages?.();
}

function buildTopicContext() {
    return {
        agentId: state.currentSelectedItem.id,
        topicId: state.currentTopicId,
        agentName: state.currentSelectedItem.name,
        avatarUrl: state.currentSelectedItem.avatarUrl,
        avatarColor: state.currentSelectedItem.config?.avatarCalculatedColor || null,
        isGroupMessage: false,
    };
}

function buildSelectionContextTemporaryMessages(selectionContextRefs = []) {
    if (!Array.isArray(selectionContextRefs) || selectionContextRefs.length === 0) {
        return [];
    }

    const lines = selectionContextRefs.map((ref, index) => {
        const location = getReaderLocatorLabel(ref);
        return `[${index + 1}] ${ref.documentName || ref.documentId} | ${location}\n${ref.selectionText || ref.snippet || ''}`;
    });

    return [{
        role: 'system',
        content: [
            'Selected document excerpts for this turn:',
            ...lines,
            'Use these excerpts when they are relevant to the current user request.',
        ].join('\n\n'),
    }];
}

async function persistHistory() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) return;
    await chatAPI.saveChatHistory(state.currentSelectedItem.id, state.currentTopicId, state.currentChatHistory);
}

window.sendMessage = async (prefillText) => composerController?.sendMessage?.(prefillText);

window.__liteDebugState = () => ({
    currentSelectedItemId: state.currentSelectedItem.id,
    currentTopicId: state.currentTopicId,
    activeRequestId: state.activeRequestId,
    agentCount: state.agents.length,
    topicCount: state.topics.length,
});

window.updateSendButtonState = (...args) => composerController?.updateSendButtonState?.(...args);
window.setLiteActiveRequestId = (requestId = null) => composerController?.setActiveRequestId?.(requestId);

function bindFeatureEvents() {
    bindLayoutEvents();
    bindSettingsEvents();
    bindReaderEvents();
    bindSourceEvents();
    bindWorkspaceEvents();
    bindNotesEvents();
    bindFlashcardEvents();
    bindComposerEvents();
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

    el.minimizeBtn?.addEventListener('click', () => chatAPI.minimizeWindow());
    el.maximizeBtn?.addEventListener('click', () => chatAPI.maximizeWindow());
    el.closeBtn?.addEventListener('click', () => chatAPI.closeWindow());
}

bootstrap().catch((error) => {
    console.error('[LiteRenderer] bootstrap failed:', error);
    ui?.showToastNotification?.(error.message || 'Bootstrap failed', 'error', 5000);
});

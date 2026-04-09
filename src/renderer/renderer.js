
import { initialize as initializeInterruptHandler, interrupt as interruptRequest } from '../modules/renderer/interruptHandler.js';
import { initializeInputEnhancer } from '../modules/renderer/inputEnhancerLite.js';
import * as messageRenderer from '../modules/renderer/messageRenderer.js';

const chatAPI = window.chatAPI || window.electronAPI;
const ui = window.uiHelperFunctions;

const state = {
    settings: {
        userName: 'User',
        vcpServerUrl: '',
        vcpApiKey: '',
        currentThemeMode: 'system',
        enableAgentBubbleTheme: false,
        enableWideChatLayout: true,
        enableSmoothStreaming: true,
        chatFontPreset: 'system',
        chatCodeFontPreset: 'consolas',
        chatBubbleMaxWidthWideDefault: 92,
    },
    agents: [],
    topics: [],
    currentSelectedItem: { id: null, type: 'agent', name: null, avatarUrl: null, config: null },
    currentTopicId: null,
    currentChatHistory: [],
    pendingAttachments: [],
    promptModule: null,
    activeRequestId: null,
};

const el = {
    agentList: document.getElementById('agentList'),
    agentSearchInput: document.getElementById('agentSearchInput'),
    topicSearchInput: document.getElementById('topicSearchInput'),
    topicList: document.getElementById('topicList'),
    currentChatAgentName: document.getElementById('currentChatAgentName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInputCard: document.querySelector('.chat-input-card'),
    messageInput: document.getElementById('messageInput'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    attachFileBtn: document.getElementById('attachFileBtn'),
    emoticonTriggerBtn: document.getElementById('emoticonTriggerBtn'),
    composerQuickNewTopicBtn: document.getElementById('composerQuickNewTopicBtn'),
    hiddenFileInput: document.getElementById('hiddenFileInput'),
    attachmentPreviewArea: document.getElementById('attachmentPreviewArea'),
    emoticonPanel: document.getElementById('emoticonPanel'),
    createNewAgentBtn: document.getElementById('createNewAgentBtn'),
    quickNewTopicBtn: document.getElementById('quickNewTopicBtn'),
    exportTopicBtn: document.getElementById('exportTopicBtn'),
    currentAgentSettingsBtn: document.getElementById('currentAgentSettingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    globalSettingsBtn: document.getElementById('globalSettingsBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    minimizeBtn: document.getElementById('minimize-btn'),
    maximizeBtn: document.getElementById('maximize-btn'),
    closeBtn: document.getElementById('close-btn'),
    agentSettingsContainerTitle: document.getElementById('agentSettingsContainerTitle'),
    selectedAgentNameForSettings: document.getElementById('selectedAgentNameForSettings'),
    selectAgentPromptForSettings: document.getElementById('selectAgentPromptForSettings'),
    agentSettingsContainer: document.getElementById('agentSettingsContainer'),
    deleteAgentBtn: document.getElementById('deleteAgentBtn'),
    saveAgentSettingsBtn: document.getElementById('saveAgentSettingsBtn'),
    editingAgentId: document.getElementById('editingAgentId'),
    agentNameInput: document.getElementById('agentNameInput'),
    agentAvatarPreview: document.getElementById('agentAvatarPreview'),
    agentAvatarInput: document.getElementById('agentAvatarInput'),
    agentModel: document.getElementById('agentModel'),
    agentTemperature: document.getElementById('agentTemperature'),
    agentContextTokenLimit: document.getElementById('agentContextTokenLimit'),
    agentMaxOutputTokens: document.getElementById('agentMaxOutputTokens'),
    agentTopP: document.getElementById('agentTopP'),
    agentTopK: document.getElementById('agentTopK'),
    agentStreamOutputTrue: document.getElementById('agentStreamOutputTrue'),
    agentStreamOutputFalse: document.getElementById('agentStreamOutputFalse'),
    agentAvatarBorderColor: document.getElementById('agentAvatarBorderColor'),
    agentAvatarBorderColorText: document.getElementById('agentAvatarBorderColorText'),
    agentNameTextColor: document.getElementById('agentNameTextColor'),
    agentNameTextColorText: document.getElementById('agentNameTextColorText'),
    agentCardCss: document.getElementById('agentCardCss'),
    agentChatCss: document.getElementById('agentChatCss'),
    agentCustomCss: document.getElementById('agentCustomCss'),
    disableCustomColors: document.getElementById('disableCustomColors'),
    useThemeColorsInChat: document.getElementById('useThemeColorsInChat'),
    userNameInput: document.getElementById('userNameInput'),
    vcpServerUrl: document.getElementById('vcpServerUrl'),
    vcpApiKey: document.getElementById('vcpApiKey'),
    chatFontPreset: document.getElementById('chatFontPreset'),
    chatCodeFontPreset: document.getElementById('chatCodeFontPreset'),
    chatBubbleMaxWidthWideDefault: document.getElementById('chatBubbleMaxWidthWideDefault'),
    enableAgentBubbleTheme: document.getElementById('enableAgentBubbleTheme'),
    enableWideChatLayout: document.getElementById('enableWideChatLayout'),
    enableSmoothStreaming: document.getElementById('enableSmoothStreaming'),
    saveGlobalSettingsBtn: document.getElementById('saveGlobalSettingsBtn'),
    systemPromptContainer: document.getElementById('systemPromptContainer'),
};

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
        return;
    }

    markedInstance = {
        parse(text) {
            return `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`;
        },
    };
}

function applyTheme(theme) {
    document.body.classList.toggle('dark-theme', theme === 'dark');
    document.body.classList.toggle('light-theme', theme !== 'dark');
}

function applyRendererSettings() {
    const chatFonts = {
        system: '"Segoe UI", "PingFang SC", sans-serif',
        serif: 'Georgia, "Noto Serif SC", serif',
        monospace: '"Cascadia Code", "Consolas", monospace',
        consolas: '"Cascadia Code", "Consolas", monospace',
    };

    document.documentElement.style.setProperty('--lite-chat-max-width', `${Number(state.settings.chatBubbleMaxWidthWideDefault || 92)}%`);
    document.documentElement.style.setProperty('--lite-chat-font', chatFonts[state.settings.chatFontPreset] || chatFonts.system);
    document.documentElement.style.setProperty('--lite-code-font', chatFonts[state.settings.chatCodeFontPreset] || chatFonts.consolas);
    document.body.classList.toggle('wide-chat-layout', state.settings.enableWideChatLayout === true);
}

function syncGlobalSettingsForm() {
    el.userNameInput.value = state.settings.userName || '';
    el.vcpServerUrl.value = state.settings.vcpServerUrl || '';
    el.vcpApiKey.value = state.settings.vcpApiKey || '';
    el.chatFontPreset.value = state.settings.chatFontPreset || 'system';
    el.chatCodeFontPreset.value = state.settings.chatCodeFontPreset || 'consolas';
    el.chatBubbleMaxWidthWideDefault.value = state.settings.chatBubbleMaxWidthWideDefault ?? 92;
    el.enableAgentBubbleTheme.checked = state.settings.enableAgentBubbleTheme === true;
    el.enableWideChatLayout.checked = state.settings.enableWideChatLayout !== false;
    el.enableSmoothStreaming.checked = state.settings.enableSmoothStreaming === true;

    const themeMode = state.settings.currentThemeMode || 'system';
    const themeInput = document.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
    if (themeInput) themeInput.checked = true;
}

async function loadSettings() {
    const loaded = await chatAPI.loadSettings();
    state.settings = { ...state.settings, ...(loaded || {}) };
    window.globalSettings = state.settings;
    syncGlobalSettingsForm();
    applyRendererSettings();
    messageRenderer?.setUserAvatar(state.settings.userAvatarUrl || '../assets/default_user_avatar.png');
    messageRenderer?.setUserAvatarColor(state.settings.userAvatarCalculatedColor || null);
}

async function saveGlobalSettings() {
    const themeMode = document.querySelector('input[name="themeMode"]:checked')?.value || 'system';
    const patch = {
        userName: el.userNameInput.value.trim() || 'User',
        vcpServerUrl: el.vcpServerUrl.value.trim(),
        vcpApiKey: el.vcpApiKey.value.trim(),
        chatFontPreset: el.chatFontPreset.value,
        chatCodeFontPreset: el.chatCodeFontPreset.value,
        chatBubbleMaxWidthWideDefault: Number(el.chatBubbleMaxWidthWideDefault.value || 92),
        enableAgentBubbleTheme: el.enableAgentBubbleTheme.checked,
        enableWideChatLayout: el.enableWideChatLayout.checked,
        enableSmoothStreaming: el.enableSmoothStreaming.checked,
        currentThemeMode: themeMode,
    };
    const result = await chatAPI.saveSettings(patch);
    if (!result?.success) {
        ui.showToastNotification(`Failed to save settings: ${result?.error || 'Unknown error'}`, 'error');
        return;
    }

    state.settings = { ...state.settings, ...patch };
    window.globalSettings = state.settings;
    applyRendererSettings();
    chatAPI.setThemeMode(themeMode);
    window.emoticonManager?.reload?.();
    ui.showToastNotification('Global settings saved.', 'success');
}

function setPromptVisible(visible) {
    el.selectAgentPromptForSettings.classList.toggle('hidden', visible);
    el.agentSettingsContainer.classList.toggle('hidden', !visible);
}

function normalizeStoredAttachment(rawAttachment) {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
        return null;
    }

    const src = rawAttachment.src || rawAttachment.internalPath || '';
    const internalPath = rawAttachment.internalPath || (src.startsWith('file://') ? src : '');

    return {
        ...rawAttachment,
        name: rawAttachment.name || rawAttachment.originalName || 'Attachment',
        type: rawAttachment.type || 'application/octet-stream',
        src,
        internalPath,
        extractedText: rawAttachment.extractedText ?? null,
        imageFrames: Array.isArray(rawAttachment.imageFrames) ? rawAttachment.imageFrames : null,
    };
}

function normalizeAttachmentList(attachments) {
    return Array.isArray(attachments)
        ? attachments.map(normalizeStoredAttachment).filter(Boolean)
        : [];
}

function normalizeHistory(history) {
    return Array.isArray(history)
        ? history.map((message) => ({
            ...message,
            attachments: normalizeAttachmentList(message.attachments),
        }))
        : [];
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
            <p class="prompt-text-mode-note">Lite keeps a single text prompt editor. Legacy modular or preset prompts are displayed here as plain text.</p>
            <textarea id="litePromptFallback" rows="6" placeholder="Enter system prompt...">${resolvedPrompt}</textarea>
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
    note.textContent = 'Lite only exposes the text prompt mode. Older modular or preset prompts are flattened into plain text here.';
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
    el.agentCardCss.value = config.cardCss || '';
    el.agentChatCss.value = config.chatCss || '';
    el.agentCustomCss.value = config.customCss || '';
    el.disableCustomColors.checked = config.disableCustomColors === true;
    el.useThemeColorsInChat.checked = config.useThemeColorsInChat === true;
    await syncPromptModule(state.currentSelectedItem.id, config);
}

function renderAgentList(unreadCounts = {}) {
    el.agentList.innerHTML = '';
    if (state.agents.length === 0) {
        el.agentList.innerHTML = `
            <li class="empty-list-state">
                <strong>No agents yet</strong>
                <span>Use the "New Agent" button to create one, or let Lite import your existing data on first launch.</span>
            </li>
        `;
        return;
    }
    state.agents.forEach((agent) => {
        const li = document.createElement('li');
        li.className = 'list-item';
        li.dataset.agentId = agent.id || '';
        li.dataset.searchText = `${agent.name || ''} ${agent.id || ''}`.toLowerCase();
        li.classList.toggle('active', agent.id === state.currentSelectedItem.id);
        li.innerHTML = `
          <img class="avatar" src="${agent.avatarUrl || '../assets/default_avatar.png'}" alt="${agent.name || agent.id}" />
            <div class="list-item__body">
                <span class="list-item__title">${agent.name || agent.id}</span>
                <span class="list-item__meta">${agent.id}</span>
            </div>
            <span class="badge ${Object.prototype.hasOwnProperty.call(unreadCounts, agent.id) ? 'badge--active' : ''}">${unreadCounts[agent.id] ?? ''}</span>
        `;
        li.addEventListener('click', () => selectAgent(agent.id));
        el.agentList.appendChild(li);
    });
    filterAgents();
}

async function loadAgents() {
    const agents = await chatAPI.getAgents();
    if (agents?.error) {
        console.error('[LiteRenderer] getAgents failed:', agents.error);
        ui.showToastNotification(`Failed to load agents: ${agents.error}`, 'error');
        state.agents = [];
        renderAgentList({});
        return;
    }
    state.agents = Array.isArray(agents) ? agents : [];
    const unreadResult = await chatAPI.getUnreadTopicCounts().catch(() => ({ counts: {} }));
    renderAgentList(unreadResult?.counts || {});
}

function filterAgents() {
    const keyword = el.agentSearchInput.value.trim().toLowerCase();
    Array.from(el.agentList.children).forEach((item) => {
        item.hidden = !item.dataset.searchText.includes(keyword);
    });
}

function renderTopics() {
    el.topicList.innerHTML = '';
    if (state.topics.length === 0) {
        el.topicList.innerHTML = `
            <li class="empty-list-state">
                <strong>No topics yet</strong>
                <span>Create a topic to start chatting with this agent.</span>
            </li>
        `;
        return;
    }
    state.topics.forEach((topic) => {
        const li = document.createElement('li');
        li.className = 'list-item topic-item';
        li.dataset.topicId = topic.id || '';
        li.dataset.agentId = state.currentSelectedItem.id || '';
        li.dataset.searchText = `${topic.name || ''} ${new Date(topic.createdAt || Date.now()).toLocaleString()}`.toLowerCase();
        li.classList.toggle('active', topic.id === state.currentTopicId);
        const unreadLabel = topic.unread ? 'Unread' : 'Read';
        const lockLabel = topic.locked === false ? 'Open' : 'Locked';
        li.innerHTML = `
            <div class="topic-item__main">
                <div class="topic-item__header">
                    <div class="list-item__body">
                        <span class="list-item__title">${topic.name || topic.id}</span>
                        <div class="topic-item__meta-row">
                            <span class="list-item__meta">${new Date(topic.createdAt || Date.now()).toLocaleString()}</span>
                            <div class="topic-statuses">
                                <span class="topic-status ${topic.unread ? 'topic-status--unread' : ''}">${unreadLabel}</span>
                                <span class="topic-status">${lockLabel}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="topic-actions">
                    <button type="button" class="topic-action-btn" data-action="rename" title="Rename Topic"><span class="material-symbols-outlined">edit</span></button>
                    <button type="button" class="topic-action-btn" data-action="toggle-unread" title="${topic.unread ? 'Mark Read' : 'Mark Unread'}"><span class="material-symbols-outlined">${topic.unread ? 'drafts' : 'mark_chat_unread'}</span></button>
                    <button type="button" class="topic-action-btn" data-action="toggle-lock" title="${topic.locked === false ? 'Lock Topic' : 'Unlock Topic'}"><span class="material-symbols-outlined">${topic.locked === false ? 'lock_open' : 'lock'}</span></button>
                    <button type="button" class="topic-action-btn topic-action-btn--danger" data-action="delete" title="Delete Topic"><span class="material-symbols-outlined">delete</span></button>
                </div>
            </div>
        `;

        li.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (actionButton) {
                event.stopPropagation();
                const { action } = actionButton.dataset;
                if (action === 'rename') {
                    await renameTopic(topic);
                } else if (action === 'toggle-unread') {
                    await setTopicUnreadState(topic, !topic.unread);
                } else if (action === 'toggle-lock') {
                    await toggleTopicLockState(topic);
                } else if (action === 'delete') {
                    await deleteTopicFromList(topic);
                }
                return;
            }

            await selectTopic(topic.id);
        });

        li.addEventListener('dblclick', () => renameTopic(topic));
        el.topicList.appendChild(li);
    });
    filterTopics();
}

function filterTopics() {
    const keyword = el.topicSearchInput.value.trim().toLowerCase();
    Array.from(el.topicList.children).forEach((item) => {
        item.hidden = !item.dataset.searchText.includes(keyword);
    });
}

async function loadTopics() {
    if (!state.currentSelectedItem.id) {
        state.topics = [];
        state.currentTopicId = null;
        renderTopics();
        syncComposerAvailability();
        return;
    }
    const topics = await chatAPI.getAgentTopics(state.currentSelectedItem.id);
    state.topics = Array.isArray(topics) ? topics : [];
    if (!state.topics.some((topic) => topic.id === state.currentTopicId)) {
        state.currentTopicId = null;
    }
    if (!state.currentTopicId && state.topics.length > 0) {
        state.currentTopicId = state.topics[0].id;
    }
    renderTopics();
    syncComposerAvailability();
}

async function renameTopic(topic) {
    const nextName = await ui.showPromptDialog({
        title: 'Rename Topic',
        message: 'Update the topic title.',
        placeholder: 'Topic name',
        defaultValue: topic.name || topic.id,
        confirmText: 'Save',
        cancelText: 'Cancel',
    });
    if (!nextName) return;

    const result = await chatAPI.saveAgentTopicTitle(state.currentSelectedItem.id, topic.id, nextName.trim());
    if (result?.error) {
        ui.showToastNotification(`Failed to rename topic: ${result.error}`, 'error');
        return;
    }

    topic.name = nextName.trim();
    renderTopics();
}

async function setTopicUnreadState(topic, unread) {
    const result = await chatAPI.setTopicUnread(state.currentSelectedItem.id, topic.id, unread);
    if (!result?.success) {
        ui.showToastNotification(`Failed to update topic state: ${result?.error || 'Unknown error'}`, 'error');
        return;
    }

    topic.unread = unread;
    renderTopics();
    await loadAgents();
}

async function toggleTopicLockState(topic) {
    const result = await chatAPI.toggleTopicLock(state.currentSelectedItem.id, topic.id);
    if (!result?.success) {
        ui.showToastNotification(`Failed to update lock state: ${result?.error || 'Unknown error'}`, 'error');
        return;
    }

    topic.locked = result.locked;
    renderTopics();
}

async function clearCurrentConversationView() {
    state.currentTopicId = null;
    state.currentChatHistory = [];
    state.pendingAttachments = [];
    renderTopics();
    refreshAttachmentPreview();
    await renderCurrentHistory();
    syncComposerAvailability();
}

async function deleteTopicFromList(topic) {
    const label = topic.name || topic.id;
    const confirmed = await ui.showConfirmDialog(`Delete topic "${label}"?`, 'Delete Topic', 'Delete', 'Cancel', true);
    if (!confirmed) return;

    const result = await chatAPI.deleteTopic(state.currentSelectedItem.id, topic.id);
    if (result?.error) {
        ui.showToastNotification(`Failed to delete topic: ${result.error}`, 'error');
        return;
    }

    if (state.currentTopicId === topic.id) {
        state.currentTopicId = null;
    }

    await loadTopics();
    await loadAgents();

    if (state.topics.length > 0) {
        await selectTopic(state.currentTopicId || state.topics[0].id);
        return;
    }

    await clearCurrentConversationView();
}

function buildHistoryFilePath() {
    const base = (state.currentSelectedItem?.config?.agentDataPath || '').replace(/[\\/]+$/, '');
    if (!base || !state.currentTopicId) return null;
    return `${base}\\topics\\${state.currentTopicId}\\history.json`;
}

async function renderCurrentHistory() {
    messageRenderer.clearChat({ preserveHistory: true });
    if (state.currentChatHistory.length === 0) {
        el.chatMessages.innerHTML = `<div class="empty-state" style="margin-top: 100px; background: transparent; border: none;">
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; color:var(--accent); margin-bottom:12px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
  <p style="font-size: 16px; font-weight: 500; color: var(--muted);">No messages yet. Start a conversation.</p>
</div>`;
        return;
    }
    await messageRenderer.renderHistory(state.currentChatHistory, true);
}
async function selectTopic(topicId, options = {}) {
    if (!state.currentSelectedItem.id || !topicId) return;
    state.currentTopicId = topicId;
    state.pendingAttachments = [];
    refreshAttachmentPreview();
    syncComposerAvailability();
    messageRenderer.setCurrentTopicId?.(topicId);

    const history = await chatAPI.getChatHistory(state.currentSelectedItem.id, topicId);
    state.currentChatHistory = normalizeHistory(history);
    renderTopics();
    await renderCurrentHistory();

    const historyPath = buildHistoryFilePath();
    if (historyPath) {
        await chatAPI.watcherStart(historyPath, state.currentSelectedItem.id, topicId);
    }

    if (!options.fromWatcher) {
        await chatAPI.setTopicUnread(state.currentSelectedItem.id, topicId, false).catch(() => {});
        await chatAPI.saveSettings({
            lastOpenItemId: state.currentSelectedItem.id,
            lastOpenItemType: 'agent',
            lastOpenTopicId: topicId,
        }).catch(() => {});
        await loadAgents();
    }
}

async function selectAgent(agentId) {
    const config = await chatAPI.getAgentConfig(agentId);
    if (!config || config.error) {
        ui.showToastNotification(`Failed to load agent: ${config?.error || 'Unknown error'}`, 'error');
        return;
    }

    state.currentSelectedItem = {
        id: agentId,
        type: 'agent',
        name: config.name || agentId,
        avatarUrl: config.avatarUrl || '../assets/default_avatar.png',
        config,
    };
    state.pendingAttachments = [];
    refreshAttachmentPreview();

    el.currentChatAgentName.textContent = config.name || agentId;
    el.agentSettingsContainerTitle.textContent = 'Agent Settings';
    el.selectedAgentNameForSettings.textContent = config.name || agentId;
    setPromptVisible(true);
    messageRenderer.setCurrentSelectedItem?.(state.currentSelectedItem);
    messageRenderer.setCurrentItemAvatar?.(state.currentSelectedItem.avatarUrl);
    messageRenderer.setCurrentItemAvatarColor?.(config.avatarCalculatedColor || null);

    await populateAgentForm(config);
    await loadTopics();
    await loadAgents();

    if (state.topics.length > 0) {
        await selectTopic(state.currentTopicId || state.topics[0].id);
    } else {
        state.currentTopicId = null;
        state.currentChatHistory = [];
        await renderCurrentHistory();
        syncComposerAvailability();
    }
}

async function saveAgentSettings() {
    if (!state.currentSelectedItem.id) return;
    const promptText = state.promptModule
        ? await state.promptModule.getPrompt()
        : (document.getElementById('litePromptFallback')?.value || '').trim();

    const patch = {
        name: el.agentNameInput.value.trim(),
        model: el.agentModel.value.trim(),
        temperature: Number(el.agentTemperature.value || 0.7),
        contextTokenLimit: Number(el.agentContextTokenLimit.value || 4000),
        maxOutputTokens: Number(el.agentMaxOutputTokens.value || 1000),
        top_p: el.agentTopP.value === '' ? undefined : Number(el.agentTopP.value),
        top_k: el.agentTopK.value === '' ? undefined : Number(el.agentTopK.value),
        streamOutput: el.agentStreamOutputTrue.checked,
        avatarBorderColor: el.agentAvatarBorderColor.value,
        nameTextColor: el.agentNameTextColor.value,
        cardCss: el.agentCardCss.value,
        chatCss: el.agentChatCss.value,
        customCss: el.agentCustomCss.value,
        disableCustomColors: el.disableCustomColors.checked,
        useThemeColorsInChat: el.useThemeColorsInChat.checked,
        promptMode: 'original',
        originalSystemPrompt: promptText,
        systemPrompt: promptText,
    };

    const saveResult = await chatAPI.saveAgentConfig(state.currentSelectedItem.id, patch);
    if (saveResult?.error) {
        ui.showToastNotification(`Failed to save agent: ${saveResult.error}`, 'error');
        return;
    }

    const avatarFile = el.agentAvatarInput.files?.[0];
    if (avatarFile) {
        const buffer = await avatarFile.arrayBuffer();
        await chatAPI.saveAvatar(state.currentSelectedItem.id, {
            name: avatarFile.name,
            type: avatarFile.type,
            buffer,
        });
        el.agentAvatarInput.value = '';
    }

    ui.showToastNotification('Agent settings saved.', 'success');
    await loadAgents();
    await selectAgent(state.currentSelectedItem.id);
}

function refreshAttachmentPreview() {
    ui.updateAttachmentPreview(state.pendingAttachments, el.attachmentPreviewArea);
}

function syncComposerAvailability() {
    const hasTopic = Boolean(state.currentSelectedItem.id && state.currentTopicId);
    const interrupting = Boolean(state.activeRequestId);

    el.messageInput.disabled = !hasTopic;
    el.attachFileBtn.disabled = !hasTopic;
    el.emoticonTriggerBtn.disabled = !hasTopic;
    el.composerQuickNewTopicBtn.disabled = !hasTopic;
    el.sendMessageBtn.disabled = !hasTopic && !interrupting;

    if (!hasTopic) {
        el.chatInputCard?.classList.remove('drag-over');
    }
}

function getComposerContext() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('Choose an agent and a topic first.', 'warning');
        return null;
    }

    return {
        agentId: state.currentSelectedItem.id,
        topicId: state.currentTopicId,
    };
}

function summarizeAttachmentErrors(results) {
    const failures = results.filter((item) => item?.error);
    if (failures.length === 0) return;

    const names = failures.map((item) => item.name || 'Unknown file').join(', ');
    ui.showToastNotification(`Some attachments failed to import: ${names}`, 'warning', 4500);
}

function appendStoredAttachments(attachments) {
    if (attachments.length === 0) return;
    state.pendingAttachments.push(...attachments.map(normalizeStoredAttachment).filter(Boolean));
    refreshAttachmentPreview();
}

function inferExtensionFromType(type = '') {
    if (!type.includes('/')) return 'bin';
    const subtype = type.split('/')[1] || 'bin';
    if (subtype === 'jpeg') return 'jpg';
    return subtype.replace(/[^a-z0-9]/gi, '') || 'bin';
}

async function fileToTransferPayload(file, index = 0) {
    const fileName = file.name || `attachment_${Date.now()}_${index}.${inferExtensionFromType(file.type)}`;
    if (file.path) {
        return {
            name: fileName,
            path: file.path,
            type: file.type || 'application/octet-stream',
        };
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    return {
        name: fileName,
        data: buffer,
        type: file.type || 'application/octet-stream',
    };
}

async function addFilesToComposer(fileList, source = 'drop') {
    const context = getComposerContext();
    if (!context) return;

    if (source === 'picker') {
        const result = await chatAPI.selectFilesToSend(context.agentId, context.topicId);
        if (!result?.success) {
            if (result?.error) {
                ui.showToastNotification(`Failed to add attachments: ${result.error}`, 'error');
            }
            return;
        }

        const attachments = Array.isArray(result.attachments)
            ? result.attachments.filter((item) => !item?.error)
            : [];
        appendStoredAttachments(attachments);
        summarizeAttachmentErrors(Array.isArray(result.attachments) ? result.attachments : []);
        return;
    }

    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const payload = await Promise.all(files.map((file, index) => fileToTransferPayload(file, index)));
    const result = await chatAPI.handleFileDrop(context.agentId, context.topicId, payload);
    const entries = Array.isArray(result) ? result : [];
    const attachments = entries
        .filter((item) => item?.success && item.attachment)
        .map((item) => item.attachment);

    appendStoredAttachments(attachments);
    summarizeAttachmentErrors(entries);
}

function materializeAttachments() {
    return normalizeAttachmentList(state.pendingAttachments);
}
async function buildApiMessages() {
    const activePrompt = await chatAPI.getActiveSystemPrompt(state.currentSelectedItem.id).catch(() => ({ success: false, systemPrompt: '' }));
    const livePrompt = state.promptModule
        ? await state.promptModule.getPrompt().catch(() => '')
        : (document.getElementById('litePromptFallback')?.value || '').trim();
    const systemPrompt = livePrompt || (activePrompt?.success ? activePrompt.systemPrompt : '');
    const messages = [];

    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }

    for (const message of state.currentChatHistory.filter((item) => !item.isThinking)) {
        if (message.role !== 'user') {
            messages.push({ role: message.role, content: message.content, name: message.name });
            continue;
        }

        if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
            messages.push({ role: 'user', content: message.content });
            continue;
        }

        const parts = [];
        if (message.content?.trim()) {
            parts.push({ type: 'text', text: message.content });
        }

        for (const attachment of normalizeAttachmentList(message.attachments)) {
            if (attachment.type?.startsWith('image/')) {
                const fileResult = await chatAPI.getFileAsBase64(attachment.internalPath || attachment.src).catch(() => null);
                const base64Frames = Array.isArray(fileResult?.base64Frames) ? fileResult.base64Frames : [];

                if (base64Frames.length > 0) {
                    base64Frames.forEach((frame) => {
                        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                    });
                    continue;
                }

                if (attachment.src?.startsWith('data:')) {
                    parts.push({ type: 'image_url', image_url: { url: attachment.src } });
                    continue;
                }

                parts.push({ type: 'text', text: `Image attachment: ${attachment.name}` });
                continue;
            }

            if (Array.isArray(attachment.imageFrames) && attachment.imageFrames.length > 0) {
                attachment.imageFrames.forEach((frame) => {
                    parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                });
                if (attachment.extractedText) {
                    parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
                }
            } else if (attachment.extractedText) {
                parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
            } else {
                parts.push({ type: 'text', text: `Attachment reference: ${attachment.name}` });
            }
        }

        messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
    }

    return messages;
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

async function persistHistory() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) return;
    await chatAPI.saveChatHistory(state.currentSelectedItem.id, state.currentTopicId, state.currentChatHistory);
}

function updateSendButtonState() {
    const interrupting = Boolean(state.activeRequestId);
    el.sendMessageBtn.dataset.mode = interrupting ? 'interrupt' : 'send';
    el.sendMessageBtn.classList.toggle('interrupt-mode', interrupting);
    el.sendMessageBtn.innerHTML = interrupting ? INTERRUPT_SEND_BUTTON_HTML : DEFAULT_SEND_BUTTON_HTML;
    el.sendMessageBtn.title = interrupting ? '中止回复' : '发送消息';
    syncComposerAvailability();
}

window.sendMessage = async (prefillText) => {
    if (typeof prefillText === 'string') {
        el.messageInput.value = prefillText;
        ui.autoResizeTextarea(el.messageInput);
    }
    return handleSend();
};

window.__liteDebugState = () => ({
    currentSelectedItemId: state.currentSelectedItem.id,
    currentTopicId: state.currentTopicId,
    activeRequestId: state.activeRequestId,
    agentCount: state.agents.length,
    topicCount: state.topics.length,
});

window.updateSendButtonState = updateSendButtonState;
window.setLiteActiveRequestId = (requestId = null) => {
    state.activeRequestId = requestId || null;
    updateSendButtonState();
};

async function handleSend() {
    if (state.activeRequestId) {
        const requestId = state.activeRequestId;
        const result = await interruptRequest(requestId);
        if (!result?.success) {
            await messageRenderer.finalizeStreamedMessage(requestId, 'error', buildTopicContext(), {
                error: result?.error || 'Interrupt failed',
            });
            ui.showToastNotification(result?.error || 'Interrupt failed', 'error');
            state.activeRequestId = null;
            updateSendButtonState();
        } else if (result.warning) {
            ui.showToastNotification(result.warning, 'warning');
        }
        return;
    }

    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('Choose an agent and a topic first.', 'warning');
        return;
    }

    const text = el.messageInput.value.trim();
    if (!text && state.pendingAttachments.length === 0) {
        return;
    }

    const attachments = await materializeAttachments();
    const userMessage = {
        id: makeId('user'),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        attachments,
    };

    state.currentChatHistory.push(userMessage);
    await persistHistory();
    await messageRenderer.renderMessage(userMessage, false, true);

    el.messageInput.value = '';
    ui.autoResizeTextarea(el.messageInput);
    state.pendingAttachments = [];
    refreshAttachmentPreview();

    const assistantMessage = {
        id: makeId('assistant'),
        role: 'assistant',
        name: state.currentSelectedItem.name,
        agentId: state.currentSelectedItem.id,
        avatarUrl: state.currentSelectedItem.avatarUrl,
        avatarColor: state.currentSelectedItem.config?.avatarCalculatedColor || null,
        content: 'Thinking',
        timestamp: Date.now(),
        isThinking: true,
        topicId: state.currentTopicId,
    };

    state.currentChatHistory.push(assistantMessage);
    await persistHistory();
    messageRenderer.startStreamingMessage(assistantMessage);

    const modelConfig = {
        model: state.currentSelectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
        temperature: Number(state.currentSelectedItem.config?.temperature ?? 0.7),
        max_tokens: Number(state.currentSelectedItem.config?.maxOutputTokens ?? 1000),
        top_p: state.currentSelectedItem.config?.top_p,
        top_k: state.currentSelectedItem.config?.top_k,
        stream: state.currentSelectedItem.config?.streamOutput !== false,
    };

    state.activeRequestId = assistantMessage.id;
    updateSendButtonState();

    const response = await chatAPI.sendToVCP({
        requestId: assistantMessage.id,
        endpoint: state.settings.vcpServerUrl,
        apiKey: state.settings.vcpApiKey,
        messages: await buildApiMessages(),
        modelConfig,
        context: buildTopicContext(),
    });

    if (response?.error) {
        await messageRenderer.finalizeStreamedMessage(assistantMessage.id, 'error', buildTopicContext(), {
            error: response.error,
        });
        state.activeRequestId = null;
        updateSendButtonState();
        ui.showToastNotification(`Request failed: ${response.error}`, 'error');
        return;
    }

    if (!modelConfig.stream && response?.response) {
        const content = response.response?.choices?.[0]?.message?.content || '';
        const assistantEntry = state.currentChatHistory.find((item) => item.id === assistantMessage.id);
        if (assistantEntry) {
            assistantEntry.isThinking = false;
            assistantEntry.content = content;
        }
        await persistHistory();
        await messageRenderer.finalizeStreamedMessage(assistantMessage.id, 'completed', buildTopicContext(), {
            fullResponse: content,
        });
        state.activeRequestId = null;
        updateSendButtonState();
    }
}
async function handleStreamEvent(eventData) {
    const {
        type,
        requestId,
        context,
        chunk,
        error,
        partialResponse,
        fullResponse,
        finishReason,
        interrupted,
        timedOut,
    } = eventData || {};
    if (!requestId) return;

    if (type === 'data') {
        messageRenderer.appendStreamChunk(requestId, chunk, context);
        return;
    }

    if (type === 'end') {
        const resolvedFinishReason = finishReason || (timedOut ? 'timed_out' : interrupted ? 'cancelled_by_user' : 'completed');
        await messageRenderer.finalizeStreamedMessage(requestId, resolvedFinishReason, context, {
            fullResponse,
            error: error || (timedOut ? 'Request timed out.' : ''),
        });
        state.activeRequestId = null;
        updateSendButtonState();
        await persistHistory();
        await loadTopics();
        await loadAgents();
        return;
    }

    if (type === 'error') {
        await messageRenderer.finalizeStreamedMessage(requestId, 'error', context, {
            fullResponse: partialResponse || fullResponse,
            error,
        });
        state.activeRequestId = null;
        updateSendButtonState();
        await persistHistory();
        ui.showToastNotification(error || 'Streaming error', timedOut ? 'warning' : 'error');
    }
}

function buildMarkdownExport() {
    return state.currentChatHistory.map((message) => {
        const title = message.role === 'assistant'
            ? (message.name || state.currentSelectedItem.name || 'Assistant')
            : message.role === 'user'
                ? (state.settings.userName || 'User')
                : 'System';
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
        const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
            ? `\n\nAttachments:\n${message.attachments.map((item) => `- ${item.name}: ${item.internalPath || item.src || ''}`).join('\n')}`
            : '';
        return `## ${title}\n\n${content}${attachments}`;
    }).join('\n\n---\n\n');
}

async function exportCurrentTopic() {
    if (!state.currentTopicId) return;
    const topic = state.topics.find((item) => item.id === state.currentTopicId);
    const result = await chatAPI.exportTopicAsMarkdown({
        topicName: topic?.name || state.currentTopicId,
        markdownContent: buildMarkdownExport(),
    });
    if (!result?.success) {
        ui.showToastNotification(result?.error || 'Export failed', 'error');
        return;
    }
    ui.showToastNotification('Topic exported.', 'success');
}

async function createAgent() {
    const name = await ui.showPromptDialog({
        title: 'New Agent',
        message: 'Create a new assistant in Lite.',
        placeholder: 'Agent name',
        confirmText: 'Create',
        cancelText: 'Cancel',
    });
    if (!name) return;
    const result = await chatAPI.createAgent(name.trim(), null);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    await loadAgents();
    await selectAgent(result.agentId);
}

async function createTopic() {
    if (!state.currentSelectedItem.id) {
        ui.showToastNotification('Choose an agent first.', 'warning');
        return;
    }
    const name = await ui.showPromptDialog({
        title: 'New Topic',
        message: `Create a new topic for ${state.currentSelectedItem.name || state.currentSelectedItem.id}.`,
        placeholder: 'Topic name',
        defaultValue: 'New Topic',
        confirmText: 'Create',
        cancelText: 'Cancel',
    });
    if (!name) return;
    const result = await chatAPI.createNewTopicForAgent(state.currentSelectedItem.id, name || '', false, true);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    await loadTopics();
    await selectTopic(result.topicId);
}

async function deleteCurrentAgent() {
    if (!state.currentSelectedItem.id) return;
    const confirmed = await ui.showConfirmDialog(
        `Delete agent ${state.currentSelectedItem.name || state.currentSelectedItem.id}?`,
        'Delete Agent',
        'Delete',
        'Cancel',
        true
    );
    if (!confirmed) return;
    const result = await chatAPI.deleteAgent(state.currentSelectedItem.id);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    state.currentSelectedItem = { id: null, type: 'agent', name: null, avatarUrl: null, config: null };
    state.currentTopicId = null;
    state.currentChatHistory = [];
    state.pendingAttachments = [];
    el.currentChatAgentName.textContent = 'Select an agent';
    setPromptVisible(false);
    await loadAgents();
    renderTopics();
    refreshAttachmentPreview();
    await renderCurrentHistory();
    syncComposerAvailability();
}

function wireEvents() {
    el.agentSearchInput.addEventListener('input', filterAgents);
    el.topicSearchInput.addEventListener('input', filterTopics);
    el.createNewAgentBtn.addEventListener('click', createAgent);
    el.quickNewTopicBtn.addEventListener('click', createTopic);
    el.composerQuickNewTopicBtn.addEventListener('click', createTopic);
    el.exportTopicBtn.addEventListener('click', exportCurrentTopic);
    el.currentAgentSettingsBtn.addEventListener('click', () => el.settingsPanel.classList.toggle('settings-panel--collapsed'));
    el.globalSettingsBtn.addEventListener('click', () => el.settingsPanel.classList.remove('settings-panel--collapsed'));
    el.saveGlobalSettingsBtn.addEventListener('click', saveGlobalSettings);
    el.saveAgentSettingsBtn.addEventListener('click', saveAgentSettings);
    el.deleteAgentBtn.addEventListener('click', deleteCurrentAgent);

    el.attachFileBtn.addEventListener('click', async () => {
        await addFilesToComposer([], 'picker');
    });

    el.messageInput.addEventListener('keydown', async (event) => {
        if (event.defaultPrevented || event.isComposing) {
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            await handleSend();
        }
    });
    el.sendMessageBtn.addEventListener('click', handleSend);
    el.emoticonTriggerBtn.addEventListener('click', () => {
        if (el.emoticonTriggerBtn.disabled || !window.emoticonManager) return;
        window.emoticonManager.togglePanel(el.emoticonTriggerBtn, el.messageInput);
    });
    el.agentAvatarInput.addEventListener('change', () => {
        const file = el.agentAvatarInput.files?.[0];
        if (!file) return;
        el.agentAvatarPreview.src = file.path ? `file://${file.path.replace(/\\/g, '/')}` : URL.createObjectURL(file);
    });

    document.querySelectorAll('input[name="themeMode"]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) {
                chatAPI.setThemeMode(input.value);
            }
        });
    });

    el.themeToggleBtn.addEventListener('click', () => {
        const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        chatAPI.setTheme(nextTheme);
    });

    el.minimizeBtn.addEventListener('click', () => chatAPI.minimizeWindow());
    el.maximizeBtn.addEventListener('click', () => chatAPI.maximizeWindow());
    el.closeBtn.addEventListener('click', () => chatAPI.closeWindow());
}

function initMessageRenderer() {
    initMarked();
    initializeInterruptHandler(chatAPI);

    messageRenderer.initializeMessageRenderer({
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
}

async function initInputFeatures() {
    if (window.emoticonManager?.initialize) {
        await window.emoticonManager.initialize({
            emoticonPanel: el.emoticonPanel,
            messageInput: el.messageInput,
        });
    }

    initializeInputEnhancer({
        messageInput: el.messageInput,
        dropTargetElement: el.chatInputCard,
        electronAPI: chatAPI,
        electronPath: window.electronPath,
        autoResizeTextarea: ui.autoResizeTextarea,
        appendAttachments: appendStoredAttachments,
        getCurrentAgentId: () => state.currentSelectedItem.id,
        getCurrentTopicId: () => state.currentTopicId,
        showToast: (message, type = 'info', duration = 3000) => ui.showToastNotification(message, type, duration),
    });
}

async function bootstrap() {
    if (!chatAPI) {
        throw new Error('Preload bridge missing.');
    }

    initMessageRenderer();
    await initInputFeatures();
    await loadSettings();

    const theme = await chatAPI.getCurrentTheme().catch(() => 'light');
    applyTheme(theme || 'light');

    chatAPI.onThemeUpdated((nextTheme) => applyTheme(nextTheme));
    chatAPI.onVCPStreamEvent(handleStreamEvent);
    chatAPI.onHistoryFileUpdated(async (payload) => {
        if (payload?.agentId === state.currentSelectedItem.id && payload?.topicId === state.currentTopicId) {
            await selectTopic(state.currentTopicId, { fromWatcher: true });
        }
    });

    wireEvents();
    await loadAgents();

    const lastOpenItemId = state.settings.lastOpenItemId;
    if (lastOpenItemId && state.agents.some((agent) => agent.id === lastOpenItemId)) {
        await selectAgent(lastOpenItemId);
        if (state.settings.lastOpenTopicId) {
            await selectTopic(state.settings.lastOpenTopicId);
        }
    } else if (state.agents.length > 0) {
        await selectAgent(state.agents[0].id);
    } else {
        setPromptVisible(false);
        await renderCurrentHistory();
    }

    ui.autoResizeTextarea(el.messageInput);
    updateSendButtonState();
}

bootstrap().catch((error) => {
    console.error('[LiteRenderer] bootstrap failed:', error);
    ui?.showToastNotification?.(error.message || 'Bootstrap failed', 'error', 5000);
});

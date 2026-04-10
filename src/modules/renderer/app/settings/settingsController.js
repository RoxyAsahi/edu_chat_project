const SETTINGS_MODAL_META = Object.freeze({
    global: {
        title: '全局设置',
        subtitle: '管理账号、VCP 连接、渲染样式与主题外观。',
    },
    agent: {
        title: '智能体设置',
        subtitle: '调整当前学科入口的模型、提示词、输出参数与聊天样式。',
    },
    'knowledge-base': {
        title: '来源管理',
        subtitle: '统一维护 Source 模型、来源库文档与调试工具。',
    },
});

function createSettingsController(deps = {}) {
    const state = deps.state;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const messageRendererApi = deps.messageRendererApi;
    const normalizeStoredLayoutWidth = deps.normalizeStoredLayoutWidth;
    const normalizeStoredLayoutHeight = deps.normalizeStoredLayoutHeight;
    const applyLayoutWidths = deps.applyLayoutWidths;
    const applyLeftSidebarHeights = deps.applyLeftSidebarHeights;
    let settingsModalTrigger = null;

    function applyTheme(theme) {
        documentObj.body.classList.toggle('dark-theme', theme === 'dark');
        documentObj.body.classList.toggle('light-theme', theme !== 'dark');
    }

    function applyRendererSettings() {
        const chatFonts = {
            system: '"Segoe UI", "PingFang SC", sans-serif',
            serif: 'Georgia, "Noto Serif SC", serif',
            monospace: '"Cascadia Code", "Consolas", monospace',
            consolas: '"Cascadia Code", "Consolas", monospace',
        };

        documentObj.documentElement.style.setProperty('--lite-chat-max-width', `${Number(state.settings.chatBubbleMaxWidthWideDefault || 92)}%`);
        documentObj.documentElement.style.setProperty('--lite-chat-font', chatFonts[state.settings.chatFontPreset] || chatFonts.system);
        documentObj.documentElement.style.setProperty('--lite-code-font', chatFonts[state.settings.chatCodeFontPreset] || chatFonts.consolas);
        documentObj.body.classList.toggle('wide-chat-layout', state.settings.enableWideChatLayout === true);
    }

    function syncGlobalSettingsForm() {
        el.userNameInput.value = state.settings.userName || '';
        el.vcpServerUrl.value = state.settings.vcpServerUrl || '';
        el.vcpApiKey.value = state.settings.vcpApiKey || '';
        el.kbBaseUrl.value = state.settings.kbBaseUrl || '';
        el.kbApiKey.value = state.settings.kbApiKey || '';
        el.kbEmbeddingModel.value = state.settings.kbEmbeddingModel || '';
        el.kbUseRerank.checked = state.settings.kbUseRerank !== false;
        el.kbRerankModel.value = state.settings.kbRerankModel || 'BAAI/bge-reranker-v2-m3';
        el.kbTopK.value = state.settings.kbTopK ?? 6;
        el.kbCandidateTopK.value = state.settings.kbCandidateTopK ?? 20;
        el.kbScoreThreshold.value = state.settings.kbScoreThreshold ?? 0.25;
        el.chatFontPreset.value = state.settings.chatFontPreset || 'system';
        el.chatCodeFontPreset.value = state.settings.chatCodeFontPreset || 'consolas';
        el.chatBubbleMaxWidthWideDefault.value = state.settings.chatBubbleMaxWidthWideDefault ?? 92;
        el.enableAgentBubbleTheme.checked = state.settings.enableAgentBubbleTheme === true;
        el.enableWideChatLayout.checked = state.settings.enableWideChatLayout !== false;
        el.enableSmoothStreaming.checked = state.settings.enableSmoothStreaming === true;

        const themeMode = state.settings.currentThemeMode || 'system';
        const themeInput = documentObj.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
        if (themeInput) {
            themeInput.checked = true;
        }
    }

    async function loadSettings() {
        const loaded = await chatAPI.loadSettings();
        state.settings = { ...state.settings, ...(loaded || {}) };
        windowObj.globalSettings = state.settings;
        syncGlobalSettingsForm();
        applyRendererSettings();
        if (state.layoutInitialized) {
            state.layoutLeftWidth = normalizeStoredLayoutWidth(state.settings.layoutLeftWidth, state.layoutLeftWidth);
            state.layoutRightWidth = normalizeStoredLayoutWidth(state.settings.layoutRightWidth, state.layoutRightWidth);
            state.layoutLeftTopHeight = normalizeStoredLayoutHeight(state.settings.layoutLeftTopHeight, state.layoutLeftTopHeight);
            applyLayoutWidths();
            applyLeftSidebarHeights();
        }
        messageRendererApi?.setUserAvatar(state.settings.userAvatarUrl || '../assets/default_user_avatar.png');
        messageRendererApi?.setUserAvatarColor(state.settings.userAvatarCalculatedColor || null);
    }

    function switchSettingsModalSection(section) {
        const nextSection = Object.prototype.hasOwnProperty.call(SETTINGS_MODAL_META, section)
            ? section
            : 'global';
        state.settingsModalSection = nextSection;

        el.settingsNavButtons?.forEach((button) => {
            const active = button.dataset.settingsSectionButton === nextSection;
            button.classList.toggle('settings-modal__nav-button--active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });

        const sections = [
            ['global', el.settingsModalSectionGlobal],
            ['agent', el.settingsModalSectionAgent],
            ['knowledge-base', el.settingsModalSectionKnowledgeBase],
        ];
        sections.forEach(([name, node]) => {
            const active = name === nextSection;
            node?.classList.toggle('hidden', !active);
            node?.classList.toggle('settings-modal__section--active', active);
        });

        const meta = SETTINGS_MODAL_META[nextSection];
        if (el.settingsModalTitle) {
            el.settingsModalTitle.textContent = meta.title;
        }
        if (el.settingsModalSubtitle) {
            el.settingsModalSubtitle.textContent = meta.subtitle;
        }
        el.settingsModalFooter?.classList.toggle('hidden', nextSection === 'agent');
    }

    function openSettingsModal(section = 'global', trigger = null) {
        if (trigger instanceof HTMLElement) {
            settingsModalTrigger = trigger;
        }
        switchSettingsModalSection(section);
        el.settingsModal?.classList.remove('hidden');
        el.settingsModal?.classList.add('settings-modal--open');
        el.settingsModal?.setAttribute('aria-hidden', 'false');
        documentObj.body.classList.add('settings-modal-open');
        el.settingsModalCloseBtn?.focus();
    }

    function closeSettingsModal() {
        el.settingsModal?.classList.add('hidden');
        el.settingsModal?.classList.remove('settings-modal--open');
        el.settingsModal?.setAttribute('aria-hidden', 'true');
        documentObj.body.classList.remove('settings-modal-open');
        if (settingsModalTrigger instanceof HTMLElement && documentObj.body.contains(settingsModalTrigger)) {
            settingsModalTrigger.focus();
        }
        settingsModalTrigger = null;
    }

    return {
        applyTheme,
        applyRendererSettings,
        syncGlobalSettingsForm,
        loadSettings,
        switchSettingsModalSection,
        openSettingsModal,
        closeSettingsModal,
    };
}

export {
    SETTINGS_MODAL_META,
    createSettingsController,
};

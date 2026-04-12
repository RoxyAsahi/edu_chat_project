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
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const messageRendererApi = deps.messageRendererApi;
    const syncLayoutSettings = deps.syncLayoutSettings || (() => {});
    const resolvePromptText = deps.resolvePromptText || (async () => '');
    const reloadSelectedAgent = deps.reloadSelectedAgent || (async () => {});
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    let settingsModalTrigger = null;

    function getSettingsSlice() {
        return store.getState().settings;
    }

    function getGlobalSettings() {
        return getSettingsSlice().settings;
    }

    function patchSettingsSlice(patch) {
        return store.patchState('settings', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    function patchGlobalSettings(patch) {
        return patchSettingsSlice((current, rootState) => ({
            settings: {
                ...current.settings,
                ...(typeof patch === 'function' ? patch(current.settings, rootState) : patch),
            },
        }));
    }

    function applyTheme(theme) {
        documentObj.body.classList.toggle('dark-theme', theme === 'dark');
        documentObj.body.classList.toggle('light-theme', theme !== 'dark');
    }

    function applyRendererSettings() {
        const settings = getGlobalSettings();
        const chatFonts = {
            system: '"Segoe UI", "PingFang SC", sans-serif',
            serif: 'Georgia, "Noto Serif SC", serif',
            monospace: '"Cascadia Code", "Consolas", monospace',
            consolas: '"Cascadia Code", "Consolas", monospace',
        };

        documentObj.documentElement.style.setProperty('--lite-chat-max-width', `${Number(settings.chatBubbleMaxWidthWideDefault || 92)}%`);
        documentObj.documentElement.style.setProperty('--lite-chat-font', chatFonts[settings.chatFontPreset] || chatFonts.system);
        documentObj.documentElement.style.setProperty('--lite-code-font', chatFonts[settings.chatCodeFontPreset] || chatFonts.consolas);
        documentObj.body.classList.toggle('wide-chat-layout', settings.enableWideChatLayout === true);
    }

    function syncGlobalSettingsForm() {
        const settings = getGlobalSettings();
        el.userNameInput.value = settings.userName || '';
        el.vcpServerUrl.value = settings.vcpServerUrl || '';
        el.vcpApiKey.value = settings.vcpApiKey || '';
        el.kbBaseUrl.value = settings.kbBaseUrl || '';
        el.kbApiKey.value = settings.kbApiKey || '';
        el.kbEmbeddingModel.value = settings.kbEmbeddingModel || '';
        el.kbUseRerank.checked = settings.kbUseRerank !== false;
        el.kbRerankModel.value = settings.kbRerankModel || 'BAAI/bge-reranker-v2-m3';
        el.kbTopK.value = settings.kbTopK ?? 6;
        el.kbCandidateTopK.value = settings.kbCandidateTopK ?? 20;
        el.kbScoreThreshold.value = settings.kbScoreThreshold ?? 0.25;
        el.chatFontPreset.value = settings.chatFontPreset || 'system';
        el.chatCodeFontPreset.value = settings.chatCodeFontPreset || 'consolas';
        el.chatBubbleMaxWidthWideDefault.value = settings.chatBubbleMaxWidthWideDefault ?? 92;
        el.enableAgentBubbleTheme.checked = settings.enableAgentBubbleTheme === true;
        el.enableWideChatLayout.checked = settings.enableWideChatLayout !== false;
        el.enableSmoothStreaming.checked = settings.enableSmoothStreaming === true;

        const themeMode = settings.currentThemeMode || 'system';
        const themeInput = documentObj.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
        if (themeInput) {
            themeInput.checked = true;
        }
    }

    async function loadSettings() {
        const loaded = await chatAPI.loadSettings();
        patchGlobalSettings(loaded || {});
        windowObj.globalSettings = getGlobalSettings();
        syncGlobalSettingsForm();
        applyRendererSettings();
        syncLayoutSettings(getGlobalSettings());
        messageRendererApi?.setUserAvatar(getGlobalSettings().userAvatarUrl || '../assets/default_user_avatar.png');
        messageRendererApi?.setUserAvatarColor(getGlobalSettings().userAvatarCalculatedColor || null);
    }

    async function saveGlobalSettings() {
        const themeMode = documentObj.querySelector('input[name="themeMode"]:checked')?.value || 'system';
        const patch = {
            userName: el.userNameInput.value.trim() || 'User',
            vcpServerUrl: el.vcpServerUrl.value.trim(),
            vcpApiKey: el.vcpApiKey.value.trim(),
            kbBaseUrl: el.kbBaseUrl.value.trim(),
            kbApiKey: el.kbApiKey.value.trim(),
            kbEmbeddingModel: el.kbEmbeddingModel.value.trim(),
            kbUseRerank: el.kbUseRerank.checked,
            kbRerankModel: el.kbRerankModel.value.trim(),
            kbTopK: Number(el.kbTopK.value || 6),
            kbCandidateTopK: Number(el.kbCandidateTopK.value || 20),
            kbScoreThreshold: Number(el.kbScoreThreshold.value || 0.25),
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
            ui.showToastNotification(`保存设置失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        patchGlobalSettings(patch);
        windowObj.globalSettings = getGlobalSettings();
        applyRendererSettings();
        chatAPI.setThemeMode(themeMode);
        windowObj.emoticonManager?.reload?.();
        ui.showToastNotification('全局设置已保存。', 'success');
    }

    function switchSettingsModalSection(section) {
        const nextSection = Object.prototype.hasOwnProperty.call(SETTINGS_MODAL_META, section)
            ? section
            : 'global';
        patchSettingsSlice({
            settingsModalSection: nextSection,
        });

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

    function setPromptVisible(visible) {
        el.selectAgentPromptForSettings?.classList.toggle('hidden', visible);
        el.agentSettingsContainer?.classList.toggle('hidden', !visible);
    }

    async function saveAgentSettings() {
        const currentSelectedItem = getCurrentSelectedItem();
        if (!currentSelectedItem.id) {
            return;
        }

        const promptText = await resolvePromptText();
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
            disableCustomColors: el.disableCustomColors.checked,
            useThemeColorsInChat: el.useThemeColorsInChat.checked,
            promptMode: 'original',
            originalSystemPrompt: promptText,
            systemPrompt: promptText,
        };

        const saveResult = await chatAPI.saveAgentConfig(currentSelectedItem.id, patch);
        if (saveResult?.error) {
            ui.showToastNotification(`保存智能体失败：${saveResult.error}`, 'error');
            return;
        }

        const avatarFile = el.agentAvatarInput.files?.[0];
        if (avatarFile) {
            const buffer = await avatarFile.arrayBuffer();
            await chatAPI.saveAvatar(currentSelectedItem.id, {
                name: avatarFile.name,
                type: avatarFile.type,
                buffer,
            });
            el.agentAvatarInput.value = '';
        }

        ui.showToastNotification('智能体设置已保存。', 'success');
        await reloadSelectedAgent(currentSelectedItem.id);
    }

    function bindEvents() {
        el.currentAgentSettingsBtn?.addEventListener('click', () => {
            openSettingsModal('agent', el.currentAgentSettingsBtn);
        });
        el.globalSettingsBtn?.addEventListener('click', () => {
            openSettingsModal('global', el.globalSettingsBtn);
        });
        el.settingsModalCloseBtn?.addEventListener('click', closeSettingsModal);
        el.settingsModalBackdrop?.addEventListener('click', closeSettingsModal);
        el.settingsNavButtons?.forEach((button) => {
            button.addEventListener('click', () => {
                switchSettingsModalSection(button.dataset.settingsSectionButton || 'global');
            });
        });
        el.saveGlobalSettingsBtn?.addEventListener('click', () => {
            void saveGlobalSettings();
        });
        el.saveAgentSettingsBtn?.addEventListener('click', () => {
            void saveAgentSettings();
        });

        documentObj.querySelectorAll('input[name="themeMode"]').forEach((input) => {
            input.addEventListener('change', () => {
                if (input.checked) {
                    chatAPI.setThemeMode(input.value);
                }
            });
        });

        el.themeToggleBtn?.addEventListener('click', () => {
            const nextTheme = documentObj.body.classList.contains('dark-theme') ? 'light' : 'dark';
            chatAPI.setTheme(nextTheme);
        });
    }

    return {
        applyTheme,
        applyRendererSettings,
        syncGlobalSettingsForm,
        loadSettings,
        saveGlobalSettings,
        switchSettingsModalSection,
        openSettingsModal,
        closeSettingsModal,
        setPromptVisible,
        saveAgentSettings,
        bindEvents,
    };
}

export {
    SETTINGS_MODAL_META,
    createSettingsController,
};

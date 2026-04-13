const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadSettingsControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/settings/settingsController.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createStore(initialSettings = {}) {
    const state = {
        settings: {
            settings: { ...initialSettings },
            settingsModalSection: 'global',
            promptModule: null,
        },
    };

    return {
        getState: () => state,
        patchState(slice, patch) {
            const currentSlice = state[slice];
            state[slice] = typeof patch === 'function'
                ? patch(currentSlice, state)
                : { ...currentSlice, ...patch };
            return state[slice];
        },
    };
}

function createDom() {
    return new JSDOM(`
        <body>
          <input id="userNameInput" />
          <input id="vcpServerUrl" />
          <input id="vcpApiKey" />
          <input id="kbBaseUrl" />
          <input id="kbApiKey" />
          <input id="kbEmbeddingModel" />
          <input id="kbUseRerank" type="checkbox" />
          <input id="kbRerankModel" />
          <input id="kbTopK" />
          <input id="kbCandidateTopK" />
          <input id="kbScoreThreshold" />
          <select id="chatFontPreset"><option value="system">system</option></select>
          <select id="chatCodeFontPreset"><option value="consolas">consolas</option></select>
          <input id="chatBubbleMaxWidthWideDefault" />
          <input id="enableAgentBubbleTheme" type="checkbox" />
          <textarea id="agentBubbleThemePrompt"></textarea>
          <input id="enableWideChatLayout" type="checkbox" />
          <input id="enableSmoothStreaming" type="checkbox" />
          <input type="radio" name="themeMode" value="light" />
          <input type="radio" name="themeMode" value="dark" />
          <input type="radio" name="themeMode" value="system" checked />
          <button id="saveGlobalSettingsBtn" type="button">save</button>
        </body>
    `, { url: 'http://localhost' });
}

test('settingsController loads, toggles, and saves the bubble theme prompt field', async (t) => {
    const { createSettingsController } = await loadSettingsControllerModule();
    const dom = createDom();
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousHTMLElement = global.HTMLElement;
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    t.after(() => {
        global.window = previousWindow;
        global.document = previousDocument;
        global.HTMLElement = previousHTMLElement;
        dom.window.close();
    });

    let savedPatch = null;
    let savedThemeMode = null;
    let reloadCount = 0;
    const toasts = [];
    const store = createStore({
        currentThemeMode: 'system',
    });
    const documentObj = dom.window.document;
    const el = {
        userNameInput: documentObj.getElementById('userNameInput'),
        vcpServerUrl: documentObj.getElementById('vcpServerUrl'),
        vcpApiKey: documentObj.getElementById('vcpApiKey'),
        kbBaseUrl: documentObj.getElementById('kbBaseUrl'),
        kbApiKey: documentObj.getElementById('kbApiKey'),
        kbEmbeddingModel: documentObj.getElementById('kbEmbeddingModel'),
        kbUseRerank: documentObj.getElementById('kbUseRerank'),
        kbRerankModel: documentObj.getElementById('kbRerankModel'),
        kbTopK: documentObj.getElementById('kbTopK'),
        kbCandidateTopK: documentObj.getElementById('kbCandidateTopK'),
        kbScoreThreshold: documentObj.getElementById('kbScoreThreshold'),
        chatFontPreset: documentObj.getElementById('chatFontPreset'),
        chatCodeFontPreset: documentObj.getElementById('chatCodeFontPreset'),
        chatBubbleMaxWidthWideDefault: documentObj.getElementById('chatBubbleMaxWidthWideDefault'),
        enableAgentBubbleTheme: documentObj.getElementById('enableAgentBubbleTheme'),
        agentBubbleThemePrompt: documentObj.getElementById('agentBubbleThemePrompt'),
        enableWideChatLayout: documentObj.getElementById('enableWideChatLayout'),
        enableSmoothStreaming: documentObj.getElementById('enableSmoothStreaming'),
        saveGlobalSettingsBtn: documentObj.getElementById('saveGlobalSettingsBtn'),
        currentAgentSettingsBtn: null,
        globalSettingsBtn: null,
        settingsModalCloseBtn: null,
        settingsModalBackdrop: null,
        settingsNavButtons: [],
        saveAgentSettingsBtn: null,
        themeToggleBtn: null,
        settingsModalSectionGlobal: null,
        settingsModalSectionAgent: null,
        settingsModalSectionKnowledgeBase: null,
        settingsModalTitle: null,
        settingsModalSubtitle: null,
        settingsModalFooter: null,
        selectAgentPromptForSettings: null,
        agentSettingsContainer: null,
    };

    const controller = createSettingsController({
        store,
        el,
        chatAPI: {
            async loadSettings() {
                return {
                    userName: 'Alice',
                    kbUseRerank: true,
                    kbTopK: 6,
                    kbCandidateTopK: 20,
                    kbScoreThreshold: 0.25,
                    chatFontPreset: 'system',
                    chatCodeFontPreset: 'consolas',
                    chatBubbleMaxWidthWideDefault: 92,
                    enableAgentBubbleTheme: false,
                    agentBubbleThemePrompt: 'Custom bubble prompt: {{VarDivRender}}',
                    enableWideChatLayout: true,
                    enableSmoothStreaming: false,
                    currentThemeMode: 'dark',
                };
            },
            async saveSettings(patch) {
                savedPatch = patch;
                return { success: true };
            },
            setThemeMode(mode) {
                savedThemeMode = mode;
            },
        },
        ui: {
            showToastNotification(message, type) {
                toasts.push({ message, type });
            },
        },
        windowObj: {
            emoticonManager: {
                reload() {
                    reloadCount += 1;
                },
            },
        },
        documentObj,
        messageRendererApi: {
            setUserAvatar() {},
            setUserAvatarColor() {},
        },
        syncLayoutSettings() {},
    });

    await controller.loadSettings();
    controller.bindEvents();

    assert.equal(el.agentBubbleThemePrompt.value, 'Custom bubble prompt: {{VarDivRender}}');
    assert.equal(el.agentBubbleThemePrompt.readOnly, true);
    assert.equal(el.agentBubbleThemePrompt.classList.contains('settings-textarea--readonly'), true);

    el.enableAgentBubbleTheme.checked = true;
    el.enableAgentBubbleTheme.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(el.agentBubbleThemePrompt.readOnly, false);
    assert.equal(el.agentBubbleThemePrompt.classList.contains('settings-textarea--readonly'), false);

    el.agentBubbleThemePrompt.value = 'Editable prompt: {{VarDivRender}}';
    documentObj.querySelector('input[name="themeMode"][value="dark"]').checked = true;
    await controller.saveGlobalSettings();

    assert.ok(savedPatch);
    assert.equal(savedPatch.enableAgentBubbleTheme, true);
    assert.equal(savedPatch.agentBubbleThemePrompt, 'Editable prompt: {{VarDivRender}}');
    assert.equal(savedThemeMode, 'dark');
    assert.equal(reloadCount, 1);
    assert.deepEqual(toasts, [{ message: '全局设置已保存。', type: 'success' }]);
});

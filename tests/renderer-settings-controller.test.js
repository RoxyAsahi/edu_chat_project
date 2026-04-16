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
          <input id="defaultModelInput" />
          <input id="followUpDefaultModelInput" />
          <input id="topicTitleDefaultModelInput" />
          <input id="studentNameInput" />
          <input id="studyCityInput" />
          <input id="studyWorkspaceInput" />
          <input id="workEnvironmentInput" />
          <input id="studyTimezoneInput" />
          <input id="studyLogEnabledInput" type="checkbox" />
          <input id="studyLogEnablePromptVariablesInput" type="checkbox" />
          <input id="studyLogAutoInjectProtocolInput" type="checkbox" />
          <input id="studyLogMaxRoundsInput" />
          <input id="studyMemoryTopKInput" />
          <input id="studyMemoryFallbackTopKInput" />
          <textarea id="promptVariablesInput"></textarea>
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
          <input id="enableRenderingPromptInput" type="checkbox" />
          <input id="enableAdaptiveBubbleTipInput" type="checkbox" />
          <select id="chatFontPreset"><option value="system">system</option></select>
          <select id="chatCodeFontPreset"><option value="consolas">consolas</option></select>
          <input id="chatBubbleMaxWidthWideDefault" />
          <input id="enableAgentBubbleTheme" type="checkbox" />
          <textarea id="agentBubbleThemePrompt"></textarea>
          <textarea id="agentBubbleThemeResolvedPreview"></textarea>
          <div id="agentBubbleThemePreviewMeta"></div>
          <div id="agentBubbleThemePersistStatus"></div>
          <textarea id="renderingPromptInput"></textarea>
          <textarea id="adaptiveBubbleTipInput"></textarea>
          <textarea id="dailyNoteGuideInput"></textarea>
          <textarea id="followUpPromptTemplateInput"></textarea>
          <input id="enableTopicTitleGenerationInput" type="checkbox" />
          <textarea id="topicTitlePromptTemplateInput"></textarea>
          <div id="promptSegmentPreview"></div>
          <textarea id="finalSystemPromptPreview"></textarea>
          <div id="finalSystemPromptPreviewMeta"></div>
          <button id="refreshFinalSystemPromptPreviewBtn" type="button">preview</button>
          <input id="enableWideChatLayout" type="checkbox" />
          <input id="enableSmoothStreaming" type="checkbox" />
          <input type="radio" name="themeMode" value="light" />
          <input type="radio" name="themeMode" value="dark" />
          <input type="radio" name="themeMode" value="system" checked />
          <button id="saveGlobalSettingsBtn" type="button">save</button>

          <input id="editingAgentId" />
          <input id="agentNameInput" />
          <img id="agentAvatarPreview" />
          <input id="agentAvatarInput" type="file" />
          <input id="agentModel" />
          <textarea id="agentVcpAliasesInput"></textarea>
          <input id="agentVcpMaidInput" />
          <input id="agentTemperature" />
          <input id="agentContextTokenLimit" />
          <input id="agentMaxOutputTokens" />
          <input id="agentTopP" />
          <input id="agentTopK" />
          <input id="agentStreamOutputTrue" type="radio" name="agentStreamOutput" />
          <input id="agentStreamOutputFalse" type="radio" name="agentStreamOutput" />
          <input id="agentAvatarBorderColor" />
          <input id="agentAvatarBorderColorText" />
          <input id="agentNameTextColor" />
          <input id="agentNameTextColorText" />
          <input id="disableCustomColors" type="checkbox" />
          <input id="useThemeColorsInChat" type="checkbox" />
          <button id="saveAgentSettingsBtn" type="button">save-agent</button>
          <div id="selectAgentPromptForSettings"></div>
          <div id="agentSettingsContainer"></div>
        </body>
    `, { url: 'http://localhost' });
}

function createElementMap(documentObj) {
    return {
        userNameInput: documentObj.getElementById('userNameInput'),
        defaultModelInput: documentObj.getElementById('defaultModelInput'),
        followUpDefaultModelInput: documentObj.getElementById('followUpDefaultModelInput'),
        topicTitleDefaultModelInput: documentObj.getElementById('topicTitleDefaultModelInput'),
        studentNameInput: documentObj.getElementById('studentNameInput'),
        studyCityInput: documentObj.getElementById('studyCityInput'),
        studyWorkspaceInput: documentObj.getElementById('studyWorkspaceInput'),
        workEnvironmentInput: documentObj.getElementById('workEnvironmentInput'),
        studyTimezoneInput: documentObj.getElementById('studyTimezoneInput'),
        studyLogEnabledInput: documentObj.getElementById('studyLogEnabledInput'),
        studyLogEnablePromptVariablesInput: documentObj.getElementById('studyLogEnablePromptVariablesInput'),
        studyLogAutoInjectProtocolInput: documentObj.getElementById('studyLogAutoInjectProtocolInput'),
        studyLogMaxRoundsInput: documentObj.getElementById('studyLogMaxRoundsInput'),
        studyMemoryTopKInput: documentObj.getElementById('studyMemoryTopKInput'),
        studyMemoryFallbackTopKInput: documentObj.getElementById('studyMemoryFallbackTopKInput'),
        promptVariablesInput: documentObj.getElementById('promptVariablesInput'),
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
        enableRenderingPromptInput: documentObj.getElementById('enableRenderingPromptInput'),
        enableAdaptiveBubbleTipInput: documentObj.getElementById('enableAdaptiveBubbleTipInput'),
        chatFontPreset: documentObj.getElementById('chatFontPreset'),
        chatCodeFontPreset: documentObj.getElementById('chatCodeFontPreset'),
        chatBubbleMaxWidthWideDefault: documentObj.getElementById('chatBubbleMaxWidthWideDefault'),
        enableAgentBubbleTheme: documentObj.getElementById('enableAgentBubbleTheme'),
        agentBubbleThemePrompt: documentObj.getElementById('agentBubbleThemePrompt'),
        agentBubbleThemeResolvedPreview: documentObj.getElementById('agentBubbleThemeResolvedPreview'),
        agentBubbleThemePreviewMeta: documentObj.getElementById('agentBubbleThemePreviewMeta'),
        agentBubbleThemePersistStatus: documentObj.getElementById('agentBubbleThemePersistStatus'),
        renderingPromptInput: documentObj.getElementById('renderingPromptInput'),
        adaptiveBubbleTipInput: documentObj.getElementById('adaptiveBubbleTipInput'),
        dailyNoteGuideInput: documentObj.getElementById('dailyNoteGuideInput'),
        followUpPromptTemplateInput: documentObj.getElementById('followUpPromptTemplateInput'),
        enableTopicTitleGenerationInput: documentObj.getElementById('enableTopicTitleGenerationInput'),
        topicTitlePromptTemplateInput: documentObj.getElementById('topicTitlePromptTemplateInput'),
        promptSegmentPreview: documentObj.getElementById('promptSegmentPreview'),
        finalSystemPromptPreview: documentObj.getElementById('finalSystemPromptPreview'),
        finalSystemPromptPreviewMeta: documentObj.getElementById('finalSystemPromptPreviewMeta'),
        refreshFinalSystemPromptPreviewBtn: documentObj.getElementById('refreshFinalSystemPromptPreviewBtn'),
        enableWideChatLayout: documentObj.getElementById('enableWideChatLayout'),
        enableSmoothStreaming: documentObj.getElementById('enableSmoothStreaming'),
        saveGlobalSettingsBtn: documentObj.getElementById('saveGlobalSettingsBtn'),
        currentAgentSettingsBtn: null,
        globalSettingsBtn: null,
        settingsModalCloseBtn: null,
        settingsModalBackdrop: null,
        settingsNavButtons: [],
        themeToggleBtn: null,
        settingsModalSectionGlobal: null,
        settingsModalSectionAgent: null,
        settingsModalSectionKnowledgeBase: null,
        settingsModalTitle: null,
        settingsModalSubtitle: null,
        settingsModalFooter: null,
        editingAgentId: documentObj.getElementById('editingAgentId'),
        agentNameInput: documentObj.getElementById('agentNameInput'),
        agentAvatarPreview: documentObj.getElementById('agentAvatarPreview'),
        agentAvatarInput: documentObj.getElementById('agentAvatarInput'),
        agentModel: documentObj.getElementById('agentModel'),
        agentVcpAliasesInput: documentObj.getElementById('agentVcpAliasesInput'),
        agentVcpMaidInput: documentObj.getElementById('agentVcpMaidInput'),
        agentTemperature: documentObj.getElementById('agentTemperature'),
        agentContextTokenLimit: documentObj.getElementById('agentContextTokenLimit'),
        agentMaxOutputTokens: documentObj.getElementById('agentMaxOutputTokens'),
        agentTopP: documentObj.getElementById('agentTopP'),
        agentTopK: documentObj.getElementById('agentTopK'),
        agentStreamOutputTrue: documentObj.getElementById('agentStreamOutputTrue'),
        agentStreamOutputFalse: documentObj.getElementById('agentStreamOutputFalse'),
        agentAvatarBorderColor: documentObj.getElementById('agentAvatarBorderColor'),
        agentAvatarBorderColorText: documentObj.getElementById('agentAvatarBorderColorText'),
        agentNameTextColor: documentObj.getElementById('agentNameTextColor'),
        agentNameTextColorText: documentObj.getElementById('agentNameTextColorText'),
        disableCustomColors: documentObj.getElementById('disableCustomColors'),
        useThemeColorsInChat: documentObj.getElementById('useThemeColorsInChat'),
        saveAgentSettingsBtn: documentObj.getElementById('saveAgentSettingsBtn'),
        selectAgentPromptForSettings: documentObj.getElementById('selectAgentPromptForSettings'),
        agentSettingsContainer: documentObj.getElementById('agentSettingsContainer'),
    };
}

async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test('settingsController loads native toolbox settings, previews placeholders, and saves bubble theme prompt', async (t) => {
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
    const bubblePreviewCalls = [];
    const finalPreviewCalls = [];
    const toasts = [];
    const store = createStore({
        currentThemeMode: 'system',
    });
    const documentObj = dom.window.document;
    const el = createElementMap(documentObj);

    const controller = createSettingsController({
        store,
        el,
        chatAPI: {
            async loadSettings() {
                return {
                    userName: 'Alice',
                    defaultModel: 'chat-default-model',
                    followUpDefaultModel: 'follow-up-default-model',
                    topicTitleDefaultModel: 'topic-title-default-model',
                    kbUseRerank: true,
                    kbTopK: 6,
                    kbCandidateTopK: 20,
                    kbScoreThreshold: 0.25,
                    chatFontPreset: 'system',
                    chatCodeFontPreset: 'consolas',
                    chatBubbleMaxWidthWideDefault: 92,
                    renderingPrompt: 'rendering prompt',
                    adaptiveBubbleTip: 'adaptive tip',
                    dailyNoteGuide: 'daily guide',
                    followUpPromptTemplate: 'follow-up template with {{CHAT_HISTORY}}',
                    enableTopicTitleGeneration: false,
                    topicTitlePromptTemplate: 'title template with {{CHAT_HISTORY}}',
                    enableAgentBubbleTheme: false,
                    agentBubbleThemePrompt: 'Custom bubble prompt: {{VarDivRender}}',
                    enableWideChatLayout: true,
                    enableSmoothStreaming: false,
                    currentThemeMode: 'dark',
                };
            },
            async saveSettings(patch) {
                savedPatch = patch;
                return {
                    success: true,
                    settings: { ...patch },
                    persistenceCheck: {
                        agentBubbleThemePromptMatched: true,
                        enableAgentBubbleThemeMatched: true,
                    },
                };
            },
            async previewAgentBubbleThemePrompt(payload) {
                bubblePreviewCalls.push(payload);
                return {
                    enabled: payload.enabled,
                    willInject: true,
                    resolvedPrompt: `PREVIEW::${payload.prompt
                        .replace('{{VarDivRender}}', 'DIV_RENDER')
                        .replace('{{VarUser}}', 'Alice')
                        .replace('{{AgentName}}', payload.context?.agentName || 'Agent One')}`,
                    unresolvedTokens: [],
                    substitutions: {
                        VarDivRender: 'DIV_RENDER',
                        VarUser: 'Alice',
                    },
                    variableSources: {
                        VarDivRender: 'builtin',
                        VarUser: 'settings',
                    },
                };
            },
            async previewFinalSystemPrompt(payload) {
                finalPreviewCalls.push(payload);
                const renderingText = payload.settings?.enableRenderingPrompt === false
                    ? ''
                    : (payload.settings?.renderingPrompt || 'default rendering');
                const adaptiveText = payload.settings?.enableAdaptiveBubbleTip === false
                    ? ''
                    : (payload.settings?.adaptiveBubbleTip || 'default adaptive');
                const dailyText = payload.settings?.studyLogPolicy?.enabled === false
                    || (payload.settings?.studyLogPolicy?.enableDailyNotePromptVariables === false
                        && payload.settings?.studyLogPolicy?.autoInjectDailyNoteProtocol === false)
                    ? ''
                    : (payload.settings?.dailyNoteGuide || 'default daily note guide');
                const bubbleText = payload.settings?.enableAgentBubbleTheme === true
                    ? (payload.settings?.agentBubbleThemePrompt || 'Output formatting requirement: {{VarDivRender}}')
                    : '';
                return {
                    success: true,
                    preview: {
                        agentName: payload.context?.agentName || 'Agent One',
                        topicName: payload.context?.topicName || 'Topic One',
                        hasBasePrompt: true,
                        basePrompt: payload.systemPrompt || 'Base prompt',
                        finalSystemPrompt: [
                            payload.systemPrompt || 'Base prompt',
                            renderingText && `RENDER::${renderingText}`,
                            adaptiveText && `ADAPTIVE::${adaptiveText}`,
                            dailyText && `DAILY::${dailyText}`,
                            bubbleText && `BUBBLE::${bubbleText.replace('{{VarDivRender}}', 'DIV_RENDER')}`,
                        ].filter(Boolean).join('\n'),
                        unresolvedTokens: [],
                        substitutions: {},
                        variableSources: {},
                        segments: {
                            rendering: {
                                enabled: payload.settings?.enableRenderingPrompt !== false,
                                source: payload.settings?.renderingPrompt ? 'custom' : 'default',
                                referencedInBasePrompt: true,
                                rawPrompt: renderingText,
                                resolvedPrompt: renderingText,
                            },
                            adaptiveBubbleTip: {
                                enabled: payload.settings?.enableAdaptiveBubbleTip !== false,
                                source: payload.settings?.adaptiveBubbleTip ? 'custom' : 'default',
                                referencedInBasePrompt: true,
                                rawPrompt: adaptiveText,
                                resolvedPrompt: adaptiveText,
                            },
                            dailyNoteVariable: {
                                enabled: payload.settings?.studyLogPolicy?.enabled !== false
                                    && payload.settings?.studyLogPolicy?.enableDailyNotePromptVariables !== false,
                                source: payload.settings?.dailyNoteGuide ? 'custom' : 'default',
                                referencedInBasePrompt: true,
                                rawPrompt: dailyText,
                                resolvedPrompt: dailyText,
                            },
                            dailyNoteAutoInject: {
                                enabled: payload.settings?.studyLogPolicy?.enabled !== false
                                    && payload.settings?.studyLogPolicy?.autoInjectDailyNoteProtocol !== false,
                                source: payload.settings?.dailyNoteGuide ? 'custom' : 'default',
                                appended: false,
                                skippedBecausePromptAlreadyContainsProtocol: true,
                                rawPrompt: dailyText,
                                resolvedPrompt: dailyText,
                            },
                            bubbleTheme: {
                                enabled: payload.settings?.enableAgentBubbleTheme === true,
                                source: payload.settings?.agentBubbleThemePrompt ? 'custom' : 'default',
                                appended: payload.settings?.enableAgentBubbleTheme === true,
                                rawPrompt: bubbleText,
                                resolvedPrompt: bubbleText.replace('{{VarDivRender}}', 'DIV_RENDER'),
                            },
                        },
                    },
                };
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
            setTimeout: dom.window.setTimeout.bind(dom.window),
            clearTimeout: dom.window.clearTimeout.bind(dom.window),
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
        getBubbleThemePreviewContext: () => ({
            agentId: 'agent-1',
            agentName: 'Agent One',
            topicId: 'topic-1',
            topicName: 'Topic One',
            model: 'qwen3.5-plus',
        }),
    });

    await controller.loadSettings();
    await flushAsyncWork();
    controller.bindEvents();

    assert.equal(el.agentBubbleThemePrompt.value, 'Custom bubble prompt: {{VarDivRender}}');
    assert.equal(el.agentBubbleThemePrompt.readOnly, true);
    assert.equal(el.agentBubbleThemePrompt.classList.contains('settings-textarea--readonly'), true);
    assert.equal(el.agentBubbleThemeResolvedPreview.value, '');
    assert.equal(el.agentBubbleThemePreviewMeta.textContent, '当前关闭，不会注入到 system 提示词。');
    assert.equal(el.defaultModelInput.value, 'chat-default-model');
    assert.equal(el.followUpDefaultModelInput.value, 'follow-up-default-model');
    assert.equal(el.topicTitleDefaultModelInput.value, 'topic-title-default-model');
    assert.equal(el.renderingPromptInput.value, 'rendering prompt');
    assert.equal(el.adaptiveBubbleTipInput.value, 'adaptive tip');
    assert.equal(el.dailyNoteGuideInput.value, 'daily guide');
    assert.equal(el.followUpPromptTemplateInput.value, 'follow-up template with {{CHAT_HISTORY}}');
    assert.equal(el.enableTopicTitleGenerationInput.checked, false);
    assert.equal(el.topicTitlePromptTemplateInput.value, 'title template with {{CHAT_HISTORY}}');
    assert.equal(el.topicTitlePromptTemplateInput.readOnly, true);
    assert.equal(el.topicTitlePromptTemplateInput.classList.contains('settings-textarea--readonly'), true);
    assert.match(el.finalSystemPromptPreview.value, /RENDER::rendering prompt/);
    assert.match(el.promptSegmentPreview.textContent, /结构化渲染/);

    el.enableAgentBubbleTheme.checked = true;
    el.enableAgentBubbleTheme.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    el.enableTopicTitleGenerationInput.checked = true;
    el.enableTopicTitleGenerationInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    assert.equal(el.agentBubbleThemePrompt.readOnly, false);
    assert.equal(el.agentBubbleThemePrompt.classList.contains('settings-textarea--readonly'), false);
    assert.equal(el.agentBubbleThemeResolvedPreview.value, 'PREVIEW::Custom bubble prompt: DIV_RENDER');
    assert.equal(el.agentBubbleThemePreviewMeta.textContent, '这里显示的是主进程实际会追加到 system 消息中的最终文本。');
    assert.equal(el.topicTitlePromptTemplateInput.readOnly, false);
    assert.equal(el.topicTitlePromptTemplateInput.classList.contains('settings-textarea--readonly'), false);

    el.agentBubbleThemePrompt.value = 'Editable prompt: {{VarDivRender}}';
    el.agentBubbleThemePrompt.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.defaultModelInput.value = 'updated-chat-default-model';
    el.followUpDefaultModelInput.value = 'updated-follow-up-model';
    el.topicTitleDefaultModelInput.value = 'updated-topic-title-model';
    el.renderingPromptInput.value = 'native rendering text';
    el.adaptiveBubbleTipInput.value = 'native adaptive tip';
    el.dailyNoteGuideInput.value = 'native daily guide';
    el.followUpPromptTemplateInput.value = 'native follow-up template';
    el.followUpPromptTemplateInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.topicTitlePromptTemplateInput.value = 'native topic title template';
    el.topicTitlePromptTemplateInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.refreshFinalSystemPromptPreviewBtn.click();
    await flushAsyncWork();
    assert.match(el.finalSystemPromptPreview.value, /BUBBLE::Editable prompt: DIV_RENDER/);
    assert.match(el.finalSystemPromptPreviewMeta.textContent, /智能体：Agent One/);

    documentObj.querySelector('input[name="themeMode"][value="dark"]').checked = true;
    await controller.saveGlobalSettings();
    await flushAsyncWork();

    assert.ok(savedPatch);
    assert.equal(savedPatch.defaultModel, 'updated-chat-default-model');
    assert.equal(savedPatch.followUpDefaultModel, 'updated-follow-up-model');
    assert.equal(savedPatch.topicTitleDefaultModel, 'updated-topic-title-model');
    assert.equal(savedPatch.enableAgentBubbleTheme, true);
    assert.equal(savedPatch.agentBubbleThemePrompt, 'Editable prompt: {{VarDivRender}}');
    assert.equal(savedPatch.renderingPrompt, 'native rendering text');
    assert.equal(savedPatch.adaptiveBubbleTip, 'native adaptive tip');
    assert.equal(savedPatch.dailyNoteGuide, 'native daily guide');
    assert.equal(savedPatch.followUpPromptTemplate, 'native follow-up template');
    assert.equal(savedPatch.enableTopicTitleGeneration, true);
    assert.equal(savedPatch.topicTitlePromptTemplate, 'native topic title template');
    assert.equal(savedThemeMode, 'dark');
    assert.equal(reloadCount, 1);
    assert.equal(el.agentBubbleThemeResolvedPreview.value, 'PREVIEW::Editable prompt: DIV_RENDER');
    assert.equal(el.agentBubbleThemePersistStatus.textContent, '已验证：提示词配置已写入 settings.json。');
    assert.ok(bubblePreviewCalls.length >= 2);
    assert.equal(bubblePreviewCalls.at(-1).context.agentName, 'Agent One');
    assert.ok(finalPreviewCalls.length >= 2);
    assert.equal(finalPreviewCalls.at(-1).context.agentName, 'Agent One');
    assert.deepEqual(toasts, [
        { message: '全局设置已保存。', type: 'success' },
    ]);
});

test('settingsController shows the default follow-up template in the UI but saves an empty raw value when left untouched', async (t) => {
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
    const documentObj = dom.window.document;
    const el = createElementMap(documentObj);
    const store = createStore({
        currentThemeMode: 'system',
    });

    const controller = createSettingsController({
        store,
        el,
        chatAPI: {
            async loadSettings() {
                return {
                    kbUseRerank: true,
                    kbTopK: 6,
                    kbCandidateTopK: 20,
                    kbScoreThreshold: 0.25,
                    chatFontPreset: 'system',
                    chatCodeFontPreset: 'consolas',
                    chatBubbleMaxWidthWideDefault: 92,
                    enableSmoothStreaming: false,
                    enableTopicTitleGeneration: true,
                    currentThemeMode: 'system',
                    enableAgentBubbleTheme: false,
                };
            },
            async saveSettings(patch) {
                savedPatch = patch;
                return {
                    success: true,
                    settings: { ...patch },
                    persistenceCheck: {
                        agentBubbleThemePromptMatched: true,
                        enableAgentBubbleThemeMatched: true,
                        mismatchedFields: [],
                    },
                };
            },
            async previewAgentBubbleThemePrompt() {
                return {
                    enabled: false,
                    willInject: false,
                    resolvedPrompt: '',
                    unresolvedTokens: [],
                    substitutions: {},
                    variableSources: {},
                };
            },
            async previewFinalSystemPrompt() {
                return {
                    success: true,
                    preview: {
                        agentName: '',
                        topicName: '',
                        hasBasePrompt: false,
                        basePrompt: '',
                        finalSystemPrompt: '',
                        unresolvedTokens: [],
                        substitutions: {},
                        variableSources: {},
                        segments: {
                            rendering: { enabled: true, source: 'default', referencedInBasePrompt: false, rawPrompt: '', resolvedPrompt: '' },
                            adaptiveBubbleTip: { enabled: true, source: 'default', referencedInBasePrompt: false, rawPrompt: '', resolvedPrompt: '' },
                            dailyNoteVariable: { enabled: true, source: 'default', referencedInBasePrompt: false, rawPrompt: '', resolvedPrompt: '' },
                            dailyNoteAutoInject: { enabled: true, source: 'default', appended: false, skippedBecausePromptAlreadyContainsProtocol: false, rawPrompt: '', resolvedPrompt: '' },
                            bubbleTheme: { enabled: false, source: 'default', appended: false, rawPrompt: '', resolvedPrompt: '' },
                        },
                    },
                };
            },
            setThemeMode() {},
        },
        ui: {
            showToastNotification() {},
        },
        windowObj: dom.window,
        documentObj,
        messageRendererApi: {
            setUserAvatar() {},
            setUserAvatarColor() {},
        },
        syncLayoutSettings() {},
    });

    await controller.loadSettings();
    await flushAsyncWork();

    assert.match(el.followUpPromptTemplateInput.value, /{{CHAT_HISTORY}}/);
    assert.equal(el.followUpPromptTemplateInput.dataset.usingDefaultPrompt, 'true');
    assert.match(el.topicTitlePromptTemplateInput.value, /{\"title\":\"😀 标题\"}/);
    assert.equal(el.topicTitlePromptTemplateInput.dataset.usingDefaultPrompt, 'true');

    await controller.saveGlobalSettings({ showToastOnSuccess: false });

    assert.ok(savedPatch);
    assert.equal(savedPatch.followUpPromptTemplate, '');
    assert.equal(savedPatch.topicTitlePromptTemplate, '');
});

test('settingsController saves native agent VCP fields', async (t) => {
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

    let savedAgentPatch = null;
    let reloadAgentId = null;
    const documentObj = dom.window.document;
    const store = createStore();
    const el = createElementMap(documentObj);

    el.agentNameInput.value = 'Nova Agent';
    el.agentModel.value = 'qwen3.5-plus';
    el.agentVcpAliasesInput.value = 'Nova\nTutor';
    el.agentVcpMaidInput.value = '[Nova]Nova';
    el.agentTemperature.value = '0.2';
    el.agentContextTokenLimit.value = '100000';
    el.agentMaxOutputTokens.value = '4000';
    el.agentTopP.value = '0.95';
    el.agentTopK.value = '40';
    el.agentStreamOutputTrue.checked = true;
    el.agentAvatarBorderColor.value = '#3d5a80';
    el.agentNameTextColor.value = '#ffffff';
    el.disableCustomColors.checked = false;
    el.useThemeColorsInChat.checked = true;

    const controller = createSettingsController({
        store,
        el,
        chatAPI: {
            async saveAgentConfig(agentId, patch) {
                savedAgentPatch = { agentId, patch };
                return { success: true };
            },
            async saveAvatar() {
                return { success: true };
            },
        },
        ui: {
            showToastNotification() {},
        },
        windowObj: dom.window,
        documentObj,
        resolvePromptText: async () => 'Prompt text',
        getCurrentSelectedItem: () => ({ id: 'agent-42', name: 'Nova Agent' }),
        reloadSelectedAgent: async (agentId) => {
            reloadAgentId = agentId;
        },
    });

    await controller.saveAgentSettings();

    assert.deepEqual(savedAgentPatch, {
        agentId: 'agent-42',
        patch: {
            name: 'Nova Agent',
            model: 'qwen3.5-plus',
            vcpAliases: ['Nova', 'Tutor'],
            vcpMaid: '[Nova]Nova',
            temperature: 0.2,
            contextTokenLimit: 100000,
            maxOutputTokens: 4000,
            top_p: 0.95,
            top_k: 40,
            streamOutput: true,
            avatarBorderColor: '#3d5a80',
            nameTextColor: '#ffffff',
            disableCustomColors: false,
            useThemeColorsInChat: true,
            promptMode: 'original',
            originalSystemPrompt: 'Prompt text',
            systemPrompt: 'Prompt text',
        },
    });
    assert.equal(reloadAgentId, 'agent-42');
});

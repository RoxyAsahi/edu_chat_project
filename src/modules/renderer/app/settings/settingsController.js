const SETTINGS_MODAL_META = Object.freeze({
    services: {
        title: '模型服务',
        subtitle: '管理全局连接、检索模型和来源服务参数。',
    },
    'default-model': {
        title: '默认模型',
        subtitle: '统一设置新建智能体和默认会话优先使用的模型。',
    },
    prompts: {
        title: '提示词设置',
        subtitle: '集中管理学习档案、提示变量和日志协议。',
    },
    display: {
        title: '显示设置',
        subtitle: '调整聊天字体、宽度和流式显示效果。',
    },
    global: {
        title: '模型服务',
        subtitle: '管理全局连接、检索模型和来源服务参数。',
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

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = 'Output formatting requirement: {{VarDivRender}}';
const DEFAULT_RENDERING_PROMPT = [
    'When structured rendering helps, emit semantic HTML div blocks that the client can render directly.',
    'Prefer normal Markdown for standard prose.',
    'Do not echo unresolved template variables in the final answer.',
].join(' ');
const DEFAULT_ADAPTIVE_BUBBLE_TIP = [
    'Keep answers readable and compact when rich layout is unnecessary.',
    'Only switch to more structured rendering when it clearly helps comprehension.',
].join(' ');
const SETTINGS_PERSISTENCE_FIELD_LABELS = Object.freeze({
    enableRenderingPrompt: '结构化渲染提示',
    enableAdaptiveBubbleTip: '简洁气泡补充',
    'studyLogPolicy.enableDailyNotePromptVariables': '内建 DailyNote 变量',
    'studyLogPolicy.autoInjectDailyNoteProtocol': '自动注入 DailyNote 协议',
});

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function parsePromptVariablesInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return {};
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([key, entryValue]) => typeof key === 'string' && typeof entryValue === 'string')
        );
    } catch (_error) {
        return null;
    }
}

function parseLineListInput(value) {
    return String(value || '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function extractPromptTextFromAgentConfig(config = {}) {
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
                        const selectedIndex = Number.isInteger(block.selectedVariant) ? block.selectedVariant : 0;
                        return block.variants[selectedIndex] || block.content || '';
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
    const getBubbleThemePreviewContext = deps.getBubbleThemePreviewContext || (() => ({}));
    let settingsModalTrigger = null;
    let settingsPageReturnView = 'overview';
    let globalSettingsSaveTimer = null;
    let isSyncingGlobalSettingsForm = false;
    let isSavingGlobalSettings = false;
    let placeholderPreviewRequestId = 0;
    let lastFinalSystemPromptPreview = null;

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

    function applyTheme(_theme) {
        documentObj.body.classList.remove('dark-theme');
        documentObj.body.classList.add('light-theme');
    }

    function setGlobalSettingsSaveStatus(message, tone = '') {
        if (!el.settingsAutoSaveStatus) {
            return;
        }
        el.settingsAutoSaveStatus.textContent = message;
        el.settingsAutoSaveStatus.classList.remove(
            'settings-caption--success',
            'settings-caption--warning',
            'settings-caption--info'
        );
        if (tone) {
            el.settingsAutoSaveStatus.classList.add(`settings-caption--${tone}`);
        }
    }

    function applyRendererSettings() {
        const settings = getGlobalSettings();
        const chatFonts = {
            system: '"Segoe UI", "PingFang SC", sans-serif',
            serif: 'Georgia, "Noto Serif SC", serif',
            monospace: '"Cascadia Code", "Consolas", monospace',
            consolas: '"Cascadia Code", "Consolas", monospace',
        };

        documentObj.documentElement.style.setProperty('--unistudy-chat-max-width', `${Number(settings.chatBubbleMaxWidthWideDefault || 92)}%`);
        documentObj.documentElement.style.setProperty('--unistudy-chat-font', chatFonts[settings.chatFontPreset] || chatFonts.system);
        documentObj.documentElement.style.setProperty('--unistudy-code-font', chatFonts[settings.chatCodeFontPreset] || chatFonts.consolas);
    }

    function syncPromptTextareaState(node, enabled) {
        if (!node) {
            return;
        }

        node.readOnly = !enabled;
        node.setAttribute('aria-readonly', enabled ? 'false' : 'true');
        node.classList.toggle('settings-textarea--readonly', !enabled);
    }

    function syncPromptInjectionState() {
        syncPromptTextareaState(el.renderingPromptInput, el.enableRenderingPromptInput?.checked !== false);
        syncPromptTextareaState(el.adaptiveBubbleTipInput, el.enableAdaptiveBubbleTipInput?.checked !== false);
        syncPromptTextareaState(el.agentBubbleThemePrompt, el.enableAgentBubbleTheme?.checked === true);
        const dailyNoteEnabled = (el.studyLogEnabledInput?.checked !== false)
            && ((el.studyLogEnablePromptVariablesInput?.checked !== false)
            || (el.studyLogAutoInjectProtocolInput?.checked !== false));
        syncPromptTextareaState(el.dailyNoteGuideInput, dailyNoteEnabled);
    }

    function getDailyNoteDefaultPromptText() {
        return sanitizeText(
            lastFinalSystemPromptPreview?.segments?.dailyNoteVariable?.rawPrompt
            || lastFinalSystemPromptPreview?.segments?.dailyNoteAutoInject?.rawPrompt,
            ''
        );
    }

    function markPromptTextareaDefault(node, fallback = '') {
        if (!node) {
            return;
        }

        node.dataset.defaultPrompt = String(fallback || '');
        node.dataset.usingDefaultPrompt = 'true';
    }

    function markPromptTextareaCustom(node) {
        if (!node) {
            return;
        }

        node.dataset.usingDefaultPrompt = 'false';
    }

    function getPromptTextareaRawValue(node) {
        if (!node) {
            return '';
        }

        return node.dataset.usingDefaultPrompt === 'true'
            ? ''
            : (node.value || '');
    }

    function hydratePromptTextarea(node, fallback) {
        if (!node) {
            return;
        }

        const text = String(fallback || '');
        node.placeholder = text;
        node.dataset.defaultPrompt = text;
        if (!text || node.value.trim() || documentObj.activeElement === node) {
            return;
        }

        node.value = text;
        node.dataset.usingDefaultPrompt = 'true';
    }

    function setAgentBubbleThemeCaptionStatus(node, message = '', tone = '') {
        if (!node) {
            return;
        }

        node.textContent = message;
        node.classList.toggle('settings-caption--success', tone === 'success');
        node.classList.toggle('settings-caption--warning', tone === 'warning');
    }

    function truncatePreviewText(value, limit = 180) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            return '当前没有可展示的文本。';
        }
        if (text.length <= limit) {
            return text;
        }
        return `${text.slice(0, limit).trim()}...`;
    }

    function renderPromptSegmentPreview(preview = {}) {
        if (!el.promptSegmentPreview) {
            return;
        }

        const segmentMap = [
            {
                key: 'rendering',
                title: '结构化渲染',
                description: '控制 {{VarDivRender}} / {{VarRendering}} 是否进入当前智能体提示词。',
            },
            {
                key: 'adaptiveBubbleTip',
                title: '简洁气泡补充',
                description: '控制 {{VarAdaptiveBubbleTip}} 是否进入当前智能体提示词。',
            },
            {
                key: 'dailyNoteVariable',
                title: 'DailyNote 变量',
                description: '控制 {{StudyLogTool}} / {{DailyNoteTool}} / {{VarDailyNoteGuide}} 是否展开。',
            },
            {
                key: 'dailyNoteAutoInject',
                title: 'DailyNote 自动追加',
                description: '作为全局兜底，在主 prompt 没自带协议时再追加一段 DailyNote 说明。',
            },
            {
                key: 'bubbleTheme',
                title: '视觉气泡主题',
                description: '真正额外 append 到 system prompt 末尾的附加提示词。',
            },
        ];

        const cards = segmentMap.map((item) => {
            const segment = preview?.segments?.[item.key] || {};
            let status = '当前不会加入';
            let reason = '这一段当前不会进入最终 system prompt。';
            if (item.key === 'dailyNoteAutoInject') {
                if (segment.enabled) {
                    if (segment.appended) {
                        status = '发送前会自动补上';
                        reason = '当前 agent prompt 没自带协议，所以会在真正发送前追加一段 DailyNote 说明。';
                    } else if (segment.skippedBecausePromptAlreadyContainsProtocol) {
                        status = '已启用，但不会重复追加';
                        reason = '当前 agent prompt 已经自带 DailyNote 协议，所以这里会主动跳过，避免重复。';
                    } else {
                        status = '已启用，当前无需追加';
                        reason = '当前没有额外追加，但开关仍处于启用状态。';
                    }
                } else {
                    status = '自动追加已关闭';
                    reason = '只有显式写进 agent prompt 的协议内容才会生效。';
                }
            } else if (item.key === 'bubbleTheme') {
                if (segment.enabled) {
                    status = segment.appended ? '会额外追加到末尾' : '已启用，但当前未追加';
                    reason = segment.appended
                        ? '这段内容会直接 append 到最终 system prompt 末尾。'
                        : '当前没有新的附加内容需要追加。';
                } else {
                    status = '额外追加已关闭';
                    reason = '最终 prompt 不会再附带单独的气泡主题补充。';
                }
            } else {
                if (segment.enabled) {
                    status = segment.referencedInBasePrompt ? '会进入当前 prompt' : '已启用，但当前未被引用';
                    reason = segment.referencedInBasePrompt
                        ? '当前 agent prompt 明确引用了这一段，所以发送时会一起展开。'
                        : '这段内容已经准备好了，但当前 agent prompt 里还没有引用它。';
                } else {
                    status = '该片段已关闭';
                    reason = '即使 prompt 里写了对应变量，也会被解析为空。';
                }
            }

            const source = segment.enabled
                ? (segment.source === 'custom' ? '自定义文案' : '默认文案')
                : '关闭';
            const previewText = truncatePreviewText(
                segment.resolvedPrompt || segment.rawPrompt || '',
                item.key === 'dailyNoteVariable' || item.key === 'dailyNoteAutoInject' ? 150 : 120
            );

            return `
                <article class="settings-token-card settings-token-card--segment ${segment.enabled ? 'settings-token-card--active' : 'settings-token-card--muted'}">
                  <div class="settings-token-card__top">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span class="settings-token-card__badge">${escapeHtml(source)}</span>
                  </div>
                  <span class="settings-token-card__status">${escapeHtml(status)}</span>
                  <span>${escapeHtml(reason)}</span>
                  <span class="settings-token-card__preview">${escapeHtml(previewText)}</span>
                </article>
            `;
        }).join('');

        el.promptSegmentPreview.innerHTML = cards;
    }

    function renderPromptPreviewMeta(preview = {}) {
        if (!el.finalSystemPromptPreviewMeta) {
            return;
        }

        const unresolvedTokens = Array.isArray(preview?.unresolvedTokens) ? preview.unresolvedTokens : [];
        const chips = [
            `智能体：${preview?.agentName || '未选择'}`,
            `话题：${preview?.topicName || '未选择'}`,
            `基础 prompt：${preview?.hasBasePrompt ? '已找到' : '未找到'}`,
        ];
        const notes = [];
        const dailyNoteVariable = preview?.segments?.dailyNoteVariable || {};
        const dailyNoteAutoInject = preview?.segments?.dailyNoteAutoInject || {};
        const bubbleTheme = preview?.segments?.bubbleTheme || {};

        if (dailyNoteVariable.enabled && dailyNoteVariable.referencedInBasePrompt) {
            notes.push('当前 agent prompt 自己引用了 DailyNote 协议变量，所以发送时会直接展开。');
        } else if (dailyNoteAutoInject.appended) {
            notes.push('当前 agent prompt 没自带协议，因此发送前会自动补上一段 DailyNote 说明。');
        } else if (dailyNoteAutoInject.skippedBecausePromptAlreadyContainsProtocol) {
            notes.push('当前 agent prompt 已经自带 DailyNote 协议，所以系统不会重复追加。');
        } else if (!dailyNoteVariable.enabled && !dailyNoteAutoInject.enabled) {
            notes.push('DailyNote 协议当前整体关闭，最终 prompt 不会携带写日记指令。');
        } else {
            notes.push('DailyNote 协议已准备好，但当前是否进入最终 prompt 取决于 agent 自身是否引用。');
        }

        if (bubbleTheme.appended) {
            notes.push('视觉气泡主题会额外追加到最终 system prompt 末尾。');
        } else if (!bubbleTheme.enabled) {
            notes.push('视觉气泡主题当前关闭，不会额外追加新的尾部提示。');
        }

        if (unresolvedTokens.length > 0) {
            notes.push(`还有未解析变量：${unresolvedTokens.join(', ')}`);
        } else {
            notes.push('当前可见变量都已经成功展开。');
        }

        if (preview?.fallbackError) {
            notes.push(`当前显示的是回退预览：${preview.fallbackError}`);
        }

        el.finalSystemPromptPreviewMeta.innerHTML = `
            <div class="settings-preview-meta__chips">
              ${chips.map((chip) => `<span class="settings-preview-meta__chip">${escapeHtml(chip)}</span>`).join('')}
            </div>
            <div class="settings-preview-meta__body">${notes.map((note) => escapeHtml(note)).join('<br />')}</div>
        `;
    }

    function buildBubbleThemePreviewSettingsSnapshot() {
        return {
            userName: el.userNameInput?.value.trim() || 'User',
            enableRenderingPrompt: el.enableRenderingPromptInput?.checked !== false,
            enableAdaptiveBubbleTip: el.enableAdaptiveBubbleTipInput?.checked !== false,
            renderingPrompt: getPromptTextareaRawValue(el.renderingPromptInput),
            adaptiveBubbleTip: getPromptTextareaRawValue(el.adaptiveBubbleTipInput),
            dailyNoteGuide: getPromptTextareaRawValue(el.dailyNoteGuideInput),
            enableAgentBubbleTheme: el.enableAgentBubbleTheme?.checked === true,
            agentBubbleThemePrompt: getPromptTextareaRawValue(el.agentBubbleThemePrompt),
            studyProfile: {
                studentName: el.studentNameInput?.value.trim() || '',
                city: el.studyCityInput?.value.trim() || '',
                studyWorkspace: el.studyWorkspaceInput?.value.trim() || '',
                workEnvironment: el.workEnvironmentInput?.value.trim() || '',
                timezone: el.studyTimezoneInput?.value.trim() || 'Asia/Hong_Kong',
            },
            promptVariables: parsePromptVariablesInput(el.promptVariablesInput?.value) || {},
            studyLogPolicy: {
                enabled: el.studyLogEnabledInput?.checked !== false,
                enableDailyNotePromptVariables: el.studyLogEnablePromptVariablesInput?.checked !== false,
                autoInjectDailyNoteProtocol: el.studyLogAutoInjectProtocolInput?.checked !== false,
            },
        };
    }

    async function resolveSystemPromptPreviewBase() {
        const livePrompt = await resolvePromptText().catch(() => '');
        if (String(livePrompt || '').trim()) {
            return livePrompt;
        }

        let currentSelectedItem = {};
        try {
            currentSelectedItem = getCurrentSelectedItem() || {};
        } catch (_error) {
            currentSelectedItem = {};
        }
        if (currentSelectedItem.id && typeof chatAPI.getAgentConfig === 'function') {
            const config = await chatAPI.getAgentConfig(currentSelectedItem.id).catch(() => null);
            const configPrompt = extractPromptTextFromAgentConfig(config || {});
            if (configPrompt.trim()) {
                return configPrompt;
            }
        }

        return (documentObj.getElementById('unistudyPromptFallback')?.value || '').trim();
    }

    function buildLocalPromptPreviewFallback({ basePrompt = '', settings = {}, context = {}, error = '' } = {}) {
        const normalizedBasePrompt = String(basePrompt || '');
        const renderingRaw = settings.enableRenderingPrompt === false
            ? ''
            : (settings.renderingPrompt || el.renderingPromptInput?.value || DEFAULT_RENDERING_PROMPT);
        const adaptiveRaw = settings.enableAdaptiveBubbleTip === false
            ? ''
            : (settings.adaptiveBubbleTip || el.adaptiveBubbleTipInput?.value || DEFAULT_ADAPTIVE_BUBBLE_TIP);
        const dailyNoteEnabled = settings.studyLogPolicy?.enabled !== false;
        const dailyNoteRaw = !dailyNoteEnabled
            ? ''
            : (settings.dailyNoteGuide || el.dailyNoteGuideInput?.value || getDailyNoteDefaultPromptText());
        const bubbleThemeRaw = settings.enableAgentBubbleTheme === true
            ? (getPromptTextareaRawValue(el.agentBubbleThemePrompt) || el.agentBubbleThemePrompt?.value || DEFAULT_AGENT_BUBBLE_THEME_PROMPT)
            : '';
        const promptAlreadyContainsDailyNote = normalizedBasePrompt.includes('—— 日记 (DailyNote) ——')
            || /{{\s*(StudyLogTool|DailyNoteTool|VarDailyNoteGuide)\s*}}/.test(normalizedBasePrompt);
        const finalSystemPrompt = [
            normalizedBasePrompt,
            settings.enableAgentBubbleTheme === true ? bubbleThemeRaw : '',
            dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false && !promptAlreadyContainsDailyNote
                ? dailyNoteRaw
                : '',
        ].filter(Boolean).join('\n\n').trim();

        return {
            agentName: context.agentName || '',
            topicName: context.topicName || '',
            hasBasePrompt: Boolean(normalizedBasePrompt.trim()),
            basePrompt: normalizedBasePrompt,
            finalSystemPrompt,
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
            fallbackError: error,
            segments: {
                rendering: {
                    enabled: settings.enableRenderingPrompt !== false,
                    source: String(settings.renderingPrompt || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*(VarDivRender|VarRendering)\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: renderingRaw,
                    resolvedPrompt: renderingRaw,
                },
                adaptiveBubbleTip: {
                    enabled: settings.enableAdaptiveBubbleTip !== false,
                    source: String(settings.adaptiveBubbleTip || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*VarAdaptiveBubbleTip\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: adaptiveRaw,
                    resolvedPrompt: adaptiveRaw,
                },
                dailyNoteVariable: {
                    enabled: dailyNoteEnabled && settings.studyLogPolicy?.enableDailyNotePromptVariables !== false,
                    source: String(settings.dailyNoteGuide || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*(StudyLogTool|DailyNoteTool|VarDailyNoteGuide)\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: dailyNoteRaw,
                    resolvedPrompt: dailyNoteRaw,
                },
                dailyNoteAutoInject: {
                    enabled: dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false,
                    source: String(settings.dailyNoteGuide || '').trim() ? 'custom' : 'default',
                    appended: dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false && !promptAlreadyContainsDailyNote,
                    skippedBecausePromptAlreadyContainsProtocol: promptAlreadyContainsDailyNote,
                    rawPrompt: dailyNoteRaw,
                    resolvedPrompt: dailyNoteRaw,
                },
                bubbleTheme: {
                    enabled: settings.enableAgentBubbleTheme === true,
                    source: getPromptTextareaRawValue(el.agentBubbleThemePrompt).trim() ? 'custom' : 'default',
                    appended: settings.enableAgentBubbleTheme === true,
                    rawPrompt: bubbleThemeRaw,
                    resolvedPrompt: bubbleThemeRaw,
                },
            },
        };
    }

    async function refreshFinalSystemPromptPreview() {
        if (!el.finalSystemPromptPreview || !el.finalSystemPromptPreviewMeta) {
            return;
        }

        const requestId = ++placeholderPreviewRequestId;
        const previewSettings = buildBubbleThemePreviewSettingsSnapshot();
        const previewContext = getBubbleThemePreviewContext();
        const basePrompt = await resolveSystemPromptPreviewBase();

        if (typeof chatAPI.previewFinalSystemPrompt !== 'function') {
            const fallbackPreview = buildLocalPromptPreviewFallback({
                basePrompt,
                settings: previewSettings,
                context: previewContext,
                error: '完整预览接口当前不可用，已切到本地回退预览。',
            });
            lastFinalSystemPromptPreview = fallbackPreview;
            el.finalSystemPromptPreview.value = fallbackPreview.finalSystemPrompt || fallbackPreview.basePrompt || '';
            renderPromptSegmentPreview(fallbackPreview);
            renderPromptPreviewMeta(fallbackPreview);
            return;
        }

        let previewResult = null;
        try {
            previewResult = await chatAPI.previewFinalSystemPrompt({
                systemPrompt: basePrompt,
                settings: previewSettings,
                context: previewContext,
                modelConfig: {
                    model: previewContext?.model || '',
                },
            });
        } catch (error) {
            previewResult = {
                success: false,
                error: error?.message || String(error || '未知错误'),
                preview: buildLocalPromptPreviewFallback({
                    basePrompt,
                    settings: previewSettings,
                    context: previewContext,
                    error: error?.message || String(error || '未知错误'),
                }),
            };
        }

        if (requestId !== placeholderPreviewRequestId) {
            return;
        }

        const preview = previewResult?.preview || {};
        lastFinalSystemPromptPreview = preview;

        hydratePromptTextarea(el.renderingPromptInput, preview?.segments?.rendering?.rawPrompt || DEFAULT_RENDERING_PROMPT);
        hydratePromptTextarea(el.adaptiveBubbleTipInput, preview?.segments?.adaptiveBubbleTip?.rawPrompt || DEFAULT_ADAPTIVE_BUBBLE_TIP);
        hydratePromptTextarea(el.agentBubbleThemePrompt, preview?.segments?.bubbleTheme?.rawPrompt || DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
        hydratePromptTextarea(el.dailyNoteGuideInput, getDailyNoteDefaultPromptText());

        el.finalSystemPromptPreview.value = preview?.finalSystemPrompt || preview?.basePrompt || '';
        renderPromptSegmentPreview(preview);
        renderPromptPreviewMeta(preview);

        if (!previewResult?.success && !preview?.finalSystemPrompt && !preview?.basePrompt) {
            el.finalSystemPromptPreviewMeta.innerHTML = `
                <div class="settings-preview-meta__body">完整预览失败：${escapeHtml(previewResult?.error || '未知错误')}</div>
            `;
        }
    }

    async function refreshAgentBubbleThemePreview() {
        if (!el.agentBubbleThemeResolvedPreview || !el.agentBubbleThemePreviewMeta) {
            return;
        }

        const enabled = el.enableAgentBubbleTheme?.checked === true;
        const rawPrompt = el.agentBubbleThemePrompt?.value || '';
        const trimmedPrompt = rawPrompt.trim();
        const previewContext = getBubbleThemePreviewContext();

        if (!enabled) {
            el.agentBubbleThemeResolvedPreview.value = '';
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '当前关闭，不会注入到 system 提示词。',
                ''
            );
            return;
        }

        if (!trimmedPrompt) {
            el.agentBubbleThemeResolvedPreview.value = DEFAULT_AGENT_BUBBLE_THEME_PROMPT;
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '当前留空，因此会回退到默认的气泡主题提示词。',
                'success'
            );
            return;
        }

        const previewResult = await chatAPI.previewAgentBubbleThemePrompt?.({
            enabled,
            prompt: rawPrompt,
            settings: buildBubbleThemePreviewSettingsSnapshot(),
            context: previewContext,
        });

        const preview = previewResult?.preview || previewResult || {};
        if (!preview?.resolvedPrompt) {
            el.agentBubbleThemeResolvedPreview.value = trimmedPrompt;
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '预览接口不可用，当前仅显示原始提示词。',
                'warning'
            );
            return;
        }

        if (Array.isArray(preview?.unresolvedTokens) && preview.unresolvedTokens.length > 0) {
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                `存在未解析变量：${preview.unresolvedTokens.join(', ')}`,
                'warning'
            );
            return;
        }

        el.agentBubbleThemeResolvedPreview.value = preview?.resolvedPrompt || '';
        setAgentBubbleThemeCaptionStatus(
            el.agentBubbleThemePreviewMeta,
            '这里显示的是主进程实际会追加到 system 消息中的最终文本。',
            'success'
        );
    }

    function syncGlobalSettingsForm() {
        isSyncingGlobalSettingsForm = true;
        const settings = getGlobalSettings();
        el.userNameInput.value = settings.userName || '';
        if (el.defaultModelInput) el.defaultModelInput.value = settings.defaultModel || '';
        if (el.studentNameInput) el.studentNameInput.value = settings.studyProfile?.studentName || '';
        if (el.studyCityInput) el.studyCityInput.value = settings.studyProfile?.city || '';
        if (el.studyWorkspaceInput) el.studyWorkspaceInput.value = settings.studyProfile?.studyWorkspace || '';
        if (el.workEnvironmentInput) el.workEnvironmentInput.value = settings.studyProfile?.workEnvironment || '';
        if (el.studyTimezoneInput) el.studyTimezoneInput.value = settings.studyProfile?.timezone || 'Asia/Hong_Kong';
        if (el.studyLogEnabledInput) el.studyLogEnabledInput.checked = settings.studyLogPolicy?.enabled !== false;
        if (el.studyLogEnablePromptVariablesInput) {
            el.studyLogEnablePromptVariablesInput.checked = settings.studyLogPolicy?.enableDailyNotePromptVariables !== false;
        }
        if (el.studyLogAutoInjectProtocolInput) {
            el.studyLogAutoInjectProtocolInput.checked = settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false;
        }
        if (el.studyLogMaxRoundsInput) el.studyLogMaxRoundsInput.value = settings.studyLogPolicy?.maxToolRounds ?? 3;
        if (el.studyMemoryTopKInput) el.studyMemoryTopKInput.value = settings.studyLogPolicy?.memoryTopK ?? 4;
        if (el.studyMemoryFallbackTopKInput) el.studyMemoryFallbackTopKInput.value = settings.studyLogPolicy?.memoryFallbackTopK ?? 2;
        if (el.promptVariablesInput) el.promptVariablesInput.value = JSON.stringify(settings.promptVariables || {}, null, 2);
        el.vcpServerUrl.value = settings.vcpServerUrl || '';
        el.vcpApiKey.value = settings.vcpApiKey || '';
        if (el.kbBaseUrl) el.kbBaseUrl.value = settings.kbBaseUrl || settings.vcpServerUrl || '';
        if (el.kbApiKey) el.kbApiKey.value = settings.kbApiKey || settings.vcpApiKey || '';
        el.kbEmbeddingModel.value = settings.kbEmbeddingModel || '';
        el.kbUseRerank.checked = settings.kbUseRerank !== false;
        el.kbRerankModel.value = settings.kbRerankModel || 'BAAI/bge-reranker-v2-m3';
        el.kbTopK.value = settings.kbTopK ?? 6;
        el.kbCandidateTopK.value = settings.kbCandidateTopK ?? 20;
        el.kbScoreThreshold.value = settings.kbScoreThreshold ?? 0.25;
        if (el.enableRenderingPromptInput) {
            el.enableRenderingPromptInput.checked = settings.enableRenderingPrompt !== false;
        }
        if (el.enableAdaptiveBubbleTipInput) {
            el.enableAdaptiveBubbleTipInput.checked = settings.enableAdaptiveBubbleTip !== false;
        }
        el.chatFontPreset.value = settings.chatFontPreset || 'system';
        el.chatCodeFontPreset.value = settings.chatCodeFontPreset || 'consolas';
        el.chatBubbleMaxWidthWideDefault.value = settings.chatBubbleMaxWidthWideDefault ?? 92;
        el.enableAgentBubbleTheme.checked = settings.enableAgentBubbleTheme === true;
        const storedBubbleThemePrompt = typeof settings.agentBubbleThemePrompt === 'string'
            ? settings.agentBubbleThemePrompt
            : '';
        el.agentBubbleThemePrompt.value = storedBubbleThemePrompt || DEFAULT_AGENT_BUBBLE_THEME_PROMPT;
        if (storedBubbleThemePrompt.trim()) {
            markPromptTextareaCustom(el.agentBubbleThemePrompt);
        } else {
            markPromptTextareaDefault(el.agentBubbleThemePrompt, DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
        }
        if (el.renderingPromptInput) {
            const storedRenderingPrompt = settings.renderingPrompt || '';
            el.renderingPromptInput.value = storedRenderingPrompt || DEFAULT_RENDERING_PROMPT;
            if (storedRenderingPrompt.trim()) {
                markPromptTextareaCustom(el.renderingPromptInput);
            } else {
                markPromptTextareaDefault(el.renderingPromptInput, DEFAULT_RENDERING_PROMPT);
            }
        }
        if (el.adaptiveBubbleTipInput) {
            const storedAdaptiveBubbleTip = settings.adaptiveBubbleTip || '';
            el.adaptiveBubbleTipInput.value = storedAdaptiveBubbleTip || DEFAULT_ADAPTIVE_BUBBLE_TIP;
            if (storedAdaptiveBubbleTip.trim()) {
                markPromptTextareaCustom(el.adaptiveBubbleTipInput);
            } else {
                markPromptTextareaDefault(el.adaptiveBubbleTipInput, DEFAULT_ADAPTIVE_BUBBLE_TIP);
            }
        }
        if (el.dailyNoteGuideInput) {
            const storedDailyNoteGuide = settings.dailyNoteGuide || '';
            el.dailyNoteGuideInput.value = storedDailyNoteGuide;
            if (storedDailyNoteGuide.trim()) {
                markPromptTextareaCustom(el.dailyNoteGuideInput);
            } else {
                markPromptTextareaDefault(el.dailyNoteGuideInput, getDailyNoteDefaultPromptText());
            }
        }
        el.enableSmoothStreaming.checked = settings.enableSmoothStreaming === true;
        syncPromptInjectionState();
        void refreshAgentBubbleThemePreview();
        void refreshFinalSystemPromptPreview();

        const themeMode = settings.currentThemeMode || 'system';
        const themeInput = documentObj.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
        if (themeInput) {
            themeInput.checked = true;
        }
        isSyncingGlobalSettingsForm = false;
    }

    async function loadSettings() {
        const loaded = await chatAPI.loadSettings();
        patchGlobalSettings(loaded || {});
        syncGlobalSettingsForm();
        applyRendererSettings();
        syncLayoutSettings(getGlobalSettings());
        messageRendererApi?.setUserAvatar(getGlobalSettings().userAvatarUrl || '../assets/default_user_avatar.png');
        messageRendererApi?.setUserAvatarColor(getGlobalSettings().userAvatarCalculatedColor || null);
    }

    async function saveGlobalSettings(options = {}) {
        if (isSavingGlobalSettings) {
            return;
        }
        const promptVariables = parsePromptVariablesInput(el.promptVariablesInput?.value);
        if (promptVariables === null) {
            setGlobalSettingsSaveStatus('自动保存暂停：自定义提示词变量需要是有效 JSON。', 'warning');
            return;
        }
        const themeMode = documentObj.querySelector('input[name="themeMode"]:checked')?.value || 'system';
        const globalServerUrl = el.vcpServerUrl.value.trim();
        const globalApiKey = el.vcpApiKey.value.trim();
        const patch = {
            userName: el.userNameInput.value.trim() || 'User',
            defaultModel: el.defaultModelInput?.value.trim() || '',
            studyProfile: {
                studentName: el.studentNameInput?.value.trim() || '',
                city: el.studyCityInput?.value.trim() || '',
                studyWorkspace: el.studyWorkspaceInput?.value.trim() || '',
                workEnvironment: el.workEnvironmentInput?.value.trim() || '',
                timezone: el.studyTimezoneInput?.value.trim() || 'Asia/Hong_Kong',
            },
            promptVariables,
            studyLogPolicy: {
                enabled: el.studyLogEnabledInput?.checked !== false,
                enableDailyNotePromptVariables: el.studyLogEnablePromptVariablesInput?.checked !== false,
                autoInjectDailyNoteProtocol: el.studyLogAutoInjectProtocolInput?.checked !== false,
                maxToolRounds: Number(el.studyLogMaxRoundsInput?.value || 3),
                memoryTopK: Number(el.studyMemoryTopKInput?.value || 4),
                memoryFallbackTopK: Number(el.studyMemoryFallbackTopKInput?.value || 2),
            },
            vcpServerUrl: globalServerUrl,
            vcpApiKey: globalApiKey,
            kbBaseUrl: globalServerUrl,
            kbApiKey: globalApiKey,
            kbEmbeddingModel: el.kbEmbeddingModel.value.trim(),
            kbUseRerank: el.kbUseRerank.checked,
            kbRerankModel: el.kbRerankModel.value.trim(),
            kbTopK: Number(el.kbTopK.value || 6),
            kbCandidateTopK: Number(el.kbCandidateTopK.value || 20),
            kbScoreThreshold: Number(el.kbScoreThreshold.value || 0.25),
            enableRenderingPrompt: el.enableRenderingPromptInput?.checked !== false,
            enableAdaptiveBubbleTip: el.enableAdaptiveBubbleTipInput?.checked !== false,
            chatFontPreset: el.chatFontPreset.value,
            chatCodeFontPreset: el.chatCodeFontPreset.value,
            chatBubbleMaxWidthWideDefault: Number(el.chatBubbleMaxWidthWideDefault.value || 92),
            enableAgentBubbleTheme: el.enableAgentBubbleTheme.checked,
            agentBubbleThemePrompt: getPromptTextareaRawValue(el.agentBubbleThemePrompt),
            renderingPrompt: getPromptTextareaRawValue(el.renderingPromptInput),
            adaptiveBubbleTip: getPromptTextareaRawValue(el.adaptiveBubbleTipInput),
            dailyNoteGuide: getPromptTextareaRawValue(el.dailyNoteGuideInput),
            enableSmoothStreaming: el.enableSmoothStreaming.checked,
            currentThemeMode: themeMode,
        };
        isSavingGlobalSettings = true;
        setGlobalSettingsSaveStatus('正在自动保存...', 'info');
        const result = await chatAPI.saveSettings(patch);
        isSavingGlobalSettings = false;
        if (!result?.success) {
            setGlobalSettingsSaveStatus(`自动保存失败：${result?.error || '未知错误'}`, 'warning');
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePersistStatus,
                '保存失败，未能验证磁盘中的提示词配置。',
                'warning'
            );
            return;
        }

        const persistedSettings = result?.settings && typeof result.settings === 'object'
            ? result.settings
            : patch;
        patchGlobalSettings(persistedSettings);
        syncGlobalSettingsForm();
        applyRendererSettings();
        chatAPI.setThemeMode(themeMode);
        windowObj.emoticonManager?.reload?.();
        const persistenceCheck = result?.persistenceCheck;
        const promptPersisted = persistenceCheck?.agentBubbleThemePromptMatched === true;
        const togglePersisted = persistenceCheck?.enableAgentBubbleThemeMatched === true;
        const mismatchedFields = Array.isArray(persistenceCheck?.mismatchedFields)
            ? persistenceCheck.mismatchedFields
            : [];
        const promptToggleMismatches = mismatchedFields
            .filter((fieldId) => Object.prototype.hasOwnProperty.call(SETTINGS_PERSISTENCE_FIELD_LABELS, fieldId))
            .map((fieldId) => SETTINGS_PERSISTENCE_FIELD_LABELS[fieldId]);

        if (promptPersisted && togglePersisted && promptToggleMismatches.length === 0) {
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePersistStatus,
                '已验证：提示词配置已写入 settings.json。',
                'success'
            );
            void refreshFinalSystemPromptPreview();
            setGlobalSettingsSaveStatus('所有修改已自动保存。', 'success');
            return;
        }

        setAgentBubbleThemeCaptionStatus(
            el.agentBubbleThemePersistStatus,
            '警告：保存返回成功，但磁盘中的提示词配置与当前界面值不一致。',
            'warning'
        );
        void refreshFinalSystemPromptPreview();
        const mismatchDetail = promptToggleMismatches.length > 0
            ? `以下开关未成功写入：${promptToggleMismatches.join('、')}。`
            : '请重新打开设置检查。';
        setGlobalSettingsSaveStatus(`已保存，但部分提示词配置未完全写入：${mismatchDetail}`, 'warning');
        if (options.showToastOnPartialSave === true) {
            ui.showToastNotification(`全局设置已保存，但注入提示词未成功写入磁盘，${mismatchDetail}`, 'error');
        }
    }

    function scheduleGlobalSettingsSave(delay = 420) {
        if (isSyncingGlobalSettingsForm) {
            return;
        }
        if (globalSettingsSaveTimer) {
            windowObj.clearTimeout(globalSettingsSaveTimer);
        }
        setGlobalSettingsSaveStatus('检测到修改，准备自动保存...', 'info');
        globalSettingsSaveTimer = windowObj.setTimeout(() => {
            globalSettingsSaveTimer = null;
            void saveGlobalSettings();
        }, delay);
    }

    function switchSettingsModalSection(section) {
        const normalizedSection = section === 'global' ? 'services' : section;
        const nextSection = Object.prototype.hasOwnProperty.call(SETTINGS_MODAL_META, normalizedSection)
            ? normalizedSection
            : 'services';
        patchSettingsSlice({
            settingsModalSection: nextSection,
        });

        el.settingsNavButtons?.forEach((button) => {
            const active = button.dataset.settingsSectionButton === nextSection;
            button.classList.toggle('settings-modal__nav-button--active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });

        const sections = [
            ['services', el.settingsModalSectionServices],
            ['default-model', el.settingsModalSectionDefaultModel],
            ['prompts', el.settingsModalSectionPrompts],
            ['display', el.settingsModalSectionDisplay],
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
        if (el.settingsModalTitleDisplay) {
            el.settingsModalTitleDisplay.textContent = meta.title;
        }
        if (el.settingsModalSubtitle) {
            el.settingsModalSubtitle.textContent = meta.subtitle;
        }
        el.settingsModalFooter?.classList.toggle('hidden', nextSection === 'agent');
        if (['services', 'default-model', 'prompts', 'display'].includes(nextSection)) {
            void refreshFinalSystemPromptPreview();
        }
    }

    function detectCurrentWorkspaceView() {
        if (!el.manualNotesLibraryPage?.classList.contains('hidden')) {
            return 'manual-notes';
        }
        if (!el.workspaceSubjectPage?.classList.contains('hidden')) {
            return 'subject';
        }
        return 'overview';
    }

    function openSettingsModal(section = 'global', trigger = null) {
        if (trigger instanceof HTMLElement) {
            settingsModalTrigger = trigger;
        }
        settingsPageReturnView = detectCurrentWorkspaceView();
        switchSettingsModalSection(section);
        el.workspaceOverviewPage?.classList.add('hidden');
        el.workspaceSubjectPage?.classList.add('hidden');
        el.settingsModal?.classList.remove('hidden');
        el.settingsModal?.classList.add('settings-page--open');
        el.settingsModal?.setAttribute('aria-hidden', 'false');
        documentObj.body.classList.add('settings-page-open');
        documentObj.body.classList.add('workspace-view-settings');
        documentObj.body.classList.remove('workspace-view-overview', 'workspace-view-subject');
    }

    function closeSettingsModal() {
        el.settingsModal?.classList.add('hidden');
        el.settingsModal?.classList.remove('settings-page--open');
        el.settingsModal?.setAttribute('aria-hidden', 'true');
        documentObj.body.classList.remove('settings-page-open');
        documentObj.body.classList.remove('workspace-view-settings');
        const returnToSubject = settingsPageReturnView === 'subject';
        const returnToManualNotes = settingsPageReturnView === 'manual-notes';
        el.workspaceOverviewPage?.classList.toggle('hidden', returnToSubject || returnToManualNotes);
        el.workspaceSubjectPage?.classList.toggle('hidden', !returnToSubject);
        el.manualNotesLibraryPage?.classList.toggle('hidden', !returnToManualNotes);
        documentObj.body.classList.toggle('workspace-view-overview', !returnToSubject && !returnToManualNotes);
        documentObj.body.classList.toggle('workspace-view-subject', returnToSubject);
        documentObj.body.classList.toggle('workspace-view-manual-notes', returnToManualNotes);
        if (settingsModalTrigger instanceof HTMLElement && documentObj.body.contains(settingsModalTrigger)) {
            settingsModalTrigger.focus();
        }
        settingsModalTrigger = null;
    }

    function openToolboxDiaryManager(anchorId = '') {
        openSettingsModal('global', el.globalSettingsBtn || null);
        const target = anchorId ? documentObj.getElementById(anchorId) : null;
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
            vcpAliases: parseLineListInput(el.agentVcpAliasesInput?.value),
            vcpMaid: el.agentVcpMaidInput?.value.trim() || '',
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
        el.workspaceBackToOverviewBtn?.addEventListener('click', closeSettingsModal);
        el.workspaceOpenSubjectBtn?.addEventListener('click', closeSettingsModal);
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
                    scheduleGlobalSettingsSave(0);
                }
            });
        });

        el.enableAgentBubbleTheme?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogEnabledInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogEnablePromptVariablesInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogAutoInjectProtocolInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableRenderingPromptInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableAdaptiveBubbleTipInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.agentBubbleThemePrompt?.addEventListener('input', () => {
            markPromptTextareaCustom(el.agentBubbleThemePrompt);
            setAgentBubbleThemeCaptionStatus(el.agentBubbleThemePersistStatus, '', '');
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.agentBubbleThemePrompt?.addEventListener('blur', () => {
            hydratePromptTextarea(el.agentBubbleThemePrompt, DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
            if (el.agentBubbleThemePrompt?.value.trim()) {
                el.agentBubbleThemePrompt.dataset.usingDefaultPrompt = el.agentBubbleThemePrompt.value.trim() === DEFAULT_AGENT_BUBBLE_THEME_PROMPT.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.renderingPromptInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.renderingPromptInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.renderingPromptInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.renderingPromptInput, DEFAULT_RENDERING_PROMPT);
            if (el.renderingPromptInput?.value.trim()) {
                el.renderingPromptInput.dataset.usingDefaultPrompt = el.renderingPromptInput.value.trim() === DEFAULT_RENDERING_PROMPT.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.adaptiveBubbleTipInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.adaptiveBubbleTipInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.adaptiveBubbleTipInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.adaptiveBubbleTipInput, DEFAULT_ADAPTIVE_BUBBLE_TIP);
            if (el.adaptiveBubbleTipInput?.value.trim()) {
                el.adaptiveBubbleTipInput.dataset.usingDefaultPrompt = el.adaptiveBubbleTipInput.value.trim() === DEFAULT_ADAPTIVE_BUBBLE_TIP.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.dailyNoteGuideInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.dailyNoteGuideInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.dailyNoteGuideInput?.addEventListener('blur', () => {
            const defaultDailyNotePrompt = getDailyNoteDefaultPromptText();
            hydratePromptTextarea(el.dailyNoteGuideInput, defaultDailyNotePrompt);
            if (el.dailyNoteGuideInput?.value.trim()) {
                el.dailyNoteGuideInput.dataset.usingDefaultPrompt = el.dailyNoteGuideInput.value.trim() === defaultDailyNotePrompt.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.refreshFinalSystemPromptPreviewBtn?.addEventListener('click', () => {
            void refreshFinalSystemPromptPreview();
        });

        [
            el.userNameInput,
            el.defaultModelInput,
            el.studentNameInput,
            el.studyCityInput,
            el.studyWorkspaceInput,
            el.workEnvironmentInput,
            el.studyTimezoneInput,
            el.promptVariablesInput,
            el.vcpServerUrl,
            el.vcpApiKey,
            el.kbEmbeddingModel,
            el.kbRerankModel,
            el.kbTopK,
            el.kbCandidateTopK,
            el.kbScoreThreshold,
            el.chatBubbleMaxWidthWideDefault,
        ].forEach((node) => {
            node?.addEventListener('input', () => scheduleGlobalSettingsSave());
            node?.addEventListener('change', () => scheduleGlobalSettingsSave());
        });

        [
            el.kbUseRerank,
            el.enableSmoothStreaming,
            el.chatFontPreset,
            el.chatCodeFontPreset,
        ].forEach((node) => {
            node?.addEventListener('change', () => scheduleGlobalSettingsSave());
        });

        el.themeToggleBtn?.addEventListener('click', () => {
            applyTheme('light');
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
        openToolboxDiaryManager,
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

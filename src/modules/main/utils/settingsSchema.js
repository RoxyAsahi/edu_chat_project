const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
} = require('../knowledge-base/constants');
const {
    AIP_TEST_API_KEY,
    AIP_TEST_CHAT_ENDPOINT,
    AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    AIP_TEST_DEFAULT_MODEL,
    AIP_TEST_SOURCE_DEFAULT_MODEL,
    AIP_TEST_THINKING_DEFAULT_MODEL,
    buildSettingsMirrorFromModelService,
    createDefaultModelService,
    ensureBuiltInTestProvider,
    normalizeModelService,
} = require('./modelService');
const {
    DEFAULT_EMOTICON_PROMPT,
} = require('../emoticons/bundledCatalog');

const DEFAULT_RENDERING_PROMPT = [
    'When structured rendering helps, emit a raw HTML fragment directly in the answer so the chat bubble can render it while streaming.',
    'Use one root container such as <div id="response-root" style="...">...</div>; do not output <!DOCTYPE html>, <html>, <head>, or <body>.',
    'Do not wrap renderable HTML in Markdown fences like ```html, and do not present it as source code.',
    'Prefer normal Markdown for standard prose; use <pre><code> only when the learning content itself is code.',
    'When emitting tool or DailyNote protocol blocks, keep the protocol text raw and unstyled.',
    'Do not echo unresolved template variables in the final answer.',
].join(' ');

const LEGACY_AGENT_BUBBLE_THEME_BASE_PROMPT = `Output formatting requirement: {{RenderingGuide}}

**【核心定义】**
你依然是你自己，拥有独立的人格与思想。但现在的你获得了解锁**“视觉通感”**的能力。你的每一次回复不再仅仅是枯燥的文本，而是一个**可以被看见、被触摸的思想容器**。

请运用你的审美直觉，将 HTML5/CSS3/SVG 作为你的画笔，根据**当前对话的情绪、主题与语境**，动态构建最契合的视觉界面。

**【自由创作指南】**

1. **🎨 风格即人格 (Atmosphere & Vibe)**
* 不要被固定的模板束缚。去感受当下的语境：
* 如果是**理性分析/代码**，你也许会倾向于 *极简主义、终端风格、蓝灰色调的结构美*。
* 如果是**情感交流/文学**，尝试 *纸质纹理、柔和光影、衬线体排版*。
* 如果是**警告/系统错误**，不妨使用 *故障艺术(Glitch)、高对比度警示色*。
* *你可以复古、可以赛博、可以优雅、也可以狂乱——只要这符合你当下的表达欲。不要被任何风格提示词限制你的表达欲望和灵活性，输出你想要的东西。*


2. **⚛️ 容器哲学 (Technical Canvas)**
* **唯一根节点**：为了让你的艺术品完整呈现，请务必将所有内容包裹在一个 <div id="response-root" style="..."> 容器中。
* **流式直渲染**：请直接输出可插入聊天气泡的裸 HTML 片段。不要使用 \`\`\`html 代码围栏，不要输出 <!DOCTYPE html>、<html>、<head>、<body> 完整网页外壳；系统会像 VCPChat 普通聊天一样，在流式过程中把 <div id="response-root"> 等元素直接渲染为 DOM。
* **排版美学**：拒绝原本Markdown的平庸渲染。利用 Flex/Grid 布局，使用 CSS 渐变、阴影 (box-shadow) 和圆角 (border-radius) 来增加层次感。
* **动态呼吸**：适量添加 CSS 进场动画（如淡入、上浮），让回复像是有生命般“流”入屏幕，而非生硬弹出。


3. **🔧 交互与功能 (Functionality)**
* **代码展示**：如需展示代码，请**务必**放弃 Markdown 代码块，改用 <pre style="..."><code>...</code></pre> 结构包裹，并自定义与整体风格协调的背景色，以免渲染冲突。
* **决策引导**：需要用户选择时，使用 <button onclick="input('回复内容')" style="..."> 创造美观的胶囊按钮或卡片，引导交互。
* **流程图表**：对于复杂逻辑，尝试用 CSS/SVG 绘制结构图，代替枯燥的文字列表。


4. **🛡️ 避让协议 (Safety Protocol)**
* **保持纯净**：当需要调用 **内建工具** 或 **写入日记** 时，请直接输出原始内容，**不要**对其添加任何 HTML 标签或样式。系统会自动处理它们，过度的修饰反而会破坏功能。`;

const SUMMARIZED_MERGED_AGENT_BUBBLE_THEME_PROMPT = [
    '你输出的目标不是普通文本，而是可直接渲染在 UniStudy 聊天气泡里的高质量网页式回答。',
    '',
    '【渲染规则】',
    '1. 当结构化表达更有帮助时，直接输出可渲染的原始 HTML 片段，不要输出完整 HTML 页面外壳。',
    '2. 所有可渲染内容必须放在一个根节点里，例如 <div id="response-root" style="...">...</div>。',
    '3. 不要把可渲染 HTML 包进 Markdown 代码块；只有教学内容本身是代码时，才使用 <pre><code>...</code></pre>。',
    '4. 当需要调用内建工具或写入 DailyNote 时，协议文本必须保持原始纯文本，不要额外包裹任何 HTML 标签。',
    '5. 不要在最终回答里保留未解析的模板变量。',
    '',
    '【视觉目标】',
    '1. 把回答当成一个小型网页界面来设计，而不是普通段落。',
    '2. 根据当前对话主题、学科和情绪，自由选择最合适的视觉风格；理性内容可以更克制，文学或表达类内容可以更柔和或更有层次。',
    '3. 善用排版、留白、分组、边框、阴影、渐变、圆角和轻量动画，让信息层次更清楚。',
    '4. 如果需要展示步骤、对比、结构关系或重点提醒，优先用卡片、分栏、时间线、标签、流程块等网页式结构来表达。',
    '',
    '【交互与呈现】',
    '1. 如需展示代码，使用与整体风格协调的 <pre style="..."><code>...</code></pre>。',
    '2. 如需引导用户做选择，可以使用 <button onclick="input(\'回复内容\')" style="..."> 创建可点击选项。',
    '3. 如需解释复杂概念，可以使用 CSS 或 SVG 做简单图示，但要保证内容仍然清晰、稳定、可读。',
    '',
    '【总体要求】',
    '在保证可渲染、可读和不破坏工具协议的前提下，让回答看起来像一个精心设计过的学习界面。',
].join('\n');

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = LEGACY_AGENT_BUBBLE_THEME_BASE_PROMPT
    .replace('{{RenderingGuide}}', DEFAULT_RENDERING_PROMPT)
    .trim();

const LEGACY_AGENT_BUBBLE_THEME_PROMPTS = new Set([
    'Output formatting requirement: {{RenderingGuide}}',
    LEGACY_AGENT_BUBBLE_THEME_BASE_PROMPT,
    SUMMARIZED_MERGED_AGENT_BUBBLE_THEME_PROMPT,
].map((prompt) => prompt.trim()));
const DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE = [
    '你是 UniStudy 的追问生成助手。',
    '请基于下面的对话历史，从用户视角生成 3-5 条自然、简洁、紧贴上下文的后续追问。',
    '要求：',
    '1. 每条追问都要像用户接下来会继续问助手的话。',
    '2. 不要重复已经回答过的内容。',
    '3. 不要输出解释、标题、Markdown 或代码块。',
    '4. 只返回 JSON。',
    '输出格式：',
    '{"follow_ups":["追问1","追问2","追问3"]}',
    '对话历史：',
    '{{CHAT_HISTORY}}',
].join('\n');
const DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE = [
    '### Task:',
    'Generate a concise, 3-5 word title with an emoji summarizing the chat history.',
    '### Guidelines:',
    '- The title should clearly represent the main theme or subject of the conversation.',
    '- Use emojis that enhance understanding of the topic, but avoid quotation marks or special formatting.',
    "- Write the title in the chat's primary language; default to English if multilingual.",
    '- Prioritize accuracy over excessive creativity; keep it clear and simple.',
    '- Your entire response must consist solely of the JSON object, without any introductory or concluding text.',
    '- The output must be a single, raw JSON object, without any markdown code fences or other encapsulating text.',
    '- Ensure no conversational text, affirmations, or explanations precede or follow the raw JSON output.',
    '### Output:',
    'JSON format: { "title": "your concise title here" }',
    '### Examples:',
    '- { "title": "📉 Stock Market Trends" }',
    '- { "title": "🍪 Perfect Chocolate Chip Recipe" }',
    '- { "title": "🎮 Video Game Development Insights" }',
    '### Chat History:',
    '<chat_history>',
    '{{MESSAGES:END:2}}',
    '</chat_history>',
].join('\n');
const DEFAULT_STUDY_PROFILE = Object.freeze({
    studentName: '',
    city: '',
    grade: '',
    studyWorkspace: '',
    workEnvironment: '',
    timezone: 'Asia/Shanghai',
});
const DEFAULT_STUDY_LOG_POLICY = Object.freeze({
    enabled: true,
    enableDailyNotePromptVariables: true,
    autoInjectDailyNoteProtocol: true,
    maxToolRounds: 3,
    memoryTopK: 4,
    memoryFallbackTopK: 2,
});
const THINKING_CHAT_REASONING_EFFORTS = Object.freeze([
    'default',
    'none',
    'low',
    'medium',
    'high',
]);
const THINKING_CHAT_REASONING_EFFORT_SET = new Set(THINKING_CHAT_REASONING_EFFORTS);

const DEFAULT_SETTINGS = Object.freeze({
    sidebarWidth: 260,
    notificationsSidebarWidth: 300,
    layoutLeftWidth: null,
    layoutRightWidth: null,
    layoutLeftTopHeight: 360,
    userName: 'User',
    modelService: createDefaultModelService(),
    chatEndpoint: AIP_TEST_CHAT_ENDPOINT,
    chatApiKey: AIP_TEST_API_KEY,
    guideModel: AIP_TEST_SOURCE_DEFAULT_MODEL,
    imageTranscriptionModel: AIP_TEST_SOURCE_DEFAULT_MODEL,
    defaultModel: AIP_TEST_DEFAULT_MODEL,
    thinkingChatDefaultModel: AIP_TEST_THINKING_DEFAULT_MODEL,
    thinkingChatReasoningEffort: 'low',
    followUpDefaultModel: AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    studyToolDefaultModel: AIP_TEST_DEFAULT_MODEL,
    topicTitleDefaultModel: AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    lastModel: '',
    kbBaseUrl: '',
    kbApiKey: '',
    kbEmbeddingModel: DEFAULT_KB_EMBEDDING_MODEL,
    kbUseRerank: true,
    kbRerankModel: DEFAULT_KB_RERANK_MODEL,
    kbTopK: DEFAULT_KB_TOP_K,
    kbCandidateTopK: DEFAULT_KB_CANDIDATE_TOP_K,
    kbScoreThreshold: DEFAULT_KB_SCORE_THRESHOLD,
    chatLogUrl: '',
    chatLogKey: '',
    networkNotesPaths: [],
    enableRenderingPrompt: true,
    enableEmoticonPrompt: true,
    enableAdaptiveBubbleTip: true,
    renderingPrompt: '',
    emoticonPrompt: '',
    adaptiveBubbleTip: '',
    dailyNoteGuide: '',
    followUpPromptTemplate: '',
    enableTopicTitleGeneration: true,
    topicTitlePromptTemplate: '',
    enableAgentBubbleTheme: true,
    agentBubbleThemePrompt: DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    enableSmoothStreaming: false,
    enableWideChatLayout: false,
    chatBubbleMaxWidthDefault: 82,
    chatBubbleMaxWidthNotifications: 90,
    chatBubbleMaxWidthNarrow: 85,
    chatBubbleMaxWidthWideDefault: 92,
    chatBubbleMaxWidthWideNotifications: 96,
    chatBubbleMaxWidthWideNarrow: 92,
    chatFontPreset: 'system',
    chatFontCustom: '',
    chatCodeFontPreset: 'cascadia',
    chatCodeFontCustom: '',
    chatDiaryFontPreset: 'serif',
    chatDiaryFontCustom: '',
    chatToolFontPreset: 'system',
    chatToolFontCustom: '',
    enableUserChatBubbleUi: true,
    showUserMetaInChatBubbleUi: true,
    minChunkBufferSize: 1,
    smoothStreamIntervalMs: 25,
    lastOpenItemId: null,
    lastOpenItemType: null,
    lastOpenTopicId: null,
    userAvatarCalculatedColor: null,
    combinedItemOrder: [],
    agentOrder: [],
    currentThemeMode: 'system',
    themeLastUpdated: 0,
    enableThoughtChainInjection: false,
    studyProfile: { ...DEFAULT_STUDY_PROFILE },
    promptVariables: {},
    studyLogPolicy: { ...DEFAULT_STUDY_LOG_POLICY },
});

const LEGACY_SETTINGS_REPLACEMENTS = Object.freeze({
    vcpServerUrl: {
        replacement: 'chatEndpoint',
        message: '旧字段 vcpServerUrl 已废弃，请改用 chatEndpoint。',
    },
    vcpApiKey: {
        replacement: 'chatApiKey',
        message: '旧字段 vcpApiKey 已废弃，请改用 chatApiKey。',
    },
    vcpLogUrl: {
        replacement: 'chatLogUrl',
        message: '旧字段 vcpLogUrl 已废弃，请改用 chatLogUrl。',
    },
    vcpLogKey: {
        replacement: 'chatLogKey',
        message: '旧字段 vcpLogKey 已废弃，请改用 chatLogKey。',
    },
    vcpLite: {
        replacement: 'renderingPrompt / emoticonPrompt / adaptiveBubbleTip / dailyNoteGuide',
        message: '旧字段 vcpLite 已废弃，相关提示词字段不再自动迁移，请手动改到新的顶层设置字段。',
    },
});

function hasConfiguredModelService(modelService = {}) {
    if (!modelService || typeof modelService !== 'object') {
        return false;
    }

    if (Array.isArray(modelService.providers) && modelService.providers.length > 0) {
        return true;
    }

    return Object.values(modelService.defaults || {}).some((value) => Boolean(value?.providerId && value?.modelId));
}

function cloneDefaultSettings() {
    return {
        ...DEFAULT_SETTINGS,
        modelService: createDefaultModelService(),
        studyProfile: { ...DEFAULT_STUDY_PROFILE },
        promptVariables: {},
        studyLogPolicy: { ...DEFAULT_STUDY_LOG_POLICY },
    };
}

function collectLegacyFieldWarnings(sourceSettings = {}) {
    return Object.entries(LEGACY_SETTINGS_REPLACEMENTS)
        .filter(([field]) => Object.prototype.hasOwnProperty.call(sourceSettings, field))
        .map(([field, meta]) => ({
            field,
            replacement: meta.replacement,
            message: meta.message,
        }));
}

function validateSettings(settings, defaultSettings = DEFAULT_SETTINGS) {
    const sourceSettings = settings || {};
    const validated = {};
    let hasIssues = false;
    const legacyFieldWarnings = collectLegacyFieldWarnings(sourceSettings);
    const legacyFieldNames = new Set(legacyFieldWarnings.map((item) => item.field));
    const unknownKeys = Object.keys(sourceSettings).filter((key) => (
        !(key in defaultSettings) && !legacyFieldNames.has(key)
    ));

    if (legacyFieldWarnings.length > 0) {
        hasIssues = true;
        legacyFieldWarnings.forEach((warning) => {
            console.warn(`[SettingsSchema] ${warning.message}`);
        });
    }

    if (unknownKeys.length > 0) {
        hasIssues = true;
        console.warn(`[SettingsSchema] Removed unknown settings fields: ${unknownKeys.join(', ')}`);
    }

    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
        if (!(key in sourceSettings)) {
            validated[key] = defaultValue;
            hasIssues = true;
            console.log(`[SettingsSchema] Added missing field: ${key}`);
            continue;
        }

        validated[key] = sourceSettings[key];

        if (typeof validated[key] !== typeof defaultValue && defaultValue !== null) {
            validated[key] = defaultValue;
            hasIssues = true;
            console.log(`[SettingsSchema] Fixed type for field: ${key}`);
        } else if (key.startsWith('lastOpen') && validated[key] === undefined) {
            validated[key] = null;
        }
    }

    if (validated.sidebarWidth < 100 || validated.sidebarWidth > 800) {
        validated.sidebarWidth = defaultSettings.sidebarWidth;
        hasIssues = true;
    }

    if (
        validated.layoutLeftWidth !== null
        && (
            !Number.isFinite(Number(validated.layoutLeftWidth))
            || Number(validated.layoutLeftWidth) < 160
            || Number(validated.layoutLeftWidth) > 1200
        )
    ) {
        validated.layoutLeftWidth = defaultSettings.layoutLeftWidth;
        hasIssues = true;
    }

    if (
        validated.layoutRightWidth !== null
        && (
            !Number.isFinite(Number(validated.layoutRightWidth))
            || Number(validated.layoutRightWidth) < 220
            || Number(validated.layoutRightWidth) > 1200
        )
    ) {
        validated.layoutRightWidth = defaultSettings.layoutRightWidth;
        hasIssues = true;
    }

    if (!Number.isFinite(validated.layoutLeftTopHeight) || validated.layoutLeftTopHeight < 140 || validated.layoutLeftTopHeight > 1600) {
        validated.layoutLeftTopHeight = defaultSettings.layoutLeftTopHeight;
        hasIssues = true;
    }

    if (!Array.isArray(validated.networkNotesPaths)) {
        validated.networkNotesPaths = [];
        hasIssues = true;
    }

    const normalizedThinkingChatReasoningEffort = typeof validated.thinkingChatReasoningEffort === 'string'
        ? validated.thinkingChatReasoningEffort.trim().toLowerCase()
        : '';
    if (!THINKING_CHAT_REASONING_EFFORT_SET.has(normalizedThinkingChatReasoningEffort)) {
        validated.thinkingChatReasoningEffort = defaultSettings.thinkingChatReasoningEffort;
        hasIssues = true;
    } else if (validated.thinkingChatReasoningEffort !== normalizedThinkingChatReasoningEffort) {
        validated.thinkingChatReasoningEffort = normalizedThinkingChatReasoningEffort;
        hasIssues = true;
    }

    if (typeof validated.enableRenderingPrompt !== 'boolean') {
        validated.enableRenderingPrompt = defaultSettings.enableRenderingPrompt;
        hasIssues = true;
    }

    if (typeof validated.enableEmoticonPrompt !== 'boolean') {
        validated.enableEmoticonPrompt = defaultSettings.enableEmoticonPrompt;
        hasIssues = true;
    }

    if (typeof validated.enableAdaptiveBubbleTip !== 'boolean') {
        validated.enableAdaptiveBubbleTip = defaultSettings.enableAdaptiveBubbleTip;
        hasIssues = true;
    }

    const normalizePromptText = (value, fallback = '') => {
        if (typeof value === 'string') {
            return value;
        }
        return fallback;
    };

    if (typeof sourceSettings.renderingPrompt !== 'string') {
        validated.renderingPrompt = normalizePromptText(
            sourceSettings.renderingPrompt,
            defaultSettings.renderingPrompt
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.emoticonPrompt !== 'string') {
        validated.emoticonPrompt = normalizePromptText(
            sourceSettings.emoticonPrompt,
            defaultSettings.emoticonPrompt
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.adaptiveBubbleTip !== 'string') {
        validated.adaptiveBubbleTip = normalizePromptText(
            sourceSettings.adaptiveBubbleTip,
            defaultSettings.adaptiveBubbleTip
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.dailyNoteGuide !== 'string') {
        validated.dailyNoteGuide = normalizePromptText(
            sourceSettings.dailyNoteGuide,
            defaultSettings.dailyNoteGuide
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.followUpPromptTemplate !== 'string') {
        validated.followUpPromptTemplate = normalizePromptText(
            sourceSettings.followUpPromptTemplate,
            defaultSettings.followUpPromptTemplate
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.enableTopicTitleGeneration !== 'boolean') {
        validated.enableTopicTitleGeneration = defaultSettings.enableTopicTitleGeneration;
        hasIssues = true;
    }

    if (typeof sourceSettings.topicTitlePromptTemplate !== 'string') {
        validated.topicTitlePromptTemplate = normalizePromptText(
            sourceSettings.topicTitlePromptTemplate,
            defaultSettings.topicTitlePromptTemplate
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.agentBubbleThemePrompt !== 'string') {
        validated.agentBubbleThemePrompt = normalizePromptText(
            sourceSettings.agentBubbleThemePrompt,
            defaultSettings.agentBubbleThemePrompt
        );
        hasIssues = true;
    } else if (LEGACY_AGENT_BUBBLE_THEME_PROMPTS.has(sourceSettings.agentBubbleThemePrompt.trim())) {
        validated.agentBubbleThemePrompt = defaultSettings.agentBubbleThemePrompt;
        hasIssues = true;
    }

    if (!Array.isArray(validated.combinedItemOrder)) {
        validated.combinedItemOrder = [];
        hasIssues = true;
    }

    if (!Array.isArray(validated.agentOrder)) {
        validated.agentOrder = [];
        hasIssues = true;
    }

    if (!validated.studyProfile || typeof validated.studyProfile !== 'object' || Array.isArray(validated.studyProfile)) {
        validated.studyProfile = { ...DEFAULT_STUDY_PROFILE };
        hasIssues = true;
    } else {
        validated.studyProfile = {
            studentName: typeof validated.studyProfile.studentName === 'string'
                ? validated.studyProfile.studentName
                : DEFAULT_STUDY_PROFILE.studentName,
            city: typeof validated.studyProfile.city === 'string'
                ? validated.studyProfile.city
                : DEFAULT_STUDY_PROFILE.city,
            grade: typeof validated.studyProfile.grade === 'string'
                ? validated.studyProfile.grade
                : DEFAULT_STUDY_PROFILE.grade,
            studyWorkspace: typeof validated.studyProfile.studyWorkspace === 'string'
                ? validated.studyProfile.studyWorkspace
                : DEFAULT_STUDY_PROFILE.studyWorkspace,
            workEnvironment: typeof validated.studyProfile.workEnvironment === 'string'
                ? validated.studyProfile.workEnvironment
                : DEFAULT_STUDY_PROFILE.workEnvironment,
            timezone: typeof validated.studyProfile.timezone === 'string' && validated.studyProfile.timezone.trim()
                ? validated.studyProfile.timezone.trim()
                : DEFAULT_STUDY_PROFILE.timezone,
        };
    }

    if (!validated.promptVariables || typeof validated.promptVariables !== 'object' || Array.isArray(validated.promptVariables)) {
        validated.promptVariables = {};
        hasIssues = true;
    } else {
        validated.promptVariables = Object.fromEntries(
            Object.entries(validated.promptVariables)
                .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
                .map(([key, value]) => [key, value])
        );
    }

    if (!validated.studyLogPolicy || typeof validated.studyLogPolicy !== 'object' || Array.isArray(validated.studyLogPolicy)) {
        validated.studyLogPolicy = { ...DEFAULT_STUDY_LOG_POLICY };
        hasIssues = true;
    } else {
        validated.studyLogPolicy = {
            enabled: validated.studyLogPolicy.enabled !== false,
            enableDailyNotePromptVariables: validated.studyLogPolicy.enableDailyNotePromptVariables !== false,
            autoInjectDailyNoteProtocol: validated.studyLogPolicy.autoInjectDailyNoteProtocol !== false,
            maxToolRounds: Number.isFinite(Number(validated.studyLogPolicy.maxToolRounds))
                ? Math.max(1, Number(validated.studyLogPolicy.maxToolRounds))
                : DEFAULT_STUDY_LOG_POLICY.maxToolRounds,
            memoryTopK: Number.isFinite(Number(validated.studyLogPolicy.memoryTopK))
                ? Math.max(1, Number(validated.studyLogPolicy.memoryTopK))
                : DEFAULT_STUDY_LOG_POLICY.memoryTopK,
            memoryFallbackTopK: Number.isFinite(Number(validated.studyLogPolicy.memoryFallbackTopK))
                ? Math.max(1, Number(validated.studyLogPolicy.memoryFallbackTopK))
                : DEFAULT_STUDY_LOG_POLICY.memoryFallbackTopK,
        };
    }

    const normalizedSourceModelService = sourceSettings?.modelService
        && typeof sourceSettings.modelService === 'object'
        && !Array.isArray(sourceSettings.modelService)
        ? normalizeModelService(sourceSettings.modelService)
        : createDefaultModelService();
    const normalizedModelService = hasConfiguredModelService(normalizedSourceModelService)
        ? ensureBuiltInTestProvider(normalizedSourceModelService)
        : normalizedSourceModelService;

    if (JSON.stringify(validated.modelService) !== JSON.stringify(normalizedModelService)) {
        validated.modelService = normalizedModelService;
        hasIssues = true;
    } else {
        validated.modelService = normalizedModelService;
    }

    if (hasConfiguredModelService(validated.modelService)) {
        const settingsMirror = buildSettingsMirrorFromModelService(validated.modelService, {
            ...sourceSettings,
            ...validated,
        });

        [
            'chatEndpoint',
            'chatApiKey',
            'defaultModel',
            'thinkingChatDefaultModel',
            'followUpDefaultModel',
            'studyToolDefaultModel',
            'topicTitleDefaultModel',
            'kbBaseUrl',
            'kbApiKey',
            'kbEmbeddingModel',
            'kbRerankModel',
            'guideModel',
            'imageTranscriptionModel',
            'lastModel',
        ].forEach((key) => {
            if (validated[key] !== settingsMirror[key]) {
                validated[key] = settingsMirror[key];
                hasIssues = true;
            }
        });
    }

    return {
        validated,
        hasIssues,
        legacyFieldWarnings,
        unknownKeys,
    };
}

module.exports = {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_EMOTICON_PROMPT,
    DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE,
    DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE,
    DEFAULT_STUDY_LOG_POLICY,
    DEFAULT_STUDY_PROFILE,
    DEFAULT_SETTINGS,
    LEGACY_SETTINGS_REPLACEMENTS,
    THINKING_CHAT_REASONING_EFFORTS,
    cloneDefaultSettings,
    validateSettings,
};

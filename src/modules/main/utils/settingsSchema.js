const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
} = require('../knowledge-base/constants');
const {
    buildLegacySettingsMirror,
    createDefaultModelService,
    normalizeModelService,
} = require('./modelService');
const {
    DEFAULT_EMOTICON_PROMPT,
} = require('../emoticons/bundledCatalog');

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = `Output formatting requirement: {{VarDivRender}}**【核心定义】**
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
* **唯一根节点**：为了让你的艺术品完整呈现，请务必将所有内容包裹在一个 <div id="vcp-root" style="..."> 容器中。
* **排版美学**：拒绝原本Markdown的平庸渲染。利用 Flex/Grid 布局，使用 CSS 渐变、阴影 (box-shadow) 和圆角 (border-radius) 来增加层次感。
* **动态呼吸**：适量添加 CSS 进场动画（如淡入、上浮），让回复像是有生命般“流”入屏幕，而非生硬弹出。


3. **🔧 交互与功能 (Functionality)**
* **代码展示**：如需展示代码，请**务必**放弃 Markdown 代码块，改用 <pre style="..."><code>...</code></pre> 结构包裹，并自定义与整体风格协调的背景色，以免渲染冲突。
* **决策引导**：需要用户选择时，使用 <button onclick="input('回复内容')" style="..."> 创造美观的胶囊按钮或卡片，引导交互。
* **流程图表**：对于复杂逻辑，尝试用 CSS/SVG 绘制结构图，代替枯燥的文字列表。


4. **🛡️ 避让协议 (Safety Protocol)**
* **保持纯净**：当需要调用 **VCP工具** 或 **写入日记** 时，请直接输出原始内容，**不要**对其添加任何 HTML 标签或样式。系统会自动处理它们，过度的修饰反而会破坏功能。`;
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
    '你是 UniStudy 的话题命名助手。',
    '请根据下面的首轮对话，为当前话题生成一个简洁标题。',
    '要求：',
    '1. 标题必须包含 1 个合适的 emoji，并搭配简洁文本。',
    '2. 优先概括主题，不要过度发挥，不要写成长句。',
    '3. 使用对话的主要语言；如果混合语言明显，优先使用用户最后一次提问的语言。',
    '4. 不要输出解释、标题、Markdown 或代码块。',
    '5. 只返回 JSON。',
    '输出格式：',
    '{"title":"😀 标题"}',
    '对话历史：',
    '{{CHAT_HISTORY}}',
].join('\n');
const DEFAULT_STUDY_PROFILE = Object.freeze({
    studentName: '',
    city: '',
    studyWorkspace: '',
    workEnvironment: '',
    timezone: 'Asia/Hong_Kong',
});
const DEFAULT_STUDY_LOG_POLICY = Object.freeze({
    enabled: true,
    enableDailyNotePromptVariables: true,
    autoInjectDailyNoteProtocol: true,
    maxToolRounds: 3,
    memoryTopK: 4,
    memoryFallbackTopK: 2,
});

const DEFAULT_SETTINGS = Object.freeze({
    sidebarWidth: 260,
    notificationsSidebarWidth: 300,
    layoutLeftWidth: 410,
    layoutRightWidth: 400,
    layoutLeftTopHeight: 360,
    userName: 'User',
    modelService: createDefaultModelService(),
    vcpServerUrl: 'https://api.uniquest.top/v1/chat/completions',
    vcpApiKey: 'sk-TtwYTSOeumdwgYVLPM8ul0LcJXU7Cc4uCiiYEQQfjavRin8E',
    guideModel: '',
    defaultModel: '',
    followUpDefaultModel: '',
    topicTitleDefaultModel: '',
    lastModel: '',
    kbBaseUrl: '',
    kbApiKey: '',
    kbEmbeddingModel: DEFAULT_KB_EMBEDDING_MODEL,
    kbUseRerank: true,
    kbRerankModel: DEFAULT_KB_RERANK_MODEL,
    kbTopK: DEFAULT_KB_TOP_K,
    kbCandidateTopK: DEFAULT_KB_CANDIDATE_TOP_K,
    kbScoreThreshold: DEFAULT_KB_SCORE_THRESHOLD,
    vcpLogUrl: '',
    vcpLogKey: '',
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
    enableAgentBubbleTheme: false,
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
    chatCodeFontPreset: 'consolas',
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

function validateSettings(settings, defaultSettings = DEFAULT_SETTINGS) {
    const sourceSettings = settings || {};
    const validated = {};
    let hasIssues = false;
    const legacyPromptSource = sourceSettings.vcpLite && typeof sourceSettings.vcpLite === 'object'
        ? sourceSettings.vcpLite
        : {};

    const unknownKeys = Object.keys(sourceSettings).filter((key) => !(key in defaultSettings));
    if (unknownKeys.length > 0) {
        hasIssues = true;
        console.log(`Removed unknown settings fields: ${unknownKeys.join(', ')}`);
    }

    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
        if (!(key in sourceSettings)) {
            validated[key] = defaultValue;
            hasIssues = true;
            console.log(`Added missing field: ${key}`);
            continue;
        }

        validated[key] = sourceSettings[key];

        if (typeof validated[key] !== typeof defaultValue && defaultValue !== null) {
            validated[key] = defaultValue;
            hasIssues = true;
            console.log(`Fixed type for field: ${key}`);
        } else if (key.startsWith('lastOpen') && validated[key] === undefined) {
            validated[key] = null;
        }
    }

    if (validated.sidebarWidth < 100 || validated.sidebarWidth > 800) {
        validated.sidebarWidth = defaultSettings.sidebarWidth;
        hasIssues = true;
    }

    if (!Number.isFinite(validated.layoutLeftWidth) || validated.layoutLeftWidth < 160 || validated.layoutLeftWidth > 1200) {
        validated.layoutLeftWidth = defaultSettings.layoutLeftWidth;
        hasIssues = true;
    }

    if (!Number.isFinite(validated.layoutRightWidth) || validated.layoutRightWidth < 220 || validated.layoutRightWidth > 1200) {
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
            legacyPromptSource.renderingPrompt,
            defaultSettings.renderingPrompt
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.emoticonPrompt !== 'string') {
        validated.emoticonPrompt = normalizePromptText(
            legacyPromptSource.emoticonPrompt,
            defaultSettings.emoticonPrompt
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.adaptiveBubbleTip !== 'string') {
        validated.adaptiveBubbleTip = normalizePromptText(
            legacyPromptSource.adaptiveBubbleTip,
            defaultSettings.adaptiveBubbleTip
        );
        hasIssues = true;
    }

    if (typeof sourceSettings.dailyNoteGuide !== 'string') {
        validated.dailyNoteGuide = normalizePromptText(
            legacyPromptSource.dailyNoteGuide,
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
    const normalizedModelService = normalizedSourceModelService;

    if (JSON.stringify(validated.modelService) !== JSON.stringify(normalizedModelService)) {
        validated.modelService = normalizedModelService;
        hasIssues = true;
    } else {
        validated.modelService = normalizedModelService;
    }

    if (hasConfiguredModelService(validated.modelService)) {
        const legacyMirror = buildLegacySettingsMirror(validated.modelService, {
            ...sourceSettings,
            ...validated,
        });

        [
            'vcpServerUrl',
            'vcpApiKey',
            'defaultModel',
            'followUpDefaultModel',
            'topicTitleDefaultModel',
            'kbBaseUrl',
            'kbApiKey',
            'kbEmbeddingModel',
            'kbRerankModel',
            'guideModel',
            'lastModel',
        ].forEach((key) => {
            if (validated[key] !== legacyMirror[key]) {
                validated[key] = legacyMirror[key];
                hasIssues = true;
            }
        });
    }

    return { validated, hasIssues };
}

module.exports = {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_EMOTICON_PROMPT,
    DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE,
    DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE,
    DEFAULT_STUDY_LOG_POLICY,
    DEFAULT_STUDY_PROFILE,
    DEFAULT_SETTINGS,
    cloneDefaultSettings,
    validateSettings,
};

const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
} = require('../knowledge-base/constants');

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = 'Output formatting requirement: {{VarDivRender}}';
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
    vcpServerUrl: '',
    vcpApiKey: '',
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
    enableAdaptiveBubbleTip: true,
    renderingPrompt: '',
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

function cloneDefaultSettings() {
    return {
        ...DEFAULT_SETTINGS,
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

    return { validated, hasIssues };
}

module.exports = {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE,
    DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE,
    DEFAULT_STUDY_LOG_POLICY,
    DEFAULT_STUDY_PROFILE,
    DEFAULT_SETTINGS,
    cloneDefaultSettings,
    validateSettings,
};

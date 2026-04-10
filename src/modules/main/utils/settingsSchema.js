const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
} = require('../knowledge-base/constants');

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
    enableAgentBubbleTheme: false,
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
});

function cloneDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
}

function validateSettings(settings, defaultSettings = DEFAULT_SETTINGS) {
    const sourceSettings = settings || {};
    const validated = {};
    let hasIssues = false;

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

    if (!Array.isArray(validated.combinedItemOrder)) {
        validated.combinedItemOrder = [];
        hasIssues = true;
    }

    if (!Array.isArray(validated.agentOrder)) {
        validated.agentOrder = [];
        hasIssues = true;
    }

    return { validated, hasIssues };
}

module.exports = {
    DEFAULT_SETTINGS,
    cloneDefaultSettings,
    validateSettings,
};

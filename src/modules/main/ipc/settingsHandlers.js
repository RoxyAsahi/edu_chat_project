// modules/ipc/settingsHandlers.js
const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const {
    resolvePromptVariables,
    resolvePromptMessageSet,
    DEFAULT_DIV_RENDER_INSTRUCTION,
    DEFAULT_ADAPTIVE_BUBBLE_TIP,
} = require('../utils/promptVariableResolver');
const {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_EMOTICON_PROMPT,
} = require('../utils/settingsSchema');
const { loadBundledEmoticonPromptData } = require('../emoticons/bundledCatalog');
const {
    resolveDailyNoteToolInstruction,
    rewriteLegacyStudyLogPromptText,
} = require('../study/toolProtocol');
let initialized = false;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function readOwnPathValue(source, pathSegments = []) {
    if (!isPlainObject(source) || !Array.isArray(pathSegments) || pathSegments.length === 0) {
        return {
            exists: false,
            value: undefined,
        };
    }

    let current = source;
    for (const segment of pathSegments) {
        if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return {
                exists: false,
                value: undefined,
            };
        }
        current = current[segment];
    }

    return {
        exists: true,
        value: current,
    };
}

function writeOwnPathValue(target, pathSegments = [], value) {
    if (!isPlainObject(target) || !Array.isArray(pathSegments) || pathSegments.length === 0) {
        return target;
    }

    let current = target;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
        const segment = pathSegments[index];
        if (!isPlainObject(current[segment])) {
            current[segment] = {};
        }
        current = current[segment];
    }

    current[pathSegments[pathSegments.length - 1]] = value;
    return target;
}

const SETTINGS_PERSISTENCE_FIELD_SPECS = [
    {
        id: 'followUpPromptTemplate',
        path: ['followUpPromptTemplate'],
        type: 'string',
    },
    {
        id: 'followUpDefaultModel',
        path: ['followUpDefaultModel'],
        type: 'string',
    },
    {
        id: 'enableTopicTitleGeneration',
        path: ['enableTopicTitleGeneration'],
        type: 'boolean',
    },
    {
        id: 'topicTitleDefaultModel',
        path: ['topicTitleDefaultModel'],
        type: 'string',
    },
    {
        id: 'topicTitlePromptTemplate',
        path: ['topicTitlePromptTemplate'],
        type: 'string',
    },
    {
        id: 'agentBubbleThemePrompt',
        path: ['agentBubbleThemePrompt'],
        type: 'string',
    },
    {
        id: 'enableAgentBubbleTheme',
        path: ['enableAgentBubbleTheme'],
        type: 'boolean',
    },
    {
        id: 'enableRenderingPrompt',
        path: ['enableRenderingPrompt'],
        type: 'boolean',
    },
    {
        id: 'enableEmoticonPrompt',
        path: ['enableEmoticonPrompt'],
        type: 'boolean',
    },
    {
        id: 'enableAdaptiveBubbleTip',
        path: ['enableAdaptiveBubbleTip'],
        type: 'boolean',
    },
    {
        id: 'emoticonPrompt',
        path: ['emoticonPrompt'],
        type: 'string',
    },
    {
        id: 'studyLogPolicy.enableDailyNotePromptVariables',
        path: ['studyLogPolicy', 'enableDailyNotePromptVariables'],
        type: 'boolean',
    },
    {
        id: 'studyLogPolicy.autoInjectDailyNoteProtocol',
        path: ['studyLogPolicy', 'autoInjectDailyNoteProtocol'],
        type: 'boolean',
    },
];

function collectRequestedPersistenceFields(settings = {}) {
    return SETTINGS_PERSISTENCE_FIELD_SPECS.reduce((acc, spec) => {
        const requested = readOwnPathValue(settings, spec.path);
        const typeMatches = spec.type === 'boolean'
            ? typeof requested.value === 'boolean'
            : typeof requested.value === 'string';

        if (!requested.exists || !typeMatches) {
            return acc;
        }

        acc[spec.id] = {
            ...spec,
            requestedValue: requested.value,
        };
        return acc;
    }, {});
}

function buildPersistenceFieldChecks(rawSettings, requestedFields = {}) {
    const fieldChecks = {};
    const mismatchedFields = [];

    for (const [fieldId, spec] of Object.entries(requestedFields)) {
        const rawValue = readOwnPathValue(rawSettings, spec.path);
        const matched = rawValue.exists && rawValue.value === spec.requestedValue;
        fieldChecks[fieldId] = {
            requestedValue: spec.requestedValue,
            rawFieldPresent: rawValue.exists,
            matched,
        };
        if (!matched) {
            mismatchedFields.push(fieldId);
        }
    }

    return {
        fieldChecks,
        mismatchedFields,
    };
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

function mergePreviewSettings(baseSettings = {}, overrideSettings = {}) {
    return {
        ...baseSettings,
        ...overrideSettings,
        studyProfile: {
            ...(baseSettings.studyProfile || {}),
            ...(overrideSettings.studyProfile || {}),
        },
        promptVariables: {
            ...(baseSettings.promptVariables || {}),
            ...(overrideSettings.promptVariables || {}),
        },
        studyLogPolicy: {
            ...(baseSettings.studyLogPolicy || {}),
            ...(overrideSettings.studyLogPolicy || {}),
        },
    };
}

function applyAgentBubbleTheme(messages, injectionPrompt = DEFAULT_AGENT_BUBBLE_THEME_PROMPT) {
    const normalizedPrompt = typeof injectionPrompt === 'string' ? injectionPrompt.trim() : '';
    if (!normalizedPrompt) {
        return { messages, appended: false };
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: '' });
        systemMessageIndex = 0;
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    if (currentContent.includes(normalizedPrompt)) {
        return { messages: nextMessages, appended: false };
    }

    nextMessages[systemMessageIndex] = {
        ...systemMessage,
        content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
    };

    return { messages: nextMessages, appended: true };
}

function applyEmoticonPrompt(messages, settings = {}, promptResolutionOptions = {}) {
    if (settings?.enableEmoticonPrompt === false) {
        return { messages, appended: false, skippedByToken: false, skippedByDuplicate: false };
    }

    const emoticonPromptData = promptResolutionOptions?.context?.emoticonPromptData || {};
    const resolvedPrompt = typeof emoticonPromptData.resolvedPrompt === 'string'
        ? emoticonPromptData.resolvedPrompt.trim()
        : '';
    const rawPrompt = typeof settings?.emoticonPrompt === 'string' && settings.emoticonPrompt.trim()
        ? settings.emoticonPrompt.trim()
        : (typeof emoticonPromptData.promptTemplate === 'string' ? emoticonPromptData.promptTemplate.trim() : '');
    const normalizedPrompt = rawPrompt || resolvedPrompt;
    if (!normalizedPrompt || emoticonPromptData.available === false) {
        return { messages, appended: false, skippedByToken: false, skippedByDuplicate: false };
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: normalizedPrompt });
        return { messages: nextMessages, appended: true, skippedByToken: false, skippedByDuplicate: false };
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    const skippedByToken = /{{\s*(VarEmoticonPrompt|VarEmojiPrompt)\s*}}/.test(currentContent);
    const skippedByDuplicate = currentContent.includes(normalizedPrompt)
        || (resolvedPrompt ? currentContent.includes(resolvedPrompt) : false);
    if (skippedByToken || skippedByDuplicate) {
        return { messages: nextMessages, appended: false, skippedByToken, skippedByDuplicate };
    }

    nextMessages[systemMessageIndex] = {
        ...systemMessage,
        content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
    };

    return { messages: nextMessages, appended: true, skippedByToken: false, skippedByDuplicate: false };
}

function normalizeLegacyStudyLogPromptMessages(messages = []) {
    return (Array.isArray(messages) ? messages : []).map((message) => {
        if (!message || message.role !== 'system' || typeof message.content !== 'string') {
            return message;
        }

        return {
            ...message,
            content: rewriteLegacyStudyLogPromptText(message.content),
        };
    });
}

function applyDailyNoteProtocol(messages, settings = {}, promptResolutionOptions = {}) {
    if (settings?.studyLogPolicy?.enabled === false) {
        return { messages, appended: false, skippedByToken: false };
    }
    if (settings?.studyLogPolicy?.autoInjectDailyNoteProtocol === false) {
        return { messages, appended: false, skippedByToken: false };
    }

    const dailyNotePrompt = resolveDailyNoteToolInstruction(settings?.dailyNoteGuide, {
        agentConfig: promptResolutionOptions.agentConfig,
        context: promptResolutionOptions.context,
    });
    const normalizedPrompt = typeof dailyNotePrompt === 'string' ? dailyNotePrompt.trim() : '';
    if (!normalizedPrompt) {
        return { messages, appended: false, skippedByToken: false };
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: normalizedPrompt });
        return { messages: nextMessages, appended: true, skippedByToken: false };
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    const skippedByToken = currentContent.includes('—— 日记 (DailyNote) ——')
        || /{{\s*(StudyLogTool|DailyNoteTool|VarDailyNoteGuide)\s*}}/.test(currentContent);
    if (skippedByToken) {
        return { messages: nextMessages, appended: false, skippedByToken: true };
    }

    nextMessages[systemMessageIndex] = {
        ...systemMessage,
        content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
    };

    return { messages: nextMessages, appended: true, skippedByToken: false };
}

/**
 * Initializes settings and theme related IPC handlers.
 * @param {object} paths - An object containing required paths.
 * @param {string} paths.SETTINGS_FILE - The path to the settings.json file.
 * @param {string} paths.USER_AVATAR_FILE - The path to the user_avatar.png file.
 * @param {string} paths.AGENT_DIR - The path to the agents directory.
 * @param {object} paths.settingsManager - The AppSettingsManager instance.
 */
function initialize(paths) {
    const {
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        AGENT_DIR,
        DATA_ROOT,
        PROJECT_ROOT,
        settingsManager,
        agentConfigManager,
    } = paths;
    const WEBINDEX_MODEL_FILE = path.join(path.dirname(SETTINGS_FILE), 'webindexmodel.json');

    if (initialized) {
        return;
    }

    // Settings Management
    ipcMain.handle('load-settings', async () => {
        try {
            const settings = await settingsManager.readSettings();
            
            // Check for user avatar
            if (await fs.pathExists(USER_AVATAR_FILE)) {
                settings.userAvatarUrl = `file://${USER_AVATAR_FILE}?t=${Date.now()}`;
            } else {
                settings.userAvatarUrl = null; // Or a default path
            }
            
            return settings;
        } catch (error) {
            console.error('加载设置失败:', error);
            return {
                error: error.message,
                sidebarWidth: 260,
                notificationsSidebarWidth: 300,
                userAvatarUrl: null,
            };
        }
    });

    ipcMain.handle('save-settings', async (event, settings) => {
        try {
            // User avatar URL is handled by 'save-user-avatar', remove it from general settings to avoid saving a file path
            // Also protect order fields from being accidentally overwritten by stale renderer snapshots.
            const {
                userAvatarUrl,
                combinedItemOrder,
                agentOrder,
                ...settingsToSave
            } = settings;

            const requestedPersistenceFields = collectRequestedPersistenceFields(settingsToSave);
            const result = await settingsManager.updateSettings(settingsToSave);
            let persistedSettings = await settingsManager.readSettings();

            let rawPersistedSettings = null;
            try {
                rawPersistedSettings = await fs.readJson(SETTINGS_FILE);
            } catch (readError) {
                console.warn('[SettingsHandlers] Failed to read persisted settings for verification:', readError);
            }

            let persistenceSummary = buildPersistenceFieldChecks(rawPersistedSettings, requestedPersistenceFields);
            let repairedMissingFields = false;

            if (rawPersistedSettings && persistenceSummary.mismatchedFields.length > 0) {
                const repairedSettings = {
                    ...persistedSettings,
                    studyLogPolicy: {
                        ...(persistedSettings.studyLogPolicy || {}),
                    },
                };

                persistenceSummary.mismatchedFields.forEach((fieldId) => {
                    const spec = requestedPersistenceFields[fieldId];
                    if (spec) {
                        writeOwnPathValue(repairedSettings, spec.path, spec.requestedValue);
                    }
                });

                await settingsManager.writeSettings(repairedSettings);
                repairedMissingFields = true;
                persistedSettings = await settingsManager.readSettings();

                try {
                    rawPersistedSettings = await fs.readJson(SETTINGS_FILE);
                } catch (readError) {
                    console.warn('[SettingsHandlers] Failed to reread persisted settings after repair:', readError);
                    rawPersistedSettings = null;
                }

                persistenceSummary = buildPersistenceFieldChecks(rawPersistedSettings, requestedPersistenceFields);
            }

            const agentBubbleThemePromptCheck = persistenceSummary.fieldChecks.agentBubbleThemePrompt;
            const enableAgentBubbleThemeCheck = persistenceSummary.fieldChecks.enableAgentBubbleTheme;

            return {
                ...result,
                settings: persistedSettings,
                persistenceCheck: {
                    rawSettingsAvailable: Boolean(rawPersistedSettings),
                    repairedMissingFields,
                    fieldChecks: persistenceSummary.fieldChecks,
                    mismatchedFields: persistenceSummary.mismatchedFields,
                    allRequestedFieldsMatched: persistenceSummary.mismatchedFields.length === 0,
                    rawHasAgentBubbleThemePromptField: agentBubbleThemePromptCheck?.rawFieldPresent === true,
                    rawHasEnableAgentBubbleThemeField: enableAgentBubbleThemeCheck?.rawFieldPresent === true,
                    agentBubbleThemePromptMatched: agentBubbleThemePromptCheck?.matched !== false,
                    enableAgentBubbleThemeMatched: enableAgentBubbleThemeCheck?.matched !== false,
                    promptToggleFieldsMatched: [
                        'enableRenderingPrompt',
                        'enableEmoticonPrompt',
                        'enableAdaptiveBubbleTip',
                        'studyLogPolicy.enableDailyNotePromptVariables',
                        'studyLogPolicy.autoInjectDailyNoteProtocol',
                    ].every((fieldId) => persistenceSummary.fieldChecks[fieldId]?.matched !== false),
                },
            };
        } catch (error) {
            console.error('Failed to save settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('preview-agent-bubble-theme-prompt', async (_event, payload) => {
        try {
            const persistedSettings = await settingsManager.readSettings();
            const previewPayload = isPlainObject(payload) ? payload : {};
            const enabled = previewPayload.enabled === true;
            const prompt = typeof previewPayload.prompt === 'string'
                ? previewPayload.prompt
                : (persistedSettings.agentBubbleThemePrompt || DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
            const trimmedPrompt = prompt.trim();

            if (!enabled || !trimmedPrompt) {
                return {
                    enabled,
                    willInject: false,
                    rawPrompt: prompt,
                    resolvedPrompt: '',
                    unresolvedTokens: [],
                    substitutions: {},
                    variableSources: {},
                };
            }

            const previewSettings = isPlainObject(previewPayload.settings)
                ? { ...persistedSettings, ...previewPayload.settings }
                : persistedSettings;
            const previewContext = isPlainObject(previewPayload.context) ? previewPayload.context : {};
            const previewModelConfig = isPlainObject(previewPayload.modelConfig) ? previewPayload.modelConfig : {};
            const localResult = resolvePromptVariables(trimmedPrompt, {
                settings: previewSettings,
                context: previewContext,
                modelConfig: previewModelConfig,
            });
            const previewResult = {
                resolvedPrompt: localResult.resolvedPrompt,
                unresolvedTokens: localResult.unresolvedTokens,
                substitutions: localResult.substitutions,
                variableSources: localResult.variableSources,
            };

            return {
                enabled,
                willInject: true,
                rawPrompt: prompt,
                resolvedPrompt: previewResult.resolvedPrompt,
                unresolvedTokens: previewResult.unresolvedTokens,
                substitutions: previewResult.substitutions,
                variableSources: previewResult.variableSources,
                available: previewResult.available !== false,
                unavailable: previewResult.unavailable === true,
                errorCode: previewResult.errorCode || '',
            };
        } catch (error) {
            console.error('[SettingsHandlers] Failed to preview agent bubble theme prompt:', error);
            return {
                enabled: Boolean(payload?.enabled),
                willInject: false,
                rawPrompt: typeof payload?.prompt === 'string' ? payload.prompt : '',
                resolvedPrompt: '',
                unresolvedTokens: [],
                substitutions: {},
                variableSources: {},
                available: false,
                unavailable: true,
                error: error.message,
                errorCode: error.code || '',
            };
        }
    });

    ipcMain.handle('preview-final-system-prompt', async (_event, payload) => {
        try {
            const persistedSettings = await settingsManager.readSettings();
            const previewPayload = isPlainObject(payload) ? payload : {};
            const previewSettings = mergePreviewSettings(
                persistedSettings,
                isPlainObject(previewPayload.settings) ? previewPayload.settings : {}
            );
            const previewContext = isPlainObject(previewPayload.context) ? { ...previewPayload.context } : {};
            const previewModelConfig = isPlainObject(previewPayload.modelConfig) ? previewPayload.modelConfig : {};

            let agentConfig = null;
            if (previewContext.agentId && agentConfigManager && typeof agentConfigManager.readAgentConfig === 'function') {
                agentConfig = await agentConfigManager.readAgentConfig(previewContext.agentId, { allowDefault: true }).catch(() => null);
            }

            if (agentConfig) {
                if (!previewContext.agentName && typeof agentConfig.name === 'string') {
                    previewContext.agentName = agentConfig.name;
                }
                if (!previewContext.topicName && previewContext.topicId && Array.isArray(agentConfig.topics)) {
                    const matchedTopic = agentConfig.topics.find((topic) => topic?.id === previewContext.topicId);
                    if (matchedTopic?.name) {
                        previewContext.topicName = matchedTopic.name;
                    }
                }
            }

            let emoticonPromptData = {
                available: false,
                packCount: 0,
                packs: [],
                variables: {},
                promptTemplate: previewSettings.emoticonPrompt || DEFAULT_EMOTICON_PROMPT,
                resolvedPrompt: '',
            };
            try {
                emoticonPromptData = await loadBundledEmoticonPromptData({
                    dataRoot: DATA_ROOT,
                    projectRoot: PROJECT_ROOT,
                    settings: previewSettings,
                });
            } catch (error) {
                console.warn('[SettingsHandlers] Failed to load bundled emoticon prompt data:', error);
            }

            const promptResolutionOptions = {
                settings: previewSettings,
                agentConfig,
                context: {
                    ...previewContext,
                    emoticonPromptData,
                },
                modelConfig: previewModelConfig,
            };

            const basePrompt = typeof previewPayload.systemPrompt === 'string'
                ? previewPayload.systemPrompt
                : extractPromptTextFromLegacyConfig(agentConfig || {});
            let messages = basePrompt ? [{ role: 'system', content: basePrompt }] : [];

            const renderingPromptSource = sanitizeText(previewSettings.renderingPrompt)
                ? 'custom'
                : 'default';
            const emoticonPromptSource = sanitizeText(previewSettings.emoticonPrompt)
                ? 'custom'
                : 'default';
            const adaptiveBubbleSource = sanitizeText(previewSettings.adaptiveBubbleTip)
                ? 'custom'
                : 'default';
            const dailyNoteSource = sanitizeText(previewSettings.dailyNoteGuide)
                ? 'custom'
                : 'default';
            const bubbleThemeSource = sanitizeText(previewSettings.agentBubbleThemePrompt)
                ? 'custom'
                : 'default';

            const renderingRaw = previewSettings.enableRenderingPrompt === false
                ? ''
                : (sanitizeText(previewSettings.renderingPrompt) || DEFAULT_DIV_RENDER_INSTRUCTION);
            const emoticonRaw = previewSettings.enableEmoticonPrompt === false
                ? ''
                : (sanitizeText(previewSettings.emoticonPrompt) || DEFAULT_EMOTICON_PROMPT);
            const adaptiveBubbleRaw = previewSettings.enableAdaptiveBubbleTip === false
                ? ''
                : (sanitizeText(previewSettings.adaptiveBubbleTip) || DEFAULT_ADAPTIVE_BUBBLE_TIP);
            const studyLogEnabled = previewSettings.studyLogPolicy?.enabled !== false;
            const dailyNoteVariablesEnabled = studyLogEnabled
                && previewSettings.studyLogPolicy?.enableDailyNotePromptVariables !== false;
            const dailyNoteAutoInjectEnabled = studyLogEnabled
                && previewSettings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false;
            const dailyNoteRaw = !dailyNoteVariablesEnabled && !dailyNoteAutoInjectEnabled
                ? ''
                : resolveDailyNoteToolInstruction(previewSettings.dailyNoteGuide, {
                    agentConfig,
                    context: previewContext,
                });
            const bubbleThemeRaw = previewSettings.enableAgentBubbleTheme === true
                ? (sanitizeText(previewSettings.agentBubbleThemePrompt) || DEFAULT_AGENT_BUBBLE_THEME_PROMPT)
                : '';

            const normalizedMessages = normalizeLegacyStudyLogPromptMessages(messages);
            const bubbleThemeApplied = previewSettings.enableAgentBubbleTheme === true
                ? applyAgentBubbleTheme(normalizedMessages, previewSettings.agentBubbleThemePrompt)
                : { messages: normalizedMessages, appended: false };
            const emoticonApplied = applyEmoticonPrompt(
                bubbleThemeApplied.messages,
                previewSettings,
                promptResolutionOptions
            );
            const dailyNoteApplied = applyDailyNoteProtocol(
                emoticonApplied.messages,
                previewSettings,
                promptResolutionOptions
            );
            const resolution = resolvePromptMessageSet(dailyNoteApplied.messages, promptResolutionOptions);
            const finalSystemPrompt = resolution.messages.find((message) => message?.role === 'system')?.content || '';

            const renderingResolved = renderingRaw
                ? resolvePromptVariables(renderingRaw, promptResolutionOptions)
                : { resolvedPrompt: '', unresolvedTokens: [], substitutions: {}, variableSources: {} };
            const emoticonResolved = emoticonRaw
                ? resolvePromptVariables(emoticonRaw, promptResolutionOptions)
                : { resolvedPrompt: '', unresolvedTokens: [], substitutions: {}, variableSources: {} };
            const adaptiveBubbleResolved = adaptiveBubbleRaw
                ? resolvePromptVariables(adaptiveBubbleRaw, promptResolutionOptions)
                : { resolvedPrompt: '', unresolvedTokens: [], substitutions: {}, variableSources: {} };
            const dailyNoteResolved = dailyNoteRaw
                ? resolvePromptVariables(dailyNoteRaw, promptResolutionOptions)
                : { resolvedPrompt: '', unresolvedTokens: [], substitutions: {}, variableSources: {} };
            const bubbleThemeResolved = bubbleThemeRaw
                ? resolvePromptVariables(bubbleThemeRaw, promptResolutionOptions)
                : { resolvedPrompt: '', unresolvedTokens: [], substitutions: {}, variableSources: {} };

            const normalizedBasePrompt = rewriteLegacyStudyLogPromptText(basePrompt || '');
            const references = {
                renderingInBasePrompt: /{{\s*(VarDivRender|VarRendering)\s*}}/.test(normalizedBasePrompt),
                emoticonInBasePrompt: /{{\s*(VarEmoticonPrompt|VarEmojiPrompt)\s*}}/.test(normalizedBasePrompt),
                adaptiveInBasePrompt: /{{\s*VarAdaptiveBubbleTip\s*}}/.test(normalizedBasePrompt),
                dailyNoteInBasePrompt: /{{\s*(StudyLogTool|DailyNoteTool|VarDailyNoteGuide)\s*}}/.test(normalizedBasePrompt),
            };

            return {
                success: true,
                preview: {
                    agentName: previewContext.agentName || '',
                    topicName: previewContext.topicName || '',
                    hasBasePrompt: Boolean(basePrompt),
                    basePrompt: normalizedBasePrompt,
                    finalSystemPrompt,
                    unresolvedTokens: resolution.unresolvedTokens,
                    substitutions: resolution.substitutions,
                    variableSources: resolution.variableSources,
                    segments: {
                        rendering: {
                            enabled: previewSettings.enableRenderingPrompt !== false,
                            source: renderingPromptSource,
                            referencedInBasePrompt: references.renderingInBasePrompt,
                            rawPrompt: renderingRaw,
                            resolvedPrompt: renderingResolved.resolvedPrompt || '',
                        },
                        emoticonPrompt: {
                            enabled: previewSettings.enableEmoticonPrompt !== false,
                            available: emoticonPromptData.available === true,
                            packCount: emoticonPromptData.packCount || 0,
                            source: emoticonPromptSource,
                            referencedInBasePrompt: references.emoticonInBasePrompt,
                            appended: emoticonApplied.appended === true,
                            skippedBecausePromptAlreadyContainsVariable: emoticonApplied.skippedByToken === true,
                            skippedBecausePromptAlreadyContainsSameContent: emoticonApplied.skippedByDuplicate === true,
                            rawPrompt: emoticonRaw,
                            resolvedPrompt: emoticonResolved.resolvedPrompt || '',
                        },
                        adaptiveBubbleTip: {
                            enabled: previewSettings.enableAdaptiveBubbleTip !== false,
                            source: adaptiveBubbleSource,
                            referencedInBasePrompt: references.adaptiveInBasePrompt,
                            rawPrompt: adaptiveBubbleRaw,
                            resolvedPrompt: adaptiveBubbleResolved.resolvedPrompt || '',
                        },
                        dailyNoteVariable: {
                            enabled: dailyNoteVariablesEnabled,
                            source: dailyNoteSource,
                            referencedInBasePrompt: references.dailyNoteInBasePrompt,
                            rawPrompt: dailyNoteRaw,
                            resolvedPrompt: dailyNoteResolved.resolvedPrompt || '',
                        },
                        dailyNoteAutoInject: {
                            enabled: dailyNoteAutoInjectEnabled,
                            source: dailyNoteSource,
                            appended: dailyNoteApplied.appended === true,
                            skippedBecausePromptAlreadyContainsProtocol: dailyNoteApplied.skippedByToken === true,
                            rawPrompt: dailyNoteRaw,
                            resolvedPrompt: dailyNoteResolved.resolvedPrompt || '',
                        },
                        bubbleTheme: {
                            enabled: previewSettings.enableAgentBubbleTheme === true,
                            source: bubbleThemeSource,
                            appended: bubbleThemeApplied.appended === true,
                            rawPrompt: bubbleThemeRaw,
                            resolvedPrompt: bubbleThemeResolved.resolvedPrompt || '',
                        },
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                preview: null,
            };
        }
    });

    // New IPC Handler to save calculated avatar color
    ipcMain.handle('save-avatar-color', async (event, { type, id, color }) => {
        try {
            if (type === 'user') {
                const result = await settingsManager.updateSettings(settings => ({
                    ...settings,
                    userAvatarCalculatedColor: color
                }));
                console.log(`[Main] User avatar color saved: ${color}`);
                return result;
            } else if (type === 'agent' && id) {
                if (agentConfigManager) {
                    const result = await agentConfigManager.updateAgentConfig(id, config => ({
                        ...config,
                        avatarCalculatedColor: color
                    }));
                    console.log(`[Main] Agent ${id} avatar color saved: ${color}`);
                    return result;
                } else {
                    // Fallback path when AgentConfigManager is not available.
                    const configPath = path.join(AGENT_DIR, id, 'config.json');
                    if (await fs.pathExists(configPath)) {
                        let agentConfig;
                        // Fail fast if the config file cannot be parsed so we do not overwrite it with a broken payload.
                        try {
                            agentConfig = await fs.readJson(configPath);
                        } catch (parseError) {
                            console.error(`[Main] Error parsing agent config for ${id} to save avatar color:`, parseError);
                            return { success: false, error: `Failed to read agent config for ${id}: ${parseError.message}` };
                        }
                        
                        agentConfig.avatarCalculatedColor = color;
                        
                        // Write through a temp file first.
                        const tempConfigPath = configPath + '.tmp';
                        await fs.writeJson(tempConfigPath, agentConfig, { spaces: 2 });
                        
                        // Verify the temp file before replacing the source file.
                        const verifyContent = await fs.readFile(tempConfigPath, 'utf8');
                        JSON.parse(verifyContent);
                        
                        // Promote the verified temp file into place.
                        await fs.move(tempConfigPath, configPath, { overwrite: true });
                        
                        console.log(`[Main] Agent ${id} avatar color saved: ${color}`);
                        return { success: true };
                    } else {
                        return { success: false, error: `Agent config for ${id} not found.` };
                    }
                }
            }
            return { success: false, error: 'Invalid type or missing ID for saving avatar color.' };
        } catch (error) {
            console.error('Error saving avatar color:', error);
            
            // Clean up a temp file left by the fallback write path if needed.
            if (type === 'agent' && id && !agentConfigManager) {
                const tempConfigPath = path.join(AGENT_DIR, id, 'config.json') + '.tmp';
                if (await fs.pathExists(tempConfigPath)) {
                    await fs.remove(tempConfigPath).catch(() => {});
                }
            }
            
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-webindex-models', async () => {
        try {
            if (!await fs.pathExists(WEBINDEX_MODEL_FILE)) {
                return {
                    success: true,
                    exists: false,
                    path: WEBINDEX_MODEL_FILE,
                    models: [],
                    defaults: [],
                    remoteVoices: [],
                    mergedVoiceOptions: []
                };
            }

            const payload = await fs.readJson(WEBINDEX_MODEL_FILE);

            const defaults = Array.isArray(payload?.defaults) ? payload.defaults : [];
            const remoteVoices = Array.isArray(payload?.remoteVoices) ? payload.remoteVoices : [];
            const mergedVoiceOptions = Array.isArray(payload?.mergedVoiceOptions)
                ? payload.mergedVoiceOptions
                : [...defaults, ...remoteVoices];

            const legacyModels = Array.isArray(payload?.models) ? payload.models : [];
            const normalizedLegacyModels = legacyModels.flatMap(model => {
                if (Array.isArray(model?.mergedVoiceOptions) && model.mergedVoiceOptions.length) {
                    return model.mergedVoiceOptions;
                }
                const legacyDefaults = Array.isArray(model?.defaults) ? model.defaults : [];
                const legacyRemoteVoices = Array.isArray(model?.remoteVoices) ? model.remoteVoices : [];
                return [...legacyDefaults, ...legacyRemoteVoices];
            });

            return {
                success: true,
                exists: true,
                path: WEBINDEX_MODEL_FILE,
                models: mergedVoiceOptions.length ? mergedVoiceOptions : normalizedLegacyModels,
                defaults,
                remoteVoices,
                mergedVoiceOptions: mergedVoiceOptions.length ? mergedVoiceOptions : normalizedLegacyModels,
                updatedAt: payload?.updatedAt || null,
                source: payload?.source || 'unknown',
                providerUrl: payload?.providerUrl || null,
                modelId: payload?.modelId || null
            };
        } catch (error) {
            console.error('Failed to read webindexmodel.json:', error);
            return {
                success: false,
                error: error.message,
                path: WEBINDEX_MODEL_FILE,
                models: [],
                defaults: [],
                remoteVoices: [],
                mergedVoiceOptions: []
            };
        }
    });

    // Recovery is handled inside SettingsManager.

    initialized = true;
}

module.exports = {
    initialize
};

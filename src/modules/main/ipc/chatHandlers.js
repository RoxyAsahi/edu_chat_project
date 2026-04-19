// modules/ipc/chatHandlers.js
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const contextSanitizer = require('../contextSanitizer');
const knowledgeBase = require('../knowledge-base');
const vcpClient = require('../vcpClient');
const { resolvePromptMessageSet } = require('../utils/promptVariableResolver');
const { loadBundledEmoticonPromptData } = require('../emoticons/bundledCatalog');
const {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE,
    DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE,
} = require('../utils/settingsSchema');
const {
    TASK_KEY_BY_LEGACY_SETTINGS_KEY,
    normalizeModelService,
    resolveDefaultModelRef,
    resolveExecutionConfig,
} = require('../utils/modelService');
const { createStudyServices } = require('../study');
const {
    buildDefaultPlaceholderTopic,
    buildPlaceholderTopicName,
} = require('../utils/topicTitles');
const {
    extractResponseContent,
    resolveDailyNoteToolInstruction,
    rewriteLegacyStudyLogPromptText,
} = require('../study/toolProtocol');

/**
 * Initializes chat and topic related IPC handlers.
 * @param {BrowserWindow|function(): BrowserWindow|null} mainWindow The main window instance or getter.
 * @param {object} context - An object containing necessary context.
 * @param {string} context.AGENT_DIR - The path to the agents directory.
 * @param {string} context.USER_DATA_DIR - The path to the user data directory.
 * @param {string} context.DATA_ROOT - The path to the app data root.
 * @param {function} context.getSelectionListenerStatus - Function to get the current status of the selection listener.
 * @param {function} context.stopSelectionListener - Function to stop the selection listener.
 * @param {function} context.startSelectionListener - Function to start the selection listener.
 */
let ipcHandlersRegistered = false;
let studyServices = null;
const DEFAULT_CHAT_MODEL = 'gemini-3.1-flash-lite-preview';
const FOLLOW_UP_HISTORY_LIMIT = 6;
const FOLLOW_UP_RESULT_LIMIT = 5;
const FOLLOW_UP_MESSAGE_CHAR_LIMIT = 900;
const FOLLOW_UP_HISTORY_CHAR_LIMIT = 2600;
const FOLLOW_UP_MAX_ATTEMPTS = 3;
const TOPIC_TITLE_HISTORY_LIMIT = 2;
const TOPIC_TITLE_FALLBACK_LIMIT = 60;
const FOLLOW_UP_TOOL_BLOCK_REGEX = /<<<\[TOOL_REQUEST\]>>>[\s\S]*?<<<\[END_TOOL_REQUEST\]>>>/g;
const FOLLOW_UP_CODE_FENCE_REGEX = /```[\s\S]*?```/g;
const FOLLOW_UP_HTML_BLOCK_REGEX = /<(style|script|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const FOLLOW_UP_BUTTON_REGEX = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
const FOLLOW_UP_BLOCK_TAG_REGEX = /<\/?(address|article|aside|blockquote|br|caption|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;

function decodeFollowUpEntities(text = '') {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function stripFollowUpHtml(text = '') {
    return decodeFollowUpEntities(text)
        .replace(FOLLOW_UP_HTML_BLOCK_REGEX, ' ')
        .replace(FOLLOW_UP_BUTTON_REGEX, (_match, label) => {
            const normalizedLabel = decodeFollowUpEntities(String(label || ''))
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            return normalizedLabel
                ? `\n[交互按钮：${normalizedLabel}]\n`
                : '\n[交互按钮已省略]\n';
        })
        .replace(FOLLOW_UP_BLOCK_TAG_REGEX, '\n')
        .replace(/<[^>]+>/g, ' ');
}

function truncateFollowUpText(text = '', limit = FOLLOW_UP_MESSAGE_CHAR_LIMIT) {
    const normalized = String(text || '').trim();
    if (!normalized || !Number.isFinite(limit) || limit <= 0 || normalized.length <= limit) {
        return normalized;
    }

    const ellipsis = '\n[...省略...]\n';
    const headLength = Math.max(120, Math.ceil(limit * 0.65));
    const tailLength = Math.max(80, limit - headLength - ellipsis.length);

    return `${normalized.slice(0, headLength).trim()}${ellipsis}${normalized.slice(-tailLength).trim()}`.trim();
}

function sanitizeFollowUpText(text = '', limit = FOLLOW_UP_MESSAGE_CHAR_LIMIT) {
    const normalized = contextSanitizer.stripThoughtChains(String(text || ''))
        .replace(/\r/g, '')
        .replace(FOLLOW_UP_TOOL_BLOCK_REGEX, '\n[工具调用已省略]\n')
        .replace(FOLLOW_UP_CODE_FENCE_REGEX, '\n[代码块已省略]\n');

    return truncateFollowUpText(
        stripFollowUpHtml(normalized)
            .replace(/^\s{0,3}#{1,6}\s*/gm, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/__(.*?)__/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/[ \t\f\v]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        limit
    );
}

function enforceFollowUpHistoryBudget(messages = [], maxChars = FOLLOW_UP_HISTORY_CHAR_LIMIT) {
    const normalizedMessages = (Array.isArray(messages) ? messages : []).map((message) => ({
        ...message,
        content: String(message?.content || '').trim(),
    }));
    const currentTotal = normalizedMessages.reduce((sum, message) => sum + message.content.length, 0);
    if (currentTotal <= maxChars || normalizedMessages.length === 0) {
        return normalizedMessages;
    }

    const perMessageLimit = Math.max(180, Math.floor(maxChars / normalizedMessages.length));
    const compactMessages = normalizedMessages.map((message) => ({
        ...message,
        content: truncateFollowUpText(message.content, Math.min(FOLLOW_UP_MESSAGE_CHAR_LIMIT, perMessageLimit)),
    }));
    const compactTotal = compactMessages.reduce((sum, message) => sum + message.content.length, 0);
    if (compactTotal <= maxChars) {
        return compactMessages;
    }

    const emergencyLimit = Math.max(120, Math.floor(maxChars / compactMessages.length) - 24);
    return compactMessages.map((message) => ({
        ...message,
        content: truncateFollowUpText(message.content, emergencyLimit),
    }));
}

function buildFollowUpRetryPrompt(prompt = '') {
    const reminder = [
        '上一次输出不符合要求。',
        '请重新生成 3 条简短追问，并且只返回一个完整、可解析的 JSON 对象。',
        '禁止输出解释、标题、Markdown、代码块或多余文本。',
    ].join('\n');

    return `${String(prompt || '').trim()}\n\n${reminder}`.trim();
}

function normalizeMessageForPreprocessing(message) {
    if (!message || typeof message !== 'object') {
        return { role: 'system', content: '[Invalid message]' };
    }

    let content = message.content;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
        if (typeof content.text === 'string') {
            content = content.text;
        } else {
            content = JSON.stringify(content);
        }
    }

    if (content !== undefined && !Array.isArray(content) && typeof content !== 'string') {
        content = String(content);
    }

    const normalized = {
        role: message.role,
        content,
    };

    if (message.name) normalized.name = message.name;
    if (message.tool_calls) normalized.tool_calls = message.tool_calls;
    if (message.tool_call_id) normalized.tool_call_id = message.tool_call_id;

    return normalized;
}

function stripThoughtChains(messages) {
    return messages.map((message) => {
        if (typeof message.content === 'string') {
            return { ...message, content: contextSanitizer.stripThoughtChains(message.content) };
        }

        if (Array.isArray(message.content)) {
            return {
                ...message,
                content: message.content.map((part) => {
                    if (part?.type === 'text' && typeof part.text === 'string') {
                        return { ...part, text: contextSanitizer.stripThoughtChains(part.text) };
                    }
                    return part;
                }),
            };
        }

        return message;
    });
}

function applyAgentBubbleTheme(messages, injectionPrompt = DEFAULT_AGENT_BUBBLE_THEME_PROMPT) {
    const normalizedPrompt = typeof injectionPrompt === 'string' ? injectionPrompt.trim() : '';
    if (!normalizedPrompt) {
        return messages;
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: '' });
        systemMessageIndex = 0;
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    if (!currentContent.includes(normalizedPrompt)) {
        nextMessages[systemMessageIndex] = {
            ...systemMessage,
            content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
        };
    }

    return nextMessages;
}

function applyEmoticonPrompt(messages, settings = {}, promptResolutionOptions = {}) {
    if (settings?.enableEmoticonPrompt === false) {
        return messages;
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
        return messages;
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: normalizedPrompt });
        return nextMessages;
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    const alreadyReferenced = /{{\s*(VarEmoticonPrompt|VarEmojiPrompt)\s*}}/.test(currentContent);
    const alreadyIncluded = currentContent.includes(normalizedPrompt)
        || (resolvedPrompt ? currentContent.includes(resolvedPrompt) : false);
    if (alreadyReferenced || alreadyIncluded) {
        return nextMessages;
    }

    nextMessages[systemMessageIndex] = {
        ...systemMessage,
        content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
    };

    return nextMessages;
}

function applyDailyNoteProtocol(messages, settings = {}, promptResolutionOptions = {}) {
    if (settings?.studyLogPolicy?.enabled === false) {
        return messages;
    }
    if (settings?.studyLogPolicy?.autoInjectDailyNoteProtocol === false) {
        return messages;
    }

    const dailyNotePrompt = resolveDailyNoteToolInstruction(settings?.dailyNoteGuide, {
        agentConfig: promptResolutionOptions.agentConfig,
        context: promptResolutionOptions.context,
    });
    const normalizedPrompt = typeof dailyNotePrompt === 'string' ? dailyNotePrompt.trim() : '';
    if (!normalizedPrompt) {
        return messages;
    }

    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: normalizedPrompt });
        return nextMessages;
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    if (
        currentContent.includes('—— 日记 (DailyNote) ——')
        || /{{\s*(StudyLogTool|DailyNoteTool|VarDailyNoteGuide)\s*}}/.test(currentContent)
    ) {
        return nextMessages;
    }

    nextMessages[systemMessageIndex] = {
        ...systemMessage,
        content: `${currentContent}\n\n${normalizedPrompt}`.trim(),
    };

    return nextMessages;
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

function applyContextSanitizer(messages, settings) {
    if (settings.enableContextSanitizer !== true) {
        return messages;
    }

    const sanitizerDepth = settings.contextSanitizerDepth !== undefined
        ? settings.contextSanitizerDepth
        : 2;
    const systemMessages = messages.filter((message) => message.role === 'system');
    const nonSystemMessages = messages.filter((message) => message.role !== 'system');
    const sanitizedMessages = contextSanitizer.sanitizeMessages(
        nonSystemMessages,
        sanitizerDepth,
        settings.enableThoughtChainInjection === true
    );

    return [...systemMessages, ...sanitizedMessages];
}

async function buildPromptResolutionOptions({
    settings,
    context,
    modelConfig,
    agentConfigManager,
    dataRoot = '',
    projectRoot = '',
}) {
    const nextContext = { ...(context || {}) };
    let agentConfig = null;

    if (nextContext.agentId && agentConfigManager && typeof agentConfigManager.readAgentConfig === 'function') {
        try {
            agentConfig = await agentConfigManager.readAgentConfig(nextContext.agentId);
        } catch (error) {
            console.warn(`[Main - sendToVCP] Failed to read agent config for prompt resolution (${nextContext.agentId}):`, error);
        }
    }

    if (agentConfig) {
        if (!nextContext.agentName && typeof agentConfig.name === 'string') {
            nextContext.agentName = agentConfig.name;
        }

        if (!nextContext.topicName && nextContext.topicId && Array.isArray(agentConfig.topics)) {
            const matchedTopic = agentConfig.topics.find((topic) => topic?.id === nextContext.topicId);
            if (matchedTopic?.name) {
                nextContext.topicName = matchedTopic.name;
            }
        }
    }

    try {
        nextContext.emoticonPromptData = await loadBundledEmoticonPromptData({
            dataRoot,
            projectRoot,
            settings,
        });
    } catch (error) {
        console.warn('[Main - sendToVCP] Failed to load bundled emoticon prompt data:', error);
        nextContext.emoticonPromptData = {
            available: false,
            packCount: 0,
            packs: [],
            variables: {},
            promptTemplate: '',
            resolvedPrompt: '',
        };
    }

    return {
        settings,
        agentConfig,
        context: nextContext,
        modelConfig,
    };
}

function flattenFollowUpMessageContent(content) {
    if (typeof content === 'string') {
        return sanitizeFollowUpText(content);
    }

    if (Array.isArray(content)) {
        return sanitizeFollowUpText(content
            .map((part) => {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    return part.text.trim();
                }
                if (part?.type === 'image_url') {
                    return '[图片]';
                }
                if (typeof part?.content === 'string') {
                    return part.content.trim();
                }
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim());
    }

    if (content && typeof content === 'object') {
        if (typeof content.text === 'string') {
            return sanitizeFollowUpText(content.text);
        }

        try {
            return sanitizeFollowUpText(JSON.stringify(content));
        } catch (_error) {
            return sanitizeFollowUpText(String(content));
        }
    }

    if (content === null || content === undefined) {
        return '';
    }

    return sanitizeFollowUpText(String(content));
}

function selectVisibleFollowUpMessages(messages = [], limit = FOLLOW_UP_HISTORY_LIMIT) {
    const visibleMessages = (Array.isArray(messages) ? messages : [])
        .filter((message) => (
            message
            && (message.role === 'user' || message.role === 'assistant')
            && message.isThinking !== true
        ))
        .map((message) => ({
            role: message.role,
            content: flattenFollowUpMessageContent(message.content),
        }))
        .filter((message) => message.content)
        .slice(-limit);

    return enforceFollowUpHistoryBudget(visibleMessages);
}

function formatFollowUpChatHistory(messages = []) {
    return selectVisibleFollowUpMessages(messages)
        .map((message, index) => {
            const speaker = message.role === 'user' ? '用户' : '助手';
            return `[${index + 1}] ${speaker}:\n${message.content}`;
        })
        .join('\n\n')
        .trim();
}

function buildFollowUpPrompt(template = '', messages = []) {
    const chatHistory = formatFollowUpChatHistory(messages);
    const promptTemplate = typeof template === 'string' && template.trim()
        ? template
        : DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE;

    if (!chatHistory) {
        return promptTemplate.replace(/{{CHAT_HISTORY}}/g, '');
    }

    if (promptTemplate.includes('{{CHAT_HISTORY}}')) {
        return promptTemplate.replace(/{{CHAT_HISTORY}}/g, chatHistory);
    }

    return `${promptTemplate.trim()}\n\n${chatHistory}`.trim();
}

function buildTopicTitlePrompt(template = '', messages = []) {
    const chatHistory = formatFollowUpChatHistory(messages);
    const promptTemplate = typeof template === 'string' && template.trim()
        ? template
        : DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE;

    if (!chatHistory) {
        return promptTemplate.replace(/{{CHAT_HISTORY}}/g, '');
    }

    if (promptTemplate.includes('{{CHAT_HISTORY}}')) {
        return promptTemplate.replace(/{{CHAT_HISTORY}}/g, chatHistory);
    }

    return `${promptTemplate.trim()}\n\n${chatHistory}`.trim();
}

function stripJsonCodeFence(text = '') {
    const trimmed = String(text || '').trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function normalizeFollowUps(followUps = []) {
    return [...new Set(
        (Array.isArray(followUps) ? followUps : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )].slice(0, FOLLOW_UP_RESULT_LIMIT);
}

function extractJsonCandidates(text = '') {
    const normalized = stripJsonCodeFence(text);
    const candidates = [normalized];
    const objectStart = normalized.indexOf('{');
    const objectEnd = normalized.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
        candidates.push(normalized.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = normalized.indexOf('[');
    const arrayEnd = normalized.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
        candidates.push(normalized.slice(arrayStart, arrayEnd + 1));
    }

    return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function parseFollowUpsResponse(responseText = '') {
    for (const candidate of extractJsonCandidates(responseText)) {
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) {
                return normalizeFollowUps(parsed);
            }
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.follow_ups)) {
                    return normalizeFollowUps(parsed.follow_ups);
                }
                if (Array.isArray(parsed.followUps)) {
                    return normalizeFollowUps(parsed.followUps);
                }
            }
        } catch (_error) {
            // Ignore invalid candidates and keep trying.
        }
    }

    return [];
}

function normalizeTopicTitle(title = '') {
    return String(title || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractFirstUserTitleFallback(messages = [], maxLength = TOPIC_TITLE_FALLBACK_LIMIT) {
    const firstUserMessage = (Array.isArray(messages) ? messages : [])
        .find((message) => message?.role === 'user');
    const normalized = normalizeTopicTitle(flattenFollowUpMessageContent(firstUserMessage?.content));
    if (!normalized) {
        return '';
    }

    if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength).trim()}...`;
}

function parseTopicTitleResponse(responseText = '', fallbackTitle = '') {
    for (const candidate of extractJsonCandidates(responseText)) {
        try {
            const parsed = JSON.parse(candidate);
            if (typeof parsed === 'string') {
                const normalizedStringTitle = normalizeTopicTitle(parsed);
                if (normalizedStringTitle) {
                    return normalizedStringTitle;
                }
            }

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const normalizedObjectTitle = normalizeTopicTitle(parsed.title);
                if (normalizedObjectTitle) {
                    return normalizedObjectTitle;
                }
            }
        } catch (_error) {
            // Ignore invalid candidates and keep trying.
        }
    }

    return normalizeTopicTitle(fallbackTitle);
}

async function requestFollowUpsOnce({
    attempt = 1,
    requestIdBase = '',
    endpoint = '',
    apiKey = '',
    extraHeaders = {},
    prompt = '',
    model = '',
    context = {},
}) {
    const response = await vcpClient.send({
        requestId: `${requestIdBase}_attempt_${attempt}`,
        round: attempt,
        endpoint,
        apiKey,
        extraHeaders,
        messages: [{
            role: 'user',
            content: attempt === 1 ? prompt : buildFollowUpRetryPrompt(prompt),
        }],
        modelConfig: {
            model,
            stream: false,
            temperature: 0,
            max_tokens: 1200,
            response_format: { type: 'json_object' },
        },
        context,
        timeoutMs: 120000,
    });

    if (response?.error) {
        return {
            error: response.error,
            followUps: [],
            rawContent: '',
        };
    }

    const rawContent = extractResponseContent(response?.response || {});
    return {
        rawContent,
        followUps: parseFollowUpsResponse(rawContent),
    };
}

function resolvePreferredTaskKey(preferredSettingsKeys = []) {
    for (const settingsKey of Array.isArray(preferredSettingsKeys) ? preferredSettingsKeys : []) {
        const taskKey = TASK_KEY_BY_LEGACY_SETTINGS_KEY[settingsKey];
        if (taskKey) {
            return taskKey;
        }
    }
    return null;
}

async function resolveTaskModel({
    agentId = '',
    requestedModel = '',
    settings = {},
    agentConfigManager = null,
    logLabel = 'task',
    preferredSettingsKeys = [],
}) {
    const preferredTaskKey = resolvePreferredTaskKey(preferredSettingsKeys);
    if (preferredTaskKey && settings?.modelService) {
        const modelService = normalizeModelService(settings.modelService);
        const resolvedDefault = resolveDefaultModelRef(modelService, preferredTaskKey);
        if (resolvedDefault?.model?.id) {
            return resolvedDefault.model.id;
        }
    }

    for (const settingsKey of Array.isArray(preferredSettingsKeys) ? preferredSettingsKeys : []) {
        if (typeof settings?.[settingsKey] === 'string' && settings[settingsKey].trim()) {
            return settings[settingsKey].trim();
        }
    }

    if (agentId && agentConfigManager && typeof agentConfigManager.readAgentConfig === 'function') {
        try {
            const agentConfig = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
            if (typeof agentConfig?.model === 'string' && agentConfig.model.trim()) {
                return agentConfig.model.trim();
            }
        } catch (error) {
            console.warn(`[Main - ${logLabel}] Failed to read agent config for ${agentId}:`, error);
        }
    }

    if (typeof settings?.defaultModel === 'string' && settings.defaultModel.trim()) {
        return settings.defaultModel.trim();
    }

    if (typeof requestedModel === 'string' && requestedModel.trim()) {
        return requestedModel.trim();
    }

    return DEFAULT_CHAT_MODEL;
}

async function resolveFollowUpModel({
    agentId = '',
    requestedModel = '',
    settings = {},
    agentConfigManager = null,
}) {
    return resolveTaskModel({
        agentId,
        requestedModel,
        settings,
        agentConfigManager,
        logLabel: 'generate-follow-ups',
        preferredSettingsKeys: ['followUpDefaultModel'],
    });
}

function initialize(mainWindow, context) {
    const {
        AGENT_DIR,
        USER_DATA_DIR,
        DATA_ROOT,
        PROJECT_ROOT,
        fileWatcher,
        settingsManager,
        agentConfigManager,
        getSelectionListenerStatus = () => false,
        stopSelectionListener = () => false,
        startSelectionListener = () => false,
    } = context;
    const getMainWindow = typeof context.getMainWindow === 'function'
        ? context.getMainWindow
        : (typeof mainWindow === 'function' ? mainWindow : () => mainWindow || null);

    vcpClient.initialize({ settingsManager });
    studyServices = createStudyServices({
        dataRoot: DATA_ROOT,
        settingsManager,
        vcpClient,
    });

    // Ensure the watcher is in a clean state on initialization
    if (fileWatcher) {
        fileWatcher.stopWatching();
    }

    if (ipcHandlersRegistered) {
        return;
    }

    ipcMain.handle('save-topic-order', async (event, agentId, orderedTopicIds) => {
        if (!agentId || !Array.isArray(orderedTopicIds)) {
            return { success: false, error: 'Invalid agentId or topic IDs.' };
        }
        try {
            if (agentConfigManager) {
                await agentConfigManager.updateAgentConfig(agentId, config => {
                    if (!config.topics || !Array.isArray(config.topics)) {
                        return config;
                    }
                    const topicMap = new Map(config.topics.map(topic => [topic.id, topic]));
                    const newTopicsArray = [];
                    orderedTopicIds.forEach(id => {
                        if (topicMap.has(id)) {
                            newTopicsArray.push(topicMap.get(id));
                            topicMap.delete(id);
                        }
                    });
                    newTopicsArray.push(...topicMap.values());
                    return { ...config, topics: newTopicsArray };
                });
            } else {
                return { success: false, error: 'AgentConfigManager is unavailable.' };
            }
            return { success: true };
        } catch (error) {
            console.error(`Error saving topic order for agent ${agentId}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('search-topics-by-content', async (event, itemId, itemType, searchTerm) => {
        if (!itemId || itemType !== 'agent' || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
            return { success: false, error: 'Invalid arguments for topic content search.', matchedTopicIds: [] };
        }
        const searchTermLower = searchTerm.toLowerCase();
        const matchedTopicIds = [];

        try {
            const configPath = path.join(AGENT_DIR, itemId, 'config.json');
            if (!await fs.pathExists(configPath)) {
                return { success: true, matchedTopicIds: [] };
            }

            const itemConfig = await fs.readJson(configPath);
            if (!itemConfig || !Array.isArray(itemConfig.topics)) {
                return { success: true, matchedTopicIds: [] };
            }

            for (const topic of itemConfig.topics) {
                const historyFilePath = path.join(USER_DATA_DIR, itemId, 'topics', topic.id, 'history.json');
                if (!await fs.pathExists(historyFilePath)) {
                    continue;
                }
                try {
                    const history = await fs.readJson(historyFilePath);
                    if (Array.isArray(history) && history.some(message => typeof message.content === 'string' && message.content.toLowerCase().includes(searchTermLower))) {
                        matchedTopicIds.push(topic.id);
                    }
                } catch (e) {
                    console.error(`Error reading history for agent ${itemId}, topic ${topic.id}:`, e);
                }
            }

            return { success: true, matchedTopicIds: [...new Set(matchedTopicIds)] };
        } catch (error) {
            console.error(`Error searching topic content for agent ${itemId}:`, error);
            return { success: false, error: error.message, matchedTopicIds: [] };
        }
    });

    ipcMain.handle('save-agent-topic-title', async (event, agentId, topicId, newTitle) => {
        if (!topicId || !newTitle) return { error: 'Missing topicId or newTitle.' };
        try {
            if (agentConfigManager) {
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => {
                    if (!existingConfig.topics || !Array.isArray(existingConfig.topics)) {
                        return existingConfig;
                    }
                    const updatedConfig = { ...existingConfig, topics: [...existingConfig.topics] };
                    const topicIndex = updatedConfig.topics.findIndex(t => t.id === topicId);
                    if (topicIndex !== -1) {
                        updatedConfig.topics[topicIndex] = { ...updatedConfig.topics[topicIndex], name: newTitle };
                    }
                    return updatedConfig;
                });
                const updatedConfig = await agentConfigManager.readAgentConfig(agentId);
                return { success: true, topics: updatedConfig.topics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely save topic title for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to save topic title for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('get-chat-history', async (event, agentId, topicId) => {
        if (!topicId) return { error: `Missing topicId for agent ${agentId}.` };
        try {
            const historyFile = path.join(USER_DATA_DIR, agentId, 'topics', topicId, 'history.json');
            await fs.ensureDir(path.dirname(historyFile));


            if (await fs.pathExists(historyFile)) {
                return await fs.readJson(historyFile);
            }
            return [];
        } catch (error) {
            console.error(`Failed to load chat history for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('save-chat-history', async (event, agentId, topicId, history) => {
        if (!topicId) return { error: `Missing topicId for agent ${agentId}.` };
        try {
            if (fileWatcher) {
                fileWatcher.signalInternalSave();
            }
            const historyDir = path.join(USER_DATA_DIR, agentId, 'topics', topicId);
            await fs.ensureDir(historyDir);
            const historyFile = path.join(historyDir, 'history.json');
            await fs.writeJson(historyFile, history, { spaces: 2 });
            return { success: true };
        } catch (error) {
            console.error(`Failed to save chat history for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('get-agent-topics', async (event, agentId) => {
        try {
            let config;
            if (agentConfigManager) {
                try {
                    config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                } catch (readError) {
                    console.error(`Failed to read config for agent ${agentId} (get-agent-topics):`, readError);
                    return { error: `Failed to read config file: ${readError.message}` };
                }
            } else {
                const configPath = path.join(AGENT_DIR, agentId, 'config.json');
                if (await fs.pathExists(configPath)) {
                    try {
                        config = await fs.readJson(configPath);
                    } catch (readError) {
                        console.error(`Failed to read config.json for agent ${agentId}:`, readError);
                        return { error: `Failed to read config file: ${readError.message}` };
                    }
                }
            }

            if (config && config.topics && Array.isArray(config.topics)) {
                // Part A: 鍘嗗彶鏁版嵁鍏煎澶勭悊 - 鑷姩涓虹己灏戞柊瀛楁鐨勮瘽棰樻坊鍔犻粯璁わ拷?
                const normalizedTopics = config.topics.map(topic => ({
                    ...topic,
                    locked: topic.locked !== undefined ? topic.locked : true,
                    unread: topic.unread !== undefined ? topic.unread : false,
                    creatorSource: topic.creatorSource || 'unknown',
                    knowledgeBaseId: topic.knowledgeBaseId || null,
                }));
                return normalizedTopics;
            }
            return [];
        } catch (error) {
            console.error(`Failed to load topics for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('create-new-topic-for-agent', async (event, agentId, topicName, isBranch = false, locked = true) => {
        try {
            const newTopicId = `topic_${Date.now()}`;
            const timestamp = Date.now();

            if (agentConfigManager) {
                // Read the current config first so the fallback topic number is stable.
                const currentConfig = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                if (currentConfig.topics && !Array.isArray(currentConfig.topics)) {
                    return { error: `Invalid topics array in agent config.` };
                }
                const existingTopics = currentConfig.topics || [];

                const newTopic = {
                    id: newTopicId,
                    name: typeof topicName === 'string' && topicName.trim()
                        ? topicName.trim()
                        : buildPlaceholderTopicName(existingTopics),
                    createdAt: timestamp,
                    locked: locked,
                    unread: false,
                    creatorSource: "ui",
                    knowledgeBaseId: null,
                };
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => ({
                    ...existingConfig,
                    topics: [newTopic, ...(existingConfig.topics || [])]
                }));
                const updatedConfig = await agentConfigManager.readAgentConfig(agentId);

                const topicHistoryDir = path.join(USER_DATA_DIR, agentId, 'topics', newTopicId);
                await fs.ensureDir(topicHistoryDir);
                await fs.writeJson(path.join(topicHistoryDir, 'history.json'), [], { spaces: 2 });

                return { success: true, topicId: newTopicId, topicName: newTopic.name, topics: updatedConfig.topics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely create topic for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to create a topic for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('delete-topic', async (event, agentId, topicIdToDelete) => {
        try {
            if (agentConfigManager) {
                // Read the current config before validating the deletion target.
                const currentConfig = await agentConfigManager.readAgentConfig(agentId);
                if (!currentConfig.topics || !Array.isArray(currentConfig.topics)) {
                    return { error: 'Agent topics are unavailable.' };
                }
                const topicToDelete = currentConfig.topics.find(t => t.id === topicIdToDelete);
                if (!topicToDelete) {
                    return { error: `Topic not found: ${topicIdToDelete}` };
                }
                const knowledgeBaseId = topicToDelete.knowledgeBaseId || null;

                let remainingTopics;
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => {
                    let filtered = (existingConfig.topics || []).filter(topic => topic.id !== topicIdToDelete);
                    if (filtered.length === 0) {
                        filtered = [buildDefaultPlaceholderTopic()];
                    }
                    remainingTopics = filtered;
                    return { ...existingConfig, topics: filtered };
                });

                // Recreate the default history file when the last topic is deleted.
                if (remainingTopics.length === 1 && remainingTopics[0].id === 'default') {
                    const defaultTopicHistoryDir = path.join(USER_DATA_DIR, agentId, 'topics', 'default');
                    await fs.ensureDir(defaultTopicHistoryDir);
                    const historyPath = path.join(defaultTopicHistoryDir, 'history.json');
                    if (!await fs.pathExists(historyPath)) {
                        await fs.writeJson(historyPath, [], { spaces: 2 });
                    }
                }

                const topicDataDir = path.join(USER_DATA_DIR, agentId, 'topics', topicIdToDelete);
                const topicNotesDir = path.join(DATA_ROOT, 'Notes', agentId, topicIdToDelete);
                const cleanupErrors = [];

                if (await fs.pathExists(topicDataDir)) {
                    try {
                        await fs.remove(topicDataDir);
                    } catch (error) {
                        cleanupErrors.push(`history cleanup failed: ${error.message}`);
                    }
                }

                if (await fs.pathExists(topicNotesDir)) {
                    try {
                        await fs.remove(topicNotesDir);
                    } catch (error) {
                        cleanupErrors.push(`notes cleanup failed: ${error.message}`);
                    }
                }

                if (knowledgeBaseId) {
                    try {
                        await knowledgeBase.deleteKnowledgeBase(knowledgeBaseId);
                        const refreshedConfig = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                        if (Array.isArray(refreshedConfig?.topics)) {
                            remainingTopics = refreshedConfig.topics;
                        }
                    } catch (error) {
                        cleanupErrors.push(`source cleanup failed: ${error.message}`);
                    }
                }

                if (cleanupErrors.length > 0) {
                    const warning = cleanupErrors.join('；');
                    console.error(`Topic ${topicIdToDelete} for agent ${agentId} deleted with cleanup warnings: ${warning}`);
                    return { success: true, remainingTopics, warning };
                }

                return { success: true, remainingTopics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely delete topic for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to delete topic ${topicIdToDelete} for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('handle-file-paste', async (event, agentId, topicId, fileData) => {
        if (!topicId) return { error: 'Missing topicId.' };
        try {
            let storedFileObject;
            if (fileData.type === 'path') {
                const originalFileName = path.basename(fileData.path);
                const ext = path.extname(fileData.path).toLowerCase();
                let fileTypeHint = 'application/octet-stream';
                if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                    let mimeExt = ext.substring(1);
                    if (mimeExt === 'jpg') mimeExt = 'jpeg';
                    fileTypeHint = `image/${mimeExt}`;
                } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(ext)) {
                    const mimeExt = ext.substring(1);
                    fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                } else if (['.mp4', '.webm'].includes(ext)) {
                    fileTypeHint = `video/${ext.substring(1)}`;
                }

                const fileManager = require('../fileManager');
                storedFileObject = await fileManager.storeFile(fileData.path, originalFileName, agentId, topicId, fileTypeHint);
            } else if (fileData.type === 'base64') {
                const fileManager = require('../fileManager');
                const originalFileName = `pasted_image_${Date.now()}.${fileData.extension || 'png'}`;
                const buffer = Buffer.from(fileData.data, 'base64');
                const fileTypeHint = `image/${fileData.extension || 'png'}`;
                storedFileObject = await fileManager.storeFile(buffer, originalFileName, agentId, topicId, fileTypeHint);
            } else {
                throw new Error('Unsupported pasted file type.');
            }
            return { success: true, attachment: storedFileObject };
        } catch (error) {
            console.error('Failed to process pasted file:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('select-files-to-send', async (event, agentId, topicId) => {
        if (!agentId || !topicId) {
            console.error('[Main - select-files-to-send] Agent ID or Topic ID not provided.');
            return { error: "Agent ID and Topic ID are required to select files." };
        }

        const listenerWasActive = getSelectionListenerStatus();
        if (listenerWasActive) {
            stopSelectionListener();
            console.log('[Main] Temporarily stopped selection listener for file dialog.');
        }

        const result = await dialog.showOpenDialog(getMainWindow(), {
            title: 'Select files to send',
            properties: ['openFile', 'multiSelections']
        });

        if (listenerWasActive) {
            startSelectionListener();
            console.log('[Main] Restarted selection listener after file dialog.');
        }

        if (!result.canceled && result.filePaths.length > 0) {
            const storedFilesInfo = [];
            for (const filePath of result.filePaths) {
                try {
                    const originalName = path.basename(filePath);
                    const ext = path.extname(filePath).toLowerCase();
                    let fileTypeHint = 'application/octet-stream';
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                        let mimeExt = ext.substring(1);
                        if (mimeExt === 'jpg') mimeExt = 'jpeg';
                        fileTypeHint = `image/${mimeExt}`;
                    } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(ext)) {
                        const mimeExt = ext.substring(1);
                        fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                    } else if (['.mp4', '.webm'].includes(ext)) {
                        fileTypeHint = `video/${ext.substring(1)}`;
                    }

                    const fileManager = require('../fileManager');
                    const storedFile = await fileManager.storeFile(filePath, originalName, agentId, topicId, fileTypeHint);
                    storedFilesInfo.push(storedFile);
                } catch (error) {
                    console.error(`[Main - select-files-to-send] Error storing file ${filePath}:`, error);
                    storedFilesInfo.push({ name: path.basename(filePath), error: error.message });
                }
            }
            return { success: true, attachments: storedFilesInfo };
        }
        return { success: false, attachments: [] };
    });

    ipcMain.handle('handle-text-paste-as-file', async (event, agentId, topicId, textContent) => {
        if (!agentId || !topicId) return { error: 'Missing agentId or topicId.' };
        if (typeof textContent !== 'string') return { error: 'Text content must be a string.' };

        try {
            const originalFileName = `pasted_text_${Date.now()}.txt`;
            const buffer = Buffer.from(textContent, 'utf8');
            const fileManager = require('../fileManager');
            const storedFileObject = await fileManager.storeFile(buffer, originalFileName, agentId, topicId, 'text/plain');
            return { success: true, attachment: storedFileObject };
        } catch (error) {
            console.error('[Main - handle-text-paste-as-file] Failed to convert pasted text into a file:', error);
            return { error: `Failed to convert pasted text into a file: ${error.message}` };
        }
    });

    ipcMain.handle('handle-file-drop', async (event, agentId, topicId, droppedFilesData) => {
        if (!agentId || !topicId) return { error: 'Missing agentId or topicId.' };
        if (!Array.isArray(droppedFilesData) || droppedFilesData.length === 0) return { error: 'No dropped files provided.' };

        const storedFilesInfo = [];
        for (const fileData of droppedFilesData) {
            try {
                // Check if we have a path or data. One of them must exist.
                if (!fileData.data && !fileData.path) {
                    console.warn('[Main - handle-file-drop] Skipping a dropped file due to missing data and path. fileData:', JSON.stringify(fileData));
                    storedFilesInfo.push({ name: fileData.name || 'Unknown file', error: 'Missing file data and path.' });
                    continue;
                }

                let fileSource;
                if (fileData.path) {
                    // If path is provided, use it as the source.
                    fileSource = fileData.path;
                } else {
                    // Otherwise, use the buffer from data.
                    fileSource = Buffer.isBuffer(fileData.data) ? fileData.data : Buffer.from(fileData.data);
                }

                let fileTypeHint = fileData.type;
                const fileExtension = path.extname(fileData.name).toLowerCase();

                // If file type is generic, try to guess from extension.
                if (fileTypeHint === 'application/octet-stream' || !fileTypeHint) {
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExtension)) {
                        fileTypeHint = `image/${fileExtension.substring(1).replace('jpg', 'jpeg')}`;
                    } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(fileExtension)) {
                        const mimeExt = fileExtension.substring(1);
                        fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                    } else if (['.mp4', '.webm'].includes(fileExtension)) {
                        fileTypeHint = `video/${fileExtension.substring(1)}`;
                    } else if (['.md', '.txt'].includes(fileExtension)) {
                        fileTypeHint = 'text/plain';
                    }
                }

                console.log(`[Main - handle-file-drop] Attempting to store dropped file: ${fileData.name} (Type: ${fileTypeHint}) for Agent: ${agentId}, Topic: ${topicId}`);

                const fileManager = require('../fileManager');
                const storedFile = await fileManager.storeFile(fileSource, fileData.name, agentId, topicId, fileTypeHint);
                storedFilesInfo.push({ success: true, attachment: storedFile, name: fileData.name });

            } catch (error) {
                console.error(`[Main - handle-file-drop] Error storing dropped file ${fileData.name || 'unknown'}:`, error);
                console.error(`[Main - handle-file-drop] Full error details:`, error.stack);
                storedFilesInfo.push({ name: fileData.name || 'Unknown file', error: error.message });
            }
        }
        return storedFilesInfo;
    });

    ipcMain.handle('get-original-message-content', async (event, itemId, itemType, topicId, messageId) => {
        if (!itemId || !itemType || !topicId || !messageId) {
            return { success: false, error: 'Missing required identifiers.' };
        }

        try {
            if (itemType !== 'agent') {
                return { success: false, error: 'Unsupported item type.' };
            }

            const historyFile = path.join(USER_DATA_DIR, itemId, 'topics', topicId, 'history.json');

            if (await fs.pathExists(historyFile)) {
                const history = await fs.readJson(historyFile);
                const message = history.find(m => m.id === messageId);
                if (message) {
                    return { success: true, content: message.content };
                } else {
                    return { success: false, error: 'Message not found in history.' };
                }
            } else {
                return { success: false, error: 'History file not found.' };
            }
        } catch (error) {
            console.error(`Failed to load original message content (itemId: ${itemId}, topicId: ${topicId}, messageId: ${messageId}):`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-to-vcp', async (event, request) => {
        const {
            requestId,
            endpoint,
            apiKey,
            messages,
            modelConfig = {},
            context = null,
        } = request || {};

        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            return { error: 'send-to-vcp expects a request object.' };
        }

        let processedMessages;
        try {
            processedMessages = Array.isArray(messages)
                ? messages.map(normalizeMessageForPreprocessing)
                : [];
        } catch (error) {
            console.error('[Main - sendToVCP] Message normalization failed:', error);
            return { error: `Message normalization failed: ${error.message}` };
        }

        let settings = {};
        try {
            settings = settingsManager && typeof settingsManager.readSettings === 'function'
                ? await settingsManager.readSettings()
                : {};
        } catch (error) {
            console.error('[Main - sendToVCP] Failed to read settings:', error);
        }

        const executionConfig = resolveExecutionConfig(settings, {
            purpose: 'chat',
            requestedModel: modelConfig?.model,
            fallbackEndpoint: endpoint,
            fallbackApiKey: apiKey,
            fallbackModel: modelConfig?.model,
        });
        const finalModelConfig = {
            ...modelConfig,
            ...(executionConfig?.model?.id ? { model: executionConfig.model.id } : {}),
        };

        let promptVariableResolution = {
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
        };
        let promptResolutionOptions = {
            settings,
            agentConfig: null,
            context: { ...(context || {}) },
            modelConfig: finalModelConfig,
        };

        try {
            promptResolutionOptions = await buildPromptResolutionOptions({
                settings,
                context,
                modelConfig: finalModelConfig,
                agentConfigManager,
                dataRoot: DATA_ROOT,
                projectRoot: PROJECT_ROOT,
            });
        } catch (error) {
            console.warn('[Main - sendToVCP] Failed to pre-read agent context for DailyNote protocol injection:', error);
        }

        try {
            if (settings.enableAgentBubbleTheme === true) {
                processedMessages = applyAgentBubbleTheme(
                    processedMessages,
                    settings.agentBubbleThemePrompt
                );
            }

            processedMessages = normalizeLegacyStudyLogPromptMessages(processedMessages);
            processedMessages = applyEmoticonPrompt(processedMessages, settings, promptResolutionOptions);
            processedMessages = applyDailyNoteProtocol(processedMessages, settings, promptResolutionOptions);

            if (settings.enableThoughtChainInjection !== true) {
                processedMessages = stripThoughtChains(processedMessages);
            }

            processedMessages = applyContextSanitizer(processedMessages, settings);
        } catch (error) {
            console.error('[Main - sendToVCP] Message preprocessing failed:', error);
            return { error: `Message preprocessing failed: ${error.message}` };
        }

        try {
            if (finalModelConfig && finalModelConfig.model) {
                const modelUsageTracker = require('../modelUsageTracker');
                await modelUsageTracker.recordModelUsage(finalModelConfig.model);
            }
        } catch (error) {
            console.error('[ModelUsage] Failed to record model usage:', error);
        }

        try {
            const resolution = resolvePromptMessageSet(processedMessages, promptResolutionOptions);
            processedMessages = resolution.messages;
            promptVariableResolution = {
                unresolvedTokens: resolution.unresolvedTokens,
                substitutions: resolution.substitutions,
                variableSources: resolution.variableSources,
            };

            if (resolution.unresolvedTokens.length > 0) {
                console.warn(
                    `[Main - sendToVCP] Unresolved prompt variables for request ${requestId || 'unknown'}: ${resolution.unresolvedTokens.join(', ')}`
                );
            }
        } catch (error) {
            console.error('[Main - sendToVCP] Prompt variable resolution failed:', error);
                return { error: `Prompt variable resolution failed: ${error.message}` };
        }

        const studyProfile = settings.studyProfile || {};
        const currentDate = promptVariableResolution.substitutions.CurrentDate
            || new Date().toISOString().slice(0, 10);
        const enrichedContext = {
            ...(context || {}),
            model: finalModelConfig?.model || context?.model || '',
            topicName: promptVariableResolution.substitutions.TopicName || context?.topicName || '',
            agentName: promptVariableResolution.substitutions.AgentName || context?.agentName || '',
            studentName: studyProfile.studentName || settings.userName || '',
            studyWorkspace: studyProfile.studyWorkspace || '',
            workEnvironment: studyProfile.workEnvironment || '',
            currentDate,
        };

        const orchestrationResult = await studyServices.chatOrchestrator.runRequest({
            requestId,
            endpoint: executionConfig?.endpoint || endpoint,
            apiKey: executionConfig?.apiKey || apiKey,
            extraHeaders: executionConfig?.extraHeaders || {},
            messages: processedMessages,
            modelConfig: finalModelConfig,
            context: enrichedContext,
            settings,
            webContents: event.sender,
            streamChannel: 'vcp-stream-event',
        });

        if (orchestrationResult?.error) {
            return {
                error: orchestrationResult.error,
                promptVariableResolution,
                toolEvents: orchestrationResult.toolEvents || [],
                studyMemoryRefs: orchestrationResult.studyMemoryRefs || [],
            };
        }

        return {
            ...(orchestrationResult || {}),
            toolEvents: orchestrationResult?.toolEvents || [],
            studyMemoryRefs: orchestrationResult?.studyMemoryRefs || [],
            promptVariableResolution,
        };
    });

    ipcMain.handle('generate-follow-ups', async (_event, payload) => {
        try {
            const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload
                : {};
            const visibleMessages = selectVisibleFollowUpMessages(requestPayload.messages);
            if (visibleMessages.length === 0) {
                return { success: true, followUps: [] };
            }

            const settings = settingsManager && typeof settingsManager.readSettings === 'function'
                ? await settingsManager.readSettings()
                : {};
            const legacyEndpoint = typeof settings?.vcpServerUrl === 'string' ? settings.vcpServerUrl.trim() : '';
            const legacyApiKey = typeof settings?.vcpApiKey === 'string' ? settings.vcpApiKey.trim() : '';

            const model = await resolveFollowUpModel({
                agentId: requestPayload.agentId,
                requestedModel: requestPayload.model,
                settings,
                agentConfigManager,
            });
            const executionConfig = resolveExecutionConfig(settings, {
                purpose: 'followUp',
                requestedModel: model,
                fallbackEndpoint: legacyEndpoint,
                fallbackApiKey: legacyApiKey,
                fallbackModel: model,
            });
            const endpoint = executionConfig?.endpoint || legacyEndpoint;
            const apiKey = executionConfig?.apiKey || legacyApiKey;
            if (!endpoint) {
                return { success: false, error: 'VCP 服务配置不完整。', followUps: [] };
            }

            const prompt = buildFollowUpPrompt(settings.followUpPromptTemplate, visibleMessages);
            const requestIdBase = `follow_up_${requestPayload.messageId || Date.now()}_${Date.now()}`;
            const followUpContext = {
                source: 'follow-up-generation',
                agentId: requestPayload.agentId || '',
                topicId: requestPayload.topicId || '',
                messageId: requestPayload.messageId || '',
            };

            for (let attempt = 1; attempt <= FOLLOW_UP_MAX_ATTEMPTS; attempt += 1) {
                const result = await requestFollowUpsOnce({
                    attempt,
                    requestIdBase,
                    endpoint,
                    apiKey,
                    extraHeaders: executionConfig?.extraHeaders || {},
                    prompt,
                    model,
                    context: followUpContext,
                });

                if (result.error) {
                    return { success: false, error: result.error, followUps: [] };
                }

                if (result.followUps.length > 0) {
                    return { success: true, followUps: result.followUps };
                }

                const rawPreview = String(result.rawContent || '').trim();
                console.warn(
                    `[Main - generate-follow-ups] Attempt ${attempt} returned ${rawPreview ? 'unparseable' : 'empty'} content for ${followUpContext.messageId || requestIdBase}.`
                );
                if (rawPreview) {
                    console.warn(`[Main - generate-follow-ups] Raw preview: ${rawPreview.slice(0, 240)}`);
                }
            }

            return { success: true, followUps: [] };
        } catch (error) {
            console.error('[Main - generate-follow-ups] Failed:', error);
            return { success: false, error: error.message, followUps: [] };
        }
    });

    ipcMain.handle('generate-topic-title', async (_event, payload) => {
        try {
            const requestPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload
                : {};
            const visibleMessages = selectVisibleFollowUpMessages(
                requestPayload.messages,
                TOPIC_TITLE_HISTORY_LIMIT
            );
            const fallbackTitle = extractFirstUserTitleFallback(requestPayload.messages);
            if (visibleMessages.length === 0) {
                return { success: true, generated: false, title: fallbackTitle };
            }

            const settings = settingsManager && typeof settingsManager.readSettings === 'function'
                ? await settingsManager.readSettings()
                : {};
            const legacyEndpoint = typeof settings?.vcpServerUrl === 'string' ? settings.vcpServerUrl.trim() : '';
            const legacyApiKey = typeof settings?.vcpApiKey === 'string' ? settings.vcpApiKey.trim() : '';

            const model = await resolveTaskModel({
                agentId: requestPayload.agentId,
                requestedModel: requestPayload.model,
                settings,
                agentConfigManager,
                logLabel: 'generate-topic-title',
                preferredSettingsKeys: ['topicTitleDefaultModel'],
            });
            const executionConfig = resolveExecutionConfig(settings, {
                purpose: 'topicTitle',
                requestedModel: model,
                fallbackEndpoint: legacyEndpoint,
                fallbackApiKey: legacyApiKey,
                fallbackModel: model,
            });
            const endpoint = executionConfig?.endpoint || legacyEndpoint;
            const apiKey = executionConfig?.apiKey || legacyApiKey;
            if (!endpoint) {
                return {
                    success: true,
                    generated: false,
                    title: fallbackTitle,
                    error: 'VCP 服务配置不完整。',
                };
            }

            const prompt = buildTopicTitlePrompt(settings.topicTitlePromptTemplate, visibleMessages);
            const response = await vcpClient.send({
                requestId: `topic_title_${requestPayload.messageId || Date.now()}_${Date.now()}`,
                endpoint,
                apiKey,
                extraHeaders: executionConfig?.extraHeaders || {},
                messages: [{
                    role: 'user',
                    content: prompt,
                }],
                modelConfig: {
                    model,
                    stream: false,
                    temperature: 0.1,
                    max_tokens: 200,
                },
                context: {
                    source: 'topic-title-generation',
                    agentId: requestPayload.agentId || '',
                    topicId: requestPayload.topicId || '',
                    messageId: requestPayload.messageId || '',
                },
                timeoutMs: 120000,
            });

            if (response?.error) {
                return {
                    success: true,
                    generated: false,
                    title: fallbackTitle,
                    model,
                    prompt,
                    error: response.error,
                };
            }

            const rawContent = extractResponseContent(response?.response || {});
            const title = parseTopicTitleResponse(rawContent, fallbackTitle) || fallbackTitle;
            return {
                success: true,
                generated: title !== fallbackTitle,
                title,
                model,
                prompt,
                rawContent,
            };
        } catch (error) {
            console.error('[Main - generate-topic-title] Failed:', error);
            return {
                success: true,
                generated: false,
                title: extractFirstUserTitleFallback(payload?.messages),
                error: error.message,
            };
        }
    });

    ipcMain.handle('interrupt-vcp-request', async (_event, request) => {
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            return { success: false, error: 'interrupt-vcp-request expects a request object.' };
        }

        const requestId = request.requestId;
        const localInterrupted = studyServices?.chatOrchestrator?.abortSyntheticRequest?.(requestId) === true;
        const remoteResult = await vcpClient.interrupt(request);

        if (localInterrupted && !remoteResult?.success) {
            return {
                success: true,
                requestId,
                localAborted: true,
                remoteAttempted: remoteResult?.remoteAttempted || false,
                remoteSucceeded: remoteResult?.remoteSucceeded || false,
                warning: remoteResult?.error || remoteResult?.warning || '',
            };
        }

        return remoteResult;
    });

    /**
     * Part C: 鏅鸿兘璁℃暟閫昏緫杈呭姪鍑芥暟
     * 鍒ゆ柇鏄惁搴旇婵€娲昏锟?
     * 瑙勫垯锛氫笂涓嬫枃锛堟帓闄ょ郴缁熸秷鎭級鏈変笖鍙湁涓€锟?AI 鐨勫洖澶嶏紝涓旀病鏈夌敤鎴峰洖锟?
     * @param {Array} history - 娑堟伅鍘嗗彶
     * @returns {boolean}
     */
    function shouldActivateCount(history) {
        if (!history || history.length === 0) return false;

        // 杩囨护鎺夌郴缁熸秷锟?
        const nonSystemMessages = history.filter(msg => msg.role !== 'system');

        // 蹇呴』鏈変笖鍙湁涓€鏉℃秷鎭紝涓旇娑堟伅锟?AI 鍥炲
        return nonSystemMessages.length === 1 && nonSystemMessages[0].role === 'assistant';
    }

    /**
     * Part C: 璁＄畻鏈娑堟伅鏁伴噺
     * @param {Array} history - 娑堟伅鍘嗗彶
     * @returns {number}
     */
    function countUnreadMessages(history) {
        return shouldActivateCount(history) ? 1 : 0;
    }

    /**
     * Part C: 璁＄畻鍗曚釜璇濋鐨勬湭璇绘秷鎭暟
     * @param {Object} topic - 璇濋瀵硅薄
     * @param {Array} history - 璇濋鍘嗗彶娑堟伅
     * @returns {number} - 鏈娑堟伅鏁帮紝-1 琛ㄧず浠呮樉绀哄皬锟?
     */
    function calculateTopicUnreadCount(topic, history) {
        // 浼樺厛妫€鏌ヨ嚜鍔ㄨ鏁版潯浠讹紙AI鍥炲浜嗕絾鐢ㄦ埛娌″洖锟?
        if (shouldActivateCount(history)) {
            const count = countUnreadMessages(history);
            if (count > 0) return count;
        }

        // 濡傛灉涓嶆弧瓒宠嚜鍔ㄨ鏁版潯浠讹紝浣嗚鎵嬪姩鏍囪涓烘湭璇伙紝鍒欐樉绀哄皬锟?
        if (topic.unread === true) {
            return -1; // 浠呮樉绀哄皬鐐癸紝涓嶆樉绀烘暟锟?
        }

        return 0; // 涓嶆樉锟?
    }

    ipcMain.handle('get-unread-topic-counts', async () => {
        const counts = {};
        try {
            const agentDirs = await fs.readdir(AGENT_DIR, { withFileTypes: true });
            for (const dirent of agentDirs) {
                if (dirent.isDirectory()) {
                    const agentId = dirent.name;
                    let totalCount = 0;
                    let hasUnreadMarker = false; // 鐢ㄤ簬鏍囪鏄惁鏈夋湭璇绘爣璁颁絾鏃犺锟?
                    const configPath = path.join(AGENT_DIR, agentId, 'config.json');

                    if (await fs.pathExists(configPath)) {
                        const config = await fs.readJson(configPath);
                        if (config.topics && Array.isArray(config.topics)) {
                            for (const topic of config.topics) {
                                const historyPath = path.join(USER_DATA_DIR, agentId, 'topics', topic.id, 'history.json');
                                if (await fs.pathExists(historyPath)) {
                                    try {
                                        const history = await fs.readJson(historyPath);
                                        const topicCount = calculateTopicUnreadCount(topic, history);
                                        if (topicCount > 0) {
                                            totalCount += topicCount;
                                        } else if (topicCount === -1) {
                                            // 鏈夋湭璇绘爣璁颁絾鏃犺鏁帮紝璁板綍杩欎釜鐘讹拷?
                                            hasUnreadMarker = true;
                                        }
                                    } catch (readJsonError) {
                                        console.error(`Failed to read history.json: ${historyPath}`, readJsonError);
                                    }
                                }
                            }
                        }
                    }

                    // 濡傛灉鏈夎鏁帮紝鏄剧ず鏁板瓧
                    if (totalCount > 0) {
                        counts[agentId] = totalCount;
                    } else if (hasUnreadMarker) {
                        // 濡傛灉鍙湁鏈鏍囪娌℃湁璁℃暟锛岃繑锟?0锛堝墠绔細璇嗗埆涓轰粎鏄剧ず灏忕偣锟?
                        counts[agentId] = 0;
                    }
                }
            }
            return { success: true, counts };
        } catch (error) {
            console.error('Failed to compute unread topic counts:', error);
            return { success: false, error: error.message, counts: {} };
        }
    });

    // Toggle topic lock state.
    ipcMain.handle('toggle-topic-lock', async (event, agentId, topicId) => {
        try {
            const agentConfigPath = path.join(AGENT_DIR, agentId, 'config.json');
            if (!await fs.pathExists(agentConfigPath)) {
                return { success: false, error: `Agent config file not found for ${agentId}.` };
            }

            if (agentConfigManager) {
                const result = await agentConfigManager.updateTopic(agentId, topicId, (topic) => {
                    const currentLocked = topic.locked === undefined ? true : topic.locked;
                    return {
                        ...topic,
                        locked: !currentLocked,
                    };
                });

                return {
                    success: true,
                    locked: result.topic.locked,
                    message: result.topic.locked ? 'Topic locked.' : 'Topic unlocked.'
                };
            }

            let config;
            try {
                config = await fs.readJson(agentConfigPath);
            } catch (e) {
                console.error(`Failed to read agent config for ${agentId} (toggle-topic-lock):`, e);
                return { success: false, error: `Failed to read config file: ${e.message}` };
            }

            if (!config.topics || !Array.isArray(config.topics)) {
                return { success: false, error: 'Topics are unavailable for this agent.' };
            }

            const topic = config.topics.find(t => t.id === topicId);
            if (!topic) {
                return { success: false, error: `Topic not found: ${topicId}` };
            } else {
                // Part A: 鍘嗗彶鏁版嵁鍏煎 - 濡傛灉璇濋娌℃湁 locked 瀛楁锛岄粯璁よ缃负 true
                if (topic.locked === undefined) {
                    topic.locked = true;
                }

                // Toggle the lock flag.
                topic.locked = !topic.locked;

                await fs.writeJson(agentConfigPath, config, { spaces: 2 });

                return {
                    success: true,
                    locked: topic.locked,
                    message: topic.locked ? 'Topic locked.' : 'Topic unlocked.'
                };
            }
        } catch (error) {
            console.error('[toggleTopicLock] Error:', error);
            return { success: false, error: error.message };
        }
    });

    // Set topic unread state.
    ipcMain.handle('set-topic-unread', async (event, agentId, topicId, unread) => {
        try {
            const agentConfigPath = path.join(AGENT_DIR, agentId, 'config.json');
            if (!await fs.pathExists(agentConfigPath)) {
                return { success: false, error: `Agent config file not found for ${agentId}.` };
            }

            if (agentConfigManager) {
                const result = await agentConfigManager.updateTopic(agentId, topicId, (topic) => {
                    const normalizedTopic = topic.unread === undefined
                        ? { ...topic, unread: false }
                        : topic;
                    return {
                        ...normalizedTopic,
                        unread,
                    };
                });

                return { success: true, unread: result.topic.unread };
            }

            let config;
            try {
                config = await fs.readJson(agentConfigPath);
            } catch (e) {
                console.error(`Failed to read agent config for ${agentId} (set-topic-unread):`, e);
                return { success: false, error: `Failed to read config file: ${e.message}` };
            }

            if (!config.topics || !Array.isArray(config.topics)) {
                return { success: false, error: 'Topics are unavailable for this agent.' };
            }

            const topic = config.topics.find(t => t.id === topicId);
            if (!topic) {
                return { success: false, error: `Topic not found: ${topicId}` };
            } else {
                // Part A: 鍘嗗彶鏁版嵁鍏煎 - 濡傛灉璇濋娌℃湁 unread 瀛楁锛岄粯璁よ缃负 false
                if (topic.unread === undefined) {
                    topic.unread = false;
                }

                topic.unread = unread;
                await fs.writeJson(agentConfigPath, config, { spaces: 2 });

                return { success: true, unread: topic.unread };
            }
        } catch (error) {
            console.error('[setTopicUnread] Error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcHandlersRegistered = true;
}

module.exports = {
    __testUtils: {
        buildFollowUpPrompt,
        buildTopicTitlePrompt,
        extractFirstUserTitleFallback,
        formatFollowUpChatHistory,
        parseFollowUpsResponse,
        parseTopicTitleResponse,
        resolveFollowUpModel,
        resolveTaskModel,
        sanitizeFollowUpText,
        selectVisibleFollowUpMessages,
        requestFollowUpsOnce,
    },
    initialize
};

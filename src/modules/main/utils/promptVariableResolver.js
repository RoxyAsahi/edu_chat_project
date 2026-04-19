const TOKEN_PATTERN = /{{\s*([A-Za-z0-9_]+)\s*}}/g;
const { resolveDailyNoteToolInstruction } = require('../study/toolProtocol');

const DEFAULT_DIV_RENDER_INSTRUCTION = [
    'When structured rendering helps, emit semantic HTML div blocks that the client can render directly.',
    'Prefer normal Markdown for standard prose.',
    'Do not echo unresolved template variables in the final answer.',
].join(' ');
const DEFAULT_ADAPTIVE_BUBBLE_TIP = [
    'Keep answers readable and compact when rich layout is unnecessary.',
    'Only switch to more structured rendering when it clearly helps comprehension.',
].join(' ');

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVariableKey(key) {
    if (typeof key !== 'string') {
        return '';
    }

    const trimmed = key.trim();
    return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : '';
}

function normalizeVariableValue(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    return trimmed;
}

function deriveAsciiNameTokens(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return [];
    }

    const matches = value.match(/[A-Za-z][A-Za-z0-9_]*/g) || [];
    return [...new Set(matches)];
}

function mergeVariable(variableMap, key, value, source, overwrite = false) {
    const normalizedKey = normalizeVariableKey(key);
    const normalizedValue = normalizeVariableValue(value);
    if (!normalizedKey || !normalizedValue) {
        return;
    }

    if (!overwrite && variableMap[normalizedKey]) {
        return;
    }

    variableMap[normalizedKey] = {
        value: normalizedValue,
        source,
    };
}

function formatDateParts(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).formatToParts(date);
        const pick = (type) => parts.find((part) => part.type === type)?.value || '';
        return {
            date: `${pick('year')}-${pick('month')}-${pick('day')}`,
            dateTime: `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`,
        };
    } catch (_error) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return {
            date: `${year}-${month}-${day}`,
            dateTime: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
        };
    }
}

function collectExplicitPromptVariables(agentConfig = {}) {
    const normalizedAgentConfig = isPlainObject(agentConfig) ? agentConfig : {};
    const variableMap = {};

    const objectCandidates = [
        normalizedAgentConfig.promptVariables,
        normalizedAgentConfig.variables,
    ];

    for (const candidate of objectCandidates) {
        if (!isPlainObject(candidate)) {
            continue;
        }

        for (const [key, value] of Object.entries(candidate)) {
            mergeVariable(variableMap, key, value, 'agent-config-explicit', true);
        }
    }

    if (Array.isArray(normalizedAgentConfig.promptVariableEntries)) {
        for (const entry of normalizedAgentConfig.promptVariableEntries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }

            mergeVariable(
                variableMap,
                entry.key || entry.name,
                entry.value,
                'agent-config-entry',
                true
            );
        }
    }

    if (Array.isArray(normalizedAgentConfig.aliases)) {
        for (const alias of normalizedAgentConfig.aliases) {
            if (typeof alias !== 'string') {
                continue;
            }
            mergeVariable(variableMap, alias, alias, 'agent-config-alias', true);
        }
    }

    return variableMap;
}

function buildPromptVariableMap(options = {}) {
    const {
        settings = {},
        agentConfig: rawAgentConfig = {},
        context = {},
        modelConfig = {},
    } = options;
    const agentConfig = isPlainObject(rawAgentConfig) ? rawAgentConfig : {};
    const studyProfile = isPlainObject(settings.studyProfile) ? settings.studyProfile : {};
    const studyLogPolicy = isPlainObject(settings.studyLogPolicy) ? settings.studyLogPolicy : {};
    const promptVariables = isPlainObject(settings.promptVariables) ? settings.promptVariables : {};
    const renderingPromptEnabled = settings.enableRenderingPrompt !== false;
    const emoticonPromptEnabled = settings.enableEmoticonPrompt !== false;
    const adaptiveBubbleTipEnabled = settings.enableAdaptiveBubbleTip !== false;
    const emoticonPromptData = isPlainObject(context.emoticonPromptData) ? context.emoticonPromptData : {};
    const timeZone = context.timeZone || studyProfile.timezone || 'Asia/Hong_Kong';
    const now = new Date();
    const formattedNow = formatDateParts(now, timeZone);
    const dailyNoteInstruction = resolveDailyNoteToolInstruction(settings.dailyNoteGuide, {
        agentConfig,
        context,
    });
    const protocolVariablesEnabled = studyLogPolicy.enabled !== false
        && studyLogPolicy.enableDailyNotePromptVariables !== false;

    const variableMap = collectExplicitPromptVariables(agentConfig);

    if (isPlainObject(agentConfig.promptVariableOverrides)) {
        for (const [key, value] of Object.entries(agentConfig.promptVariableOverrides)) {
            mergeVariable(variableMap, key, value, 'agent-config-override', true);
        }
    }

    for (const [key, value] of Object.entries(promptVariables)) {
        mergeVariable(variableMap, key, value, 'settings-prompt-variable', false);
    }

    mergeVariable(variableMap, 'AgentId', context.agentId || agentConfig.id, 'context');
    mergeVariable(variableMap, 'AgentName', context.agentName || agentConfig.name, 'context');
    mergeVariable(variableMap, 'TopicId', context.topicId, 'context');
    mergeVariable(variableMap, 'TopicName', context.topicName, 'context');
    mergeVariable(variableMap, 'UserName', settings.userName, 'settings');
    mergeVariable(variableMap, 'StudentName', studyProfile.studentName || settings.userName, 'settings');
    mergeVariable(variableMap, 'VarUser', settings.userName || studyProfile.studentName, 'settings');
    mergeVariable(variableMap, 'VarCity', studyProfile.city, 'settings');
    mergeVariable(variableMap, 'StudyWorkspace', studyProfile.studyWorkspace, 'settings');
    mergeVariable(variableMap, 'WorkEnvironment', studyProfile.workEnvironment, 'settings');
    mergeVariable(variableMap, 'CurrentDate', formattedNow.date, 'builtin');
    mergeVariable(variableMap, 'CurrentDateTime', formattedNow.dateTime, 'builtin');
    mergeVariable(variableMap, 'VarTimeNow', formattedNow.dateTime, 'builtin');
    if (protocolVariablesEnabled) {
        mergeVariable(variableMap, 'DailyNoteTool', dailyNoteInstruction, 'builtin');
        mergeVariable(variableMap, 'StudyLogTool', dailyNoteInstruction, 'builtin');
        mergeVariable(variableMap, 'VarDailyNoteGuide', dailyNoteInstruction, 'builtin');
    } else {
        variableMap.DailyNoteTool = { value: '', source: 'study-log-policy-disabled', forceResolve: true };
        variableMap.StudyLogTool = { value: '', source: 'study-log-policy-disabled', forceResolve: true };
        variableMap.VarDailyNoteGuide = { value: '', source: 'study-log-policy-disabled', forceResolve: true };
    }
    mergeVariable(
        variableMap,
        'Model',
        context.model || modelConfig.model || agentConfig.model,
        'model-config'
    );
    if (renderingPromptEnabled) {
        mergeVariable(
            variableMap,
            'VarDivRender',
            normalizeVariableValue(settings.renderingPrompt) || DEFAULT_DIV_RENDER_INSTRUCTION,
            'builtin'
        );
        mergeVariable(
            variableMap,
            'VarRendering',
            normalizeVariableValue(settings.renderingPrompt) || DEFAULT_DIV_RENDER_INSTRUCTION,
            'builtin'
        );
    } else {
        variableMap.VarDivRender = { value: '', source: 'rendering-prompt-disabled', forceResolve: true };
        variableMap.VarRendering = { value: '', source: 'rendering-prompt-disabled', forceResolve: true };
    }
    if (isPlainObject(emoticonPromptData.variables)) {
        for (const [key, value] of Object.entries(emoticonPromptData.variables)) {
            const normalizedKey = normalizeVariableKey(key);
            if (!normalizedKey) {
                continue;
            }

            const normalizedValue = typeof value === 'string' ? value.trim() : '';
            if (normalizedValue) {
                mergeVariable(variableMap, normalizedKey, normalizedValue, 'bundled-emoticon');
                continue;
            }

            variableMap[normalizedKey] = {
                value: '',
                source: 'bundled-emoticon',
                forceResolve: true,
            };
        }
    }
    if (emoticonPromptEnabled && normalizeVariableValue(emoticonPromptData.resolvedPrompt)) {
        mergeVariable(
            variableMap,
            'VarEmoticonPrompt',
            emoticonPromptData.resolvedPrompt,
            'bundled-emoticon'
        );
        mergeVariable(
            variableMap,
            'VarEmojiPrompt',
            emoticonPromptData.resolvedPrompt,
            'bundled-emoticon'
        );
    } else {
        variableMap.VarEmoticonPrompt = {
            value: '',
            source: emoticonPromptEnabled ? 'bundled-emoticon-unavailable' : 'emoticon-prompt-disabled',
            forceResolve: true,
        };
        variableMap.VarEmojiPrompt = {
            value: '',
            source: emoticonPromptEnabled ? 'bundled-emoticon-unavailable' : 'emoticon-prompt-disabled',
            forceResolve: true,
        };
    }
    if (adaptiveBubbleTipEnabled) {
        mergeVariable(
            variableMap,
            'VarAdaptiveBubbleTip',
            normalizeVariableValue(settings.adaptiveBubbleTip) || DEFAULT_ADAPTIVE_BUBBLE_TIP,
            'builtin'
        );
    } else {
        variableMap.VarAdaptiveBubbleTip = { value: '', source: 'adaptive-bubble-tip-disabled', forceResolve: true };
    }

    const aliasCandidates = [
        agentConfig.name,
        context.agentName,
        agentConfig.id,
        context.agentId,
    ];

    for (const candidate of aliasCandidates) {
        for (const token of deriveAsciiNameTokens(candidate)) {
            mergeVariable(variableMap, token, token, 'derived-agent-alias');
        }
    }

    return variableMap;
}

function resolvePromptVariables(prompt, options = {}) {
    if (typeof prompt !== 'string' || prompt.length === 0) {
        return {
            resolvedPrompt: prompt,
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
        };
    }

    const variableMap = buildPromptVariableMap(options);
    const substitutions = {};
    const variableSources = {};
    const unresolvedTokens = new Set();

    const resolvedPrompt = prompt.replace(TOKEN_PATTERN, (match, token) => {
        const entry = variableMap[token];
        if (!entry || (!entry.forceResolve && !entry.value)) {
            unresolvedTokens.add(token);
            return match;
        }

        substitutions[token] = entry.value;
        variableSources[token] = entry.source;
        return entry.value;
    });

    return {
        resolvedPrompt,
        unresolvedTokens: [...unresolvedTokens],
        substitutions,
        variableSources,
    };
}

function resolvePromptMessageSet(messages, options = {}) {
    const unresolvedTokens = new Set();
    const substitutions = {};
    const variableSources = {};

    const resolvedMessages = Array.isArray(messages)
        ? messages.map((message) => {
            if (!message || typeof message !== 'object') {
                return message;
            }

            if (typeof message.content === 'string') {
                const result = resolvePromptVariables(message.content, options);
                result.unresolvedTokens.forEach((token) => unresolvedTokens.add(token));
                Object.assign(substitutions, result.substitutions);
                Object.assign(variableSources, result.variableSources);
                return {
                    ...message,
                    content: result.resolvedPrompt,
                };
            }

            if (Array.isArray(message.content)) {
                return {
                    ...message,
                    content: message.content.map((part) => {
                        if (part?.type !== 'text' || typeof part.text !== 'string') {
                            return part;
                        }

                        const result = resolvePromptVariables(part.text, options);
                        result.unresolvedTokens.forEach((token) => unresolvedTokens.add(token));
                        Object.assign(substitutions, result.substitutions);
                        Object.assign(variableSources, result.variableSources);
                        return {
                            ...part,
                            text: result.resolvedPrompt,
                        };
                    }),
                };
            }

            return message;
        })
        : [];

    return {
        messages: resolvedMessages,
        unresolvedTokens: [...unresolvedTokens],
        substitutions,
        variableSources,
    };
}

module.exports = {
    DEFAULT_DIV_RENDER_INSTRUCTION,
    DEFAULT_ADAPTIVE_BUBBLE_TIP,
    buildPromptVariableMap,
    resolvePromptVariables,
    resolvePromptMessageSet,
};

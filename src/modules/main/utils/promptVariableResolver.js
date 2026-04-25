const TOKEN_PATTERN = /{{\s*([A-Za-z0-9_]+)\s*}}/g;
const { resolveDailyNoteGuideInstruction } = require('../study/toolProtocol');

const DEFAULT_DIV_RENDER_INSTRUCTION = [
    'When structured rendering helps, emit semantic HTML div blocks that the client can render directly.',
    'Prefer normal Markdown for standard prose.',
    'Do not echo unresolved template variables in the final answer.',
].join(' ');
const DEFAULT_ADAPTIVE_BUBBLE_TIP = [
    'Keep answers readable and compact when rich layout is unnecessary.',
    'Only switch to more structured rendering when it clearly helps comprehension.',
].join(' ');

const LEGACY_PROMPT_TOKEN_REPLACEMENTS = Object.freeze({
    VarUser: 'UserName',
    VarCity: 'City',
    VarTimeNow: 'CurrentDateTime',
    VarDailyNoteGuide: 'DailyNoteGuide',
    StudyLogTool: 'DailyNoteGuide',
    DailyNoteTool: 'DailyNoteGuide',
    VarDivRender: 'RenderingGuide',
    VarRendering: 'RenderingGuide',
    VarEmoticonPrompt: 'EmoticonGuide',
    VarEmojiPrompt: 'EmoticonGuide',
    VarAdaptiveBubbleTip: 'AdaptiveBubbleTip',
});

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

    return value.trim();
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

function setForceResolvedVariable(variableMap, key, source) {
    const normalizedKey = normalizeVariableKey(key);
    if (!normalizedKey) {
        return;
    }

    variableMap[normalizedKey] = {
        value: '',
        source,
        forceResolve: true,
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

    return variableMap;
}

function addDerivedAliasVariables(variableMap, candidates = []) {
    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) {
            continue;
        }

        mergeVariable(variableMap, candidate, candidate, 'derived-agent-alias');
        for (const token of deriveAsciiNameTokens(candidate)) {
            mergeVariable(variableMap, token, token, 'derived-agent-alias');
        }
    }
}

function buildLegacyTokenSuggestions(tokens = []) {
    const suggestions = {};

    for (const token of Array.isArray(tokens) ? tokens : []) {
        const replacement = LEGACY_PROMPT_TOKEN_REPLACEMENTS[token];
        if (replacement) {
            suggestions[token] = replacement;
        }
    }

    return suggestions;
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
    const emoticonPromptData = isPlainObject(context.emoticonPromptData) ? context.emoticonPromptData : {};
    const renderingPromptEnabled = settings.enableRenderingPrompt !== false;
    const emoticonPromptEnabled = settings.enableEmoticonPrompt !== false;
    const adaptiveBubbleTipEnabled = settings.enableAdaptiveBubbleTip !== false;
    const protocolVariablesEnabled = studyLogPolicy.enabled !== false
        && studyLogPolicy.enableDailyNotePromptVariables !== false;
    const timeZone = context.timeZone || studyProfile.timezone || 'Asia/Hong_Kong';
    const formattedNow = formatDateParts(new Date(), timeZone);
    const dailyNoteInstruction = resolveDailyNoteGuideInstruction(settings.dailyNoteGuide, {
        agentConfig,
        context,
    });

    const variableMap = collectExplicitPromptVariables(agentConfig);

    if (isPlainObject(agentConfig.promptVariableOverrides)) {
        for (const [key, value] of Object.entries(agentConfig.promptVariableOverrides)) {
            mergeVariable(variableMap, key, value, 'agent-config-override', true);
        }
    }

    for (const [key, value] of Object.entries(promptVariables)) {
        mergeVariable(variableMap, key, value, 'settings-prompt-variable');
    }

    mergeVariable(variableMap, 'AgentId', context.agentId || agentConfig.id, 'context');
    mergeVariable(variableMap, 'AgentName', context.agentName || agentConfig.name, 'context');
    mergeVariable(variableMap, 'TopicId', context.topicId, 'context');
    mergeVariable(variableMap, 'TopicName', context.topicName, 'context');
    mergeVariable(variableMap, 'UserName', settings.userName || studyProfile.studentName, 'settings');
    mergeVariable(variableMap, 'StudentName', studyProfile.studentName || settings.userName, 'settings');
    mergeVariable(variableMap, 'City', studyProfile.city, 'settings');
    mergeVariable(variableMap, 'StudyWorkspace', studyProfile.studyWorkspace, 'settings');
    mergeVariable(variableMap, 'WorkEnvironment', studyProfile.workEnvironment, 'settings');
    mergeVariable(variableMap, 'CurrentDate', formattedNow.date, 'builtin');
    mergeVariable(variableMap, 'CurrentDateTime', formattedNow.dateTime, 'builtin');
    mergeVariable(
        variableMap,
        'Model',
        context.model || modelConfig.model || agentConfig.model,
        'model-config'
    );

    if (protocolVariablesEnabled) {
        mergeVariable(variableMap, 'DailyNoteGuide', dailyNoteInstruction, 'builtin');
    } else {
        setForceResolvedVariable(variableMap, 'DailyNoteGuide', 'study-log-policy-disabled');
    }

    if (renderingPromptEnabled) {
        mergeVariable(
            variableMap,
            'RenderingGuide',
            normalizeVariableValue(settings.renderingPrompt) || DEFAULT_DIV_RENDER_INSTRUCTION,
            'builtin'
        );
    } else {
        setForceResolvedVariable(variableMap, 'RenderingGuide', 'rendering-prompt-disabled');
    }

    if (isPlainObject(emoticonPromptData.variables)) {
        for (const [key, value] of Object.entries(emoticonPromptData.variables)) {
            const normalizedKey = normalizeVariableKey(key);
            if (!normalizedKey) {
                continue;
            }

            const normalizedValue = normalizeVariableValue(value);
            if (normalizedValue) {
                mergeVariable(variableMap, normalizedKey, normalizedValue, 'bundled-emoticon');
            } else {
                setForceResolvedVariable(variableMap, normalizedKey, 'bundled-emoticon');
            }
        }
    }

    if (emoticonPromptEnabled && normalizeVariableValue(emoticonPromptData.resolvedPrompt)) {
        mergeVariable(
            variableMap,
            'EmoticonGuide',
            emoticonPromptData.resolvedPrompt,
            'bundled-emoticon'
        );
    } else {
        setForceResolvedVariable(
            variableMap,
            'EmoticonGuide',
            emoticonPromptEnabled ? 'bundled-emoticon-unavailable' : 'emoticon-prompt-disabled'
        );
    }

    if (adaptiveBubbleTipEnabled) {
        mergeVariable(
            variableMap,
            'AdaptiveBubbleTip',
            normalizeVariableValue(settings.adaptiveBubbleTip) || DEFAULT_ADAPTIVE_BUBBLE_TIP,
            'builtin'
        );
    } else {
        setForceResolvedVariable(variableMap, 'AdaptiveBubbleTip', 'adaptive-bubble-tip-disabled');
    }

    addDerivedAliasVariables(variableMap, [
        agentConfig.name,
        context.agentName,
        agentConfig.id,
        context.agentId,
    ]);

    return variableMap;
}

function resolvePromptVariables(prompt, options = {}) {
    if (typeof prompt !== 'string' || prompt.length === 0) {
        return {
            resolvedPrompt: prompt,
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
            legacyTokenSuggestions: {},
        };
    }

    const variableMap = buildPromptVariableMap(options);
    const substitutions = {};
    const variableSources = {};
    const unresolvedTokens = new Set();

    const resolvedPrompt = prompt.replace(TOKEN_PATTERN, (match, rawToken) => {
        const token = normalizeVariableKey(rawToken);
        const entry = token ? variableMap[token] : null;
        if (!entry || (!entry.forceResolve && !entry.value)) {
            if (token) {
                unresolvedTokens.add(token);
            }
            return match;
        }

        substitutions[token] = entry.value;
        variableSources[token] = entry.source;
        return entry.value;
    });

    const unresolvedTokenList = [...unresolvedTokens];
    return {
        resolvedPrompt,
        unresolvedTokens: unresolvedTokenList,
        substitutions,
        variableSources,
        legacyTokenSuggestions: buildLegacyTokenSuggestions(unresolvedTokenList),
    };
}

function resolvePromptMessageSet(messages, options = {}) {
    const unresolvedTokens = new Set();
    const substitutions = {};
    const variableSources = {};
    const legacyTokenSuggestions = {};

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
                Object.assign(legacyTokenSuggestions, result.legacyTokenSuggestions);
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
                        Object.assign(legacyTokenSuggestions, result.legacyTokenSuggestions);
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
        legacyTokenSuggestions,
    };
}

module.exports = {
    DEFAULT_DIV_RENDER_INSTRUCTION,
    DEFAULT_ADAPTIVE_BUBBLE_TIP,
    LEGACY_PROMPT_TOKEN_REPLACEMENTS,
    buildPromptVariableMap,
    buildLegacyTokenSuggestions,
    resolvePromptVariables,
    resolvePromptMessageSet,
};

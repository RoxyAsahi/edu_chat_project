const TOKEN_PATTERN = /{{\s*([A-Za-z0-9_]+)\s*}}/g;

const DEFAULT_DIV_RENDER_INSTRUCTION = [
    'When structured rendering helps, emit semantic HTML div blocks that the client can render directly.',
    'Prefer normal Markdown for standard prose.',
    'Do not echo unresolved template variables in the final answer.',
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

    const variableMap = collectExplicitPromptVariables(agentConfig);

    mergeVariable(variableMap, 'AgentId', context.agentId || agentConfig.id, 'context');
    mergeVariable(variableMap, 'AgentName', context.agentName || agentConfig.name, 'context');
    mergeVariable(variableMap, 'TopicId', context.topicId, 'context');
    mergeVariable(variableMap, 'TopicName', context.topicName, 'context');
    mergeVariable(variableMap, 'UserName', settings.userName, 'settings');
    mergeVariable(
        variableMap,
        'Model',
        context.model || modelConfig.model || agentConfig.model,
        'model-config'
    );
    mergeVariable(variableMap, 'VarDivRender', DEFAULT_DIV_RENDER_INSTRUCTION, 'builtin');

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
        if (!entry || !entry.value) {
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
    buildPromptVariableMap,
    resolvePromptVariables,
    resolvePromptMessageSet,
};

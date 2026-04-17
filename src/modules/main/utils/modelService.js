const MODEL_SERVICE_VERSION = 1;

const MODEL_SERVICE_DEFAULT_KEYS = Object.freeze([
    'chat',
    'followUp',
    'topicTitle',
    'embedding',
    'rerank',
]);

const MODEL_CAPABILITY_KEYS = Object.freeze([
    'chat',
    'embedding',
    'rerank',
    'vision',
    'reasoning',
]);

const PROVIDER_PRESETS = Object.freeze([
    {
        presetId: 'openai',
        name: 'OpenAI',
        apiBaseUrl: 'https://api.openai.com',
    },
    {
        presetId: 'openrouter',
        name: 'OpenRouter',
        apiBaseUrl: 'https://openrouter.ai/api',
    },
    {
        presetId: 'deepseek',
        name: 'DeepSeek',
        apiBaseUrl: 'https://api.deepseek.com',
    },
    {
        presetId: 'siliconflow',
        name: 'SiliconFlow',
        apiBaseUrl: 'https://api.siliconflow.cn',
    },
    {
        presetId: 'dashscope-compatible',
        name: 'DashScope Compatible',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    },
    {
        presetId: 'ollama',
        name: 'Ollama',
        apiBaseUrl: 'http://127.0.0.1:11434',
    },
    {
        presetId: 'lm-studio',
        name: 'LM Studio',
        apiBaseUrl: 'http://127.0.0.1:1234',
    },
    {
        presetId: 'oneapi-compatible',
        name: 'OneAPI/NewAPI Compatible',
        apiBaseUrl: 'http://127.0.0.1:3000',
    },
    {
        presetId: 'custom-openai-compatible',
        name: 'Custom OpenAI-Compatible',
        apiBaseUrl: '',
    },
]);

const DEFAULT_MODEL_SERVICE = Object.freeze({
    version: MODEL_SERVICE_VERSION,
    providers: [],
    defaults: {
        chat: null,
        followUp: null,
        topicTitle: null,
        embedding: null,
        rerank: null,
    },
});

const TASK_KEY_BY_LEGACY_SETTINGS_KEY = Object.freeze({
    defaultModel: 'chat',
    followUpDefaultModel: 'followUp',
    topicTitleDefaultModel: 'topicTitle',
    kbEmbeddingModel: 'embedding',
    kbRerankModel: 'rerank',
});

function createDefaultModelService() {
    return {
        version: MODEL_SERVICE_VERSION,
        providers: [],
        defaults: {
            chat: null,
            followUp: null,
            topicTitle: null,
            embedding: null,
            rerank: null,
        },
    };
}

function cloneModelService(service = DEFAULT_MODEL_SERVICE) {
    return normalizeModelService(service);
}

function normalizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }
    return fallback;
}

function sanitizeIdSegment(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function createProviderId(base = 'provider', usedIds = new Set()) {
    const normalizedBase = sanitizeIdSegment(base) || 'provider';
    let candidate = normalizedBase;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${normalizedBase}-${suffix}`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}

function serializeUrl(url) {
    let serialized = url.toString();
    if (!url.search && !url.hash && serialized.endsWith('/')) {
        serialized = serialized.slice(0, -1);
    }
    return serialized;
}

function normalizeApiBaseUrl(value) {
    const rawValue = normalizeText(value);
    if (!rawValue) {
        return '';
    }

    let url;
    try {
        url = new URL(rawValue);
    } catch (_error) {
        return rawValue;
    }

    const lowerPathname = url.pathname.toLowerCase().replace(/\/+$/, '');
    const suffixes = [
        '/v1/chat/completions',
        '/chat/completions',
        '/v1/embeddings',
        '/embeddings',
        '/v1/rerank',
        '/rerank',
        '/v1/models',
        '/models',
        '/v1/interrupt',
        '/interrupt',
    ];

    let pathname = url.pathname.replace(/\/+$/, '');
    for (const suffix of suffixes) {
        if (lowerPathname.endsWith(suffix)) {
            pathname = pathname.slice(0, pathname.length - suffix.length);
            break;
        }
    }

    url.pathname = pathname || '/';
    url.search = '';
    url.hash = '';
    return serializeUrl(url);
}

function joinProviderPath(apiBaseUrl, suffix) {
    const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
    if (!baseUrl) {
        return '';
    }

    try {
        const url = new URL(baseUrl);
        const pathname = url.pathname.replace(/\/+$/, '');
        const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
        url.pathname = pathname.endsWith('/v1') && normalizedSuffix.startsWith('/v1/')
            ? `${pathname}${normalizedSuffix.slice(3)}`
            : `${pathname}${normalizedSuffix}`;
        url.search = '';
        url.hash = '';
        return serializeUrl(url);
    } catch (_error) {
        return '';
    }
}

function buildChatEndpoint(apiBaseUrl) {
    return joinProviderPath(apiBaseUrl, '/v1/chat/completions');
}

function buildModelsEndpoint(apiBaseUrl) {
    return joinProviderPath(apiBaseUrl, '/v1/models');
}

function buildEmbeddingsEndpoint(apiBaseUrl) {
    return joinProviderPath(apiBaseUrl, '/v1/embeddings');
}

function buildRerankEndpoint(apiBaseUrl) {
    return joinProviderPath(apiBaseUrl, '/v1/rerank');
}

function buildInterruptEndpoint(apiBaseUrl) {
    return joinProviderPath(apiBaseUrl, '/v1/interrupt');
}

function normalizeApiKeys(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
    }

    if (typeof value === 'string') {
        return [...new Set(
            value
                .split(/[,\n]/)
                .map((item) => item.trim())
                .filter(Boolean)
        )];
    }

    return [];
}

function normalizeExtraHeaders(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([key, headerValue]) => [normalizeText(key), normalizeText(headerValue)])
            .filter(([key, headerValue]) => key && headerValue)
    );
}

function detectRemoteModelCapabilities(modelName = '') {
    const normalizedName = normalizeText(modelName).toLowerCase();
    const capabilities = {
        chat: true,
        embedding: false,
        rerank: false,
        vision: false,
        reasoning: false,
    };

    if (/(embed|embedding)/i.test(normalizedName)) {
        capabilities.chat = false;
        capabilities.embedding = true;
    } else if (/rerank/i.test(normalizedName)) {
        capabilities.chat = false;
        capabilities.rerank = true;
    }

    if (/(vision|vl|multimodal|llava|gpt-4o|qwen-vl|internvl|gemini)/i.test(normalizedName)) {
        capabilities.vision = true;
    }

    if (/(reason|reasoning|thinking|deepthink|o1|o3|r1)/i.test(normalizedName)) {
        capabilities.reasoning = true;
    }

    return capabilities;
}

function resolveModelGroup(model, capabilities) {
    const explicitGroup = normalizeText(model?.group);
    if (explicitGroup) {
        return explicitGroup;
    }

    if (capabilities.embedding) {
        return 'embedding';
    }
    if (capabilities.rerank) {
        return 'rerank';
    }
    return 'chat';
}

function createModelId(model = {}) {
    const explicitId = normalizeText(model?.id);
    if (explicitId) {
        return explicitId;
    }

    const name = normalizeText(model?.name);
    if (name) {
        return name;
    }

    return '';
}

function normalizeModelCapabilities(value, modelName = '') {
    const detected = detectRemoteModelCapabilities(modelName);
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    return MODEL_CAPABILITY_KEYS.reduce((acc, key) => {
        acc[key] = typeof source[key] === 'boolean' ? source[key] : detected[key];
        return acc;
    }, {});
}

function normalizeModelConfig(model = {}, defaults = {}) {
    const id = createModelId(model) || createModelId(defaults);
    const name = normalizeText(model?.name, normalizeText(defaults?.name, id));
    const source = normalizeText(model?.source, normalizeText(defaults?.source, 'manual')) === 'remote'
        ? 'remote'
        : 'manual';
    const capabilities = normalizeModelCapabilities(
        model?.capabilities,
        model?.name || model?.id || defaults?.name || defaults?.id || ''
    );

    return {
        id,
        name: name || id,
        group: resolveModelGroup(model, capabilities),
        capabilities,
        enabled: model?.enabled !== false,
        source,
    };
}

function mergeProviderModels(models = []) {
    const merged = [];
    const indexById = new Map();

    for (const entry of Array.isArray(models) ? models : []) {
        const normalized = normalizeModelConfig(entry);
        if (!normalized.id) {
            continue;
        }

        const existingIndex = indexById.get(normalized.id);
        if (existingIndex === undefined) {
            indexById.set(normalized.id, merged.length);
            merged.push(normalized);
            continue;
        }

        const existing = merged[existingIndex];
        if (existing.source === 'manual' && normalized.source === 'remote') {
            continue;
        }

        merged[existingIndex] = normalizeModelConfig(
            {
                ...existing,
                ...normalized,
                capabilities: {
                    ...existing.capabilities,
                    ...normalized.capabilities,
                },
            },
            existing
        );
    }

    return merged;
}

function resolveProviderPreset(presetId = '') {
    return PROVIDER_PRESETS.find((preset) => preset.presetId === presetId) || null;
}

function normalizeProviderConfig(provider = {}, options = {}) {
    const fallbackPreset = resolveProviderPreset(provider?.presetId);
    const name = normalizeText(provider?.name, fallbackPreset?.name || `Provider ${Number(options.index || 0) + 1}`);
    const apiBaseUrl = normalizeApiBaseUrl(
        provider?.apiBaseUrl || fallbackPreset?.apiBaseUrl || ''
    );

    return {
        id: normalizeText(provider?.id),
        presetId: normalizeText(provider?.presetId, 'custom-openai-compatible'),
        name,
        protocol: 'openai-compatible',
        enabled: provider?.enabled !== false,
        apiBaseUrl,
        apiKeys: normalizeApiKeys(provider?.apiKeys),
        extraHeaders: normalizeExtraHeaders(provider?.extraHeaders),
        models: mergeProviderModels(provider?.models),
    };
}

function normalizeModelRef(ref) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        return null;
    }

    const providerId = normalizeText(ref.providerId);
    const modelId = normalizeText(ref.modelId);
    if (!providerId || !modelId) {
        return null;
    }

    return { providerId, modelId };
}

function normalizeDefaults(defaults = {}, providers = []) {
    const validProviderIds = new Set(providers.map((provider) => provider.id));
    return MODEL_SERVICE_DEFAULT_KEYS.reduce((acc, key) => {
        const normalized = normalizeModelRef(defaults?.[key]);
        if (normalized && validProviderIds.has(normalized.providerId)) {
            const provider = providers.find((item) => item.id === normalized.providerId);
            const hasModel = Array.isArray(provider?.models)
                && provider.models.some((model) => model.id === normalized.modelId);
            acc[key] = hasModel ? normalized : null;
        } else {
            acc[key] = null;
        }
        return acc;
    }, {});
}

function normalizeModelService(service = DEFAULT_MODEL_SERVICE) {
    const source = service && typeof service === 'object' && !Array.isArray(service)
        ? service
        : DEFAULT_MODEL_SERVICE;
    const usedIds = new Set();
    const providers = (Array.isArray(source.providers) ? source.providers : [])
        .map((provider, index) => normalizeProviderConfig(provider, { index }))
        .filter((provider) => provider.id || provider.name || provider.apiBaseUrl || provider.models.length > 0)
        .map((provider, index) => ({
            ...provider,
            id: provider.id || createProviderId(
                provider.name || provider.presetId || `provider-${index + 1}`,
                usedIds
            ),
        }));

    return {
        version: MODEL_SERVICE_VERSION,
        providers,
        defaults: normalizeDefaults(source.defaults, providers),
    };
}

function collectLegacyModels(settings = {}, fieldEntries = [], defaults = {}) {
    return fieldEntries
        .map(([value, group, capabilities, source = 'manual']) => {
            const modelId = normalizeText(value);
            if (!modelId) {
                return null;
            }

            return normalizeModelConfig({
                id: modelId,
                name: modelId,
                group,
                capabilities,
                source,
                ...defaults,
            });
        })
        .filter(Boolean);
}

function createMigratedProvider({
    id,
    name,
    apiBaseUrl,
    apiKeys,
    models,
}) {
    return normalizeProviderConfig({
        id,
        presetId: 'custom-openai-compatible',
        name,
        protocol: 'openai-compatible',
        enabled: true,
        apiBaseUrl,
        apiKeys,
        extraHeaders: {},
        models,
    });
}

function resolveDefaultRefForProvider(provider, modelId = '') {
    const normalizedModelId = normalizeText(modelId);
    if (!provider?.id || !normalizedModelId) {
        return null;
    }

    const targetModel = (provider.models || []).find((model) => model.id === normalizedModelId);
    if (!targetModel) {
        return null;
    }

    return {
        providerId: provider.id,
        modelId: targetModel.id,
    };
}

function migrateLegacySettingsToModelService(settings = {}) {
    const chatBaseUrl = normalizeApiBaseUrl(settings?.vcpServerUrl);
    const kbBaseUrl = normalizeApiBaseUrl(settings?.kbBaseUrl || settings?.vcpServerUrl);
    const chatApiKeys = normalizeApiKeys(settings?.vcpApiKey);
    const kbApiKeys = normalizeApiKeys(settings?.kbApiKey || settings?.vcpApiKey);

    const chatModels = collectLegacyModels(settings, [
        [settings?.defaultModel, 'chat', { chat: true }],
        [settings?.followUpDefaultModel, 'chat', { chat: true }],
        [settings?.topicTitleDefaultModel, 'chat', { chat: true }],
        [settings?.lastModel, 'chat', { chat: true }],
        [settings?.guideModel, 'chat', { chat: true }],
    ]);
    const kbModels = collectLegacyModels(settings, [
        [settings?.kbEmbeddingModel, 'embedding', { chat: false, embedding: true, rerank: false, vision: false, reasoning: false }],
        [settings?.kbRerankModel, 'rerank', { chat: false, embedding: false, rerank: true, vision: false, reasoning: false }],
    ]);

    const providers = [];
    const hasChatProvider = Boolean(chatBaseUrl || chatApiKeys.length > 0 || chatModels.length > 0);
    const kbNeedsDedicatedProvider = Boolean(
        kbModels.length > 0
        && (
            !hasChatProvider
            || kbBaseUrl !== chatBaseUrl
            || JSON.stringify(kbApiKeys) !== JSON.stringify(chatApiKeys)
        )
    );

    let primaryProvider = null;
    if (hasChatProvider) {
        primaryProvider = createMigratedProvider({
            id: 'custom-provider',
            name: 'Custom Provider',
            apiBaseUrl: chatBaseUrl,
            apiKeys: chatApiKeys,
            models: chatModels,
        });
        providers.push(primaryProvider);
    }

    let kbProvider = primaryProvider;
    if (kbNeedsDedicatedProvider) {
        kbProvider = createMigratedProvider({
            id: 'knowledge-base-provider',
            name: 'Knowledge Base Provider',
            apiBaseUrl: kbBaseUrl,
            apiKeys: kbApiKeys,
            models: kbModels,
        });
        providers.push(kbProvider);
    } else if (primaryProvider && kbModels.length > 0) {
        primaryProvider = {
            ...primaryProvider,
            models: mergeProviderModels([...(primaryProvider.models || []), ...kbModels]),
        };
        providers[0] = primaryProvider;
        kbProvider = primaryProvider;
    } else if (!primaryProvider && kbModels.length > 0) {
        kbProvider = createMigratedProvider({
            id: 'custom-provider',
            name: 'Custom Provider',
            apiBaseUrl: kbBaseUrl,
            apiKeys: kbApiKeys,
            models: kbModels,
        });
        providers.push(kbProvider);
        primaryProvider = kbProvider;
    }

    const defaults = {
        chat: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.defaultModel) || normalizeText(settings?.lastModel) || normalizeText(settings?.guideModel)
            )
            : null,
        followUp: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.followUpDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        topicTitle: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.topicTitleDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        embedding: kbProvider
            ? resolveDefaultRefForProvider(kbProvider, normalizeText(settings?.kbEmbeddingModel))
            : null,
        rerank: kbProvider
            ? resolveDefaultRefForProvider(kbProvider, normalizeText(settings?.kbRerankModel))
            : null,
    };

    return normalizeModelService({
        version: MODEL_SERVICE_VERSION,
        providers,
        defaults,
    });
}

function findProviderById(service = DEFAULT_MODEL_SERVICE, providerId = '') {
    const normalizedProviderId = normalizeText(providerId);
    if (!normalizedProviderId) {
        return null;
    }

    return (service.providers || []).find((provider) => provider.id === normalizedProviderId) || null;
}

function findModelById(provider = {}, modelId = '') {
    const normalizedModelId = normalizeText(modelId);
    if (!normalizedModelId) {
        return null;
    }

    return (provider.models || []).find((model) => model.id === normalizedModelId) || null;
}

function resolveModelRef(service = DEFAULT_MODEL_SERVICE, ref = null, options = {}) {
    const normalizedRef = normalizeModelRef(ref);
    if (!normalizedRef) {
        return null;
    }

    const includeDisabled = options.includeDisabled === true;
    const provider = findProviderById(service, normalizedRef.providerId);
    const model = findModelById(provider, normalizedRef.modelId);
    if (!provider || !model) {
        return null;
    }

    if (!includeDisabled && (provider.enabled === false || model.enabled === false)) {
        return null;
    }

    return {
        ref: normalizedRef,
        provider,
        model,
    };
}

function resolveDefaultModelRef(service = DEFAULT_MODEL_SERVICE, taskKey = 'chat', options = {}) {
    const normalizedTaskKey = MODEL_SERVICE_DEFAULT_KEYS.includes(taskKey) ? taskKey : 'chat';
    return resolveModelRef(service, service?.defaults?.[normalizedTaskKey], options);
}

function resolveModelById(service = DEFAULT_MODEL_SERVICE, modelId = '', options = {}) {
    const normalizedModelId = normalizeText(modelId);
    if (!normalizedModelId) {
        return null;
    }

    const includeDisabled = options.includeDisabled === true;
    const capability = normalizeText(options.capability);
    for (const provider of service.providers || []) {
        if (!includeDisabled && provider.enabled === false) {
            continue;
        }

        for (const model of provider.models || []) {
            if (model.id !== normalizedModelId) {
                continue;
            }
            if (!includeDisabled && model.enabled === false) {
                continue;
            }
            if (capability && model.capabilities?.[capability] !== true) {
                continue;
            }

            return {
                ref: {
                    providerId: provider.id,
                    modelId: model.id,
                },
                provider,
                model,
            };
        }
    }

    return null;
}

function listEnabledModels(service = DEFAULT_MODEL_SERVICE, options = {}) {
    const capability = normalizeText(options.capability);
    const includeDisabled = options.includeDisabled === true;
    const items = [];

    for (const provider of service.providers || []) {
        if (!includeDisabled && provider.enabled === false) {
            continue;
        }
        for (const model of provider.models || []) {
            if (!includeDisabled && model.enabled === false) {
                continue;
            }
            if (capability && model.capabilities?.[capability] !== true) {
                continue;
            }
            items.push({
                provider,
                model,
                ref: {
                    providerId: provider.id,
                    modelId: model.id,
                },
            });
        }
    }

    return items;
}

function resolveProviderApiKey(provider = {}) {
    const apiKeys = normalizeApiKeys(provider?.apiKeys);
    return apiKeys[0] || '';
}

function buildResolvedExecution(result = null, purpose = 'chat') {
    if (!result?.provider || !result?.model) {
        return null;
    }

    const endpointBuilder = purpose === 'embedding'
        ? buildEmbeddingsEndpoint
        : purpose === 'rerank'
            ? buildRerankEndpoint
            : buildChatEndpoint;

    return {
        source: 'modelService',
        purpose,
        provider: result.provider,
        model: result.model,
        ref: result.ref,
        endpoint: endpointBuilder(result.provider.apiBaseUrl),
        apiKey: resolveProviderApiKey(result.provider),
        extraHeaders: result.provider.extraHeaders || {},
    };
}

function buildLegacyChatEndpoint(endpointOrBaseUrl) {
    const rawValue = normalizeText(endpointOrBaseUrl);
    if (!rawValue) {
        return '';
    }

    const normalizedBaseUrl = normalizeApiBaseUrl(rawValue);
    const normalizedInput = normalizeText(rawValue).toLowerCase();
    if (
        normalizedInput.endsWith('/v1/chat/completions')
        || normalizedInput.endsWith('/chat/completions')
    ) {
        return rawValue;
    }
    return buildChatEndpoint(normalizedBaseUrl);
}

function resolveExecutionConfig(settings = {}, options = {}) {
    const normalizedSettings = settings?.modelService
        ? normalizeModelService(settings.modelService)
        : createDefaultModelService();
    const purpose = normalizeText(options.purpose, 'chat');
    const requestedModel = normalizeText(options.requestedModel);
    const requestedRef = normalizeModelRef(options.requestedRef);
    const preferredTaskKey = MODEL_SERVICE_DEFAULT_KEYS.includes(purpose) ? purpose : 'chat';

    let resolved = null;
    if (requestedRef) {
        resolved = resolveModelRef(normalizedSettings, requestedRef, options);
    }
    if (!resolved && requestedModel) {
        resolved = resolveModelById(
            normalizedSettings,
            requestedModel,
            purpose === 'embedding' || purpose === 'rerank'
                ? { ...options, capability: purpose }
                : options
        );
    }
    if (!resolved) {
        resolved = resolveDefaultModelRef(normalizedSettings, preferredTaskKey, options);
    }
    if (!resolved && purpose !== 'chat') {
        resolved = resolveDefaultModelRef(normalizedSettings, 'chat', options);
    }

    const resolvedExecution = buildResolvedExecution(resolved, purpose);
    if (resolvedExecution) {
        return resolvedExecution;
    }

    if (purpose === 'embedding') {
        return {
            source: 'legacy',
            purpose,
            provider: null,
            model: normalizeText(settings?.kbEmbeddingModel)
                ? { id: normalizeText(settings.kbEmbeddingModel), name: normalizeText(settings.kbEmbeddingModel) }
                : null,
            ref: null,
            endpoint: buildEmbeddingsEndpoint(settings?.kbBaseUrl || settings?.vcpServerUrl),
            apiKey: normalizeText(settings?.kbApiKey || settings?.vcpApiKey),
            extraHeaders: {},
        };
    }

    if (purpose === 'rerank') {
        return {
            source: 'legacy',
            purpose,
            provider: null,
            model: normalizeText(settings?.kbRerankModel)
                ? { id: normalizeText(settings.kbRerankModel), name: normalizeText(settings.kbRerankModel) }
                : null,
            ref: null,
            endpoint: buildRerankEndpoint(settings?.kbBaseUrl || settings?.vcpServerUrl),
            apiKey: normalizeText(settings?.kbApiKey || settings?.vcpApiKey),
            extraHeaders: {},
        };
    }

    const legacyModel = requestedModel
        || normalizeText(settings?.defaultModel)
        || normalizeText(options.fallbackModel);
    return {
        source: 'legacy',
        purpose,
        provider: null,
        model: legacyModel ? { id: legacyModel, name: legacyModel } : null,
        ref: null,
        endpoint: normalizeText(options.fallbackEndpoint) || buildLegacyChatEndpoint(settings?.vcpServerUrl),
        apiKey: normalizeText(options.fallbackApiKey || settings?.vcpApiKey),
        extraHeaders: {},
    };
}

function getLegacyFallbackModel(service = DEFAULT_MODEL_SERVICE, taskKey = 'chat') {
    const resolved = resolveDefaultModelRef(service, taskKey);
    return resolved?.model?.id || '';
}

function buildLegacySettingsMirror(modelService = DEFAULT_MODEL_SERVICE, previousSettings = {}) {
    const normalizedModelService = normalizeModelService(modelService);
    const chatExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'chat' });
    const embeddingExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'embedding' });
    const rerankExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'rerank' });

    const chatModel = getLegacyFallbackModel(normalizedModelService, 'chat');
    const followUpModel = getLegacyFallbackModel(normalizedModelService, 'followUp') || chatModel;
    const topicTitleModel = getLegacyFallbackModel(normalizedModelService, 'topicTitle') || chatModel;
    const embeddingModel = getLegacyFallbackModel(normalizedModelService, 'embedding');
    const rerankModel = getLegacyFallbackModel(normalizedModelService, 'rerank');
    const kbExecution = embeddingExecution?.endpoint
        ? embeddingExecution
        : rerankExecution;

    return {
        vcpServerUrl: chatExecution?.endpoint || '',
        vcpApiKey: chatExecution?.apiKey || '',
        defaultModel: chatModel,
        followUpDefaultModel: followUpModel,
        topicTitleDefaultModel: topicTitleModel,
        kbBaseUrl: kbExecution?.provider?.apiBaseUrl || normalizeApiBaseUrl(previousSettings?.kbBaseUrl || ''),
        kbApiKey: kbExecution?.apiKey || '',
        kbEmbeddingModel: embeddingModel || normalizeText(previousSettings?.kbEmbeddingModel),
        kbRerankModel: rerankModel || normalizeText(previousSettings?.kbRerankModel),
        guideModel: normalizeText(previousSettings?.guideModel, chatModel),
        lastModel: normalizeText(previousSettings?.lastModel, chatModel),
    };
}

function mergeFetchedModelsIntoProvider(provider = {}, fetchedModels = []) {
    const normalizedProvider = normalizeProviderConfig(provider);
    const mergedModels = mergeProviderModels([
        ...(normalizedProvider.models || []),
        ...fetchedModels.map((model) => normalizeModelConfig({
            ...model,
            source: 'remote',
        })),
    ]);

    return {
        ...normalizedProvider,
        models: mergedModels,
    };
}

function mergeModelServices(primary = DEFAULT_MODEL_SERVICE, secondary = DEFAULT_MODEL_SERVICE) {
    const normalizedPrimary = normalizeModelService(primary);
    const normalizedSecondary = normalizeModelService(secondary);
    const providerMap = new Map();

    normalizedPrimary.providers.forEach((provider) => {
        providerMap.set(provider.id, normalizeProviderConfig(provider));
    });

    normalizedSecondary.providers.forEach((provider) => {
        if (!providerMap.has(provider.id)) {
            providerMap.set(provider.id, normalizeProviderConfig(provider));
            return;
        }

        const current = providerMap.get(provider.id);
        providerMap.set(provider.id, normalizeProviderConfig({
            ...current,
            ...provider,
            apiKeys: current.apiKeys?.length > 0 ? current.apiKeys : provider.apiKeys,
            extraHeaders: {
                ...(provider.extraHeaders || {}),
                ...(current.extraHeaders || {}),
            },
            models: mergeProviderModels([
                ...(current.models || []),
                ...(provider.models || []),
            ]),
        }));
    });

    return normalizeModelService({
        version: MODEL_SERVICE_VERSION,
        providers: [...providerMap.values()],
        defaults: MODEL_SERVICE_DEFAULT_KEYS.reduce((acc, key) => {
            acc[key] = normalizedPrimary.defaults?.[key] || normalizedSecondary.defaults?.[key] || null;
            return acc;
        }, {}),
    });
}

function createFetchedModelEntry(modelId = '') {
    const normalizedModelId = normalizeText(modelId);
    if (!normalizedModelId) {
        return null;
    }

    return normalizeModelConfig({
        id: normalizedModelId,
        name: normalizedModelId,
        source: 'remote',
    });
}

module.exports = {
    DEFAULT_MODEL_SERVICE,
    MODEL_CAPABILITY_KEYS,
    MODEL_SERVICE_DEFAULT_KEYS,
    MODEL_SERVICE_VERSION,
    PROVIDER_PRESETS,
    TASK_KEY_BY_LEGACY_SETTINGS_KEY,
    buildChatEndpoint,
    buildEmbeddingsEndpoint,
    buildInterruptEndpoint,
    buildLegacySettingsMirror,
    buildModelsEndpoint,
    buildRerankEndpoint,
    cloneModelService,
    createDefaultModelService,
    createFetchedModelEntry,
    detectRemoteModelCapabilities,
    findModelById,
    findProviderById,
    listEnabledModels,
    mergeFetchedModelsIntoProvider,
    mergeModelServices,
    migrateLegacySettingsToModelService,
    normalizeApiBaseUrl,
    normalizeApiKeys,
    normalizeDefaults,
    normalizeExtraHeaders,
    normalizeModelConfig,
    normalizeModelRef,
    normalizeModelService,
    normalizeProviderConfig,
    resolveDefaultModelRef,
    resolveExecutionConfig,
    resolveModelById,
    resolveModelRef,
    resolveProviderApiKey,
    resolveProviderPreset,
};

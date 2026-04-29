const MODEL_SERVICE_VERSION = 1;

const MODEL_SERVICE_DEFAULT_KEYS = Object.freeze([
    'chat',
    'thinkingChat',
    'chatFallback',
    'followUp',
    'studyTool',
    'topicTitle',
    'sourceGuide',
    'imageTranscription',
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

const MODEL_SERVICE_DEFAULT_REQUIRED_CAPABILITIES = Object.freeze({
    chat: ['chat'],
    thinkingChat: ['chat'],
    chatFallback: ['chat'],
    followUp: ['chat'],
    studyTool: ['chat'],
    topicTitle: ['chat'],
    sourceGuide: ['chat'],
    imageTranscription: ['chat', 'vision'],
    embedding: ['embedding'],
    rerank: ['rerank'],
});

const AIP_TEST_PROVIDER_PRESET_ID = 'aip-innovation-practice-test';
const AIP_TEST_PROVIDER_NAME = 'AI&P创新实践项目测试专用预设';
const AIP_TEST_API_BASE_URL = 'https://api.uniquest.top';
const AIP_TEST_CHAT_ENDPOINT = `${AIP_TEST_API_BASE_URL}/v1/chat/completions`;
const AIP_TEST_API_KEY = 'sk-TtwYTSOeumdwgYVLPM8ul0LcJXU7Cc4uCiiYEQQfjavRin8E';
const AIP_TEST_DEFAULT_MODEL = 'Qwen/Qwen3.5-397B-A17B';
const AIP_TEST_AUXILIARY_DEFAULT_MODEL = 'Qwen/Qwen3.5-122B-A10B';
const AIP_TEST_BUILT_IN_MODELS = Object.freeze([
    {
        id: 'Qwen/Qwen3.6-35B-A3B',
        name: 'Qwen/Qwen3.6-35B-A3B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: true },
    },
    {
        id: 'Qwen/Qwen3.6-27B',
        name: 'Qwen/Qwen3.6-27B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: true },
    },
    {
        id: 'Pro/moonshotai/Kimi-K2.6',
        name: 'Pro/moonshotai/Kimi-K2.6',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: true },
    },
    {
        id: 'Qwen/Qwen3-VL-Embedding-8B',
        name: 'Qwen/Qwen3-VL-Embedding-8B',
        group: 'embedding',
        capabilities: { chat: false, embedding: true, rerank: false, vision: true, reasoning: false },
    },
    {
        id: 'Qwen/Qwen3-VL-Reranker-8B',
        name: 'Qwen/Qwen3-VL-Reranker-8B',
        group: 'rerank',
        capabilities: { chat: false, embedding: false, rerank: true, vision: true, reasoning: false },
    },
    {
        id: 'Qwen/Qwen3.5-4B',
        name: 'Qwen/Qwen3.5-4B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
    },
    {
        id: 'Qwen/Qwen3.5-35B-A3B',
        name: 'Qwen/Qwen3.5-35B-A3B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
    },
    {
        id: 'Qwen/Qwen3.5-397B-A17B',
        name: 'Qwen/Qwen3.5-397B-A17B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
    },
    {
        id: 'deepseek-ai/DeepSeek-V4-Flash',
        name: 'new-model',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: true },
    },
    {
        id: 'Qwen/Qwen3.5-122B-A10B',
        name: 'Qwen/Qwen3.5-122B-A10B',
        group: 'chat',
        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
    },
]);

const PROVIDER_PRESETS = Object.freeze([
    {
        presetId: AIP_TEST_PROVIDER_PRESET_ID,
        name: AIP_TEST_PROVIDER_NAME,
        apiBaseUrl: AIP_TEST_API_BASE_URL,
    },
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
        thinkingChat: null,
        chatFallback: null,
        followUp: null,
        studyTool: null,
        topicTitle: null,
        sourceGuide: null,
        imageTranscription: null,
        embedding: null,
        rerank: null,
    },
});

const TASK_KEY_BY_LEGACY_SETTINGS_KEY = Object.freeze({
    defaultModel: 'chat',
    thinkingChatDefaultModel: 'thinkingChat',
    followUpDefaultModel: 'followUp',
    studyToolDefaultModel: 'studyTool',
    topicTitleDefaultModel: 'topicTitle',
    guideModel: 'sourceGuide',
    imageTranscriptionModel: 'imageTranscription',
    kbEmbeddingModel: 'embedding',
    kbRerankModel: 'rerank',
});

function createDefaultModelService() {
    return {
        version: MODEL_SERVICE_VERSION,
        providers: [],
        defaults: {
            chat: null,
            thinkingChat: null,
            chatFallback: null,
            followUp: null,
            studyTool: null,
            topicTitle: null,
            sourceGuide: null,
            imageTranscription: null,
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

function normalizeCapabilityFilter(value = '') {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(
        values
            .map((item) => normalizeText(item))
            .filter(Boolean)
    )];
}

function getRequiredCapabilitiesForTask(taskKey = '') {
    return normalizeCapabilityFilter(MODEL_SERVICE_DEFAULT_REQUIRED_CAPABILITIES[taskKey]);
}

function modelHasCapabilities(model = {}, capabilities = []) {
    const requiredCapabilities = normalizeCapabilityFilter(capabilities);
    if (requiredCapabilities.length === 0) {
        return true;
    }

    return requiredCapabilities.every((capability) => model?.capabilities?.[capability] === true);
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

function resolveBuiltInProviderPresetMeta({ apiBaseUrl = '', apiKeys = [] } = {}) {
    if (
        normalizeApiBaseUrl(apiBaseUrl) === normalizeApiBaseUrl(AIP_TEST_API_BASE_URL)
        && normalizeApiKeys(apiKeys).includes(AIP_TEST_API_KEY)
    ) {
        return PROVIDER_PRESETS.find((preset) => preset.presetId === AIP_TEST_PROVIDER_PRESET_ID) || null;
    }

    return null;
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

    if (/(reason|reasoning|thinking|deepthink|qwen|qwq|glm|zhipu|kimi|moonshot|deepseek|hunyuan|doubao|mimo|o1|o3|r1)/i.test(normalizedName)) {
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

function preserveKnownTrueCapabilities(model = {}, knownModel = null) {
    if (!knownModel?.capabilities) {
        return model;
    }

    return {
        ...model,
        capabilities: {
            ...(model.capabilities || {}),
            ...Object.fromEntries(
                Object.entries(knownModel.capabilities)
                    .filter(([, value]) => value === true)
            ),
        },
    };
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
            const requiredCapabilities = getRequiredCapabilitiesForTask(key);
            const hasModel = Array.isArray(provider?.models)
                && provider.models.some((model) => (
                    model.id === normalized.modelId
                    && modelHasCapabilities(model, requiredCapabilities)
                ));
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

function createBuiltInTestProvider() {
    return normalizeProviderConfig({
        id: 'aip-test-provider',
        presetId: AIP_TEST_PROVIDER_PRESET_ID,
        name: AIP_TEST_PROVIDER_NAME,
        protocol: 'openai-compatible',
        enabled: true,
        apiBaseUrl: AIP_TEST_API_BASE_URL,
        apiKeys: [AIP_TEST_API_KEY],
        extraHeaders: {},
        models: AIP_TEST_BUILT_IN_MODELS.map((model) => ({
            ...model,
            enabled: true,
            source: 'manual',
        })),
    });
}

function createBuiltInTestProviderDefaults(provider = {}) {
    const refFor = (modelId) => resolveDefaultRefForProvider(provider, modelId);
    return {
        chat: refFor(AIP_TEST_DEFAULT_MODEL),
        thinkingChat: refFor(AIP_TEST_DEFAULT_MODEL),
        chatFallback: refFor(AIP_TEST_AUXILIARY_DEFAULT_MODEL),
        followUp: refFor(AIP_TEST_AUXILIARY_DEFAULT_MODEL),
        studyTool: refFor(AIP_TEST_AUXILIARY_DEFAULT_MODEL),
        topicTitle: refFor(AIP_TEST_AUXILIARY_DEFAULT_MODEL),
        sourceGuide: refFor(AIP_TEST_DEFAULT_MODEL),
        imageTranscription: refFor(AIP_TEST_DEFAULT_MODEL),
        embedding: refFor('Qwen/Qwen3-VL-Embedding-8B'),
        rerank: refFor('Qwen/Qwen3-VL-Reranker-8B'),
    };
}

function mergeDefaultsPreservingConfigured(fallbackDefaults = {}, configuredDefaults = {}) {
    return MODEL_SERVICE_DEFAULT_KEYS.reduce((acc, key) => {
        acc[key] = configuredDefaults?.[key] || fallbackDefaults?.[key] || null;
        return acc;
    }, {});
}

function ensureBuiltInTestProvider(service = DEFAULT_MODEL_SERVICE) {
    const normalizedService = normalizeModelService(service);
    if (!Array.isArray(normalizedService.providers) || normalizedService.providers.length === 0) {
        return normalizedService;
    }

    const existingIndex = normalizedService.providers.findIndex((provider) => (
        provider.presetId === AIP_TEST_PROVIDER_PRESET_ID
        || (
            normalizeApiBaseUrl(provider.apiBaseUrl) === normalizeApiBaseUrl(AIP_TEST_API_BASE_URL)
            && normalizeApiKeys(provider.apiKeys).includes(AIP_TEST_API_KEY)
        )
    ));

    const builtInProvider = createBuiltInTestProvider();
    if (existingIndex === -1) {
        return normalizeModelService({
            ...normalizedService,
            providers: [
                ...normalizedService.providers,
                builtInProvider,
            ],
        });
    }

    const providers = [...normalizedService.providers];
    const existingModelsWithBuiltInCapabilities = (providers[existingIndex].models || [])
        .map((model) => preserveKnownTrueCapabilities(
            model,
            findModelById(builtInProvider, model.id)
        ));

    providers[existingIndex] = normalizeProviderConfig({
        ...providers[existingIndex],
        id: providers[existingIndex].id || builtInProvider.id,
        presetId: AIP_TEST_PROVIDER_PRESET_ID,
        name: AIP_TEST_PROVIDER_NAME,
        apiBaseUrl: AIP_TEST_API_BASE_URL,
        apiKeys: providers[existingIndex].apiKeys?.length > 0
            ? providers[existingIndex].apiKeys
            : builtInProvider.apiKeys,
        models: mergeProviderModels([
            ...builtInProvider.models,
            ...existingModelsWithBuiltInCapabilities,
        ]),
    });

    const serviceWithProvider = normalizeModelService({
        ...normalizedService,
        providers,
    });
    const currentBuiltInProvider = serviceWithProvider.providers[existingIndex];

    return normalizeModelService({
        ...serviceWithProvider,
        defaults: mergeDefaultsPreservingConfigured(
            createBuiltInTestProviderDefaults(currentBuiltInProvider),
            serviceWithProvider.defaults
        ),
    });
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
    const preset = resolveBuiltInProviderPresetMeta({ apiBaseUrl, apiKeys });

    return normalizeProviderConfig({
        id,
        presetId: preset?.presetId || 'custom-openai-compatible',
        name: preset?.name || name,
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

function buildModelServiceFromSettings(settings = {}) {
    const chatBaseUrl = normalizeApiBaseUrl(settings?.chatEndpoint);
    const kbBaseUrl = normalizeApiBaseUrl(settings?.kbBaseUrl || settings?.chatEndpoint);
    const chatApiKeys = normalizeApiKeys(settings?.chatApiKey);
    const kbApiKeys = normalizeApiKeys(settings?.kbApiKey || settings?.chatApiKey);

    const chatModels = collectLegacyModels(settings, [
        [settings?.defaultModel, 'chat', { chat: true }],
        [settings?.thinkingChatDefaultModel, 'chat', { chat: true }],
        [settings?.followUpDefaultModel, 'chat', { chat: true }],
        [settings?.studyToolDefaultModel, 'chat', { chat: true }],
        [settings?.topicTitleDefaultModel, 'chat', { chat: true }],
        [settings?.lastModel, 'chat', { chat: true }],
        [settings?.guideModel, 'chat', { chat: true }],
        [settings?.imageTranscriptionModel, 'chat', { chat: true, vision: true }],
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
        chatFallback: null,
        thinkingChat: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.thinkingChatDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        followUp: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.followUpDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        studyTool: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.studyToolDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        topicTitle: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.topicTitleDefaultModel) || normalizeText(settings?.defaultModel)
            )
            : null,
        sourceGuide: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.guideModel)
            )
            : null,
        imageTranscription: primaryProvider
            ? resolveDefaultRefForProvider(
                primaryProvider,
                normalizeText(settings?.imageTranscriptionModel)
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

    if (!modelHasCapabilities(model, options.capabilities || options.capability)) {
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
    const requiredCapabilities = normalizeCapabilityFilter(options.capabilities || options.capability);
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
            if (!modelHasCapabilities(model, requiredCapabilities)) {
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
    const requiredCapabilities = normalizeCapabilityFilter(options.capabilities || options.capability);
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
            if (!modelHasCapabilities(model, requiredCapabilities)) {
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
    const requiredCapabilities = normalizeCapabilityFilter(
        options.capabilities || options.capability || getRequiredCapabilitiesForTask(preferredTaskKey)
    );

    let resolved = null;
    if (requestedRef) {
        resolved = resolveModelRef(normalizedSettings, requestedRef, {
            ...options,
            capabilities: requiredCapabilities,
        });
    }
    if (!resolved && requestedModel) {
        resolved = resolveModelById(
            normalizedSettings,
            requestedModel,
            {
                ...options,
                capabilities: requiredCapabilities,
            }
        );
    }
    if (!resolved) {
        resolved = resolveDefaultModelRef(normalizedSettings, preferredTaskKey, {
            ...options,
            capabilities: requiredCapabilities,
        });
    }
    if (!resolved && purpose === 'sourceGuide' && normalizeText(settings?.guideModel)) {
        resolved = resolveModelById(normalizedSettings, settings.guideModel, {
            ...options,
            capabilities: requiredCapabilities,
        });
    }
    if (!resolved && purpose === 'imageTranscription' && normalizeText(settings?.imageTranscriptionModel)) {
        resolved = resolveModelById(normalizedSettings, settings.imageTranscriptionModel, {
            ...options,
            capabilities: requiredCapabilities,
        });
    }
    if (!resolved && purpose !== 'chat') {
        resolved = resolveDefaultModelRef(normalizedSettings, 'chat', {
            ...options,
            capabilities: requiredCapabilities,
        });
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
            endpoint: buildEmbeddingsEndpoint(settings?.kbBaseUrl || settings?.chatEndpoint),
            apiKey: normalizeText(settings?.kbApiKey || settings?.chatApiKey),
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
            endpoint: buildRerankEndpoint(settings?.kbBaseUrl || settings?.chatEndpoint),
            apiKey: normalizeText(settings?.kbApiKey || settings?.chatApiKey),
            extraHeaders: {},
        };
    }

    const legacyModel = requestedModel
        || (purpose === 'thinkingChat' ? normalizeText(settings?.thinkingChatDefaultModel) : '')
        || (purpose === 'sourceGuide' ? normalizeText(settings?.guideModel) : '')
        || (purpose === 'imageTranscription' ? normalizeText(settings?.imageTranscriptionModel) : '')
        || normalizeText(settings?.defaultModel)
        || normalizeText(options.fallbackModel);
    return {
        source: 'legacy',
        purpose,
        provider: null,
        model: legacyModel ? { id: legacyModel, name: legacyModel } : null,
        ref: null,
        endpoint: normalizeText(options.fallbackEndpoint) || buildLegacyChatEndpoint(settings?.chatEndpoint),
        apiKey: normalizeText(options.fallbackApiKey || settings?.chatApiKey),
        extraHeaders: {},
    };
}

function resolveChatFallbackExecution(settings = {}, options = {}) {
    const normalizedSettings = settings?.modelService
        ? normalizeModelService(settings.modelService)
        : createDefaultModelService();
    const resolved = resolveDefaultModelRef(normalizedSettings, 'chatFallback', options);
    return buildResolvedExecution(resolved, 'chat');
}

function getLegacyFallbackModel(service = DEFAULT_MODEL_SERVICE, taskKey = 'chat') {
    const resolved = resolveDefaultModelRef(service, taskKey);
    return resolved?.model?.id || '';
}

function buildSettingsMirrorFromModelService(modelService = DEFAULT_MODEL_SERVICE, previousSettings = {}) {
    const normalizedModelService = normalizeModelService(modelService);
    const chatExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'chat' });
    const embeddingExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'embedding' });
    const rerankExecution = resolveExecutionConfig({ modelService: normalizedModelService }, { purpose: 'rerank' });

    const chatModel = getLegacyFallbackModel(normalizedModelService, 'chat');
    const thinkingChatModel = getLegacyFallbackModel(normalizedModelService, 'thinkingChat') || chatModel;
    const followUpModel = getLegacyFallbackModel(normalizedModelService, 'followUp') || chatModel;
    const studyToolModel = getLegacyFallbackModel(normalizedModelService, 'studyTool') || chatModel;
    const topicTitleModel = getLegacyFallbackModel(normalizedModelService, 'topicTitle') || chatModel;
    const sourceGuideModel = getLegacyFallbackModel(normalizedModelService, 'sourceGuide');
    const imageTranscriptionModel = getLegacyFallbackModel(normalizedModelService, 'imageTranscription');
    const embeddingModel = getLegacyFallbackModel(normalizedModelService, 'embedding');
    const rerankModel = getLegacyFallbackModel(normalizedModelService, 'rerank');
    const kbExecution = embeddingExecution?.endpoint
        ? embeddingExecution
        : rerankExecution;

    return {
        chatEndpoint: chatExecution?.endpoint || '',
        chatApiKey: chatExecution?.apiKey || '',
        defaultModel: chatModel,
        thinkingChatDefaultModel: thinkingChatModel,
        followUpDefaultModel: followUpModel,
        studyToolDefaultModel: studyToolModel,
        topicTitleDefaultModel: topicTitleModel,
        kbBaseUrl: kbExecution?.provider?.apiBaseUrl || normalizeApiBaseUrl(previousSettings?.kbBaseUrl || ''),
        kbApiKey: kbExecution?.apiKey || '',
        kbEmbeddingModel: embeddingModel || normalizeText(previousSettings?.kbEmbeddingModel),
        kbRerankModel: rerankModel || normalizeText(previousSettings?.kbRerankModel),
        guideModel: sourceGuideModel || normalizeText(previousSettings?.guideModel),
        imageTranscriptionModel: imageTranscriptionModel || normalizeText(previousSettings?.imageTranscriptionModel),
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
    AIP_TEST_API_BASE_URL,
    AIP_TEST_API_KEY,
    AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    AIP_TEST_CHAT_ENDPOINT,
    AIP_TEST_DEFAULT_MODEL,
    AIP_TEST_PROVIDER_NAME,
    AIP_TEST_PROVIDER_PRESET_ID,
    DEFAULT_MODEL_SERVICE,
    MODEL_CAPABILITY_KEYS,
    MODEL_SERVICE_DEFAULT_KEYS,
    MODEL_SERVICE_DEFAULT_REQUIRED_CAPABILITIES,
    MODEL_SERVICE_VERSION,
    PROVIDER_PRESETS,
    TASK_KEY_BY_LEGACY_SETTINGS_KEY,
    buildChatEndpoint,
    buildEmbeddingsEndpoint,
    buildInterruptEndpoint,
    buildSettingsMirrorFromModelService,
    buildModelsEndpoint,
    buildRerankEndpoint,
    cloneModelService,
    createDefaultModelService,
    createBuiltInTestProvider,
    createFetchedModelEntry,
    detectRemoteModelCapabilities,
    ensureBuiltInTestProvider,
    findModelById,
    findProviderById,
    listEnabledModels,
    mergeFetchedModelsIntoProvider,
    mergeModelServices,
    buildModelServiceFromSettings,
    normalizeApiBaseUrl,
    normalizeApiKeys,
    normalizeDefaults,
    normalizeExtraHeaders,
    normalizeModelConfig,
    normalizeModelRef,
    normalizeModelService,
    normalizeProviderConfig,
    resolveDefaultModelRef,
    resolveChatFallbackExecution,
    resolveExecutionConfig,
    resolveModelById,
    resolveModelRef,
    resolveProviderApiKey,
    resolveProviderPreset,
};

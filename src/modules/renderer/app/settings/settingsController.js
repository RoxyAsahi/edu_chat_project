const SETTINGS_MODAL_META = Object.freeze({
    services: {
        title: '模型服务',
        subtitle: '管理全局 Provider、API 连接和模型清单。',
    },
    'default-model': {
        title: '默认模型',
        subtitle: '统一设置通用默认模型，以及追问与话题命名任务各自优先使用的模型。',
    },
    retrieval: {
        title: '检索调优',
        subtitle: '单独维护知识库检索参数，不与模型服务主界面混放。',
    },
    prompts: {
        title: '提示词设置',
        subtitle: '集中管理学习档案、提示变量和日志协议。',
    },
    display: {
        title: '显示设置',
        subtitle: '调整聊天字体、宽度和流式显示效果。',
    },
    global: {
        title: '模型服务',
        subtitle: '管理全局连接、检索模型和来源服务参数。',
    },
    'knowledge-base': {
        title: '来源管理',
        subtitle: '统一维护 Source 模型、来源库文档与调试工具。',
    },
});

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = 'Output formatting requirement: {{RenderingGuide}}';
const DEFAULT_RENDERING_PROMPT = [
    'When structured rendering helps, emit a raw HTML fragment directly in the answer so the chat bubble can render it while streaming.',
    'Use one root container such as <div id="response-root" style="...">...</div>; do not output <!DOCTYPE html>, <html>, <head>, or <body>.',
    'Do not wrap renderable HTML in Markdown fences like ```html, and do not present it as source code.',
    'Prefer normal Markdown for standard prose; use <pre><code> only when the learning content itself is code.',
    'When emitting tool or DailyNote protocol blocks, keep the protocol text raw and unstyled.',
    'Do not echo unresolved template variables in the final answer.',
].join(' ');
const DEFAULT_EMOTICON_PROMPT = [
    'This client supports local emoticon packs rendered from pseudo paths.',
    'Available emoticon packs:',
    '{{EmoticonPackSummary}}',
    'Primary generic pack path: {{GeneralEmoticonPath}}',
    'Generic pack files: {{GeneralEmoticonList}}',
    'When you want to use an emoticon, output HTML like <img src="{{GeneralEmoticonPath}}/文件名" width="120">.',
    'Only use filenames from the provided lists, keep width between 60 and 180, and do not invent missing files.',
].join('\n');
const DEFAULT_ADAPTIVE_BUBBLE_TIP = [
    'Keep answers readable and compact when rich layout is unnecessary.',
    'Only switch to more structured rendering when it clearly helps comprehension.',
].join(' ');

function sliceGraphemes(value, limit = 2) {
    const source = String(value || '').replace(/\s+/g, '').trim();
    if (!source) {
        return '';
    }

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(source), (segment) => segment.segment).slice(0, limit).join('');
    }

    return Array.from(source).slice(0, limit).join('');
}

function normalizeAgentCardEmoji(value) {
    return sliceGraphemes(value, 2);
}

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
    '### Task:',
    'Generate a concise, 3-5 word title with an emoji summarizing the chat history.',
    '### Guidelines:',
    '- The title should clearly represent the main theme or subject of the conversation.',
    '- Use emojis that enhance understanding of the topic, but avoid quotation marks or special formatting.',
    "- Write the title in the chat's primary language; default to English if multilingual.",
    '- Prioritize accuracy over excessive creativity; keep it clear and simple.',
    '- Your entire response must consist solely of the JSON object, without any introductory or concluding text.',
    '- The output must be a single, raw JSON object, without any markdown code fences or other encapsulating text.',
    '- Ensure no conversational text, affirmations, or explanations precede or follow the raw JSON output.',
    '### Output:',
    'JSON format: { "title": "your concise title here" }',
    '### Examples:',
    '- { "title": "📉 Stock Market Trends" }',
    '- { "title": "🍪 Perfect Chocolate Chip Recipe" }',
    '- { "title": "🎮 Video Game Development Insights" }',
    '### Chat History:',
    '<chat_history>',
    '{{MESSAGES:END:2}}',
    '</chat_history>',
].join('\n');
const SETTINGS_PERSISTENCE_FIELD_LABELS = Object.freeze({
    followUpDefaultModel: '追问默认模型',
    followUpPromptTemplate: '追问提示词模板',
    enableTopicTitleGeneration: '自动命名话题',
    topicTitleDefaultModel: '话题命名默认模型',
    topicTitlePromptTemplate: '话题命名提示词模板',
    enableRenderingPrompt: '结构化渲染提示',
    enableEmoticonPrompt: '表情包提示',
    enableAdaptiveBubbleTip: '简洁气泡补充',
    emoticonPrompt: '表情包提示模板',
    'studyLogPolicy.enableDailyNotePromptVariables': '内建 DailyNote 变量',
    'studyLogPolicy.autoInjectDailyNoteProtocol': '自动注入 DailyNote 协议',
});
const MODEL_SERVICE_VERSION = 1;
const MODEL_SERVICE_TASK_META = Object.freeze({
    chat: { label: '默认聊天模型', capability: 'chat', description: '普通对话与大部分聊天任务的兜底模型。' },
    chatFallback: { label: '聊天回退模型', capability: 'chat', description: '聊天上游失败时自动切换，覆盖普通聊天、追问、命名、来源指南与图片转写等聊天用途任务。' },
    followUp: { label: '追问模型', capability: 'chat', description: '自动生成追问时优先使用。' },
    topicTitle: { label: '话题命名模型', capability: 'chat', description: '首轮回复后的自动命名任务使用。' },
    embedding: { label: 'Embedding 模型', capability: 'embedding', description: '知识库向量化时使用，可独立于聊天 Provider。' },
    rerank: { label: 'Rerank 模型', capability: 'rerank', description: '知识库重排时使用，可独立于聊天 Provider。' },
});
const MODEL_SERVICE_GROUP_OPTIONS = Object.freeze([
    { value: 'chat', label: 'Chat' },
    { value: 'embedding', label: 'Embedding' },
    { value: 'rerank', label: 'Rerank' },
]);
const MODEL_SERVICE_CAPABILITY_LABELS = Object.freeze({
    chat: 'Chat',
    embedding: 'Embedding',
    rerank: 'Rerank',
    vision: 'Vision',
    reasoning: 'Reasoning',
});
const AIP_TEST_PROVIDER_PRESET_ID = 'aip-innovation-practice-test';
const AIP_TEST_PROVIDER_NAME = 'AI&P创新实践项目测试专用预设';
const AIP_TEST_API_BASE_URL = 'https://api.uniquest.top';
const AIP_TEST_API_KEY = 'sk-TtwYTSOeumdwgYVLPM8ul0LcJXU7Cc4uCiiYEQQfjavRin8E';
const AIP_TEST_DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B';
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
]);
const MODEL_SERVICE_PRESETS = Object.freeze([
    { presetId: AIP_TEST_PROVIDER_PRESET_ID, name: AIP_TEST_PROVIDER_NAME, apiBaseUrl: AIP_TEST_API_BASE_URL },
    { presetId: 'openai', name: 'OpenAI', apiBaseUrl: 'https://api.openai.com' },
    { presetId: 'openrouter', name: 'OpenRouter', apiBaseUrl: 'https://openrouter.ai/api' },
    { presetId: 'deepseek', name: 'DeepSeek', apiBaseUrl: 'https://api.deepseek.com' },
    { presetId: 'siliconflow', name: 'SiliconFlow', apiBaseUrl: 'https://api.siliconflow.cn' },
    { presetId: 'dashscope-compatible', name: 'DashScope Compatible', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' },
    { presetId: 'ollama', name: 'Ollama', apiBaseUrl: 'http://127.0.0.1:11434' },
    { presetId: 'lm-studio', name: 'LM Studio', apiBaseUrl: 'http://127.0.0.1:1234' },
    { presetId: 'oneapi-compatible', name: 'OneAPI/NewAPI Compatible', apiBaseUrl: 'http://127.0.0.1:3000' },
    { presetId: 'custom-openai-compatible', name: 'Custom OpenAI-Compatible', apiBaseUrl: '' },
]);

function createDefaultModelService() {
    return {
        version: MODEL_SERVICE_VERSION,
        providers: [],
        defaults: {
            chat: null,
            chatFallback: null,
            followUp: null,
            topicTitle: null,
            embedding: null,
            rerank: null,
        },
    };
}

function normalizeModelServiceText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function normalizeModelServiceBaseUrl(value) {
    const rawValue = normalizeModelServiceText(value);
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
    let serialized = url.toString();
    if (!url.search && !url.hash && serialized.endsWith('/')) {
        serialized = serialized.slice(0, -1);
    }
    return serialized;
}

function buildModelServiceEndpoint(apiBaseUrl, suffix) {
    const baseUrl = normalizeModelServiceBaseUrl(apiBaseUrl);
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
        let serialized = url.toString();
        if (!url.search && !url.hash && serialized.endsWith('/')) {
            serialized = serialized.slice(0, -1);
        }
        return serialized;
    } catch (_error) {
        return '';
    }
}

function parseModelServiceApiKeysInput(value) {
    return [...new Set(
        String(value || '')
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
    )];
}

function stringifyModelServiceApiKeys(apiKeys = []) {
    return (Array.isArray(apiKeys) ? apiKeys : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('\n');
}

function resolveBuiltInModelServicePreset({ apiBaseUrl = '', apiKeys = [] } = {}) {
    if (
        normalizeModelServiceBaseUrl(apiBaseUrl) === normalizeModelServiceBaseUrl(AIP_TEST_API_BASE_URL)
        && parseModelServiceApiKeysInput(apiKeys).includes(AIP_TEST_API_KEY)
    ) {
        return MODEL_SERVICE_PRESETS.find((preset) => preset.presetId === AIP_TEST_PROVIDER_PRESET_ID) || null;
    }

    return null;
}

function parseModelServiceHeadersInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return {};
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.fromEntries(
                Object.entries(parsed)
                    .map(([key, headerValue]) => [String(key || '').trim(), String(headerValue || '').trim()])
                    .filter(([key, headerValue]) => key && headerValue)
            );
        }
    } catch (_error) {
        // Fall through to line parsing.
    }

    return Object.fromEntries(
        trimmed
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const separatorIndex = line.indexOf(':');
                if (separatorIndex === -1) {
                    return ['', ''];
                }
                return [
                    line.slice(0, separatorIndex).trim(),
                    line.slice(separatorIndex + 1).trim(),
                ];
            })
            .filter(([key, headerValue]) => key && headerValue)
    );
}

function stringifyModelServiceHeaders(headers = {}) {
    return Object.entries(headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
}

function createModelServiceId(prefix = 'provider', existingItems = []) {
    const normalizedPrefix = normalizeModelServiceText(prefix, 'item')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item';
    const existingIds = new Set((Array.isArray(existingItems) ? existingItems : []).map((item) => item.id));
    let candidate = normalizedPrefix;
    let suffix = 2;
    while (existingIds.has(candidate)) {
        candidate = `${normalizedPrefix}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function detectModelServiceCapabilities(modelName = '') {
    const normalizedName = normalizeModelServiceText(modelName).toLowerCase();
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

function normalizeModelServiceModel(model = {}, fallback = {}) {
    const id = normalizeModelServiceText(model.id, normalizeModelServiceText(fallback.id, normalizeModelServiceText(model.name, fallback.name || '')));
    const name = normalizeModelServiceText(model.name, normalizeModelServiceText(fallback.name, id));
    const detectedCapabilities = detectModelServiceCapabilities(name || id);
    const sourceCapabilities = model.capabilities && typeof model.capabilities === 'object' && !Array.isArray(model.capabilities)
        ? model.capabilities
        : {};
    const capabilities = Object.fromEntries(
        Object.keys(MODEL_SERVICE_CAPABILITY_LABELS).map((key) => [
            key,
            typeof sourceCapabilities[key] === 'boolean' ? sourceCapabilities[key] : detectedCapabilities[key],
        ])
    );

    return {
        id,
        name: name || id,
        group: normalizeModelServiceText(model.group, capabilities.embedding ? 'embedding' : capabilities.rerank ? 'rerank' : 'chat'),
        capabilities,
        enabled: model.enabled !== false,
        source: normalizeModelServiceText(model.source, normalizeModelServiceText(fallback.source, 'manual')) === 'remote' ? 'remote' : 'manual',
    };
}

function mergeModelServiceModels(models = []) {
    const merged = [];
    const indexes = new Map();

    (Array.isArray(models) ? models : []).forEach((model) => {
        const normalized = normalizeModelServiceModel(model);
        if (!normalized.id) {
            return;
        }

        const existingIndex = indexes.get(normalized.id);
        if (existingIndex === undefined) {
            indexes.set(normalized.id, merged.length);
            merged.push(normalized);
            return;
        }

        const current = merged[existingIndex];
        if (current.source === 'manual' && normalized.source === 'remote') {
            return;
        }

        merged[existingIndex] = normalizeModelServiceModel({
            ...current,
            ...normalized,
            capabilities: {
                ...current.capabilities,
                ...normalized.capabilities,
            },
        }, current);
    });

    return merged;
}

function normalizeModelServiceProvider(provider = {}, index = 0) {
    const preset = MODEL_SERVICE_PRESETS.find((item) => item.presetId === provider.presetId) || null;
    const normalized = {
        id: normalizeModelServiceText(provider.id),
        presetId: normalizeModelServiceText(provider.presetId, preset?.presetId || 'custom-openai-compatible'),
        name: normalizeModelServiceText(provider.name, preset?.name || `Provider ${index + 1}`),
        protocol: 'openai-compatible',
        enabled: provider.enabled !== false,
        apiBaseUrl: normalizeModelServiceBaseUrl(provider.apiBaseUrl || preset?.apiBaseUrl || ''),
        apiKeys: Array.isArray(provider.apiKeys) ? provider.apiKeys : parseModelServiceApiKeysInput(provider.apiKeys),
        extraHeaders: provider.extraHeaders && typeof provider.extraHeaders === 'object' && !Array.isArray(provider.extraHeaders)
            ? Object.fromEntries(
                Object.entries(provider.extraHeaders)
                    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
                    .filter(([key, value]) => key && value)
            )
            : {},
        models: mergeModelServiceModels(provider.models),
    };

    if (!normalized.id) {
        normalized.id = createModelServiceId(normalized.name || normalized.presetId || `provider-${index + 1}`, []);
    }

    return normalized;
}

function normalizeModelServiceRef(ref) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        return null;
    }

    const providerId = normalizeModelServiceText(ref.providerId);
    const modelId = normalizeModelServiceText(ref.modelId);
    if (!providerId || !modelId) {
        return null;
    }
    return { providerId, modelId };
}

function normalizeModelServiceDefaults(defaults = {}, providers = []) {
    return Object.keys(MODEL_SERVICE_TASK_META).reduce((acc, key) => {
        const normalized = normalizeModelServiceRef(defaults?.[key]);
        if (!normalized) {
            acc[key] = null;
            return acc;
        }

        const provider = (providers || []).find((item) => item.id === normalized.providerId);
        const model = provider?.models?.find((item) => item.id === normalized.modelId) || null;
        acc[key] = provider && model
            ? normalized
            : null;
        return acc;
    }, {});
}

function normalizeModelService(service = {}) {
    const source = service && typeof service === 'object' && !Array.isArray(service)
        ? service
        : createDefaultModelService();
    const providers = (Array.isArray(source.providers) ? source.providers : [])
        .map((provider, index) => normalizeModelServiceProvider(provider, index))
        .filter((provider) => provider.id || provider.name || provider.apiBaseUrl || provider.models.length > 0);
    const dedupedProviders = [];
    const usedIds = new Set();
    providers.forEach((provider, index) => {
        const nextProvider = { ...provider };
        if (!nextProvider.id || usedIds.has(nextProvider.id)) {
            nextProvider.id = createModelServiceId(
                nextProvider.name || nextProvider.presetId || `provider-${index + 1}`,
                dedupedProviders
            );
        }
        usedIds.add(nextProvider.id);
        dedupedProviders.push(nextProvider);
    });

    return {
        version: MODEL_SERVICE_VERSION,
        providers: dedupedProviders,
        defaults: normalizeModelServiceDefaults(source.defaults, dedupedProviders),
    };
}

function createBuiltInTestModelServiceProvider() {
    return normalizeModelServiceProvider({
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

function ensureBuiltInTestProvider(service = {}) {
    const normalizedService = normalizeModelService(service);
    if (!Array.isArray(normalizedService.providers) || normalizedService.providers.length === 0) {
        return normalizedService;
    }

    const existingIndex = normalizedService.providers.findIndex((provider) => (
        provider.presetId === AIP_TEST_PROVIDER_PRESET_ID
        || (
            normalizeModelServiceBaseUrl(provider.apiBaseUrl) === normalizeModelServiceBaseUrl(AIP_TEST_API_BASE_URL)
            && parseModelServiceApiKeysInput(provider.apiKeys).includes(AIP_TEST_API_KEY)
        )
    ));
    const builtInProvider = createBuiltInTestModelServiceProvider();

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
    providers[existingIndex] = normalizeModelServiceProvider({
        ...providers[existingIndex],
        id: providers[existingIndex].id || builtInProvider.id,
        presetId: AIP_TEST_PROVIDER_PRESET_ID,
        name: AIP_TEST_PROVIDER_NAME,
        apiBaseUrl: AIP_TEST_API_BASE_URL,
        apiKeys: Array.isArray(providers[existingIndex].apiKeys) && providers[existingIndex].apiKeys.length > 0
            ? providers[existingIndex].apiKeys
            : builtInProvider.apiKeys,
        models: mergeModelServiceModels([
            ...builtInProvider.models,
            ...(providers[existingIndex].models || []),
        ]),
    });

    return normalizeModelService({
        ...normalizedService,
        providers,
    });
}

function findModelServiceProvider(service = {}, providerId = '') {
    return (service.providers || []).find((provider) => provider.id === providerId) || null;
}

function findModelServiceModel(provider = {}, modelId = '') {
    return (provider.models || []).find((model) => model.id === modelId) || null;
}

function resolveModelServiceRef(service = {}, ref = null, options = {}) {
    const normalizedRef = normalizeModelServiceRef(ref);
    if (!normalizedRef) {
        return null;
    }

    const provider = findModelServiceProvider(service, normalizedRef.providerId);
    const model = findModelServiceModel(provider, normalizedRef.modelId);
    if (!provider || !model) {
        return null;
    }

    if (options.onlyEnabled === true && (provider.enabled === false || model.enabled === false)) {
        return null;
    }

    if (options.capability && model.capabilities?.[options.capability] !== true) {
        return null;
    }

    return {
        provider,
        model,
        ref: normalizedRef,
    };
}

function listModelServiceModels(service = {}, options = {}) {
    const items = [];
    (service.providers || []).forEach((provider) => {
        if (options.onlyEnabled === true && provider.enabled === false) {
            return;
        }

        (provider.models || []).forEach((model) => {
            if (options.onlyEnabled === true && model.enabled === false) {
                return;
            }
            if (options.capability && model.capabilities?.[options.capability] !== true) {
                return;
            }
            items.push({
                provider,
                model,
                ref: {
                    providerId: provider.id,
                    modelId: model.id,
                },
            });
        });
    });
    return items;
}

function buildModelServiceMirror(service = {}, currentSettings = {}) {
    const normalizedService = normalizeModelService(service);
    const chatDefault = resolveModelServiceRef(normalizedService, normalizedService.defaults.chat);
    const followUpDefault = resolveModelServiceRef(normalizedService, normalizedService.defaults.followUp) || chatDefault;
    const topicTitleDefault = resolveModelServiceRef(normalizedService, normalizedService.defaults.topicTitle) || chatDefault;
    const embeddingDefault = resolveModelServiceRef(normalizedService, normalizedService.defaults.embedding);
    const rerankDefault = resolveModelServiceRef(normalizedService, normalizedService.defaults.rerank);
    const kbDefault = embeddingDefault || rerankDefault;

    return {
        chatEndpoint: chatDefault ? buildModelServiceEndpoint(chatDefault.provider.apiBaseUrl, '/v1/chat/completions') : '',
        chatApiKey: chatDefault ? String(chatDefault.provider.apiKeys?.[0] || '') : '',
        defaultModel: chatDefault?.model?.id || '',
        followUpDefaultModel: followUpDefault?.model?.id || '',
        topicTitleDefaultModel: topicTitleDefault?.model?.id || '',
        kbBaseUrl: kbDefault?.provider?.apiBaseUrl || normalizeModelServiceBaseUrl(currentSettings.kbBaseUrl || ''),
        kbApiKey: kbDefault ? String(kbDefault.provider.apiKeys?.[0] || '') : '',
        kbEmbeddingModel: embeddingDefault?.model?.id || normalizeModelServiceText(currentSettings.kbEmbeddingModel),
        kbRerankModel: rerankDefault?.model?.id || normalizeModelServiceText(currentSettings.kbRerankModel),
    };
}

function createProviderFromPreset(presetId = '', service = {}) {
    const preset = MODEL_SERVICE_PRESETS.find((item) => item.presetId === presetId)
        || MODEL_SERVICE_PRESETS.find((item) => item.presetId === 'custom-openai-compatible');
    return normalizeModelServiceProvider({
        id: createModelServiceId(preset.name || preset.presetId || 'provider', service.providers || []),
        presetId: preset.presetId,
        name: preset.name,
        protocol: 'openai-compatible',
        enabled: true,
        apiBaseUrl: preset.apiBaseUrl,
        apiKeys: [],
        extraHeaders: {},
        models: [],
    }, (service.providers || []).length);
}

function createManualModelForProvider(provider = {}) {
    return normalizeModelServiceModel({
        id: createModelServiceId('model', provider.models || []),
        name: 'new-model',
        group: 'chat',
        capabilities: {
            chat: true,
            embedding: false,
            rerank: false,
            vision: false,
            reasoning: false,
        },
        enabled: true,
        source: 'manual',
    });
}

function mergeFetchedModelsLocally(provider = {}, fetchedModels = []) {
    return {
        ...provider,
        models: mergeModelServiceModels([
            ...(provider.models || []),
            ...(Array.isArray(fetchedModels) ? fetchedModels.map((model) => ({
                ...model,
                source: 'remote',
            })) : []),
        ]),
    };
}

function hasConfiguredLocalModelService(service = {}) {
    if (!service || typeof service !== 'object') {
        return false;
    }

    if (Array.isArray(service.providers) && service.providers.length > 0) {
        return true;
    }

    return Object.values(service.defaults || {}).some((value) => Boolean(value?.providerId && value?.modelId));
}

function createBootstrapProvider({
    id,
    name,
    presetId,
    apiBaseUrl,
    apiKeys,
    models,
}) {
    const preset = resolveBuiltInModelServicePreset({ apiBaseUrl, apiKeys });

    return normalizeModelServiceProvider({
        id,
        presetId: presetId || preset?.presetId || 'custom-openai-compatible',
        name: preset?.name || name,
        protocol: 'openai-compatible',
        enabled: true,
        apiBaseUrl,
        apiKeys,
        extraHeaders: {},
        models,
    });
}

function buildBootstrapModelService(settings = {}) {
    const explicitModelService = settings?.modelService
        ? normalizeModelService(settings.modelService)
        : createDefaultModelService();
    if (hasConfiguredLocalModelService(explicitModelService)) {
        return explicitModelService;
    }

    const service = createDefaultModelService();
    const chatModels = [
        settings.defaultModel,
        settings.followUpDefaultModel,
        settings.topicTitleDefaultModel,
        settings.lastModel,
        settings.guideModel,
    ].filter((value) => normalizeModelServiceText(value));
    const kbModels = [
        settings.kbEmbeddingModel,
        settings.kbRerankModel,
    ].filter((value) => normalizeModelServiceText(value));
    const builtInChatPreset = resolveBuiltInModelServicePreset({
        apiBaseUrl: settings.chatEndpoint,
        apiKeys: settings.chatApiKey,
    });

    const chatProvider = createBootstrapProvider({
        id: builtInChatPreset ? 'aip-test-provider' : 'custom-provider',
        presetId: builtInChatPreset?.presetId || 'custom-openai-compatible',
        name: builtInChatPreset?.name || 'Custom Provider',
        apiBaseUrl: settings.chatEndpoint,
        apiKeys: parseModelServiceApiKeysInput(settings.chatApiKey),
        models: chatModels.map((modelId) => ({
            id: modelId,
            name: modelId,
            group: 'chat',
            capabilities: {
                chat: true,
                embedding: false,
                rerank: false,
                vision: false,
                reasoning: false,
            },
            enabled: true,
            source: 'manual',
        })),
    }, 0);

    const needsSeparateKbProvider = Boolean(
        normalizeModelServiceText(settings.kbBaseUrl || settings.kbApiKey)
        && (
            normalizeModelServiceBaseUrl(settings.kbBaseUrl || '') !== normalizeModelServiceBaseUrl(settings.chatEndpoint || '')
            || normalizeModelServiceText(settings.kbApiKey || '') !== normalizeModelServiceText(settings.chatApiKey || '')
        )
    );

    if (chatProvider.apiBaseUrl || chatProvider.apiKeys.length > 0 || chatProvider.models.length > 0) {
        service.providers.push(chatProvider);
    }

    if (kbModels.length > 0) {
        const kbProvider = needsSeparateKbProvider
            ? createBootstrapProvider({
                id: 'knowledge-base-provider',
                presetId: 'custom-openai-compatible',
                name: 'Knowledge Base Provider',
                apiBaseUrl: settings.kbBaseUrl || settings.chatEndpoint || '',
                apiKeys: parseModelServiceApiKeysInput(settings.kbApiKey || settings.chatApiKey || ''),
                models: [
                    settings.kbEmbeddingModel ? {
                        id: settings.kbEmbeddingModel,
                        name: settings.kbEmbeddingModel,
                        group: 'embedding',
                        capabilities: { chat: false, embedding: true, rerank: false, vision: false, reasoning: false },
                        enabled: true,
                        source: 'manual',
                    } : null,
                    settings.kbRerankModel ? {
                        id: settings.kbRerankModel,
                        name: settings.kbRerankModel,
                        group: 'rerank',
                        capabilities: { chat: false, embedding: false, rerank: true, vision: false, reasoning: false },
                        enabled: true,
                        source: 'manual',
                    } : null,
                ].filter(Boolean),
            }, service.providers.length)
            : mergeFetchedModelsLocally(chatProvider, [
                settings.kbEmbeddingModel ? {
                    id: settings.kbEmbeddingModel,
                    name: settings.kbEmbeddingModel,
                    group: 'embedding',
                    capabilities: { chat: false, embedding: true, rerank: false, vision: false, reasoning: false },
                    enabled: true,
                    source: 'manual',
                } : null,
                settings.kbRerankModel ? {
                    id: settings.kbRerankModel,
                    name: settings.kbRerankModel,
                    group: 'rerank',
                    capabilities: { chat: false, embedding: false, rerank: true, vision: false, reasoning: false },
                    enabled: true,
                    source: 'manual',
                } : null,
            ].filter(Boolean));

        if (needsSeparateKbProvider) {
            service.providers.push(kbProvider);
        } else if (service.providers.length > 0) {
            service.providers[0] = kbProvider;
        } else {
            service.providers.push(kbProvider);
        }
    }

    const primaryProvider = service.providers[0] || null;
    const kbProvider = service.providers.find((provider) => provider.id === 'knowledge-base-provider') || primaryProvider;

    service.defaults.chat = primaryProvider && normalizeModelServiceText(settings.defaultModel)
        ? { providerId: primaryProvider.id, modelId: settings.defaultModel }
        : null;
    service.defaults.followUp = primaryProvider && normalizeModelServiceText(settings.followUpDefaultModel)
        ? { providerId: primaryProvider.id, modelId: settings.followUpDefaultModel }
        : null;
    service.defaults.topicTitle = primaryProvider && normalizeModelServiceText(settings.topicTitleDefaultModel)
        ? { providerId: primaryProvider.id, modelId: settings.topicTitleDefaultModel }
        : null;
    service.defaults.embedding = kbProvider && normalizeModelServiceText(settings.kbEmbeddingModel)
        ? { providerId: kbProvider.id, modelId: settings.kbEmbeddingModel }
        : null;
    service.defaults.rerank = kbProvider && normalizeModelServiceText(settings.kbRerankModel)
        ? { providerId: kbProvider.id, modelId: settings.kbRerankModel }
        : null;

    return normalizeModelService(service);
}

function composeSettingsWithModelService(settings = {}) {
    const modelService = ensureBuiltInTestProvider(buildBootstrapModelService(settings));
    return {
        ...settings,
        modelService,
        ...buildModelServiceMirror(modelService, settings),
    };
}

function getModelServiceAvatarTone(seed = '') {
    const text = normalizeModelServiceText(seed, 'provider');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(index);
        hash |= 0;
    }

    const hue = Math.abs(hash) % 360;
    return {
        background: `hsl(${hue} 54% 58%)`,
        foreground: hue >= 40 && hue <= 110 ? '#1b2818' : '#ffffff',
    };
}

function renderModelServiceAvatar(seed = '', fallback = 'P') {
    const label = normalizeModelServiceText(seed).slice(0, 1).toUpperCase() || fallback;
    const tone = getModelServiceAvatarTone(seed || fallback);
    return `
        <span
          class="model-service-avatar"
          style="background:${escapeHtml(tone.background)};color:${escapeHtml(tone.foreground)};"
          aria-hidden="true"
        >
          ${escapeHtml(label)}
        </span>
    `;
}

function getModelServiceGroupMeta(group = 'chat') {
    if (group === 'embedding') {
        return { label: 'Embedding', icon: 'deployed_code_history' };
    }
    if (group === 'rerank') {
        return { label: 'Rerank', icon: 'swap_vert' };
    }
    return { label: 'Chat', icon: 'forum' };
}

function renderModelServiceModelLead(model = {}) {
    const label = normalizeModelServiceText(model.name || model.id).slice(0, 1).toUpperCase() || 'M';
    const tone = getModelServiceAvatarTone(model.name || model.id || 'M');
    return `
        <span
          class="model-service-model-lead model-service-model-lead--${escapeHtml(model.group || 'chat')}"
          style="background:${escapeHtml(tone.background)};color:${escapeHtml(tone.foreground)};"
          aria-hidden="true"
        >
          ${escapeHtml(label)}
        </span>
    `;
}

function getModelServiceProviderHostLabel(apiBaseUrl = '') {
    const baseUrl = normalizeModelServiceBaseUrl(apiBaseUrl);
    if (!baseUrl) {
        return '';
    }

    try {
        const url = new URL(baseUrl);
        return url.host || baseUrl;
    } catch (_error) {
        return baseUrl;
    }
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function parsePromptVariablesInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return {};
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([key, entryValue]) => typeof key === 'string' && typeof entryValue === 'string')
        );
    } catch (_error) {
        return null;
    }
}

function extractPromptTextFromAgentConfig(config = {}) {
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

function createSettingsController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const messageRendererApi = deps.messageRendererApi;
    const syncLayoutSettings = deps.syncLayoutSettings || (() => {});
    const resolvePromptText = deps.resolvePromptText || (async () => '');
    const reloadSelectedAgent = deps.reloadSelectedAgent || (async () => {});
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session?.currentSelectedItem || {});
    const getBubbleThemePreviewContext = deps.getBubbleThemePreviewContext || (() => ({}));
    const HTMLElementCtor = windowObj.HTMLElement || globalThis.HTMLElement;
    const isElementNode = (node) => Boolean(HTMLElementCtor && node instanceof HTMLElementCtor);
    let settingsModalTrigger = null;
    let subjectSettingsPanelTrigger = null;
    let isAgentEmojiPickerConfigured = false;
    let settingsPageReturnView = 'overview';
    let globalSettingsSaveTimer = null;
    let isSyncingGlobalSettingsForm = false;
    let isSavingGlobalSettings = false;
    let placeholderPreviewRequestId = 0;
    let lastFinalSystemPromptPreview = null;
    const modelServiceUiState = {
        providerSearch: '',
        modelSearch: '',
        selectedProviderId: '',
        selectedModelId: '',
        providerMenuId: '',
        showModelSearch: false,
        showApiKeys: false,
        collapsedGroups: {},
        providerStatus: null,
        popup: null,
    };
    let modelServiceDialogHost = null;

    function getSettingsSlice() {
        return store.getState().settings;
    }

    function getGlobalSettings() {
        return getSettingsSlice().settings;
    }

    function patchSettingsSlice(patch) {
        return store.patchState('settings', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    function patchGlobalSettings(patch) {
        return patchSettingsSlice((current, rootState) => ({
            settings: {
                ...current.settings,
                ...(typeof patch === 'function' ? patch(current.settings, rootState) : patch),
            },
        }));
    }

    function getNormalizedModelService() {
        return normalizeModelService(getGlobalSettings().modelService);
    }

    function syncLegacyModelServiceFields(settings = getGlobalSettings()) {
        const mirrors = buildModelServiceMirror(settings.modelService || createDefaultModelService(), settings);

        if (el.chatEndpoint) el.chatEndpoint.value = mirrors.chatEndpoint || '';
        if (el.chatApiKey) el.chatApiKey.value = mirrors.chatApiKey || '';
        if (el.kbBaseUrl) el.kbBaseUrl.value = mirrors.kbBaseUrl || '';
        if (el.kbApiKey) el.kbApiKey.value = mirrors.kbApiKey || '';
        if (el.kbEmbeddingModel) el.kbEmbeddingModel.value = mirrors.kbEmbeddingModel || '';
        if (el.kbRerankModel) el.kbRerankModel.value = mirrors.kbRerankModel || '';
        if (el.defaultModelInput) el.defaultModelInput.value = mirrors.defaultModel || '';
        if (el.followUpDefaultModelInput) el.followUpDefaultModelInput.value = mirrors.followUpDefaultModel || '';
        if (el.topicTitleDefaultModelInput) el.topicTitleDefaultModelInput.value = mirrors.topicTitleDefaultModel || '';
    }

    function ensureModelServiceUiSelections(service = getNormalizedModelService()) {
        const providers = Array.isArray(service.providers) ? service.providers : [];
        if (providers.length === 0) {
            modelServiceUiState.selectedProviderId = '';
            modelServiceUiState.selectedModelId = '';
            return null;
        }

        let provider = findModelServiceProvider(service, modelServiceUiState.selectedProviderId);
        if (!provider) {
            provider = providers[0];
            modelServiceUiState.selectedProviderId = provider.id;
        }

        const models = Array.isArray(provider.models) ? provider.models : [];
        let model = findModelServiceModel(provider, modelServiceUiState.selectedModelId);
        if (!model && models.length > 0) {
            model = models[0];
            modelServiceUiState.selectedModelId = model.id;
        } else if (!model) {
            modelServiceUiState.selectedModelId = '';
        }

        return provider;
    }

    function commitModelService(service, options = {}) {
        const normalizedService = normalizeModelService(service);
        const mirrored = buildModelServiceMirror(normalizedService, getGlobalSettings());
        patchGlobalSettings({
            modelService: normalizedService,
            ...mirrored,
        });
        ensureModelServiceUiSelections(normalizedService);
        syncLegacyModelServiceFields({
            ...getGlobalSettings(),
            modelService: normalizedService,
            ...mirrored,
        });
        renderModelServiceWorkbench();
        renderModelServiceDefaultSelectors();
        if (options.scheduleSave === true) {
            scheduleGlobalSettingsSave(options.delay ?? 160);
        }
    }

    function updateModelService(mutator, options = {}) {
        const nextService = typeof mutator === 'function'
            ? mutator(normalizeModelService(getNormalizedModelService()))
            : mutator;
        commitModelService(nextService, {
            scheduleSave: options.scheduleSave !== false,
            delay: options.delay,
        });
    }

    function setModelServiceStatus(status = null) {
        modelServiceUiState.providerStatus = status;
        renderModelServiceProviderDetail();
        renderModelServicePopup();
    }

    function getSelectedModelServiceProvider(service = getNormalizedModelService()) {
        const ensured = ensureModelServiceUiSelections(service);
        if (ensured) {
            return ensured;
        }
        return null;
    }

    function getSelectedModelServiceModel(provider = getSelectedModelServiceProvider()) {
        if (!provider) {
            return null;
        }
        ensureModelServiceUiSelections({
            version: MODEL_SERVICE_VERSION,
            providers: [provider],
            defaults: createDefaultModelService().defaults,
        });
        return findModelServiceModel(provider, modelServiceUiState.selectedModelId) || null;
    }

    function toggleModelServiceGroup(groupName = '') {
        const nextState = { ...(modelServiceUiState.collapsedGroups || {}) };
        nextState[groupName] = !nextState[groupName];
        modelServiceUiState.collapsedGroups = nextState;
        renderModelServiceModelsPanel();
    }

    function ensureModelServiceDialogHost() {
        if (modelServiceDialogHost && modelServiceDialogHost.isConnected) {
            return modelServiceDialogHost;
        }

        modelServiceDialogHost = documentObj.createElement('div');
        modelServiceDialogHost.id = 'modelServiceDialogHost';
        (documentObj.getElementById('modal-container') || documentObj.body).appendChild(modelServiceDialogHost);
        return modelServiceDialogHost;
    }

    function setModelServicePopup(popup = null) {
        modelServiceUiState.popup = popup;
        renderModelServicePopup();
    }

    function patchModelServicePopup(patch, shouldRender = true) {
        if (!modelServiceUiState.popup) {
            return;
        }

        modelServiceUiState.popup = typeof patch === 'function'
            ? patch(modelServiceUiState.popup)
            : {
                ...modelServiceUiState.popup,
                ...(patch || {}),
            };
        if (shouldRender) {
            renderModelServicePopup();
        }
    }

    function getModelServicePopupProvider(popup = modelServiceUiState.popup, service = getNormalizedModelService()) {
        if (!popup) {
            return null;
        }

        if (popup.providerId) {
            return findModelServiceProvider(service, popup.providerId) || null;
        }

        return getSelectedModelServiceProvider(service);
    }

    function maskModelServiceSecret(value = '') {
        const text = String(value || '').trim();
        if (!text) {
            return '未填写';
        }
        if (text.length <= 8) {
            return `${text.slice(0, 2)}••••`;
        }
        return `${text.slice(0, 4)}••••${text.slice(-4)}`;
    }

    function createModelServiceDraft(model = {}) {
        return {
            ...normalizeModelServiceModel(model),
            capabilities: {
                ...detectModelServiceCapabilities(model.name || model.id || ''),
                ...(model.capabilities || {}),
            },
        };
    }

    function openModelServiceProviderEditorPopup(options = {}) {
        const service = getNormalizedModelService();
        const provider = options.providerId
            ? findModelServiceProvider(service, options.providerId)
            : null;

        setModelServicePopup({
            type: 'provider-editor',
            mode: provider ? 'edit' : 'create',
            providerId: provider?.id || '',
            name: provider?.name || '',
            presetId: provider?.presetId || options.presetId || MODEL_SERVICE_PRESETS[0]?.presetId || 'openai',
            error: '',
        });
    }

    function saveModelServiceProviderEditorPopup() {
        const popup = modelServiceUiState.popup;
        if (!popup || popup.type !== 'provider-editor') {
            return;
        }

        const trimmedName = normalizeModelServiceText(popup.name);
        if (!trimmedName) {
            patchModelServicePopup({ error: 'Provider 名称不能为空。' });
            return;
        }

        if (popup.mode === 'edit' && popup.providerId) {
            modelServiceUiState.selectedProviderId = popup.providerId;
            updateModelService((currentService) => ({
                ...currentService,
                providers: (currentService.providers || []).map((provider) => (
                    provider.id === popup.providerId
                        ? { ...provider, name: trimmedName }
                        : provider
                )),
            }));
            setModelServicePopup(null);
            return;
        }

        const service = getNormalizedModelService();
        const provider = createProviderFromPreset(popup.presetId || 'custom-openai-compatible', service);
        provider.name = trimmedName;
        modelServiceUiState.selectedProviderId = provider.id;
        modelServiceUiState.selectedModelId = '';
        modelServiceUiState.providerMenuId = '';
        modelServiceUiState.showApiKeys = false;
        updateModelService((currentService) => ({
            ...currentService,
            providers: [...(currentService.providers || []), provider],
        }));
        setModelServicePopup(null);
    }

    function openModelServiceHeadersPopup() {
        const provider = getSelectedModelServiceProvider();
        if (!provider) {
            return;
        }

        setModelServicePopup({
            type: 'headers',
            providerId: provider.id,
            value: stringifyModelServiceHeaders(provider.extraHeaders),
        });
    }

    function openModelServiceCheckPopup() {
        const provider = getSelectedModelServiceProvider();
        if (!provider) {
            return;
        }

        const checkableModels = (provider.models || []).filter((model) => model.enabled !== false && model.capabilities?.chat === true);
        if (checkableModels.length === 0) {
            setModelServiceStatus({
                tone: 'warning',
                title: '没有可检测模型',
                message: '当前 Provider 还没有可用的聊天模型，请先拉取 /models 或手动添加模型。',
            });
            return;
        }

        setModelServicePopup({
            type: 'check-provider',
            providerId: provider.id,
            modelId: checkableModels[0]?.id || '',
        });
    }

    function openModelServiceHealthCheckPopup() {
        const provider = getSelectedModelServiceProvider();
        if (!provider) {
            return;
        }

        const apiKeys = Array.isArray(provider.apiKeys) ? provider.apiKeys.filter(Boolean) : [];
        setModelServicePopup({
            type: 'health-check',
            providerId: provider.id,
            keyMode: apiKeys.length > 1 ? 'all' : 'single',
            selectedKeyIndex: 0,
            executionMode: 'parallel',
            timeoutMs: 15000,
            running: false,
            results: [],
            error: '',
        });
    }

    function openModelServiceManageModelsPopup(search = '') {
        const provider = getSelectedModelServiceProvider();
        if (!provider) {
            return;
        }

        setModelServicePopup({
            type: 'manage-models',
            providerId: provider.id,
            search,
        });
    }

    function openModelServiceModelEditorPopup(options = {}) {
        const provider = getSelectedModelServiceProvider();
        if (!provider) {
            return;
        }

        const sourceModel = options.modelId
            ? findModelServiceModel(provider, options.modelId)
            : createManualModelForProvider(provider);
        if (!sourceModel) {
            return;
        }

        modelServiceUiState.selectedModelId = sourceModel.id;
        setModelServicePopup({
            type: 'model-editor',
            providerId: provider.id,
            mode: options.modelId ? 'edit' : 'create',
            originalModelId: options.modelId || '',
            returnToManage: options.returnToManage === true,
            manageSearch: options.manageSearch || '',
            error: '',
            draft: createModelServiceDraft(sourceModel),
        });
    }

    function deleteModelServiceModel(modelId = '') {
        const provider = getSelectedModelServiceProvider();
        if (!provider || !modelId) {
            return;
        }

        updateModelService((currentService) => ({
            ...currentService,
            providers: (currentService.providers || []).map((item) => (
                item.id === provider.id
                    ? {
                        ...item,
                        models: (item.models || []).filter((model) => model.id !== modelId),
                    }
                    : item
            )),
            defaults: Object.fromEntries(
                Object.entries(currentService.defaults || {}).map(([taskKey, ref]) => [
                    taskKey,
                    ref && ref.providerId === provider.id && ref.modelId === modelId ? null : ref,
                ])
            ),
        }));

        if (modelServiceUiState.selectedModelId === modelId) {
            modelServiceUiState.selectedModelId = '';
        }

        if (modelServiceUiState.popup?.type === 'manage-models') {
            renderModelServicePopup();
        }
    }

    function saveModelServiceModelEditorPopup() {
        const popup = modelServiceUiState.popup;
        if (!popup || popup.type !== 'model-editor') {
            return;
        }

        const provider = getModelServicePopupProvider(popup);
        if (!provider) {
            setModelServicePopup(null);
            return;
        }

        const draft = createModelServiceDraft({
            ...(popup.draft || {}),
            source: popup.mode === 'edit' ? popup.draft?.source : 'manual',
        });
        if (!draft.id) {
            patchModelServicePopup({ error: '模型 ID 不能为空。' });
            return;
        }

        const duplicated = (provider.models || []).some((model) => model.id === draft.id && model.id !== popup.originalModelId);
        if (duplicated) {
            patchModelServicePopup({ error: `模型 ID "${draft.id}" 已存在。` });
            return;
        }

        updateModelService((currentService) => ({
            ...currentService,
            providers: (currentService.providers || []).map((item) => {
                if (item.id !== provider.id) {
                    return item;
                }

                const existingModels = item.models || [];
                const nextModels = popup.mode === 'edit'
                    ? existingModels.map((model) => (model.id === popup.originalModelId ? draft : model))
                    : [...existingModels, draft];
                return {
                    ...item,
                    models: mergeModelServiceModels(nextModels),
                };
            }),
            defaults: popup.mode === 'edit' && popup.originalModelId && popup.originalModelId !== draft.id
                ? Object.fromEntries(
                    Object.entries(currentService.defaults || {}).map(([taskKey, ref]) => [
                        taskKey,
                        ref && ref.providerId === provider.id && ref.modelId === popup.originalModelId
                            ? { providerId: provider.id, modelId: draft.id }
                            : ref,
                    ])
                )
                : currentService.defaults,
        }));

        modelServiceUiState.selectedModelId = draft.id;
        if (popup.returnToManage === true) {
            openModelServiceManageModelsPopup(popup.manageSearch || '');
            return;
        }
        setModelServicePopup(null);
    }

    function renderModelServicePopup(service = getNormalizedModelService()) {
        const host = ensureModelServiceDialogHost();
        const popup = modelServiceUiState.popup;
        if (!popup) {
            host.innerHTML = '';
            return;
        }

        const provider = popup.type === 'provider-editor' && popup.mode === 'create'
            ? null
            : getModelServicePopupProvider(popup, service);
        if (popup.type !== 'provider-editor' && !provider) {
            modelServiceUiState.popup = null;
            host.innerHTML = '';
            return;
        }

        if (popup.type === 'provider-editor') {
            const avatarSeed = popup.name || MODEL_SERVICE_PRESETS.find((preset) => preset.presetId === popup.presetId)?.name || 'P';
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal model-service-modal--provider" role="dialog" aria-modal="true" data-model-service-popup="provider-editor">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>${popup.mode === 'edit' ? '编辑提供商' : '添加提供商'}</strong>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-divider"></div>
                    <div class="model-service-modal__body model-service-modal__body--provider">
                      <div class="model-service-provider-avatar-shell">
                        ${renderModelServiceAvatar(avatarSeed, 'P').replace('class="model-service-avatar"', 'class="model-service-avatar model-service-avatar--popup"')}
                      </div>
                      <label class="model-service-stack-field">
                        <span>提供商名称</span>
                        <input class="model-service-control" type="text" data-model-service-popup-field="providerName" value="${escapeHtml(popup.name || '')}" maxlength="32" placeholder="My Provider" />
                      </label>
                      <label class="model-service-stack-field">
                        <span>提供商类型</span>
                        <select class="model-service-control" data-model-service-popup-field="providerPresetId" ${popup.mode === 'edit' ? 'disabled' : ''}>
                          ${MODEL_SERVICE_PRESETS.map((preset) => `
                            <option value="${escapeHtml(preset.presetId)}" ${preset.presetId === popup.presetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>
                          `).join('')}
                        </select>
                      </label>
                      ${popup.error ? `<div class="model-service-popup-error">${escapeHtml(popup.error)}</div>` : ''}
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close>取消</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="save-provider-editor">确定</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        if (popup.type === 'check-provider') {
            const models = (provider.models || []).filter((model) => model.enabled !== false && model.capabilities?.chat === true);
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal" role="dialog" aria-modal="true" data-model-service-popup="check-provider">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>检测模型</strong>
                        <span>${escapeHtml(provider.name)}</span>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-modal__body">
                      <div class="model-service-setting-subtitle">选择一个聊天模型进行检测</div>
                      <label class="model-service-stack-field">
                        <select class="model-service-control" data-model-service-popup-field="modelId">
                          ${models.map((model) => `
                            <option value="${escapeHtml(model.id)}" ${model.id === popup.modelId ? 'selected' : ''}>${escapeHtml(model.name)}</option>
                          `).join('')}
                        </select>
                      </label>
                      <div class="model-service-popup-help">检测会使用当前 Provider 的 Base URL 和 API Key 发起一次最小请求。</div>
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close>取消</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="confirm-check-provider">开始检测</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        if (popup.type === 'headers') {
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal model-service-modal--headers" role="dialog" aria-modal="true" data-model-service-popup="headers">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>高级请求头</strong>
                        <span>${escapeHtml(provider.name)}</span>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-modal__body">
                      <label class="model-service-stack-field">
                        <span>支持 JSON 或 Header: Value 每行一条</span>
                        <textarea class="model-service-control model-service-control--multiline model-service-control--popup" rows="8" data-model-service-popup-field="value" placeholder='{"HTTP-Referer":"https://example.com"}'>${escapeHtml(popup.value || '')}</textarea>
                      </label>
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close>取消</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="save-headers">保存</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        if (popup.type === 'health-check') {
            const apiKeys = Array.isArray(provider.apiKeys) ? provider.apiKeys.filter(Boolean) : [];
            const selectedKey = apiKeys[popup.selectedKeyIndex] || '';
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal model-service-modal--health-check" role="dialog" aria-modal="true" data-model-service-popup="health-check">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>健康检查</strong>
                        <span>${escapeHtml(provider.name)}</span>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-modal__body">
                      <div class="model-service-popup-alert">配置只在当前窗口生效，不会写入设置。</div>
                      <div class="model-service-popup-grid">
                        <label class="model-service-stack-field">
                          <span>API Key</span>
                          <select class="model-service-control" data-model-service-popup-field="keyMode">
                            <option value="single" ${popup.keyMode === 'single' ? 'selected' : ''}>单个 Key</option>
                            <option value="all" ${popup.keyMode === 'all' ? 'selected' : ''}>全部 Key</option>
                          </select>
                        </label>
                        <label class="model-service-stack-field">
                          <span>执行模式</span>
                          <select class="model-service-control" data-model-service-popup-field="executionMode">
                            <option value="parallel" ${popup.executionMode === 'parallel' ? 'selected' : ''}>并行</option>
                            <option value="serial" ${popup.executionMode === 'serial' ? 'selected' : ''}>串行</option>
                          </select>
                        </label>
                        <label class="model-service-stack-field">
                          <span>超时</span>
                          <input class="model-service-control" type="number" min="5" step="1" data-model-service-popup-field="timeoutSeconds" value="${escapeHtml(String(Math.max(5, Math.round(Number(popup.timeoutMs || 15000) / 1000))))}" />
                        </label>
                      </div>
                      ${popup.keyMode === 'single' && apiKeys.length > 1 ? `
                        <div class="model-service-popup-keylist">
                          ${apiKeys.map((key, index) => `
                            <label class="model-service-popup-keyitem">
                              <input type="radio" name="modelServiceHealthKey" value="${escapeHtml(String(index))}" data-model-service-popup-field="selectedKeyIndex" ${index === popup.selectedKeyIndex ? 'checked' : ''} />
                              <span>${escapeHtml(maskModelServiceSecret(key))}</span>
                            </label>
                          `).join('')}
                        </div>
                      ` : `
                        <div class="model-service-popup-help">${apiKeys.length === 0 ? '当前没有可用 API Key，健康检查大概率会失败。' : `当前将使用 ${escapeHtml(maskModelServiceSecret(selectedKey || apiKeys[0] || ''))}${popup.keyMode === 'all' && apiKeys.length > 1 ? ` 以及另外 ${apiKeys.length - 1} 个 Key` : ''}。`}</div>
                      `}
                      ${popup.error ? `<div class="model-service-popup-error">${escapeHtml(popup.error)}</div>` : ''}
                      ${Array.isArray(popup.results) && popup.results.length > 0 ? `
                        <div class="model-service-popup-results">
                          ${popup.results.map((item) => `
                            <article class="model-service-health-item ${item.success ? 'model-service-health-item--ok' : 'model-service-health-item--error'}">
                              <strong>${escapeHtml(item.modelId || '未知模型')}</strong>
                              <span>Key #${Number(item.apiKeyIndex || 0) + 1} · ${escapeHtml(String(item.latencyMs || 0))} ms</span>
                              <span>${escapeHtml(item.success ? '连接正常' : (item.error || '检测失败'))}</span>
                            </article>
                          `).join('')}
                        </div>
                      ` : ''}
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close ${popup.running ? 'disabled' : ''}>关闭</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="start-health-check" ${popup.running ? 'disabled' : ''}>${popup.running ? '检测中...' : '开始检测'}</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        if (popup.type === 'manage-models') {
            const query = normalizeModelServiceText(popup.search).toLowerCase();
            const visibleModels = (provider.models || []).filter((model) => (
                !query || [model.id, model.name, model.group].some((value) => String(value || '').toLowerCase().includes(query))
            ));
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal model-service-modal--manage-models" role="dialog" aria-modal="true" data-model-service-popup="manage-models">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>管理模型</strong>
                        <span>${escapeHtml(provider.name)} · ${escapeHtml(String((provider.models || []).length))} 个模型</span>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-modal__body">
                      <label class="model-service-toolbar-search model-service-toolbar-search--popup">
                        <span class="material-symbols-outlined">search</span>
                        <input type="search" data-model-service-popup-field="search" value="${escapeHtml(popup.search || '')}" placeholder="搜索模型" />
                      </label>
                      <div class="model-service-popup-list">
                        ${visibleModels.length > 0 ? visibleModels.map((model) => `
                          <article class="model-service-popup-model-row">
                            ${renderModelServiceModelLead(model)}
                            <span class="model-service-model-row__main">
                              <span class="model-service-model-row__title">
                                <strong>${escapeHtml(model.name)}</strong>
                                <span class="model-service-badge ${model.source === 'remote' ? 'model-service-badge--soft' : 'model-service-badge--manual'}">${model.source === 'remote' ? 'REMOTE' : 'MANUAL'}</span>
                                <span class="model-service-badge">${escapeHtml(getModelServiceGroupMeta(model.group).label)}</span>
                              </span>
                              <span class="model-service-model-row__id">${escapeHtml(model.id)}</span>
                            </span>
                            <span class="model-service-model-row__actions model-service-model-row__actions--visible">
                              <button class="model-service-model-tool" type="button" data-model-service-popup-action="edit-model" data-model-id="${escapeHtml(model.id)}" title="编辑模型">
                                <span class="material-symbols-outlined">edit</span>
                              </button>
                              <button class="model-service-model-tool" type="button" data-model-service-popup-action="delete-model" data-model-id="${escapeHtml(model.id)}" title="删除模型">
                                <span class="material-symbols-outlined">delete</span>
                              </button>
                            </span>
                          </article>
                        `).join('') : `
                          <div class="empty-list-state">
                            <strong>没有匹配的模型</strong>
                            <span>可以直接添加一个手动模型，或者先回主界面拉取 /models。</span>
                          </div>
                        `}
                      </div>
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close>关闭</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="open-add-model">添加模型</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        if (popup.type === 'model-editor') {
            const draft = popup.draft || createModelServiceDraft(createManualModelForProvider(provider));
            host.innerHTML = `
                <div class="model-service-modal-overlay" data-model-service-popup-overlay>
                  <div class="model-service-modal model-service-modal--model-editor" role="dialog" aria-modal="true" data-model-service-popup="model-editor">
                    <div class="model-service-modal__header">
                      <div class="model-service-modal__titleblock">
                        <strong>${popup.mode === 'edit' ? '编辑模型' : '添加模型'}</strong>
                        <span>${escapeHtml(provider.name)}</span>
                      </div>
                      <button class="model-service-modal__close" type="button" data-model-service-popup-close aria-label="关闭">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div class="model-service-modal__body">
                      <div class="model-service-popup-grid">
                        <label class="model-service-stack-field">
                          <span>模型 ID</span>
                          <input class="model-service-control" type="text" data-model-service-popup-field="draft.id" value="${escapeHtml(draft.id)}" ${draft.source === 'remote' ? 'readonly aria-readonly="true"' : ''} />
                        </label>
                        <label class="model-service-stack-field">
                          <span>显示名称</span>
                          <input class="model-service-control" type="text" data-model-service-popup-field="draft.name" value="${escapeHtml(draft.name)}" />
                        </label>
                        <label class="model-service-stack-field">
                          <span>分组</span>
                          <select class="model-service-control" data-model-service-popup-field="draft.group">
                            ${MODEL_SERVICE_GROUP_OPTIONS.map((option) => `
                              <option value="${escapeHtml(option.value)}" ${draft.group === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                            `).join('')}
                          </select>
                        </label>
                        <label class="model-service-stack-field">
                          <span>启用</span>
                          <label class="model-service-popup-checkbox">
                            <input type="checkbox" data-model-service-popup-field="draft.enabled" ${draft.enabled !== false ? 'checked' : ''} />
                            <span>在默认模型选择器中可见</span>
                          </label>
                        </label>
                      </div>
                      <div class="model-service-capability-grid model-service-capability-grid--popup">
                        ${Object.entries(MODEL_SERVICE_CAPABILITY_LABELS).map(([key, label]) => `
                          <label class="model-service-capability-pill">
                            <input type="checkbox" data-model-service-popup-capability="${escapeHtml(key)}" ${draft.capabilities?.[key] === true ? 'checked' : ''} />
                            <span>${escapeHtml(label)}</span>
                          </label>
                        `).join('')}
                      </div>
                      ${popup.error ? `<div class="model-service-popup-error">${escapeHtml(popup.error)}</div>` : ''}
                    </div>
                    <div class="model-service-modal__footer">
                      <button class="model-service-button" type="button" data-model-service-popup-close>取消</button>
                      <button class="model-service-button model-service-button--primary" type="button" data-model-service-popup-action="save-model-editor">保存</button>
                    </div>
                  </div>
                </div>
            `;
            return;
        }

        host.innerHTML = '';
    }

    function renderModelServiceCapabilityBadges(model = {}) {
        return Object.entries(MODEL_SERVICE_CAPABILITY_LABELS)
            .filter(([key]) => model.capabilities?.[key] === true)
            .map(([, label]) => `<span class="model-service-badge model-service-badge--capability">${escapeHtml(label)}</span>`)
            .join('');
    }

function renderModelServicePresetActions(service = getNormalizedModelService()) {
        if (el.modelServiceAddProviderBtn) {
            el.modelServiceAddProviderBtn.classList.remove('model-service-add-button--active');
            el.modelServiceAddProviderBtn.setAttribute('aria-expanded', 'false');
            el.modelServiceAddProviderBtn.innerHTML = `
                <span class="material-symbols-outlined">add</span>
                <span>添加</span>
            `;
        }

        if (el.modelServicePresetActions) {
            el.modelServicePresetActions.innerHTML = '';
    }
}

function getModelServiceProviderCallout(provider = {}) {
    if (provider.presetId === AIP_TEST_PROVIDER_PRESET_ID) {
        return {
            tone: 'info',
            title: '竞赛测试专用',
            message: '用于评委快速验证项目聊天与检索能力，打开即可直接测试，无需手动填写服务地址或模型清单。',
        };
    }

    return null;
}

function renderModelServiceProviderList(service = getNormalizedModelService()) {
        if (!el.modelServiceProviderList) {
            return;
        }

        ensureModelServiceUiSelections(service);
        const query = normalizeModelServiceText(modelServiceUiState.providerSearch).toLowerCase();
        const providers = (service.providers || []).filter((provider) => {
            if (!query) {
                return true;
            }
            return [
                provider.name,
                provider.presetId,
                provider.apiBaseUrl,
            ].some((item) => String(item || '').toLowerCase().includes(query));
        });

        if (providers.length === 0) {
            el.modelServiceProviderList.innerHTML = `
                <div class="empty-list-state">
                  <strong>没有匹配的 Provider</strong>
                  <span>试试调整搜索词，或者点击底部按钮新增一个 Provider。</span>
                </div>
            `;
            return;
        }

        el.modelServiceProviderList.innerHTML = providers.map((provider) => {
            const menuOpen = provider.id === modelServiceUiState.providerMenuId;
            return `
                <article
                  class="model-service-provider-row ${provider.id === modelServiceUiState.selectedProviderId ? 'model-service-provider-row--active' : ''} ${menuOpen ? 'model-service-provider-row--menu-open' : ''} ${provider.enabled === false ? 'model-service-provider-row--disabled' : ''}"
                  data-model-service-provider-menu-root="${escapeHtml(provider.id)}"
                >
                  <button
                    class="model-service-provider-row__main"
                    type="button"
                    data-model-service-provider-select="${escapeHtml(provider.id)}"
                  >
                    <span class="material-symbols-outlined model-service-provider-row__drag" aria-hidden="true">drag_indicator</span>
                    ${renderModelServiceAvatar(provider.name || provider.presetId, 'P')}
                    <span class="model-service-provider-row__content">
                      <strong class="model-service-provider-row__name">${escapeHtml(provider.name)}</strong>
                      <span class="model-service-provider-row__subline">${escapeHtml(
                          provider.presetId === AIP_TEST_PROVIDER_PRESET_ID
                              ? '竞赛测试专用 · 评委可直接使用'
                              : (provider.apiBaseUrl || provider.presetId || '')
                      )}</span>
                    </span>
                  </button>
                  <button
                    class="model-service-provider-row__menu"
                    type="button"
                    data-model-service-provider-menu-toggle="${escapeHtml(provider.id)}"
                    aria-expanded="${menuOpen ? 'true' : 'false'}"
                    title="更多操作"
                  >
                    <span class="material-symbols-outlined">more_horiz</span>
                  </button>
                  ${menuOpen ? `
                    <div class="model-service-provider-menu" data-model-service-provider-menu="${escapeHtml(provider.id)}">
                      <button class="model-service-provider-menu__item" type="button" data-model-service-provider-menu-action="edit" data-provider-id="${escapeHtml(provider.id)}">
                        <span class="material-symbols-outlined">edit</span>
                        <span>编辑</span>
                      </button>
                      <button class="model-service-provider-menu__item" type="button" data-model-service-provider-menu-action="fetch" data-provider-id="${escapeHtml(provider.id)}">
                        <span class="material-symbols-outlined">download</span>
                        <span>拉取模型</span>
                      </button>
                      <button class="model-service-provider-menu__item model-service-provider-menu__item--danger" type="button" data-model-service-provider-menu-action="delete" data-provider-id="${escapeHtml(provider.id)}">
                        <span class="material-symbols-outlined">delete</span>
                        <span>删除</span>
                      </button>
                    </div>
                  ` : ''}
                </article>
            `;
        }).join('');
    }

    function renderModelServiceProviderDetail(service = getNormalizedModelService()) {
        if (!el.modelServiceProviderDetail) {
            return;
        }

        const provider = getSelectedModelServiceProvider(service);
        if (!provider) {
            el.modelServiceProviderDetail.innerHTML = `
                <div class="empty-list-state">
                  <strong>先创建一个 Provider</strong>
                  <span>左侧选择预置模板后，这里会展示 Base URL、API Key、检测和拉取模型工具。</span>
                </div>
            `;
            return;
        }

        const status = modelServiceUiState.providerStatus;
        const presetLabel = MODEL_SERVICE_PRESETS.find((preset) => preset.presetId === provider.presetId)?.name || provider.presetId || 'Custom';
        const headerCount = Object.keys(provider.extraHeaders || {}).length;
        const hasChatModel = (provider.models || []).some((model) => model.enabled !== false && model.capabilities?.chat === true);
        const apiPreview = buildModelServiceEndpoint(provider.apiBaseUrl, '/v1/chat/completions');
        const apiKeysValue = (Array.isArray(provider.apiKeys) ? provider.apiKeys : []).join(', ');
        const callout = getModelServiceProviderCallout(provider);

        el.modelServiceProviderDetail.innerHTML = `
            <div class="model-service-detail">
              <div class="model-service-setting-title">
                <div class="model-service-setting-title__main">
                  <span class="model-service-setting-title__heading">
                    <strong>${escapeHtml(provider.name)}</strong>
                  </span>
                  <span>${escapeHtml(presetLabel)} · OpenAI-compatible</span>
                </div>
                <label class="model-service-toggle" title="启用 Provider">
                  <input type="checkbox" data-model-service-provider-field="enabled" aria-label="启用 Provider" ${provider.enabled !== false ? 'checked' : ''} />
                </label>
              </div>
              <div class="model-service-divider"></div>

              ${callout ? `
                <div class="model-service-status model-service-status--${escapeHtml(callout.tone || 'info')}">
                  <strong>${escapeHtml(callout.title || '说明')}</strong>
                  <span>${escapeHtml(callout.message || '')}</span>
                </div>
              ` : ''}

              ${status ? `
                <div class="model-service-status model-service-status--${escapeHtml(status.tone || 'info')}">
                  <strong>${escapeHtml(status.title || '提示')}</strong>
                  <span>${escapeHtml(status.message || '')}</span>
                </div>
              ` : ''}

              <section class="model-service-setting-group">
                <div class="model-service-setting-subtitle">API 密钥</div>
                <div class="model-service-input-row model-service-input-row--key">
                  <input class="model-service-control" type="${modelServiceUiState.showApiKeys === true ? 'text' : 'password'}" data-model-service-provider-field="apiKeys" value="${escapeHtml(apiKeysValue)}" placeholder="sk-xxx, sk-yyy" spellcheck="false" autocomplete="off" />
                  <button class="model-service-icon-button" type="button" data-model-service-action="toggle-api-keys-visibility" title="${modelServiceUiState.showApiKeys === true ? '隐藏 API Key' : '显示 API Key'}">
                    <span class="material-symbols-outlined">${modelServiceUiState.showApiKeys === true ? 'visibility_off' : 'visibility'}</span>
                  </button>
                  <button class="model-service-button ${provider.apiKeys?.length ? 'model-service-button--primary' : ''}" type="button" data-model-service-action="check-provider">
                    检测
                  </button>
                </div>
                <div class="model-service-help-row model-service-help-row--spread">
                  <span>支持逗号或换行录入多个 Key。</span>
                  <span>${Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0 ? `${provider.apiKeys.length} Keys` : 'No API Key'}</span>
                </div>
                ${hasChatModel ? '' : `<div class="model-service-help-row"><span>当前还没有可检测的聊天模型。</span></div>`}
              </section>

              <section class="model-service-setting-group">
                <div class="model-service-setting-subtitle-row">
                  <div class="model-service-setting-subtitle">API 地址</div>
                  <div class="model-service-setting-actions">
                    <button class="model-service-icon-button ${headerCount > 0 ? 'model-service-icon-button--active' : ''}" type="button" data-model-service-action="edit-headers" title="高级请求头">
                      <span class="material-symbols-outlined">settings</span>
                    </button>
                  </div>
                </div>
                <div class="model-service-input-row model-service-input-row--api">
                  <input class="model-service-control" type="text" data-model-service-provider-field="apiBaseUrl" value="${escapeHtml(provider.apiBaseUrl)}" placeholder="https://api.example.com" />
                </div>
                <div class="model-service-popup-help">
                  ${escapeHtml(apiPreview || '只填写 Base URL，具体接口路径会自动补全为 /v1/chat/completions。')}
                </div>
              </section>
            </div>
        `;
    }

    function renderModelServiceModelsPanel(service = getNormalizedModelService()) {
        if (!el.modelServiceModelsPanel) {
            return;
        }

        const provider = getSelectedModelServiceProvider(service);
        if (!provider) {
            el.modelServiceModelsPanel.innerHTML = `
                <div class="empty-list-state">
                  <strong>这里会显示模型列表</strong>
                  <span>先选择一个 Provider，然后拉取 /models 或手动新增模型。</span>
                </div>
            `;
            return;
        }

        const modelQuery = normalizeModelServiceText(modelServiceUiState.modelSearch).toLowerCase();
        const visibleModels = (provider.models || []).filter((model) => {
            if (!modelQuery) {
                return true;
            }
            return [model.id, model.name, model.group]
                .some((value) => String(value || '').toLowerCase().includes(modelQuery));
        });
        const groupedModels = visibleModels.reduce((groups, model) => {
            const groupName = model.group || 'chat';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(model);
            return groups;
        }, {});
        const groupOrder = Array.from(new Set([
            ...MODEL_SERVICE_GROUP_OPTIONS.map((option) => option.value),
            ...Object.keys(groupedModels),
        ]));
        const orderedGroups = groupOrder
            .map((groupName) => ({
                groupName,
                models: groupedModels[groupName] || [],
            }))
            .filter((entry) => entry.models.length > 0);
        const showModelSearch = modelServiceUiState.showModelSearch === true || Boolean(modelServiceUiState.modelSearch);

        el.modelServiceModelsPanel.innerHTML = `
            <div class="model-service-models">
              <div class="model-service-setting-subtitle-row model-service-setting-subtitle-row--models">
                <div class="model-service-models__headline">
                  <div class="model-service-setting-subtitle model-service-setting-subtitle--models">Models</div>
                  <span class="model-service-models__count">${escapeHtml(String(visibleModels.length))}</span>
                </div>
                <div class="model-service-setting-actions">
                  <button class="model-service-icon-button ${showModelSearch ? 'model-service-icon-button--active' : ''}" type="button" data-model-service-action="toggle-model-search" title="搜索模型">
                    <span class="material-symbols-outlined">search</span>
                  </button>
                  <button class="model-service-icon-button" type="button" data-model-service-action="run-health-check" title="健康检查">
                    <span class="material-symbols-outlined">monitor_heart</span>
                  </button>
                </div>
              </div>

              ${showModelSearch ? `
                <label class="model-service-toolbar-search">
                  <span class="material-symbols-outlined">search</span>
                  <input type="search" data-model-service-model-search value="${escapeHtml(modelServiceUiState.modelSearch)}" placeholder="Search models" />
                </label>
              ` : ''}

              <div class="model-service-model-groups">
                ${orderedGroups.length > 0
                    ? orderedGroups.map(({ groupName, models }) => {
                        const groupMeta = getModelServiceGroupMeta(groupName);
                        const isCollapsed = modelServiceUiState.collapsedGroups?.[groupName] === true;
                        return `
                            <section class="model-service-group ${isCollapsed ? '' : 'model-service-group--open'}">
                              <button
                                class="model-service-group__header"
                                type="button"
                                data-model-service-group-toggle="${escapeHtml(groupName)}"
                                aria-expanded="${isCollapsed ? 'false' : 'true'}"
                              >
                                <span class="model-service-group__title">
                                  <span class="material-symbols-outlined model-service-group__chevron">${isCollapsed ? 'chevron_right' : 'expand_more'}</span>
                                  <strong>${escapeHtml(groupMeta.label)}</strong>
                                </span>
                                <span class="model-service-badge">${escapeHtml(String(models.length))}</span>
                              </button>
                              ${isCollapsed ? '' : `
                                <div class="model-service-group__list">
                                  ${models.map((model) => `
                                      <article
                                        class="model-service-model-row ${model.id === modelServiceUiState.selectedModelId ? 'model-service-model-row--active' : ''}"
                                        data-model-service-model-select="${escapeHtml(model.id)}"
                                      >
                                        ${renderModelServiceModelLead(model)}
                                        <span class="model-service-model-row__main">
                                          <span class="model-service-model-row__title">
                                            <strong>${escapeHtml(model.name)}</strong>
                                            <span class="model-service-badge ${model.source === 'remote' ? 'model-service-badge--soft' : 'model-service-badge--manual'}">${model.source === 'remote' ? 'REMOTE' : 'MANUAL'}</span>
                                            ${model.enabled === false ? '<span class="model-service-badge model-service-badge--muted">OFF</span>' : ''}
                                          </span>
                                          <span class="model-service-model-row__id">${escapeHtml(model.id)}</span>
                                        </span>
                                        <span class="model-service-model-row__actions">
                                          <button class="model-service-model-tool" type="button" data-model-service-action="edit-model" data-model-id="${escapeHtml(model.id)}" title="编辑模型">
                                            <span class="material-symbols-outlined">edit</span>
                                          </button>
                                          <button class="model-service-model-tool" type="button" data-model-service-action="delete-model" data-model-id="${escapeHtml(model.id)}" title="删除模型">
                                            <span class="material-symbols-outlined">delete</span>
                                          </button>
                                        </span>
                                      </article>
                                  `).join('')}
                                </div>
                              `}
                            </section>
                        `;
                    }).join('')
                    : `<div class="empty-list-state"><strong>没有匹配的模型</strong><span>可以拉取 /models，或者先手动新增一个模型。</span></div>`
                }
              </div>
              <div class="model-service-model-actions">
                <button class="model-service-button model-service-button--primary" type="button" data-model-service-action="manage-models">管理</button>
                <button class="model-service-button" type="button" data-model-service-action="add-model">添加</button>
              </div>
            </div>
        `;
    }

    function renderModelServiceDefaultSelectors(service = getNormalizedModelService()) {
        if (!el.modelServiceDefaultSelectors) {
            return;
        }

        const optionsByTask = Object.entries(MODEL_SERVICE_TASK_META).map(([taskKey, meta]) => {
            const currentRef = service.defaults?.[taskKey];
            const chatDefaultRef = service.defaults?.chat || null;
            const availableModels = listModelServiceModels(service, {
                capability: meta.capability,
                onlyEnabled: true,
            });
            return {
                taskKey,
                meta,
                currentRef,
                chatDefaultRef,
                availableModels,
            };
        });

        el.modelServiceDefaultSelectors.innerHTML = `
            <div class="settings-list model-service-default-list">
              ${optionsByTask.map(({ taskKey, meta, currentRef, chatDefaultRef, availableModels }) => {
                    const sameAsPrimary = taskKey === 'chatFallback'
                        && currentRef
                        && chatDefaultRef
                        && currentRef.providerId === chatDefaultRef.providerId
                        && currentRef.modelId === chatDefaultRef.modelId;
                    const helperText = availableModels.length > 0
                        ? `${availableModels.length} 个可选模型 · ${meta.capability}${sameAsPrimary ? ' · 当前与默认聊天模型相同，运行时会视为未配置回退' : ''}`
                        : `暂无可用 ${meta.capability} 模型`;
                    const description = `${meta.description} ${helperText}`;
                    return `
                  <article class="settings-row model-service-default-row">
                    <div class="settings-row__main model-service-default-row__meta">
                      <strong>${escapeHtml(meta.label)}</strong>
                      <span>${escapeHtml(description)}</span>
                    </div>
                    <label class="settings-row__control model-service-default-row__control">
                      <select data-model-service-default="${escapeHtml(taskKey)}" aria-label="${escapeHtml(meta.label)}" ${availableModels.length === 0 ? 'disabled' : ''}>
                        <option value="">未设置</option>
                        ${availableModels.map((item) => {
                            const optionValue = `${item.ref.providerId}::${item.ref.modelId}`;
                            const isSelected = currentRef
                                && currentRef.providerId === item.ref.providerId
                                && currentRef.modelId === item.ref.modelId;
                            return `
                              <option value="${escapeHtml(optionValue)}" ${isSelected ? 'selected' : ''}>
                                ${escapeHtml(item.provider.name)} · ${escapeHtml(item.model.name)}
                              </option>
                            `;
                        }).join('')}
                      </select>
                    </label>
                  </article>
              `;
                }).join('')}
            </div>
        `;
    }

    function renderModelServiceWorkbench() {
        const service = getNormalizedModelService();
        ensureModelServiceUiSelections(service);
        renderModelServicePresetActions(service);
        renderModelServiceProviderList(service);
        renderModelServiceProviderDetail(service);
        renderModelServiceModelsPanel(service);
        renderModelServicePopup(service);
        syncLegacyModelServiceFields({
            ...getGlobalSettings(),
            modelService: service,
        });
    }

    async function detectSelectedModelServiceProvider(modelId = '') {
        const service = getNormalizedModelService();
        const provider = getSelectedModelServiceProvider(service);
        if (!provider) {
            return;
        }

        if (typeof chatAPI.checkModelServiceProvider !== 'function') {
            setModelServiceStatus({
                tone: 'warning',
                title: '当前预加载接口不可用',
                message: '本次运行环境没有暴露 Provider 检测能力。',
            });
            return;
        }

        setModelServiceStatus({
            tone: 'info',
            title: '正在检测',
            message: `正在检测 ${provider.name} 的可用性...`,
        });

        const result = await chatAPI.checkModelServiceProvider({
            provider,
            modelId: modelId || '',
        }).catch((error) => ({
            success: false,
            error: error.message,
        }));

        if (result?.success) {
            setModelServiceStatus({
                tone: 'success',
                title: '检测成功',
                message: `响应正常，延迟约 ${result.latencyMs || 0} ms。`,
            });
            return;
        }

        setModelServiceStatus({
            tone: 'warning',
            title: result?.needsModelSelection ? '需要先选择聊天模型' : '检测失败',
            message: result?.error || '未能完成连接检测。',
        });
    }

    async function fetchSelectedModelServiceModels() {
        const service = getNormalizedModelService();
        const provider = getSelectedModelServiceProvider(service);
        if (!provider) {
            return;
        }

        if (typeof chatAPI.fetchModelServiceModels !== 'function') {
            setModelServiceStatus({
                tone: 'warning',
                title: '当前预加载接口不可用',
                message: '本次运行环境没有暴露模型拉取能力。',
            });
            return;
        }

        setModelServiceStatus({
            tone: 'info',
            title: '正在拉取 /models',
            message: `正在从 ${provider.name} 拉取远端模型列表...`,
        });

        const result = await chatAPI.fetchModelServiceModels({
            provider,
        }).catch((error) => ({
            success: false,
            error: error.message,
            models: [],
        }));

        if (!result?.success) {
            setModelServiceStatus({
                tone: 'warning',
                title: '拉取失败',
                message: result?.error || '未能获取远端模型列表。',
            });
            return;
        }

        updateModelService((currentService) => ({
            ...currentService,
            providers: (currentService.providers || []).map((item) => (
                item.id === provider.id
                    ? mergeFetchedModelsLocally(item, result.models || [])
                    : item
            )),
        }));

        setModelServiceStatus({
            tone: 'success',
            title: '模型已更新',
            message: `共导入 ${Number(result.itemCount || 0)} 个远端模型，手动模型已保留。`,
        });
    }

    async function runSelectedModelServiceHealthCheck(options = {}) {
        const service = getNormalizedModelService();
        const provider = getSelectedModelServiceProvider(service);
        if (!provider) {
            return;
        }

        if (typeof chatAPI.checkModelServiceHealth !== 'function') {
            setModelServiceStatus({
                tone: 'warning',
                title: '当前预加载接口不可用',
                message: '本次运行环境没有暴露批量健康检查能力。',
            });
            return;
        }

        const apiKeys = Array.isArray(options.apiKeys) ? options.apiKeys.filter(Boolean) : [];
        const executionMode = options.executionMode || 'parallel';
        const timeoutMs = Number(options.timeoutMs || 15000);
        patchModelServicePopup((popup) => (
            popup?.type === 'health-check'
                ? {
                    ...popup,
                    running: true,
                    error: '',
                    results: [],
                }
                : popup
        ));
        setModelServiceStatus({
            tone: 'info',
            title: '正在批量检查',
            message: `按 ${executionMode === 'serial' ? '串行' : '并行'} 模式检测 ${provider.name}...`,
        });

        const result = await chatAPI.checkModelServiceHealth({
            provider: apiKeys.length > 0 ? { ...provider, apiKeys } : provider,
            timeoutMs,
            executionMode,
        }).catch((error) => ({
            success: false,
            error: error.message,
            results: [],
        }));

        patchModelServicePopup((popup) => (
            popup?.type === 'health-check'
                ? {
                    ...popup,
                    running: false,
                    error: result?.success ? '' : (result?.error || '未能完成批量检测。'),
                    results: Array.isArray(result?.results) ? result.results : [],
                }
                : popup
        ));

        if (result?.success) {
            const healthResults = Array.isArray(result?.results) ? result.results : [];
            const successCount = healthResults.filter((item) => item.success).length;
            setModelServiceStatus({
                tone: successCount === healthResults.length ? 'success' : 'warning',
                title: '健康检查完成',
                message: `${successCount}/${healthResults.length} 个组合检测通过。`,
            });
            return;
        }

        setModelServiceStatus({
            tone: 'warning',
            title: '健康检查失败',
            message: result?.error || '未能完成批量检测。',
        });
    }

    function applyTheme(_theme) {
        documentObj.body.classList.remove('dark-theme');
        documentObj.body.classList.add('light-theme');
    }

    function setGlobalSettingsSaveStatus(message, tone = '') {
        if (!el.settingsAutoSaveStatus) {
            return;
        }
        el.settingsAutoSaveStatus.textContent = message;
        el.settingsAutoSaveStatus.classList.remove(
            'settings-caption--success',
            'settings-caption--warning',
            'settings-caption--info'
        );
        if (tone) {
            el.settingsAutoSaveStatus.classList.add(`settings-caption--${tone}`);
        }
    }

    function applyRendererSettings() {
        const settings = getGlobalSettings();
        const chatFonts = {
            system: '"Segoe UI", "PingFang SC", sans-serif',
            serif: 'Georgia, "Noto Serif SC", serif',
            cascadia: '"Cascadia Code", "Consolas", monospace',
            monospace: '"Cascadia Code", "Consolas", monospace',
            consolas: '"Cascadia Code", "Consolas", monospace',
        };

        documentObj.documentElement.style.setProperty('--unistudy-chat-max-width', `${Number(settings.chatBubbleMaxWidthWideDefault || 92)}%`);
        documentObj.documentElement.style.setProperty('--unistudy-chat-font', chatFonts[settings.chatFontPreset] || chatFonts.system);
        documentObj.documentElement.style.setProperty('--unistudy-code-font', chatFonts[settings.chatCodeFontPreset] || chatFonts.cascadia);
    }

    function syncPromptTextareaState(node, enabled) {
        if (!node) {
            return;
        }

        node.readOnly = !enabled;
        node.setAttribute('aria-readonly', enabled ? 'false' : 'true');
        node.classList.toggle('settings-textarea--readonly', !enabled);
    }

    function syncPromptInjectionState() {
        syncPromptTextareaState(el.renderingPromptInput, el.enableRenderingPromptInput?.checked !== false);
        syncPromptTextareaState(el.emoticonPromptInput, el.enableEmoticonPromptInput?.checked !== false);
        syncPromptTextareaState(el.adaptiveBubbleTipInput, el.enableAdaptiveBubbleTipInput?.checked !== false);
        syncPromptTextareaState(el.topicTitlePromptTemplateInput, el.enableTopicTitleGenerationInput?.checked !== false);
        syncPromptTextareaState(el.agentBubbleThemePrompt, el.enableAgentBubbleTheme?.checked === true);
        const dailyNoteEnabled = (el.studyLogEnabledInput?.checked !== false)
            && ((el.studyLogEnablePromptVariablesInput?.checked !== false)
            || (el.studyLogAutoInjectProtocolInput?.checked !== false));
        syncPromptTextareaState(el.dailyNoteGuideInput, dailyNoteEnabled);
    }

    function getDailyNoteDefaultPromptText() {
        return sanitizeText(
            lastFinalSystemPromptPreview?.segments?.dailyNoteVariable?.rawPrompt
            || lastFinalSystemPromptPreview?.segments?.dailyNoteAutoInject?.rawPrompt,
            ''
        );
    }

    function markPromptTextareaDefault(node, fallback = '') {
        if (!node) {
            return;
        }

        node.dataset.defaultPrompt = String(fallback || '');
        node.dataset.usingDefaultPrompt = 'true';
    }

    function markPromptTextareaCustom(node) {
        if (!node) {
            return;
        }

        node.dataset.usingDefaultPrompt = 'false';
    }

    function getPromptTextareaRawValue(node) {
        if (!node) {
            return '';
        }

        return node.dataset.usingDefaultPrompt === 'true'
            ? ''
            : (node.value || '');
    }

    function hydratePromptTextarea(node, fallback) {
        if (!node) {
            return;
        }

        const text = String(fallback || '');
        node.placeholder = text;
        node.dataset.defaultPrompt = text;
        if (!text || node.value.trim() || documentObj.activeElement === node) {
            return;
        }

        node.value = text;
        node.dataset.usingDefaultPrompt = 'true';
    }

    function setAgentBubbleThemeCaptionStatus(node, message = '', tone = '') {
        if (!node) {
            return;
        }

        node.textContent = message;
        node.classList.toggle('settings-caption--success', tone === 'success');
        node.classList.toggle('settings-caption--warning', tone === 'warning');
    }

    function truncatePreviewText(value, limit = 180) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            return '当前没有可展示的文本。';
        }
        if (text.length <= limit) {
            return text;
        }
        return `${text.slice(0, limit).trim()}...`;
    }

    function formatLegacyTokenSuggestions(unresolvedTokens = [], suggestionMap = {}) {
        return (Array.isArray(unresolvedTokens) ? unresolvedTokens : []).map((token) => (
            suggestionMap?.[token]
                ? `${token} -> ${suggestionMap[token]}`
                : token
        ));
    }

    function formatLegacyFieldWarnings(warnings = []) {
        return (Array.isArray(warnings) ? warnings : []).map((warning) => (
            warning?.replacement
                ? `${warning.field} -> ${warning.replacement}`
                : warning?.field
        )).filter(Boolean);
    }

    function renderPromptSegmentPreview(preview = {}) {
        if (!el.promptSegmentPreview) {
            return;
        }

        const segmentMap = [
            {
                key: 'rendering',
                title: '结构化渲染',
                description: '控制 {{RenderingGuide}} 是否进入当前智能体提示词。',
            },
            {
                key: 'emoticonPrompt',
                title: '表情包提示',
                description: '启用后会自动把内置表情包说明追加到当前智能体提示词；若主 prompt 已显式引用 {{EmoticonGuide}}，则会跳过重复追加。',
            },
            {
                key: 'adaptiveBubbleTip',
                title: '简洁气泡补充',
                description: '控制 {{AdaptiveBubbleTip}} 是否进入当前智能体提示词。',
            },
            {
                key: 'dailyNoteVariable',
                title: 'DailyNote 变量',
                description: '控制 {{DailyNoteGuide}} 是否展开。',
            },
            {
                key: 'dailyNoteAutoInject',
                title: 'DailyNote 自动追加',
                description: '作为全局兜底，在主 prompt 没自带协议时再追加一段 DailyNote 说明。',
            },
            {
                key: 'bubbleTheme',
                title: '视觉气泡主题',
                description: '真正额外 append 到 system prompt 末尾的附加提示词。',
            },
        ];

        const cards = segmentMap.map((item) => {
            const segment = preview?.segments?.[item.key] || {};
            let status = '当前不会加入';
            let reason = '这一段当前不会进入最终 system prompt。';
            if (item.key === 'dailyNoteAutoInject') {
                if (segment.enabled) {
                    if (segment.appended) {
                        status = '发送前会自动补上';
                        reason = '当前 agent prompt 没自带协议，所以会在真正发送前追加一段 DailyNote 说明。';
                    } else if (segment.skippedBecausePromptAlreadyContainsProtocol) {
                        status = '已启用，但不会重复追加';
                        reason = '当前 agent prompt 已经自带 DailyNote 协议，所以这里会主动跳过，避免重复。';
                    } else {
                        status = '已启用，当前无需追加';
                        reason = '当前没有额外追加，但开关仍处于启用状态。';
                    }
                } else {
                    status = '自动追加已关闭';
                    reason = '只有显式写进 agent prompt 的协议内容才会生效。';
                }
            } else if (item.key === 'bubbleTheme') {
                if (segment.enabled) {
                    status = segment.appended ? '会额外追加到末尾' : '已启用，但当前未追加';
                    reason = segment.appended
                        ? '这段内容会直接 append 到最终 system prompt 末尾。'
                        : '当前没有新的附加内容需要追加。';
                } else {
                    status = '额外追加已关闭';
                    reason = '最终 prompt 不会再附带单独的气泡主题补充。';
                }
            } else if (item.key === 'emoticonPrompt') {
                if (segment.enabled) {
                    if (segment.available === false) {
                        status = '已启用，但当前没有可用表情包';
                        reason = '主进程暂时没有扫描到内置表情包，因此这一段会解析为空。';
                    } else if (segment.appended) {
                        status = '发送前会自动补上';
                        reason = '当前 agent prompt 没有自带表情包变量，所以系统会自动把这段说明追加到最终 system prompt。';
                    } else if (segment.skippedBecausePromptAlreadyContainsVariable || segment.referencedInBasePrompt) {
                        status = '已启用，但不会重复追加';
                        reason = '当前 agent prompt 已经自带表情包变量，所以这里会主动跳过，避免重复注入。';
                    } else if (segment.skippedBecausePromptAlreadyContainsSameContent) {
                        status = '已启用，但不会重复追加';
                        reason = '当前 agent prompt 已经包含同样的表情包说明，所以这里会主动跳过，避免重复注入。';
                    } else {
                        status = '已启用，当前无需追加';
                        reason = '表情包说明已准备好；如果当前 prompt 没有显式自带说明，发送前会自动补上。';
                    }
                } else {
                    status = '表情包提示已关闭';
                    reason = '自动追加会关闭，而且即使 prompt 里写了对应变量，也会被解析为空。';
                }
            } else {
                if (segment.enabled) {
                    status = segment.referencedInBasePrompt ? '会进入当前 prompt' : '已启用，但当前未被引用';
                    reason = segment.referencedInBasePrompt
                        ? '当前 agent prompt 明确引用了这一段，所以发送时会一起展开。'
                        : '这段内容已经准备好了，但当前 agent prompt 里还没有引用它。';
                } else {
                    status = '该片段已关闭';
                    reason = '即使 prompt 里写了对应变量，也会被解析为空。';
                }
            }

            const source = segment.enabled
                ? (segment.source === 'custom' ? '自定义文案' : '默认文案')
                : '关闭';
            const previewText = truncatePreviewText(
                segment.resolvedPrompt || segment.rawPrompt || '',
                item.key === 'dailyNoteVariable' || item.key === 'dailyNoteAutoInject' ? 150 : 120
            );

            return `
                <article class="settings-token-card settings-token-card--segment ${segment.enabled ? 'settings-token-card--active' : 'settings-token-card--muted'}">
                  <div class="settings-token-card__top">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span class="settings-token-card__badge">${escapeHtml(source)}</span>
                  </div>
                  <span class="settings-token-card__status">${escapeHtml(status)}</span>
                  <span>${escapeHtml(reason)}</span>
                  <span class="settings-token-card__preview">${escapeHtml(previewText)}</span>
                </article>
            `;
        }).join('');

        el.promptSegmentPreview.innerHTML = cards;
    }

    function renderPromptPreviewMeta(preview = {}) {
        if (!el.finalSystemPromptPreviewMeta) {
            return;
        }

        const unresolvedTokens = Array.isArray(preview?.unresolvedTokens) ? preview.unresolvedTokens : [];
        const legacyTokenSuggestions = preview?.legacyTokenSuggestions || {};
        const chips = [
            `智能体：${preview?.agentName || '未选择'}`,
            `话题：${preview?.topicName || '未选择'}`,
            `基础 prompt：${preview?.hasBasePrompt ? '已找到' : '未找到'}`,
        ];
        const notes = [];
        const emoticonPrompt = preview?.segments?.emoticonPrompt || {};
        const dailyNoteVariable = preview?.segments?.dailyNoteVariable || {};
        const dailyNoteAutoInject = preview?.segments?.dailyNoteAutoInject || {};
        const bubbleTheme = preview?.segments?.bubbleTheme || {};

        if (emoticonPrompt.enabled && emoticonPrompt.available === false) {
            notes.push('表情包提示已启用，但当前没有扫描到可用的内置表情包。');
        } else if (emoticonPrompt.appended) {
            notes.push('当前 agent prompt 没自带表情包说明，因此发送前会自动补上一段伪路径和文件名列表。');
        } else if (emoticonPrompt.enabled && (emoticonPrompt.skippedBecausePromptAlreadyContainsVariable || emoticonPrompt.referencedInBasePrompt)) {
            notes.push('当前 agent prompt 已经自带表情包变量，所以系统不会重复追加。');
        } else if (emoticonPrompt.enabled && emoticonPrompt.skippedBecausePromptAlreadyContainsSameContent) {
            notes.push('当前 agent prompt 已经包含同样的表情包说明，所以系统不会重复追加。');
        } else if (!emoticonPrompt.enabled) {
            notes.push('表情包提示当前关闭，{{EmoticonGuide}} 会解析为空。');
        } else {
            notes.push('表情包提示已准备好；如果当前 prompt 没有显式自带说明，发送前会自动补上。');
        }

        if (dailyNoteVariable.enabled && dailyNoteVariable.referencedInBasePrompt) {
            notes.push('当前 agent prompt 自己引用了 DailyNote 协议变量，所以发送时会直接展开。');
        } else if (dailyNoteAutoInject.appended) {
            notes.push('当前 agent prompt 没自带协议，因此发送前会自动补上一段 DailyNote 说明。');
        } else if (dailyNoteAutoInject.skippedBecausePromptAlreadyContainsProtocol) {
            notes.push('当前 agent prompt 已经自带 DailyNote 协议，所以系统不会重复追加。');
        } else if (!dailyNoteVariable.enabled && !dailyNoteAutoInject.enabled) {
            notes.push('DailyNote 协议当前整体关闭，最终 prompt 不会携带写日记指令。');
        } else {
            notes.push('DailyNote 协议已准备好，但当前是否进入最终 prompt 取决于 agent 自身是否引用。');
        }

        if (bubbleTheme.appended) {
            notes.push('视觉气泡主题会额外追加到最终 system prompt 末尾。');
        } else if (!bubbleTheme.enabled) {
            notes.push('视觉气泡主题当前关闭，不会额外追加新的尾部提示。');
        }

        if (unresolvedTokens.length > 0) {
            notes.push(`还有未解析变量：${formatLegacyTokenSuggestions(unresolvedTokens, legacyTokenSuggestions).join(', ')}`);
        } else {
            notes.push('当前可见变量都已经成功展开。');
        }

        if (preview?.fallbackError) {
            notes.push(`当前显示的是回退预览：${preview.fallbackError}`);
        }

        el.finalSystemPromptPreviewMeta.innerHTML = `
            <div class="settings-preview-meta__chips">
              ${chips.map((chip) => `<span class="settings-preview-meta__chip">${escapeHtml(chip)}</span>`).join('')}
            </div>
            <div class="settings-preview-meta__body">${notes.map((note) => escapeHtml(note)).join('<br />')}</div>
        `;
    }

    function buildBubbleThemePreviewSettingsSnapshot() {
        return {
            userName: el.userNameInput?.value.trim() || 'User',
            enableRenderingPrompt: el.enableRenderingPromptInput?.checked !== false,
            enableEmoticonPrompt: el.enableEmoticonPromptInput?.checked !== false,
            enableAdaptiveBubbleTip: el.enableAdaptiveBubbleTipInput?.checked !== false,
            renderingPrompt: getPromptTextareaRawValue(el.renderingPromptInput),
            emoticonPrompt: getPromptTextareaRawValue(el.emoticonPromptInput),
            adaptiveBubbleTip: getPromptTextareaRawValue(el.adaptiveBubbleTipInput),
            dailyNoteGuide: getPromptTextareaRawValue(el.dailyNoteGuideInput),
            enableAgentBubbleTheme: el.enableAgentBubbleTheme?.checked === true,
            agentBubbleThemePrompt: getPromptTextareaRawValue(el.agentBubbleThemePrompt),
            studyProfile: {
                studentName: el.studentNameInput?.value.trim() || '',
                city: el.studyCityInput?.value.trim() || '',
                studyWorkspace: el.studyWorkspaceInput?.value.trim() || '',
                workEnvironment: el.workEnvironmentInput?.value.trim() || '',
                timezone: el.studyTimezoneInput?.value.trim() || 'Asia/Hong_Kong',
            },
            promptVariables: parsePromptVariablesInput(el.promptVariablesInput?.value) || {},
            studyLogPolicy: {
                enabled: el.studyLogEnabledInput?.checked !== false,
                enableDailyNotePromptVariables: el.studyLogEnablePromptVariablesInput?.checked !== false,
                autoInjectDailyNoteProtocol: el.studyLogAutoInjectProtocolInput?.checked !== false,
            },
        };
    }

    async function resolveSystemPromptPreviewBase() {
        const livePrompt = await resolvePromptText().catch(() => '');
        if (String(livePrompt || '').trim()) {
            return livePrompt;
        }

        let currentSelectedItem = {};
        try {
            currentSelectedItem = getCurrentSelectedItem() || {};
        } catch (_error) {
            currentSelectedItem = {};
        }
        if (currentSelectedItem.id && typeof chatAPI.getAgentConfig === 'function') {
            const config = await chatAPI.getAgentConfig(currentSelectedItem.id).catch(() => null);
            const configPrompt = extractPromptTextFromAgentConfig(config || {});
            if (configPrompt.trim()) {
                return configPrompt;
            }
        }

        return (documentObj.getElementById('unistudyPromptFallback')?.value || '').trim();
    }

    function buildLocalPromptPreviewFallback({ basePrompt = '', settings = {}, context = {}, error = '' } = {}) {
        const normalizedBasePrompt = String(basePrompt || '');
        const renderingRaw = settings.enableRenderingPrompt === false
            ? ''
            : (settings.renderingPrompt || el.renderingPromptInput?.value || DEFAULT_RENDERING_PROMPT);
        const emoticonRaw = settings.enableEmoticonPrompt === false
            ? ''
            : (settings.emoticonPrompt || el.emoticonPromptInput?.value || DEFAULT_EMOTICON_PROMPT);
        const adaptiveRaw = settings.enableAdaptiveBubbleTip === false
            ? ''
            : (settings.adaptiveBubbleTip || el.adaptiveBubbleTipInput?.value || DEFAULT_ADAPTIVE_BUBBLE_TIP);
        const dailyNoteEnabled = settings.studyLogPolicy?.enabled !== false;
        const dailyNoteRaw = !dailyNoteEnabled
            ? ''
            : (settings.dailyNoteGuide || el.dailyNoteGuideInput?.value || getDailyNoteDefaultPromptText());
        const bubbleThemeRaw = settings.enableAgentBubbleTheme === true
            ? (getPromptTextareaRawValue(el.agentBubbleThemePrompt) || el.agentBubbleThemePrompt?.value || DEFAULT_AGENT_BUBBLE_THEME_PROMPT)
            : '';
        const promptAlreadyContainsEmoticon = /{{\s*EmoticonGuide\s*}}/.test(normalizedBasePrompt);
        const promptAlreadyContainsDailyNote = normalizedBasePrompt.includes('—— 日记 (DailyNote) ——')
            || /{{\s*DailyNoteGuide\s*}}/.test(normalizedBasePrompt);
        const finalSystemPrompt = [
            normalizedBasePrompt,
            settings.enableAgentBubbleTheme === true ? bubbleThemeRaw : '',
            settings.enableEmoticonPrompt !== false && !promptAlreadyContainsEmoticon
                ? emoticonRaw
                : '',
            dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false && !promptAlreadyContainsDailyNote
                ? dailyNoteRaw
                : '',
        ].filter(Boolean).join('\n\n').trim();

        return {
            agentName: context.agentName || '',
            topicName: context.topicName || '',
            hasBasePrompt: Boolean(normalizedBasePrompt.trim()),
            basePrompt: normalizedBasePrompt,
            finalSystemPrompt,
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
            fallbackError: error,
            segments: {
                rendering: {
                    enabled: settings.enableRenderingPrompt !== false,
                    source: String(settings.renderingPrompt || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*RenderingGuide\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: renderingRaw,
                    resolvedPrompt: renderingRaw,
                },
                emoticonPrompt: {
                    enabled: settings.enableEmoticonPrompt !== false,
                    available: true,
                    packCount: 0,
                    source: String(settings.emoticonPrompt || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*EmoticonGuide\s*}}/.test(normalizedBasePrompt),
                    appended: settings.enableEmoticonPrompt !== false && !promptAlreadyContainsEmoticon,
                    skippedBecausePromptAlreadyContainsVariable: promptAlreadyContainsEmoticon,
                    skippedBecausePromptAlreadyContainsSameContent: false,
                    rawPrompt: emoticonRaw,
                    resolvedPrompt: emoticonRaw,
                },
                adaptiveBubbleTip: {
                    enabled: settings.enableAdaptiveBubbleTip !== false,
                    source: String(settings.adaptiveBubbleTip || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*AdaptiveBubbleTip\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: adaptiveRaw,
                    resolvedPrompt: adaptiveRaw,
                },
                dailyNoteVariable: {
                    enabled: dailyNoteEnabled && settings.studyLogPolicy?.enableDailyNotePromptVariables !== false,
                    source: String(settings.dailyNoteGuide || '').trim() ? 'custom' : 'default',
                    referencedInBasePrompt: /{{\s*DailyNoteGuide\s*}}/.test(normalizedBasePrompt),
                    rawPrompt: dailyNoteRaw,
                    resolvedPrompt: dailyNoteRaw,
                },
                dailyNoteAutoInject: {
                    enabled: dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false,
                    source: String(settings.dailyNoteGuide || '').trim() ? 'custom' : 'default',
                    appended: dailyNoteEnabled && settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false && !promptAlreadyContainsDailyNote,
                    skippedBecausePromptAlreadyContainsProtocol: promptAlreadyContainsDailyNote,
                    rawPrompt: dailyNoteRaw,
                    resolvedPrompt: dailyNoteRaw,
                },
                bubbleTheme: {
                    enabled: settings.enableAgentBubbleTheme === true,
                    source: getPromptTextareaRawValue(el.agentBubbleThemePrompt).trim() ? 'custom' : 'default',
                    appended: settings.enableAgentBubbleTheme === true,
                    rawPrompt: bubbleThemeRaw,
                    resolvedPrompt: bubbleThemeRaw,
                },
            },
        };
    }

    async function refreshFinalSystemPromptPreview() {
        if (!el.finalSystemPromptPreview || !el.finalSystemPromptPreviewMeta) {
            return;
        }

        const requestId = ++placeholderPreviewRequestId;
        const previewSettings = buildBubbleThemePreviewSettingsSnapshot();
        const previewContext = getBubbleThemePreviewContext();
        const basePrompt = await resolveSystemPromptPreviewBase();

        if (typeof chatAPI.previewFinalSystemPrompt !== 'function') {
            const fallbackPreview = buildLocalPromptPreviewFallback({
                basePrompt,
                settings: previewSettings,
                context: previewContext,
                error: '完整预览接口当前不可用，已切到本地回退预览。',
            });
            lastFinalSystemPromptPreview = fallbackPreview;
            el.finalSystemPromptPreview.value = fallbackPreview.finalSystemPrompt || fallbackPreview.basePrompt || '';
            renderPromptSegmentPreview(fallbackPreview);
            renderPromptPreviewMeta(fallbackPreview);
            return;
        }

        let previewResult = null;
        try {
            previewResult = await chatAPI.previewFinalSystemPrompt({
                systemPrompt: basePrompt,
                settings: previewSettings,
                context: previewContext,
                modelConfig: {
                    model: previewContext?.model || '',
                },
            });
        } catch (error) {
            previewResult = {
                success: false,
                error: error?.message || String(error || '未知错误'),
                preview: buildLocalPromptPreviewFallback({
                    basePrompt,
                    settings: previewSettings,
                    context: previewContext,
                    error: error?.message || String(error || '未知错误'),
                }),
            };
        }

        if (requestId !== placeholderPreviewRequestId) {
            return;
        }

        const preview = previewResult?.preview || {};
        lastFinalSystemPromptPreview = preview;

        hydratePromptTextarea(el.renderingPromptInput, preview?.segments?.rendering?.rawPrompt || DEFAULT_RENDERING_PROMPT);
        hydratePromptTextarea(el.emoticonPromptInput, preview?.segments?.emoticonPrompt?.rawPrompt || DEFAULT_EMOTICON_PROMPT);
        hydratePromptTextarea(el.adaptiveBubbleTipInput, preview?.segments?.adaptiveBubbleTip?.rawPrompt || DEFAULT_ADAPTIVE_BUBBLE_TIP);
        hydratePromptTextarea(el.agentBubbleThemePrompt, preview?.segments?.bubbleTheme?.rawPrompt || DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
        hydratePromptTextarea(el.dailyNoteGuideInput, getDailyNoteDefaultPromptText());

        el.finalSystemPromptPreview.value = preview?.finalSystemPrompt || preview?.basePrompt || '';
        renderPromptSegmentPreview(preview);
        renderPromptPreviewMeta(preview);

        if (!previewResult?.success && !preview?.finalSystemPrompt && !preview?.basePrompt) {
            el.finalSystemPromptPreviewMeta.innerHTML = `
                <div class="settings-preview-meta__body">完整预览失败：${escapeHtml(previewResult?.error || '未知错误')}</div>
            `;
        }
    }

    async function refreshAgentBubbleThemePreview() {
        if (!el.agentBubbleThemeResolvedPreview || !el.agentBubbleThemePreviewMeta) {
            return;
        }

        const enabled = el.enableAgentBubbleTheme?.checked === true;
        const rawPrompt = el.agentBubbleThemePrompt?.value || '';
        const trimmedPrompt = rawPrompt.trim();
        const previewContext = getBubbleThemePreviewContext();

        if (!enabled) {
            el.agentBubbleThemeResolvedPreview.value = '';
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '当前关闭，不会注入到 system 提示词。',
                ''
            );
            return;
        }

        if (!trimmedPrompt) {
            el.agentBubbleThemeResolvedPreview.value = DEFAULT_AGENT_BUBBLE_THEME_PROMPT;
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '当前留空，因此会回退到默认的气泡主题提示词。',
                'success'
            );
            return;
        }

        const previewResult = await chatAPI.previewAgentBubbleThemePrompt?.({
            enabled,
            prompt: rawPrompt,
            settings: buildBubbleThemePreviewSettingsSnapshot(),
            context: previewContext,
        });

        const preview = previewResult?.preview || previewResult || {};
        if (!preview?.resolvedPrompt) {
            el.agentBubbleThemeResolvedPreview.value = trimmedPrompt;
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                '预览接口不可用，当前仅显示原始提示词。',
                'warning'
            );
            return;
        }

        if (Array.isArray(preview?.unresolvedTokens) && preview.unresolvedTokens.length > 0) {
            el.agentBubbleThemeResolvedPreview.value = preview?.resolvedPrompt || trimmedPrompt;
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePreviewMeta,
                `存在未解析变量：${formatLegacyTokenSuggestions(preview.unresolvedTokens, preview.legacyTokenSuggestions || {}).join(', ')}`,
                'warning'
            );
            return;
        }

        el.agentBubbleThemeResolvedPreview.value = preview?.resolvedPrompt || '';
        setAgentBubbleThemeCaptionStatus(
            el.agentBubbleThemePreviewMeta,
            '这里显示的是主进程实际会追加到 system 消息中的最终文本。',
            'success'
        );
    }

    function syncGlobalSettingsForm() {
        isSyncingGlobalSettingsForm = true;
        const settings = composeSettingsWithModelService(getGlobalSettings());
        el.userNameInput.value = settings.userName || '';
        if (el.defaultModelInput) el.defaultModelInput.value = settings.defaultModel || '';
        if (el.followUpDefaultModelInput) el.followUpDefaultModelInput.value = settings.followUpDefaultModel || '';
        if (el.topicTitleDefaultModelInput) el.topicTitleDefaultModelInput.value = settings.topicTitleDefaultModel || '';
        if (el.studentNameInput) el.studentNameInput.value = settings.studyProfile?.studentName || '';
        if (el.studyCityInput) el.studyCityInput.value = settings.studyProfile?.city || '';
        if (el.studyWorkspaceInput) el.studyWorkspaceInput.value = settings.studyProfile?.studyWorkspace || '';
        if (el.workEnvironmentInput) el.workEnvironmentInput.value = settings.studyProfile?.workEnvironment || '';
        if (el.studyTimezoneInput) el.studyTimezoneInput.value = settings.studyProfile?.timezone || 'Asia/Hong_Kong';
        if (el.studyLogEnabledInput) el.studyLogEnabledInput.checked = settings.studyLogPolicy?.enabled !== false;
        if (el.studyLogEnablePromptVariablesInput) {
            el.studyLogEnablePromptVariablesInput.checked = settings.studyLogPolicy?.enableDailyNotePromptVariables !== false;
        }
        if (el.studyLogAutoInjectProtocolInput) {
            el.studyLogAutoInjectProtocolInput.checked = settings.studyLogPolicy?.autoInjectDailyNoteProtocol !== false;
        }
        if (el.studyLogMaxRoundsInput) el.studyLogMaxRoundsInput.value = settings.studyLogPolicy?.maxToolRounds ?? 3;
        if (el.studyMemoryTopKInput) el.studyMemoryTopKInput.value = settings.studyLogPolicy?.memoryTopK ?? 4;
        if (el.studyMemoryFallbackTopKInput) el.studyMemoryFallbackTopKInput.value = settings.studyLogPolicy?.memoryFallbackTopK ?? 2;
        if (el.promptVariablesInput) el.promptVariablesInput.value = JSON.stringify(settings.promptVariables || {}, null, 2);
        if (el.chatEndpoint) el.chatEndpoint.value = settings.chatEndpoint || '';
        if (el.chatApiKey) el.chatApiKey.value = settings.chatApiKey || '';
        if (el.kbBaseUrl) el.kbBaseUrl.value = settings.kbBaseUrl || settings.chatEndpoint || '';
        if (el.kbApiKey) el.kbApiKey.value = settings.kbApiKey || settings.chatApiKey || '';
        if (el.kbEmbeddingModel) el.kbEmbeddingModel.value = settings.kbEmbeddingModel || '';
        el.kbUseRerank.checked = settings.kbUseRerank !== false;
        if (el.kbRerankModel) el.kbRerankModel.value = settings.kbRerankModel || 'BAAI/bge-reranker-v2-m3';
        el.kbTopK.value = settings.kbTopK ?? 6;
        el.kbCandidateTopK.value = settings.kbCandidateTopK ?? 20;
        el.kbScoreThreshold.value = settings.kbScoreThreshold ?? 0.25;
        if (el.enableRenderingPromptInput) {
            el.enableRenderingPromptInput.checked = settings.enableRenderingPrompt !== false;
        }
        if (el.enableEmoticonPromptInput) {
            el.enableEmoticonPromptInput.checked = settings.enableEmoticonPrompt !== false;
        }
        if (el.enableAdaptiveBubbleTipInput) {
            el.enableAdaptiveBubbleTipInput.checked = settings.enableAdaptiveBubbleTip !== false;
        }
        el.chatFontPreset.value = settings.chatFontPreset || 'system';
        el.chatCodeFontPreset.value = settings.chatCodeFontPreset === 'consolas'
            ? 'cascadia'
            : (settings.chatCodeFontPreset || 'cascadia');
        el.chatBubbleMaxWidthWideDefault.value = settings.chatBubbleMaxWidthWideDefault ?? 92;
        el.enableAgentBubbleTheme.checked = settings.enableAgentBubbleTheme === true;
        const storedBubbleThemePrompt = typeof settings.agentBubbleThemePrompt === 'string'
            ? settings.agentBubbleThemePrompt
            : '';
        el.agentBubbleThemePrompt.value = storedBubbleThemePrompt || DEFAULT_AGENT_BUBBLE_THEME_PROMPT;
        if (storedBubbleThemePrompt.trim()) {
            markPromptTextareaCustom(el.agentBubbleThemePrompt);
        } else {
            markPromptTextareaDefault(el.agentBubbleThemePrompt, DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
        }
        if (el.renderingPromptInput) {
            const storedRenderingPrompt = settings.renderingPrompt || '';
            el.renderingPromptInput.value = storedRenderingPrompt || DEFAULT_RENDERING_PROMPT;
            if (storedRenderingPrompt.trim()) {
                markPromptTextareaCustom(el.renderingPromptInput);
            } else {
                markPromptTextareaDefault(el.renderingPromptInput, DEFAULT_RENDERING_PROMPT);
            }
        }
        if (el.emoticonPromptInput) {
            const storedEmoticonPrompt = settings.emoticonPrompt || '';
            el.emoticonPromptInput.value = storedEmoticonPrompt || DEFAULT_EMOTICON_PROMPT;
            if (storedEmoticonPrompt.trim()) {
                markPromptTextareaCustom(el.emoticonPromptInput);
            } else {
                markPromptTextareaDefault(el.emoticonPromptInput, DEFAULT_EMOTICON_PROMPT);
            }
        }
        if (el.adaptiveBubbleTipInput) {
            const storedAdaptiveBubbleTip = settings.adaptiveBubbleTip || '';
            el.adaptiveBubbleTipInput.value = storedAdaptiveBubbleTip || DEFAULT_ADAPTIVE_BUBBLE_TIP;
            if (storedAdaptiveBubbleTip.trim()) {
                markPromptTextareaCustom(el.adaptiveBubbleTipInput);
            } else {
                markPromptTextareaDefault(el.adaptiveBubbleTipInput, DEFAULT_ADAPTIVE_BUBBLE_TIP);
            }
        }
        if (el.dailyNoteGuideInput) {
            const storedDailyNoteGuide = settings.dailyNoteGuide || '';
            el.dailyNoteGuideInput.value = storedDailyNoteGuide;
            if (storedDailyNoteGuide.trim()) {
                markPromptTextareaCustom(el.dailyNoteGuideInput);
            } else {
                markPromptTextareaDefault(el.dailyNoteGuideInput, getDailyNoteDefaultPromptText());
            }
        }
        if (el.followUpPromptTemplateInput) {
            const storedFollowUpPromptTemplate = settings.followUpPromptTemplate || '';
            el.followUpPromptTemplateInput.value = storedFollowUpPromptTemplate || DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE;
            if (storedFollowUpPromptTemplate.trim()) {
                markPromptTextareaCustom(el.followUpPromptTemplateInput);
            } else {
                markPromptTextareaDefault(el.followUpPromptTemplateInput, DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE);
            }
        }
        if (el.enableTopicTitleGenerationInput) {
            el.enableTopicTitleGenerationInput.checked = settings.enableTopicTitleGeneration !== false;
        }
        if (el.topicTitlePromptTemplateInput) {
            const storedTopicTitlePromptTemplate = settings.topicTitlePromptTemplate || '';
            el.topicTitlePromptTemplateInput.value = storedTopicTitlePromptTemplate || DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE;
            if (storedTopicTitlePromptTemplate.trim()) {
                markPromptTextareaCustom(el.topicTitlePromptTemplateInput);
            } else {
                markPromptTextareaDefault(el.topicTitlePromptTemplateInput, DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE);
            }
        }
        el.enableSmoothStreaming.checked = settings.enableSmoothStreaming === true;
        syncPromptInjectionState();
        void refreshAgentBubbleThemePreview();
        void refreshFinalSystemPromptPreview();

        const themeMode = settings.currentThemeMode || 'system';
        const themeInput = documentObj.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
        if (themeInput) {
            themeInput.checked = true;
        }
        if (el.modelServiceProviderSearchInput) {
            el.modelServiceProviderSearchInput.value = modelServiceUiState.providerSearch;
        }
        syncLegacyModelServiceFields(settings);
        renderModelServiceWorkbench();
        renderModelServiceDefaultSelectors();
        isSyncingGlobalSettingsForm = false;
    }

    async function loadSettings() {
        const loaded = await chatAPI.loadSettings();
        patchGlobalSettings(composeSettingsWithModelService(loaded || {}));
        syncGlobalSettingsForm();
        applyRendererSettings();
        syncLayoutSettings(getGlobalSettings());
        messageRendererApi?.setUserAvatar(getGlobalSettings().userAvatarUrl || '../assets/default_user_avatar.png');
        messageRendererApi?.setUserAvatarColor(getGlobalSettings().userAvatarCalculatedColor || null);

        const legacyFieldWarnings = formatLegacyFieldWarnings(loaded?.settingsIssues?.legacyFieldWarnings);
        if (legacyFieldWarnings.length > 0) {
            ui.showToastNotification(`检测到已废弃设置字段：${legacyFieldWarnings.join('，')}。请改用新字段名。`, 'warning', 7000);
        }
    }

    async function saveGlobalSettings(options = {}) {
        if (isSavingGlobalSettings) {
            return;
        }
        const promptVariables = parsePromptVariablesInput(el.promptVariablesInput?.value);
        if (promptVariables === null) {
            setGlobalSettingsSaveStatus('自动保存暂停：自定义提示词变量需要是有效 JSON。', 'warning');
            return;
        }
        const themeMode = documentObj.querySelector('input[name="themeMode"]:checked')?.value || 'system';
        const modelService = normalizeModelService(getGlobalSettings().modelService);
        const modelServiceMirror = buildModelServiceMirror(modelService, getGlobalSettings());
        const patch = {
            userName: el.userNameInput.value.trim() || 'User',
            modelService,
            defaultModel: modelServiceMirror.defaultModel || '',
            followUpDefaultModel: modelServiceMirror.followUpDefaultModel || '',
            topicTitleDefaultModel: modelServiceMirror.topicTitleDefaultModel || '',
            studyProfile: {
                studentName: el.studentNameInput?.value.trim() || '',
                city: el.studyCityInput?.value.trim() || '',
                studyWorkspace: el.studyWorkspaceInput?.value.trim() || '',
                workEnvironment: el.workEnvironmentInput?.value.trim() || '',
                timezone: el.studyTimezoneInput?.value.trim() || 'Asia/Hong_Kong',
            },
            promptVariables,
            studyLogPolicy: {
                enabled: el.studyLogEnabledInput?.checked !== false,
                enableDailyNotePromptVariables: el.studyLogEnablePromptVariablesInput?.checked !== false,
                autoInjectDailyNoteProtocol: el.studyLogAutoInjectProtocolInput?.checked !== false,
                maxToolRounds: Number(el.studyLogMaxRoundsInput?.value || 3),
                memoryTopK: Number(el.studyMemoryTopKInput?.value || 4),
                memoryFallbackTopK: Number(el.studyMemoryFallbackTopKInput?.value || 2),
            },
            chatEndpoint: modelServiceMirror.chatEndpoint || '',
            chatApiKey: modelServiceMirror.chatApiKey || '',
            kbBaseUrl: modelServiceMirror.kbBaseUrl || '',
            kbApiKey: modelServiceMirror.kbApiKey || '',
            kbEmbeddingModel: modelServiceMirror.kbEmbeddingModel || '',
            kbUseRerank: el.kbUseRerank.checked,
            kbRerankModel: modelServiceMirror.kbRerankModel || '',
            kbTopK: Number(el.kbTopK.value || 6),
            kbCandidateTopK: Number(el.kbCandidateTopK.value || 20),
            kbScoreThreshold: Number(el.kbScoreThreshold.value || 0.25),
            enableRenderingPrompt: el.enableRenderingPromptInput?.checked !== false,
            enableEmoticonPrompt: el.enableEmoticonPromptInput?.checked !== false,
            enableAdaptiveBubbleTip: el.enableAdaptiveBubbleTipInput?.checked !== false,
            chatFontPreset: el.chatFontPreset.value,
            chatCodeFontPreset: el.chatCodeFontPreset.value,
            chatBubbleMaxWidthWideDefault: Number(el.chatBubbleMaxWidthWideDefault.value || 92),
            enableAgentBubbleTheme: el.enableAgentBubbleTheme.checked,
            agentBubbleThemePrompt: getPromptTextareaRawValue(el.agentBubbleThemePrompt),
            renderingPrompt: getPromptTextareaRawValue(el.renderingPromptInput),
            emoticonPrompt: getPromptTextareaRawValue(el.emoticonPromptInput),
            adaptiveBubbleTip: getPromptTextareaRawValue(el.adaptiveBubbleTipInput),
            dailyNoteGuide: getPromptTextareaRawValue(el.dailyNoteGuideInput),
            followUpPromptTemplate: getPromptTextareaRawValue(el.followUpPromptTemplateInput),
            enableTopicTitleGeneration: el.enableTopicTitleGenerationInput?.checked !== false,
            topicTitlePromptTemplate: getPromptTextareaRawValue(el.topicTitlePromptTemplateInput),
            enableSmoothStreaming: el.enableSmoothStreaming.checked,
            currentThemeMode: themeMode,
        };
        isSavingGlobalSettings = true;
        setGlobalSettingsSaveStatus('正在自动保存...', 'info');
        const result = await chatAPI.saveSettings(patch);
        isSavingGlobalSettings = false;
        if (!result?.success) {
            setGlobalSettingsSaveStatus(`自动保存失败：${result?.error || '未知错误'}`, 'warning');
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePersistStatus,
                '保存失败，未能验证磁盘中的提示词配置。',
                'warning'
            );
            return;
        }

        const persistedSettings = result?.settings && typeof result.settings === 'object'
            ? composeSettingsWithModelService(result.settings)
            : patch;
        patchGlobalSettings(persistedSettings);
        syncGlobalSettingsForm();
        applyRendererSettings();
        chatAPI.setThemeMode(themeMode);
        windowObj.emoticonManager?.reload?.();
        const persistenceCheck = result?.persistenceCheck;
        const promptPersisted = persistenceCheck?.agentBubbleThemePromptMatched === true;
        const togglePersisted = persistenceCheck?.enableAgentBubbleThemeMatched === true;
        const mismatchedFields = Array.isArray(persistenceCheck?.mismatchedFields)
            ? persistenceCheck.mismatchedFields
            : [];
        const persistenceFieldMismatches = mismatchedFields
            .filter((fieldId) => Object.prototype.hasOwnProperty.call(SETTINGS_PERSISTENCE_FIELD_LABELS, fieldId))
            .map((fieldId) => SETTINGS_PERSISTENCE_FIELD_LABELS[fieldId]);

        if (promptPersisted && togglePersisted && persistenceFieldMismatches.length === 0) {
            setAgentBubbleThemeCaptionStatus(
                el.agentBubbleThemePersistStatus,
                '已验证：提示词配置已写入 settings.json。',
                'success'
            );
            void refreshFinalSystemPromptPreview();
            setGlobalSettingsSaveStatus('所有修改已自动保存。', 'success');
            if (options.showToastOnSuccess !== false) {
                ui.showToastNotification('全局设置已保存。', 'success');
            }
            return;
        }

        setAgentBubbleThemeCaptionStatus(
            el.agentBubbleThemePersistStatus,
            '警告：保存返回成功，但磁盘中的提示词配置与当前界面值不一致。',
            'warning'
        );
        void refreshFinalSystemPromptPreview();
        const mismatchDetail = persistenceFieldMismatches.length > 0
            ? `以下字段未成功写入：${persistenceFieldMismatches.join('、')}。`
            : '请重新打开设置检查。';
        setGlobalSettingsSaveStatus(`已保存，但部分提示词配置未完全写入：${mismatchDetail}`, 'warning');
        if (options.showToastOnPartialSave === true) {
            ui.showToastNotification(`全局设置已保存，但注入提示词未成功写入磁盘，${mismatchDetail}`, 'error');
        }
    }

    function scheduleGlobalSettingsSave(delay = 420) {
        if (isSyncingGlobalSettingsForm) {
            return;
        }
        if (globalSettingsSaveTimer) {
            windowObj.clearTimeout(globalSettingsSaveTimer);
        }
        setGlobalSettingsSaveStatus('检测到修改，准备自动保存...', 'info');
        globalSettingsSaveTimer = windowObj.setTimeout(() => {
            globalSettingsSaveTimer = null;
            void saveGlobalSettings({ showToastOnSuccess: false });
        }, delay);
    }

    function switchSettingsModalSection(section) {
        const normalizedSection = section === 'global' || section === 'agent' ? 'services' : section;
        const nextSection = Object.prototype.hasOwnProperty.call(SETTINGS_MODAL_META, normalizedSection)
            ? normalizedSection
            : 'services';
        patchSettingsSlice({
            settingsModalSection: nextSection,
        });

        el.settingsNavButtons?.forEach((button) => {
            const active = button.dataset.settingsSectionButton === nextSection;
            button.classList.toggle('settings-modal__nav-button--active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });

        const sections = [
            ['services', el.settingsModalSectionServices],
            ['default-model', el.settingsModalSectionDefaultModel],
            ['retrieval', el.settingsModalSectionRetrieval],
            ['prompts', el.settingsModalSectionPrompts],
            ['display', el.settingsModalSectionDisplay],
            ['knowledge-base', el.settingsModalSectionKnowledgeBase],
        ];
        sections.forEach(([name, node]) => {
            const active = name === nextSection;
            node?.classList.toggle('hidden', !active);
            node?.classList.toggle('settings-modal__section--active', active);
        });

        const meta = SETTINGS_MODAL_META[nextSection];
        if (el.settingsModalTitle) {
            el.settingsModalTitle.textContent = meta.title;
        }

        if (el.settingsModalSubtitle) {
            el.settingsModalSubtitle.textContent = meta.subtitle;
        }
        if (['services', 'default-model', 'prompts', 'display'].includes(nextSection)) {
            void refreshFinalSystemPromptPreview();
        }
    }

    function detectCurrentWorkspaceView() {
        if (!el.manualNotesLibraryPage?.classList.contains('hidden')) {
            return 'manual-notes';
        }
        if (!el.workspaceSubjectPage?.classList.contains('hidden')) {
            return 'subject';
        }
        return 'overview';
    }

    function openSettingsModal(section = 'global', trigger = null) {
        if (section === 'agent') {
            return openSubjectSettingsPanel(trigger);
        }

        closeSubjectSettingsPanel({ restoreFocus: false });
        if (isElementNode(trigger)) {
            settingsModalTrigger = trigger;
        }
        settingsPageReturnView = detectCurrentWorkspaceView();
        switchSettingsModalSection(section);
        el.workspaceOverviewPage?.classList.add('hidden');
        el.workspaceSubjectPage?.classList.add('hidden');
        el.settingsModal?.classList.remove('hidden');
        el.settingsModal?.classList.add('settings-page--open');
        el.settingsModal?.setAttribute('aria-hidden', 'false');
        documentObj.body.classList.add('settings-page-open');
        documentObj.body.classList.add('workspace-view-settings');
        documentObj.body.classList.remove('workspace-view-overview', 'workspace-view-subject');
    }

    function closeSettingsModal() {
        el.settingsModal?.classList.add('hidden');
        el.settingsModal?.classList.remove('settings-page--open');
        el.settingsModal?.setAttribute('aria-hidden', 'true');
        documentObj.body.classList.remove('settings-page-open');
        documentObj.body.classList.remove('workspace-view-settings');
        const returnToSubject = settingsPageReturnView === 'subject';
        const returnToManualNotes = settingsPageReturnView === 'manual-notes';
        el.workspaceOverviewPage?.classList.toggle('hidden', returnToSubject || returnToManualNotes);
        el.workspaceSubjectPage?.classList.toggle('hidden', !returnToSubject);
        el.manualNotesLibraryPage?.classList.toggle('hidden', !returnToManualNotes);
        documentObj.body.classList.toggle('workspace-view-overview', !returnToSubject && !returnToManualNotes);
        documentObj.body.classList.toggle('workspace-view-subject', returnToSubject);
        documentObj.body.classList.toggle('workspace-view-manual-notes', returnToManualNotes);
        if (isElementNode(settingsModalTrigger) && documentObj.body.contains(settingsModalTrigger)) {
            settingsModalTrigger.focus();
        }
        settingsModalTrigger = null;
    }

    function configureAgentEmojiPicker() {
        const picker = el.agentCardEmojiPicker;
        if (!picker) {
            return;
        }
        picker.classList.toggle('dark', documentObj.body.classList.contains('dark-theme'));
        picker.classList.toggle('light', !documentObj.body.classList.contains('dark-theme'));
        if (isAgentEmojiPickerConfigured) {
            return;
        }
        windowObj.UniStudyEmojiPicker?.configure?.(picker, {
            locale: windowObj.navigator?.language || 'zh-CN',
        });
        isAgentEmojiPickerConfigured = true;
    }

    function isAgentEmojiPickerOpen() {
        return Boolean(el.agentCardEmojiPickerPopover && !el.agentCardEmojiPickerPopover.classList.contains('hidden'));
    }

    function syncAgentCardEmojiPicker() {
        const input = el.agentCardEmojiInput;
        const preview = el.agentCardEmojiPreview;
        const clearBtn = el.agentCardEmojiClearBtn;
        const trigger = el.agentCardEmojiPickerBtn;
        const value = normalizeAgentCardEmoji(input?.value || '');
        if (input && input.value !== value) {
            input.value = value;
        }
        if (preview) {
            preview.textContent = value || '🎓';
        }
        clearBtn?.classList.toggle('hidden', !value);
        trigger?.classList.toggle('subject-emoji-picker__trigger--empty', !value);
        if (trigger) {
            trigger.title = value ? `当前卡片 Emoji：${value}` : '选择卡片 Emoji';
        }
    }

    function closeAgentEmojiPicker(options = {}) {
        el.agentCardEmojiPickerPopover?.classList.add('hidden');
        el.agentCardEmojiPickerPopover?.setAttribute('aria-hidden', 'true');
        el.agentCardEmojiPickerBtn?.setAttribute('aria-expanded', 'false');
        if (options.restoreFocus !== false) {
            el.agentCardEmojiPickerBtn?.focus?.();
        }
    }

    function openAgentEmojiPicker() {
        configureAgentEmojiPicker();
        syncAgentCardEmojiPicker();
        el.agentCardEmojiPickerPopover?.classList.remove('hidden');
        el.agentCardEmojiPickerPopover?.setAttribute('aria-hidden', 'false');
        el.agentCardEmojiPickerBtn?.setAttribute('aria-expanded', 'true');
        el.agentCardEmojiPicker?.focus?.();
    }

    function toggleAgentEmojiPicker() {
        if (isAgentEmojiPickerOpen()) {
            closeAgentEmojiPicker();
            return;
        }
        openAgentEmojiPicker();
    }

    function setAgentCardEmoji(value) {
        if (el.agentCardEmojiInput) {
            el.agentCardEmojiInput.value = normalizeAgentCardEmoji(value);
        }
        syncAgentCardEmojiPicker();
    }

    function getEmojiFromPickerEvent(event) {
        const detail = event?.detail || {};
        if (typeof detail.unicode === 'string' && detail.unicode) {
            return detail.unicode;
        }
        if (typeof detail.emoji === 'string' && detail.emoji) {
            return detail.emoji;
        }
        if (typeof detail.emoji?.unicode === 'string' && detail.emoji.unicode) {
            return detail.emoji.unicode;
        }
        return '';
    }

    function openSubjectSettingsPanel(trigger = null, options = {}) {
        void options;
        const currentSelectedItem = getCurrentSelectedItem();
        if (!currentSelectedItem?.id) {
            ui.showToastNotification?.('请先选择一个学科。', 'warning');
            return false;
        }

        if (el.settingsModal && !el.settingsModal.classList.contains('hidden')) {
            closeSettingsModal();
        }
        if (isElementNode(trigger)) {
            subjectSettingsPanelTrigger = trigger;
        }
        setPromptVisible(true);
        syncAgentCardEmojiPicker();
        el.subjectSettingsPanel?.classList.remove('hidden');
        el.subjectSettingsPanel?.setAttribute('aria-hidden', 'false');
        documentObj.body.classList.add('subject-settings-panel-open');
        el.subjectSettingsPanelCloseBtn?.focus?.();
        return true;
    }

    function closeSubjectSettingsPanel(options = {}) {
        closeAgentEmojiPicker({ restoreFocus: false });
        el.subjectSettingsPanel?.classList.add('hidden');
        el.subjectSettingsPanel?.setAttribute('aria-hidden', 'true');
        documentObj.body.classList.remove('subject-settings-panel-open');
        if (options.restoreFocus !== false && isElementNode(subjectSettingsPanelTrigger) && documentObj.body.contains(subjectSettingsPanelTrigger)) {
            subjectSettingsPanelTrigger.focus();
        }
        subjectSettingsPanelTrigger = null;
    }

    function openToolboxDiaryManager(anchorId = '') {
        openSettingsModal('global', el.globalSettingsBtn || null);
        const target = anchorId ? documentObj.getElementById(anchorId) : null;
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function setPromptVisible(visible) {
        el.selectAgentPromptForSettings?.classList.toggle('hidden', visible);
        el.agentSettingsContainer?.classList.toggle('hidden', !visible);
    }

    async function saveAgentSettings() {
        const currentSelectedItem = getCurrentSelectedItem();
        if (!currentSelectedItem.id) {
            return;
        }

        const promptText = await resolvePromptText();
        const patch = {
            name: el.agentNameInput.value.trim(),
            model: el.agentModel.value.trim(),
            cardEmoji: normalizeAgentCardEmoji(el.agentCardEmojiInput?.value || ''),
            promptMode: 'original',
            originalSystemPrompt: promptText,
            systemPrompt: promptText,
        };

        const saveResult = await chatAPI.saveAgentConfig(currentSelectedItem.id, patch);
        if (saveResult?.error) {
            ui.showToastNotification(`保存智能体失败：${saveResult.error}`, 'error');
            return;
        }

        const avatarFile = el.agentAvatarInput.files?.[0];
        if (avatarFile) {
            const buffer = await avatarFile.arrayBuffer();
            await chatAPI.saveAvatar(currentSelectedItem.id, {
                name: avatarFile.name,
                type: avatarFile.type,
                buffer,
            });
            el.agentAvatarInput.value = '';
        }

        ui.showToastNotification('学科设置已保存。', 'success');
        await reloadSelectedAgent(currentSelectedItem.id);
    }

    function bindEvents() {
        el.currentAgentSettingsBtn?.addEventListener('click', () => {
            openSubjectSettingsPanel(el.currentAgentSettingsBtn);
        });
        el.globalSettingsBtn?.addEventListener('click', () => {
            openSettingsModal('global', el.globalSettingsBtn);
        });
        el.workspaceBackToOverviewBtn?.addEventListener('click', () => {
            closeSettingsModal();
            closeSubjectSettingsPanel({ restoreFocus: false });
        });
        el.workspaceOpenSubjectBtn?.addEventListener('click', () => {
            closeSettingsModal();
            closeSubjectSettingsPanel({ restoreFocus: false });
        });
        el.settingsModalCloseBtn?.addEventListener('click', closeSettingsModal);
        el.settingsModalBackdrop?.addEventListener('click', closeSettingsModal);
        el.subjectSettingsPanelCloseBtn?.addEventListener('click', () => closeSubjectSettingsPanel());
        el.subjectSettingsPanelBackdrop?.addEventListener('click', () => closeSubjectSettingsPanel());
        el.agentCardEmojiPickerBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleAgentEmojiPicker();
        });
        el.agentCardEmojiClearBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            setAgentCardEmoji('');
            closeAgentEmojiPicker({ restoreFocus: false });
        });
        el.agentCardEmojiInput?.addEventListener('input', syncAgentCardEmojiPicker);
        el.agentCardEmojiPicker?.addEventListener('emoji-click', (event) => {
            event.stopPropagation();
            const emoji = getEmojiFromPickerEvent(event);
            if (!emoji) {
                return;
            }
            setAgentCardEmoji(emoji);
            closeAgentEmojiPicker();
        });
        el.settingsNavButtons?.forEach((button) => {
            button.addEventListener('click', () => {
                switchSettingsModalSection(button.dataset.settingsSectionButton || 'global');
            });
        });
        el.saveGlobalSettingsBtn?.addEventListener('click', () => {
            void saveGlobalSettings();
        });
        el.saveAgentSettingsBtn?.addEventListener('click', () => {
            void saveAgentSettings();
        });
        syncAgentCardEmojiPicker();

        windowObj.addEventListener?.('resize', () => {
            closeAgentEmojiPicker({ restoreFocus: false });
        });
        documentObj.addEventListener?.('click', (event) => {
            if (!isAgentEmojiPickerOpen()) {
                return;
            }
            const target = event.target;
            if (target instanceof windowObj.Node && el.agentCardEmojiPickerRoot?.contains(target)) {
                return;
            }
            closeAgentEmojiPicker({ restoreFocus: false });
        });
        documentObj.addEventListener?.('keydown', (event) => {
            if (event.key === 'Escape') {
                if (isAgentEmojiPickerOpen()) {
                    closeAgentEmojiPicker();
                    return;
                }
                closeSubjectSettingsPanel();
            }
        });

        documentObj.querySelectorAll('input[name="themeMode"]').forEach((input) => {
            input.addEventListener('change', () => {
                if (input.checked) {
                    chatAPI.setThemeMode(input.value);
                    scheduleGlobalSettingsSave(0);
                }
            });
        });

        el.modelServiceProviderSearchInput?.addEventListener('input', () => {
            modelServiceUiState.providerSearch = el.modelServiceProviderSearchInput.value || '';
            renderModelServiceProviderList();
        });

        el.modelServiceAddProviderBtn?.addEventListener('click', () => {
            modelServiceUiState.providerMenuId = '';
            openModelServiceProviderEditorPopup();
        });

        el.modelServiceProviderList?.addEventListener('click', (event) => {
            const menuToggle = event.target.closest('[data-model-service-provider-menu-toggle]');
            if (menuToggle) {
                const providerId = menuToggle.dataset.modelServiceProviderMenuToggle || '';
                modelServiceUiState.providerMenuId = modelServiceUiState.providerMenuId === providerId ? '' : providerId;
                renderModelServiceProviderList();
                return;
            }

            const menuAction = event.target.closest('[data-model-service-provider-menu-action]');
            if (menuAction) {
                const providerId = menuAction.dataset.providerId || '';
                modelServiceUiState.providerMenuId = '';
                if (menuAction.dataset.modelServiceProviderMenuAction === 'edit') {
                    openModelServiceProviderEditorPopup({ providerId });
                    return;
                }
                if (menuAction.dataset.modelServiceProviderMenuAction === 'fetch') {
                    modelServiceUiState.selectedProviderId = providerId;
                    void fetchSelectedModelServiceModels();
                    return;
                }
                if (menuAction.dataset.modelServiceProviderMenuAction === 'delete') {
                    modelServiceUiState.selectedProviderId = providerId;
                    updateModelService((currentService) => ({
                        ...currentService,
                        providers: (currentService.providers || []).filter((provider) => provider.id !== providerId),
                        defaults: Object.fromEntries(
                            Object.entries(currentService.defaults || {}).map(([taskKey, ref]) => [
                                taskKey,
                                ref && ref.providerId === providerId ? null : ref,
                            ])
                        ),
                    }));
                    modelServiceUiState.providerStatus = null;
                    modelServiceUiState.popup = null;
                    return;
                }
            }

            const button = event.target.closest('[data-model-service-provider-select]');
            if (!button) {
                return;
            }

            modelServiceUiState.selectedProviderId = button.dataset.modelServiceProviderSelect || '';
            modelServiceUiState.selectedModelId = '';
            modelServiceUiState.providerMenuId = '';
            modelServiceUiState.showModelSearch = false;
            modelServiceUiState.showApiKeys = false;
            modelServiceUiState.providerStatus = null;
            modelServiceUiState.popup = null;
            renderModelServiceWorkbench();
        });

        el.modelServiceProviderDetail?.addEventListener('input', (event) => {
            const field = event.target.dataset?.modelServiceProviderField;
            if (!field) {
                return;
            }

            updateModelService((currentService) => ({
                ...currentService,
                providers: (currentService.providers || []).map((provider) => {
                    if (provider.id !== modelServiceUiState.selectedProviderId) {
                        return provider;
                    }

                    const nextProvider = { ...provider };
                    if (field === 'name') {
                        nextProvider.name = event.target.value;
                    } else if (field === 'apiBaseUrl') {
                        nextProvider.apiBaseUrl = normalizeModelServiceBaseUrl(event.target.value);
                    } else if (field === 'apiKeys') {
                        nextProvider.apiKeys = parseModelServiceApiKeysInput(event.target.value);
                    }
                    return nextProvider;
                }),
            }));
        });

        el.modelServiceProviderDetail?.addEventListener('change', (event) => {
            const providerField = event.target.dataset?.modelServiceProviderField;
            if (providerField === 'enabled') {
                updateModelService((currentService) => ({
                    ...currentService,
                    providers: (currentService.providers || []).map((provider) => (
                        provider.id === modelServiceUiState.selectedProviderId
                            ? { ...provider, enabled: event.target.checked }
                            : provider
                    )),
                }));
            }
        });

        el.modelServiceProviderDetail?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-model-service-action]');
            if (!button) {
                return;
            }

            const action = button.dataset.modelServiceAction;
            if (action === 'check-provider') {
                openModelServiceCheckPopup();
                return;
            }
            if (action === 'toggle-api-keys-visibility') {
                modelServiceUiState.showApiKeys = !modelServiceUiState.showApiKeys;
                renderModelServiceProviderDetail();
                return;
            }
            if (action === 'edit-headers') {
                openModelServiceHeadersPopup();
                return;
            }
        });

        el.modelServiceModelsPanel?.addEventListener('input', (event) => {
            if (event.target.dataset?.modelServiceModelSearch !== undefined) {
                modelServiceUiState.modelSearch = event.target.value || '';
                renderModelServiceModelsPanel();
            }
        });

        el.modelServiceModelsPanel?.addEventListener('click', (event) => {
            const groupToggleButton = event.target.closest('[data-model-service-group-toggle]');
            if (groupToggleButton) {
                toggleModelServiceGroup(groupToggleButton.dataset.modelServiceGroupToggle || '');
                return;
            }

            const button = event.target.closest('[data-model-service-action]');
            if (button) {
                const action = button.dataset.modelServiceAction;
                if (action === 'run-health-check') {
                    openModelServiceHealthCheckPopup();
                    return;
                }
                if (action === 'toggle-model-search') {
                    modelServiceUiState.showModelSearch = !modelServiceUiState.showModelSearch;
                    renderModelServiceModelsPanel();
                    return;
                }
                if (action === 'manage-models') {
                    openModelServiceManageModelsPopup();
                    return;
                }
                if (action === 'add-model') {
                    openModelServiceModelEditorPopup();
                    return;
                }
                if (action === 'edit-model') {
                    openModelServiceModelEditorPopup({
                        modelId: button.dataset.modelId || '',
                    });
                    return;
                }

                if (action === 'delete-model') {
                    deleteModelServiceModel(button.dataset.modelId || modelServiceUiState.selectedModelId);
                    return;
                }
            }

            const modelSelectButton = event.target.closest('[data-model-service-model-select]');
            if (modelSelectButton) {
                modelServiceUiState.selectedModelId = modelSelectButton.dataset.modelServiceModelSelect || '';
                renderModelServiceModelsPanel();
            }
        });

        ensureModelServiceDialogHost().addEventListener('click', (event) => {
            const overlay = event.target.closest('[data-model-service-popup-overlay]');
            const modal = event.target.closest('[data-model-service-popup]');
            if (overlay && !modal) {
                setModelServicePopup(null);
                return;
            }

            if (event.target.closest('[data-model-service-popup-close]')) {
                setModelServicePopup(null);
                return;
            }

            const button = event.target.closest('[data-model-service-popup-action]');
            if (!button) {
                return;
            }

            const popup = modelServiceUiState.popup;
            const action = button.dataset.modelServicePopupAction;
            if (action === 'save-provider-editor') {
                saveModelServiceProviderEditorPopup();
                return;
            }
            if (action === 'confirm-check-provider') {
                const modelId = popup?.type === 'check-provider' ? popup.modelId || '' : '';
                setModelServicePopup(null);
                void detectSelectedModelServiceProvider(modelId);
                return;
            }
            if (action === 'save-headers') {
                if (popup?.type === 'headers') {
                    const provider = getModelServicePopupProvider(popup);
                    if (provider) {
                        updateModelService((currentService) => ({
                            ...currentService,
                            providers: (currentService.providers || []).map((item) => (
                                item.id === provider.id
                                    ? { ...item, extraHeaders: parseModelServiceHeadersInput(popup.value || '') }
                                    : item
                            )),
                        }));
                    }
                }
                setModelServicePopup(null);
                return;
            }
            if (action === 'start-health-check') {
                if (popup?.type === 'health-check') {
                    const provider = getModelServicePopupProvider(popup);
                    const providerApiKeys = Array.isArray(provider?.apiKeys) ? provider.apiKeys.filter(Boolean) : [];
                    const selectedKeys = popup.keyMode === 'single'
                        ? [providerApiKeys[popup.selectedKeyIndex]].filter(Boolean)
                        : providerApiKeys;
                    void runSelectedModelServiceHealthCheck({
                        apiKeys: selectedKeys,
                        timeoutMs: popup.timeoutMs,
                        executionMode: popup.executionMode,
                    });
                }
                return;
            }
            if (action === 'open-add-model') {
                openModelServiceModelEditorPopup({
                    returnToManage: popup?.type === 'manage-models',
                    manageSearch: popup?.type === 'manage-models' ? popup.search || '' : '',
                });
                return;
            }
            if (action === 'edit-model') {
                openModelServiceModelEditorPopup({
                    modelId: button.dataset.modelId || '',
                    returnToManage: popup?.type === 'manage-models',
                    manageSearch: popup?.type === 'manage-models' ? popup.search || '' : '',
                });
                return;
            }
            if (action === 'delete-model') {
                deleteModelServiceModel(button.dataset.modelId || '');
                return;
            }
            if (action === 'save-model-editor') {
                saveModelServiceModelEditorPopup();
            }
        });

        ensureModelServiceDialogHost().addEventListener('input', (event) => {
            const field = event.target.dataset?.modelServicePopupField;
            if (modelServiceUiState.popup?.type === 'provider-editor') {
                if (field === 'providerName') {
                    patchModelServicePopup({ name: event.target.value || '', error: '' }, false);
                    return;
                }
                if (field === 'providerPresetId') {
                    patchModelServicePopup({ presetId: event.target.value || 'custom-openai-compatible', error: '' });
                    return;
                }
            }
            if (field === 'value' && modelServiceUiState.popup?.type === 'headers') {
                patchModelServicePopup({ value: event.target.value }, false);
                return;
            }
            if (field === 'search' && modelServiceUiState.popup?.type === 'manage-models') {
                patchModelServicePopup({ search: event.target.value || '' });
                return;
            }
            if (!field || modelServiceUiState.popup?.type !== 'model-editor') {
                return;
            }

            if (field === 'draft.enabled') {
                patchModelServicePopup((popup) => ({
                    ...popup,
                    error: '',
                    draft: {
                        ...(popup.draft || {}),
                        enabled: event.target.checked,
                    },
                }), false);
                return;
            }

            if (!field.startsWith('draft.')) {
                return;
            }

            const draftField = field.slice(6);
            patchModelServicePopup((popup) => ({
                ...popup,
                error: '',
                draft: {
                    ...(popup.draft || {}),
                    [draftField]: event.target.value,
                },
            }), false);
        });

        ensureModelServiceDialogHost().addEventListener('change', (event) => {
            const popup = modelServiceUiState.popup;
            const field = event.target.dataset?.modelServicePopupField;
            if (popup?.type === 'provider-editor') {
                if (field === 'providerPresetId') {
                    patchModelServicePopup({ presetId: event.target.value || 'custom-openai-compatible', error: '' });
                }
                return;
            }
            if (popup?.type === 'check-provider' && field === 'modelId') {
                patchModelServicePopup({ modelId: event.target.value || '' });
                return;
            }
            if (popup?.type === 'health-check') {
                if (field === 'keyMode') {
                    patchModelServicePopup({
                        keyMode: event.target.value || 'all',
                        selectedKeyIndex: 0,
                    });
                    return;
                }
                if (field === 'executionMode') {
                    patchModelServicePopup({ executionMode: event.target.value || 'parallel' });
                    return;
                }
                if (field === 'selectedKeyIndex') {
                    patchModelServicePopup({ selectedKeyIndex: Number(event.target.value || 0) });
                    return;
                }
                if (field === 'timeoutSeconds') {
                    patchModelServicePopup({ timeoutMs: Math.max(5, Number(event.target.value || 15)) * 1000 });
                    return;
                }
            }

            if (popup?.type === 'model-editor') {
                if (field === 'draft.group') {
                    const nextGroup = event.target.value || 'chat';
                    patchModelServicePopup((currentPopup) => ({
                        ...currentPopup,
                        error: '',
                        draft: {
                            ...(currentPopup.draft || {}),
                            group: nextGroup,
                        },
                    }), false);
                    return;
                }
                if (field === 'draft.enabled') {
                    patchModelServicePopup((currentPopup) => ({
                        ...currentPopup,
                        error: '',
                        draft: {
                            ...(currentPopup.draft || {}),
                            enabled: event.target.checked,
                        },
                    }), false);
                    return;
                }
            }

            const capabilityKey = event.target.dataset?.modelServicePopupCapability;
            if (popup?.type === 'model-editor' && capabilityKey) {
                patchModelServicePopup((currentPopup) => ({
                    ...currentPopup,
                    error: '',
                    draft: {
                        ...(currentPopup.draft || {}),
                        capabilities: {
                            ...(currentPopup.draft?.capabilities || {}),
                            [capabilityKey]: event.target.checked,
                        },
                    },
                }), false);
            }
        });

        documentObj.addEventListener('click', (event) => {
            if (!modelServiceUiState.providerMenuId) {
                return;
            }
            if (event.target.closest('[data-model-service-provider-menu-root]')) {
                return;
            }
            modelServiceUiState.providerMenuId = '';
            renderModelServiceProviderList();
        });

        el.modelServiceDefaultSelectors?.addEventListener('change', (event) => {
            const taskKey = event.target.dataset?.modelServiceDefault;
            if (!taskKey) {
                return;
            }

            const rawValue = event.target.value || '';
            const [providerId, modelId] = rawValue.split('::');
            updateModelService((currentService) => ({
                ...currentService,
                defaults: {
                    ...(currentService.defaults || {}),
                    [taskKey]: providerId && modelId ? { providerId, modelId } : null,
                },
            }));
        });

        el.enableAgentBubbleTheme?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogEnabledInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogEnablePromptVariablesInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.studyLogAutoInjectProtocolInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableRenderingPromptInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableEmoticonPromptInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableAdaptiveBubbleTipInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.enableTopicTitleGenerationInput?.addEventListener('change', () => {
            syncPromptInjectionState();
            scheduleGlobalSettingsSave();
        });
        el.agentBubbleThemePrompt?.addEventListener('input', () => {
            markPromptTextareaCustom(el.agentBubbleThemePrompt);
            setAgentBubbleThemeCaptionStatus(el.agentBubbleThemePersistStatus, '', '');
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.agentBubbleThemePrompt?.addEventListener('blur', () => {
            hydratePromptTextarea(el.agentBubbleThemePrompt, DEFAULT_AGENT_BUBBLE_THEME_PROMPT);
            if (el.agentBubbleThemePrompt?.value.trim()) {
                el.agentBubbleThemePrompt.dataset.usingDefaultPrompt = el.agentBubbleThemePrompt.value.trim() === DEFAULT_AGENT_BUBBLE_THEME_PROMPT.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshAgentBubbleThemePreview();
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.renderingPromptInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.renderingPromptInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.renderingPromptInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.renderingPromptInput, DEFAULT_RENDERING_PROMPT);
            if (el.renderingPromptInput?.value.trim()) {
                el.renderingPromptInput.dataset.usingDefaultPrompt = el.renderingPromptInput.value.trim() === DEFAULT_RENDERING_PROMPT.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.emoticonPromptInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.emoticonPromptInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.emoticonPromptInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.emoticonPromptInput, DEFAULT_EMOTICON_PROMPT);
            if (el.emoticonPromptInput?.value.trim()) {
                el.emoticonPromptInput.dataset.usingDefaultPrompt = el.emoticonPromptInput.value.trim() === DEFAULT_EMOTICON_PROMPT.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.adaptiveBubbleTipInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.adaptiveBubbleTipInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.adaptiveBubbleTipInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.adaptiveBubbleTipInput, DEFAULT_ADAPTIVE_BUBBLE_TIP);
            if (el.adaptiveBubbleTipInput?.value.trim()) {
                el.adaptiveBubbleTipInput.dataset.usingDefaultPrompt = el.adaptiveBubbleTipInput.value.trim() === DEFAULT_ADAPTIVE_BUBBLE_TIP.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.dailyNoteGuideInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.dailyNoteGuideInput);
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.dailyNoteGuideInput?.addEventListener('blur', () => {
            const defaultDailyNotePrompt = getDailyNoteDefaultPromptText();
            hydratePromptTextarea(el.dailyNoteGuideInput, defaultDailyNotePrompt);
            if (el.dailyNoteGuideInput?.value.trim()) {
                el.dailyNoteGuideInput.dataset.usingDefaultPrompt = el.dailyNoteGuideInput.value.trim() === defaultDailyNotePrompt.trim()
                    ? 'true'
                    : 'false';
            }
            void refreshFinalSystemPromptPreview();
            scheduleGlobalSettingsSave();
        });
        el.followUpPromptTemplateInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.followUpPromptTemplateInput);
            scheduleGlobalSettingsSave();
        });
        el.followUpPromptTemplateInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.followUpPromptTemplateInput, DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE);
            if (el.followUpPromptTemplateInput?.value.trim()) {
                el.followUpPromptTemplateInput.dataset.usingDefaultPrompt = el.followUpPromptTemplateInput.value.trim() === DEFAULT_FOLLOW_UP_PROMPT_TEMPLATE.trim()
                    ? 'true'
                    : 'false';
            }
            scheduleGlobalSettingsSave();
        });
        el.topicTitlePromptTemplateInput?.addEventListener('input', () => {
            markPromptTextareaCustom(el.topicTitlePromptTemplateInput);
            scheduleGlobalSettingsSave();
        });
        el.topicTitlePromptTemplateInput?.addEventListener('blur', () => {
            hydratePromptTextarea(el.topicTitlePromptTemplateInput, DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE);
            if (el.topicTitlePromptTemplateInput?.value.trim()) {
                el.topicTitlePromptTemplateInput.dataset.usingDefaultPrompt = el.topicTitlePromptTemplateInput.value.trim() === DEFAULT_TOPIC_TITLE_PROMPT_TEMPLATE.trim()
                    ? 'true'
                    : 'false';
            }
            scheduleGlobalSettingsSave();
        });
        el.refreshFinalSystemPromptPreviewBtn?.addEventListener('click', () => {
            void refreshFinalSystemPromptPreview();
        });

        [
            el.userNameInput,
            el.defaultModelInput,
            el.followUpDefaultModelInput,
            el.topicTitleDefaultModelInput,
            el.studentNameInput,
            el.studyCityInput,
            el.studyWorkspaceInput,
            el.workEnvironmentInput,
            el.studyTimezoneInput,
            el.promptVariablesInput,
            el.chatEndpoint,
            el.chatApiKey,
            el.kbEmbeddingModel,
            el.kbRerankModel,
            el.kbTopK,
            el.kbCandidateTopK,
            el.kbScoreThreshold,
            el.chatBubbleMaxWidthWideDefault,
        ].forEach((node) => {
            node?.addEventListener('input', () => scheduleGlobalSettingsSave());
            node?.addEventListener('change', () => scheduleGlobalSettingsSave());
        });

        [
            el.kbUseRerank,
            el.enableSmoothStreaming,
            el.chatFontPreset,
            el.chatCodeFontPreset,
        ].forEach((node) => {
            node?.addEventListener('change', () => scheduleGlobalSettingsSave());
        });

        el.themeToggleBtn?.addEventListener('click', () => {
            applyTheme('light');
        });
    }

    return {
        applyTheme,
        applyRendererSettings,
        syncGlobalSettingsForm,
        loadSettings,
        saveGlobalSettings,
        switchSettingsModalSection,
        openSettingsModal,
        openSubjectSettingsPanel,
        openToolboxDiaryManager,
        closeSettingsModal,
        closeSubjectSettingsPanel,
        setPromptVisible,
        saveAgentSettings,
        bindEvents,
    };
}

export {
    SETTINGS_MODAL_META,
    createSettingsController,
};

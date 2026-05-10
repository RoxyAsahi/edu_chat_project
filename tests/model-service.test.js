const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');

const modelService = require('../src/modules/main/utils/modelService');
const MODEL_SERVICE_PATH = path.resolve(__dirname, '../src/modules/main/utils/modelService.js');

function loadModelServiceWithEnv(overrides = {}) {
    const previousValues = {};
    Object.keys(overrides).forEach((key) => {
        previousValues[key] = process.env[key];
        if (overrides[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = overrides[key];
        }
    });

    delete require.cache[MODEL_SERVICE_PATH];
    const loaded = require(MODEL_SERVICE_PATH);

    Object.entries(previousValues).forEach(([key, value]) => {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    });
    delete require.cache[MODEL_SERVICE_PATH];
    require(MODEL_SERVICE_PATH);

    return loaded;
}

test('modelService exports the neutral helper names for settings conversion and mirror building', () => {
    assert.equal(typeof modelService.buildModelServiceFromSettings, 'function');
    assert.equal(typeof modelService.buildSettingsMirrorFromModelService, 'function');
    assert.equal('migrateLegacySettingsToModelService' in modelService, false);
    assert.equal('buildLegacySettingsMirror' in modelService, false);
});

test('buildModelServiceFromSettings and buildSettingsMirrorFromModelService preserve the direct-settings round trip', () => {
    const service = modelService.buildModelServiceFromSettings({
        chatEndpoint: 'https://chat.example.com/proxy/v1/chat/completions',
        chatApiKey: 'chat-key',
        defaultModel: 'gpt-4o',
        thinkingChatDefaultModel: 'gpt-4o-reasoning',
        followUpDefaultModel: 'gpt-4.1-mini',
        studyToolDefaultModel: 'gpt-4.1-study',
        topicTitleDefaultModel: 'gpt-4.1-nano',
        guideModel: 'guide-model',
        imageTranscriptionModel: 'vision-model',
        lastModel: 'last-model',
        kbBaseUrl: 'https://kb.example.com/openai/v1/embeddings',
        kbApiKey: 'kb-key',
        kbEmbeddingModel: 'bge-m3',
        kbRerankModel: 'bge-reranker-v2',
    });

    const settingsMirror = modelService.buildSettingsMirrorFromModelService(service, {
        guideModel: 'guide-model',
        imageTranscriptionModel: 'vision-model',
        lastModel: 'last-model',
    });

    assert.equal(settingsMirror.chatEndpoint, 'https://chat.example.com/proxy/v1/chat/completions');
    assert.equal(settingsMirror.chatApiKey, 'chat-key');
    assert.equal(settingsMirror.defaultModel, 'gpt-4o');
    assert.equal(settingsMirror.thinkingChatDefaultModel, 'gpt-4o-reasoning');
    assert.equal(settingsMirror.followUpDefaultModel, 'gpt-4.1-mini');
    assert.equal(settingsMirror.studyToolDefaultModel, 'gpt-4.1-study');
    assert.equal(settingsMirror.topicTitleDefaultModel, 'gpt-4.1-nano');
    assert.equal(settingsMirror.kbBaseUrl, 'https://kb.example.com/openai');
    assert.equal(settingsMirror.kbApiKey, 'kb-key');
    assert.equal(settingsMirror.kbEmbeddingModel, 'bge-m3');
    assert.equal(settingsMirror.kbRerankModel, 'bge-reranker-v2');
    assert.equal(settingsMirror.guideModel, 'guide-model');
    assert.equal(settingsMirror.imageTranscriptionModel, 'vision-model');
    assert.equal(settingsMirror.lastModel, 'last-model');
    assert.equal('chatFallback' in settingsMirror, false);
});

test('detectRemoteModelCapabilities recognizes OpenAI-compatible thinking model families', () => {
    assert.equal(modelService.detectRemoteModelCapabilities('glm-5.1').reasoning, true);
    assert.equal(modelService.detectRemoteModelCapabilities('Pro/moonshotai/Kimi-K2.6').reasoning, true);
    assert.equal(modelService.detectRemoteModelCapabilities('deepseek-ai/DeepSeek-V4-Flash').reasoning, true);
});

test('modelService allows the packaged AI&P test key to be overridden by environment variable', () => {
    const loaded = loadModelServiceWithEnv({
        UNISTUDY_AIP_TEST_API_KEY: 'env-provided-key',
    });

    assert.equal(loaded.AIP_TEST_API_KEY, 'env-provided-key');
    assert.deepEqual(loaded.createBuiltInTestProvider().apiKeys, ['env-provided-key']);
});

test('modelService can load the AI&P test preset from a JSON environment config', () => {
    const loaded = loadModelServiceWithEnv({
        UNISTUDY_AIP_TEST_PRESET_CONFIG: JSON.stringify({
            name: 'Contest Review Proxy',
            apiBaseUrl: 'https://proxy.example.com/openai',
            apiKey: 'json-config-key',
            models: [
                {
                    id: 'review-chat',
                    name: 'Review Chat',
                    group: 'chat',
                    capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
                },
                {
                    id: 'review-embedding',
                    name: 'Review Embedding',
                    group: 'embedding',
                    capabilities: { chat: false, embedding: true, rerank: false, vision: false, reasoning: false },
                },
                {
                    id: 'review-rerank',
                    name: 'Review Rerank',
                    group: 'rerank',
                    capabilities: { chat: false, embedding: false, rerank: true, vision: false, reasoning: false },
                },
            ],
            defaults: {
                chat: 'review-chat',
                thinkingChat: 'review-chat',
                chatFallback: 'review-chat',
                followUp: 'review-chat',
                studyTool: 'review-chat',
                topicTitle: 'review-chat',
                sourceGuide: 'review-chat',
                imageTranscription: 'review-chat',
                embedding: 'review-embedding',
                rerank: 'review-rerank',
            },
        }),
    });

    assert.equal(loaded.hasCustomAipTestPresetConfig(), true);
    assert.equal(loaded.AIP_TEST_PROVIDER_NAME, 'Contest Review Proxy');
    assert.equal(loaded.AIP_TEST_API_BASE_URL, 'https://proxy.example.com/openai');
    assert.equal(loaded.AIP_TEST_CHAT_ENDPOINT, 'https://proxy.example.com/openai/v1/chat/completions');
    assert.equal(loaded.AIP_TEST_API_KEY, 'json-config-key');
    assert.equal(loaded.AIP_TEST_DEFAULT_MODEL, 'review-chat');
    assert.equal(loaded.AIP_TEST_EMBEDDING_DEFAULT_MODEL, 'review-embedding');

    const service = loaded.createBuiltInTestModelService();
    assert.equal(service.providers.length, 1);
    assert.equal(service.providers[0].name, 'Contest Review Proxy');
    assert.deepEqual(service.providers[0].models.map((model) => model.id), [
        'review-chat',
        'review-embedding',
        'review-rerank',
    ]);
    assert.deepEqual(service.defaults.embedding, {
        providerId: 'aip-test-provider',
        modelId: 'review-embedding',
    });
});

test('buildModelServiceFromSettings recognizes the built-in AI&P test preset from the configured endpoint', () => {
    const service = modelService.buildModelServiceFromSettings({
        chatEndpoint: modelService.AIP_TEST_CHAT_ENDPOINT,
        chatApiKey: 'configured-key',
        defaultModel: modelService.AIP_TEST_DEFAULT_MODEL,
    });

    assert.equal(service.providers.length, 1);
    assert.equal(service.providers[0].presetId, modelService.AIP_TEST_PROVIDER_PRESET_ID);
    assert.equal(service.providers[0].name, modelService.AIP_TEST_PROVIDER_NAME);
    assert.equal(service.providers[0].apiBaseUrl, modelService.AIP_TEST_API_BASE_URL);
    assert.deepEqual(service.providers[0].apiKeys, ['configured-key']);
    assert.equal(service.defaults.chat?.modelId, modelService.AIP_TEST_DEFAULT_MODEL);
});

test('ensureBuiltInTestProvider keeps the built-in provider models in the intended evaluator-facing order', () => {
    const service = modelService.ensureBuiltInTestProvider({
        version: 1,
        providers: [
            {
                id: 'chat-provider',
                presetId: 'custom-openai-compatible',
                name: 'Chat Provider',
                protocol: 'openai-compatible',
                enabled: true,
                apiBaseUrl: 'https://chat.example.com/proxy',
                apiKeys: ['chat-key-1'],
                extraHeaders: {},
                models: [
                    {
                        id: 'gpt-4o',
                        name: 'gpt-4o',
                        group: 'chat',
                        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
                        enabled: true,
                        source: 'manual',
                    },
                ],
            },
        ],
        defaults: {
            chat: { providerId: 'chat-provider', modelId: 'gpt-4o' },
            thinkingChat: null,
            chatFallback: null,
            followUp: null,
            studyTool: null,
            topicTitle: null,
            embedding: null,
            rerank: null,
        },
    });

    const builtInProvider = service.providers.find((provider) => provider.presetId === modelService.AIP_TEST_PROVIDER_PRESET_ID);
    assert.ok(builtInProvider);
    assert.deepEqual(
        builtInProvider.models.map((model) => model.id),
        [
            'Qwen/Qwen3.6-35B-A3B',
            'Qwen/Qwen3.6-27B',
            'Pro/moonshotai/Kimi-K2.6',
            'Qwen/Qwen3-VL-Embedding-8B',
            'Qwen/Qwen3-VL-Reranker-8B',
            'Qwen/Qwen3.5-4B',
            'Qwen/Qwen3.5-35B-A3B',
            'Qwen/Qwen3.5-397B-A17B',
            'deepseek-ai/DeepSeek-V4-Flash',
            'Qwen/Qwen3.5-122B-A10B',
            'glm-5.1',
        ]
    );
    assert.deepEqual(service.defaults.chat, {
        providerId: 'chat-provider',
        modelId: 'gpt-4o',
    });
});

test('ensureBuiltInTestProvider fills current built-in defaults for the AI&P preset itself', () => {
    const service = modelService.ensureBuiltInTestProvider({
        version: 1,
        providers: [
            {
                id: 'aip-test-provider',
                presetId: modelService.AIP_TEST_PROVIDER_PRESET_ID,
                name: modelService.AIP_TEST_PROVIDER_NAME,
                protocol: 'openai-compatible',
                enabled: true,
                apiBaseUrl: modelService.AIP_TEST_API_BASE_URL,
                apiKeys: [modelService.AIP_TEST_API_KEY],
                extraHeaders: {},
                models: [],
            },
        ],
        defaults: {
            chat: null,
            thinkingChat: null,
            chatFallback: null,
            followUp: null,
            studyTool: null,
            topicTitle: null,
            embedding: null,
            rerank: null,
        },
    });

    assert.deepEqual(service.defaults.chat, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.thinkingChat, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_THINKING_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.chatFallback, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_CHAT_FALLBACK_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.followUp, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.studyTool, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.topicTitle, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.sourceGuide, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_SOURCE_DEFAULT_MODEL,
    });
    assert.deepEqual(service.defaults.imageTranscription, {
        providerId: 'aip-test-provider',
        modelId: modelService.AIP_TEST_SOURCE_DEFAULT_MODEL,
    });
});

test('resolveExecutionConfig can target dedicated source guide and image transcription defaults', () => {
    const settings = {
        modelService: modelService.buildModelServiceFromSettings({
            chatEndpoint: 'https://chat.example.com/base',
            chatApiKey: 'chat-key',
            defaultModel: 'chat-model',
            guideModel: 'guide-model',
            imageTranscriptionModel: 'vision-model',
        }),
    };

    const guideExecution = modelService.resolveExecutionConfig(settings, { purpose: 'sourceGuide' });
    const visionExecution = modelService.resolveExecutionConfig(settings, { purpose: 'imageTranscription' });

    assert.equal(guideExecution.model.id, 'guide-model');
    assert.equal(guideExecution.endpoint, 'https://chat.example.com/base/v1/chat/completions');
    assert.equal(visionExecution.model.id, 'vision-model');
    assert.equal(visionExecution.endpoint, 'https://chat.example.com/base/v1/chat/completions');
});

test('resolveExecutionConfig can target the dedicated thinking chat default', () => {
    const settings = {
        modelService: modelService.buildModelServiceFromSettings({
            chatEndpoint: 'https://chat.example.com/base',
            chatApiKey: 'chat-key',
            defaultModel: 'fast-chat-model',
            thinkingChatDefaultModel: 'thinking-chat-model',
        }),
    };

    const execution = modelService.resolveExecutionConfig(settings, { purpose: 'thinkingChat' });

    assert.equal(execution.purpose, 'thinkingChat');
    assert.equal(execution.model.id, 'thinking-chat-model');
    assert.equal(execution.endpoint, 'https://chat.example.com/base/v1/chat/completions');
    assert.equal(execution.apiKey, 'chat-key');
});

test('resolveExecutionConfig falls thinking chat back to the fast chat default when unset', () => {
    const settings = {
        modelService: modelService.buildModelServiceFromSettings({
            chatEndpoint: 'https://chat.example.com/base',
            chatApiKey: 'chat-key',
            defaultModel: 'fast-chat-model',
        }),
    };

    settings.modelService.defaults.thinkingChat = null;
    const execution = modelService.resolveExecutionConfig(settings, { purpose: 'thinkingChat' });

    assert.equal(execution.purpose, 'thinkingChat');
    assert.equal(execution.model.id, 'fast-chat-model');
});

test('resolveExecutionConfig can target the dedicated study tool default', () => {
    const settings = {
        modelService: modelService.buildModelServiceFromSettings({
            chatEndpoint: 'https://chat.example.com/base',
            chatApiKey: 'chat-key',
            defaultModel: 'chat-model',
            studyToolDefaultModel: 'study-tool-model',
        }),
    };

    const execution = modelService.resolveExecutionConfig(settings, { purpose: 'studyTool' });

    assert.equal(execution.purpose, 'studyTool');
    assert.equal(execution.model.id, 'study-tool-model');
    assert.equal(execution.endpoint, 'https://chat.example.com/base/v1/chat/completions');
    assert.equal(execution.apiKey, 'chat-key');
});

test('resolveChatFallbackExecution resolves only the configured fallback chat target', () => {
    const settings = {
        modelService: {
            version: 1,
            providers: [
                {
                    id: 'primary-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Primary',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'https://primary.example.com/base',
                    apiKeys: ['primary-key'],
                    extraHeaders: { 'X-Primary': '1' },
                    models: [
                        {
                            id: 'primary-chat',
                            name: 'primary-chat',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
                {
                    id: 'fallback-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Fallback',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'https://fallback.example.com/base',
                    apiKeys: ['fallback-key'],
                    extraHeaders: { 'X-Fallback': '1' },
                    models: [
                        {
                            id: 'fallback-chat',
                            name: 'fallback-chat',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
            ],
            defaults: {
                chat: { providerId: 'primary-provider', modelId: 'primary-chat' },
                thinkingChat: null,
                chatFallback: { providerId: 'fallback-provider', modelId: 'fallback-chat' },
                followUp: null,
                studyTool: null,
                topicTitle: null,
                embedding: null,
                rerank: null,
            },
        },
    };

    const execution = modelService.resolveChatFallbackExecution(settings);

    assert.deepEqual(execution.ref, {
        providerId: 'fallback-provider',
        modelId: 'fallback-chat',
    });
    assert.equal(execution.endpoint, 'https://fallback.example.com/base/v1/chat/completions');
    assert.equal(execution.apiKey, 'fallback-key');
    assert.deepEqual(execution.extraHeaders, { 'X-Fallback': '1' });
    assert.equal(execution.model.id, 'fallback-chat');
});

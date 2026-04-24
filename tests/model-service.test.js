const test = require('node:test');
const assert = require('assert/strict');

const modelService = require('../src/modules/main/utils/modelService');

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
        followUpDefaultModel: 'gpt-4.1-mini',
        topicTitleDefaultModel: 'gpt-4.1-nano',
        guideModel: 'guide-model',
        lastModel: 'last-model',
        kbBaseUrl: 'https://kb.example.com/openai/v1/embeddings',
        kbApiKey: 'kb-key',
        kbEmbeddingModel: 'bge-m3',
        kbRerankModel: 'bge-reranker-v2',
    });

    const settingsMirror = modelService.buildSettingsMirrorFromModelService(service, {
        guideModel: 'guide-model',
        lastModel: 'last-model',
    });

    assert.equal(settingsMirror.chatEndpoint, 'https://chat.example.com/proxy/v1/chat/completions');
    assert.equal(settingsMirror.chatApiKey, 'chat-key');
    assert.equal(settingsMirror.defaultModel, 'gpt-4o');
    assert.equal(settingsMirror.followUpDefaultModel, 'gpt-4.1-mini');
    assert.equal(settingsMirror.topicTitleDefaultModel, 'gpt-4.1-nano');
    assert.equal(settingsMirror.kbBaseUrl, 'https://kb.example.com/openai');
    assert.equal(settingsMirror.kbApiKey, 'kb-key');
    assert.equal(settingsMirror.kbEmbeddingModel, 'bge-m3');
    assert.equal(settingsMirror.kbRerankModel, 'bge-reranker-v2');
    assert.equal(settingsMirror.guideModel, 'guide-model');
    assert.equal(settingsMirror.lastModel, 'last-model');
    assert.equal('chatFallback' in settingsMirror, false);
});

test('buildModelServiceFromSettings recognizes the built-in AI&P test preset from the hardcoded channel', () => {
    const service = modelService.buildModelServiceFromSettings({
        chatEndpoint: modelService.AIP_TEST_CHAT_ENDPOINT,
        chatApiKey: modelService.AIP_TEST_API_KEY,
        defaultModel: modelService.AIP_TEST_DEFAULT_MODEL,
    });

    assert.equal(service.providers.length, 1);
    assert.equal(service.providers[0].presetId, modelService.AIP_TEST_PROVIDER_PRESET_ID);
    assert.equal(service.providers[0].name, modelService.AIP_TEST_PROVIDER_NAME);
    assert.equal(service.providers[0].apiBaseUrl, modelService.AIP_TEST_API_BASE_URL);
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
            chatFallback: null,
            followUp: null,
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
        ]
    );
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
                chatFallback: { providerId: 'fallback-provider', modelId: 'fallback-chat' },
                followUp: null,
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

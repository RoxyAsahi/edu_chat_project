const test = require('node:test');
const assert = require('assert/strict');

const {
    buildInterruptEndpoint,
    describeUpstreamCapabilities,
} = require('../src/modules/main/utils/upstreamCapabilities');

test('buildInterruptEndpoint rewrites the endpoint to /v1/interrupt', () => {
    const endpoint = buildInterruptEndpoint('http://example.com/v1/chat/completions');
    assert.equal(endpoint, 'http://example.com/v1/interrupt');
});

test('describeUpstreamCapabilities summarizes chat and knowledge-base endpoints', () => {
    const capabilities = describeUpstreamCapabilities({
        vcpServerUrl: 'http://example.com/v1/chat/completions',
        kbBaseUrl: 'http://kb.example.com/v1',
    });

    assert.equal(capabilities.chat.supported, true);
    assert.equal(capabilities.stream.supported, true);
    assert.equal(capabilities.interrupt.endpoint, 'http://example.com/v1/interrupt');
    assert.equal(capabilities.embeddings.endpoint, 'http://kb.example.com/v1/embeddings');
    assert.equal(capabilities.rerank.endpoint, 'http://kb.example.com/v1/rerank');
    assert.equal(capabilities.guideGeneration.supported, true);
    assert.deepEqual(capabilities.warnings, []);
});

test('describeUpstreamCapabilities records invalid endpoint warnings', () => {
    const capabilities = describeUpstreamCapabilities({
        vcpServerUrl: 'not a url',
        kbBaseUrl: 'still not a url',
    });

    assert.equal(capabilities.chat.supported, false);
    assert.equal(capabilities.embeddings.supported, false);
    assert.equal(capabilities.rerank.supported, false);
    assert.equal(capabilities.warnings.length, 3);
});

test('describeUpstreamCapabilities prefers modelService-resolved endpoints over legacy mirrors', () => {
    const capabilities = describeUpstreamCapabilities({
        vcpServerUrl: 'http://legacy.example.com/v1/chat/completions',
        kbBaseUrl: 'http://legacy-kb.example.com',
        modelService: {
            version: 1,
            providers: [
                {
                    id: 'service-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Service Provider',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'http://service.example.com/openai',
                    apiKeys: ['sk-test'],
                    extraHeaders: {},
                    models: [
                        {
                            id: 'chat-model',
                            name: 'chat-model',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                        {
                            id: 'embed-model',
                            name: 'embed-model',
                            group: 'embedding',
                            capabilities: { chat: false, embedding: true, rerank: false, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                        {
                            id: 'rerank-model',
                            name: 'rerank-model',
                            group: 'rerank',
                            capabilities: { chat: false, embedding: false, rerank: true, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
            ],
            defaults: {
                chat: { providerId: 'service-provider', modelId: 'chat-model' },
                followUp: null,
                topicTitle: null,
                embedding: { providerId: 'service-provider', modelId: 'embed-model' },
                rerank: { providerId: 'service-provider', modelId: 'rerank-model' },
            },
        },
    });

    assert.equal(capabilities.chat.endpoint, 'http://service.example.com/openai/v1/chat/completions');
    assert.equal(capabilities.interrupt.endpoint, 'http://service.example.com/v1/interrupt');
    assert.equal(capabilities.embeddings.endpoint, 'http://service.example.com/openai/v1/embeddings');
    assert.equal(capabilities.rerank.endpoint, 'http://service.example.com/openai/v1/rerank');
    assert.deepEqual(capabilities.warnings, []);
});

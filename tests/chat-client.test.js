const test = require('node:test');
const assert = require('assert/strict');
const { ReadableStream } = require('stream/web');

const chatClient = require('../src/modules/main/chatClient');

const originalFetch = global.fetch;

test.afterEach(() => {
    global.fetch = originalFetch;
});

test('chatClient keeps reasoning_content on outbound messages', async () => {
    let capturedBody = null;
    global.fetch = async (_url, options = {}) => {
        capturedBody = JSON.parse(String(options.body || '{}'));
        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: 'ok',
                        },
                    }],
                };
            },
        };
    };

    const result = await chatClient.send({
        requestId: 'req_reasoning_body',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{
            role: 'assistant',
            content: '已有回答',
            reasoning_content: '已有思考',
        }],
        modelConfig: { stream: false },
    });

    assert.equal(result.error, undefined);
    assert.equal(capturedBody.messages[0].reasoning_content, '已有思考');
});

test('chatClient accumulates reasoning_content from streaming chunks and emits it on end', async () => {
    const events = [];
    let resolveEnd;
    const endPayloadPromise = new Promise((resolve) => {
        resolveEnd = resolve;
    });

    global.fetch = async () => {
        const encoder = new TextEncoder();
        return {
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"先分析，","content":"Hello"}}]}\n\n'));
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning":"再总结","content":" world"}}]}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            }),
        };
    };

    const result = await chatClient.send({
        requestId: 'req_reasoning_stream',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'user', content: 'hi' }],
        modelConfig: { stream: true },
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        webContents: {
            isDestroyed() {
                return false;
            },
            send(_channel, payload) {
                events.push(payload);
                if (payload.type === 'end') {
                    resolveEnd(payload);
                }
            },
        },
    });

    assert.deepEqual(result, {
        streamingStarted: true,
        requestId: 'req_reasoning_stream',
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        fallbackMeta: null,
    });

    const endPayload = await endPayloadPromise;
    assert.equal(endPayload.fullResponse, 'Hello world');
    assert.equal(endPayload.reasoning_content, '先分析，再总结');
    assert.ok(events.some((payload) => payload.type === 'data' && payload.reasoningDelta));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chatClient.getActiveRequestCount(), 0);
});

test('chatClient can suppress raw stream IPC events while still forwarding parsed chunks to callbacks', async () => {
    const streamedChunks = [];
    let endResult = null;
    let sentEventCount = 0;

    global.fetch = async () => {
        const encoder = new TextEncoder();
        return {
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n'));
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            }),
        };
    };

    const result = await chatClient.send({
        requestId: 'req_custom_stream_consumer',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'user', content: 'hi' }],
        modelConfig: { stream: true },
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        emitStreamEvents: false,
        onStreamChunk(payload) {
            streamedChunks.push(payload.textDelta);
        },
        onStreamEnd(payload) {
            endResult = payload;
        },
        webContents: {
            isDestroyed() {
                return false;
            },
            send() {
                sentEventCount += 1;
            },
        },
    });

    assert.equal(result.streamingStarted, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(streamedChunks, ['hello ', 'world']);
    assert.equal(sentEventCount, 0);
    assert.equal(endResult?.success, true);
    assert.equal(endResult?.content, 'hello world');
});

test('chatClient retries once with the configured fallback on retryable upstream HTTP errors', async () => {
    let fetchCount = 0;
    global.fetch = async (url, options = {}) => {
        fetchCount += 1;

        if (fetchCount === 1) {
            assert.equal(url, 'http://primary.example.com/v1/chat/completions');
            assert.equal(options.headers.Authorization, 'Bearer primary-key');
            return {
                ok: false,
                status: 503,
                async text() {
                    return JSON.stringify({ message: 'primary unavailable' });
                },
            };
        }

        assert.equal(url, 'http://fallback.example.com/v1/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer fallback-key');
        assert.equal(options.headers['X-Route'], 'fallback');
        assert.equal(JSON.parse(String(options.body || '{}')).model, 'fallback-model');

        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: 'fallback reply',
                        },
                    }],
                };
            },
        };
    };

    const result = await chatClient.send({
        requestId: 'req_fallback_retryable',
        endpoint: 'http://primary.example.com/v1/chat/completions',
        apiKey: 'primary-key',
        messages: [{ role: 'user', content: 'hello' }],
        modelConfig: {
            model: 'primary-model',
            stream: false,
        },
        fallbackExecution: {
            endpoint: 'http://fallback.example.com/v1/chat/completions',
            apiKey: 'fallback-key',
            extraHeaders: {
                'X-Route': 'fallback',
            },
            ref: {
                providerId: 'fallback-provider',
            },
            model: {
                id: 'fallback-model',
                capabilities: {
                    chat: true,
                    vision: true,
                },
            },
        },
    });

    assert.equal(fetchCount, 2);
    assert.equal(result.error, undefined);
    assert.equal(result.response.choices[0].message.content, 'fallback reply');
    assert.equal(result.fallbackMeta.attempted, true);
    assert.equal(result.fallbackMeta.used, true);
    assert.equal(result.fallbackMeta.skippedReason, '');
    assert.deepEqual(result.fallbackMeta.trigger, {
        type: 'http_error',
        statusCode: 503,
        error: 'primary unavailable',
    });
    assert.deepEqual(result.fallbackMeta.primary, {
        providerId: '',
        modelId: 'primary-model',
        endpoint: 'http://primary.example.com/v1/chat/completions',
    });
    assert.deepEqual(result.fallbackMeta.fallback, {
        providerId: 'fallback-provider',
        modelId: 'fallback-model',
        endpoint: 'http://fallback.example.com/v1/chat/completions',
    });
});

test('chatClient does not fallback for non-retryable upstream HTTP errors', async () => {
    let fetchCount = 0;
    global.fetch = async () => {
        fetchCount += 1;
        return {
            ok: false,
            status: 400,
            async text() {
                return JSON.stringify({ message: 'bad request' });
            },
        };
    };

    const result = await chatClient.send({
        requestId: 'req_no_fallback_400',
        endpoint: 'http://primary.example.com/v1/chat/completions',
        apiKey: 'primary-key',
        messages: [{ role: 'user', content: 'hello' }],
        modelConfig: {
            model: 'primary-model',
            stream: false,
        },
        fallbackExecution: {
            endpoint: 'http://fallback.example.com/v1/chat/completions',
            apiKey: 'fallback-key',
            model: {
                id: 'fallback-model',
                capabilities: {
                    chat: true,
                },
            },
        },
    });

    assert.equal(fetchCount, 1);
    assert.equal(result.error, 'Chat request failed: 400 - bad request');
    assert.equal(result.fallbackMeta.attempted, false);
    assert.equal(result.fallbackMeta.used, false);
    assert.equal(result.fallbackMeta.skippedReason, 'not-triggered');
});

test('chatClient skips fallback when the configured fallback target is the same as the primary target', async () => {
    let fetchCount = 0;
    global.fetch = async () => {
        fetchCount += 1;
        return {
            ok: false,
            status: 503,
            async text() {
                return JSON.stringify({ message: 'service unavailable' });
            },
        };
    };

    const result = await chatClient.send({
        requestId: 'req_same_target_skip',
        endpoint: 'http://primary.example.com/v1/chat/completions',
        apiKey: 'primary-key',
        messages: [{ role: 'user', content: 'hello' }],
        modelConfig: {
            model: 'shared-model',
            stream: false,
        },
        fallbackExecution: {
            endpoint: 'http://primary.example.com/v1/chat/completions',
            apiKey: 'primary-key',
            model: {
                id: 'shared-model',
                capabilities: {
                    chat: true,
                },
            },
        },
    });

    assert.equal(fetchCount, 1);
    assert.equal(result.error, 'Chat request failed: 503 - service unavailable');
    assert.equal(result.fallbackMeta.attempted, false);
    assert.equal(result.fallbackMeta.used, false);
    assert.equal(result.fallbackMeta.skippedReason, 'same-target');
});

test('chatClient skips fallback when the fallback model lacks the required capability', async () => {
    let fetchCount = 0;
    global.fetch = async () => {
        fetchCount += 1;
        return {
            ok: false,
            status: 503,
            async text() {
                return JSON.stringify({ message: 'vision primary unavailable' });
            },
        };
    };

    const result = await chatClient.send({
        requestId: 'req_incompatible_capability',
        endpoint: 'http://primary.example.com/v1/chat/completions',
        apiKey: 'primary-key',
        messages: [{ role: 'user', content: 'describe image' }],
        modelConfig: {
            model: 'primary-vision-model',
            stream: false,
        },
        fallbackExecution: {
            endpoint: 'http://fallback.example.com/v1/chat/completions',
            apiKey: 'fallback-key',
            model: {
                id: 'fallback-chat-only',
                capabilities: {
                    chat: true,
                    vision: false,
                },
            },
        },
        requiredCapability: 'vision',
    });

    assert.equal(fetchCount, 1);
    assert.equal(result.error, 'Chat request failed: 503 - vision primary unavailable');
    assert.equal(result.fallbackMeta.attempted, false);
    assert.equal(result.fallbackMeta.used, false);
    assert.equal(result.fallbackMeta.skippedReason, 'incompatible-capability');
});

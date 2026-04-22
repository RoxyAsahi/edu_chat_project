const test = require('node:test');
const assert = require('assert/strict');
const { ReadableStream } = require('stream/web');

const vcpClient = require('../src/modules/main/vcpClient');

const originalFetch = global.fetch;

test.afterEach(() => {
    global.fetch = originalFetch;
});

test('vcpClient keeps reasoning_content on outbound messages', async () => {
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

    const result = await vcpClient.send({
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

test('vcpClient accumulates reasoning_content from streaming chunks and emits it on end', async () => {
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

    const result = await vcpClient.send({
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
    });

    const endPayload = await endPayloadPromise;
    assert.equal(endPayload.fullResponse, 'Hello world');
    assert.equal(endPayload.reasoning_content, '先分析，再总结');
    assert.ok(events.some((payload) => payload.type === 'data' && payload.reasoningDelta));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(vcpClient.getActiveRequestCount(), 0);
});

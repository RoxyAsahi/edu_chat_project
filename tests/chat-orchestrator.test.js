const test = require('node:test');
const assert = require('assert/strict');

const { createChatOrchestrator } = require('../src/modules/main/study/chatOrchestrator');

test('chatOrchestrator direct-stream mode forwards the real streaming request without synthetic replay', async () => {
    const senderEvents = [];
    let capturedRequest = null;
    const orchestrator = createChatOrchestrator({
        chatClient: {
            async send(request) {
                capturedRequest = request;
                return {
                    streamingStarted: true,
                    requestId: request.requestId,
                    context: request.context,
                    fallbackMeta: null,
                };
            },
        },
        studyToolRuntime: {
            async executeToolRequest() {
                throw new Error('executeToolRequest should not be called in direct-stream mode.');
            },
        },
        studyMemoryService: {
            async searchStudyMemory() {
                return {
                    refs: [{ id: 'memory-1' }],
                    contextText: 'memory context',
                    itemCount: 1,
                };
            },
        },
    });

    const result = await orchestrator.runRequest({
        executionMode: 'direct-stream',
        requestId: 'req_direct_stream',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'user', content: 'hello' }],
        modelConfig: { stream: true, model: 'demo-model' },
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        settings: {},
        webContents: {
            isDestroyed() {
                return false;
            },
            send(channel, payload) {
                senderEvents.push({ channel, payload });
            },
        },
        streamChannel: 'chat-stream-event',
        onStreamEnd() {},
    });

    assert.equal(capturedRequest.modelConfig.stream, true);
    assert.equal(typeof capturedRequest.onStreamEnd, 'function');
    assert.equal(capturedRequest.messages[0].role, 'system');
    assert.match(capturedRequest.messages[0].content, /memory context/);
    assert.equal(result.streamingStarted, true);
    assert.deepEqual(result.studyMemoryRefs, [{ id: 'memory-1' }]);
    assert.deepEqual(result.toolEvents, []);
    assert.equal(senderEvents.length, 0);
});

test('chatOrchestrator merges study memory into the leading system message instead of appending another system entry', async () => {
    let capturedRequest = null;
    const orchestrator = createChatOrchestrator({
        chatClient: {
            async send(request) {
                capturedRequest = request;
                return {
                    response: {
                        choices: [{ message: { content: 'ok' } }],
                    },
                    requestId: request.requestId,
                    context: request.context,
                    fallbackMeta: null,
                };
            },
        },
        studyToolRuntime: {
            async executeToolRequest() {
                throw new Error('executeToolRequest should not be called.');
            },
        },
        studyMemoryService: {
            async searchStudyMemory() {
                return {
                    refs: [{ id: 'memory-1' }],
                    contextText: 'memory context',
                    itemCount: 1,
                };
            },
        },
    });

    await orchestrator.runRequest({
        executionMode: 'direct-stream',
        requestId: 'req_merge_system',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [
            { role: 'system', content: 'base system prompt' },
            { role: 'user', content: 'hello' },
        ],
        modelConfig: { stream: false, model: 'demo-model' },
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        settings: {},
    });

    assert.ok(capturedRequest);
    assert.deepEqual(
        capturedRequest.messages.map((message) => message.role),
        ['system', 'user']
    );
    assert.match(capturedRequest.messages[0].content, /base system prompt/);
    assert.match(capturedRequest.messages[0].content, /memory context/);
});

test('chatOrchestrator streams raw tool blocks across tool rounds and preserves final tool cards', async () => {
    const senderEvents = [];
    let sendCount = 0;
    const orchestrator = createChatOrchestrator({
        chatClient: {
            async send(request) {
                sendCount += 1;

                if (sendCount === 1) {
                    request.onStreamChunk?.({
                        textDelta: '',
                        reasoningDelta: '先判断是否需要写入学习日志。',
                        chunk: { choices: [{ delta: { reasoning_content: '先判断是否需要写入学习日志。' } }] },
                    });

                    const roundOneChunks = [
                        '先给你一个简短结论。',
                        '\n<<<[TOOL_REQUEST]>>>\n',
                        'tool_name:「始」DailyNote「末」\n',
                        'command:「始」create「末」\n',
                        'Date:「始」2026-04-24「末」\n',
                        'Content:「始」[20:00] 记录一次工具流式联调。\nTag: 流式, 工具链路「末」\n',
                        '<<<[END_TOOL_REQUEST]>>>',
                    ];
                    roundOneChunks.forEach((textDelta) => {
                        request.onStreamChunk?.({ textDelta, reasoningDelta: '', chunk: { content: textDelta } });
                    });
                    request.onStreamEnd?.({
                        success: true,
                        content: roundOneChunks.join(''),
                        reasoningContent: '',
                        finishReason: 'completed',
                        interrupted: false,
                        timedOut: false,
                    });
                    return {
                        streamingStarted: true,
                        requestId: request.requestId,
                        context: request.context,
                        fallbackMeta: null,
                    };
                }

                const roundTwoChunks = ['工具执行完成，下面继续展开说明。'];
                roundTwoChunks.forEach((textDelta) => {
                    request.onStreamChunk?.({ textDelta, reasoningDelta: '', chunk: { content: textDelta } });
                });
                request.onStreamEnd?.({
                    success: true,
                    content: roundTwoChunks.join(''),
                    reasoningContent: '',
                    finishReason: 'completed',
                    interrupted: false,
                    timedOut: false,
                });
                return {
                    streamingStarted: true,
                    requestId: request.requestId,
                    context: request.context,
                    fallbackMeta: null,
                };
            },
        },
        studyToolRuntime: {
            async executeToolRequest() {
                return {
                    success: true,
                    toolName: 'DailyNote',
                    command: 'create',
                };
            },
        },
        studyMemoryService: {
            async searchStudyMemory() {
                return {
                    refs: [],
                    contextText: '',
                    itemCount: 0,
                };
            },
        },
    });

    const result = await orchestrator.runRequest({
        executionMode: 'tool-orchestrated',
        requestId: 'req_tool_stream',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'user', content: 'hello' }],
        modelConfig: { stream: true, model: 'demo-model' },
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        settings: {},
        webContents: {
            isDestroyed() {
                return false;
            },
            send(channel, payload) {
                senderEvents.push({ channel, payload });
            },
        },
        streamChannel: 'chat-stream-event',
    });

    const dataPayloads = senderEvents.filter((event) => event.payload.type === 'data').map((event) => event.payload.chunk.content);
    const reasoningPayloads = senderEvents
        .filter((event) => event.payload.type === 'data')
        .map((event) => event.payload.reasoningDelta || '')
        .filter(Boolean);
    const endPayload = senderEvents.find((event) => event.payload.type === 'end')?.payload || null;
    const streamedVisibleText = dataPayloads.join('');

    assert.equal(result.streamingStarted, true);
    assert.equal(sendCount, 2);
    assert.match(streamedVisibleText, /先给你一个简短结论。/);
    assert.match(streamedVisibleText, /<<<\[TOOL_REQUEST\]>>>/);
    assert.match(streamedVisibleText, /tool_name:「始」DailyNote「末」/);
    assert.match(streamedVisibleText, /<<<\[END_TOOL_REQUEST\]>>>/);
    assert.match(streamedVisibleText, /工具执行完成，下面继续展开说明。/);
    assert.deepEqual(reasoningPayloads, ['先判断是否需要写入学习日志。']);
    assert.equal(streamedVisibleText.includes('<<<[TOOL_REQUEST]>>>'), true);
    assert.ok(endPayload);
    assert.match(endPayload.fullResponse, /先给你一个简短结论。/);
    assert.match(endPayload.fullResponse, /<<<\[TOOL_REQUEST\]>>>/);
    assert.match(endPayload.fullResponse, /tool_name:「始」DailyNote「末」/);
    assert.match(endPayload.fullResponse, /工具执行完成，下面继续展开说明。/);
    assert.equal(Array.isArray(result.toolEvents), true);
    assert.equal(result.toolEvents.length, 1);
});

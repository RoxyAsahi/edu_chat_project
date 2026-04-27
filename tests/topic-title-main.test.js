const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');
const {
    buildPlaceholderTopicName,
    isPlaceholderTopicName,
} = require('../src/modules/main/utils/topicTitles');

const CHAT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/chatHandlers.js');
const AGENT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/agentHandlers.js');

function loadMainHandlers(chatClientStub = { initialize() {}, async send() { return {}; } }) {
    const handlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
        },
        dialog: {},
        BrowserWindow: class BrowserWindow {},
    };
    const knowledgeBaseStub = {};
    const modelUsageTrackerStub = {
        async recordModelUsage() {},
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(CHAT_HANDLERS_PATH)];
        delete require.cache[require.resolve(AGENT_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            if (request === '../knowledge-base') {
                return knowledgeBaseStub;
            }
            if (request === '../chatClient') {
                return chatClientStub;
            }
            if (request === '../modelUsageTracker') {
                return modelUsageTrackerStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const chatHandlers = require(CHAT_HANDLERS_PATH);
        const agentHandlers = require(AGENT_HANDLERS_PATH);
        return { chatHandlers, agentHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

function createSenderEvent(sentEvents = []) {
    return {
        sender: {
            isDestroyed() {
                return false;
            },
            send(channel, payload) {
                sentEvents.push({ channel, payload });
            },
        },
    };
}

function waitFor(predicate, timeoutMs = 800) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const value = predicate();
                if (value) {
                    resolve(value);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('Timed out waiting for condition.'));
                    return;
                }
                setTimeout(tick, 10);
            } catch (error) {
                reject(error);
            }
        };
        tick();
    });
}

function delay(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('topic title helpers recognize placeholder names and keep numbering stable', () => {
    assert.equal(buildPlaceholderTopicName([]), '新对话 1');
    assert.equal(buildPlaceholderTopicName([{ id: 'topic-1' }]), '新对话 2');
    assert.equal(isPlaceholderTopicName('新对话 3'), true);
    assert.equal(isPlaceholderTopicName('主要对话'), true);
    assert.equal(isPlaceholderTopicName('Main Conversation'), true);
    assert.equal(isPlaceholderTopicName('用户手动命名'), false);
});

test('agent config manager allowDefault uses the new placeholder topic name', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-main-'));
    t.after(() => fs.remove(tempRoot));

    const manager = new AgentConfigManager(path.join(tempRoot, 'agents'));
    const config = await manager.readAgentConfig('missing-agent', { allowDefault: true });

    assert.equal(config.topics[0].name, '新对话 1');
});

test('create-agent, delete-topic fallback, and create-new-topic all use placeholder topic names', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-main-'));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const manager = new AgentConfigManager(agentDir);
    const settingsManager = {
        async readSettings() {
            return {};
        },
        async updateSettings(patch) {
            return { success: true, settings: patch };
        },
    };
    const { chatHandlers, agentHandlers, handlers } = loadMainHandlers();
    t.after(async () => {
        await chatHandlers.shutdown();
        await fs.remove(tempRoot);
    });

    agentHandlers.initialize({
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        AVATAR_IMAGE_DIR: path.join(tempRoot, 'avatars'),
        SETTINGS_FILE: path.join(tempRoot, 'settings.json'),
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        settingsManager,
        agentConfigManager: manager,
    });
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager,
        agentConfigManager: manager,
        chatHistoryStore: {
            async replaceHistory() {},
            async deleteTopic() {},
            async close() {},
        },
    });

    const createAgent = handlers.get('create-agent');
    const deleteTopic = handlers.get('delete-topic');
    const createNewTopicForAgent = handlers.get('create-new-topic-for-agent');

    const createResult = await createAgent({}, '数学', null);
    assert.equal(createResult.success, true);
    assert.equal(createResult.config.topics[0].name, '新对话 1');

    const deleteResult = await deleteTopic({}, createResult.agentId, 'default');
    assert.equal(deleteResult.success, true);
    assert.equal(deleteResult.remainingTopics[0].name, '新对话 1');

    const newTopicResult = await createNewTopicForAgent({}, createResult.agentId, '', false, true);
    assert.equal(newTopicResult.success, true);
    assert.equal(newTopicResult.topicName, '新对话 2');
});

test('generate-topic-title uses the task model priority chain and parses dirty JSON output', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-main-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'agent-title';
    const topicId = 'topic-1';

    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '新对话 1' }],
    }, { spaces: 2 });

    let capturedRequest = null;
    const chatClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return {
                response: {
                    choices: [{
                        message: {
                            content: '好的，结果如下：```json\n{"title":"📘 线性函数复习"}\n```',
                        },
                    }],
                },
            };
        },
    };
    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadMainHandlers(chatClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    topicTitleDefaultModel: 'Qwen/Qwen3.5-35B-A3B',
                    defaultModel: 'global-model',
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                    topicTitlePromptTemplate: '自定义标题模板\n{{CHAT_HISTORY}}',
                };
            },
        },
        agentConfigManager: manager,
    });

    const generateTopicTitle = handlers.get('generate-topic-title');
    const result = await generateTopicTitle({}, {
        agentId,
        topicId,
        messageId: 'assistant-1',
        model: 'requested-model',
        messages: [
            { id: 'user-1', role: 'user', content: '请帮我复习线性函数' },
            { id: 'assistant-1', role: 'assistant', content: '我们先看斜率和截距。' },
        ],
    });

    assert.equal(result.success, true);
    assert.equal(result.title, '📘 线性函数复习');
    assert.equal(capturedRequest.modelConfig.model, 'Qwen/Qwen3.5-35B-A3B');
    assert.equal(capturedRequest.modelConfig.enable_thinking, false);
    assert.match(capturedRequest.messages[0].content, /自定义标题模板/);
    assert.match(capturedRequest.messages[0].content, /\[1\] User:/);
});

test('generate-topic-title falls back to the first user message when generation fails', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-main-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadMainHandlers({
        initialize() {},
        async send() {
            return { error: 'upstream failed' };
        },
    });
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                };
            },
        },
        agentConfigManager: manager,
    });

    const generateTopicTitle = handlers.get('generate-topic-title');
    const result = await generateTopicTitle({}, {
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
        messages: [
            {
                id: 'user-1',
                role: 'user',
                content: '这是一个很长的问题，用来验证标题生成失败时会不会回退到首条用户消息的截断文本，并且保持静默，不弹出任何错误提示。为了确保超过截断上限，我再补上一段额外说明，继续拉长这条用户消息。',
            },
            { id: 'assistant-1', role: 'assistant', content: '收到。' },
        ],
    });

    assert.equal(result.success, true);
    assert.equal(result.generated, false);
    assert.match(result.title, /^这是一个很长的问题，用来验证标题生成失败时会不会回退到首条用户消息的截断文本/);
    assert.equal(result.title.endsWith('...'), true);
});

test('topic title prompt supports OpenWebUI-style MESSAGES placeholders and legacy CHAT_HISTORY', () => {
    const { chatHandlers } = loadMainHandlers();
    const { buildTopicTitlePrompt } = chatHandlers.__testUtils;
    const messages = [
        { role: 'user', content: '请讲一次函数' },
        { role: 'assistant', content: '我们先看斜率。' },
    ];

    const openWebUiStylePrompt = buildTopicTitlePrompt('标题\n{{MESSAGES:END:2}}', messages);
    assert.match(openWebUiStylePrompt, /\[1\] User:\n请讲一次函数/);
    assert.match(openWebUiStylePrompt, /\[2\] Assistant:\n我们先看斜率。/);

    const legacyPrompt = buildTopicTitlePrompt('旧模板\n{{CHAT_HISTORY}}', messages);
    assert.match(legacyPrompt, /\[1\] User:\n请讲一次函数/);
});

test('topic title background task resolver rejects disabled, non-placeholder, empty, and non-initial turns', () => {
    const { chatHandlers } = loadMainHandlers();
    const { resolveTopicTitleBackgroundTask } = chatHandlers.__testUtils;
    const baseRequest = {
        backgroundTasks: {
            topicTitle: {
                enabled: true,
                expectedTopicName: '新对话 1',
            },
        },
        context: {
            agentId: 'agent-1',
            topicId: 'topic-1',
            assistantMessageId: 'assistant-1',
        },
        messages: [{ role: 'user', content: '讲一次函数' }],
        model: 'chat-model',
        settings: {},
    };

    assert.ok(resolveTopicTitleBackgroundTask(baseRequest));
    assert.equal(resolveTopicTitleBackgroundTask({
        ...baseRequest,
        settings: { enableTopicTitleGeneration: false },
    }), null);
    assert.equal(resolveTopicTitleBackgroundTask({
        ...baseRequest,
        backgroundTasks: {
            topicTitle: {
                enabled: true,
                expectedTopicName: '用户命名',
            },
        },
    }), null);
    assert.equal(resolveTopicTitleBackgroundTask({
        ...baseRequest,
        messages: [{ role: 'user', content: '' }],
    }), null);
    assert.equal(resolveTopicTitleBackgroundTask({
        ...baseRequest,
        messages: [
            { role: 'user', content: '第一问' },
            { role: 'assistant', content: '第一答' },
            { role: 'user', content: '第二问' },
        ],
    }), null);
});

test('topic title completion guard rejects cancelled, timed out, and errored streams', () => {
    const { chatHandlers } = loadMainHandlers();
    const { isSuccessfulTopicTitleCompletion } = chatHandlers.__testUtils;

    assert.equal(isSuccessfulTopicTitleCompletion({
        success: true,
        content: '有效回答',
        finishReason: 'completed',
    }), true);
    assert.equal(isSuccessfulTopicTitleCompletion({
        success: true,
        content: '部分回答',
        finishReason: 'cancelled_by_user',
        interrupted: true,
    }), false);
    assert.equal(isSuccessfulTopicTitleCompletion({
        success: true,
        content: '部分回答',
        finishReason: 'timed_out',
        timedOut: true,
    }), false);
    assert.equal(isSuccessfulTopicTitleCompletion({
        success: false,
        content: '部分回答',
        error: 'upstream failed',
    }), false);
});

test('send-chat-request runs the topic title background task after non-stream completion', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-main-path-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'agent-title';
    const topicId = 'topic-1';
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '新对话 1' }],
    }, { spaces: 2 });

    const titlePrompts = [];
    const chatClientStub = {
        initialize() {},
        async send(request) {
            if (request?.context?.source === 'topic-title-generation') {
                titlePrompts.push(request.messages[0].content);
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '好的：{"title":"📘 非流式标题"}',
                            },
                        }],
                    },
                };
            }

            return {
                requestId: request.requestId,
                context: request.context,
                response: {
                    choices: [{
                        message: {
                            content: '这是最终助手回复。',
                        },
                    }],
                },
            };
        },
    };
    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadMainHandlers(chatClientStub);
    t.after(async () => chatHandlers.shutdown());
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                    enableTopicTitleGeneration: true,
                    studyLogPolicy: { enabled: false },
                };
            },
        },
        agentConfigManager: manager,
        chatHistoryStore: {
            async close() {},
        },
    });

    const sentEvents = [];
    const sendChatRequest = handlers.get('send-chat-request');
    const result = await sendChatRequest(createSenderEvent(sentEvents), {
        requestId: 'assistant-1',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'secret',
        executionMode: 'direct-stream',
        messages: [{ role: 'user', content: '请讲一次函数' }],
        modelConfig: { stream: false },
        context: {
            agentId,
            topicId,
            assistantMessageId: 'assistant-1',
        },
        backgroundTasks: {
            topicTitle: {
                enabled: true,
                expectedTopicName: '新对话 1',
            },
        },
    });

    assert.equal(result.error, undefined);
    const titleEvent = await waitFor(() => sentEvents.find((event) => event.payload?.type === 'topic-title'));
    const config = await manager.readAgentConfig(agentId);
    assert.equal(config.topics[0].name, '📘 非流式标题');
    assert.equal(titleEvent.payload.context.messageId, 'assistant-1');
    assert.match(titlePrompts[0], /\[1\] User:\n请讲一次函数/);
    assert.match(titlePrompts[0], /\[2\] Assistant:\n这是最终助手回复。/);
});

test('send-chat-request runs the topic title background task after direct stream end', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-stream-path-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'agent-title';
    const topicId = 'topic-1';
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '新对话 1' }],
    }, { spaces: 2 });

    let titleGenerationCount = 0;
    const chatClientStub = {
        initialize() {},
        async send(request) {
            if (request?.context?.source === 'topic-title-generation') {
                titleGenerationCount += 1;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '{"title":"📘 流式标题"}',
                            },
                        }],
                    },
                };
            }

            setTimeout(() => {
                request.onStreamEnd?.({
                    success: true,
                    content: '这是流式最终回复。',
                    finishReason: 'completed',
                    interrupted: false,
                    timedOut: false,
                });
            }, 0);
            return {
                streamingStarted: true,
                requestId: request.requestId,
                context: request.context,
                fallbackMeta: null,
            };
        },
    };
    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadMainHandlers(chatClientStub);
    t.after(async () => chatHandlers.shutdown());
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                    enableTopicTitleGeneration: true,
                    studyLogPolicy: { enabled: false },
                };
            },
        },
        agentConfigManager: manager,
        chatHistoryStore: {
            async close() {},
        },
    });

    const sentEvents = [];
    const sendChatRequest = handlers.get('send-chat-request');
    const result = await sendChatRequest(createSenderEvent(sentEvents), {
        requestId: 'assistant-1',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'secret',
        executionMode: 'direct-stream',
        messages: [{ role: 'user', content: '请讲斜率' }],
        modelConfig: { stream: true },
        context: {
            agentId,
            topicId,
            assistantMessageId: 'assistant-1',
        },
        backgroundTasks: {
            topicTitle: {
                enabled: true,
                expectedTopicName: '新对话 1',
            },
        },
    });

    assert.equal(result.streamingStarted, true);
    await waitFor(() => sentEvents.find((event) => event.payload?.type === 'topic-title'));
    const config = await manager.readAgentConfig(agentId);
    assert.equal(titleGenerationCount, 1);
    assert.equal(config.topics[0].name, '📘 流式标题');
});

test('send-chat-request does not run topic title generation after a cancelled direct stream', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-cancel-path-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'agent-title';
    const topicId = 'topic-1';
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '新对话 1' }],
    }, { spaces: 2 });

    let titleGenerationCount = 0;
    const chatClientStub = {
        initialize() {},
        async send(request) {
            if (request?.context?.source === 'topic-title-generation') {
                titleGenerationCount += 1;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '{"title":"📘 不应写入"}',
                            },
                        }],
                    },
                };
            }

            setTimeout(() => {
                request.onStreamEnd?.({
                    success: true,
                    content: '被取消前的部分回复。',
                    finishReason: 'cancelled_by_user',
                    interrupted: true,
                    timedOut: false,
                });
            }, 0);
            return {
                streamingStarted: true,
                requestId: request.requestId,
                context: request.context,
                fallbackMeta: null,
            };
        },
    };
    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadMainHandlers(chatClientStub);
    t.after(async () => chatHandlers.shutdown());
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                    enableTopicTitleGeneration: true,
                    studyLogPolicy: { enabled: false },
                };
            },
        },
        agentConfigManager: manager,
        chatHistoryStore: {
            async close() {},
        },
    });

    const sentEvents = [];
    const sendChatRequest = handlers.get('send-chat-request');
    const result = await sendChatRequest(createSenderEvent(sentEvents), {
        requestId: 'assistant-1',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'secret',
        executionMode: 'direct-stream',
        messages: [{ role: 'user', content: '请讲导数' }],
        modelConfig: { stream: true },
        context: {
            agentId,
            topicId,
            assistantMessageId: 'assistant-1',
        },
        backgroundTasks: {
            topicTitle: {
                enabled: true,
                expectedTopicName: '新对话 1',
            },
        },
    });

    assert.equal(result.streamingStarted, true);
    await delay(40);
    const config = await manager.readAgentConfig(agentId);
    assert.equal(titleGenerationCount, 0);
    assert.equal(config.topics[0].name, '新对话 1');
    assert.equal(sentEvents.some((event) => event.payload?.type === 'topic-title'), false);
});

test('topic title background task writes generated title and emits a topic-title event', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-bg-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const agentId = 'agent-title';
    const topicId = 'topic-1';
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '新对话 1' }],
    }, { spaces: 2 });

    const chatClientStub = {
        initialize() {},
        async send() {
            return {
                response: {
                    choices: [{
                        message: {
                            content: '{"title":"📘 线性函数复习"}',
                        },
                    }],
                },
            };
        },
    };
    const { chatHandlers } = loadMainHandlers(chatClientStub);
    const manager = new AgentConfigManager(agentDir);
    const sentEvents = [];
    const result = await chatHandlers.__testUtils.runTopicTitleBackgroundTask({
        task: {
            agentId,
            topicId,
            messageId: 'assistant-1',
            expectedTopicName: '新对话 1',
            model: 'chat-model',
            userMessage: { role: 'user', content: '请帮我复习线性函数' },
        },
        completion: {
            success: true,
            content: '我们先看斜率和截距。',
            finishReason: 'completed',
        },
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                };
            },
        },
        agentConfigManager: manager,
        webContents: {
            isDestroyed: () => false,
            send(channel, payload) {
                sentEvents.push({ channel, payload });
            },
        },
    });

    const config = await manager.readAgentConfig(agentId);
    assert.equal(result.persisted, true);
    assert.equal(config.topics[0].name, '📘 线性函数复习');
    assert.equal(sentEvents.length, 1);
    assert.equal(sentEvents[0].channel, 'chat-stream-event');
    assert.equal(sentEvents[0].payload.type, 'topic-title');
    assert.equal(sentEvents[0].payload.title, '📘 线性函数复习');
});

test('topic title background task does not overwrite a manually renamed topic', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-bg-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const agentId = 'agent-title';
    const topicId = 'topic-1';
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Title Agent',
        model: 'agent-model',
        topics: [{ id: topicId, name: '用户手动改名' }],
    }, { spaces: 2 });

    const { chatHandlers } = loadMainHandlers({
        initialize() {},
        async send() {
            return {
                response: {
                    choices: [{
                        message: {
                            content: '{"title":"📘 自动标题"}',
                        },
                    }],
                },
            };
        },
    });
    const manager = new AgentConfigManager(agentDir);
    const sentEvents = [];
    const result = await chatHandlers.__testUtils.runTopicTitleBackgroundTask({
        task: {
            agentId,
            topicId,
            messageId: 'assistant-1',
            expectedTopicName: '新对话 1',
            model: 'chat-model',
            userMessage: { role: 'user', content: '请解释牛顿第二定律' },
        },
        completion: {
            success: true,
            content: '力等于质量乘加速度。',
            finishReason: 'completed',
        },
        settingsManager: {
            async readSettings() {
                return {
                    chatEndpoint: 'http://example.com/v1/chat/completions',
                    chatApiKey: 'secret',
                };
            },
        },
        agentConfigManager: manager,
        webContents: {
            isDestroyed: () => false,
            send(channel, payload) {
                sentEvents.push({ channel, payload });
            },
        },
    });

    const config = await manager.readAgentConfig(agentId);
    assert.equal(result.persisted, false);
    assert.equal(config.topics[0].name, '用户手动改名');
    assert.equal(sentEvents.length, 0);
});

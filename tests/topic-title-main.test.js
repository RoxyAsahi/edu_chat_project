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

function loadMainHandlers(vcpClientStub = { initialize() {}, async send() { return {}; } }) {
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
            if (request === '../vcpClient') {
                return vcpClientStub;
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
    t.after(() => fs.remove(tempRoot));

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
    const vcpClientStub = {
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
    const { chatHandlers, handlers } = loadMainHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    topicTitleDefaultModel: 'topic-title-model',
                    defaultModel: 'global-model',
                    vcpServerUrl: 'http://example.com/v1/chat/completions',
                    vcpApiKey: 'secret',
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
    assert.equal(capturedRequest.modelConfig.model, 'topic-title-model');
    assert.match(capturedRequest.messages[0].content, /自定义标题模板/);
    assert.match(capturedRequest.messages[0].content, /\[1\] 用户:/);
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
                    vcpServerUrl: 'http://example.com/v1/chat/completions',
                    vcpApiKey: 'secret',
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

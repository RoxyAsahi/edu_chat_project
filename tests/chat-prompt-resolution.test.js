const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');
const {
    DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    DEFAULT_SETTINGS,
} = require('../src/modules/main/utils/settingsSchema');

const CHAT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/chatHandlers.js');

function loadChatHandlers(vcpClientStub) {
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
        return { chatHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

test('send-to-vcp resolves local prompt variables before calling the upstream client', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const dataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'lite_real_test_nova_001';
    const topicId = 'topic_1';

    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Lite Real Test Nova',
        systemPrompt: '我是{{Nova}}',
        topics: [{ id: topicId, name: '真实压力测试' }],
    }, { spaces: 2 });

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableAgentBubbleTheme: true,
                    agentBubbleThemePrompt: 'Custom bubble theme: {{VarDivRender}}',
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: manager,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    const result = await sendToVcp({ sender: {} }, {
        requestId: 'req_1',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '我是{{Nova}}' }],
        modelConfig: { stream: false },
        context: { agentId, agentName: 'Lite Real Test Nova', topicId },
    });

    assert.equal(result.ok, true);
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.messages[0].content.includes('{{Nova}}'), false);
    assert.equal(capturedRequest.messages[0].content.includes('我是Nova'), true);
    assert.equal(capturedRequest.messages[0].content.includes('Custom bubble theme:'), true);
    assert.equal(capturedRequest.messages[0].content.includes('{{VarDivRender}}'), false);
    assert.deepEqual(result.promptVariableResolution.unresolvedTokens, []);
    assert.equal(result.promptVariableResolution.substitutions.Nova, 'Nova');
});

test('send-to-vcp injects bundled emoticon prompt text before calling the upstream client', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-emoticon-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    const projectRoot = path.join(tempRoot, 'project-root');
    const bundledPackDir = path.join(projectRoot, '通用表情包');
    await fs.ensureDir(bundledPackDir);
    await fs.writeFile(path.join(bundledPackDir, '阿巴阿巴.jpg'), Buffer.from([255, 216, 255]));
    await fs.writeFile(path.join(bundledPackDir, '啊？.png'), Buffer.from([137, 80, 78, 71]));

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        PROJECT_ROOT: projectRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableEmoticonPrompt: true,
                    emoticonPrompt: 'Path {{GeneralEmoticonPath}}\nList {{GeneralEmoticonList}}',
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: null,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    const result = await sendToVcp({ sender: {} }, {
        requestId: 'req_emoticon_1',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '表情包说明：{{VarEmoticonPrompt}}' }],
        modelConfig: { stream: false },
        context: {},
    });

    assert.equal(result.ok, true);
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.messages[0].content.includes('{{VarEmoticonPrompt}}'), false);
    assert.match(capturedRequest.messages[0].content, /Path \/通用表情包/);
    assert.match(capturedRequest.messages[0].content, /阿巴阿巴.jpg\|啊？.png/);
    assert.equal((capturedRequest.messages[0].content.match(/Path \/通用表情包/g) || []).length, 1);
});

test('send-to-vcp auto-appends emoticon prompt when the base prompt does not reference emoticon variables', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-emoticon-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    const projectRoot = path.join(tempRoot, 'project-root');
    const bundledPackDir = path.join(projectRoot, '通用表情包');
    await fs.ensureDir(bundledPackDir);
    await fs.writeFile(path.join(bundledPackDir, '阿巴阿巴.jpg'), Buffer.from([255, 216, 255]));

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        PROJECT_ROOT: projectRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableEmoticonPrompt: true,
                    emoticonPrompt: 'Auto emoticon path {{GeneralEmoticonPath}}',
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: null,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    const result = await sendToVcp({ sender: {} }, {
        requestId: 'req_emoticon_auto',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '原始系统提示词' }],
        modelConfig: { stream: false },
        context: {},
    });

    assert.equal(result.ok, true);
    assert.ok(capturedRequest);
    assert.match(capturedRequest.messages[0].content, /原始系统提示词/);
    assert.match(capturedRequest.messages[0].content, /Auto emoticon path \/通用表情包/);
});

test('send-to-vcp skips bubble theme injection when the configured prompt is blank', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableAgentBubbleTheme: true,
                    agentBubbleThemePrompt: '   ',
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: null,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    await sendToVcp({ sender: {} }, {
        requestId: 'req_blank',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '原始系统提示词' }],
        modelConfig: { stream: false },
        context: {},
    });

    assert.ok(capturedRequest);
    assert.match(capturedRequest.messages[0].content, /原始系统提示词/);
    assert.match(capturedRequest.messages[0].content, /—— 日记 \(DailyNote\) ——/);
});

test('send-to-vcp skips bubble theme injection when the feature is disabled', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableAgentBubbleTheme: false,
                    agentBubbleThemePrompt: DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: null,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    await sendToVcp({ sender: {} }, {
        requestId: 'req_disabled',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '原始系统提示词' }],
        modelConfig: { stream: false },
        context: {},
    });

    assert.ok(capturedRequest);
    assert.match(capturedRequest.messages[0].content, /原始系统提示词/);
    assert.match(capturedRequest.messages[0].content, /—— 日记 \(DailyNote\) ——/);
});

test('send-to-vcp does not append the bubble theme prompt twice', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    let capturedRequest = null;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            capturedRequest = request;
            return { ok: true };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    userName: 'SmokeUser',
                    enableAgentBubbleTheme: true,
                    agentBubbleThemePrompt: DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
                    enableThoughtChainInjection: false,
                };
            },
        },
        agentConfigManager: null,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    await sendToVcp({ sender: {} }, {
        requestId: 'req_nodup',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{
            role: 'system',
            content: `原始系统提示词\n\n${DEFAULT_AGENT_BUBBLE_THEME_PROMPT}`,
        }],
        modelConfig: { stream: false },
        context: {},
    });

    assert.ok(capturedRequest);
    const matches = capturedRequest.messages[0].content.match(/Output formatting requirement:/g) || [];
    assert.equal(matches.length, 1);
});

test('send-to-vcp executes local DailyNote tool requests and returns tool metadata', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-prompt-resolution-'));
    t.after(() => fs.remove(tempRoot));

    const agentId = 'study_agent';
    const topicId = 'topic_math';
    const agentDir = path.join(tempRoot, 'agents');
    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), {
        id: agentId,
        name: 'Study Agent',
        systemPrompt: '请按需使用 {{StudyLogTool}}\n默认使用 StudyLog.write；兼容 DailyNote.create / DailyNote.update 文本块。',
        topics: [{ id: topicId, name: '高数复习' }],
    }, { spaces: 2 });

    let sendCount = 0;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            sendCount += 1;
            if (sendCount === 1) {
                capturedRequest = request;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: [
                                    '<<<[TOOL_REQUEST]>>>',
                                    'maid: 「始」[Nova]Nova「末」',
                                    'tool_name: 「始」DailyNote「末」',
                                    'command: 「始」create「末」',
                                    'Date: 「始」2026-04-14「末」',
                                    'Content: 「始」[19:30] 今天完成了导数复习，并整理了 3 道典型错题。\nTag: 高数, 导数「末」',
                                    'Tag: 「始」高数, 导数「末」',
                                    'archery: 「始」no_reply「末」',
                                    '<<<[END_TOOL_REQUEST]>>>',
                                ].join('\n'),
                            },
                        }],
                    },
                };
            }

            return {
                response: {
                    choices: [{
                        message: {
                            content: '已经记录今日学习日志，接下来建议继续做 3 道导数练习题。',
                        },
                    }],
                },
            };
        },
    };
    let capturedRequest = null;

    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    ...DEFAULT_SETTINGS,
                    userName: 'StudyUser',
                    studyProfile: {
                        studentName: 'Alice',
                        studyWorkspace: 'Dorm A-301',
                        workEnvironment: 'Laptop',
                        timezone: 'Asia/Hong_Kong',
                    },
                    studyLogPolicy: {
                        enabled: true,
                        maxToolRounds: 3,
                        memoryTopK: 2,
                        memoryFallbackTopK: 1,
                    },
                };
            },
        },
        agentConfigManager: manager,
    });

    const sendToVcp = handlers.get('send-to-vcp');
    const result = await sendToVcp({ sender: {} }, {
        requestId: 'req_tool_loop',
        endpoint: 'http://example.com/v1/chat/completions',
        apiKey: 'demo-key',
        messages: [{ role: 'system', content: '请按需使用 {{DailyNoteTool}}' }, { role: 'user', content: '帮我总结今天的学习。' }],
        modelConfig: { stream: false, model: 'demo-model' },
        context: {
            agentId,
            agentName: 'Study Agent',
            topicId,
            topicName: '高数复习',
            lastUserMessageId: 'user_1',
        },
    });

    assert.ok(capturedRequest);
    assert.equal(sendCount, 2);
    assert.equal(
        capturedRequest.messages.some((message) => typeof message.content === 'string' && message.content.includes('StudyLog.write')),
        false
    );
    assert.equal(Array.isArray(result.toolEvents), true);
    assert.equal(result.toolEvents.length, 1);
    assert.equal(result.toolEvents[0].success, true);
    assert.equal(result.toolEvents[0].toolName, 'DailyNote');
    assert.equal(result.toolEvents[0].command, 'create');
    assert.match(result.response.choices[0].message.content, /<<<\[TOOL_REQUEST\]>>>/);
    assert.match(result.response.choices[0].message.content, /tool_name:\s*「始」DailyNote「末」/);
    assert.match(result.response.choices[0].message.content, /已经记录今日学习日志/);

    const studyLogPath = path.join(tempRoot, 'app-data', 'StudyLogs', agentId, topicId, 'entries.json');
    const storedLogs = await fs.readJson(studyLogPath);
    assert.equal(storedLogs.length, 1);
    assert.match(storedLogs[0].contentMarkdown, /导数复习/);
    assert.equal(storedLogs[0].notebookName, 'Nova');
    assert.equal(storedLogs[0].requestedToolName, 'DailyNote');
});

test('follow-up helpers parse object, array, fenced, and invalid JSON responses safely', async () => {
    const { chatHandlers } = loadChatHandlers({ initialize() {} });
    const { parseFollowUpsResponse } = chatHandlers.__testUtils;

    assert.deepEqual(
        parseFollowUpsResponse('{"follow_ups":["继续讲一下","给我一个例题","继续讲一下","","  "]}'),
        ['继续讲一下', '给我一个例题']
    );
    assert.deepEqual(
        parseFollowUpsResponse('["下一步怎么做？","能再解释一下吗？"]'),
        ['下一步怎么做？', '能再解释一下吗？']
    );
    assert.deepEqual(
        parseFollowUpsResponse('```json\n{"follow_ups":["A","B"]}\n```'),
        ['A', 'B']
    );
    assert.deepEqual(parseFollowUpsResponse(''), []);
    assert.deepEqual(parseFollowUpsResponse('not-json'), []);
});

test('follow-up helpers trim to the latest visible turns and append chat history when the placeholder is missing', async () => {
    const { chatHandlers } = loadChatHandlers({ initialize() {} });
    const {
        buildFollowUpPrompt,
        selectVisibleFollowUpMessages,
    } = chatHandlers.__testUtils;

    const selected = selectVisibleFollowUpMessages([
        { role: 'system', content: 'ignore me' },
        { role: 'user', content: '问题 1' },
        { role: 'assistant', content: '回答 1' },
        { role: 'assistant', content: 'thinking', isThinking: true },
        { role: 'user', content: { text: '问题 2' } },
        { role: 'assistant', content: [{ type: 'text', text: '回答 2' }, { type: 'image_url' }] },
        { role: 'user', content: '问题 3' },
        { role: 'assistant', content: '回答 3' },
        { role: 'user', content: '问题 4' },
        { role: 'assistant', content: '回答 4' },
        { role: 'user', content: '问题 5' },
        { role: 'assistant', content: '回答 5' },
        { role: 'user', content: '问题 6' },
        { role: 'assistant', content: '回答 6' },
    ]);

    assert.equal(selected.length, 6);
    assert.deepEqual(
        selected.map((message) => message.content),
        ['问题 4', '回答 4', '问题 5', '回答 5', '问题 6', '回答 6']
    );

    const prompt = buildFollowUpPrompt('请输出追问建议。', selected);
    assert.match(prompt, /请输出追问建议。/);
    assert.match(prompt, /\[1\] 用户:\n问题 4/);
    assert.match(prompt, /\[6\] 助手:\n回答 6/);
});

test('follow-up helpers sanitize rich assistant content into readable prompt text', async () => {
    const { chatHandlers } = loadChatHandlers({ initialize() {} });
    const { sanitizeFollowUpText } = chatHandlers.__testUtils;

    const sanitized = sanitizeFollowUpText([
        '### 标题',
        '<div>正文<button>点我继续</button></div>',
        '<style>.danger { color: red; }</style>',
        '<<<[TOOL_REQUEST]>>>secret<<<[END_TOOL_REQUEST]>>>',
        `<div>${'内容'.repeat(600)}</div>`,
        '<div>结尾</div>',
    ].join('\n'));

    assert.doesNotMatch(sanitized, /TOOL_REQUEST|<div>|<style>/);
    assert.match(sanitized, /标题/);
    assert.match(sanitized, /正文/);
    assert.match(sanitized, /交互按钮：点我继续/);
    assert.match(sanitized, /\[工具调用已省略\]/);
    assert.match(sanitized, /\[\.\.\.省略\.\.\.\]/);
    assert.match(sanitized, /结尾/);
});

test('generate-follow-ups retries once when the first upstream reply is malformed JSON', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-follow-up-retry-'));
    t.after(() => fs.remove(tempRoot));

    const requests = [];
    let sendCount = 0;
    const vcpClientStub = {
        initialize() {},
        async send(request) {
            requests.push(request);
            sendCount += 1;

            if (sendCount === 1) {
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '{"follow_ups":["能不能帮我把今天学的内容',
                            },
                        }],
                    },
                };
            }

            return {
                response: {
                    choices: [{
                        message: {
                            content: '{"follow_ups":["继续讲一下","给我一个例子"]}',
                        },
                    }],
                },
            };
        },
    };

    const { chatHandlers, handlers } = loadChatHandlers(vcpClientStub);
    chatHandlers.initialize(null, {
        AGENT_DIR: path.join(tempRoot, 'agents'),
        USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        DATA_ROOT: path.join(tempRoot, 'app-data'),
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {
                    vcpServerUrl: 'http://example.com/v1/chat/completions',
                    vcpApiKey: 'demo-key',
                    followUpPromptTemplate: '',
                    defaultModel: 'fixture-model',
                };
            },
        },
        agentConfigManager: {
            async readAgentConfig() {
                return { model: 'agent-model' };
            },
        },
    });

    const generateFollowUps = handlers.get('generate-follow-ups');
    const result = await generateFollowUps({ sender: {} }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
        messages: [
            { role: 'user', content: '你知道怎么记日记吗' },
            {
                role: 'assistant',
                content: '<div>回答<button>查看往期记忆</button></div>\n<<<[TOOL_REQUEST]>>>debug<<<[END_TOOL_REQUEST]>>>',
            },
        ],
    });

    assert.deepEqual(result, {
        success: true,
        followUps: ['继续讲一下', '给我一个例子'],
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].modelConfig.model, 'agent-model');
    assert.equal(requests[0].round, 1);
    assert.equal(requests[1].round, 2);
    assert.deepEqual(requests[0].modelConfig.response_format, { type: 'json_object' });
    assert.equal(requests[0].modelConfig.max_tokens, 1200);
    assert.equal(requests[1].modelConfig.temperature, 0);
    assert.match(requests[1].messages[0].content, /请重新生成 3 条简短追问/);
    assert.doesNotMatch(requests[0].messages[0].content, /<div>|TOOL_REQUEST/);
    assert.match(requests[0].messages[0].content, /交互按钮：查看往期记忆/);
});

test('follow-up model resolution prefers dedicated task model, then agent config, then global default model, then requested model', async () => {
    const { chatHandlers } = loadChatHandlers({ initialize() {} });
    const { resolveFollowUpModel } = chatHandlers.__testUtils;

    assert.equal(
        await resolveFollowUpModel({
            agentId: 'agent-1',
            requestedModel: 'requested-model',
            settings: {
                followUpDefaultModel: 'follow-up-model',
                defaultModel: 'global-model',
            },
            agentConfigManager: {
                async readAgentConfig() {
                    return { model: 'agent-model' };
                },
            },
        }),
        'follow-up-model'
    );

    assert.equal(
        await resolveFollowUpModel({
            agentId: 'agent-1',
            requestedModel: 'requested-model',
            settings: { defaultModel: 'global-model' },
            agentConfigManager: {
                async readAgentConfig() {
                    return { model: 'agent-model' };
                },
            },
        }),
        'agent-model'
    );

    assert.equal(
        await resolveFollowUpModel({
            agentId: 'agent-1',
            requestedModel: 'requested-model',
            settings: { defaultModel: 'global-model' },
            agentConfigManager: {
                async readAgentConfig() {
                    return { model: '   ' };
                },
            },
        }),
        'global-model'
    );

    assert.equal(
        await resolveFollowUpModel({
            requestedModel: 'requested-model',
            settings: { defaultModel: '   ' },
            agentConfigManager: null,
        }),
        'requested-model'
    );

    assert.equal(
        await resolveFollowUpModel({
            requestedModel: '   ',
            settings: { defaultModel: '   ' },
            agentConfigManager: null,
        }),
        'gemini-3.1-flash-lite-preview'
    );
});

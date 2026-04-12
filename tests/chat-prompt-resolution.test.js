const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');

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
    assert.equal(capturedRequest.messages[0].content.includes('{{VarDivRender}}'), false);
    assert.deepEqual(result.promptVariableResolution.unresolvedTokens, []);
    assert.equal(result.promptVariableResolution.substitutions.Nova, 'Nova');
});

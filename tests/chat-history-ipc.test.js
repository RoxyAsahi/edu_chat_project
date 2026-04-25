const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');

const CHAT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/chatHandlers.js');

async function removeTempRootBestEffort(tempRoot) {
    try {
        await fs.remove(tempRoot);
    } catch (error) {
        if (error?.code !== 'EBUSY') {
            throw error;
        }
    }
}

function loadChatHandlers() {
    const handlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
        },
        dialog: {
            async showOpenDialog() {
                return { canceled: true, filePaths: [] };
            },
        },
        BrowserWindow: class BrowserWindow {},
    };
    const knowledgeBaseStub = {
        async deleteKnowledgeBase() {
            return true;
        },
    };
    const chatClientStub = {
        initialize() {},
        interrupt: async () => ({ success: true }),
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
            if (request === '../chatClient') {
                return chatClientStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const chatHandlers = require(CHAT_HANDLERS_PATH);
        return { chatHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

async function createHarness(t, config) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-chat-history-ipc-'));
    const agentDir = path.join(tempRoot, 'Agents');
    const userDataDir = path.join(tempRoot, 'UserData');
    const dataRoot = path.join(tempRoot, 'DataRoot');
    const agentId = 'agent-1';

    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), config, { spaces: 2 });

    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadChatHandlers();
    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: dataRoot,
        fileWatcher: {
            signalInternalSave() {},
            stopWatching() {},
        },
        settingsManager: {
            async readSettings() {
                return {};
            },
        },
        agentConfigManager: manager,
    });

    t.after(async () => {
        await chatHandlers.shutdown();
        await removeTempRootBestEffort(tempRoot);
    });

    return {
        agentDir,
        agentId,
        dataRoot,
        handlers,
        historyPath: (topicId) => path.join(userDataDir, agentId, 'topics', topicId, 'history.json'),
        userDataDir,
    };
}

test('chat history IPC keeps full-history compatibility while writing to libSQL', async (t) => {
    const harness = await createHarness(t, {
        topics: [{ id: 'topic-1', name: 'Topic 1', unread: false }],
    });
    const history = [
        { id: 'u1', role: 'user', content: 'Hello DB', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Stored in libSQL', timestamp: 2 },
    ];

    const saveChatHistory = harness.handlers.get('save-chat-history');
    const getChatHistory = harness.handlers.get('get-chat-history');
    const getChatHistoryPage = harness.handlers.get('get-chat-history-page');
    const getOriginalMessageContent = harness.handlers.get('get-original-message-content');

    assert.deepEqual(await saveChatHistory(null, harness.agentId, 'topic-1', history), { success: true });
    assert.equal(await fs.pathExists(harness.historyPath('topic-1')), false);
    assert.ok(await fs.pathExists(path.join(harness.dataRoot, 'ChatHistory', 'chat-history.db')));

    assert.deepEqual(await getChatHistory(null, harness.agentId, 'topic-1'), history);
    assert.deepEqual(await getChatHistoryPage(null, harness.agentId, 'topic-1', { limit: 1 }), {
        success: true,
        messages: [history[1]],
        hasMore: true,
        nextBefore: 1,
    });
    assert.deepEqual(
        await getOriginalMessageContent(null, harness.agentId, 'agent', 'topic-1', 'a1'),
        { success: true, content: 'Stored in libSQL' },
    );
});

test('chat history IPC migrates legacy JSON for search and uses DB summaries for unread counts', async (t) => {
    const harness = await createHarness(t, {
        topics: [
            { id: 'legacy-topic', name: 'Legacy Topic', unread: false },
            { id: 'assistant-only', name: 'Assistant Only', unread: false },
            { id: 'manual-unread', name: 'Manual Unread', unread: true },
        ],
    });

    await fs.ensureDir(path.dirname(harness.historyPath('legacy-topic')));
    await fs.writeJson(harness.historyPath('legacy-topic'), [
        { id: 'legacy-1', role: 'user', content: 'Newton search target', timestamp: 1 },
    ], { spaces: 2 });

    const saveChatHistory = harness.handlers.get('save-chat-history');
    await saveChatHistory(null, harness.agentId, 'assistant-only', [
        { id: 'assistant-1', role: 'assistant', content: 'Ping without user reply', timestamp: 2 },
    ]);
    await saveChatHistory(null, harness.agentId, 'manual-unread', [
        { id: 'manual-1', role: 'user', content: 'Manual marker only', timestamp: 3 },
    ]);

    const searchTopicsByContent = harness.handlers.get('search-topics-by-content');
    assert.deepEqual(
        await searchTopicsByContent(null, harness.agentId, 'agent', 'newton'),
        { success: true, matchedTopicIds: ['legacy-topic'] },
    );

    const getUnreadTopicCounts = harness.handlers.get('get-unread-topic-counts');
    assert.deepEqual(await getUnreadTopicCounts(), {
        success: true,
        counts: {
            [harness.agentId]: 1,
        },
    });
});

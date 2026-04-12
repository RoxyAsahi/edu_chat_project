const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');

const CHAT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/chatHandlers.js');

function loadChatHandlers() {
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
    const knowledgeBaseStub = {
        async deleteKnowledgeBase() {
            return true;
        },
    };
    const vcpClientStub = {
        initialize() {},
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
            return originalLoad.call(this, request, parent, isMain);
        };

        const chatHandlers = require(CHAT_HANDLERS_PATH);
        return { chatHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

async function createHarness(config) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-chat-config-'));
    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');
    const appDataRoot = path.join(tempRoot, 'app-data');
    const agentId = 'agent-topic';
    const topicId = 'topic-1';

    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), config, { spaces: 2 });

    const manager = new AgentConfigManager(agentDir);
    const { chatHandlers, handlers } = loadChatHandlers();

    chatHandlers.initialize(null, {
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: appDataRoot,
        fileWatcher: null,
        settingsManager: {
            async readSettings() {
                return {};
            },
        },
        agentConfigManager: manager,
    });

    return {
        agentDir,
        agentId,
        cleanup: () => fs.remove(tempRoot),
        handlers,
        manager,
        topicId,
    };
}

async function readTopic(manager, agentId, topicId) {
    const config = await manager.readAgentConfig(agentId);
    return config.topics.find((topic) => topic.id === topicId);
}

test('toggle-topic-lock only changes the locked flag in manager mode', async (t) => {
    const harness = await createHarness({
        topics: [{
            id: 'topic-1',
            name: 'Topic 1',
            locked: true,
            unread: true,
            knowledgeBaseId: 'kb-1',
            creatorSource: 'seed',
        }],
    });
    t.after(harness.cleanup);

    const toggleTopicLock = harness.handlers.get('toggle-topic-lock');
    const result = await toggleTopicLock(null, harness.agentId, harness.topicId);
    const topic = await readTopic(harness.manager, harness.agentId, harness.topicId);

    assert.deepEqual(result, {
        success: true,
        locked: false,
        message: 'Topic unlocked.',
    });
    assert.deepEqual(topic, {
        id: 'topic-1',
        name: 'Topic 1',
        locked: false,
        unread: true,
        knowledgeBaseId: 'kb-1',
        creatorSource: 'seed',
    });
});

test('set-topic-unread only changes the unread flag in manager mode', async (t) => {
    const harness = await createHarness({
        topics: [{
            id: 'topic-1',
            name: 'Topic 1',
            locked: false,
            unread: false,
            knowledgeBaseId: 'kb-2',
            creatorSource: 'seed',
        }],
    });
    t.after(harness.cleanup);

    const setTopicUnread = harness.handlers.get('set-topic-unread');
    const result = await setTopicUnread(null, harness.agentId, harness.topicId, true);
    const topic = await readTopic(harness.manager, harness.agentId, harness.topicId);

    assert.deepEqual(result, {
        success: true,
        unread: true,
    });
    assert.deepEqual(topic, {
        id: 'topic-1',
        name: 'Topic 1',
        locked: false,
        unread: true,
        knowledgeBaseId: 'kb-2',
        creatorSource: 'seed',
    });
});

test('manager mode preserves compatibility defaults for missing topic flags', async (t) => {
    const toggleHarness = await createHarness({
        topics: [{
            id: 'topic-1',
            name: 'Topic 1',
            unread: true,
            knowledgeBaseId: 'kb-compat',
        }],
    });
    t.after(toggleHarness.cleanup);

    const toggleTopicLock = toggleHarness.handlers.get('toggle-topic-lock');
    const toggleResult = await toggleTopicLock(null, toggleHarness.agentId, toggleHarness.topicId);
    const toggledTopic = await readTopic(toggleHarness.manager, toggleHarness.agentId, toggleHarness.topicId);

    assert.deepEqual(toggleResult, {
        success: true,
        locked: false,
        message: 'Topic unlocked.',
    });
    assert.equal(toggledTopic.locked, false);
    assert.equal(toggledTopic.unread, true);

    const unreadHarness = await createHarness({
        topics: [{
            id: 'topic-1',
            name: 'Topic 1',
            locked: true,
            knowledgeBaseId: 'kb-compat',
        }],
    });
    t.after(unreadHarness.cleanup);

    const setTopicUnread = unreadHarness.handlers.get('set-topic-unread');
    const unreadResult = await setTopicUnread(null, unreadHarness.agentId, unreadHarness.topicId, true);
    const unreadTopic = await readTopic(unreadHarness.manager, unreadHarness.agentId, unreadHarness.topicId);

    assert.deepEqual(unreadResult, {
        success: true,
        unread: true,
    });
    assert.equal(unreadTopic.locked, true);
    assert.equal(unreadTopic.unread, true);
});

test('manager mode keeps current error semantics for invalid topic state', async (t) => {
    const unavailableHarness = await createHarness({
        topics: {},
    });
    t.after(unavailableHarness.cleanup);

    const toggleTopicLock = unavailableHarness.handlers.get('toggle-topic-lock');
    const unavailableResult = await toggleTopicLock(null, unavailableHarness.agentId, unavailableHarness.topicId);
    assert.deepEqual(unavailableResult, {
        success: false,
        error: 'Topics are unavailable for this agent.',
    });

    const missingHarness = await createHarness({
        topics: [{
            id: 'topic-other',
            name: 'Other Topic',
            locked: true,
            unread: false,
        }],
    });
    t.after(missingHarness.cleanup);

    const setTopicUnread = missingHarness.handlers.get('set-topic-unread');
    const missingResult = await setTopicUnread(null, missingHarness.agentId, missingHarness.topicId, true);
    assert.deepEqual(missingResult, {
        success: false,
        error: `Topic not found: ${missingHarness.topicId}`,
    });
});

test('concurrent manager updates do not lose topic changes', async (t) => {
    const harness = await createHarness({
        topics: [{
            id: 'topic-1',
            name: 'Topic 1',
            locked: true,
            unread: false,
            knowledgeBaseId: 'kb-race',
            creatorSource: 'seed',
        }],
    });
    t.after(harness.cleanup);

    const toggleTopicLock = harness.handlers.get('toggle-topic-lock');
    const setTopicUnread = harness.handlers.get('set-topic-unread');

    const [toggleResult, unreadResult] = await Promise.all([
        toggleTopicLock(null, harness.agentId, harness.topicId),
        setTopicUnread(null, harness.agentId, harness.topicId, true),
    ]);
    const topic = await readTopic(harness.manager, harness.agentId, harness.topicId);

    assert.deepEqual(toggleResult, {
        success: true,
        locked: false,
        message: 'Topic unlocked.',
    });
    assert.deepEqual(unreadResult, {
        success: true,
        unread: true,
    });
    assert.deepEqual(topic, {
        id: 'topic-1',
        name: 'Topic 1',
        locked: false,
        unread: true,
        knowledgeBaseId: 'kb-race',
        creatorSource: 'seed',
    });
});

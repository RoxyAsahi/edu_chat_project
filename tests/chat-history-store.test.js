const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { createClient } = require('@libsql/client');

const { createChatHistoryStore } = require('../src/modules/main/chat-history/store');

async function removeTempRootBestEffort(tempRoot) {
    try {
        await fs.remove(tempRoot);
    } catch (error) {
        if (error?.code !== 'EBUSY') {
            throw error;
        }
    }
}

async function createStoreHarness(t) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-chat-history-store-'));
    const store = createChatHistoryStore({ dataRoot: tempRoot });

    t.after(async () => {
        await store.close();
        await removeTempRootBestEffort(tempRoot);
    });

    return {
        store,
        tempRoot,
    };
}

test('chat history store initializes empty topics without reading JSON history files', async (t) => {
    const { store, tempRoot } = await createStoreHarness(t);

    assert.deepEqual(await store.getHistory('agent-1', 'topic-1'), []);
    assert.ok(await fs.pathExists(path.join(tempRoot, 'ChatHistory', 'chat-history.db')));

    const state = await store.getTopicState('agent-1', 'topic-1');
    assert.equal(Number(state.message_count), 0);
});

test('chat history store repairs topic state schema created before initialized_at', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-chat-history-schema-repair-'));
    const dbDir = path.join(tempRoot, 'ChatHistory');
    const dbPath = path.join(dbDir, 'chat-history.db');
    await fs.ensureDir(dbDir);

    const db = createClient({ url: `file:${dbPath}` });
    await db.execute(`CREATE TABLE chat_topic_state (
        agent_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        migrated_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, topic_id)
    )`);
    await db.execute({
        sql: `INSERT INTO chat_topic_state (agent_id, topic_id, migrated_at, message_count, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
        args: ['agent-1', 'topic-1', 12345, 0, 12345],
    });
    if (typeof db.close === 'function') {
        await db.close();
    }

    const store = createChatHistoryStore({ dataRoot: tempRoot });
    t.after(async () => {
        await store.close();
        await removeTempRootBestEffort(tempRoot);
    });

    const state = await store.getTopicState('agent-1', 'topic-1');
    assert.equal(Number(state.initialized_at), 12345);

    await store.replaceHistory('agent-1', 'topic-1', [
        { id: 'm1', role: 'user', content: 'schema repaired' },
    ]);
    assert.equal((await store.getHistory('agent-1', 'topic-1')).length, 1);
});

test('chat history store replaces full histories and returns stable pages', async (t) => {
    const { store } = await createStoreHarness(t);
    const history = [
        { id: 'm1', role: 'user', content: 'one', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'two', timestamp: 2 },
        { id: 'm3', role: 'user', content: 'three', timestamp: 3 },
    ];

    await store.replaceHistory('agent-1', 'topic-1', history);
    assert.deepEqual(await store.getHistory('agent-1', 'topic-1'), history);

    const firstPage = await store.getHistoryPage('agent-1', 'topic-1', { limit: 2 });
    assert.equal(firstPage.success, true);
    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(firstPage.messages.map((message) => message.id), ['m2', 'm3']);

    const secondPage = await store.getHistoryPage('agent-1', 'topic-1', {
        before: firstPage.nextBefore,
        limit: 2,
    });
    assert.equal(secondPage.hasMore, false);
    assert.deepEqual(secondPage.messages.map((message) => message.id), ['m1']);

    await store.replaceHistory('agent-1', 'topic-1', [history[0]]);
    assert.deepEqual(
        (await store.getHistory('agent-1', 'topic-1')).map((message) => message.id),
        ['m1'],
    );
});

test('chat history store searches content and summarizes unread activation from queryable columns', async (t) => {
    const { store } = await createStoreHarness(t);

    await store.replaceHistory('agent-1', 'topic-1', [
        { id: 'u1', role: 'user', content: 'Alpha % literal marker', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Reply', timestamp: 2 },
    ]);
    await store.replaceHistory('agent-1', 'topic-2', [
        { id: 'a2', role: 'assistant', content: 'Only assistant', timestamp: 3 },
    ]);

    assert.deepEqual(
        await store.findTopicIdsByContent('agent-1', ['topic-1', 'topic-2'], 'alpha %'),
        ['topic-1'],
    );

    assert.deepEqual(await store.getUnreadSummary('agent-1', 'topic-1'), {
        nonSystemCount: 2,
        assistantCount: 1,
        shouldActivateCount: false,
    });
    assert.deepEqual(await store.getUnreadSummary('agent-1', 'topic-2'), {
        nonSystemCount: 1,
        assistantCount: 1,
        shouldActivateCount: true,
    });
});

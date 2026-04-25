const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

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
        legacyPath: (agentId, topicId) => path.join(tempRoot, 'UserData', agentId, 'topics', topicId, 'history.json'),
        store,
        tempRoot,
    };
}

test('chat history store migrates legacy JSON once and preserves read order', async (t) => {
    const { legacyPath, store, tempRoot } = await createStoreHarness(t);
    const historyPath = legacyPath('agent-1', 'topic-1');
    const originalHistory = [
        { id: 'user-1', role: 'user', content: 'Hello', timestamp: 1 },
        { id: 'assistant-1', role: 'assistant', content: 'Hi', timestamp: 2 },
    ];

    await fs.ensureDir(path.dirname(historyPath));
    await fs.writeJson(historyPath, originalHistory, { spaces: 2 });

    assert.deepEqual(
        await store.getHistory('agent-1', 'topic-1', { legacyHistoryPath: historyPath }),
        originalHistory,
    );
    assert.ok(await fs.pathExists(path.join(tempRoot, 'ChatHistory', 'chat-history.db')));

    await fs.writeJson(historyPath, [
        { id: 'user-new', role: 'user', content: 'Should not reimport', timestamp: 3 },
    ]);

    assert.deepEqual(
        await store.getHistory('agent-1', 'topic-1', { legacyHistoryPath: historyPath }),
        originalHistory,
    );

    const state = await store.getTopicState('agent-1', 'topic-1');
    assert.equal(Number(state.message_count), 2);
});

test('chat history store marks missing legacy topics as empty to avoid repeated import checks', async (t) => {
    const { legacyPath, store } = await createStoreHarness(t);
    const historyPath = legacyPath('agent-1', 'empty-topic');

    assert.deepEqual(
        await store.getHistory('agent-1', 'empty-topic', { legacyHistoryPath: historyPath }),
        [],
    );

    await fs.ensureDir(path.dirname(historyPath));
    await fs.writeJson(historyPath, [
        { id: 'late-message', role: 'user', content: 'Late legacy write', timestamp: 1 },
    ]);

    assert.deepEqual(
        await store.getHistory('agent-1', 'empty-topic', { legacyHistoryPath: historyPath }),
        [],
    );
    const state = await store.getTopicState('agent-1', 'empty-topic');
    assert.equal(Number(state.message_count), 0);
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

test('chat history store falls back on corrupt legacy JSON and can migrate after the file is fixed', async (t) => {
    const { legacyPath, store } = await createStoreHarness(t);
    const historyPath = legacyPath('agent-1', 'topic-1');

    await fs.ensureDir(path.dirname(historyPath));
    await fs.writeFile(historyPath, '{not-valid-json', 'utf8');

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        assert.deepEqual(
            await store.getHistory('agent-1', 'topic-1', { legacyHistoryPath: historyPath }),
            [],
        );
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(await store.getTopicState('agent-1', 'topic-1'), null);

    const fixedHistory = [{ id: 'fixed', role: 'user', content: 'Recovered', timestamp: 1 }];
    await fs.writeJson(historyPath, fixedHistory, { spaces: 2 });

    assert.deepEqual(
        await store.getHistory('agent-1', 'topic-1', { legacyHistoryPath: historyPath }),
        fixedHistory,
    );
});

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const NOTES_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/notesHandlers.js');

function loadNotesHandlers() {
    const handlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(NOTES_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const notesHandlers = require(NOTES_HANDLERS_PATH);
        return { notesHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

test('notes IPC persists valid render snapshots and strips unsafe fields', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-notes-snapshot-'));
    const { notesHandlers, handlers } = loadNotesHandlers();
    notesHandlers.initialize({
        DATA_ROOT: tempRoot,
        agentConfigManager: {
            readAgentConfig: async () => ({ topics: [{ id: 'topic-1' }] }),
        },
    });
    t.after(async () => {
        await fs.remove(tempRoot);
    });

    const saveTopicNote = handlers.get('save-topic-note');
    const listTopicNotes = handlers.get('list-topic-notes');
    const snapshot = {
        schemaVersion: 1,
        renderer: 'unistudy-message-renderer',
        sourceMessageId: 'msg-1',
        role: 'assistant',
        contentHtml: '<div onclick="evil()"><script>alert(1)</script><a href="javascript:alert(2)">Saved</a></div>',
        styleText: '@import url("https://example.test/x.css"); #scope-1 .bubble { color: red; }',
        scopeId: 'scope-1',
        plainText: 'Saved',
        capturedAt: 10,
        extra: 'drop-me',
    };

    const saved = await saveTopicNote(null, 'agent-1', 'topic-1', {
        title: '收藏',
        contentMarkdown: '<div>source</div>',
        renderSnapshot: snapshot,
    });

    assert.equal(saved.success, true);
    assert.equal(saved.item.renderSnapshot.renderer, 'unistudy-message-renderer');
    assert.equal(saved.item.renderSnapshot.extra, undefined);
    assert.doesNotMatch(saved.item.renderSnapshot.contentHtml, /<script/i);
    assert.doesNotMatch(saved.item.renderSnapshot.contentHtml, /onclick=/i);
    assert.doesNotMatch(saved.item.renderSnapshot.contentHtml, /javascript:/i);
    assert.doesNotMatch(saved.item.renderSnapshot.styleText, /@import/i);

    const renamed = await saveTopicNote(null, 'agent-1', 'topic-1', {
        id: saved.item.id,
        title: '只改标题',
        contentMarkdown: '<div>source</div>',
    });

    assert.equal(renamed.success, true);
    assert.equal(renamed.item.renderSnapshot.contentHtml, saved.item.renderSnapshot.contentHtml);

    const cleared = await saveTopicNote(null, 'agent-1', 'topic-1', {
        id: saved.item.id,
        title: '正文改过',
        contentMarkdown: 'new body',
        renderSnapshot: null,
    });

    assert.equal(cleared.success, true);
    assert.equal(cleared.item.renderSnapshot, null);

    const listed = await listTopicNotes(null, 'agent-1', 'topic-1');
    assert.equal(listed.success, true);
    assert.equal(listed.items[0].renderSnapshot, null);
});

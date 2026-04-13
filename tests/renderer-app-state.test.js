const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', relativePath);
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('createInitialAppState includes manual notes library state default', async () => {
    const { createInitialAppState } = await loadModule('src/modules/renderer/app/store/appStore.js');

    const state = createInitialAppState();

    assert.equal(state.notes.manualNotesLibraryOpen, false);
    assert.equal(state.notes.notesStudioView, 'overview');
    assert.deepEqual(state.notes.topicNotes, []);
    assert.deepEqual(state.notes.agentNotes, []);
});

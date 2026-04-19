const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadAppStoreModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/store/appStore.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('createInitialAppState groups renderer state into the expected slices', async () => {
    const { createInitialAppState } = await loadAppStoreModule();

    const state = createInitialAppState();

    assert.deepEqual(Object.keys(state), [
        'settings',
        'layout',
        'session',
        'source',
        'reader',
        'notes',
        'logs',
        'composer',
    ]);
    assert.equal(state.settings.settings.currentThemeMode, 'system');
    assert.equal(state.settings.settings.agentBubbleThemePrompt, 'Output formatting requirement: {{VarDivRender}}');
    assert.equal(state.settings.settings.enableEmoticonPrompt, true);
    assert.equal(state.settings.settings.studyProfile.timezone, 'Asia/Hong_Kong');
    assert.equal(state.layout.sidePanelTab, 'notes');
    assert.equal(state.session.currentTopicId, null);
    assert.equal(state.source.selectedKnowledgeBaseId, null);
    assert.equal(state.notes.notesScope, 'topic');
    assert.equal(state.logs.scope, 'topic');
    assert.equal(state.composer.activeRequestId, null);
});

test('appStore patchState and subscribe operate on slices and reject unknown slices', async () => {
    const { createAppStore, createInitialAppState } = await loadAppStoreModule();

    const store = createAppStore(createInitialAppState());
    const seen = [];
    const unsubscribe = store.subscribe('session', (slice) => {
        seen.push(slice.currentTopicId);
    });

    store.patchState('session', { currentTopicId: 'topic-1' });
    store.patchState('session', (current) => ({
        ...current,
        currentTopicId: 'topic-2',
    }));
    unsubscribe();
    store.patchState('session', { currentTopicId: 'topic-3' });

    assert.deepEqual(seen, ['topic-1', 'topic-2']);
    assert.equal(store.getState().session.currentTopicId, 'topic-3');
    assert.throws(
        () => store.patchState('missing', {}),
        /Unknown app store slice/
    );
    assert.throws(
        () => store.subscribe('missing', () => {}),
        /Unknown app store slice/
    );
});

test('appStore no longer exports flat-state compatibility mappings', async () => {
    const appStoreModule = await loadAppStoreModule();

    assert.equal('FLAT_STATE_PROPERTY_PATHS' in appStoreModule, false);
});

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadAppStoreModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/store/appStore.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

async function loadStoreViewModule() {
    const appStorePath = path.resolve(__dirname, '../src/modules/renderer/app/store/appStore.js');
    const storeViewPath = path.resolve(__dirname, '../src/modules/renderer/app/store/storeView.js');
    const appStoreSource = await fs.readFile(appStorePath, 'utf8');
    let storeViewSource = await fs.readFile(storeViewPath, 'utf8');

    storeViewSource = storeViewSource.replace(
        /^import\s+\{\s*FLAT_STATE_PROPERTY_PATHS,\s*SLICE_NAMES\s*\}\s+from\s+['"].+appStore\.js['"];\r?\n/m,
        `${appStoreSource}\n`
    );

    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(storeViewSource)}`);
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
        'composer',
    ]);
    assert.equal(state.settings.settings.currentThemeMode, 'system');
    assert.equal(state.layout.sidePanelTab, 'notes');
    assert.equal(state.session.currentTopicId, null);
    assert.equal(state.source.selectedKnowledgeBaseId, null);
    assert.equal(state.notes.notesScope, 'topic');
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

test('createStoreView exposes flat state properties while routing writes through slices', async () => {
    const { createAppStore, createInitialAppState } = await loadAppStoreModule();
    const { createStoreView } = await loadStoreViewModule();

    const store = createAppStore(createInitialAppState());
    const state = createStoreView(store, {
        writableSlices: ['session', 'composer'],
    });

    state.currentSelectedItem.id = 'agent-1';
    state.currentTopicId = 'topic-1';
    state.currentChatHistory.push({ id: 'm-1', role: 'user', content: 'hello' });
    state.activeRequestId = 'req-1';

    assert.equal(store.getState().session.currentSelectedItem.id, 'agent-1');
    assert.equal(store.getState().session.currentTopicId, 'topic-1');
    assert.deepEqual(store.getState().session.currentChatHistory, [
        { id: 'm-1', role: 'user', content: 'hello' },
    ]);
    assert.equal(store.getState().composer.activeRequestId, 'req-1');
    assert.throws(
        () => {
            state.selectedKnowledgeBaseId = 'kb-1';
        },
        /Cannot mutate/
    );
});

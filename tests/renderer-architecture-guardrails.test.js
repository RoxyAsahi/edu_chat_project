const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function readRepoFile(relativePath) {
    return fs.readFile(path.resolve(__dirname, '..', relativePath), 'utf8');
}

async function loadAppStoreModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/store/appStore.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('renderer entry stays within PR4 guardrails and does not cache mutable app state', async () => {
    const rendererSource = await readRepoFile('src/renderer/renderer.js');
    const rendererLines = rendererSource.split(/\r?\n/).length;

    assert.ok(rendererLines <= 900, `renderer.js should stay <= 900 lines, received ${rendererLines}`);
    assert.doesNotMatch(rendererSource, /\bconst\s+state\s*=\s*(?:appStore|store)\.getState\(/);
    assert.doesNotMatch(rendererSource, /\blet\s+state\s*=\s*(?:appStore|store)\.getState\(/);
    assert.doesNotMatch(rendererSource, /createStoreView\s*\(/);
    assert.match(rendererSource, /store\.subscribe\('settings'/);
    assert.match(rendererSource, /store\.subscribe\('session'/);
    assert.match(rendererSource, /store\.subscribe\('source'/);
    assert.match(rendererSource, /store\.subscribe\('composer'/);
});

test('shell controllers converge on direct store access instead of the flat-state compatibility proxy', async () => {
    const expectedFiles = [
        'src/modules/renderer/app/bootstrap.js',
        'src/modules/renderer/app/layout/layoutController.js',
        'src/modules/renderer/app/settings/settingsController.js',
        'src/modules/renderer/app/workspace/workspaceController.js',
    ];

    for (const relativePath of expectedFiles) {
        const source = await readRepoFile(relativePath);
        assert.doesNotMatch(source, /import\s+\{\s*createStoreView\s*\}/, `${relativePath} should not import createStoreView`);
        assert.match(source, /store\.getState\(/, `${relativePath} should read slices directly from store`);
        assert.match(source, /store\.patchState\(/, `${relativePath} should patch slices directly through store`);
    }
});

test('renderer controllers keep single-slice writable ownership where storeView remains in use', async () => {
    const expectedOwnership = new Map([
        ['src/modules/renderer/app/composer/composerController.js', 'composer'],
        ['src/modules/renderer/app/flashcards/flashcardController.js', 'notes'],
        ['src/modules/renderer/app/notes/notesController.js', 'notes'],
        ['src/modules/renderer/app/reader/readerController.js', 'reader'],
        ['src/modules/renderer/app/source/sourceController.js', 'source'],
    ]);

    for (const [relativePath, expectedSlice] of expectedOwnership.entries()) {
        const source = await readRepoFile(relativePath);
        const match = source.match(/writableSlices:\s*\[([^\]]*)\]/);
        assert.ok(match, `${relativePath} should declare writableSlices`);

        const slices = Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1]);
        assert.deepEqual(
            slices,
            [expectedSlice],
            `${relativePath} should only write the ${expectedSlice} slice`,
        );
    }
});

test('flat-state storeView mapping stays frozen until the compatibility layer is retired', async () => {
    const { FLAT_STATE_PROPERTY_PATHS } = await loadAppStoreModule();

    assert.deepEqual(
        Object.keys(FLAT_STATE_PROPERTY_PATHS).sort(),
        [
            'activeFlashcardNoteId',
            'activeNoteId',
            'activeNoteMenu',
            'activeRequestId',
            'activeResizeHandle',
            'activeSourceFileMenu',
            'activeTopicMenu',
            'activeVerticalResizeHandle',
            'agents',
            'currentChatHistory',
            'currentSelectedItem',
            'currentTopicId',
            'knowledgeBaseDebugResult',
            'knowledgeBaseDocuments',
            'knowledgeBases',
            'layoutInitialized',
            'layoutLeftTopHeight',
            'layoutLeftWidth',
            'layoutRightWidth',
            'leftReaderActiveTab',
            'leftSidebarMode',
            'noteDetailKind',
            'notesScope',
            'notesStudioView',
            'pendingAttachments',
            'pendingFlashcardGeneration',
            'pendingSelectionContextRefs',
            'promptModule',
            'reader',
            'rightPanelMode',
            'selectedKnowledgeBaseId',
            'selectedNoteIds',
            'settings',
            'settingsModalSection',
            'sidePanelTab',
            'sourceListScrollTop',
            'topicKnowledgeBaseDocuments',
            'topicNotes',
            'topics',
            'agentNotes',
        ].sort(),
    );
});

test('package scripts expose renderer logic and dom checks under renderer-specific names', async () => {
    const packageJson = JSON.parse(await readRepoFile('package.json'));

    assert.equal(
        packageJson.scripts['test:renderer'],
        'npm run test:renderer:logic && npm run test:renderer:dom',
    );
    assert.equal(
        packageJson.scripts['test:renderer:logic'],
        'node --test tests/renderer-*.test.js',
    );
    assert.equal(
        packageJson.scripts['test:renderer:dom'],
        'vitest run --environment jsdom tests/renderer/safe-html.test.js',
    );
});

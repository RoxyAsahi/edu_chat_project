const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function readRepoFile(relativePath) {
    return fs.readFile(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('renderer entry stays within PR4 guardrails and does not cache mutable app state', async () => {
    const rendererSource = await readRepoFile('src/renderer/renderer.js');
    assert.doesNotMatch(rendererSource, /\bconst\s+state\s*=\s*(?:appStore|store)\.getState\(/);
    assert.doesNotMatch(rendererSource, /\blet\s+state\s*=\s*(?:appStore|store)\.getState\(/);
    assert.doesNotMatch(rendererSource, /createStoreView\s*\(/);
    assert.match(rendererSource, /store\.subscribe\('settings'/);
    assert.match(rendererSource, /store\.subscribe\('session'/);
    assert.match(rendererSource, /store\.subscribe\('source'/);
    assert.match(rendererSource, /store\.subscribe\('composer'/);
});

test('renderer controllers stay off the retired storeView compatibility path', async () => {
    const convergedControllers = [
        'src/modules/renderer/app/layout/layoutController.js',
        'src/modules/renderer/app/settings/settingsController.js',
        'src/modules/renderer/app/workspace/workspaceController.js',
        'src/modules/renderer/app/composer/composerController.js',
        'src/modules/renderer/app/flashcards/flashcardController.js',
        'src/modules/renderer/app/notes/notesController.js',
        'src/modules/renderer/app/reader/readerController.js',
        'src/modules/renderer/app/source/sourceController.js',
    ];

    for (const relativePath of convergedControllers) {
        const source = await readRepoFile(relativePath);
        assert.doesNotMatch(
            source,
            /createStoreView\s*\(/,
            `${relativePath} should stay off the retired storeView path`,
        );
    }
});

test('storeView compatibility files stay retired once ownership convergence lands', async () => {
    await assert.rejects(
        () => fs.access(path.resolve(__dirname, '../src/modules/renderer/app/store/storeView.js')),
        /ENOENT/,
    );
});

test('renderer global surface stays within the three approved bridges', async () => {
    const rendererSource = await readRepoFile('src/renderer/renderer.js');
    const messageRendererSource = await readRepoFile('src/modules/renderer/messageRenderer.js');
    const streamManagerSource = await readRepoFile('src/modules/renderer/streamManager.js');

    assert.match(rendererSource, /window\.sendMessage\s*=/);
    assert.match(rendererSource, /window\.updateSendButtonState\s*=/);
    assert.match(rendererSource, /window\.__unistudyDebugState\s*=/);
    assert.doesNotMatch(rendererSource, /window\.setLiteActiveRequestId\s*=/);
    assert.doesNotMatch(rendererSource, /window\.globalSettings\s*=/);

    assert.doesNotMatch(messageRendererSource, /window\.toggleEditMode\s*=/);
    assert.doesNotMatch(messageRendererSource, /window\.messageContextMenu\s*=/);
    assert.doesNotMatch(messageRendererSource, /window\.messageRenderer\s*=/);
    assert.doesNotMatch(streamManagerSource, /window\.streamManager\s*=/);
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

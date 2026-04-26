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

test('stream morphdom element cache does not strongly retain discarded DOM nodes', async () => {
    const streamManagerSource = await readRepoFile('src/modules/renderer/streamManager.js');

    assert.match(
        streamManagerSource,
        /const\s+elementContentLengthCache\s*=\s*new\s+WeakMap\s*\(/,
    );
    assert.doesNotMatch(
        streamManagerSource,
        /const\s+elementContentLengthCache\s*=\s*new\s+Map\s*\(/,
    );
});

test('avatar preview object URLs are released after transient preview use', async () => {
    const uiHelpersSource = await readRepoFile('src/modules/renderer/ui-helpers.js');
    const rendererSource = await readRepoFile('src/renderer/renderer.js');

    assert.match(uiHelpersSource, /activeAvatarCropperCleanup/);
    assert.match(uiHelpersSource, /URL\.revokeObjectURL\(objectUrl\)/);
    assert.match(uiHelpersSource, /objectUrl\s*=\s*URL\.createObjectURL\(file\)/);
    assert.match(rendererSource, /let\s+agentAvatarPreviewObjectUrl\s*=\s*null/);
    assert.match(rendererSource, /function\s+revokeAgentAvatarPreviewObjectUrl/);
    assert.match(rendererSource, /URL\.revokeObjectURL\(url\)/);
});

test('thinking indicator keeps the flat chat visual style', async () => {
    const messageRendererCss = await readRepoFile('src/styles/messageRenderer.css');
    const skeletonBlock = messageRendererCss.match(/\.thinking-indicator\.unistudy-thinking-skeleton\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || '';
    const thinkingBlockStart = messageRendererCss.indexOf('.thinking-indicator.unistudy-thinking-skeleton');
    const thinkingBlockEnd = messageRendererCss.indexOf('/* 主气泡样式 - Tool Use */');
    const thinkingStyles = thinkingBlockStart >= 0 && thinkingBlockEnd > thinkingBlockStart
        ? messageRendererCss.slice(thinkingBlockStart, thinkingBlockEnd)
        : skeletonBlock;

    assert.match(skeletonBlock, /display:\s*inline-flex\s*;/);
    assert.match(skeletonBlock, /align-items:\s*center\s*;/);
    assert.match(skeletonBlock, /justify-content:\s*flex-start\s*;/);
    assert.match(skeletonBlock, /gap:\s*8px\s*;/);
    assert.match(skeletonBlock, /min-height:\s*20px\s*;/);
    assert.match(skeletonBlock, /border:\s*0\s*;/);
    assert.match(skeletonBlock, /border-radius:\s*0\s*;/);
    assert.match(skeletonBlock, /background:\s*transparent\s*;/);
    assert.match(skeletonBlock, /box-shadow:\s*none\s*;/);
    assert.match(skeletonBlock, /text-shadow:\s*none\s*;/);
    assert.match(skeletonBlock, /filter:\s*none\s*;/);
    assert.match(skeletonBlock, /animation:\s*none\s*;/);
    assert.doesNotMatch(thinkingStyles, /gradient\(/);
    assert.doesNotMatch(thinkingStyles, /box-shadow\s*:(?!\s*none\s*;)/);
    assert.doesNotMatch(thinkingStyles, /text-shadow\s*:(?!\s*none\s*;)/);
    assert.doesNotMatch(thinkingStyles, /filter\s*:(?!\s*none\s*;)/);
    assert.doesNotMatch(thinkingStyles, /scale\(/);
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

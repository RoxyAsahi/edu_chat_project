const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const {
    createTempDataRootFromFixture,
    ensureFixtureDataRoot,
    resolveFixtureDataRoot,
} = require('../../scripts/lib/runtime-data-roots');
const { buildPreloadBundles } = require('../../scripts/lib/preload-bundles');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchApp(repoRoot, dataRoot) {
    await buildPreloadBundles();
    const launchEnv = {
        ...process.env,
        UNISTUDY_DATA_ROOT: dataRoot,
        ELECTRON_ENABLE_LOGGING: '1',
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    return electron.launch({
        args: [repoRoot],
        cwd: repoRoot,
        env: launchEnv,
    });
}

async function waitForFirstWindow(app, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const windows = app.windows();
        if (windows.length > 0) {
            return windows[0];
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for the first Electron window after ${timeoutMs}ms.`);
}

async function waitForWindowCount(app, expectedCount, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (app.windows().length === expectedCount) {
            return app.windows();
        }
        await delay(250);
    }

    return app.windows();
}

async function waitForRendererBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await page.evaluate(() => ({
            chatAPI: Boolean(window.chatAPI),
            electronAPI: Boolean(window.electronAPI),
            electronPath: Boolean(window.electronPath),
            createKnowledgeBase: typeof window.chatAPI?.createKnowledgeBase === 'function',
            openTextInNewWindow: typeof window.chatAPI?.openTextInNewWindow === 'function',
        })).catch((error) => ({
            chatAPI: false,
            electronAPI: false,
            electronPath: false,
            createKnowledgeBase: false,
            openTextInNewWindow: false,
            evaluationError: error?.message || String(error),
        }));

        if (lastStatus.chatAPI
            && lastStatus.electronAPI
            && lastStatus.electronPath
            && lastStatus.createKnowledgeBase
            && lastStatus.openTextInNewWindow) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for the preload bridge after ${timeoutMs}ms: ${JSON.stringify(lastStatus)}`);
}

async function installReloadCounter(app) {
    await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.webContents.__codexReloadCounterInstalled) {
            return;
        }

        win.webContents.__codexReloadCounterInstalled = true;
        win.webContents.__codexReloadCount = 0;
        win.webContents.on('did-start-loading', () => {
            win.webContents.__codexReloadCount += 1;
        });
    });
}

async function getReloadCount(app) {
    return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win?.webContents.__codexReloadCount || 0;
    });
}

async function waitForReloadIncrement(app, previousCount, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const currentCount = await getReloadCount(app);
        if (currentCount > previousCount) {
            return currentCount;
        }
        await delay(250);
    }
    throw new Error('Timed out waiting for a reload shortcut to trigger navigation.');
}

async function triggerShortcut(app, keyCode, modifiers = []) {
    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.sendInputEvent({
            type: 'keyDown',
            keyCode: payload.keyCode,
            modifiers: payload.modifiers,
        });
    }, { keyCode, modifiers });
}

function getCommandOrControlModifier() {
    return process.platform === 'darwin' ? 'meta' : 'control';
}

test('controlled Electron E2E covers shortcuts, viewer flow, topic KB binding, and watcher guard', { timeout: 120000 }, async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const fixtureRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot }));
    const tempDataRoot = await createTempDataRootFromFixture({
        prefix: 'unistudy-controlled-e2e-',
        fixtureRoot,
    });
    const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-controlled-e2e-'));
    const app = await launchApp(repoRoot, tempDataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);
        const commandOrControl = getCommandOrControlModifier();

        await installReloadCounter(app);

        let reloadCount = await getReloadCount(app);
        await triggerShortcut(app, 'F5');
        reloadCount = await waitForReloadIncrement(app, reloadCount);
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);
        await delay(500);

        await triggerShortcut(app, 'R', [commandOrControl]);
        reloadCount = await waitForReloadIncrement(app, reloadCount);
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);
        await delay(500);

        await triggerShortcut(app, 'R', [commandOrControl, 'shift']);
        reloadCount = await waitForReloadIncrement(app, reloadCount);
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);
        await delay(500);

        await triggerShortcut(app, 'I', [commandOrControl, 'shift']);
        await delay(1000);

        const devToolsOpen = await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win?.webContents.isDevToolsOpened() || false;
        });
        assert.equal(devToolsOpen, true);

        const bindingResult = await page.evaluate(async () => {
            const topic = await window.chatAPI.createNewTopicForAgent('fixture-agent-001', 'Controlled E2E Topic', false, true);
            const kb = await window.chatAPI.createKnowledgeBase({ name: 'Controlled E2E KB' });
            const bind = await window.chatAPI.setTopicKnowledgeBase('fixture-agent-001', topic.topicId, kb.item.id);
            const readback = await window.chatAPI.getTopicKnowledgeBase('fixture-agent-001', topic.topicId);
            const invalidWatcher = await window.chatAPI.watcherStart('', '', '');
            const viewer = await window.chatAPI.openTextInNewWindow('Guide **preview**', 'Controlled Viewer', 'light');

            return {
                bind,
                invalidWatcher,
                kbId: kb.item.id,
                readback,
                topicId: topic.topicId,
                viewer,
            };
        });

        assert.deepEqual(bindingResult.bind, {
            success: true,
            knowledgeBaseId: bindingResult.kbId,
        });
        assert.deepEqual(bindingResult.readback, {
            success: true,
            knowledgeBaseId: bindingResult.kbId,
        });
        assert.deepEqual(bindingResult.invalidWatcher, {
            success: false,
            error: 'watcher:start expects non-empty filePath, agentId, and topicId.',
        });
        assert.deepEqual(bindingResult.viewer, { success: true });

        await waitForWindowCount(app, 3, 15000);
        const viewerWindow = app.windows().find((window) => /text-viewer\.html/.test(window.url()));
        assert.ok(viewerWindow);
        await viewerWindow.waitForLoadState('domcontentloaded');

        const viewerUrl = viewerWindow.url();
        assert.match(viewerUrl, /text-viewer\.html/);
        assert.match(viewerUrl, /title=Controlled%20Viewer/);

        await app.evaluate(({ BrowserWindow }) => {
            const viewer = BrowserWindow.getAllWindows().find((win) => {
                try {
                    return win.webContents.getURL().includes('text-viewer.html');
                } catch {
                    return false;
                }
            });
            viewer?.close();
        });
        await waitForWindowCount(app, 2, 15000);
    } finally {
        await app.close().catch(() => {});
        await fs.remove(tempDataRoot);
        await fs.remove(scratchRoot);
    }
});

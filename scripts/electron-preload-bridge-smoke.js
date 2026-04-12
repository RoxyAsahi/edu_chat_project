const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const {
    createTempDataRootFromFixture,
    ensureFixtureDataRoot,
    resolveFixtureDataRoot,
} = require('./lib/runtime-data-roots');
const { buildPreloadBundles } = require('./lib/preload-bundles');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchApp(repoRoot, dataRoot) {
    await buildPreloadBundles();
    return electron.launch({
        args: [repoRoot],
        cwd: repoRoot,
        env: {
            ...process.env,
            UNISTUDY_DATA_ROOT: dataRoot,
            ELECTRON_ENABLE_LOGGING: '1',
        },
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
        const windows = app.windows();
        if (windows.length === expectedCount) {
            return windows;
        }
        await delay(250);
    }

    return app.windows();
}

function getChildWindow(app, mainWindow) {
    return app.windows().find((window) => window !== mainWindow) || null;
}

async function readMainBridgeStatus(page) {
    return page.evaluate(() => ({
        chatAPI: Boolean(window.chatAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
        openTextInNewWindow: typeof window.chatAPI?.openTextInNewWindow === 'function',
        openImageViewer: typeof window.chatAPI?.openImageViewer === 'function',
    })).catch((error) => ({
        chatAPI: false,
        electronAPI: false,
        electronPath: false,
        openTextInNewWindow: false,
        openImageViewer: false,
        evaluationError: error?.message || String(error),
    }));
}

async function readViewerBridgeStatus(page) {
    return page.evaluate(() => ({
        utilityAPI: Boolean(window.utilityAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
        getCurrentTheme: typeof window.utilityAPI?.getCurrentTheme === 'function',
        openImageViewer: typeof window.utilityAPI?.openImageViewer === 'function',
    })).catch((error) => ({
        utilityAPI: false,
        electronAPI: false,
        electronPath: false,
        getCurrentTheme: false,
        openImageViewer: false,
        evaluationError: error?.message || String(error),
    }));
}

async function waitForBridge(page, reader, label, timeoutMs) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await reader(page);
        const allReady = Object.entries(lastStatus)
            .filter(([key]) => key !== 'evaluationError')
            .every(([, value]) => value === true);
        if (allReady) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastStatus)}`);
}

async function closeViewerWindow(viewerWindow, app) {
    await viewerWindow.evaluate(() => {
        document.getElementById('close-viewer-btn')?.click();
    }).catch(() => {});
    await waitForWindowCount(app, 1, 15000);
}

async function run() {
    const repoRoot = path.resolve(__dirname, '..');
    const fixtureRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot }));
    const tempDataRoot = await createTempDataRootFromFixture({
        prefix: 'unistudy-preload-bridge-',
        fixtureRoot,
    });
    const summary = {
        repoRoot,
        tempDataRoot,
        mainBridge: null,
        textViewerBridge: null,
        imageViewerBridge: null,
        success: false,
    };

    let app = null;
    try {
        app = await launchApp(repoRoot, tempDataRoot);
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        summary.mainBridge = await waitForBridge(page, readMainBridgeStatus, 'main preload bridge', 30000);

        await page.evaluate(() => window.chatAPI.openTextInNewWindow('Bridge smoke', 'Bridge Text Viewer', 'dark'));
        await waitForWindowCount(app, 2, 15000);
        const textWindow = getChildWindow(app, page);
        if (!textWindow) {
            throw new Error('Text viewer did not open during preload bridge smoke.');
        }
        await textWindow.waitForLoadState('domcontentloaded');
        summary.textViewerBridge = await waitForBridge(textWindow, readViewerBridgeStatus, 'text viewer preload bridge', 15000);
        await closeViewerWindow(textWindow, app);

        await page.evaluate(() => window.chatAPI.openImageViewer({
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
            title: 'Bridge Image Viewer',
        }));
        await waitForWindowCount(app, 2, 15000);
        const imageWindow = getChildWindow(app, page);
        if (!imageWindow) {
            throw new Error('Image viewer did not open during preload bridge smoke.');
        }
        await imageWindow.waitForLoadState('domcontentloaded');
        summary.imageViewerBridge = await waitForBridge(imageWindow, readViewerBridgeStatus, 'image viewer preload bridge', 15000);
        await closeViewerWindow(imageWindow, app);

        summary.success = true;
        return summary;
    } finally {
        if (app) {
            await app.close().catch(() => {});
        }
        if (summary.success) {
            await fs.remove(tempDataRoot);
        }
    }
}

if (require.main === module) {
    run()
        .then((summary) => {
            console.log(JSON.stringify(summary, null, 2));
            if (!summary.success) {
                process.exitCode = 1;
            }
        })
        .catch((error) => {
            console.error(error && error.stack ? error.stack : error);
            process.exitCode = 1;
        });
}

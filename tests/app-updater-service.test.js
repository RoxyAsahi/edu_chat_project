const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const SERVICE_PATH = path.resolve(__dirname, '../src/modules/main/services/appUpdater.js');
const SERVICE_MODULE_ID = require.resolve(SERVICE_PATH);

function createAutoUpdaterStub() {
    const listeners = new Map();
    return {
        listeners,
        autoDownload: true,
        autoInstallOnAppQuit: true,
        allowDowngrade: true,
        disableDifferentialDownload: false,
        on(eventName, listener) {
            listeners.set(eventName, listener);
        },
        async checkForUpdates() {
            throw new Error('checkForUpdates should not be called for unsupported runtimes.');
        },
        async downloadUpdate() {
            throw new Error('downloadUpdate should not be called for unsupported runtimes.');
        },
        quitAndInstall() {
            throw new Error('quitAndInstall should not be called for unsupported runtimes.');
        },
    };
}

function loadServiceWithUpdater(autoUpdater) {
    const originalLoad = Module._load;
    delete require.cache[SERVICE_MODULE_ID];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron-updater') {
            return { autoUpdater };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    const service = require(SERVICE_PATH);
    return {
        service,
        restore() {
            Module._load = originalLoad;
        },
    };
}

function safelyRestore(loader) {
    if (loader && typeof loader.restore === 'function') {
        loader.restore();
    }
}

test('app updater reports development runtime as unsupported without checking feed', async () => {
    const autoUpdater = createAutoUpdaterStub();
    const loader = loadServiceWithUpdater(autoUpdater);

    try {
        const { service } = loader;
        service.initialize({
            app: {
                isPackaged: false,
                getVersion: () => '0.1.0',
            },
            getMainWindow: () => null,
        });

        assert.equal(autoUpdater.autoDownload, false);
        assert.equal(autoUpdater.autoInstallOnAppQuit, false);
        assert.equal(autoUpdater.allowDowngrade, false);
        assert.equal(autoUpdater.disableDifferentialDownload, true);
        assert.equal(autoUpdater.listeners.has('update-available'), true);

        const info = service.getInfo();
        assert.equal(info.version, '0.1.0');
        assert.equal(info.updateSupported, false);
        assert.equal(info.unsupportedReason, 'development');

        const checkResult = await service.checkForUpdates();
        assert.equal(checkResult.status, 'unsupported');
        assert.equal(checkResult.updateSupported, false);
    } finally {
        safelyRestore(loader);
    }
});

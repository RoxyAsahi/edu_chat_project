const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const {
    CONTENT_KEYS,
    LITE_KEYS,
    ROLE_API_NAMES,
    SESSION_KEYS,
    SHELL_KEYS,
    VIEWER_KEYS,
} = require('../src/preloads/shared/roles');

const LITE_PRELOAD_PATH = path.resolve(__dirname, '../src/preloads/lite.js');
const VIEWER_PRELOAD_PATH = path.resolve(__dirname, '../src/preloads/viewer.js');

function clearPreloadCaches() {
    Object.keys(require.cache)
        .filter((cacheKey) => cacheKey.includes(`${path.sep}src${path.sep}preloads${path.sep}`))
        .forEach((cacheKey) => {
            delete require.cache[cacheKey];
        });
}

function loadPreload(preloadPath) {
    const exposed = {};
    const invokeCalls = [];
    const sendCalls = [];
    const subscribeCalls = [];
    const electronStub = {
        contextBridge: {
            exposeInMainWorld(name, value) {
                exposed[name] = value;
            },
        },
        ipcRenderer: {
            invoke(channel, ...args) {
                invokeCalls.push([channel, ...args]);
                return Promise.resolve({ channel, args });
            },
            send(channel, ...args) {
                sendCalls.push([channel, ...args]);
            },
            on(channel, listener) {
                subscribeCalls.push(channel);
                return listener;
            },
            removeListener() {},
        },
        webUtils: {
            getPathForFile(file) {
                return file?.mockPath || '';
            },
        },
    };
    const originalLoad = Module._load;

    clearPreloadCaches();
    try {
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        require(preloadPath);
        return { exposed, invokeCalls, sendCalls, subscribeCalls };
    } finally {
        Module._load = originalLoad;
    }
}

test('lite preload exposes the shared catalog for chatAPI', async () => {
    const { exposed, invokeCalls, sendCalls } = loadPreload(LITE_PRELOAD_PATH);

    assert.deepEqual(Object.keys(exposed[ROLE_API_NAMES.lite]).sort(), [...LITE_KEYS].sort());
    assert.deepEqual(
        [...new Set([...SHELL_KEYS, ...SESSION_KEYS, ...CONTENT_KEYS])].sort(),
        [...LITE_KEYS].sort(),
    );
    assert.ok(exposed.electronPath);
    assert.ok(exposed.electronAPI);

    await exposed.chatAPI.getPlatform();
    exposed.chatAPI.openDevTools();

    assert.deepEqual(invokeCalls[0], ['window:get-platform']);
    assert.deepEqual(sendCalls[0], ['window:open-dev-tools']);
});

test('viewer preload exposes only viewer keys and isolates blocked compat calls', async () => {
    const { exposed, invokeCalls } = loadPreload(VIEWER_PRELOAD_PATH);

    assert.deepEqual(Object.keys(exposed[ROLE_API_NAMES.viewer]).sort(), [...VIEWER_KEYS].sort());
    await exposed.utilityAPI.getCurrentTheme();
    assert.deepEqual(invokeCalls[0], ['theme:get-current']);
    await assert.rejects(
        exposed.electronAPI.getAgents(),
        /权限已隔离: getAgents/,
    );
});

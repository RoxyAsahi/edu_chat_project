const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');
const path = require('path');

const THEME_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/themeHandlers.js');

class NativeThemeStub extends EventEmitter {
    constructor() {
        super();
        this.themeSource = 'system';
        this.systemDark = false;
    }

    get shouldUseDarkColors() {
        if (this.themeSource === 'dark') {
            return true;
        }
        if (this.themeSource === 'light') {
            return false;
        }
        return this.systemDark === true;
    }
}

function createWindowStub(id, { destroyed = false } = {}) {
    return {
        id,
        sent: [],
        isDestroyed() {
            return destroyed;
        },
        webContents: {
            send(channel, payload) {
                this.__owner.sent.push([channel, payload]);
            },
            __owner: null,
        },
    };
}

function finalizeWindowStub(windowStub) {
    windowStub.webContents.__owner = windowStub;
    return windowStub;
}

function loadThemeHandlersHarness() {
    const onHandlers = new Map();
    const handleHandlers = new Map();
    const nativeTheme = new NativeThemeStub();
    const mainWindowRef = { current: finalizeWindowStub(createWindowStub('main-1')) };
    const childWindowsRef = { current: [] };
    const settingsUpdates = [];
    const electronStub = {
        ipcMain: {
            on(channel, handler) {
                onHandlers.set(channel, handler);
            },
            handle(channel, handler) {
                handleHandlers.set(channel, handler);
            },
        },
        nativeTheme,
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(THEME_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const themeHandlers = require(THEME_HANDLERS_PATH);
        themeHandlers.initialize({
            getMainWindow: () => mainWindowRef.current,
            getOpenChildWindows: () => childWindowsRef.current,
            settingsManager: {
                async updateSettings(updater) {
                    const nextSettings = typeof updater === 'function'
                        ? await updater({})
                        : updater;
                    settingsUpdates.push(nextSettings);
                    return { success: true, settings: nextSettings };
                },
            },
        });

        return {
            themeHandlers,
            onHandlers,
            handleHandlers,
            nativeTheme,
            mainWindowRef,
            childWindowsRef,
            settingsUpdates,
        };
    } finally {
        Module._load = originalLoad;
    }
}

async function flushAsyncWork() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

test('set-theme and set-theme-mode both persist and broadcast through the shared theme handler path', async () => {
    const harness = loadThemeHandlersHarness();
    const setTheme = harness.onHandlers.get('set-theme');
    const setThemeMode = harness.onHandlers.get('set-theme-mode');
    const firstMainWindow = harness.mainWindowRef.current;

    setTheme(null, 'light');
    await flushAsyncWork();

    assert.equal(harness.nativeTheme.themeSource, 'light');
    assert.equal(harness.settingsUpdates[0].currentThemeMode, 'light');
    assert.deepEqual(firstMainWindow.sent, [
        ['theme-updated', 'light'],
        ['theme:updated', 'light'],
    ]);

    const nextMainWindow = finalizeWindowStub(createWindowStub('main-2'));
    const childWindow = finalizeWindowStub(createWindowStub('child-1'));
    harness.mainWindowRef.current = nextMainWindow;
    harness.childWindowsRef.current = [childWindow];

    setThemeMode(null, 'dark');
    await flushAsyncWork();

    assert.equal(harness.nativeTheme.themeSource, 'dark');
    assert.equal(harness.settingsUpdates[1].currentThemeMode, 'dark');
    assert.equal(firstMainWindow.sent.length, 2);
    assert.deepEqual(nextMainWindow.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
    assert.deepEqual(childWindow.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
});

test('broadcastThemeUpdate uses the latest window getters and de-duplicates repeated windows', () => {
    const harness = loadThemeHandlersHarness();
    const sharedWindow = finalizeWindowStub(createWindowStub('shared'));
    const childWindow = finalizeWindowStub(createWindowStub('child'));
    const destroyedWindow = finalizeWindowStub(createWindowStub('destroyed', { destroyed: true }));

    harness.mainWindowRef.current = sharedWindow;
    harness.childWindowsRef.current = [sharedWindow, childWindow, childWindow, destroyedWindow, null];

    harness.themeHandlers.broadcastThemeUpdate('dark');

    assert.deepEqual(sharedWindow.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
    assert.deepEqual(childWindow.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
    assert.deepEqual(destroyedWindow.sent, []);
});

test('nativeTheme updated events broadcast the current derived theme and get-current-theme stays compatible', async () => {
    const harness = loadThemeHandlersHarness();
    const getCurrentTheme = harness.handleHandlers.get('get-current-theme');
    const getCurrentThemeAlias = harness.handleHandlers.get('theme:get-current');
    const childWindow = finalizeWindowStub(createWindowStub('child-2'));

    harness.childWindowsRef.current = [childWindow];
    harness.nativeTheme.systemDark = true;
    harness.nativeTheme.emit('updated');

    assert.deepEqual(harness.mainWindowRef.current.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
    assert.deepEqual(childWindow.sent, [
        ['theme-updated', 'dark'],
        ['theme:updated', 'dark'],
    ]);
    assert.equal(await getCurrentTheme(), 'dark');
    assert.equal(await getCurrentThemeAlias(), 'dark');
});

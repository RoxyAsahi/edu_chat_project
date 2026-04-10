const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const FILE_DIALOG_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/fileDialogHandlers.js');

function loadFileDialogHandlers() {
    const handleHandlers = new Map();
    const onHandlers = new Map();
    const browserWindows = [];

    class BrowserWindowStub {
        constructor(options) {
            this.options = options;
            this.loadedUrl = null;
            browserWindows.push(this);
        }

        loadURL(url) {
            this.loadedUrl = url;
            return Promise.resolve();
        }

        setMenu() {}

        once(_event, callback) {
            this.readyCallback = callback;
        }

        on(_event, callback) {
            this.closedCallback = callback;
        }

        show() {}

        isDestroyed() {
            return false;
        }

        focus() {}
    }

    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handleHandlers.set(channel, handler);
            },
            on(channel, handler) {
                onHandlers.set(channel, handler);
            },
        },
        dialog: {
            showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        },
        shell: {
            openExternal: async () => {},
        },
        clipboard: {
            readImage: () => ({ isEmpty: () => true }),
            readText: () => '',
            writeImage: () => {},
        },
        net: {
            request: () => ({
                on() {},
                end() {},
            }),
        },
        nativeImage: {
            createFromPath: () => ({ isEmpty: () => false }),
            createFromBuffer: () => ({ isEmpty: () => false }),
        },
        BrowserWindow: BrowserWindowStub,
        Menu: {
            buildFromTemplate: () => ({ popup() {} }),
        },
        app: {
            getAppPath() {
                return path.resolve(__dirname, '..');
            },
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(FILE_DIALOG_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const fileDialogHandlers = require(FILE_DIALOG_HANDLERS_PATH);
        fileDialogHandlers.initialize({
            isDestroyed() {
                return false;
            },
            focus() {},
        }, {
            getSelectionListenerStatus: () => false,
            stopSelectionListener: () => false,
            startSelectionListener: () => false,
            openChildWindows: [],
        });

        return { browserWindows, handleHandlers, onHandlers };
    } finally {
        Module._load = originalLoad;
    }
}

test('open-image-viewer ignores invalid payloads', async () => {
    const harness = loadFileDialogHandlers();
    const openImageViewer = harness.onHandlers.get('open-image-viewer');

    await openImageViewer(null, {});
    await openImageViewer(null, []);

    assert.equal(harness.browserWindows.length, 0);
});

test('display-text-content-in-viewer rejects empty text and opens a viewer for valid text', async () => {
    const harness = loadFileDialogHandlers();
    const displayText = harness.handleHandlers.get('display-text-content-in-viewer');
    const openImageInNewWindow = harness.onHandlers.get('open-image-in-new-window');

    const invalid = await displayText(null, '', 'Viewer', 'light');
    assert.deepEqual(invalid, {
        success: false,
        error: 'display-text-content-in-viewer expects non-empty textContent.',
    });

    const valid = await displayText(null, 'Viewer body', 'Viewer', 'light');
    assert.deepEqual(valid, { success: true });
    assert.equal(harness.browserWindows.length, 1);
    assert.match(harness.browserWindows[0].loadedUrl, /Viewer/);

    await openImageInNewWindow(null, 'file:///tmp/sample.png', 'Image');
    assert.equal(harness.browserWindows.length, 2);
});

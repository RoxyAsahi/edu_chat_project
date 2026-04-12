const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const CHAT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/chatHandlers.js');

function loadChatHandlers() {
    const handlers = new Map();
    const dialogCalls = [];
    const mainWindowRef = {
        current: {
            id: 'window-a',
            isDestroyed() {
                return false;
            },
        },
    };
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
        },
        dialog: {
            async showOpenDialog(window) {
                dialogCalls.push(window);
                return { canceled: true, filePaths: [] };
            },
        },
        BrowserWindow: class BrowserWindow {},
    };
    const knowledgeBaseStub = {};
    const vcpClientStub = {
        initialize() {},
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(CHAT_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            if (request === '../knowledge-base') {
                return knowledgeBaseStub;
            }
            if (request === '../vcpClient') {
                return vcpClientStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const chatHandlers = require(CHAT_HANDLERS_PATH);
        chatHandlers.initialize(() => mainWindowRef.current, {
            getMainWindow: () => mainWindowRef.current,
            AGENT_DIR: path.resolve(__dirname, '..', 'tmp-agents'),
            USER_DATA_DIR: path.resolve(__dirname, '..', 'tmp-user-data'),
            DATA_ROOT: path.resolve(__dirname, '..', 'tmp-data-root'),
            fileWatcher: null,
            settingsManager: {
                async readSettings() {
                    return {};
                },
            },
            agentConfigManager: null,
        });

        return { handlers, dialogCalls, mainWindowRef };
    } finally {
        Module._load = originalLoad;
    }
}

test('select-files-to-send resolves the latest main window lazily', async () => {
    const harness = loadChatHandlers();
    const selectFilesToSend = harness.handlers.get('select-files-to-send');

    await selectFilesToSend(null, 'agent-1', 'topic-1');
    assert.equal(harness.dialogCalls[0], harness.mainWindowRef.current);

    const nextWindow = {
        id: 'window-b',
        isDestroyed() {
            return false;
        },
    };
    harness.mainWindowRef.current = nextWindow;

    await selectFilesToSend(null, 'agent-1', 'topic-1');
    assert.equal(harness.dialogCalls[1], nextWindow);
});

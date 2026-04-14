const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const Module = require('module');

const HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/emoticonHandlers.js');

function loadHandlers() {
    const handleHandlers = new Map();
    const onHandlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handleHandlers.set(channel, handler);
            },
            on(channel, handler) {
                onHandlers.set(channel, handler);
            },
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const emoticonHandlers = require(HANDLERS_PATH);
        return { emoticonHandlers, handleHandlers, onHandlers };
    } finally {
        Module._load = originalLoad;
    }
}

test('emoticon handlers manage a local offline library', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-emoticon-'));
    t.after(() => fs.remove(tempRoot));

    const sourceImage = path.join(tempRoot, 'smile.png');
    await fs.writeFile(sourceImage, Buffer.from([137, 80, 78, 71]));

    const { emoticonHandlers, handleHandlers } = loadHandlers();
    await emoticonHandlers.initialize({
        DATA_ROOT: tempRoot,
        SETTINGS_FILE: path.join(tempRoot, 'settings.json'),
    });
    emoticonHandlers.setupEmoticonHandlers();

    const saveEmoticonItem = handleHandlers.get('save-emoticon-item');
    const listEmoticonLibrary = handleHandlers.get('list-emoticon-library');
    const deleteEmoticonItem = handleHandlers.get('delete-emoticon-item');

    const saveResult = await saveEmoticonItem({}, {
        sourcePath: sourceImage,
        name: 'Smile',
        filename: 'smile.png',
        category: '通用表情包',
        tags: ['开心'],
    });
    assert.equal(saveResult.success, true);
    assert.match(saveResult.item.url, /^file:/);

    const listResult = await listEmoticonLibrary({});
    assert.equal(listResult.success, true);
    assert.equal(listResult.items.length, 1);
    assert.equal(listResult.items[0].name, 'Smile');

    const deleteResult = await deleteEmoticonItem({}, saveResult.item.id);
    assert.equal(deleteResult.success, true);

    const afterDelete = await listEmoticonLibrary({});
    assert.equal(afterDelete.items.length, 0);
});

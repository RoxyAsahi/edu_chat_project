const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadMessageContextMenuModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/messageContextMenu.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('buildChatContextMenuModel returns assistant actions with regenerate and delete groups', async () => {
    const { buildChatContextMenuModel } = await loadMessageContextMenuModule();

    const model = buildChatContextMenuModel({
        isEditing: false,
        isThinkingOrStreaming: false,
        canRegenerate: true,
    });

    assert.equal(Object.prototype.hasOwnProperty.call(model, 'header'), false);
    assert.equal(model.sections.length, 3);
    assert.deepEqual(
        model.sections[0].items.map((item) => item.id),
        ['edit', 'copy']
    );
    assert.deepEqual(
        model.sections[1].items.map((item) => item.id),
        ['read-mode', 'regenerate']
    );
    assert.deepEqual(
        model.sections[2].items.map((item) => item.id),
        ['delete']
    );
});

test('buildChatContextMenuModel returns editing actions only while editing', async () => {
    const { buildChatContextMenuModel } = await loadMessageContextMenuModule();

    const model = buildChatContextMenuModel({
        isEditing: true,
        isThinkingOrStreaming: false,
        canRegenerate: false,
    });

    assert.equal(model.sections.length, 1);
    assert.deepEqual(
        model.sections[0].items.map((item) => item.id),
        ['cut', 'paste', 'cancel-edit']
    );
});

test('buildChatContextMenuModel collapses to interrupt when message is streaming', async () => {
    const { buildChatContextMenuModel } = await loadMessageContextMenuModule();

    const model = buildChatContextMenuModel({
        isEditing: false,
        isThinkingOrStreaming: true,
        canRegenerate: true,
    });

    assert.equal(model.sections.length, 1);
    assert.deepEqual(
        model.sections[0].items.map((item) => item.id),
        ['interrupt']
    );
});

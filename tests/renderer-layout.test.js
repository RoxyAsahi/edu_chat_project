const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadLayoutModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/layout/layoutController.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('resolveLayoutWidths preserves center space by shrinking side panels', async () => {
    const { resolveLayoutWidths } = await loadLayoutModule();

    const resolved = resolveLayoutWidths({
        desiredLeft: 410,
        desiredRight: 400,
        contentWidth: 1200,
        collapsed: false,
    });

    assert.equal(resolved.left, 220);
    assert.equal(resolved.right, 396);
    assert.equal(resolved.center, 560);
});

test('resolveLeftSidebarHeights falls back to compact minimums in short sidebars', async () => {
    const { resolveLeftSidebarHeights } = await loadLayoutModule();

    const resolved = resolveLeftSidebarHeights({
        desiredTop: 999,
        contentHeight: 300,
    });

    assert.equal(resolved.top, 108);
    assert.equal(resolved.bottom, 180);
    assert.equal(resolved.dividerHeight, 12);
});

test('layout normalizers keep numeric values and fall back for invalid ones', async () => {
    const {
        normalizeStoredLayoutWidth,
        normalizeStoredLayoutHeight,
    } = await loadLayoutModule();

    assert.equal(normalizeStoredLayoutWidth('512', 410), 512);
    assert.equal(normalizeStoredLayoutWidth('invalid', 410), 410);
    assert.equal(normalizeStoredLayoutHeight(280, 360), 280);
    assert.equal(normalizeStoredLayoutHeight(undefined, 360), 360);
});

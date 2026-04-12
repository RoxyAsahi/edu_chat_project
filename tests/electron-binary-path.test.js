const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');

const { resolveElectronBinaryRelativePath } = require('../scripts/lib/electron-binary');

test('resolveElectronBinaryRelativePath returns the Windows executable path', () => {
    assert.equal(resolveElectronBinaryRelativePath('win32'), 'electron.exe');
});

test('resolveElectronBinaryRelativePath returns the macOS app bundle executable path', () => {
    assert.equal(
        resolveElectronBinaryRelativePath('darwin'),
        path.join('Electron.app', 'Contents', 'MacOS', 'Electron'),
    );
});

test('resolveElectronBinaryRelativePath returns the unix executable path for linux-like systems', () => {
    assert.equal(resolveElectronBinaryRelativePath('linux'), 'electron');
    assert.equal(resolveElectronBinaryRelativePath('freebsd'), 'electron');
});

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const SettingsManager = require('../src/modules/main/utils/appSettingsManager');
const {
    DEFAULT_SETTINGS,
    validateSettings,
} = require('../src/modules/main/utils/settingsSchema');

test('validateSettings normalizes unknown keys, types, and bounds', () => {
    const { validated, hasIssues } = validateSettings({
        sidebarWidth: 9999,
        layoutLeftWidth: 'wide',
        networkNotesPaths: 'bad',
        combinedItemOrder: {},
        agentOrder: 'broken',
        userName: 'Alice',
        rogueField: true,
    });

    assert.equal(hasIssues, true);
    assert.equal(validated.userName, 'Alice');
    assert.equal(validated.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
    assert.equal(validated.layoutLeftWidth, DEFAULT_SETTINGS.layoutLeftWidth);
    assert.deepEqual(validated.networkNotesPaths, []);
    assert.deepEqual(validated.combinedItemOrder, []);
    assert.deepEqual(validated.agentOrder, []);
    assert.equal('rogueField' in validated, false);
  });

test('readSettings falls back to defaults when the file is missing', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    const settings = await manager.readSettings();
    assert.equal(settings.userName, DEFAULT_SETTINGS.userName);
    assert.equal(settings.kbEmbeddingModel, DEFAULT_SETTINGS.kbEmbeddingModel);
    assert.equal(settings.enableThoughtChainInjection, false);
});

test('readSettings recovers from a valid backup when the primary file is corrupted', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeFile(settingsPath, '{"broken": ', 'utf8');
    await fs.writeJson(`${settingsPath}.backup`, {
        ...DEFAULT_SETTINGS,
        userName: 'Recovered User',
        combinedItemOrder: ['agent-a'],
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    assert.equal(settings.userName, 'Recovered User');
    assert.deepEqual(settings.combinedItemOrder, ['agent-a']);
});

test('writeSettings persists normalized content and refreshes the cache', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings({
        ...DEFAULT_SETTINGS,
        userName: 'Writer',
        sidebarWidth: 50,
        rogueField: 'remove-me',
    });

    const written = await fs.readJson(settingsPath);
    assert.equal(written.userName, 'Writer');
    assert.equal(written.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
    assert.equal('rogueField' in written, false);

    const cached = await manager.readSettings();
    assert.equal(cached.userName, 'Writer');
    assert.equal(cached.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
});

test('queued updateSettings calls do not lose concurrent changes', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    await Promise.all([
        manager.updateSettings((current) => ({
            ...current,
            userName: 'Queued User',
        })),
        manager.updateSettings((current) => ({
            ...current,
            guideModel: 'guide-model-1',
        })),
    ]);

    const updated = await manager.readSettings();
    assert.equal(updated.userName, 'Queued User');
    assert.equal(updated.guideModel, 'guide-model-1');
});

test('dispose clears recurring timers created by cleanup and backup tasks', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    const cleanupTimer = manager.startCleanupTimer();
    const backupTimer = manager.startAutoBackup(tempRoot);

    assert.ok(cleanupTimer);
    assert.ok(backupTimer);
    assert.equal(manager.cleanupTimer, cleanupTimer);
    assert.equal(manager.autoBackupTimer, backupTimer);

    manager.dispose();

    assert.equal(manager.cleanupTimer, null);
    assert.equal(manager.autoBackupTimer, null);
});

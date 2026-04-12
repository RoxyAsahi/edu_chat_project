const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { migrateLegacyProjectData } = require('../scripts/lib/legacy-data-migration');

test('manual legacy migration utility only mutates data roots when explicitly invoked', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-test-'));
    const sourceRoot = path.join(tempRoot, 'source');
    const targetRoot = path.join(tempRoot, 'target');
    const backupRoot = path.join(tempRoot, 'backup');

    try {
        await fs.ensureDir(path.join(sourceRoot, 'Agents', 'legacy-agent'));
        await fs.ensureDir(path.join(sourceRoot, 'UserData', 'legacy-agent', 'topics'));
        await fs.writeJson(path.join(sourceRoot, 'settings.json'), {
            lastOpenItemId: 'legacy-agent',
            userName: 'legacy-user',
        });
        await fs.outputFile(path.join(sourceRoot, 'Agents', 'legacy-agent', 'config.json'), '{"name":"legacy"}');

        await fs.ensureDir(path.join(targetRoot, 'Agents', 'new-agent'));
        await fs.writeJson(path.join(targetRoot, 'settings.json'), {
            lastOpenItemId: 'new-agent',
            userName: 'new-user',
        });
        await fs.outputFile(path.join(targetRoot, 'Agents', 'new-agent', 'config.json'), '{"name":"new"}');

        const settingsBeforeManualRun = await fs.readJson(path.join(targetRoot, 'settings.json'));
        assert.equal(settingsBeforeManualRun.lastOpenItemId, 'new-agent');

        const report = await migrateLegacyProjectData({
            sourceRoot,
            targetRoot,
            backupRoot,
            stamp: 'fixed-stamp',
        });

        assert.equal(report.sourceRoot, path.resolve(sourceRoot));
        assert.equal(report.targetRoot, path.resolve(targetRoot));
        assert.equal(report.backupRoot, path.resolve(backupRoot));
        assert.deepEqual(report.copiedEntries.sort(), ['Agents', 'UserData', 'settings.json'].sort());
        assert.deepEqual(report.backedUpEntries.sort(), ['Agents', 'settings.json'].sort());

        const migratedSettings = await fs.readJson(path.join(targetRoot, 'settings.json'));
        assert.equal(migratedSettings.lastOpenItemId, 'legacy-agent');
        assert.equal(await fs.pathExists(path.join(targetRoot, 'Agents', 'legacy-agent', 'config.json')), true);
        assert.equal(await fs.pathExists(path.join(targetRoot, 'Agents', 'new-agent')), false);
        assert.equal(await fs.pathExists(path.join(backupRoot, 'Agents', 'new-agent', 'config.json')), true);
        assert.equal(await fs.pathExists(path.join(backupRoot, 'migration-report.json')), true);
    } finally {
        await fs.remove(tempRoot);
    }
});

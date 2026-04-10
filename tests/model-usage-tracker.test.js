const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const tracker = require('../src/modules/main/modelUsageTracker');

async function readFileIfExists(filePath) {
    if (!await fs.pathExists(filePath)) {
        return null;
    }

    return fs.readFile(filePath, 'utf8');
}

test('modelUsageTracker writes stats and favorites into the configured data root only', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'model-usage-tracker-'));
    const legacyFiles = [
        path.join(__dirname, '..', 'src', 'AppData', 'model_usage_stats.json'),
        path.join(__dirname, '..', 'src', 'modules', 'AppData', 'model_usage_stats.json'),
    ];
    const beforeLegacyContents = await Promise.all(legacyFiles.map((filePath) => readFileIfExists(filePath)));

    tracker.__resetForTests();
    tracker.initializeModelUsageTracker({ dataRoot: tempRoot });
    t.after(async () => {
        tracker.__resetForTests();
        await fs.remove(tempRoot);
    });

    await tracker.recordModelUsage('fixture-model');
    await tracker.flushPendingWrites();
    await tracker.toggleFavoriteModel('fixture-model');

    assert.deepEqual(await tracker.getModelUsageStats(), { 'fixture-model': 1 });
    assert.deepEqual(await tracker.getFavoriteModels(), ['fixture-model']);
    assert.deepEqual(await fs.readJson(path.join(tempRoot, 'model_usage_stats.json')), { 'fixture-model': 1 });
    assert.deepEqual(await fs.readJson(path.join(tempRoot, 'model_favorites.json')), ['fixture-model']);

    const afterLegacyContents = await Promise.all(legacyFiles.map((filePath) => readFileIfExists(filePath)));
    assert.deepEqual(afterLegacyContents, beforeLegacyContents);
});

test('modelUsageTracker fails predictably when used before initialization', async () => {
    tracker.__resetForTests();
    await assert.rejects(
        tracker.getModelUsageStats(),
        /ModelUsageTracker is not initialized/i,
    );
});

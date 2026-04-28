const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
    seedDefaultDataRoot,
} = require('../src/modules/main/utils/defaultDataSeeder');

test('default data seeder copies missing agents and rewrites seeded attachment file URLs', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-default-seed-test-'));
    const dataRoot = path.join(tempRoot, 'data');
    const seedRoot = path.join(tempRoot, 'seed');
    const agentId = 'seed_agent';
    const topicId = 'default';
    const attachmentFileName = 'seed-image.png';

    t.after(async () => {
        await fs.remove(tempRoot);
    });

    await fs.outputJson(path.join(seedRoot, 'Agents', agentId, 'config.json'), {
        name: 'Seed Agent',
        topics: [{ id: topicId, name: 'Seed Topic' }],
    }, { spaces: 2 });
    await fs.outputFile(path.join(seedRoot, 'UserData', 'attachments', attachmentFileName), 'fake image bytes');
    await fs.outputJson(path.join(seedRoot, 'UserData', agentId, 'topics', topicId, 'history.json'), [{
        role: 'user',
        content: 'hello',
        attachments: [{
            internalFileName: attachmentFileName,
            internalPath: 'file://C:/old/path/seed-image.png',
            src: 'file://C:/old/path/seed-image.png',
        }],
    }], { spaces: 2 });

    const result = await seedDefaultDataRoot({ dataRoot, seedRoot });

    assert.equal(result.seedRootMissing, false);
    assert.equal(result.hydratedHistories, 1);
    assert.ok(await fs.pathExists(path.join(dataRoot, 'Agents', agentId, 'config.json')));
    assert.ok(await fs.pathExists(path.join(dataRoot, 'UserData', 'attachments', attachmentFileName)));

    const history = await fs.readJson(path.join(dataRoot, 'UserData', agentId, 'topics', topicId, 'history.json'));
    const expectedUrl = pathToFileURL(path.join(dataRoot, 'UserData', 'attachments', attachmentFileName)).href;
    assert.equal(history[0].attachments[0].internalPath, expectedUrl);
    assert.equal(history[0].attachments[0].src, expectedUrl);
});

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const path = require('path');

const {
    createTempDataRootFromFixture,
    ensureFixtureDataRoot,
    resolveFixtureDataRoot,
    resolveRequiredExternalDataRoot,
} = require('../scripts/lib/runtime-data-roots');

test('fixture data root defaults to the dedicated runtime-data-root fixture', async () => {
    const repoRoot = path.join(__dirname, '..');
    const fixtureRoot = resolveFixtureDataRoot({ repoRoot, env: {} });
    const normalizedRoot = await ensureFixtureDataRoot(fixtureRoot);

    assert.equal(normalizedRoot, path.join(repoRoot, 'tests', 'fixtures', 'runtime-data-root'));
    assert.ok(await fs.pathExists(path.join(normalizedRoot, 'settings.json')));
    assert.ok(await fs.pathExists(path.join(normalizedRoot, 'Agents', 'fixture-agent-001', 'config.json')));
});

test('real-data helper requires an explicit external data root', () => {
    assert.throws(
        () => resolveRequiredExternalDataRoot({
            env: {},
            envName: 'UNISTUDY_REAL_DATA_ROOT',
            description: 'UniStudy real-data smoke mode',
        }),
        /UNISTUDY_REAL_DATA_ROOT is required/i,
    );
});

test('temporary data roots are seeded from the dedicated fixture root', async (t) => {
    const repoRoot = path.join(__dirname, '..');
    const fixtureRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot, env: {} }));
    const tempRoot = await createTempDataRootFromFixture({
        prefix: 'unistudy-runtime-data-root-test-',
        fixtureRoot,
    });

    t.after(async () => {
        await fs.remove(tempRoot);
    });

    assert.ok(await fs.pathExists(path.join(tempRoot, 'settings.json')));
    assert.ok(await fs.pathExists(path.join(tempRoot, 'generated_lists', 'config.env')));
    assert.ok(await fs.pathExists(path.join(tempRoot, 'Agents', 'fixture-agent-001', 'config.json')));
    assert.ok(await fs.pathExists(path.join(tempRoot, 'UserData', 'fixture-agent-001', 'topics', 'fixture-topic-001', 'history.json')));
});

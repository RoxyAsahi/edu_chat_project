const fs = require('fs-extra');
const os = require('os');
const path = require('path');

function resolveFixtureDataRoot({ repoRoot, env = process.env, envName = 'UNISTUDY_TEST_FIXTURE_ROOT' } = {}) {
    const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : path.resolve(__dirname, '..', '..');
    const rawOverride = String(env[envName] || '').trim();
    if (rawOverride) {
        return path.resolve(rawOverride);
    }

    return path.join(normalizedRepoRoot, 'tests', 'fixtures', 'runtime-data-root');
}

async function ensureFixtureDataRoot(fixtureRoot) {
    const normalizedRoot = path.resolve(fixtureRoot);
    if (!await fs.pathExists(normalizedRoot)) {
        throw new Error(`Fixture data root not found: ${normalizedRoot}`);
    }
    return normalizedRoot;
}

function resolveRequiredExternalDataRoot({ env = process.env, envName, description }) {
    const rawValue = String(env[envName] || '').trim();
    if (!rawValue) {
        throw new Error(`${envName} is required for ${description}.`);
    }

    return path.resolve(rawValue);
}

async function seedDataRootFromFixture(targetRoot, fixtureRoot) {
    const normalizedFixtureRoot = await ensureFixtureDataRoot(fixtureRoot);
    await fs.ensureDir(targetRoot);
    await fs.copy(normalizedFixtureRoot, targetRoot);
    return targetRoot;
}

async function createTempDataRootFromFixture({ prefix, fixtureRoot }) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    await seedDataRootFromFixture(tempRoot, fixtureRoot);
    return tempRoot;
}

module.exports = {
    resolveFixtureDataRoot,
    ensureFixtureDataRoot,
    resolveRequiredExternalDataRoot,
    seedDataRootFromFixture,
    createTempDataRootFromFixture,
};

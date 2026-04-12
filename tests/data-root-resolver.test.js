const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    hasMeaningfulDataRoot,
    resolveDataRootPaths,
    resolveLegacyProjectRoot,
    resolveOverrideRoot,
} = require('../src/modules/main/utils/dataRootResolver');

function createAppStub(initialUserData) {
    const paths = {
        userData: initialUserData,
    };

    return {
        getPath(name) {
            return paths[name];
        },
        setPath(name, value) {
            paths[name] = value;
        },
    };
}

test('resolveOverrideRoot normalizes relative env overrides', () => {
    const cwd = path.join('C:', 'Workspace', 'UniStudy');
    const result = resolveOverrideRoot({ UNISTUDY_DATA_ROOT: '.\\custom-data\\..\\custom-data' }, cwd);
    assert.equal(result, path.resolve(cwd, '.\\custom-data\\..\\custom-data'));
});

test('resolveDataRootPaths uses env override as canonical userData root', () => {
    const cwd = path.join('C:', 'Workspace', 'UniStudy');
    const app = createAppStub(path.join('C:', 'Users', 'CHENXI', 'AppData', 'Roaming', 'UniStudy'));

    const paths = resolveDataRootPaths({
        app,
        env: { UNISTUDY_DATA_ROOT: '.\\tmp\\runtime-root' },
        cwd,
    });

    const expectedRoot = path.resolve(cwd, '.\\tmp\\runtime-root');
    assert.equal(paths.source, 'env-override');
    assert.equal(paths.dataRoot, expectedRoot);
    assert.equal(app.getPath('userData'), expectedRoot);
    assert.equal(paths.agentsDir, path.join(expectedRoot, 'Agents'));
    assert.equal(paths.userDataDir, path.join(expectedRoot, 'UserData'));
    assert.equal(paths.settingsFile, path.join(expectedRoot, 'settings.json'));
    assert.equal(paths.userAvatarFile, path.join(expectedRoot, 'UserData', 'user_avatar.png'));
    assert.equal(paths.avatarImageDir, path.join(expectedRoot, 'avatarimage'));
    assert.equal(paths.resolveInDataRoot('Notes', 'agent-1'), path.join(expectedRoot, 'Notes', 'agent-1'));
});

test('resolveDataRootPaths falls back to Electron userData when no override is provided', () => {
    const defaultUserData = path.join('C:', 'Users', 'CHENXI', 'AppData', 'Roaming', 'UniStudy');
    const app = createAppStub(defaultUserData);

    const paths = resolveDataRootPaths({
        app,
        env: {},
        cwd: path.join('C:', 'Workspace', 'UniStudy'),
    });

    assert.equal(paths.source, 'electron-userData');
    assert.equal(paths.dataRoot, path.resolve(defaultUserData));
    assert.equal(app.getPath('userData'), defaultUserData);
    assert.equal(paths.resolveInDataRoot('generated_lists'), path.join(path.resolve(defaultUserData), 'generated_lists'));
});

test('resolveLegacyProjectRoot remains available for explicit legacy tooling only', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-data-root-'));

    try {
        const legacyRoot = path.join(tempRoot, 'AppData');
        await fs.ensureDir(legacyRoot);
        await fs.writeJson(path.join(legacyRoot, 'settings.json'), { userName: 'legacy-user' });

        assert.equal(resolveLegacyProjectRoot(tempRoot), legacyRoot);
        assert.equal(hasMeaningfulDataRoot(legacyRoot), true);
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveDataRootPaths does not depend on legacy project AppData during main startup', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-project-pref-'));
    const defaultUserData = path.join(tempRoot, 'Roaming', 'UniStudy');
    const app = createAppStub(defaultUserData);

    try {
        const legacyRoot = path.join(tempRoot, 'AppData');
        await fs.ensureDir(path.join(legacyRoot, 'Agents'));
        await fs.writeJson(path.join(legacyRoot, 'settings.json'), { lastOpenItemId: 'legacy-agent' });

        const paths = resolveDataRootPaths({
            app,
            env: {},
            cwd: tempRoot,
        });

        assert.equal(paths.source, 'electron-userData');
        assert.equal(paths.dataRoot, path.resolve(defaultUserData));
        assert.equal(app.getPath('userData'), defaultUserData);
    } finally {
        await fs.remove(tempRoot);
    }
});

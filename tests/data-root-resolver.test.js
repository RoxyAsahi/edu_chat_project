const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    PORTABLE_MARKER_FILE,
    hasMeaningfulDataRoot,
    resolveDataRootPaths,
    resolveInstalledContestRoot,
    resolveLegacyProjectRoot,
    resolveOverrideRoot,
    resolvePortableSiblingRoot,
} = require('../src/modules/main/utils/dataRootResolver');

function createAppStub(initialUserData, exePath = null, appDataPath = null) {
    const paths = {
        userData: initialUserData,
        exe: exePath,
        appData: appDataPath,
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

test('resolveDataRootPaths defaults to the contest AppData root when no override is provided', () => {
    const defaultUserData = path.join('C:', 'Users', 'CHENXI', 'AppData', 'Roaming', 'UniStudy');
    const appDataRoot = path.join('C:', 'Users', 'CHENXI', 'AppData', 'Roaming');
    const app = createAppStub(defaultUserData, null, appDataRoot);

    const paths = resolveDataRootPaths({
        app,
        env: {},
        cwd: path.join('C:', 'Workspace', 'UniStudy'),
    });

    const expectedRoot = path.join(path.resolve(appDataRoot), 'UniStudyContest');
    assert.equal(paths.source, 'installed-contest-userData');
    assert.equal(paths.dataRoot, expectedRoot);
    assert.equal(app.getPath('userData'), expectedRoot);
    assert.equal(paths.resolveInDataRoot('generated_lists'), path.join(expectedRoot, 'generated_lists'));
});

test('resolveDataRootPaths ignores portable sibling data root without marker', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-data-root-'));
    const defaultUserData = path.join(tempRoot, 'Roaming', 'UniStudy');
    const appDataRoot = path.join(tempRoot, 'Roaming');
    const portableRoot = path.join(tempRoot, 'UniStudy-portable', 'UniStudyData');
    const app = createAppStub(defaultUserData, path.join(tempRoot, 'UniStudy-portable', 'UniStudy.exe'), appDataRoot);

    try {
        await fs.ensureDir(portableRoot);

        assert.equal(resolvePortableSiblingRoot({ app }), null);

        const paths = resolveDataRootPaths({
            app,
            env: {},
            cwd: tempRoot,
        });

        assert.equal(paths.source, 'installed-contest-userData');
        assert.equal(paths.dataRoot, path.join(path.resolve(appDataRoot), 'UniStudyContest'));
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveDataRootPaths uses marked portable sibling data root when present and writable', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-data-root-'));
    const defaultUserData = path.join(tempRoot, 'Roaming', 'UniStudy');
    const appDataRoot = path.join(tempRoot, 'Roaming');
    const portableRoot = path.join(tempRoot, 'UniStudy-portable', 'UniStudyData');
    const app = createAppStub(defaultUserData, path.join(tempRoot, 'UniStudy-portable', 'UniStudy.exe'), appDataRoot);

    try {
        await fs.ensureDir(portableRoot);
        await fs.outputFile(path.join(portableRoot, PORTABLE_MARKER_FILE), '');

        assert.equal(resolvePortableSiblingRoot({ app }), path.resolve(portableRoot));

        const paths = resolveDataRootPaths({
            app,
            env: {},
            cwd: tempRoot,
        });

        assert.equal(paths.source, 'portable-sibling');
        assert.equal(paths.dataRoot, path.resolve(portableRoot));
        assert.equal(app.getPath('userData'), path.resolve(portableRoot));
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveDataRootPaths keeps env override ahead of portable sibling data root', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-env-priority-'));
    const defaultUserData = path.join(tempRoot, 'Roaming', 'UniStudy');
    const portableRoot = path.join(tempRoot, 'UniStudy-portable', 'UniStudyData');
    const app = createAppStub(defaultUserData, path.join(tempRoot, 'UniStudy-portable', 'UniStudy.exe'));

    try {
        await fs.ensureDir(portableRoot);
        await fs.outputFile(path.join(portableRoot, PORTABLE_MARKER_FILE), '');

        const paths = resolveDataRootPaths({
            app,
            env: { UNISTUDY_DATA_ROOT: 'ExplicitData' },
            cwd: tempRoot,
        });

        assert.equal(paths.source, 'env-override');
        assert.equal(paths.dataRoot, path.resolve(tempRoot, 'ExplicitData'));
        assert.equal(app.getPath('userData'), path.resolve(tempRoot, 'ExplicitData'));
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveInstalledContestRoot falls back beside userData when appData is unavailable', () => {
    const defaultUserData = path.join('C:', 'Users', 'CHENXI', 'AppData', 'Roaming', 'UniStudy');
    const app = createAppStub(defaultUserData);

    assert.equal(
        resolveInstalledContestRoot({ app }),
        path.join(path.dirname(path.resolve(defaultUserData)), 'UniStudyContest')
    );
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

        assert.equal(paths.source, 'installed-contest-userData');
        assert.equal(paths.dataRoot, path.join(path.dirname(path.resolve(defaultUserData)), 'UniStudyContest'));
        assert.equal(app.getPath('userData'), path.join(path.dirname(path.resolve(defaultUserData)), 'UniStudyContest'));
    } finally {
        await fs.remove(tempRoot);
    }
});

const fs = require('fs');
const path = require('path');

const DEFAULT_INSTALLED_DATA_ROOT_NAME = 'UniStudyContest';
const PORTABLE_DATA_ROOT_NAME = 'UniStudyData';
const PORTABLE_MARKER_FILE = '.unistudy-portable';

function hasMeaningfulDataRoot(rootPath) {
    if (!rootPath) {
        return false;
    }

    const checks = [
        path.join(rootPath, 'settings.json'),
        path.join(rootPath, 'Agents'),
        path.join(rootPath, 'UserData'),
        path.join(rootPath, 'KnowledgeBase'),
        path.join(rootPath, 'Notes'),
    ];

    return checks.some((targetPath) => fs.existsSync(targetPath));
}

function resolveOverrideRoot(env = process.env, cwd = process.cwd()) {
    const rawOverride = String(env.UNISTUDY_DATA_ROOT || '').trim();
    if (!rawOverride) {
        return null;
    }

    return path.resolve(cwd, rawOverride);
}

function canWriteDirectory(directoryPath) {
    try {
        fs.accessSync(directoryPath, fs.constants.W_OK);
        return true;
    } catch (_error) {
        return false;
    }
}

function resolvePortableSiblingRoot({ app, portableDirName = PORTABLE_DATA_ROOT_NAME } = {}) {
    if (!app || typeof app.getPath !== 'function') {
        return null;
    }

    let exePath = '';
    try {
        exePath = app.getPath('exe');
    } catch (_error) {
        exePath = '';
    }

    if (!exePath) {
        return null;
    }

    const candidate = path.join(path.dirname(exePath), portableDirName);
    const markerPath = path.join(candidate, PORTABLE_MARKER_FILE);
    try {
        return fs.existsSync(markerPath)
            && fs.existsSync(candidate)
            && fs.statSync(candidate).isDirectory()
            && canWriteDirectory(candidate)
            ? path.resolve(candidate)
            : null;
    } catch (_error) {
        return null;
    }
}

function resolveInstalledContestRoot({ app } = {}) {
    if (!app || typeof app.getPath !== 'function') {
        return null;
    }

    try {
        const appDataRoot = app.getPath('appData');
        if (appDataRoot) {
            return path.resolve(appDataRoot, DEFAULT_INSTALLED_DATA_ROOT_NAME);
        }
    } catch (_error) {
        // Fall through to Electron's userData path when appData is unavailable in tests.
    }

    try {
        const userDataRoot = app.getPath('userData');
        if (userDataRoot) {
            return path.resolve(path.dirname(userDataRoot), DEFAULT_INSTALLED_DATA_ROOT_NAME);
        }
    } catch (_error) {
        return null;
    }

    return null;
}

function resolveLegacyProjectRoot(cwd = process.cwd()) {
    const candidate = path.resolve(cwd, 'AppData');
    return hasMeaningfulDataRoot(candidate) ? candidate : null;
}

function resolveDataRootPaths({ app, env = process.env, cwd = process.cwd() }) {
    if (!app || typeof app.getPath !== 'function' || typeof app.setPath !== 'function') {
        throw new Error('resolveDataRootPaths requires an Electron app with getPath/setPath support.');
    }

    const overrideRoot = resolveOverrideRoot(env, cwd);
    const portableRoot = overrideRoot ? null : resolvePortableSiblingRoot({ app });
    const installedContestRoot = overrideRoot || portableRoot ? null : resolveInstalledContestRoot({ app });
    const selectedRoot = overrideRoot || portableRoot || installedContestRoot;
    if (selectedRoot) {
        app.setPath('userData', selectedRoot);
    }

    const dataRoot = path.resolve(app.getPath('userData'));
    const resolveInDataRoot = (...segments) => path.join(dataRoot, ...segments);

    return {
        dataRoot,
        source: overrideRoot
            ? 'env-override'
            : (portableRoot ? 'portable-sibling' : 'installed-contest-userData'),
        agentsDir: resolveInDataRoot('Agents'),
        userDataDir: resolveInDataRoot('UserData'),
        settingsFile: resolveInDataRoot('settings.json'),
        userAvatarFile: resolveInDataRoot('UserData', 'user_avatar.png'),
        avatarImageDir: resolveInDataRoot('avatarimage'),
        resolveInDataRoot,
    };
}

module.exports = {
    DEFAULT_INSTALLED_DATA_ROOT_NAME,
    PORTABLE_DATA_ROOT_NAME,
    PORTABLE_MARKER_FILE,
    canWriteDirectory,
    hasMeaningfulDataRoot,
    resolveDataRootPaths,
    resolveInstalledContestRoot,
    resolveLegacyProjectRoot,
    resolveOverrideRoot,
    resolvePortableSiblingRoot,
};

const fs = require('fs');
const path = require('path');

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

function resolveLegacyProjectRoot(cwd = process.cwd()) {
    const candidate = path.resolve(cwd, 'AppData');
    return hasMeaningfulDataRoot(candidate) ? candidate : null;
}

function resolveDataRootPaths({ app, env = process.env, cwd = process.cwd() }) {
    if (!app || typeof app.getPath !== 'function' || typeof app.setPath !== 'function') {
        throw new Error('resolveDataRootPaths requires an Electron app with getPath/setPath support.');
    }

    const overrideRoot = resolveOverrideRoot(env, cwd);
    if (overrideRoot) {
        app.setPath('userData', overrideRoot);
    }

    const dataRoot = path.resolve(app.getPath('userData'));
    const resolveInDataRoot = (...segments) => path.join(dataRoot, ...segments);

    return {
        dataRoot,
        source: overrideRoot ? 'env-override' : 'electron-userData',
        agentsDir: resolveInDataRoot('Agents'),
        userDataDir: resolveInDataRoot('UserData'),
        settingsFile: resolveInDataRoot('settings.json'),
        userAvatarFile: resolveInDataRoot('UserData', 'user_avatar.png'),
        avatarImageDir: resolveInDataRoot('avatarimage'),
        resolveInDataRoot,
    };
}

module.exports = {
    hasMeaningfulDataRoot,
    resolveDataRootPaths,
    resolveLegacyProjectRoot,
    resolveOverrideRoot,
};

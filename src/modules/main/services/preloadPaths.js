const fs = require('fs');
const path = require('path');

const PRELOAD_ROLES = Object.freeze({
    LITE: 'lite',
    VIEWER: 'viewer',
});

function assertKnownRole(role) {
    if (!Object.values(PRELOAD_ROLES).includes(role)) {
        throw new Error(`[PreloadPaths] Unknown preload role: ${role}`);
    }
}

function resolveValidatedPreload(preloadRoot, role, ownerLabel) {
    assertKnownRole(role);

    const preloadPath = path.resolve(preloadRoot, `${role}.bundle.js`);
    if (!fs.existsSync(preloadPath)) {
        throw new Error(`[PreloadPaths] Missing ${ownerLabel} preload entry: ${preloadPath}`);
    }

    return preloadPath;
}

function resolveProjectPreload(projectRoot, role) {
    return resolveValidatedPreload(path.join(projectRoot, 'preloads', 'runtime'), role, 'project');
}

function resolveAppPreload(appRoot, role) {
    return resolveValidatedPreload(path.join(appRoot, 'src', 'preloads', 'runtime'), role, 'app');
}

module.exports = {
    PRELOAD_ROLES,
    resolveProjectPreload,
    resolveAppPreload,
    resolveValidatedPreload,
};

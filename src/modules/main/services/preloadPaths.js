const path = require('path');

const PRELOAD_ROLES = Object.freeze({
    LITE: 'lite',
    VIEWER: 'viewer',
});

function resolvePreloadPathFromBase(basePath, role) {
    return path.join(basePath, 'preloads', `${role}.js`);
}

function resolveProjectPreload(projectRoot, role) {
    return resolvePreloadPathFromBase(projectRoot, role);
}

function resolveAppPreload(appRoot, role) {
    return path.join(appRoot, 'src', 'preloads', `${role}.js`);
}

module.exports = {
    PRELOAD_ROLES,
    resolveProjectPreload,
    resolveAppPreload,
};

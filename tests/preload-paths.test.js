const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    PRELOAD_ROLES,
    resolveAppPreload,
    resolveProjectPreload,
} = require('../src/modules/main/services/preloadPaths');

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('resolveProjectPreload returns the absolute lite preload path when it exists', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-preload-project-root-'));
    const projectSrcRoot = path.join(tempRoot, 'src');
    const expectedPath = path.join(projectSrcRoot, 'preloads', 'runtime', 'lite.bundle.js');

    try {
        await fs.ensureDir(path.dirname(expectedPath));
        await fs.writeFile(expectedPath, 'module.exports = {};', 'utf8');

        assert.equal(resolveProjectPreload(projectSrcRoot, PRELOAD_ROLES.LITE), expectedPath);
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveAppPreload returns the absolute viewer preload path when it exists', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-preload-app-root-'));
    const expectedPath = path.join(tempRoot, 'src', 'preloads', 'runtime', 'viewer.bundle.js');

    try {
        await fs.ensureDir(path.dirname(expectedPath));
        await fs.writeFile(expectedPath, 'module.exports = {};', 'utf8');

        assert.equal(resolveAppPreload(tempRoot, PRELOAD_ROLES.VIEWER), expectedPath);
    } finally {
        await fs.remove(tempRoot);
    }
});

test('resolveProjectPreload throws a path-rich error when the preload file is missing', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-preload-missing-root-'));
    const projectSrcRoot = path.join(tempRoot, 'src');
    const expectedPath = path.join(projectSrcRoot, 'preloads', 'runtime', 'lite.bundle.js');

    try {
        assert.throws(
            () => resolveProjectPreload(projectSrcRoot, PRELOAD_ROLES.LITE),
            (error) => {
                assert.match(error.message, /\[PreloadPaths\] Missing project preload entry:/);
                assert.match(error.message, new RegExp(escapeRegExp(expectedPath)));
                return true;
            },
        );
    } finally {
        await fs.remove(tempRoot);
    }
});

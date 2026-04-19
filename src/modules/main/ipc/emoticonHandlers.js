const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');
const {
    invalidateBundledEmoticonCatalog,
    loadBundledEmoticonCatalog,
} = require('../emoticons/bundledCatalog');

let emoticonLibrary = [];
let userEmoticonLibrary = [];
let bundledEmoticonLibrary = [];
let emoticonLibraryPath = '';
let emoticonAssetsDir = '';
let generatedListsPath = '';
let projectRoot = '';
let handlersRegistered = false;

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags.map((tag) => sanitizeText(tag)).filter(Boolean);
    }

    return String(tags || '')
        .split(/[,\n|]/)
        .map((tag) => sanitizeText(tag))
        .filter(Boolean);
}

function buildAssetUrl(assetPath) {
    return pathToFileURL(assetPath).toString();
}

function normalizeLibraryItem(item = {}) {
    const category = sanitizeText(item.category || item.group, '未分类');
    const name = sanitizeText(item.name || item.filename, '表情');
    const filename = sanitizeText(item.filename || path.basename(item.assetPath || ''), `${name}.png`);
    const assetPath = sanitizeText(item.assetPath);
    const url = assetPath ? buildAssetUrl(assetPath) : sanitizeText(item.url);
    const createdAt = Number(item.createdAt);
    const updatedAt = Number(item.updatedAt);

    return {
        id: sanitizeText(item.id, makeId('emoticon')),
        name,
        filename,
        category,
        group: category,
        tags: normalizeTags(item.tags),
        assetPath,
        url,
        renderPath: sanitizeText(item.renderPath, ''),
        readonly: item.readonly === true,
        source: sanitizeText(item.source, 'user'),
        searchKey: `${category.toLowerCase()}/${name.toLowerCase()}/${filename.toLowerCase()}/${normalizeTags(item.tags).join('/')}`,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
}

async function ensureStorage() {
    await fs.ensureDir(path.dirname(emoticonLibraryPath));
    await fs.ensureDir(emoticonAssetsDir);
}

async function loadBundledLibrary(options = {}) {
    const catalog = await loadBundledEmoticonCatalog({
        projectRoot,
        dataRoot: generatedListsPath ? path.dirname(generatedListsPath) : '',
        force: options.forceBundled === true,
    });
    bundledEmoticonLibrary = catalog.items.map((item) => normalizeLibraryItem(item));
    return bundledEmoticonLibrary;
}

async function loadUserLibrary() {
    await ensureStorage();
    if (!await fs.pathExists(emoticonLibraryPath)) {
        userEmoticonLibrary = [];
        return userEmoticonLibrary;
    }

    const payload = await fs.readJson(emoticonLibraryPath).catch(() => []);
    userEmoticonLibrary = Array.isArray(payload)
        ? payload.map((item) => normalizeLibraryItem(item))
        : [];
    return userEmoticonLibrary;
}

async function loadLibrary(options = {}) {
    await loadBundledLibrary(options);
    await loadUserLibrary();
    emoticonLibrary = [
        ...bundledEmoticonLibrary,
        ...userEmoticonLibrary,
    ];
    return emoticonLibrary;
}

async function saveLibrary() {
    await ensureStorage();
    await fs.writeJson(emoticonLibraryPath, userEmoticonLibrary, { spaces: 2 });
}

async function copyAssetIntoLibrary(sourcePath) {
    const sourceName = path.basename(sourcePath);
    const ext = path.extname(sourceName) || '.png';
    const baseName = path.basename(sourceName, ext)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'emoticon';
    const targetPath = path.join(emoticonAssetsDir, `${baseName}_${Date.now()}${ext.toLowerCase()}`);
    await fs.copy(sourcePath, targetPath, { overwrite: true });
    return targetPath;
}

async function initialize(paths) {
    const libraryRoot = path.join(paths.DATA_ROOT, 'Emoticons');
    emoticonLibraryPath = path.join(libraryRoot, 'library.json');
    emoticonAssetsDir = path.join(libraryRoot, 'assets');
    generatedListsPath = path.join(paths.DATA_ROOT, 'generated_lists');
    projectRoot = sanitizeText(paths.PROJECT_ROOT, '');
    await loadLibrary({ forceBundled: true });
}

async function saveEmoticonItem(payload = {}) {
    await loadLibrary();
    if (payload?.id && bundledEmoticonLibrary.some((item) => item.id === payload.id)) {
        throw new Error('Bundled emoticons are read-only.');
    }

    const existingIndex = userEmoticonLibrary.findIndex((item) => item.id === payload.id);
    const existing = existingIndex >= 0 ? userEmoticonLibrary[existingIndex] : null;
    let assetPath = existing?.assetPath || '';
    if (sanitizeText(payload.sourcePath)) {
        assetPath = await copyAssetIntoLibrary(payload.sourcePath);
    }

    const nextItem = normalizeLibraryItem({
        ...existing,
        ...payload,
        assetPath,
        updatedAt: Date.now(),
        createdAt: existing?.createdAt || Date.now(),
    });

    if (existingIndex >= 0) {
        userEmoticonLibrary[existingIndex] = nextItem;
    } else {
        userEmoticonLibrary.unshift(nextItem);
    }

    await saveLibrary();
    await loadLibrary();
    return nextItem;
}

async function deleteEmoticonItem(id) {
    await loadLibrary();
    if (bundledEmoticonLibrary.some((item) => item.id === id)) {
        throw new Error('Bundled emoticons cannot be deleted.');
    }

    const existing = userEmoticonLibrary.find((item) => item.id === id);
    userEmoticonLibrary = userEmoticonLibrary.filter((item) => item.id !== id);
    await saveLibrary();
    await loadLibrary();

    if (existing?.assetPath && await fs.pathExists(existing.assetPath)) {
        await fs.remove(existing.assetPath).catch(() => {});
    }
}

async function importEmoticonItems(payload = {}) {
    await loadUserLibrary();
    const items = Array.isArray(payload.items)
        ? payload.items
        : (Array.isArray(payload.paths) ? payload.paths.map((sourcePath) => ({ sourcePath })) : []);
    const imported = [];

    for (const item of items) {
        if (!sanitizeText(item.sourcePath)) {
            continue;
        }

        const saved = await saveEmoticonItem({
            sourcePath: item.sourcePath,
            name: item.name || path.basename(item.sourcePath, path.extname(item.sourcePath)),
            filename: path.basename(item.sourcePath),
            category: item.category || item.group || '未分类',
            tags: item.tags || [],
        });
        imported.push(saved);
    }

    return imported;
}

function setupEmoticonHandlers() {
    if (handlersRegistered) {
        return;
    }

    ipcMain.handle('get-emoticon-library', async () => loadLibrary());
    ipcMain.handle('list-emoticon-library', async () => ({
        success: true,
        items: await loadLibrary(),
    }));
    ipcMain.handle('save-emoticon-item', async (_event, payload) => {
        try {
            return { success: true, item: await saveEmoticonItem(payload) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('delete-emoticon-item', async (_event, id) => {
        try {
            await deleteEmoticonItem(id);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle('import-emoticon-items', async (_event, payload) => {
        try {
            return {
                success: true,
                items: await importEmoticonItems(payload),
            };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.on('regenerate-emoticon-library', async () => {
        invalidateBundledEmoticonCatalog();
        await loadLibrary({ forceBundled: true });
    });

    handlersRegistered = true;
}

module.exports = {
    deleteEmoticonItem,
    getEmoticonLibrary: () => emoticonLibrary,
    importEmoticonItems,
    initialize,
    loadLibrary,
    saveEmoticonItem,
    setupEmoticonHandlers,
};

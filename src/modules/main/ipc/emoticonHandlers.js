const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');

let emoticonLibrary = [];
let emoticonLibraryPath = '';
let emoticonAssetsDir = '';
let legacyGeneratedListsPath = '';
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

    return {
        id: sanitizeText(item.id, makeId('emoticon')),
        name,
        filename,
        category,
        group: category,
        tags: normalizeTags(item.tags),
        assetPath,
        url,
        searchKey: `${category.toLowerCase()}/${name.toLowerCase()}/${normalizeTags(item.tags).join('/')}`,
        createdAt: Number(item.createdAt || Date.now()),
        updatedAt: Number(item.updatedAt || Date.now()),
    };
}

async function ensureStorage() {
    await fs.ensureDir(path.dirname(emoticonLibraryPath));
    await fs.ensureDir(emoticonAssetsDir);
}

async function loadLibrary() {
    await ensureStorage();
    if (!await fs.pathExists(emoticonLibraryPath)) {
        emoticonLibrary = [];
        return emoticonLibrary;
    }

    const payload = await fs.readJson(emoticonLibraryPath).catch(() => []);
    emoticonLibrary = Array.isArray(payload)
        ? payload.map((item) => normalizeLibraryItem(item))
        : [];
    return emoticonLibrary;
}

async function saveLibrary() {
    await ensureStorage();
    await fs.writeJson(emoticonLibraryPath, emoticonLibrary, { spaces: 2 });
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

async function importLegacyGeneratedLists() {
    if (!await fs.pathExists(legacyGeneratedListsPath)) {
        return [];
    }

    const files = await fs.readdir(legacyGeneratedListsPath).catch(() => []);
    const txtFiles = files.filter((fileName) => fileName.endsWith('表情包.txt'));
    const imported = [];

    for (const txtFile of txtFiles) {
        const category = path.basename(txtFile, '.txt');
        const fileContent = await fs.readFile(path.join(legacyGeneratedListsPath, txtFile), 'utf8').catch(() => '');
        const names = fileContent.split('|').map((item) => item.trim()).filter(Boolean);
        for (const name of names) {
            imported.push(normalizeLibraryItem({
                name: path.basename(name, path.extname(name)),
                filename: name,
                category,
                tags: [],
                assetPath: '',
                url: '',
            }));
        }
    }

    return imported;
}

async function initialize(paths) {
    const libraryRoot = path.join(paths.DATA_ROOT, 'Emoticons');
    emoticonLibraryPath = path.join(libraryRoot, 'library.json');
    emoticonAssetsDir = path.join(libraryRoot, 'assets');
    legacyGeneratedListsPath = path.join(paths.DATA_ROOT, 'generated_lists');
    await loadLibrary();
}

async function saveEmoticonItem(payload = {}) {
    await loadLibrary();
    const existingIndex = emoticonLibrary.findIndex((item) => item.id === payload.id);
    const existing = existingIndex >= 0 ? emoticonLibrary[existingIndex] : null;
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
        emoticonLibrary[existingIndex] = nextItem;
    } else {
        emoticonLibrary.unshift(nextItem);
    }

    await saveLibrary();
    return nextItem;
}

async function deleteEmoticonItem(id) {
    await loadLibrary();
    const existing = emoticonLibrary.find((item) => item.id === id);
    emoticonLibrary = emoticonLibrary.filter((item) => item.id !== id);
    await saveLibrary();

    if (existing?.assetPath && await fs.pathExists(existing.assetPath)) {
        await fs.remove(existing.assetPath).catch(() => {});
    }
}

async function importEmoticonItems(payload = {}) {
    await loadLibrary();
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
        if (emoticonLibrary.length > 0) {
            return;
        }

        emoticonLibrary = await importLegacyGeneratedLists();
        await saveLibrary();
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

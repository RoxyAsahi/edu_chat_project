const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');

const TOKEN_PATTERN = /{{\s*([A-Za-z0-9_]+)\s*}}/g;
const DEFAULT_GENERAL_PACK_NAME = '通用表情包';
const DEFAULT_EMOTICON_PROMPT = [
    'This client supports local emoticon packs rendered from pseudo paths.',
    'Available emoticon packs:',
    '{{EmoticonPackSummary}}',
    'Primary generic pack path: {{GeneralEmoticonPath}}',
    'Generic pack files: {{GeneralEmoticonList}}',
    'When you want to use an emoticon, output HTML like <img src="{{GeneralEmoticonPath}}/文件名" width="120">.',
    'Only use filenames from the provided lists, keep width between 60 and 180, and do not invent missing files.',
].join('\n');
const SUPPORTED_EMOTICON_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
]);

let bundledCatalogCache = {
    key: '',
    value: null,
};

function resolveProjectRoot(projectRoot = '') {
    const normalized = typeof projectRoot === 'string' ? projectRoot.trim() : '';
    if (normalized) {
        return path.resolve(normalized);
    }

    return path.resolve(__dirname, '../../../..');
}

function sortByLocale(left = '', right = '') {
    return String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base',
    });
}

function sortPackNames(left = '', right = '') {
    if (left === DEFAULT_GENERAL_PACK_NAME && right !== DEFAULT_GENERAL_PACK_NAME) {
        return -1;
    }
    if (right === DEFAULT_GENERAL_PACK_NAME && left !== DEFAULT_GENERAL_PACK_NAME) {
        return 1;
    }
    return sortByLocale(left, right);
}

function isSupportedEmoticonFile(fileName = '') {
    return SUPPORTED_EMOTICON_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

function buildPseudoPath(category = '', fileName = '') {
    return `/${category}/${fileName}`;
}

function buildBundledItem(category = '', packRoot = '', fileName = '') {
    const assetPath = path.join(packRoot, fileName);
    return {
        id: `bundled:${category}:${fileName}`,
        name: path.basename(fileName, path.extname(fileName)),
        filename: fileName,
        category,
        group: category,
        tags: [],
        assetPath,
        url: pathToFileURL(assetPath).toString(),
        renderPath: buildPseudoPath(category, fileName),
        readonly: true,
        source: 'bundled',
        createdAt: 0,
        updatedAt: 0,
    };
}

async function scanBundledEmoticonPacks(options = {}) {
    const projectRoot = resolveProjectRoot(options.projectRoot);
    const rootEntries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
    const packDirs = rootEntries
        .filter((entry) => entry?.isDirectory?.() && /表情包$/u.test(entry.name))
        .map((entry) => entry.name)
        .sort(sortPackNames);

    const packs = [];

    for (const category of packDirs) {
        const packRoot = path.join(projectRoot, category);
        const files = await fs.readdir(packRoot, { withFileTypes: true }).catch(() => []);
        const fileNames = files
            .filter((entry) => entry?.isFile?.() && isSupportedEmoticonFile(entry.name))
            .map((entry) => entry.name)
            .sort(sortByLocale);

        packs.push({
            category,
            packRoot,
            relativePath: `/${category}`,
            fileNames,
            listText: fileNames.join('|'),
            items: fileNames.map((fileName) => buildBundledItem(category, packRoot, fileName)),
        });
    }

    return packs;
}

async function writeGeneratedLists(dataRoot = '', packs = []) {
    const normalizedDataRoot = typeof dataRoot === 'string' ? dataRoot.trim() : '';
    if (!normalizedDataRoot) {
        return [];
    }

    const generatedListsDir = path.join(normalizedDataRoot, 'generated_lists');
    await fs.ensureDir(generatedListsDir);

    const writtenPaths = [];
    for (const pack of packs) {
        const targetPath = path.join(generatedListsDir, `${pack.category}.txt`);
        await fs.writeFile(targetPath, pack.listText, 'utf8');
        writtenPaths.push(targetPath);
    }

    return writtenPaths;
}

function buildPackSummary(packs = []) {
    return packs
        .filter((pack) => Array.isArray(pack.fileNames) && pack.fileNames.length > 0)
        .map((pack) => `${pack.category} (${pack.relativePath}): ${pack.listText}`)
        .join('\n');
}

function buildCatalogVariables(packs = []) {
    const generalPack = packs.find((pack) => pack.category === DEFAULT_GENERAL_PACK_NAME) || packs[0] || null;
    return {
        GeneralEmoticonPath: generalPack?.relativePath || '',
        GeneralEmoticonList: generalPack?.listText || '',
        EmoticonPackSummary: buildPackSummary(packs),
    };
}

function interpolateTemplate(template = '', variables = {}) {
    return String(template || '').replace(TOKEN_PATTERN, (match, token) => {
        const value = variables[token];
        return typeof value === 'string' ? value : match;
    });
}

function getCacheKey(projectRoot = '', dataRoot = '') {
    return `${resolveProjectRoot(projectRoot)}::${path.resolve(String(dataRoot || '.'))}`;
}

async function loadBundledEmoticonCatalog(options = {}) {
    const projectRoot = resolveProjectRoot(options.projectRoot);
    const dataRoot = typeof options.dataRoot === 'string' ? options.dataRoot.trim() : '';
    const cacheKey = getCacheKey(projectRoot, dataRoot);

    if (options.force !== true && bundledCatalogCache.key === cacheKey && bundledCatalogCache.value) {
        return bundledCatalogCache.value;
    }

    const packs = await scanBundledEmoticonPacks({ projectRoot });
    const generatedListPaths = await writeGeneratedLists(dataRoot, packs);
    const catalog = {
        projectRoot,
        dataRoot,
        packs,
        items: packs.flatMap((pack) => pack.items),
        variables: buildCatalogVariables(packs),
        generatedListPaths,
    };

    bundledCatalogCache = {
        key: cacheKey,
        value: catalog,
    };

    return catalog;
}

async function loadBundledEmoticonPromptData(options = {}) {
    const catalog = await loadBundledEmoticonCatalog(options);
    const settings = options.settings && typeof options.settings === 'object' ? options.settings : {};
    const promptTemplate = typeof settings.emoticonPrompt === 'string' && settings.emoticonPrompt.trim()
        ? settings.emoticonPrompt
        : DEFAULT_EMOTICON_PROMPT;

    return {
        ...catalog,
        available: catalog.items.length > 0,
        packCount: catalog.packs.length,
        promptTemplate,
        resolvedPrompt: interpolateTemplate(promptTemplate, catalog.variables),
    };
}

function invalidateBundledEmoticonCatalog() {
    bundledCatalogCache = {
        key: '',
        value: null,
    };
}

module.exports = {
    DEFAULT_EMOTICON_PROMPT,
    DEFAULT_GENERAL_PACK_NAME,
    buildPseudoPath,
    invalidateBundledEmoticonCatalog,
    loadBundledEmoticonCatalog,
    loadBundledEmoticonPromptData,
};

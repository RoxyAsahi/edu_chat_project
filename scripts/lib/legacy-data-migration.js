const fs = require('fs-extra');
const path = require('path');

const MANAGED_RELATIVE_PATHS = Object.freeze([
    'Agents',
    'UserData',
    'KnowledgeBase',
    'Notes',
    'avatarimage',
    'generated_lists',
    'settings.json',
    'settings.json.backup',
    'model_usage_stats.json',
]);

function createStamp(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function collectExistingManagedEntries(rootPath) {
    const entries = [];

    for (const relativePath of MANAGED_RELATIVE_PATHS) {
        const absolutePath = path.join(rootPath, relativePath);
        if (!await fs.pathExists(absolutePath)) {
            continue;
        }

        const stats = await fs.stat(absolutePath);
        entries.push({
            relativePath,
            absolutePath,
            kind: stats.isDirectory() ? 'directory' : 'file',
        });
    }

    return entries;
}

async function backupManagedEntries(entries, backupRoot) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    await fs.ensureDir(backupRoot);

    for (const entry of entries) {
        await fs.copy(entry.absolutePath, path.join(backupRoot, entry.relativePath), {
            overwrite: true,
            recursive: true,
            errorOnExist: false,
        });
    }

    return entries.map((entry) => entry.relativePath);
}

async function removeManagedEntries(entries) {
    for (const entry of entries) {
        await fs.remove(entry.absolutePath);
    }
}

async function copyManagedEntries(entries, sourceRoot, targetRoot) {
    for (const entry of entries) {
        await fs.copy(
            path.join(sourceRoot, entry.relativePath),
            path.join(targetRoot, entry.relativePath),
            {
                overwrite: true,
                recursive: true,
                errorOnExist: false,
            },
        );
    }
}

async function migrateLegacyProjectData({
    sourceRoot,
    targetRoot,
    backupRoot,
    stamp = createStamp(),
}) {
    const normalizedSourceRoot = path.resolve(sourceRoot);
    const normalizedTargetRoot = path.resolve(targetRoot);

    if (normalizedSourceRoot === normalizedTargetRoot) {
        throw new Error('Legacy data migration requires different sourceRoot and targetRoot.');
    }

    const sourceEntries = await collectExistingManagedEntries(normalizedSourceRoot);
    if (sourceEntries.length === 0) {
        throw new Error(`No managed legacy data found at ${normalizedSourceRoot}`);
    }

    await fs.ensureDir(normalizedTargetRoot);

    const effectiveBackupRoot = backupRoot
        ? path.resolve(backupRoot)
        : path.join(normalizedTargetRoot, '.migration-backups', `legacy-project-${stamp}`);
    const targetEntries = await collectExistingManagedEntries(normalizedTargetRoot);
    const backedUp = await backupManagedEntries(targetEntries, effectiveBackupRoot);

    await removeManagedEntries(targetEntries);
    await copyManagedEntries(sourceEntries, normalizedSourceRoot, normalizedTargetRoot);

    const report = {
        migratedAt: new Date().toISOString(),
        sourceRoot: normalizedSourceRoot,
        targetRoot: normalizedTargetRoot,
        backupRoot: effectiveBackupRoot,
        copiedEntries: sourceEntries.map((entry) => entry.relativePath),
        backedUpEntries: backedUp,
    };

    await fs.ensureDir(effectiveBackupRoot);
    await fs.writeJson(path.join(effectiveBackupRoot, 'migration-report.json'), report, { spaces: 2 });

    return report;
}

module.exports = {
    MANAGED_RELATIVE_PATHS,
    collectExistingManagedEntries,
    createStamp,
    migrateLegacyProjectData,
};

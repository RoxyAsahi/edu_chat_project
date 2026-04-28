const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');

async function copyMissingTree(sourcePath, targetPath) {
    if (!await fs.pathExists(sourcePath)) {
        return { copiedFiles: 0, skippedFiles: 0, copiedFilePaths: [] };
    }

    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
        await fs.ensureDir(targetPath);
        let copiedFiles = 0;
        let skippedFiles = 0;
        const copiedFilePaths = [];
        const entries = await fs.readdir(sourcePath);

        for (const entry of entries) {
            const childResult = await copyMissingTree(
                path.join(sourcePath, entry),
                path.join(targetPath, entry),
            );
            copiedFiles += childResult.copiedFiles;
            skippedFiles += childResult.skippedFiles;
            copiedFilePaths.push(...childResult.copiedFilePaths);
        }

        return { copiedFiles, skippedFiles, copiedFilePaths };
    }

    if (await fs.pathExists(targetPath)) {
        return { copiedFiles: 0, skippedFiles: 1, copiedFilePaths: [] };
    }

    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(sourcePath, targetPath, { overwrite: false, errorOnExist: false });
    return { copiedFiles: 1, skippedFiles: 0, copiedFilePaths: [targetPath] };
}

async function hydrateHistoryAttachmentPaths(historyPath, dataRoot) {
    let history;
    try {
        history = await fs.readJson(historyPath);
    } catch (_error) {
        return false;
    }

    if (!Array.isArray(history)) {
        return false;
    }

    let changed = false;
    const attachmentsDir = path.join(dataRoot, 'UserData', 'attachments');

    for (const message of history) {
        if (!Array.isArray(message?.attachments)) {
            continue;
        }

        for (const attachment of message.attachments) {
            if (!attachment?.internalFileName) {
                continue;
            }
            const attachmentUrl = pathToFileURL(path.join(attachmentsDir, attachment.internalFileName)).href;
            if (attachment.internalPath !== attachmentUrl) {
                attachment.internalPath = attachmentUrl;
                changed = true;
            }
            if (attachment.src !== attachmentUrl) {
                attachment.src = attachmentUrl;
                changed = true;
            }
        }
    }

    if (changed) {
        await fs.writeJson(historyPath, history, { spaces: 2 });
    }

    return changed;
}

async function seedDefaultDataRoot({ dataRoot, seedRoot }) {
    if (!dataRoot || !seedRoot || !await fs.pathExists(seedRoot)) {
        return { copiedFiles: 0, skippedFiles: 0, hydratedHistories: 0, seedRootMissing: true };
    }

    const seedTargets = [
        'Agents',
        'UserData',
    ];

    let copiedFiles = 0;
    let skippedFiles = 0;
    const copiedFilePaths = [];

    for (const targetName of seedTargets) {
        const result = await copyMissingTree(
            path.join(seedRoot, targetName),
            path.join(dataRoot, targetName),
        );
        copiedFiles += result.copiedFiles;
        skippedFiles += result.skippedFiles;
        copiedFilePaths.push(...result.copiedFilePaths);
    }

    let hydratedHistories = 0;
    for (const copiedPath of copiedFilePaths) {
        if (path.basename(copiedPath) === 'history.json'
            && await hydrateHistoryAttachmentPaths(copiedPath, dataRoot)) {
            hydratedHistories += 1;
        }
    }

    return {
        copiedFiles,
        skippedFiles,
        hydratedHistories,
        seedRootMissing: false,
    };
}

module.exports = {
    copyMissingTree,
    hydrateHistoryAttachmentPaths,
    seedDefaultDataRoot,
};

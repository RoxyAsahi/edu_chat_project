const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

function createDocumentStore(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const enqueueDocument = deps.enqueueDocument || (() => {});
    const fsImpl = deps.fs || fs;
    const pathImpl = deps.path || path;
    const cryptoImpl = deps.crypto || crypto;

    async function copyDocumentToStore(sourcePath, displayName) {
        const buffer = await fsImpl.readFile(sourcePath);
        const hash = cryptoImpl.createHash('sha256').update(buffer).digest('hex');
        const ext = pathImpl.extname(displayName || sourcePath);
        const storedPath = pathImpl.join(runtime.getFilesRoot(), `${hash}${ext}`);
        await fsImpl.ensureDir(pathImpl.dirname(storedPath));
        if (!await fsImpl.pathExists(storedPath)) {
            await fsImpl.writeFile(storedPath, buffer);
        }
        return {
            hash,
            storedPath,
            fileSize: buffer.length,
        };
    }

    async function removeUnreferencedStoredFiles(storedPaths = []) {
        const uniquePaths = [...new Set(
            (Array.isArray(storedPaths) ? storedPaths : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean),
        )];
        if (uniquePaths.length === 0) {
            return;
        }

        for (const storedPath of uniquePaths) {
            const refCount = await repository.countDocumentsByStoredPath(storedPath);
            if (refCount === 0) {
                await fsImpl.remove(storedPath).catch(() => {});
            }
        }
    }

    async function importKnowledgeBaseFiles(kbId, files = []) {
        const kb = await repository.getKnowledgeBaseById(kbId);
        if (!kb) {
            throw new Error('Knowledge base not found.');
        }

        if (!Array.isArray(files) || files.length === 0) {
            return [];
        }

        const imported = [];
        for (const file of files) {
            const sourcePath = String(file?.path || '').trim();
            if (!sourcePath) {
                continue;
            }

            const displayName = String(file?.name || pathImpl.basename(sourcePath));
            const { hash, storedPath, fileSize } = await copyDocumentToStore(sourcePath, displayName);
            const duplicateId = await repository.findDocumentIdByHash(kbId, hash);
            if (duplicateId) {
                const duplicateDocument = await repository.getDocumentById(duplicateId);
                if (duplicateDocument?.status === 'failed') {
                    await repository.updateDocumentState(duplicateId, {
                        status: 'pending',
                        error: null,
                        lastError: null,
                        chunkCount: 0,
                        processedAt: null,
                        processingStartedAt: null,
                        failedAt: null,
                        completedAt: null,
                    });
                    await repository.updateDocumentGuideState(duplicateId, {
                        guideStatus: 'idle',
                        guideMarkdown: '',
                        guideGeneratedAt: null,
                        guideError: null,
                    });
                    enqueueDocument(duplicateId);
                    imported.push(await repository.getDocumentById(duplicateId));
                } else {
                    imported.push(duplicateDocument);
                }
                continue;
            }

            const document = await repository.createDocument({
                kbId,
                name: displayName,
                storedPath,
                mimeType: file?.type || '',
                fileSize,
                fileHash: hash,
            });
            imported.push(document);
            enqueueDocument(document?.id);
        }

        await repository.touchKnowledgeBase(kbId);
        return imported.filter(Boolean);
    }

    return {
        copyDocumentToStore,
        importKnowledgeBaseFiles,
        removeUnreferencedStoredFiles,
    };
}

module.exports = {
    createDocumentStore,
};

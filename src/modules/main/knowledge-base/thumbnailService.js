const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const sharp = require('sharp');
const { inferMimeType, isImageMimeType } = require('./parserAdapter');

function createKnowledgeBaseThumbnailService(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const fsImpl = deps.fs || fs;
    const pathImpl = deps.path || path;
    const osImpl = deps.os || os;
    const sharpImpl = deps.sharp || sharp;
    const cryptoImpl = deps.crypto || crypto;
    const popplerFactory = deps.popplerFactory || (() => require('pdf-poppler'));

    function getPreviewRoot() {
        const dataRoot = runtime.getState()?.dataRoot;
        if (!dataRoot) {
            throw new Error('Knowledge base runtime is not initialized.');
        }
        return pathImpl.join(dataRoot, 'KnowledgeBase', 'previews');
    }

    function buildPreviewPath(document, extension = '.png') {
        const key = [
            document.fileHash || '',
            document.storedPath || '',
            document.updatedAt || '',
            extension,
        ].join('|');
        const digest = cryptoImpl.createHash('sha256').update(key).digest('hex');
        return pathImpl.join(getPreviewRoot(), `${digest}${extension}`);
    }

    async function createImageThumbnail(document, previewPath) {
        await fsImpl.ensureDir(pathImpl.dirname(previewPath));
        if (await fsImpl.pathExists(previewPath)) {
            return previewPath;
        }

        await sharpImpl(document.storedPath)
            .rotate()
            .resize({
                width: 420,
                height: 560,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .png({ compressionLevel: 9 })
            .toFile(previewPath);
        return previewPath;
    }

    async function createPdfThumbnail(document, previewPath) {
        await fsImpl.ensureDir(pathImpl.dirname(previewPath));
        if (await fsImpl.pathExists(previewPath)) {
            return previewPath;
        }

        const tempDir = pathImpl.join(osImpl.tmpdir(), `unistudy-pdf-preview-${cryptoImpl.randomBytes(8).toString('hex')}`);
        await fsImpl.ensureDir(tempDir);
        try {
            const prefix = 'page';
            const poppler = popplerFactory();
            await poppler.convert(document.storedPath, {
                format: 'png',
                out_dir: tempDir,
                out_prefix: prefix,
                page: 1,
            });

            const files = (await fsImpl.readdir(tempDir))
                .filter((file) => file.toLowerCase().endsWith('.png'))
                .sort();
            const firstPage = files[0] ? pathImpl.join(tempDir, files[0]) : '';
            if (!firstPage) {
                throw new Error('PDF preview image was not created.');
            }

            await sharpImpl(firstPage)
                .resize({
                    width: 420,
                    height: 560,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .png({ compressionLevel: 9 })
                .toFile(previewPath);
            return previewPath;
        } finally {
            await fsImpl.remove(tempDir).catch(() => {});
        }
    }

    async function getKnowledgeBaseDocumentThumbnail(documentId) {
        const document = await repository.getDocumentById(documentId);
        if (!document) {
            throw new Error('Knowledge base document not found.');
        }
        if (!document.storedPath || !await fsImpl.pathExists(document.storedPath)) {
            return { documentId, thumbnailUrl: '', kind: 'none' };
        }

        const mimeType = String(inferMimeType(document) || '').toLowerCase();
        if (isImageMimeType(mimeType)) {
            const previewPath = await createImageThumbnail(document, buildPreviewPath(document));
            return {
                documentId,
                thumbnailUrl: pathToFileURL(previewPath).href,
                kind: 'image',
            };
        }

        if (mimeType === 'application/pdf') {
            const previewPath = await createPdfThumbnail(document, buildPreviewPath(document));
            return {
                documentId,
                thumbnailUrl: pathToFileURL(previewPath).href,
                kind: 'pdf',
            };
        }

        return { documentId, thumbnailUrl: '', kind: 'none' };
    }

    async function getExistingKnowledgeBaseDocumentThumbnail(document) {
        if (!document?.id || !document.storedPath || !await fsImpl.pathExists(document.storedPath)) {
            return { documentId: document?.id || null, thumbnailUrl: '', kind: 'none' };
        }

        const mimeType = String(inferMimeType(document) || '').toLowerCase();
        if (isImageMimeType(mimeType) || mimeType === 'application/pdf') {
            const previewPath = buildPreviewPath(document);
            if (await fsImpl.pathExists(previewPath)) {
                return {
                    documentId: document.id,
                    thumbnailUrl: pathToFileURL(previewPath).href,
                    kind: isImageMimeType(mimeType) ? 'image' : 'pdf',
                };
            }
        }

        return { documentId: document.id, thumbnailUrl: '', kind: 'none' };
    }

    return {
        getExistingKnowledgeBaseDocumentThumbnail,
        getKnowledgeBaseDocumentThumbnail,
    };
}

module.exports = {
    createKnowledgeBaseThumbnailService,
};

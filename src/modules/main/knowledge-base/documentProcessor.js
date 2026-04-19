const {
    toNumber,
    toOptionalNumber,
} = require('./helpers');

function createDocumentProcessor(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const parseKnowledgeBaseDocument = deps.parseKnowledgeBaseDocument;
    const transcribeImageDocument = deps.transcribeImageDocument || (async () => {
        throw new Error('当前 KB 无法处理该来源文件');
    });
    const inferMimeType = deps.inferMimeType || ((document) => document?.mimeType || '');
    const chunkText = deps.chunkText;
    const requestEmbeddings = deps.requestEmbeddings;
    const KB_UNSUPPORTED_OCR_ERROR = deps.KB_UNSUPPORTED_OCR_ERROR;
    const isImageMimeType = deps.isImageMimeType || (() => false);

    async function processDocument(documentId) {
        const document = await repository.getDocumentById(documentId);
        if (!document) {
            return;
        }

        await repository.updateDocumentState(documentId, {
            status: 'processing',
            error: null,
            lastError: null,
            chunkCount: 0,
            processedAt: null,
            processingStartedAt: Date.now(),
            failedAt: null,
            completedAt: null,
            attemptCount: (document.attemptCount || 0) + 1,
            contentType: document.contentType || null,
        });
        await repository.updateDocumentGuideState(documentId, {
            guideStatus: 'idle',
            guideMarkdown: '',
            guideGeneratedAt: null,
            guideError: null,
        });

        try {
            const resolvedMimeType = inferMimeType(document);
            const parsed = isImageMimeType(resolvedMimeType)
                ? await transcribeImageDocument({
                    ...document,
                    mimeType: resolvedMimeType,
                })
                : await parseKnowledgeBaseDocument(document);
            const {
                text,
                mimeType,
                contentType,
                structure,
            } = parsed;

            if (isImageMimeType(mimeType) || isImageMimeType(resolvedMimeType)) {
                await repository.updateDocumentDerivedContent(documentId, {
                    extractedText: text,
                    extractedContentType: contentType || 'markdown',
                });
                await repository.updateDocumentState(documentId, {
                    contentType: contentType || 'markdown',
                });
            }

            const chunks = chunkText(text, { contentType, structure });
            if (chunks.length === 0) {
                throw new Error(KB_UNSUPPORTED_OCR_ERROR);
            }

            const settings = await runtime.readSettings();
            const chunkInputs = chunks.map((chunk) => `${document.name}\n${chunk.content}`);
            const embeddings = await requestEmbeddings(settings, chunkInputs);

            await repository.deleteDocumentChunks(documentId);

            const createdAt = Date.now();
            for (let index = 0; index < chunks.length; index += 1) {
                await repository.insertDocumentChunk({
                    kbId: document.kbId,
                    documentId,
                    chunkIndex: index,
                    content: chunks[index].content,
                    embedding: embeddings[index],
                    createdAt,
                    contentType: chunks[index].contentType || contentType,
                    charLength: toNumber(chunks[index].charLength, chunks[index].content.length),
                    sectionTitle: chunks[index].sectionTitle,
                    pageNumber: toOptionalNumber(chunks[index].pageNumber, null),
                    paragraphIndex: toOptionalNumber(chunks[index].paragraphIndex, null),
                });
            }

            const completedAt = Date.now();
            await repository.updateDocumentState(documentId, {
                status: 'done',
                error: null,
                lastError: null,
                chunkCount: chunks.length,
                processedAt: completedAt,
                processingStartedAt: null,
                failedAt: null,
                completedAt,
                contentType,
            });
            await repository.updateDocumentGuideState(documentId, {
                guideStatus: 'idle',
                guideMarkdown: '',
                guideGeneratedAt: null,
                guideError: null,
            });
            await repository.updateDocumentMimeType(documentId, mimeType);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await repository.deleteDocumentChunks(documentId).catch(() => {});
            await repository.updateDocumentState(documentId, {
                status: 'failed',
                error: message || KB_UNSUPPORTED_OCR_ERROR,
                lastError: message || KB_UNSUPPORTED_OCR_ERROR,
                chunkCount: 0,
                processedAt: null,
                processingStartedAt: null,
                failedAt: Date.now(),
                completedAt: null,
            });
        }
    }

    return {
        processDocument,
    };
}

module.exports = {
    createDocumentProcessor,
};

const fs = require('fs-extra');
const { pathToFileURL } = require('url');
const { chunkText } = require('./chunking');
const { requestEmbeddings, cosineSimilarity, resolveRetrievalConfig } = require('./embeddings');
const { requestRerank, resolveRerankConfig } = require('./rerank');
const { parseKnowledgeBaseDocument, isImageMimeType, inferMimeType } = require('./parserAdapter');
const { KB_UNSUPPORTED_OCR_ERROR } = require('./constants');
const chatClient = require('../chatClient');
const { createKnowledgeBaseRuntime } = require('./runtime');
const { createKnowledgeBaseRepository } = require('./repository');
const { createDocumentStore } = require('./documentStore');
const { createProcessingQueue } = require('./processingQueue');
const { createDocumentProcessor } = require('./documentProcessor');
const { createRetrievalService } = require('./retrievalService');
const { createGuideService } = require('./guideService');
const { buildReaderViewFromParsedDocument } = require('./readerProjection');
const { createImageDocumentTranscriber } = require('./imageDocumentTranscriber');

const runtime = createKnowledgeBaseRuntime();
const repository = createKnowledgeBaseRepository();
const imageDocumentTranscriber = createImageDocumentTranscriber({
    runtime,
    chatClient,
});
const processor = createDocumentProcessor({
    runtime,
    repository,
    parseKnowledgeBaseDocument,
    transcribeImageDocument: imageDocumentTranscriber.transcribeImageDocument,
    inferMimeType,
    chunkText,
    requestEmbeddings,
    KB_UNSUPPORTED_OCR_ERROR,
    isImageMimeType,
});
const processingQueue = createProcessingQueue({
    runtime,
    repository,
    processor,
});
const documentStore = createDocumentStore({
    runtime,
    repository,
    enqueueDocument: processingQueue.enqueueDocument,
});
const retrievalService = createRetrievalService({
    runtime,
    repository,
    requestEmbeddings,
    requestRerank,
    resolveRetrievalConfig,
    resolveRerankConfig,
    cosineSimilarity,
});
const guideService = createGuideService({
    runtime,
    repository,
    parseKnowledgeBaseDocument,
    chatClient,
});

async function initializeKnowledgeBase(options = {}) {
    await runtime.initialize(options);
    await processingQueue.recoverQueuedDocuments();
    await processingQueue.drainQueue();
}

async function shutdownKnowledgeBase() {
    await runtime.shutdown();
}

async function clearKnowledgeBaseBindings(kbId) {
    const { agentConfigManager, agentDir } = runtime.getState();
    if (!agentConfigManager || !agentDir) {
        return;
    }

    const dirEntries = await fs.readdir(agentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const agentId = entry.name;
        const config = await agentConfigManager.readAgentConfig(agentId).catch(() => null);
        if (!config || !Array.isArray(config.topics)) {
            continue;
        }

        let changed = false;
        const topics = config.topics.map((topic) => {
            if (topic?.knowledgeBaseId === kbId) {
                changed = true;
                return {
                    ...topic,
                    knowledgeBaseId: null,
                };
            }
            return topic;
        });

        if (changed) {
            await agentConfigManager.updateAgentConfig(agentId, (current) => ({
                ...current,
                topics,
            }));
        }
    }
}

async function clearKnowledgeBaseDocumentSelections(documentId) {
    const normalizedDocumentId = String(documentId || '').trim();
    if (!normalizedDocumentId) {
        return;
    }

    const { agentConfigManager, agentDir } = runtime.getState();
    if (!agentConfigManager || !agentDir) {
        return;
    }

    const dirEntries = await fs.readdir(agentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const agentId = entry.name;
        const config = await agentConfigManager.readAgentConfig(agentId).catch(() => null);
        if (!config || !Array.isArray(config.topics)) {
            continue;
        }

        let changed = false;
        const topics = config.topics.map((topic) => {
            if (!Array.isArray(topic?.selectedKnowledgeBaseDocumentIds)) {
                return topic;
            }

            const nextSelection = topic.selectedKnowledgeBaseDocumentIds
                .filter((id) => String(id || '').trim() !== normalizedDocumentId);
            if (nextSelection.length === topic.selectedKnowledgeBaseDocumentIds.length) {
                return topic;
            }

            changed = true;
            return {
                ...topic,
                selectedKnowledgeBaseDocumentIds: nextSelection,
            };
        });

        if (changed) {
            await agentConfigManager.updateAgentConfig(agentId, (current) => ({
                ...current,
                topics,
            }));
        }
    }
}

async function deleteKnowledgeBase(kbId) {
    const existing = await repository.getKnowledgeBaseById(kbId);
    if (!existing) {
        throw new Error('Knowledge base not found.');
    }

    const storedPaths = await repository.listStoredPathsByKnowledgeBase(kbId);
    await repository.deleteKnowledgeBaseData(kbId);
    await documentStore.removeUnreferencedStoredFiles(storedPaths);
    await clearKnowledgeBaseBindings(kbId);
    return { success: true };
}

async function deleteKnowledgeBaseDocument(documentId) {
    const deletedDocument = await repository.deleteKnowledgeBaseDocumentData(documentId);
    await documentStore.removeUnreferencedStoredFiles([deletedDocument.storedPath]);
    await clearKnowledgeBaseDocumentSelections(documentId);
    return deletedDocument;
}

async function copyKnowledgeBaseDocuments(targetKbId, documentIds = []) {
    const targetKnowledgeBase = await repository.getKnowledgeBaseById(targetKbId);
    if (!targetKnowledgeBase) {
        throw new Error('Knowledge base not found.');
    }

    if (targetKnowledgeBase.kind !== 'source') {
        throw new Error('Shelf documents can only be added to a Source.');
    }

    const normalizedDocumentIds = [...new Set(
        (Array.isArray(documentIds) ? documentIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
    )];
    if (normalizedDocumentIds.length === 0) {
        return [];
    }

    const copied = [];
    for (const documentId of normalizedDocumentIds) {
        const document = await repository.cloneDocumentToKnowledgeBase(documentId, targetKbId);
        if (document) {
            copied.push(document);
        }
    }
    return copied;
}

async function getKnowledgeBaseDocumentViewData(documentId) {
    const document = await repository.getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    const parsed = await parseKnowledgeBaseDocument(document);
    const view = buildReaderViewFromParsedDocument(parsed);
    const resolvedMimeType = String(parsed?.mimeType || inferMimeType(document) || '').toLowerCase();
    if (isImageMimeType(resolvedMimeType) && document.storedPath) {
        view.imagePreviewUrl = pathToFileURL(document.storedPath).href;
    }

    return {
        document: {
            ...document,
            isIndexed: document.status === 'done',
        },
        view,
    };
}

module.exports = {
    initializeKnowledgeBase,
    shutdownKnowledgeBase,
    listKnowledgeBases: repository.listKnowledgeBases,
    getKnowledgeBaseById: repository.getKnowledgeBaseById,
    createKnowledgeBase: repository.createKnowledgeBase,
    updateKnowledgeBase: repository.updateKnowledgeBase,
    deleteKnowledgeBase,
    importKnowledgeBaseFiles: documentStore.importKnowledgeBaseFiles,
    copyKnowledgeBaseDocuments,
    listKnowledgeBaseDocuments: repository.listKnowledgeBaseDocuments,
    deleteKnowledgeBaseDocument,
    renameKnowledgeBaseDocument: repository.renameKnowledgeBaseDocument,
    retryKnowledgeBaseDocument: processingQueue.retryKnowledgeBaseDocument,
    retrieveKnowledgeBaseContext: retrievalService.retrieveKnowledgeBaseContext,
    searchKnowledgeBase: retrievalService.searchKnowledgeBase,
    getKnowledgeBaseRetrievalDebug: retrievalService.getKnowledgeBaseRetrievalDebug,
    getKnowledgeBaseDocumentGuide: guideService.getKnowledgeBaseDocumentGuide,
    generateKnowledgeBaseDocumentGuide: guideService.generateKnowledgeBaseDocumentGuide,
    getKnowledgeBaseDocumentViewData,
};

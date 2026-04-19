const fs = require('fs-extra');
const { chunkText } = require('./chunking');
const { requestEmbeddings, cosineSimilarity, resolveRetrievalConfig } = require('./embeddings');
const { requestRerank, resolveRerankConfig } = require('./rerank');
const { parseKnowledgeBaseDocument, isImageMimeType, inferMimeType } = require('./parserAdapter');
const { KB_UNSUPPORTED_OCR_ERROR } = require('./constants');
const vcpClient = require('../vcpClient');
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
    vcpClient,
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
    vcpClient,
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

async function getKnowledgeBaseDocumentViewData(documentId) {
    const document = await repository.getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    const parsed = await parseKnowledgeBaseDocument(document);
    const view = buildReaderViewFromParsedDocument(parsed);

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
    listKnowledgeBaseDocuments: repository.listKnowledgeBaseDocuments,
    retryKnowledgeBaseDocument: processingQueue.retryKnowledgeBaseDocument,
    retrieveKnowledgeBaseContext: retrievalService.retrieveKnowledgeBaseContext,
    searchKnowledgeBase: retrievalService.searchKnowledgeBase,
    getKnowledgeBaseRetrievalDebug: retrievalService.getKnowledgeBaseRetrievalDebug,
    getKnowledgeBaseDocumentGuide: guideService.getKnowledgeBaseDocumentGuide,
    generateKnowledgeBaseDocumentGuide: guideService.generateKnowledgeBaseDocumentGuide,
    getKnowledgeBaseDocumentViewData,
};

const test = require('node:test');
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const KNOWLEDGE_BASE_INDEX_PATH = path.resolve(__dirname, '../src/modules/main/knowledge-base/index.js');

const EXPECTED_EXPORT_KEYS = [
    'initializeKnowledgeBase',
    'shutdownKnowledgeBase',
    'listKnowledgeBases',
    'getKnowledgeBaseById',
    'createKnowledgeBase',
    'updateKnowledgeBase',
    'deleteKnowledgeBase',
    'importKnowledgeBaseFiles',
    'listKnowledgeBaseDocuments',
    'retryKnowledgeBaseDocument',
    'retrieveKnowledgeBaseContext',
    'searchKnowledgeBase',
    'getKnowledgeBaseRetrievalDebug',
    'getKnowledgeBaseDocumentGuide',
    'generateKnowledgeBaseDocumentGuide',
    'getKnowledgeBaseDocumentViewData',
];

function loadKnowledgeBaseFacade() {
    const callLog = [];
    const runtimeState = {
        agentConfigManager: null,
        agentDir: null,
    };
    const runtime = {
        async initialize(options = {}) {
            callLog.push(['runtime.initialize', options]);
        },
        async shutdown() {
            callLog.push(['runtime.shutdown']);
        },
        getState() {
            return runtimeState;
        },
    };
    const repository = {
        async listKnowledgeBases() {
            callLog.push(['repository.listKnowledgeBases']);
            return [{ id: 'kb-1', name: 'KB 1' }];
        },
        async getKnowledgeBaseById(id) {
            callLog.push(['repository.getKnowledgeBaseById', id]);
            return id === 'kb-1' ? { id, name: 'KB 1' } : null;
        },
        async createKnowledgeBase(payload) {
            callLog.push(['repository.createKnowledgeBase', payload]);
            return { id: 'kb-created', ...payload };
        },
        async updateKnowledgeBase(kbId, payload) {
            callLog.push(['repository.updateKnowledgeBase', kbId, payload]);
            return { id: kbId, ...payload };
        },
        async listKnowledgeBaseDocuments(kbId) {
            callLog.push(['repository.listKnowledgeBaseDocuments', kbId]);
            return [{ id: 'doc-1', kbId }];
        },
        async getDocumentById(documentId) {
            callLog.push(['repository.getDocumentById', documentId]);
            return {
                id: documentId,
                status: 'done',
                fileName: 'fixture.txt',
            };
        },
        async listStoredPathsByKnowledgeBase(kbId) {
            callLog.push(['repository.listStoredPathsByKnowledgeBase', kbId]);
            return ['stored/a.txt', 'stored/b.txt'];
        },
        async deleteKnowledgeBaseData(kbId) {
            callLog.push(['repository.deleteKnowledgeBaseData', kbId]);
        },
    };
    const processingQueue = {
        async recoverQueuedDocuments() {
            callLog.push(['processingQueue.recoverQueuedDocuments']);
        },
        async drainQueue() {
            callLog.push(['processingQueue.drainQueue']);
        },
        async retryKnowledgeBaseDocument(documentId) {
            callLog.push(['processingQueue.retryKnowledgeBaseDocument', documentId]);
            return { id: documentId, status: 'queued' };
        },
        enqueueDocument() {},
    };
    const documentStore = {
        async importKnowledgeBaseFiles(kbId, files) {
            callLog.push(['documentStore.importKnowledgeBaseFiles', kbId, files]);
            return files;
        },
        async removeUnreferencedStoredFiles(pathsToDelete) {
            callLog.push(['documentStore.removeUnreferencedStoredFiles', pathsToDelete]);
        },
    };
    const retrievalService = {
        async retrieveKnowledgeBaseContext(payload) {
            callLog.push(['retrievalService.retrieveKnowledgeBaseContext', payload]);
            return { refs: [{ documentId: 'doc-1' }], contextText: 'ctx', itemCount: 1 };
        },
        async searchKnowledgeBase(payload) {
            callLog.push(['retrievalService.searchKnowledgeBase', payload]);
            return { items: [{ documentId: 'doc-1' }], itemCount: 1 };
        },
        async getKnowledgeBaseRetrievalDebug(payload) {
            callLog.push(['retrievalService.getKnowledgeBaseRetrievalDebug', payload]);
            return { vectorCandidates: [], finalItems: [], contextText: 'debug', itemCount: 0 };
        },
    };
    const guideService = {
        async getKnowledgeBaseDocumentGuide(documentId) {
            callLog.push(['guideService.getKnowledgeBaseDocumentGuide', documentId]);
            return { documentId, guideStatus: 'done', guideMarkdown: '# guide' };
        },
        async generateKnowledgeBaseDocumentGuide(documentId, options) {
            callLog.push(['guideService.generateKnowledgeBaseDocumentGuide', documentId, options]);
            return { documentId, guideStatus: 'done', guideMarkdown: '# generated guide' };
        },
    };
    const parserAdapter = {
        async parseKnowledgeBaseDocument(document) {
            callLog.push(['parserAdapter.parseKnowledgeBaseDocument', document.id]);
            return {
                documentId: document.id,
                contentType: 'text/plain',
                paragraphs: [{ index: 0, text: 'hello world' }],
            };
        },
    };
    const readerProjection = {
        buildReaderViewFromParsedDocument(parsed) {
            callLog.push(['readerProjection.buildReaderViewFromParsedDocument', parsed.documentId]);
            return {
                blocks: [{ id: 'block-1', text: 'hello world' }],
            };
        },
    };

    const originalLoad = Module._load;

    delete require.cache[require.resolve(KNOWLEDGE_BASE_INDEX_PATH)];

    try {
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'fs-extra') {
                return {
                    readdir: async () => [],
                };
            }
            if (request === './chunking') {
                return {
                    chunkText() {
                        return [];
                    },
                };
            }
            if (request === './embeddings') {
                return {
                    requestEmbeddings: async () => [],
                    cosineSimilarity: () => 0,
                    resolveRetrievalConfig: () => ({}),
                };
            }
            if (request === './rerank') {
                return {
                    requestRerank: async () => [],
                    resolveRerankConfig: () => ({}),
                };
            }
            if (request === './parserAdapter') {
                return parserAdapter;
            }
            if (request === './constants') {
                return {
                    KB_UNSUPPORTED_OCR_ERROR: 'KB_UNSUPPORTED_OCR_ERROR',
                };
            }
            if (request === '../vcpClient') {
                return {};
            }
            if (request === './runtime') {
                return {
                    createKnowledgeBaseRuntime() {
                        return runtime;
                    },
                };
            }
            if (request === './repository') {
                return {
                    createKnowledgeBaseRepository() {
                        return repository;
                    },
                };
            }
            if (request === './documentStore') {
                return {
                    createDocumentStore() {
                        return documentStore;
                    },
                };
            }
            if (request === './processingQueue') {
                return {
                    createProcessingQueue() {
                        return processingQueue;
                    },
                };
            }
            if (request === './documentProcessor') {
                return {
                    createDocumentProcessor() {
                        return {};
                    },
                };
            }
            if (request === './retrievalService') {
                return {
                    createRetrievalService() {
                        return retrievalService;
                    },
                };
            }
            if (request === './guideService') {
                return {
                    createGuideService() {
                        return guideService;
                    },
                };
            }
            if (request === './readerProjection') {
                return readerProjection;
            }

            return originalLoad.call(this, request, parent, isMain);
        };

        const facade = require(KNOWLEDGE_BASE_INDEX_PATH);
        return {
            facade,
            callLog,
        };
    } finally {
        Module._load = originalLoad;
    }
}

test('knowledge-base facade exposes the stable 16-function public contract', () => {
    const { facade } = loadKnowledgeBaseFacade();

    assert.deepEqual(Object.keys(facade).sort(), [...EXPECTED_EXPORT_KEYS].sort());
    EXPECTED_EXPORT_KEYS.forEach((key) => {
        assert.equal(typeof facade[key], 'function', `${key} should stay callable`);
    });
});

test('knowledge-base facade keeps lifecycle order and delegates core calls to internal services', async () => {
    const { facade, callLog } = loadKnowledgeBaseFacade();

    await facade.initializeKnowledgeBase({ dataRoot: 'C:/tmp/kb-root' });
    assert.deepEqual(callLog.slice(0, 3), [
        ['runtime.initialize', { dataRoot: 'C:/tmp/kb-root' }],
        ['processingQueue.recoverQueuedDocuments'],
        ['processingQueue.drainQueue'],
    ]);

    const retrieval = await facade.retrieveKnowledgeBaseContext({ query: 'What is NEWTON-101?' });
    const search = await facade.searchKnowledgeBase({ query: 'NEWTON-101' });
    const debug = await facade.getKnowledgeBaseRetrievalDebug({ query: 'debug me' });
    const view = await facade.getKnowledgeBaseDocumentViewData('doc-1');
    const guide = await facade.getKnowledgeBaseDocumentGuide('doc-1');
    const generatedGuide = await facade.generateKnowledgeBaseDocumentGuide('doc-1', { forceRefresh: false });
    const retried = await facade.retryKnowledgeBaseDocument('doc-1');
    const deleted = await facade.deleteKnowledgeBase('kb-1');
    await facade.shutdownKnowledgeBase();

    assert.deepEqual(retrieval, {
        refs: [{ documentId: 'doc-1' }],
        contextText: 'ctx',
        itemCount: 1,
    });
    assert.deepEqual(search, {
        items: [{ documentId: 'doc-1' }],
        itemCount: 1,
    });
    assert.deepEqual(debug, {
        vectorCandidates: [],
        finalItems: [],
        contextText: 'debug',
        itemCount: 0,
    });
    assert.deepEqual(view, {
        document: {
            id: 'doc-1',
            status: 'done',
            fileName: 'fixture.txt',
            isIndexed: true,
        },
        view: {
            blocks: [{ id: 'block-1', text: 'hello world' }],
        },
    });
    assert.deepEqual(guide, {
        documentId: 'doc-1',
        guideStatus: 'done',
        guideMarkdown: '# guide',
    });
    assert.deepEqual(generatedGuide, {
        documentId: 'doc-1',
        guideStatus: 'done',
        guideMarkdown: '# generated guide',
    });
    assert.deepEqual(retried, {
        id: 'doc-1',
        status: 'queued',
    });
    assert.deepEqual(deleted, { success: true });

    assert.equal(
        callLog.some(([name, value]) => name === 'documentStore.removeUnreferencedStoredFiles'
            && Array.isArray(value)
            && value.length === 2),
        true,
        'deleteKnowledgeBase should still clean up orphaned stored files',
    );
    assert.equal(
        callLog.some(([name]) => name === 'runtime.shutdown'),
        true,
        'shutdownKnowledgeBase should still delegate to runtime.shutdown',
    );
});

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
    'copyKnowledgeBaseDocuments',
    'getKnowledgeBaseShelfLinks',
    'addKnowledgeBaseDocumentsToShelf',
    'moveKnowledgeBaseDocumentToShelfGroup',
    'listKnowledgeBaseDocuments',
    'deleteKnowledgeBaseDocument',
    'renameKnowledgeBaseDocument',
    'retryKnowledgeBaseDocument',
    'retrieveKnowledgeBaseContext',
    'searchKnowledgeBase',
    'getKnowledgeBaseRetrievalDebug',
    'getKnowledgeBaseDocumentGuide',
    'generateKnowledgeBaseDocumentGuide',
    'getKnowledgeBaseDocumentThumbnail',
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
        async listKnowledgeBases(options) {
            callLog.push(['repository.listKnowledgeBases', options]);
            if (options?.kind === 'shelf') {
                return [];
            }
            return [{ id: 'kb-1', name: 'KB 1' }];
        },
        async getKnowledgeBaseById(id) {
            callLog.push(['repository.getKnowledgeBaseById', id]);
            if (id === 'kb-1') {
                return { id, name: 'KB 1', kind: 'source' };
            }
            if (id === 'kb-shelf') {
                return { id, name: 'Shelf', kind: 'shelf' };
            }
            return null;
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
                name: documentId === 'doc-image' ? 'diagram.png' : 'fixture.txt',
                status: documentId === 'doc-pending' ? 'processing' : 'done',
                kbId: documentId === 'doc-shelf' ? 'kb-shelf' : 'kb-1',
                fileHash: documentId === 'doc-existing-link' ? 'hash-existing' : 'hash-new',
                fileName: 'fixture.txt',
                storedPath: documentId === 'doc-image' ? path.join('C:/fixtures', 'diagram.png') : path.join('C:/fixtures', 'fixture.txt'),
            };
        },
        async getShelfLinksForDocuments(documentIds) {
            callLog.push(['repository.getShelfLinksForDocuments', documentIds]);
            return documentIds.includes('doc-existing-link')
                ? [{
                    sourceDocumentId: 'doc-existing-link',
                    fileHash: 'hash-existing',
                    shelfDocumentId: 'doc-shelf-existing',
                    shelfDocumentName: 'fixture.txt',
                    shelfKbId: 'kb-shelf',
                    shelfKbName: 'Shelf',
                }]
                : [];
        },
        async findShelfDocumentByHash(fileHash) {
            callLog.push(['repository.findShelfDocumentByHash', fileHash]);
            return fileHash === 'hash-existing'
                ? {
                    document: { id: 'doc-shelf-existing', name: 'fixture.txt', kbId: 'kb-shelf', fileHash },
                    shelfKbId: 'kb-shelf',
                    shelfKbName: 'Shelf',
                }
                : null;
        },
        async renameKnowledgeBaseDocument(documentId, payload) {
            callLog.push(['repository.renameKnowledgeBaseDocument', documentId, payload]);
            return {
                id: documentId,
                name: payload.name,
                status: 'done',
            };
        },
        async cloneDocumentToKnowledgeBase(documentId, targetKbId) {
            callLog.push(['repository.cloneDocumentToKnowledgeBase', documentId, targetKbId]);
            return { id: `${documentId}-copy`, kbId: targetKbId, status: 'done' };
        },
        async deleteKnowledgeBaseDocumentData(documentId) {
            callLog.push(['repository.deleteKnowledgeBaseDocumentData', documentId]);
            return { id: documentId, storedPath: 'stored/deleted.txt' };
        },
        async listStoredPathsByKnowledgeBase(kbId) {
            callLog.push(['repository.listStoredPathsByKnowledgeBase', kbId]);
            return ['stored/a.txt', 'stored/b.txt'];
        },
        async deleteKnowledgeBaseData(kbId) {
            callLog.push(['repository.deleteKnowledgeBaseData', kbId]);
        },
        async moveDocumentToKnowledgeBase(documentId, targetKbId) {
            callLog.push(['repository.moveDocumentToKnowledgeBase', documentId, targetKbId]);
            return { id: documentId, kbId: targetKbId };
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
                mimeType: document.id === 'doc-image' ? 'image/png' : 'text/plain',
                contentType: 'text/plain',
                paragraphs: [{ index: 0, text: 'hello world' }],
            };
        },
        inferMimeType(document) {
            return document.id === 'doc-image' ? 'image/png' : 'text/plain';
        },
        isImageMimeType(mimeType) {
            return String(mimeType || '').startsWith('image/');
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
            if (request === '../chatClient') {
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
            if (request === './thumbnailService') {
                return {
                    createKnowledgeBaseThumbnailService() {
                        return {
                            async getExistingKnowledgeBaseDocumentThumbnail(document) {
                                callLog.push(['thumbnailService.getExistingKnowledgeBaseDocumentThumbnail', document.id]);
                                return document.id === 'doc-1'
                                    ? { documentId: document.id, thumbnailUrl: `file:///preview/${document.id}.png`, kind: 'pdf' }
                                    : { documentId: document.id, thumbnailUrl: '', kind: 'none' };
                            },
                            async getKnowledgeBaseDocumentThumbnail(documentId) {
                                callLog.push(['thumbnailService.getKnowledgeBaseDocumentThumbnail', documentId]);
                                return { documentId, thumbnailUrl: `file:///preview/${documentId}.png`, kind: 'pdf' };
                            },
                        };
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

test('knowledge-base facade exposes the stable public contract', () => {
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
    const listedDocuments = await facade.listKnowledgeBaseDocuments('kb-1');
    const search = await facade.searchKnowledgeBase({ query: 'NEWTON-101' });
    const debug = await facade.getKnowledgeBaseRetrievalDebug({ query: 'debug me' });
    const view = await facade.getKnowledgeBaseDocumentViewData('doc-1');
    const imageView = await facade.getKnowledgeBaseDocumentViewData('doc-image');
    const thumbnail = await facade.getKnowledgeBaseDocumentThumbnail('doc-1');
    const guide = await facade.getKnowledgeBaseDocumentGuide('doc-1');
    const generatedGuide = await facade.generateKnowledgeBaseDocumentGuide('doc-1', { forceRefresh: false });
    const renamedDocument = await facade.renameKnowledgeBaseDocument('doc-1', { name: 'renamed.txt' });
    const copiedDocuments = await facade.copyKnowledgeBaseDocuments('kb-1', ['doc-1']);
    const shelfLinks = await facade.getKnowledgeBaseShelfLinks(['doc-existing-link']);
    const shelfAdded = await facade.addKnowledgeBaseDocumentsToShelf(['doc-1']);
    await assert.rejects(
        () => facade.addKnowledgeBaseDocumentsToShelf(['doc-pending']),
        /Only indexed documents/,
    );
    const movedShelfDocument = await facade.moveKnowledgeBaseDocumentToShelfGroup('doc-shelf', 'kb-shelf');
    const deletedDocument = await facade.deleteKnowledgeBaseDocument('doc-delete');
    const retried = await facade.retryKnowledgeBaseDocument('doc-1');
    const deleted = await facade.deleteKnowledgeBase('kb-1');
    await facade.shutdownKnowledgeBase();

    assert.deepEqual(retrieval, {
        refs: [{ documentId: 'doc-1' }],
        contextText: 'ctx',
        itemCount: 1,
    });
    assert.deepEqual(listedDocuments, [{
        id: 'doc-1',
        kbId: 'kb-1',
        thumbnailUrl: 'file:///preview/doc-1.png',
        thumbnailKind: 'pdf',
    }]);
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
            name: 'fixture.txt',
            status: 'done',
            kbId: 'kb-1',
            fileHash: 'hash-new',
            fileName: 'fixture.txt',
            storedPath: path.join('C:/fixtures', 'fixture.txt'),
            isIndexed: true,
        },
        view: {
            blocks: [{ id: 'block-1', text: 'hello world' }],
        },
    });
    assert.equal(imageView.document.name, 'diagram.png');
    assert.equal(imageView.view.imagePreviewUrl.startsWith('file:'), true);
    assert.deepEqual(thumbnail, {
        documentId: 'doc-1',
        thumbnailUrl: 'file:///preview/doc-1.png',
        kind: 'pdf',
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
    assert.deepEqual(renamedDocument, {
        id: 'doc-1',
        name: 'renamed.txt',
        status: 'done',
    });
    assert.deepEqual(copiedDocuments, [
        { id: 'doc-1-copy', kbId: 'kb-1', status: 'done' },
    ]);
    assert.deepEqual(shelfLinks, [{
        sourceDocumentId: 'doc-existing-link',
        fileHash: 'hash-existing',
        shelfDocumentId: 'doc-shelf-existing',
        shelfDocumentName: 'fixture.txt',
        shelfKbId: 'kb-shelf',
        shelfKbName: 'Shelf',
    }]);
    assert.deepEqual(shelfAdded, [{
        sourceDocumentId: 'doc-1',
        fileHash: 'hash-new',
        shelfDocumentId: 'doc-1-copy',
        shelfDocumentName: '',
        shelfKbId: 'kb-created',
        shelfKbName: '未归类',
    }]);
    assert.deepEqual(movedShelfDocument, {
        id: 'doc-shelf',
        kbId: 'kb-shelf',
    });
    assert.deepEqual(deletedDocument, {
        id: 'doc-delete',
        storedPath: 'stored/deleted.txt',
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

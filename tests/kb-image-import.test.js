const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const { parseKnowledgeBaseDocument } = require('../src/modules/main/knowledge-base/parserAdapter');
const { createDocumentProcessor } = require('../src/modules/main/knowledge-base/documentProcessor');
const { createDocumentStore } = require('../src/modules/main/knowledge-base/documentStore');

test('parseKnowledgeBaseDocument reuses cached extracted markdown for image documents', async () => {
    const parsed = await parseKnowledgeBaseDocument({
        id: 'doc-image',
        name: 'diagram.png',
        mimeType: 'image/png',
        extractedText: '# 图片概览\n\n这里是图片转写结果',
        extractedContentType: 'markdown',
    });

    assert.equal(parsed.mimeType, 'image/png');
    assert.equal(parsed.contentType, 'markdown');
    assert.match(parsed.text, /图片转写结果/);
    assert.equal(parsed.structure, null);
});

test('documentProcessor transcribes image documents and persists extracted content before chunking', async () => {
    const operations = [];
    const document = {
        id: 'doc-image',
        kbId: 'kb-1',
        name: 'geometry-question.png',
        mimeType: 'image/png',
        status: 'pending',
        contentType: null,
        attemptCount: 0,
    };

    const repository = {
        async getDocumentById(documentId) {
            assert.equal(documentId, 'doc-image');
            return { ...document };
        },
        async updateDocumentState(documentId, patch) {
            operations.push(['updateDocumentState', documentId, patch]);
            Object.assign(document, patch);
            return { ...document };
        },
        async updateDocumentGuideState(documentId, patch) {
            operations.push(['updateDocumentGuideState', documentId, patch]);
        },
        async updateDocumentDerivedContent(documentId, patch) {
            operations.push(['updateDocumentDerivedContent', documentId, patch]);
            Object.assign(document, patch);
            return { ...document };
        },
        async deleteDocumentChunks(documentId) {
            operations.push(['deleteDocumentChunks', documentId]);
        },
        async insertDocumentChunk(payload) {
            operations.push(['insertDocumentChunk', payload.documentId, payload.content]);
        },
        async updateDocumentMimeType(documentId, mimeType) {
            operations.push(['updateDocumentMimeType', documentId, mimeType]);
            document.mimeType = mimeType;
        },
    };

    const processor = createDocumentProcessor({
        runtime: {
            async readSettings() {
                return {};
            },
        },
        repository,
        parseKnowledgeBaseDocument: async () => {
            throw new Error('text parser should not run for image docs');
        },
        transcribeImageDocument: async (inputDocument) => {
            assert.equal(inputDocument.id, 'doc-image');
            return {
                mimeType: 'image/png',
                contentType: 'markdown',
                text: '# 图片概览\n\n转写正文',
                structure: null,
            };
        },
        inferMimeType: (inputDocument) => inputDocument.mimeType,
        isImageMimeType: (mimeType) => mimeType === 'image/png',
        chunkText: (text, options) => {
            operations.push(['chunkText', text, options.contentType]);
            return [{
                content: text,
                contentType: options.contentType,
                charLength: text.length,
            }];
        },
        requestEmbeddings: async (_settings, inputs) => {
            operations.push(['requestEmbeddings', inputs]);
            return [[0.1, 0.2]];
        },
        KB_UNSUPPORTED_OCR_ERROR: 'unsupported',
    });

    await processor.processDocument('doc-image');

    assert.equal(
        operations.some(([name, , patch]) => (
            name === 'updateDocumentDerivedContent'
            && patch.extractedContentType === 'markdown'
            && /转写正文/.test(patch.extractedText)
        )),
        true,
    );
    assert.equal(
        operations.some(([name, , patch]) => (
            name === 'updateDocumentState'
            && patch.contentType === 'markdown'
        )),
        true,
    );
    assert.equal(
        operations.some(([name]) => name === 'requestEmbeddings'),
        true,
    );
    assert.equal(document.status, 'done');
    assert.equal(document.contentType, 'markdown');
});

test('documentStore requeues failed duplicate imports instead of keeping stale failed records', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-kb-image-import-'));
    t.after(() => fs.remove(tempRoot));

    const sourceFile = path.join(tempRoot, 'diagram.png');
    await fs.writeFile(sourceFile, Buffer.from('fake-image-content'));

    const duplicateDocument = {
        id: 'doc-existing',
        kbId: 'kb-1',
        name: 'diagram.png',
        storedPath: sourceFile,
        mimeType: 'image/png',
        status: 'failed',
        guideStatus: 'failed',
    };
    const queued = [];
    const repository = {
        async getKnowledgeBaseById(kbId) {
            return kbId === 'kb-1' ? { id: kbId, name: 'KB 1' } : null;
        },
        async findDocumentIdByHash() {
            return 'doc-existing';
        },
        async getDocumentById() {
            return { ...duplicateDocument };
        },
        async updateDocumentState(documentId, patch) {
            assert.equal(documentId, 'doc-existing');
            Object.assign(duplicateDocument, patch);
            return { ...duplicateDocument };
        },
        async updateDocumentGuideState(documentId, patch) {
            assert.equal(documentId, 'doc-existing');
            Object.assign(duplicateDocument, patch);
            return { ...duplicateDocument };
        },
        async touchKnowledgeBase() {},
        async createDocument() {
            throw new Error('should not create a new document for duplicates');
        },
    };

    const store = createDocumentStore({
        runtime: {
            getFilesRoot() {
                return path.join(tempRoot, 'files');
            },
        },
        repository,
        enqueueDocument(documentId) {
            queued.push(documentId);
        },
    });

    const items = await store.importKnowledgeBaseFiles('kb-1', [{
        name: 'diagram.png',
        path: sourceFile,
        type: 'image/png',
    }]);

    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'pending');
    assert.deepEqual(queued, ['doc-existing']);
});

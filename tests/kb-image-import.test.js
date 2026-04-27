const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const { parseKnowledgeBaseDocument } = require('../src/modules/main/knowledge-base/parserAdapter');
const { createDocumentProcessor } = require('../src/modules/main/knowledge-base/documentProcessor');
const { createDocumentStore } = require('../src/modules/main/knowledge-base/documentStore');
const { createKnowledgeBaseRepository } = require('../src/modules/main/knowledge-base/repository');

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

test('documentProcessor writes chunk records in bulk when the repository supports it', async () => {
    const operations = [];
    const document = {
        id: 'doc-text',
        kbId: 'kb-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        status: 'pending',
        contentType: null,
        attemptCount: 0,
    };

    const repository = {
        async getDocumentById(documentId) {
            assert.equal(documentId, 'doc-text');
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
        async updateDocumentDerivedContent() {
            throw new Error('text documents should not persist OCR-derived content');
        },
        async deleteDocumentChunks(documentId) {
            operations.push(['deleteDocumentChunks', documentId]);
        },
        async insertDocumentChunk() {
            throw new Error('single chunk insert should not be used when bulk insert is available');
        },
        async insertDocumentChunks(records) {
            operations.push(['insertDocumentChunks', records]);
        },
        async updateDocumentMimeType(documentId, mimeType) {
            operations.push(['updateDocumentMimeType', documentId, mimeType]);
        },
    };

    const processor = createDocumentProcessor({
        runtime: {
            async readSettings() {
                return {};
            },
        },
        repository,
        parseKnowledgeBaseDocument: async () => ({
            mimeType: 'text/plain',
            contentType: 'plain',
            text: 'alpha beta gamma delta',
            structure: null,
        }),
        inferMimeType: (inputDocument) => inputDocument.mimeType,
        isImageMimeType: () => false,
        chunkText: () => [
            { content: 'alpha beta', contentType: 'plain', charLength: 10 },
            { content: 'gamma delta', contentType: 'plain', charLength: 11 },
        ],
        requestEmbeddings: async () => [[1, 0], [0, 1]],
        KB_UNSUPPORTED_OCR_ERROR: 'unsupported',
    });

    await processor.processDocument('doc-text');

    const bulkInsert = operations.find(([name]) => name === 'insertDocumentChunks');
    assert.ok(bulkInsert);
    assert.equal(bulkInsert[1].length, 2);
    assert.deepEqual(bulkInsert[1].map((record) => record.chunkIndex), [0, 1]);
    assert.equal(document.status, 'done');
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

test('repository renames documents, validates display names, and touches the parent source', async () => {
    const calls = [];
    const row = {
        id: 'doc-image',
        kb_id: 'kb-1',
        name: 'old.png',
        stored_path: 'C:\\fixtures\\old.png',
        mime_type: 'image/png',
        file_size: 128,
        file_hash: 'hash-1',
        status: 'done',
        error: null,
        chunk_count: 1,
        created_at: 1,
        updated_at: 1,
    };
    const repository = createKnowledgeBaseRepository({
        getDb: () => ({
            async execute(statement) {
                calls.push(statement);
                const sql = typeof statement === 'string' ? statement : statement.sql;
                if (/SELECT id, kb_id, name, stored_path/.test(sql)) {
                    return { rows: [row] };
                }
                return { rows: [] };
            },
        }),
    });

    const renamed = await repository.renameKnowledgeBaseDocument('doc-image', { name: '新标题.png' });

    assert.equal(renamed.name, '新标题.png');
    assert.equal(
        calls.some((statement) => statement.sql === 'UPDATE kb_document SET name = ?, updated_at = ? WHERE id = ?'
            && statement.args[0] === '新标题.png'
            && statement.args[2] === 'doc-image'),
        true,
    );
    assert.equal(
        calls.some((statement) => statement.sql === 'UPDATE knowledge_base SET updated_at = ? WHERE id = ?'
            && statement.args[1] === 'kb-1'),
        true,
    );
    await assert.rejects(
        repository.renameKnowledgeBaseDocument('doc-image', { name: 'bad/name.png' }),
        /path separators/,
    );
    await assert.rejects(
        repository.renameKnowledgeBaseDocument('doc-image', { name: '   ' }),
        /required/,
    );
});

const test = require('node:test');
const assert = require('assert/strict');

const {
    buildContextText,
    createRetrievalService,
} = require('../src/modules/main/knowledge-base/retrievalService');

test('retrieval falls back to vector ranking when rerank fails', async () => {
    const service = createRetrievalService({
        runtime: {
            async readSettings() {
                return {};
            },
        },
        repository: {
            async getKnowledgeBaseById(kbId) {
                return { id: kbId, name: 'KB Demo' };
            },
            async listChunkRowsByKnowledgeBase() {
                return [
                    {
                        id: 'chunk-1',
                        document_id: 'doc-1',
                        chunk_index: 0,
                        content: 'Alpha content',
                        embedding: JSON.stringify([1, 0]),
                        content_type: 'plain',
                        char_length: 13,
                        section_title: 'Intro',
                        page_number: 2,
                        paragraph_index: 1,
                        document_name: 'Alpha',
                    },
                    {
                        id: 'chunk-2',
                        document_id: 'doc-2',
                        chunk_index: 0,
                        content: 'Beta content',
                        embedding: JSON.stringify([0.4, 0]),
                        content_type: 'plain',
                        char_length: 12,
                        section_title: 'Body',
                        page_number: 3,
                        paragraph_index: 2,
                        document_name: 'Beta',
                    },
                ];
            },
        },
        requestEmbeddings: async () => [[1, 0]],
        requestRerank: async () => {
            throw new Error('rerank unavailable');
        },
        resolveRetrievalConfig: () => ({
            topK: 1,
            scoreThreshold: 0,
        }),
        resolveRerankConfig: () => ({
            useRerank: true,
            rerankModel: 'rerank-x',
            candidateTopK: 2,
        }),
        cosineSimilarity(query, embedding) {
            return query[0] * embedding[0];
        },
    });

    const result = await service.searchKnowledgeBase({
        kbId: 'kb-1',
        query: 'alpha',
    });

    assert.equal(result.kbId, 'kb-1');
    assert.equal(result.kbName, 'KB Demo');
    assert.equal(result.itemCount, 1);
    assert.equal(result.items[0].documentId, 'doc-1');
    assert.equal(result.rerankApplied, false);
    assert.equal(result.rerankFallbackReason, 'rerank unavailable');
  });

test('retrieval can be limited to selected documents', async () => {
    let requestedDocumentIds = null;
    const service = createRetrievalService({
        runtime: {
            async readSettings() {
                return {};
            },
        },
        repository: {
            async getKnowledgeBaseById(kbId) {
                return { id: kbId, name: 'KB Demo' };
            },
            async listChunkRowsByKnowledgeBase(_kbId, documentIds) {
                requestedDocumentIds = documentIds;
                return [
                    {
                        id: 'chunk-2',
                        document_id: 'doc-2',
                        chunk_index: 0,
                        content: 'Beta selected content',
                        embedding: JSON.stringify([1, 0]),
                        content_type: 'plain',
                        char_length: 21,
                        section_title: null,
                        page_number: null,
                        paragraph_index: null,
                        document_name: 'Beta',
                    },
                ];
            },
        },
        requestEmbeddings: async () => [[1, 0]],
        requestRerank: async () => [],
        resolveRetrievalConfig: () => ({
            topK: 3,
            scoreThreshold: 0,
        }),
        resolveRerankConfig: () => ({
            useRerank: false,
            rerankModel: '',
            candidateTopK: 3,
        }),
        cosineSimilarity(query, embedding) {
            return query[0] * embedding[0];
        },
    });

    const result = await service.retrieveKnowledgeBaseContext({
        kbId: 'kb-1',
        query: 'beta',
        documentIds: ['doc-2'],
    });

    assert.deepEqual(requestedDocumentIds, ['doc-2']);
    assert.equal(result.itemCount, 1);
    assert.equal(result.refs[0].documentId, 'doc-2');
});

test('retrieval returns no context when every source document is unchecked', async () => {
    let embeddingRequested = false;
    let chunksRequested = false;
    const service = createRetrievalService({
        runtime: {
            async readSettings() {
                return {};
            },
        },
        repository: {
            async getKnowledgeBaseById(kbId) {
                return { id: kbId, name: 'KB Demo' };
            },
            async listChunkRowsByKnowledgeBase() {
                chunksRequested = true;
                return [];
            },
        },
        requestEmbeddings: async () => {
            embeddingRequested = true;
            return [[1, 0]];
        },
        requestRerank: async () => [],
        resolveRetrievalConfig: () => ({
            topK: 3,
            scoreThreshold: 0,
        }),
        resolveRerankConfig: () => ({
            useRerank: false,
            rerankModel: '',
            candidateTopK: 3,
        }),
        cosineSimilarity() {
            return 0;
        },
    });

    const result = await service.retrieveKnowledgeBaseContext({
        kbId: 'kb-1',
        query: 'beta',
        documentIds: [],
    });

    assert.equal(result.itemCount, 0);
    assert.equal(result.contextText, '');
    assert.equal(embeddingRequested, false);
    assert.equal(chunksRequested, false);
});

test('buildContextText formats retrieval context with available locators', () => {
    const contextText = buildContextText([
        {
            documentName: 'Alpha',
            content: 'Important note',
            pageNumber: 7,
            paragraphIndex: 3,
            sectionTitle: 'Summary',
        },
    ]);

    assert.match(contextText, /\[1\] Alpha/);
    assert.match(contextText, /Page: 7/);
    assert.match(contextText, /Paragraph: 3/);
    assert.match(contextText, /Section: Summary/);
    assert.match(contextText, /Important note/);
});

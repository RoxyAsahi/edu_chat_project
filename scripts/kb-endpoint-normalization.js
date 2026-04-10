const assert = require('assert/strict');

const { normalizeEmbeddingEndpoint } = require('../src/modules/main/knowledge-base/embeddings');
const { normalizeRerankEndpoint } = require('../src/modules/main/knowledge-base/rerank');

const cases = [
    {
        input: 'http://154.36.184.44:3000/',
        embedding: 'http://154.36.184.44:3000/v1/embeddings',
        rerank: 'http://154.36.184.44:3000/v1/rerank',
    },
    {
        input: 'http://154.36.184.44:3000/v1',
        embedding: 'http://154.36.184.44:3000/v1/embeddings',
        rerank: 'http://154.36.184.44:3000/v1/rerank',
    },
    {
        input: 'http://154.36.184.44:3000/v1/chat/completions',
        embedding: 'http://154.36.184.44:3000/v1/embeddings',
        rerank: 'http://154.36.184.44:3000/v1/rerank',
    },
    {
        input: 'http://154.36.184.44:3000/v1/embeddings',
        embedding: 'http://154.36.184.44:3000/v1/embeddings',
        rerank: 'http://154.36.184.44:3000/v1/rerank',
    },
    {
        input: 'http://154.36.184.44:3000/v1/rerank',
        embedding: 'http://154.36.184.44:3000/v1/embeddings',
        rerank: 'http://154.36.184.44:3000/v1/rerank',
    },
];

for (const testCase of cases) {
    assert.equal(normalizeEmbeddingEndpoint(testCase.input), testCase.embedding, `Embedding endpoint mismatch for ${testCase.input}`);
    assert.equal(normalizeRerankEndpoint(testCase.input), testCase.rerank, `Rerank endpoint mismatch for ${testCase.input}`);
}

console.log(`Endpoint normalization checks passed for ${cases.length} cases.`);

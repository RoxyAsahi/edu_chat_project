const assert = require('assert/strict');

const { requestEmbeddings, cosineSimilarity } = require('../src/modules/main/knowledge-base/embeddings');
const { requestRerank } = require('../src/modules/main/knowledge-base/rerank');
const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
} = require('../src/modules/main/knowledge-base/constants');
const { runSmoke } = require('./kb-smoke');

function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

async function validateEmbeddingModels(baseSettings) {
    const models = [
        'BAAI/bge-m3',
        'netease-youdao/bce-embedding-base_v1',
        'BAAI/bge-large-zh-v1.5',
        'BAAI/bge-large-en-v1.5',
    ];

    const samples = [
        '苹果公司总部在库比蒂诺。',
        'RAG stands for Retrieval-Augmented Generation.',
    ];

    const results = [];
    for (const model of models) {
        const vectors = await requestEmbeddings(
            {
                ...baseSettings,
                kbEmbeddingModel: model,
            },
            samples,
        );
        assert.equal(vectors.length, samples.length, `Embedding model ${model} returned an unexpected vector count.`);
        assert(Array.isArray(vectors[0]) && vectors[0].length > 0, `Embedding model ${model} returned an empty vector.`);

        results.push({
            model,
            dimension: vectors[0].length,
            count: vectors.length,
        });
    }

    return results;
}

async function validateRerankModels(baseSettings) {
    const models = [
        'BAAI/bge-reranker-v2-m3',
        'netease-youdao/bce-reranker-base_v1',
    ];

    const query = 'Which city hosts the annual lantern festival?';
    const documents = [
        'The annual lantern festival travel guide compares Taipei, Seoul, and Hong Kong. It covers hotels, transit, and food near each festival venue.',
        'The annual lantern festival is hosted in Taipei every spring.',
        'A lantern festival can include music, parades, and food stalls in many cities.',
    ];

    const results = [];
    for (const model of models) {
        const [queryEmbedding] = await requestEmbeddings(
            {
                ...baseSettings,
                kbEmbeddingModel: DEFAULT_KB_EMBEDDING_MODEL,
            },
            [query],
        );
        const documentEmbeddings = await requestEmbeddings(
            {
                ...baseSettings,
                kbEmbeddingModel: DEFAULT_KB_EMBEDDING_MODEL,
            },
            documents,
        );
        const vectorOrder = documentEmbeddings
            .map((embedding, index) => ({
                index,
                score: cosineSimilarity(queryEmbedding, embedding),
                snippet: documents[index].slice(0, 72),
            }))
            .sort((a, b) => b.score - a.score)
            .map((item) => ({
                index: item.index,
                score: Number(item.score.toFixed(4)),
                snippet: item.snippet,
            }));

        const reranked = await requestRerank(
            {
                ...baseSettings,
                kbRerankModel: model,
            },
            query,
            documents,
        );

        assert(reranked.length > 0, `Rerank model ${model} returned no results.`);

        const ordered = reranked
            .slice()
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .map((item) => ({
                index: item.index,
                relevanceScore: Number(item.relevanceScore.toFixed(4)),
                snippet: documents[item.index].slice(0, 72),
            }));

        results.push({
            model,
            vectorOrder,
            ordered,
            changed: JSON.stringify(vectorOrder.map((item) => item.index))
                !== JSON.stringify(ordered.map((item) => item.index)),
        });
    }

    return results;
}

async function main() {
    const baseUrl = requireEnv('KB_BASE_URL');
    const apiKey = requireEnv('KB_API_KEY');

    const baseSettings = {
        kbBaseUrl: baseUrl,
        kbApiKey: apiKey,
        kbEmbeddingModel: process.env.KB_EMBEDDING_MODEL || DEFAULT_KB_EMBEDDING_MODEL,
        kbRerankModel: process.env.KB_RERANK_MODEL || DEFAULT_KB_RERANK_MODEL,
    };

    const embeddings = await validateEmbeddingModels(baseSettings);
    const rerank = await validateRerankModels(baseSettings);
    const smoke = await runSmoke({
        baseUrl,
        apiKey,
        embeddingModel: baseSettings.kbEmbeddingModel,
        rerankModel: baseSettings.kbRerankModel,
        silent: true,
    });

    console.log(JSON.stringify({
        embeddings,
        rerank,
        smoke: {
            retrieval: smoke.retrieval,
            documents: smoke.documents,
        },
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

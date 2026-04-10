const {
    DEFAULT_KB_SCORE_THRESHOLD,
    DEFAULT_KB_TOP_K,
} = require('./constants');

const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

function normalizeEmbeddingEndpoint(baseUrl) {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
        throw new Error('KB Base URL is required.');
    }

    const url = new URL(baseUrl.trim());
    const pathname = url.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/embeddings')) {
        return url.toString();
    }

    if (pathname.endsWith('/rerank')) {
        url.pathname = pathname.replace(/\/rerank$/, '/embeddings');
        return url.toString();
    }

    if (pathname.endsWith('/chat/completions')) {
        url.pathname = pathname.replace(/\/chat\/completions$/, '/embeddings');
        return url.toString();
    }

    if (!pathname || pathname === '') {
        url.pathname = '/v1/embeddings';
        return url.toString();
    }

    if (pathname.endsWith('/v1')) {
        url.pathname = `${pathname}/embeddings`;
        return url.toString();
    }

    url.pathname = `${pathname}/embeddings`;
    return url.toString();
}

async function requestEmbeddings(settings, inputs) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return [];
    }

    if (typeof settings?.kbApiKey !== 'string' || settings.kbApiKey.trim() === '') {
        throw new Error('KB API Key is required.');
    }

    if (typeof settings?.kbEmbeddingModel !== 'string' || settings.kbEmbeddingModel.trim() === '') {
        throw new Error('KB Embedding Model is required.');
    }

    const endpoint = normalizeEmbeddingEndpoint(settings.kbBaseUrl);
    const batchSize = Math.max(1, Number(settings?.kbEmbeddingBatchSize) || DEFAULT_EMBEDDING_BATCH_SIZE);
    const allVectors = [];

    for (let start = 0; start < inputs.length; start += batchSize) {
        const batchInputs = inputs.slice(start, start + batchSize);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${settings.kbApiKey.trim()}`,
            },
            body: JSON.stringify({
                model: settings.kbEmbeddingModel.trim(),
                input: batchInputs,
            }),
        });

        const responseText = await response.text();
        let payload = null;

        try {
            payload = responseText ? JSON.parse(responseText) : null;
        } catch (_error) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload?.error?.message || payload?.message || responseText || `Embedding request failed with ${response.status}`;
            throw new Error(message);
        }

        const vectors = Array.isArray(payload?.data)
            ? payload.data
                .slice()
                .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
                .map((item) => item.embedding)
            : [];

        if (vectors.length !== batchInputs.length) {
            throw new Error(`Embedding response count mismatch: expected ${batchInputs.length}, received ${vectors.length}.`);
        }

        allVectors.push(...vectors);
    }

    if (allVectors.length !== inputs.length) {
        throw new Error(`Embedding response count mismatch: expected ${inputs.length}, received ${allVectors.length}.`);
    }

    return allVectors;
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i += 1) {
        const valueA = Number(a[i]) || 0;
        const valueB = Number(b[i]) || 0;
        dot += valueA * valueB;
        normA += valueA * valueA;
        normB += valueB * valueB;
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function resolveRetrievalConfig(settings, overrides = {}) {
    const topK = Number(overrides.topK ?? settings?.kbTopK);
    const scoreThreshold = Number(overrides.scoreThreshold ?? settings?.kbScoreThreshold);

    return {
        topK: Number.isFinite(topK) && topK > 0 ? topK : DEFAULT_KB_TOP_K,
        scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : DEFAULT_KB_SCORE_THRESHOLD,
    };
}

module.exports = {
    normalizeEmbeddingEndpoint,
    requestEmbeddings,
    cosineSimilarity,
    resolveRetrievalConfig,
};

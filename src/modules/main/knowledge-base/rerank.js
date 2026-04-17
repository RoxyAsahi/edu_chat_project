const {
    DEFAULT_KB_CANDIDATE_TOP_K,
} = require('./constants');
const { resolveExecutionConfig } = require('../utils/modelService');
const { buildRequestHeaders } = require('../vcpClient');

const DEFAULT_RERANK_TIMEOUT_MS = 15000;

function normalizeRerankEndpoint(baseUrl) {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
        throw new Error('KB Base URL is required.');
    }

    const url = new URL(baseUrl.trim());
    const pathname = url.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/rerank')) {
        return url.toString();
    }

    if (pathname.endsWith('/embeddings')) {
        url.pathname = pathname.replace(/\/embeddings$/, '/rerank');
        return url.toString();
    }

    if (pathname.endsWith('/chat/completions')) {
        url.pathname = pathname.replace(/\/chat\/completions$/, '/rerank');
        return url.toString();
    }

    if (!pathname || pathname === '') {
        url.pathname = '/v1/rerank';
        return url.toString();
    }

    if (pathname.endsWith('/v1')) {
        url.pathname = `${pathname}/rerank`;
        return url.toString();
    }

    url.pathname = `${pathname}/rerank`;
    return url.toString();
}

function resolveRerankConfig(settings, overrides = {}) {
    const useRerank = overrides.useRerank ?? settings?.kbUseRerank;
    const candidateTopK = Number(overrides.candidateTopK ?? settings?.kbCandidateTopK);
    const rerankModel = String(overrides.rerankModel ?? settings?.kbRerankModel ?? '').trim();

    return {
        useRerank: useRerank !== false,
        rerankModel,
        candidateTopK: Number.isFinite(candidateTopK) && candidateTopK > 0
            ? candidateTopK
            : DEFAULT_KB_CANDIDATE_TOP_K,
    };
}

async function requestRerank(settings, query, documents) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return [];
    }

    if (!Array.isArray(documents) || documents.length === 0) {
        return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_RERANK_TIMEOUT_MS);

    try {
        const execution = resolveExecutionConfig(settings, { purpose: 'rerank' });
        const endpoint = execution?.endpoint || normalizeRerankEndpoint(settings?.kbBaseUrl);
        const modelId = execution?.model?.id || String(settings?.kbRerankModel || '').trim();
        if (!modelId) {
            throw new Error('KB Rerank Model is required.');
        }

        if (!endpoint) {
            throw new Error('KB Base URL is required.');
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: buildRequestHeaders(execution?.apiKey || settings?.kbApiKey || '', execution?.extraHeaders),
            body: JSON.stringify({
                model: modelId,
                query: cleanQuery,
                documents,
            }),
            signal: controller.signal,
        });

        const responseText = await response.text();
        let payload = null;

        try {
            payload = responseText ? JSON.parse(responseText) : null;
        } catch (_error) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload?.error?.message || payload?.message || responseText || `Rerank request failed with ${response.status}`;
            throw new Error(message);
        }

        const rawResults = Array.isArray(payload?.results)
            ? payload.results
            : (Array.isArray(payload?.data) ? payload.data : []);

        return rawResults.map((item) => ({
            index: Number(item?.index),
            relevanceScore: Number(item?.relevance_score ?? item?.score ?? item?.relevanceScore ?? 0),
        })).filter((item) => Number.isInteger(item.index) && Number.isFinite(item.relevanceScore));
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`Rerank request timed out after ${DEFAULT_RERANK_TIMEOUT_MS}ms.`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = {
    normalizeRerankEndpoint,
    resolveRerankConfig,
    requestRerank,
};

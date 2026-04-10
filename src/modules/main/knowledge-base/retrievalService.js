const {
    buildSnippet,
    roundScore,
    toNumber,
    toOptionalNumber,
} = require('./helpers');

function mapChunkRowToCandidate(row, cosineSimilarity, queryEmbedding) {
    let embedding = [];
    try {
        embedding = JSON.parse(row.embedding);
    } catch (_error) {
        embedding = [];
    }

    return {
        chunkId: row.id,
        documentId: row.document_id,
        chunkIndex: toNumber(row.chunk_index, 0),
        content: row.content,
        documentName: row.document_name,
        contentType: row.content_type || 'plain',
        charLength: toNumber(row.char_length, String(row.content || '').length),
        sectionTitle: row.section_title || null,
        pageNumber: toOptionalNumber(row.page_number, null),
        paragraphIndex: toOptionalNumber(row.paragraph_index, null),
        vectorScore: cosineSimilarity(queryEmbedding, embedding),
    };
}

function formatRetrievalRef(kbId, item) {
    return {
        kbId,
        documentId: item.documentId,
        chunkId: item.chunkId,
        documentName: item.documentName,
        chunkIndex: item.chunkIndex,
        contentType: item.contentType,
        sectionTitle: item.sectionTitle || null,
        pageNumber: toOptionalNumber(item.pageNumber, null),
        paragraphIndex: toOptionalNumber(item.paragraphIndex, null),
        snippet: buildSnippet(item.content),
        vectorScore: roundScore(item.vectorScore),
        ...(Number.isFinite(item.rerankScore) ? { rerankScore: roundScore(item.rerankScore) } : {}),
        score: roundScore(item.score),
    };
}

function buildContextText(finalItems) {
    if (finalItems.length === 0) {
        return '';
    }

    return [
        'Knowledge base context:',
        ...finalItems.map((item, index) => {
            const headerParts = [`[${index + 1}] ${item.documentName}`];
            if (Number.isFinite(item.pageNumber)) {
                headerParts.push(`Page: ${item.pageNumber}`);
            }
            if (Number.isFinite(item.paragraphIndex)) {
                headerParts.push(`Paragraph: ${item.paragraphIndex}`);
            }
            if (item.sectionTitle) {
                headerParts.push(`Section: ${item.sectionTitle}`);
            }
            return `${headerParts.join(' | ')}\n${item.content}`;
        }),
        'Use the retrieved context when it is relevant. If it is not relevant, answer normally.',
    ].join('\n\n');
}

function createRetrievalService(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const requestEmbeddings = deps.requestEmbeddings;
    const requestRerank = deps.requestRerank;
    const resolveRetrievalConfig = deps.resolveRetrievalConfig;
    const resolveRerankConfig = deps.resolveRerankConfig;
    const cosineSimilarity = deps.cosineSimilarity;

    async function rankKnowledgeBaseChunks(payload = {}) {
        const kbId = payload.kbId;
        const query = String(payload.query || '').trim();
        if (!kbId || !query) {
            return {
                kbId,
                query,
                refs: [],
                contextText: '',
                itemCount: 0,
                vectorCandidates: [],
                finalItems: [],
                rerankApplied: false,
                rerankFallbackReason: null,
                threshold: 0,
                topK: 0,
                candidateTopK: 0,
            };
        }

        const kb = await repository.getKnowledgeBaseById(kbId);
        if (!kb) {
            throw new Error('Knowledge base not found.');
        }

        const settings = await runtime.readSettings();
        const [queryEmbedding] = await requestEmbeddings(settings, [query]);
        const chunkRows = await repository.listChunkRowsByKnowledgeBase(kbId);

        const { topK, scoreThreshold } = resolveRetrievalConfig(settings, payload);
        const { useRerank, rerankModel, candidateTopK } = resolveRerankConfig(settings, payload);
        const vectorCandidates = chunkRows
            .map((row) => mapChunkRowToCandidate(row, cosineSimilarity, queryEmbedding))
            .filter((item) => item.vectorScore >= scoreThreshold)
            .sort((a, b) => b.vectorScore - a.vectorScore);

        const candidateLimit = Math.max(topK, candidateTopK);
        const rerankCandidates = vectorCandidates.slice(0, candidateLimit);
        let finalItems = rerankCandidates.slice(0, topK).map((item) => ({
            ...item,
            score: item.vectorScore,
        }));
        let rerankApplied = false;
        let rerankFallbackReason = null;

        if (useRerank && rerankModel && rerankCandidates.length >= 2) {
            try {
                const rerankResults = await requestRerank(
                    {
                        ...settings,
                        kbRerankModel: rerankModel,
                    },
                    query,
                    rerankCandidates.map((item) => `${item.documentName}\n${item.content}`),
                );

                const rerankScoreByIndex = new Map(
                    rerankResults.map((item) => [item.index, item.relevanceScore]),
                );

                finalItems = rerankCandidates
                    .map((item, index) => {
                        const rerankScore = rerankScoreByIndex.get(index);
                        return {
                            ...item,
                            rerankScore: Number.isFinite(rerankScore) ? rerankScore : null,
                            score: Number.isFinite(rerankScore) ? rerankScore : item.vectorScore,
                        };
                    })
                    .sort((a, b) => {
                        const leftRerank = Number.isFinite(a.rerankScore) ? a.rerankScore : -Infinity;
                        const rightRerank = Number.isFinite(b.rerankScore) ? b.rerankScore : -Infinity;
                        if (rightRerank !== leftRerank) {
                            return rightRerank - leftRerank;
                        }
                        return b.vectorScore - a.vectorScore;
                    })
                    .slice(0, topK);

                rerankApplied = true;
            } catch (error) {
                rerankFallbackReason = error?.message || String(error);
                console.warn('[KnowledgeBase] Rerank failed, falling back to vector order:', rerankFallbackReason);
            }
        } else if (useRerank && rerankCandidates.length < 2) {
            rerankFallbackReason = 'Not enough candidates for rerank.';
        }

        const refs = finalItems.map((item) => formatRetrievalRef(kbId, item));
        const contextText = buildContextText(finalItems);

        return {
            kbId,
            kbName: kb.name,
            query,
            refs,
            contextText,
            itemCount: refs.length,
            topK,
            candidateTopK,
            threshold: scoreThreshold,
            useRerank,
            rerankModel,
            rerankApplied,
            rerankFallbackReason,
            vectorCandidates: vectorCandidates.map((item) => ({
                ...formatRetrievalRef(kbId, {
                    ...item,
                    score: item.vectorScore,
                }),
                charLength: item.charLength,
                content: item.content,
            })),
            finalItems: finalItems.map((item) => ({
                ...formatRetrievalRef(kbId, item),
                charLength: item.charLength,
                content: item.content,
            })),
        };
    }

    async function retrieveKnowledgeBaseContext(payload = {}) {
        const result = await rankKnowledgeBaseChunks(payload);
        return {
            kbId: result.kbId,
            refs: result.refs,
            contextText: result.contextText,
            itemCount: result.itemCount,
        };
    }

    async function searchKnowledgeBase(payload = {}) {
        const result = await rankKnowledgeBaseChunks(payload);
        return {
            kbId: result.kbId,
            kbName: result.kbName,
            query: result.query,
            items: result.finalItems,
            itemCount: result.finalItems.length,
            useRerank: result.useRerank,
            rerankApplied: result.rerankApplied,
            rerankFallbackReason: result.rerankFallbackReason,
        };
    }

    async function getKnowledgeBaseRetrievalDebug(payload = {}) {
        const result = await rankKnowledgeBaseChunks(payload);
        return {
            kbId: result.kbId,
            kbName: result.kbName,
            query: result.query,
            topK: result.topK,
            candidateTopK: result.candidateTopK,
            threshold: result.threshold,
            useRerank: result.useRerank,
            rerankModel: result.rerankModel,
            rerankApplied: result.rerankApplied,
            rerankFallbackReason: result.rerankFallbackReason,
            contextText: result.contextText,
            vectorCandidates: result.vectorCandidates,
            finalItems: result.finalItems,
            itemCount: result.itemCount,
        };
    }

    return {
        rankKnowledgeBaseChunks,
        retrieveKnowledgeBaseContext,
        searchKnowledgeBase,
        getKnowledgeBaseRetrievalDebug,
    };
}

module.exports = {
    mapChunkRowToCandidate,
    formatRetrievalRef,
    buildContextText,
    createRetrievalService,
};

const { requestEmbeddings, cosineSimilarity, resolveRetrievalConfig } = require('../knowledge-base/embeddings');
const { requestRerank, resolveRerankConfig } = require('../knowledge-base/rerank');

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function tokenize(value) {
    const source = String(value || '').toLowerCase();
    const latinTokens = source.match(/[a-z0-9_]+/g) || [];
    const cjkTokens = source.match(/[\u4e00-\u9fa5]/g) || [];
    return [...latinTokens, ...cjkTokens];
}

function lexicalScore(query, candidate) {
    const queryTokens = tokenize(query);
    const candidateTokens = new Set(tokenize(candidate));
    if (queryTokens.length === 0 || candidateTokens.size === 0) {
        return 0;
    }

    let hitCount = 0;
    queryTokens.forEach((token) => {
        if (candidateTokens.has(token)) {
            hitCount += 1;
        }
    });

    return hitCount / queryTokens.length;
}

function buildDiarySnippet(markdown = '', limit = 280) {
    const plain = String(markdown || '')
        .replace(/^#+\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim();

    if (plain.length <= limit) {
        return plain;
    }

    return `${plain.slice(0, limit).trim()}...`;
}

async function computeSemanticScores(settings, query, items) {
    try {
        const vectors = await requestEmbeddings(settings, [
            query,
            ...items.map((item) => item.text),
        ]);

        const queryVector = vectors[0];
        return items.map((item, index) => ({
            ...item,
            score: cosineSimilarity(queryVector, vectors[index + 1]),
            scoreSource: 'embedding',
        }));
    } catch (_error) {
        return items.map((item) => ({
            ...item,
            score: lexicalScore(query, item.text),
            scoreSource: 'lexical',
        }));
    }
}

async function rerankCandidates(settings, query, candidates) {
    const rerankConfig = resolveRerankConfig(settings);
    if (rerankConfig.useRerank !== true || candidates.length === 0) {
        return candidates;
    }

    try {
        const reranked = await requestRerank(
            settings,
            query,
            candidates.map((candidate) => candidate.text)
        );

        const scoreMap = new Map();
        reranked.forEach((item) => {
            scoreMap.set(item.index, item.relevanceScore);
        });

        return candidates
            .map((candidate, index) => ({
                ...candidate,
                score: scoreMap.has(index) ? scoreMap.get(index) : candidate.score,
                scoreSource: scoreMap.has(index) ? 'rerank' : candidate.scoreSource,
            }))
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    } catch (_error) {
        return candidates;
    }
}

function buildMemoryBlock(refs = []) {
    if (!Array.isArray(refs) || refs.length === 0) {
        return '';
    }

    const lines = [
        'Study memory recall for this turn:',
    ];

    refs.forEach((ref, index) => {
        const scopeLabel = ref.scope === 'topic'
            ? 'current topic'
            : ref.scope === 'public'
                ? 'shared public notebook'
                : 'same agent fallback';
        lines.push(
            '',
            `[${index + 1}] ${ref.dateKey} | ${scopeLabel} | [${ref.notebookName || '默认'}]`,
            ref.snippet,
        );
    });

    lines.push(
        '',
        'Use these memories only when they help the current answer. Do not claim they happened today unless the date matches.'
    );

    return lines.join('\n');
}

function createStudyMemoryService(options = {}) {
    const settingsManager = options.settingsManager;
    const diaryProjector = options.diaryProjector;
    const studyLogStore = options.studyLogStore;

    async function readSettings() {
        if (!settingsManager || typeof settingsManager.readSettings !== 'function') {
            return {};
        }

        return settingsManager.readSettings().catch(() => ({}));
    }

    async function scoreDiaryDays(settings, query, items, limit) {
        if (items.length === 0) {
            return [];
        }

        const candidates = await computeSemanticScores(settings, query, items);
        const retrievalConfig = resolveRetrievalConfig(settings, {
            topK: limit,
            scoreThreshold: 0,
        });
        const rerankConfig = resolveRerankConfig(settings);
        const shortlisted = candidates
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
            .slice(0, Math.max(retrievalConfig.topK, rerankConfig.candidateTopK));

        const reranked = await rerankCandidates(settings, query, shortlisted);
        return reranked
            .filter((candidate) => Number(candidate.score || 0) > 0)
            .slice(0, limit);
    }

    function mapDiaryCandidates(items = [], scope) {
        return items.map((item) => ({
            scope,
            diaryId: item.id,
            notebookId: item.notebookId,
            notebookName: item.notebookName,
            agentId: Array.isArray(item.agentIds) && item.agentIds.length === 1 ? item.agentIds[0] : '',
            topicId: Array.isArray(item.topicIds) && item.topicIds.length === 1 ? item.topicIds[0] : '',
            dateKey: item.dateKey,
            entryIds: item.matchedEntryIds || item.entryIds || [],
            entryRefs: item.matchedEntryRefs || item.entryRefs || [],
            text: item.viewContentMarkdown || item.contentMarkdown || '',
        }));
    }

    async function searchStudyMemory(options = {}) {
        const agentId = sanitizeText(options.agentId);
        const topicId = sanitizeText(options.topicId);
        const query = sanitizeText(options.query);
        const topK = Math.max(1, Number(options.topK || 4));
        const fallbackTopK = Math.max(1, Number(options.fallbackTopK || 2));
        if (!agentId || !query) {
            return {
                refs: [],
                contextText: '',
                itemCount: 0,
            };
        }

        const settings = await readSettings();
        const topicDays = await diaryProjector.listDiaryDays({
            agentId,
            topicId,
            limit: 120,
        });
        const sameAgentDays = await diaryProjector.listDiaryDays({
            agentId,
            limit: 120,
        });
        const publicDays = await diaryProjector.listDiaryDays({
            notebookName: '公共',
            limit: 120,
        });

        const topicRefs = await scoreDiaryDays(settings, query, mapDiaryCandidates(topicDays, 'topic'), topK);
        const takenDiaryIds = new Set(topicRefs.map((ref) => ref.diaryId));
        const remainingAfterTopic = Math.max(0, topK - topicRefs.length);

        const agentFallbackCandidates = mapDiaryCandidates(sameAgentDays, 'agent')
            .filter((item) => !takenDiaryIds.has(item.diaryId));
        const agentFallbackRefs = remainingAfterTopic > 0
            ? await scoreDiaryDays(
                settings,
                query,
                agentFallbackCandidates,
                Math.min(remainingAfterTopic, fallbackTopK)
            )
            : [];
        agentFallbackRefs.forEach((ref) => takenDiaryIds.add(ref.diaryId));

        const remainingAfterAgent = Math.max(0, topK - topicRefs.length - agentFallbackRefs.length);
        const publicCandidates = mapDiaryCandidates(publicDays, 'public')
            .filter((item) => !takenDiaryIds.has(item.diaryId));
        const publicRefs = remainingAfterAgent > 0
            ? await scoreDiaryDays(
                settings,
                query,
                publicCandidates,
                Math.min(remainingAfterAgent, fallbackTopK)
            )
            : [];

        const refs = [...topicRefs, ...agentFallbackRefs, ...publicRefs].map((ref) => ({
            diaryId: ref.diaryId,
            notebookId: ref.notebookId,
            notebookName: ref.notebookName,
            agentId: ref.agentId,
            topicId: ref.topicId,
            dateKey: ref.dateKey,
            scope: ref.scope,
            score: Number(ref.score || 0),
            scoreSource: ref.scoreSource,
            entryIds: Array.isArray(ref.entryIds) ? ref.entryIds : [],
            entryRefs: Array.isArray(ref.entryRefs) ? ref.entryRefs : [],
            snippet: buildDiarySnippet(ref.text),
            recalledAt: Date.now(),
        }));

        await diaryProjector.markDaysRecalled(refs);
        await studyLogStore.markEntriesRecalled(refs);

        return {
            refs,
            contextText: buildMemoryBlock(refs),
            itemCount: refs.length,
        };
    }

    return {
        searchStudyMemory,
    };
}

module.exports = {
    buildDiarySnippet,
    buildMemoryBlock,
    createStudyMemoryService,
    lexicalScore,
};

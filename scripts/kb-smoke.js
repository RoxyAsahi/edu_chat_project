const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const knowledgeBase = require('../src/modules/main/knowledge-base');
const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    KB_UNSUPPORTED_OCR_ERROR,
} = require('../src/modules/main/knowledge-base/constants');

function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

class StubSettingsManager {
    constructor(settings) {
        this.settings = { ...settings };
    }

    async readSettings() {
        return { ...this.settings };
    }
}

class StubAgentConfigManager {
    constructor(configs = {}) {
        this.configs = { ...configs };
    }

    async readAgentConfig(agentId) {
        return this.configs[agentId] || { topics: [] };
    }

    async updateAgentConfig(agentId, updater) {
        const current = await this.readAgentConfig(agentId);
        this.configs[agentId] = typeof updater === 'function'
            ? updater(current)
            : { ...current, ...(updater || {}) };
        return this.configs[agentId];
    }
}

async function waitForDocumentsSettled(kbId, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const documents = await knowledgeBase.listKnowledgeBaseDocuments(kbId);
        if (documents.length > 0 && documents.every((item) => !['pending', 'processing'].includes(item.status))) {
            return documents;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for KB documents to settle for ${kbId}.`);
}

async function removeWithRetry(targetPath, attempts = 8, delayMs = 250) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            await fs.remove(targetPath);
            return true;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    if (lastError) {
        throw lastError;
    }
    return false;
}

function summarizeRefs(result) {
    return result.refs.map((ref) => ({
        documentName: ref.documentName,
        score: ref.score,
        vectorScore: ref.vectorScore,
        rerankScore: ref.rerankScore ?? null,
    }));
}

async function writeFixtureDocuments(rootDir) {
    const fixtures = [
        {
            name: 'zh-company.txt',
            content: '苹果公司总部位于美国加利福尼亚州库比蒂诺。iPhone、Mac 和 iPad 都是苹果公司的主要产品。',
        },
        {
            name: 'zh-fruit.txt',
            content: '苹果是一种常见水果，通常呈红色或绿色，富含膳食纤维和维生素。',
        },
        {
            name: 'en-rag.txt',
            content: 'RAG stands for Retrieval-Augmented Generation. The system retrieves relevant passages before generating the final answer.',
        },
        {
            name: 'en-sqlite.txt',
            content: 'SQLite is an embedded database. It stores data in a local file and does not require a separate server process.',
        },
        {
            name: 'festival-overview.txt',
            content: 'The annual lantern festival travel guide compares Taipei, Seoul, and Hong Kong. It covers annual lantern festival venues, transit, hotels, and food.',
        },
        {
            name: 'festival-answer.txt',
            content: 'Host city: Taipei.',
        },
        {
            name: 'festival-generic.txt',
            content: 'Lantern festivals often include parades and music.',
        },
        {
            name: 'scan.png',
            content: Buffer.from('not-a-real-image', 'utf8'),
        },
    ];

    const importedFiles = [];
    for (const fixture of fixtures) {
        const filePath = path.join(rootDir, fixture.name);
        await fs.outputFile(filePath, fixture.content);
        importedFiles.push({
            name: fixture.name,
            path: filePath,
        });
    }

    return importedFiles;
}

async function runSmoke(options = {}) {
    const baseUrl = options.baseUrl || requireEnv('KB_BASE_URL');
    const apiKey = options.apiKey || requireEnv('KB_API_KEY');
    const settings = {
        kbBaseUrl: baseUrl,
        kbApiKey: apiKey,
        kbEmbeddingModel: options.embeddingModel || process.env.KB_EMBEDDING_MODEL || DEFAULT_KB_EMBEDDING_MODEL,
        kbUseRerank: options.useRerank ?? true,
        kbRerankModel: options.rerankModel || process.env.KB_RERANK_MODEL || DEFAULT_KB_RERANK_MODEL,
        kbTopK: Number(options.topK ?? process.env.KB_TOP_K ?? 3),
        kbCandidateTopK: Number(options.candidateTopK ?? process.env.KB_CANDIDATE_TOP_K ?? 6),
        kbScoreThreshold: Number(options.scoreThreshold ?? process.env.KB_SCORE_THRESHOLD ?? 0),
    };

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-kb-smoke-'));
    const sourceDir = path.join(tempRoot, 'fixtures');
    const agentDir = path.join(tempRoot, 'agents');
    const agentId = 'agent-smoke';
    const topicId = 'topic-smoke';

    await fs.ensureDir(path.join(agentDir, agentId));

    const agentConfigManager = new StubAgentConfigManager({
        [agentId]: {
            topics: [{ id: topicId, name: 'Smoke Topic', knowledgeBaseId: null }],
        },
    });

    const settingsManager = new StubSettingsManager(settings);
    const fixtureFiles = await writeFixtureDocuments(sourceDir);

    try {
        await knowledgeBase.initializeKnowledgeBase({
            dataRoot: tempRoot,
            settingsManager,
            agentConfigManager,
            agentDir,
        });

        const kb = await knowledgeBase.createKnowledgeBase({ name: 'Smoke KB' });
        await agentConfigManager.updateAgentConfig(agentId, (config) => ({
            ...config,
            topics: config.topics.map((topic) => (
                topic.id === topicId
                    ? { ...topic, knowledgeBaseId: kb.id }
                    : topic
            )),
        }));

        const imported = await knowledgeBase.importKnowledgeBaseFiles(kb.id, fixtureFiles);
        assert.equal(imported.length, fixtureFiles.length, 'Expected every fixture file to be registered.');

        const settledDocuments = await waitForDocumentsSettled(kb.id);
        const doneDocuments = settledDocuments.filter((item) => item.status === 'done');
        const failedDocuments = settledDocuments.filter((item) => item.status === 'failed');

        assert(doneDocuments.length >= 7, 'Expected text fixtures to finish ingestion.');
        assert.equal(failedDocuments.length, 1, 'Expected exactly one unsupported document failure.');
        assert.equal(failedDocuments[0].name, 'scan.png');
        assert.equal(failedDocuments[0].error, KB_UNSUPPORTED_OCR_ERROR);
        assert(doneDocuments.every((item) => item.attemptCount >= 1), 'Successful KB documents should record processing attempts.');
        assert(doneDocuments.some((item) => item.contentType === 'plain'), 'Expected successful KB documents to persist contentType.');
        assert.equal(failedDocuments[0].attemptCount, 1, 'Unsupported KB documents should still record an attempt.');

        const zhVector = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: '苹果公司的总部在哪里？',
            topK: 2,
            scoreThreshold: 0,
            useRerank: false,
        });
        assert(zhVector.refs.some((ref) => ref.documentName === 'zh-company.txt'), 'Chinese retrieval did not surface the company document.');
        assert(zhVector.refs.every((ref) => typeof ref.vectorScore === 'number'), 'Vector retrieval should include vectorScore.');
        assert(zhVector.refs.every((ref) => ref.rerankScore === undefined), 'Vector-only retrieval should not include rerankScore.');

        const zhRerank = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: '苹果公司的总部在哪里？',
            topK: 2,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: true,
            rerankModel: settings.kbRerankModel,
        });
        assert.equal(zhRerank.refs[0]?.documentName, 'zh-company.txt', 'Reranked Chinese retrieval should rank the company document first.');
        assert(zhRerank.refs.some((ref) => typeof ref.rerankScore === 'number'), 'Reranked retrieval should include rerankScore.');

        const enVector = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: 'What does RAG stand for?',
            topK: 2,
            scoreThreshold: 0,
            useRerank: false,
        });
        const enRerank = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: 'What does RAG stand for?',
            topK: 2,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: true,
            rerankModel: settings.kbRerankModel,
        });
        assert(enRerank.refs.some((ref) => ref.documentName === 'en-rag.txt'), 'English retrieval did not surface the RAG definition document.');

        const multiVector = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: 'Which city hosts the annual lantern festival?',
            topK: 3,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: false,
        });
        const multiRerank = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: 'Which city hosts the annual lantern festival?',
            topK: 3,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: true,
            rerankModel: settings.kbRerankModel,
        });
        assert(multiRerank.refs.length > 0, 'Expected multi-candidate retrieval to return results.');

        const debugResult = await knowledgeBase.getKnowledgeBaseRetrievalDebug({
            kbId: kb.id,
            query: 'Which city hosts the annual lantern festival?',
            topK: 3,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: true,
            rerankModel: settings.kbRerankModel,
        });
        assert(debugResult.vectorCandidates.length >= debugResult.finalItems.length, 'Debug retrieval should include vector candidates.');
        assert(debugResult.contextText.includes('Knowledge base context:'), 'Debug retrieval should expose the injected context preview.');

        const fallbackResult = await knowledgeBase.retrieveKnowledgeBaseContext({
            kbId: kb.id,
            query: 'What does RAG stand for?',
            topK: 2,
            candidateTopK: 4,
            scoreThreshold: 0,
            useRerank: true,
            rerankModel: 'this-model-should-fail',
        });
        assert.deepEqual(
            fallbackResult.refs.map((ref) => ref.documentName),
            enVector.refs.map((ref) => ref.documentName),
            'Rerank failure should fall back to vector ordering.',
        );

        const bindingBeforeDelete = await agentConfigManager.readAgentConfig(agentId);
        assert.equal(bindingBeforeDelete.topics[0].knowledgeBaseId, kb.id, 'Topic should be bound before KB deletion.');

        await knowledgeBase.deleteKnowledgeBase(kb.id);

        const kbListAfterDelete = await knowledgeBase.listKnowledgeBases();
        assert.equal(kbListAfterDelete.length, 0, 'Knowledge base should be deleted.');

        const bindingAfterDelete = await agentConfigManager.readAgentConfig(agentId);
        assert.equal(bindingAfterDelete.topics[0].knowledgeBaseId, null, 'Deleting a KB should clear topic bindings.');

        const rerankChanged = JSON.stringify(multiVector.refs.map((ref) => ref.documentName))
            !== JSON.stringify(multiRerank.refs.map((ref) => ref.documentName));
        assert(rerankChanged, 'Expected rerank to change the multi-candidate ordering.');

        const summary = {
            kbId: kb.id,
            settings: {
                kbEmbeddingModel: settings.kbEmbeddingModel,
                kbRerankModel: settings.kbRerankModel,
                kbTopK: settings.kbTopK,
                kbCandidateTopK: settings.kbCandidateTopK,
                kbScoreThreshold: settings.kbScoreThreshold,
            },
            documents: settledDocuments.map((item) => ({
                name: item.name,
                status: item.status,
                chunkCount: item.chunkCount,
                attemptCount: item.attemptCount,
                contentType: item.contentType,
                error: item.error,
            })),
            retrieval: {
                zhVector: summarizeRefs(zhVector),
                zhRerank: summarizeRefs(zhRerank),
                enVector: summarizeRefs(enVector),
                enRerank: summarizeRefs(enRerank),
                multiVector: summarizeRefs(multiVector),
                multiRerank: summarizeRefs(multiRerank),
                fallback: summarizeRefs(fallbackResult),
                debugFinalCount: debugResult.finalItems.length,
                rerankChanged,
            },
        };

        if (options.silent !== true) {
            console.log(JSON.stringify(summary, null, 2));
        }
        return summary;
    } finally {
        await knowledgeBase.shutdownKnowledgeBase().catch((error) => {
            console.warn(`Smoke test shutdown skipped for ${tempRoot}: ${error.message}`);
        });
        if (options.cleanup !== false) {
            await removeWithRetry(tempRoot).catch((error) => {
                console.warn(`Smoke test cleanup skipped for ${tempRoot}: ${error.message}`);
            });
        } else {
            console.log(`Smoke test temp root preserved at: ${tempRoot}`);
        }
    }
}

if (require.main === module) {
    runSmoke().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    runSmoke,
};

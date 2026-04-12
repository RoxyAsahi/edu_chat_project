const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');

const KNOWLEDGE_BASE_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/knowledgeBaseHandlers.js');

function loadKnowledgeBaseHandlers(knowledgeBaseStub) {
    const handlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(KNOWLEDGE_BASE_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            if (request === '../knowledge-base') {
                return knowledgeBaseStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const knowledgeBaseHandlers = require(KNOWLEDGE_BASE_HANDLERS_PATH);
        return { knowledgeBaseHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

async function createHarness(config, options = {}) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-kb-handlers-'));
    const agentDir = path.join(tempRoot, 'agents');
    const agentId = 'fixture-agent';

    await fs.ensureDir(path.join(agentDir, agentId));
    await fs.writeJson(path.join(agentDir, agentId, 'config.json'), config, { spaces: 2 });

    const knowledgeBaseStub = {
        async getKnowledgeBaseById(id) {
            return id === 'kb-valid' ? { id, name: 'Valid KB' } : null;
        },
        async listKnowledgeBases() {
            return [];
        },
        async createKnowledgeBase() {
            return { id: 'kb-created' };
        },
        async updateKnowledgeBase() {
            return { id: 'kb-valid' };
        },
        async deleteKnowledgeBase() {
            return true;
        },
        async importKnowledgeBaseFiles() {
            return [];
        },
        async listKnowledgeBaseDocuments() {
            return [];
        },
        async retryKnowledgeBaseDocument() {
            return {};
        },
        async retrieveKnowledgeBaseContext() {
            return { refs: [], contextText: '', itemCount: 0 };
        },
        async searchKnowledgeBase() {
            return { items: [], itemCount: 0 };
        },
        async getKnowledgeBaseRetrievalDebug() {
            return { vectorCandidates: [], finalItems: [], contextText: '', itemCount: 0 };
        },
        async getKnowledgeBaseDocumentViewData() {
            return { document: null, view: null };
        },
        async getKnowledgeBaseDocumentGuide() {
            return { documentId: null, guideStatus: 'idle', guideMarkdown: '' };
        },
        async generateKnowledgeBaseDocumentGuide() {
            return { documentId: null, guideStatus: 'idle', guideMarkdown: '' };
        },
    };

    const agentConfigManager = new AgentConfigManager(agentDir);
    const { knowledgeBaseHandlers, handlers } = loadKnowledgeBaseHandlers(knowledgeBaseStub);

    knowledgeBaseHandlers.initialize({
        agentConfigManager,
        ensureKnowledgeBaseReady: options.ensureKnowledgeBaseReady,
    });

    return {
        agentConfigManager,
        agentId,
        cleanup: () => fs.remove(tempRoot),
        handlers,
    };
}

test('knowledge base handlers await deferred readiness before serving content requests', async () => {
    const steps = [];
    const harness = await createHarness(
        { topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }] },
        {
            ensureKnowledgeBaseReady: async () => {
                steps.push('ready');
            },
        },
    );

    const listKnowledgeBases = harness.handlers.get('kb:list');
    const result = await listKnowledgeBases();

    assert.equal(result.success, true);
    assert.deepEqual(result.items, []);
    assert.deepEqual(steps, ['ready']);
});

test('set-topic-knowledge-base fails when the topic does not exist', async (t) => {
    const harness = await createHarness({
        topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }],
    });
    t.after(harness.cleanup);

    const setTopicKnowledgeBase = harness.handlers.get('set-topic-knowledge-base');
    const result = await setTopicKnowledgeBase(null, harness.agentId, 'missing-topic', 'kb-valid');

    assert.deepEqual(result, {
        success: false,
        error: 'Topic not found: missing-topic',
        knowledgeBaseId: null,
    });
});

test('set-topic-knowledge-base updates the requested topic only', async (t) => {
    const harness = await createHarness({
        topics: [
            { id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null },
            { id: 'topic-2', name: 'Topic 2', knowledgeBaseId: 'kb-existing' },
        ],
    });
    t.after(harness.cleanup);

    const setTopicKnowledgeBase = harness.handlers.get('set-topic-knowledge-base');
    const result = await setTopicKnowledgeBase(null, harness.agentId, 'topic-1', 'kb-valid');
    const config = await harness.agentConfigManager.readAgentConfig(harness.agentId);

    assert.deepEqual(result, {
        success: true,
        knowledgeBaseId: 'kb-valid',
    });
    assert.equal(config.topics.find((topic) => topic.id === 'topic-1').knowledgeBaseId, 'kb-valid');
    assert.equal(config.topics.find((topic) => topic.id === 'topic-2').knowledgeBaseId, 'kb-existing');
});

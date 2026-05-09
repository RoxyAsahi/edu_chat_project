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
            if (id === 'kb-valid') {
                return { id, name: 'Valid KB', kind: 'source' };
            }
            if (id === 'kb-shelf') {
                return { id, name: 'Shelf KB', kind: 'shelf' };
            }
            return null;
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
        async copyKnowledgeBaseDocuments() {
            return [];
        },
        async getKnowledgeBaseShelfLinks() {
            return [];
        },
        async addKnowledgeBaseDocumentsToShelf() {
            return [];
        },
        async moveKnowledgeBaseDocumentToShelfGroup(documentId, targetKbId) {
            return { id: documentId, kbId: targetKbId };
        },
        async listKnowledgeBaseDocuments() {
            return [];
        },
        async retryKnowledgeBaseDocument() {
            return {};
        },
        async renameKnowledgeBaseDocument(documentId, payload) {
            return { id: documentId, name: payload.name };
        },
        async deleteKnowledgeBaseDocument(documentId) {
            return { id: documentId };
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
        async getKnowledgeBaseDocumentThumbnail(documentId) {
            return { documentId, thumbnailUrl: '', kind: 'none' };
        },
        async getKnowledgeBaseDocumentGuide() {
            return { documentId: null, guideStatus: 'idle', guideMarkdown: '' };
        },
        async generateKnowledgeBaseDocumentGuide() {
            return { documentId: null, guideStatus: 'idle', guideMarkdown: '' };
        },
    };
    Object.assign(knowledgeBaseStub, options.knowledgeBaseStub || {});

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

test('knowledge base list handler forwards kind filters', async (t) => {
    const calls = [];
    const harness = await createHarness(
        { topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }] },
        {
            knowledgeBaseStub: {
                async listKnowledgeBases(options) {
                    calls.push(options);
                    return [{ id: 'kb-shelf', kind: 'shelf' }];
                },
            },
        },
    );
    t.after(harness.cleanup);

    const listKnowledgeBases = harness.handlers.get('kb:list');
    const result = await listKnowledgeBases(null, { kind: 'shelf' });

    assert.equal(result.success, true);
    assert.deepEqual(calls, [{ kind: 'shelf' }]);
    assert.deepEqual(result.items, [{ id: 'kb-shelf', kind: 'shelf' }]);
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

test('set-topic-knowledge-base refuses shelf groups', async (t) => {
    const harness = await createHarness({
        topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }],
    });
    t.after(harness.cleanup);

    const setTopicKnowledgeBase = harness.handlers.get('set-topic-knowledge-base');
    const result = await setTopicKnowledgeBase(null, harness.agentId, 'topic-1', 'kb-shelf');

    assert.equal(result.success, false);
    assert.equal(result.knowledgeBaseId, null);
    assert.match(result.error, /Only Source groups/);
});

test('rename knowledge base document handler delegates to knowledge base service', async (t) => {
    const calls = [];
    const harness = await createHarness(
        { topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }] },
        {
            knowledgeBaseStub: {
                async renameKnowledgeBaseDocument(documentId, payload) {
                    calls.push([documentId, payload]);
                    return { id: documentId, name: payload.name };
                },
            },
        },
    );
    t.after(harness.cleanup);

    const renameDocument = harness.handlers.get('kb:rename-document');
    const result = await renameDocument(null, 'doc-1', { name: '新标题.png' });

    assert.deepEqual(calls, [['doc-1', { name: '新标题.png' }]]);
    assert.deepEqual(result, {
        success: true,
        item: { id: 'doc-1', name: '新标题.png' },
    });
});

test('shelf link, copy, move, and delete document handlers delegate to knowledge base service', async (t) => {
    const calls = [];
    const harness = await createHarness(
        { topics: [{ id: 'topic-1', name: 'Topic 1', knowledgeBaseId: null }] },
        {
            knowledgeBaseStub: {
                async copyKnowledgeBaseDocuments(targetKbId, documentIds) {
                    calls.push(['copy', targetKbId, documentIds]);
                    return documentIds.map((id) => ({ id: `${id}-copy`, kbId: targetKbId }));
                },
                async getKnowledgeBaseShelfLinks(documentIds) {
                    calls.push(['links', documentIds]);
                    return [{ sourceDocumentId: documentIds[0], shelfDocumentId: 'doc-shelf', shelfKbId: 'kb-shelf' }];
                },
                async addKnowledgeBaseDocumentsToShelf(documentIds, options) {
                    calls.push(['add-to-shelf', documentIds, options]);
                    return [{ sourceDocumentId: documentIds[0], shelfDocumentId: 'doc-shelf', shelfKbId: 'kb-shelf' }];
                },
                async moveKnowledgeBaseDocumentToShelfGroup(documentId, targetKbId) {
                    calls.push(['move-shelf', documentId, targetKbId]);
                    return { id: documentId, kbId: targetKbId };
                },
                async deleteKnowledgeBaseDocument(documentId) {
                    calls.push(['delete', documentId]);
                    return { id: documentId };
                },
            },
        },
    );
    t.after(harness.cleanup);

    const copyDocuments = harness.handlers.get('kb:copy-documents');
    const getShelfLinks = harness.handlers.get('kb:get-shelf-links');
    const addToShelf = harness.handlers.get('kb:add-documents-to-shelf');
    const moveShelfDocument = harness.handlers.get('kb:move-document-to-shelf-group');
    const deleteDocument = harness.handlers.get('kb:delete-document');
    const copyResult = await copyDocuments(null, 'kb-valid', ['doc-1']);
    const linksResult = await getShelfLinks(null, ['doc-1']);
    const addResult = await addToShelf(null, ['doc-1'], { targetKbId: 'kb-shelf' });
    const moveResult = await moveShelfDocument(null, 'doc-shelf', 'kb-next');
    const deleteResult = await deleteDocument(null, 'doc-1');

    assert.deepEqual(calls, [
        ['copy', 'kb-valid', ['doc-1']],
        ['links', ['doc-1']],
        ['add-to-shelf', ['doc-1'], { targetKbId: 'kb-shelf' }],
        ['move-shelf', 'doc-shelf', 'kb-next'],
        ['delete', 'doc-1'],
    ]);
    assert.deepEqual(copyResult, {
        success: true,
        items: [{ id: 'doc-1-copy', kbId: 'kb-valid' }],
    });
    assert.deepEqual(linksResult, {
        success: true,
        items: [{ sourceDocumentId: 'doc-1', shelfDocumentId: 'doc-shelf', shelfKbId: 'kb-shelf' }],
    });
    assert.deepEqual(addResult, {
        success: true,
        items: [{ sourceDocumentId: 'doc-1', shelfDocumentId: 'doc-shelf', shelfKbId: 'kb-shelf' }],
    });
    assert.deepEqual(moveResult, {
        success: true,
        item: { id: 'doc-shelf', kbId: 'kb-next' },
    });
    assert.deepEqual(deleteResult, {
        success: true,
        item: { id: 'doc-1' },
    });
});

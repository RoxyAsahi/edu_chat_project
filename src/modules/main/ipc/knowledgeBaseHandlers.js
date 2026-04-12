const { ipcMain } = require('electron');
const knowledgeBase = require('../knowledge-base');
const { ok, fail } = require('./ipcResult');

let ipcHandlersRegistered = false;
let ensureKnowledgeBaseReady = async () => {};

function registerHandle(channels, handler) {
    channels.forEach((channel) => {
        ipcMain.handle(channel, handler);
    });
}

async function updateTopicKnowledgeBase(agentConfigManager, agentId, topicId, knowledgeBaseId) {
    if (!agentConfigManager) {
        throw new Error('AgentConfigManager is unavailable.');
    }

    await agentConfigManager.updateTopic(agentId, topicId, (topic) => ({
        ...topic,
        knowledgeBaseId: knowledgeBaseId || null,
    }));
}

function withKnowledgeBaseReady(handler, fallbackPayload = {}) {
    return async (...args) => {
        try {
            await ensureKnowledgeBaseReady();
            return await handler(...args);
        } catch (error) {
            return fail(error, fallbackPayload);
        }
    };
}

function initialize(context = {}) {
    ensureKnowledgeBaseReady = typeof context.ensureKnowledgeBaseReady === 'function'
        ? context.ensureKnowledgeBaseReady
        : (async () => {});

    if (ipcHandlersRegistered) {
        return;
    }

    const { agentConfigManager } = context;

    registerHandle(['list-knowledge-bases', 'kb:list'], withKnowledgeBaseReady(async () => (
        ok({ items: await knowledgeBase.listKnowledgeBases() })
    ), { items: [] }));

    registerHandle(['create-knowledge-base', 'kb:create'], withKnowledgeBaseReady(async (_event, payload) => (
        ok({ item: await knowledgeBase.createKnowledgeBase(payload) })
    ), { item: null }));

    registerHandle(['update-knowledge-base', 'kb:update'], withKnowledgeBaseReady(async (_event, kbId, payload) => (
        ok({ item: await knowledgeBase.updateKnowledgeBase(kbId, payload) })
    ), { item: null }));

    registerHandle(['delete-knowledge-base', 'kb:delete'], withKnowledgeBaseReady(async (_event, kbId) => {
        await knowledgeBase.deleteKnowledgeBase(kbId);
        return ok();
    }));

    registerHandle(['import-knowledge-base-files', 'kb:import-files'], withKnowledgeBaseReady(async (_event, kbId, files) => (
        ok({ items: await knowledgeBase.importKnowledgeBaseFiles(kbId, files) })
    ), { items: [] }));

    registerHandle(['list-knowledge-base-documents', 'kb:list-documents'], withKnowledgeBaseReady(async (_event, kbId) => (
        ok({ items: await knowledgeBase.listKnowledgeBaseDocuments(kbId) })
    ), { items: [] }));

    registerHandle(['retry-knowledge-base-document', 'kb:retry-document'], withKnowledgeBaseReady(async (_event, documentId) => (
        ok({ item: await knowledgeBase.retryKnowledgeBaseDocument(documentId) })
    ), { item: null }));

    registerHandle(['set-topic-knowledge-base', 'kb:set-topic-binding'], withKnowledgeBaseReady(async (_event, agentId, topicId, kbId) => {
        if (kbId) {
            const kb = await knowledgeBase.getKnowledgeBaseById(kbId);
            if (!kb) {
                throw new Error('Knowledge base not found.');
            }
        }

        await updateTopicKnowledgeBase(agentConfigManager, agentId, topicId, kbId);
        return ok({ knowledgeBaseId: kbId || null });
    }, { knowledgeBaseId: null }));

    registerHandle(['get-topic-knowledge-base', 'kb:get-topic-binding'], withKnowledgeBaseReady(async (_event, agentId, topicId) => {
        if (!agentConfigManager) {
            throw new Error('AgentConfigManager is unavailable.');
        }

        const config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
        const topic = Array.isArray(config.topics)
            ? config.topics.find((item) => item.id === topicId)
            : null;

        return ok({
            knowledgeBaseId: topic?.knowledgeBaseId || null,
        });
    }, { knowledgeBaseId: null }));

    registerHandle(['retrieve-knowledge-base-context', 'kb:retrieve-context'], withKnowledgeBaseReady(async (_event, payload) => (
        ok(await knowledgeBase.retrieveKnowledgeBaseContext(payload))
    ), { refs: [], contextText: '', itemCount: 0 }));

    registerHandle(['search-knowledge-base', 'kb:search'], withKnowledgeBaseReady(async (_event, payload) => (
        ok(await knowledgeBase.searchKnowledgeBase(payload))
    ), { items: [], itemCount: 0 }));

    registerHandle(['get-knowledge-base-retrieval-debug', 'kb:get-retrieval-debug'], withKnowledgeBaseReady(async (_event, payload) => (
        ok(await knowledgeBase.getKnowledgeBaseRetrievalDebug(payload))
    ), {
        query: '',
        vectorCandidates: [],
        finalItems: [],
        contextText: '',
        itemCount: 0,
    }));

    registerHandle(['get-knowledge-base-document-view-data', 'kb:get-document-view-data'], withKnowledgeBaseReady(async (_event, documentId) => (
        ok(await knowledgeBase.getKnowledgeBaseDocumentViewData(documentId))
    ), {
        document: null,
        view: null,
    }));

    registerHandle(['get-knowledge-base-document-guide', 'kb:get-document-guide'], withKnowledgeBaseReady(async (_event, documentId) => (
        ok(await knowledgeBase.getKnowledgeBaseDocumentGuide(documentId))
    ), {
        documentId: null,
        guideStatus: 'failed',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: '',
    }));

    registerHandle(['generate-knowledge-base-document-guide', 'kb:generate-document-guide'], withKnowledgeBaseReady(async (_event, documentId, options) => (
        ok(await knowledgeBase.generateKnowledgeBaseDocumentGuide(documentId, options))
    ), {
        documentId: null,
        guideStatus: 'failed',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: '',
    }));

    ipcHandlersRegistered = true;
}

module.exports = {
    initialize,
};

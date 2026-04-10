const { ipcMain } = require('electron');
const knowledgeBase = require('../knowledge-base');

let ipcHandlersRegistered = false;

async function updateTopicKnowledgeBase(agentConfigManager, agentId, topicId, knowledgeBaseId) {
    if (!agentConfigManager) {
        throw new Error('AgentConfigManager is unavailable.');
    }

    await agentConfigManager.updateAgentConfig(agentId, (config) => {
        const nextTopics = Array.isArray(config.topics)
            ? config.topics.map((topic) => (
                topic.id === topicId
                    ? { ...topic, knowledgeBaseId: knowledgeBaseId || null }
                    : topic
            ))
            : [];

        return {
            ...config,
            topics: nextTopics,
        };
    });
}

function initialize(context = {}) {
    if (ipcHandlersRegistered) {
        return;
    }

    const { agentConfigManager } = context;

    ipcMain.handle('list-knowledge-bases', async () => {
        try {
            return { success: true, items: await knowledgeBase.listKnowledgeBases() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('create-knowledge-base', async (_event, payload) => {
        try {
            return { success: true, item: await knowledgeBase.createKnowledgeBase(payload) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-knowledge-base', async (_event, kbId, payload) => {
        try {
            return { success: true, item: await knowledgeBase.updateKnowledgeBase(kbId, payload) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-knowledge-base', async (_event, kbId) => {
        try {
            await knowledgeBase.deleteKnowledgeBase(kbId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-knowledge-base-files', async (_event, kbId, files) => {
        try {
            return { success: true, items: await knowledgeBase.importKnowledgeBaseFiles(kbId, files) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('list-knowledge-base-documents', async (_event, kbId) => {
        try {
            return { success: true, items: await knowledgeBase.listKnowledgeBaseDocuments(kbId) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('retry-knowledge-base-document', async (_event, documentId) => {
        try {
            return { success: true, item: await knowledgeBase.retryKnowledgeBaseDocument(documentId) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-topic-knowledge-base', async (_event, agentId, topicId, kbId) => {
        try {
            if (kbId) {
                const kb = await knowledgeBase.getKnowledgeBaseById(kbId);
                if (!kb) {
                    throw new Error('Knowledge base not found.');
                }
            }

            await updateTopicKnowledgeBase(agentConfigManager, agentId, topicId, kbId);
            return { success: true, knowledgeBaseId: kbId || null };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-topic-knowledge-base', async (_event, agentId, topicId) => {
        try {
            if (!agentConfigManager) {
                throw new Error('AgentConfigManager is unavailable.');
            }

            const config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
            const topic = Array.isArray(config.topics)
                ? config.topics.find((item) => item.id === topicId)
                : null;
            return {
                success: true,
                knowledgeBaseId: topic?.knowledgeBaseId || null,
            };
        } catch (error) {
            return { success: false, error: error.message, knowledgeBaseId: null };
        }
    });

    ipcMain.handle('retrieve-knowledge-base-context', async (_event, payload) => {
        try {
            return { success: true, ...(await knowledgeBase.retrieveKnowledgeBaseContext(payload)) };
        } catch (error) {
            return { success: false, error: error.message, refs: [], contextText: '', itemCount: 0 };
        }
    });

    ipcMain.handle('search-knowledge-base', async (_event, payload) => {
        try {
            return { success: true, ...(await knowledgeBase.searchKnowledgeBase(payload)) };
        } catch (error) {
            return { success: false, error: error.message, items: [], itemCount: 0 };
        }
    });

    ipcMain.handle('get-knowledge-base-retrieval-debug', async (_event, payload) => {
        try {
            return { success: true, ...(await knowledgeBase.getKnowledgeBaseRetrievalDebug(payload)) };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                query: String(payload?.query || ''),
                vectorCandidates: [],
                finalItems: [],
                contextText: '',
                itemCount: 0,
            };
        }
    });

    ipcMain.handle('get-knowledge-base-document-view-data', async (_event, documentId) => {
        try {
            return { success: true, ...(await knowledgeBase.getKnowledgeBaseDocumentViewData(documentId)) };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                document: null,
                view: null,
            };
        }
    });

    ipcMain.handle('get-knowledge-base-document-guide', async (_event, documentId) => {
        try {
            return { success: true, ...(await knowledgeBase.getKnowledgeBaseDocumentGuide(documentId)) };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                documentId,
                guideStatus: 'failed',
                guideMarkdown: '',
                guideGeneratedAt: null,
                guideError: error.message,
            };
        }
    });

    ipcMain.handle('generate-knowledge-base-document-guide', async (_event, documentId, options) => {
        try {
            return { success: true, ...(await knowledgeBase.generateKnowledgeBaseDocumentGuide(documentId, options)) };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                documentId,
                guideStatus: 'failed',
                guideMarkdown: '',
                guideGeneratedAt: null,
                guideError: error.message,
            };
        }
    });

    ipcHandlersRegistered = true;
}

module.exports = {
    initialize,
};

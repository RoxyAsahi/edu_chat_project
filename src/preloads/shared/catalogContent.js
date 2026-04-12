const { query } = require('./apiFactory');

function createContentCatalog(ops) {
    return {
        searchNotes: query((queryText) => ops.invoke('search-notes', queryText)),
        listKnowledgeBases: query(() => ops.invoke('kb:list')),
        createKnowledgeBase: query((payload) => ops.invoke('kb:create', payload)),
        updateKnowledgeBase: query((kbId, payload) => ops.invoke('kb:update', kbId, payload)),
        deleteKnowledgeBase: query((kbId) => ops.invoke('kb:delete', kbId)),
        importKnowledgeBaseFiles: query((kbId, files) => ops.invoke('kb:import-files', kbId, files)),
        listKnowledgeBaseDocuments: query((kbId) => ops.invoke('kb:list-documents', kbId)),
        retryKnowledgeBaseDocument: query((documentId) => ops.invoke('kb:retry-document', documentId)),
        setTopicKnowledgeBase: query((agentId, topicId, kbId) => ops.invoke('kb:set-topic-binding', agentId, topicId, kbId)),
        getTopicKnowledgeBase: query((agentId, topicId) => ops.invoke('kb:get-topic-binding', agentId, topicId)),
        retrieveKnowledgeBaseContext: query((payload) => ops.invoke('kb:retrieve-context', payload)),
        searchKnowledgeBase: query((payload) => ops.invoke('kb:search', payload)),
        getKnowledgeBaseRetrievalDebug: query((payload) => ops.invoke('kb:get-retrieval-debug', payload)),
        getKnowledgeBaseDocumentViewData: query((documentId) => ops.invoke('kb:get-document-view-data', documentId)),
        getKnowledgeBaseDocumentGuide: query((documentId) => ops.invoke('kb:get-document-guide', documentId)),
        generateKnowledgeBaseDocumentGuide: query((documentId, options) => ops.invoke('kb:generate-document-guide', documentId, options)),
        listTopicNotes: query((agentId, topicId) => ops.invoke('list-topic-notes', agentId, topicId)),
        listAgentNotes: query((agentId) => ops.invoke('list-agent-notes', agentId)),
        saveTopicNote: query((agentId, topicId, note) => ops.invoke('save-topic-note', agentId, topicId, note)),
        deleteTopicNote: query((agentId, topicId, noteId) => ops.invoke('delete-topic-note', agentId, topicId, noteId)),
        createNoteFromMessage: query((payload) => ops.invoke('create-note-from-message', payload)),
        createNoteFromSelection: query((payload) => ops.invoke('create-note-from-selection', payload)),
        exportNoteAsAttachment: query((payload) => ops.invoke('export-note-as-attachment', payload)),
    };
}

module.exports = {
    createContentCatalog,
};

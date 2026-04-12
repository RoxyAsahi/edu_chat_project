const { query } = require('./apiFactory');

function createContentCatalog(ops) {
    return {
        searchNotes: query((queryText) => ops.invoke('search-notes', queryText)),
        listKnowledgeBases: query(() => ops.invoke('list-knowledge-bases')),
        createKnowledgeBase: query((payload) => ops.invoke('create-knowledge-base', payload)),
        updateKnowledgeBase: query((kbId, payload) => ops.invoke('update-knowledge-base', kbId, payload)),
        deleteKnowledgeBase: query((kbId) => ops.invoke('delete-knowledge-base', kbId)),
        importKnowledgeBaseFiles: query((kbId, files) => ops.invoke('import-knowledge-base-files', kbId, files)),
        listKnowledgeBaseDocuments: query((kbId) => ops.invoke('list-knowledge-base-documents', kbId)),
        retryKnowledgeBaseDocument: query((documentId) => ops.invoke('retry-knowledge-base-document', documentId)),
        setTopicKnowledgeBase: query((agentId, topicId, kbId) => ops.invoke('set-topic-knowledge-base', agentId, topicId, kbId)),
        getTopicKnowledgeBase: query((agentId, topicId) => ops.invoke('get-topic-knowledge-base', agentId, topicId)),
        retrieveKnowledgeBaseContext: query((payload) => ops.invoke('retrieve-knowledge-base-context', payload)),
        searchKnowledgeBase: query((payload) => ops.invoke('search-knowledge-base', payload)),
        getKnowledgeBaseRetrievalDebug: query((payload) => ops.invoke('get-knowledge-base-retrieval-debug', payload)),
        getKnowledgeBaseDocumentViewData: query((documentId) => ops.invoke('get-knowledge-base-document-view-data', documentId)),
        getKnowledgeBaseDocumentGuide: query((documentId) => ops.invoke('get-knowledge-base-document-guide', documentId)),
        generateKnowledgeBaseDocumentGuide: query((documentId, options) => ops.invoke('generate-knowledge-base-document-guide', documentId, options)),
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

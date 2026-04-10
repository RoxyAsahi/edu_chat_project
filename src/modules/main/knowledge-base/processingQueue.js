function createProcessingQueue(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const processor = deps.processor;

    function enqueueDocument(documentId) {
        runtime.enqueueDocument(documentId);
        void drainQueue();
    }

    async function drainQueue() {
        if (!runtime.shouldDrainQueue()) {
            return;
        }

        runtime.setProcessing(true);

        try {
            while (runtime.hasQueuedDocuments() && !runtime.isShuttingDown()) {
                const documentId = runtime.shiftQueuedDocument();
                if (!documentId) {
                    continue;
                }
                await processor.processDocument(documentId);
            }
        } finally {
            runtime.setProcessing(false);
        }
    }

    async function recoverQueuedDocuments() {
        const rows = await repository.listRecoverableDocuments();
        const now = Date.now();
        for (const row of rows) {
            if (row.status === 'processing') {
                await repository.markDocumentPendingAfterRecovery(row.id, now);
            }
            enqueueDocument(row.id);
        }
    }

    async function retryKnowledgeBaseDocument(documentId) {
        const document = await repository.getDocumentById(documentId);
        if (!document) {
            throw new Error('Knowledge base document not found.');
        }

        await repository.deleteDocumentChunks(documentId);
        await repository.updateDocumentState(documentId, {
            status: 'pending',
            error: null,
            lastError: null,
            chunkCount: 0,
            processedAt: null,
            processingStartedAt: null,
            failedAt: null,
            completedAt: null,
        });
        await repository.updateDocumentGuideState(documentId, {
            guideStatus: 'idle',
            guideMarkdown: '',
            guideGeneratedAt: null,
            guideError: null,
        });
        enqueueDocument(documentId);
        return repository.getDocumentById(documentId);
    }

    return {
        enqueueDocument,
        drainQueue,
        recoverQueuedDocuments,
        retryKnowledgeBaseDocument,
    };
}

module.exports = {
    createProcessingQueue,
};

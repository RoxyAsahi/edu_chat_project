const { getDb } = require('./db');
const {
    makeId,
    toNumber,
} = require('./helpers');

function createKnowledgeBaseRepository(deps = {}) {
    const getDbImpl = deps.getDb || getDb;

    function mapDocumentRow(row) {
        const lastError = row.last_error || row.error || null;
        return {
            id: row.id,
            kbId: row.kb_id,
            name: row.name,
            storedPath: row.stored_path,
            mimeType: row.mime_type,
            fileSize: toNumber(row.file_size, 0),
            fileHash: row.file_hash,
            status: row.status,
            error: lastError,
            lastError,
            chunkCount: toNumber(row.chunk_count, 0),
            createdAt: toNumber(row.created_at, 0),
            updatedAt: toNumber(row.updated_at, 0),
            processedAt: toNumber(row.processed_at, null),
            attemptCount: toNumber(row.attempt_count, 0),
            processingStartedAt: toNumber(row.processing_started_at, null),
            failedAt: toNumber(row.failed_at, null),
            completedAt: toNumber(row.completed_at, null),
            contentType: row.content_type || null,
            guideStatus: row.guide_status || 'idle',
            guideMarkdown: row.guide_markdown || '',
            guideGeneratedAt: toNumber(row.guide_generated_at, null),
            guideError: row.guide_error || null,
            extractedText: row.extracted_text || '',
            extractedContentType: row.extracted_content_type || null,
        };
    }

    async function listKnowledgeBases() {
        const db = getDbImpl();
        const result = await db.execute(`
            SELECT
                kb.id,
                kb.name,
                kb.created_at,
                kb.updated_at,
                COUNT(doc.id) AS document_count,
                SUM(CASE WHEN doc.status = 'done' THEN 1 ELSE 0 END) AS done_count,
                SUM(CASE WHEN doc.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                SUM(CASE WHEN doc.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN doc.status = 'processing' THEN 1 ELSE 0 END) AS processing_count
            FROM knowledge_base kb
            LEFT JOIN kb_document doc ON doc.kb_id = kb.id
            GROUP BY kb.id
            ORDER BY kb.updated_at DESC
        `);

        return (result.rows || []).map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: toNumber(row.created_at, 0),
            updatedAt: toNumber(row.updated_at, 0),
            documentCount: toNumber(row.document_count, 0),
            doneCount: toNumber(row.done_count, 0),
            failedCount: toNumber(row.failed_count, 0),
            pendingCount: toNumber(row.pending_count, 0),
            processingCount: toNumber(row.processing_count, 0),
        }));
    }

    async function getKnowledgeBaseById(kbId) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: 'SELECT id, name, created_at, updated_at FROM knowledge_base WHERE id = ? LIMIT 1',
            args: [kbId],
        });

        const row = result.rows[0];
        if (!row) {
            return null;
        }

        return {
            id: row.id,
            name: row.name,
            createdAt: toNumber(row.created_at, 0),
            updatedAt: toNumber(row.updated_at, 0),
        };
    }

    async function createKnowledgeBase(payload = {}) {
        const name = String(payload.name || '').trim();
        if (!name) {
            throw new Error('Knowledge base name is required.');
        }

        const now = Date.now();
        const kb = {
            id: makeId('kb'),
            name,
            createdAt: now,
            updatedAt: now,
        };

        const db = getDbImpl();
        await db.execute({
            sql: 'INSERT INTO knowledge_base (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
            args: [kb.id, kb.name, kb.createdAt, kb.updatedAt],
        });

        return kb;
    }

    async function updateKnowledgeBase(kbId, payload = {}) {
        const existing = await getKnowledgeBaseById(kbId);
        if (!existing) {
            throw new Error('Knowledge base not found.');
        }

        const name = String(payload.name || existing.name).trim();
        if (!name) {
            throw new Error('Knowledge base name is required.');
        }

        const updatedAt = Date.now();
        const db = getDbImpl();
        await db.execute({
            sql: 'UPDATE knowledge_base SET name = ?, updated_at = ? WHERE id = ?',
            args: [name, updatedAt, kbId],
        });

        return {
            ...existing,
            name,
            updatedAt,
        };
    }

    async function touchKnowledgeBase(kbId) {
        const db = getDbImpl();
        await db.execute({
            sql: 'UPDATE knowledge_base SET updated_at = ? WHERE id = ?',
            args: [Date.now(), kbId],
        });
    }

    async function listKnowledgeBaseDocuments(kbId) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: `SELECT id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at,
                attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error,
                extracted_text, extracted_content_type
                FROM kb_document
                WHERE kb_id = ?
                ORDER BY created_at DESC`,
            args: [kbId],
        });

        return (result.rows || []).map(mapDocumentRow);
    }

    async function getDocumentById(documentId) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: `SELECT id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at,
                attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error,
                extracted_text, extracted_content_type
                FROM kb_document
                WHERE id = ?
                LIMIT 1`,
            args: [documentId],
        });

        const row = result.rows[0];
        return row ? mapDocumentRow(row) : null;
    }

    async function findDocumentIdByHash(kbId, fileHash) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: 'SELECT id FROM kb_document WHERE kb_id = ? AND file_hash = ? LIMIT 1',
            args: [kbId, fileHash],
        });

        return result.rows[0]?.id || null;
    }

    async function createDocument(payload = {}) {
        const now = Date.now();
        const documentId = makeId('kbdoc');
        const db = getDbImpl();
        await db.execute({
            sql: `INSERT INTO kb_document
                (id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at, attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, 'idle', '', NULL, NULL)`,
            args: [
                documentId,
                payload.kbId,
                payload.name,
                payload.storedPath,
                payload.mimeType || '',
                toNumber(payload.fileSize, 0),
                payload.fileHash,
                now,
                now,
            ],
        });

        return getDocumentById(documentId);
    }

    async function updateDocumentState(documentId, patch = {}) {
        const document = await getDocumentById(documentId);
        if (!document) {
            return null;
        }

        const nextDocument = {
            ...document,
            ...patch,
            updatedAt: Date.now(),
        };
        const resolvedError = patch.lastError !== undefined
            ? patch.lastError
            : (patch.error !== undefined ? patch.error : nextDocument.lastError);
        nextDocument.lastError = resolvedError || null;
        nextDocument.error = nextDocument.lastError;

        const db = getDbImpl();
        await db.execute({
            sql: `UPDATE kb_document
                SET status = ?, error = ?, chunk_count = ?, updated_at = ?, processed_at = ?, attempt_count = ?, processing_started_at = ?, failed_at = ?, completed_at = ?, last_error = ?, content_type = ?
                WHERE id = ?`,
            args: [
                nextDocument.status,
                nextDocument.error,
                toNumber(nextDocument.chunkCount, 0),
                nextDocument.updatedAt,
                nextDocument.processedAt,
                toNumber(nextDocument.attemptCount, 0),
                nextDocument.processingStartedAt,
                nextDocument.failedAt,
                nextDocument.completedAt,
                nextDocument.lastError,
                nextDocument.contentType,
                documentId,
            ],
        });

        await touchKnowledgeBase(document.kbId);
        return nextDocument;
    }

    async function updateDocumentGuideState(documentId, patch = {}) {
        const document = await getDocumentById(documentId);
        if (!document) {
            return null;
        }

        const nextDocument = {
            ...document,
            ...patch,
            guideStatus: patch.guideStatus ?? document.guideStatus ?? 'idle',
            guideMarkdown: patch.guideMarkdown ?? document.guideMarkdown ?? '',
            guideGeneratedAt: patch.guideGeneratedAt ?? document.guideGeneratedAt ?? null,
            guideError: patch.guideError ?? document.guideError ?? null,
            updatedAt: Date.now(),
        };

        const db = getDbImpl();
        await db.execute({
            sql: `UPDATE kb_document
                SET guide_status = ?, guide_markdown = ?, guide_generated_at = ?, guide_error = ?, updated_at = ?
                WHERE id = ?`,
            args: [
                nextDocument.guideStatus || 'idle',
                nextDocument.guideMarkdown || '',
                nextDocument.guideGeneratedAt,
                nextDocument.guideError,
                nextDocument.updatedAt,
                documentId,
            ],
        });

        await touchKnowledgeBase(document.kbId);
        return nextDocument;
    }

    async function updateDocumentDerivedContent(documentId, patch = {}) {
        const document = await getDocumentById(documentId);
        if (!document) {
            return null;
        }

        const nextDocument = {
            ...document,
            extractedText: typeof patch.extractedText === 'string' ? patch.extractedText : (document.extractedText || ''),
            extractedContentType: patch.extractedContentType ?? document.extractedContentType ?? null,
            updatedAt: Date.now(),
        };

        const db = getDbImpl();
        await db.execute({
            sql: `UPDATE kb_document
                SET extracted_text = ?, extracted_content_type = ?, updated_at = ?
                WHERE id = ?`,
            args: [
                nextDocument.extractedText || '',
                nextDocument.extractedContentType,
                nextDocument.updatedAt,
                documentId,
            ],
        });

        await touchKnowledgeBase(document.kbId);
        return nextDocument;
    }

    async function updateDocumentMimeType(documentId, mimeType) {
        const db = getDbImpl();
        await db.execute({
            sql: 'UPDATE kb_document SET mime_type = ? WHERE id = ?',
            args: [mimeType, documentId],
        });
    }

    async function deleteDocumentChunks(documentId) {
        const db = getDbImpl();
        await db.execute({
            sql: 'DELETE FROM kb_chunk WHERE document_id = ?',
            args: [documentId],
        });
    }

    async function insertDocumentChunk(payload = {}) {
        const db = getDbImpl();
        await db.execute({
            sql: `INSERT INTO kb_chunk
                (id, kb_id, document_id, chunk_index, content, embedding, created_at, content_type, char_length, section_title, page_number, paragraph_index)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                makeId('kbchunk'),
                payload.kbId,
                payload.documentId,
                payload.chunkIndex,
                payload.content,
                JSON.stringify(payload.embedding),
                payload.createdAt,
                payload.contentType,
                toNumber(payload.charLength, String(payload.content || '').length),
                payload.sectionTitle || null,
                payload.pageNumber,
                payload.paragraphIndex,
            ],
        });
    }

    async function listRecoverableDocuments() {
        const db = getDbImpl();
        const result = await db.execute(`
            SELECT id, status
            FROM kb_document
            WHERE status IN ('pending', 'processing')
            ORDER BY created_at ASC
        `);

        return result.rows || [];
    }

    async function markDocumentPendingAfterRecovery(documentId, updatedAt = Date.now()) {
        const db = getDbImpl();
        await db.execute({
            sql: `UPDATE kb_document
                SET status = 'pending', updated_at = ?, processing_started_at = NULL
                WHERE id = ?`,
            args: [updatedAt, documentId],
        });
    }

    async function listChunkRowsByKnowledgeBase(kbId) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: `SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding, c.content_type, c.char_length, c.section_title, c.page_number, c.paragraph_index, d.name AS document_name
                FROM kb_chunk c
                JOIN kb_document d ON d.id = c.document_id
                WHERE c.kb_id = ? AND d.status = 'done'`,
            args: [kbId],
        });

        return result.rows || [];
    }

    async function listStoredPathsByKnowledgeBase(kbId) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: 'SELECT stored_path FROM kb_document WHERE kb_id = ?',
            args: [kbId],
        });

        return (result.rows || []).map((row) => row.stored_path).filter(Boolean);
    }

    async function countDocumentsByStoredPath(storedPath) {
        const db = getDbImpl();
        const result = await db.execute({
            sql: 'SELECT COUNT(1) AS ref_count FROM kb_document WHERE stored_path = ?',
            args: [storedPath],
        });

        return toNumber(result.rows?.[0]?.ref_count, 0);
    }

    async function deleteKnowledgeBaseData(kbId) {
        const db = getDbImpl();
        await db.execute({ sql: 'DELETE FROM kb_chunk WHERE kb_id = ?', args: [kbId] });
        await db.execute({ sql: 'DELETE FROM kb_document WHERE kb_id = ?', args: [kbId] });
        await db.execute({ sql: 'DELETE FROM knowledge_base WHERE id = ?', args: [kbId] });
    }

    return {
        mapDocumentRow,
        listKnowledgeBases,
        getKnowledgeBaseById,
        createKnowledgeBase,
        updateKnowledgeBase,
        touchKnowledgeBase,
        listKnowledgeBaseDocuments,
        getDocumentById,
        findDocumentIdByHash,
        createDocument,
        updateDocumentState,
        updateDocumentGuideState,
        updateDocumentDerivedContent,
        updateDocumentMimeType,
        deleteDocumentChunks,
        insertDocumentChunk,
        listRecoverableDocuments,
        markDocumentPendingAfterRecovery,
        listChunkRowsByKnowledgeBase,
        listStoredPathsByKnowledgeBase,
        countDocumentsByStoredPath,
        deleteKnowledgeBaseData,
    };
}

module.exports = {
    createKnowledgeBaseRepository,
};

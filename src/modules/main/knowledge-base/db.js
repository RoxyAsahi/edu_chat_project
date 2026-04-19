const fs = require('fs-extra');
const path = require('path');
const { createClient } = require('@libsql/client');

let dbClient = null;
let dbPath = null;

async function getTableColumns(tableName) {
    const result = await dbClient.execute(`PRAGMA table_info(${tableName})`);
    return new Set((result.rows || []).map((row) => String(row.name)));
}

async function ensureColumn(tableName, columnName, definition) {
    const columns = await getTableColumns(tableName);
    if (columns.has(columnName)) {
        return;
    }

    await dbClient.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function initializeDatabase(rootDir) {
    if (dbClient) {
        return dbClient;
    }

    const dbDir = path.join(rootDir, 'KnowledgeBase');
    dbPath = path.join(dbDir, 'knowledge-base.db');
    await fs.ensureDir(dbDir);

    dbClient = createClient({
        url: `file:${dbPath}`,
    });

    const statements = [
        `CREATE TABLE IF NOT EXISTS knowledge_base (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS kb_document (
            id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            mime_type TEXT,
            file_size INTEGER DEFAULT 0,
            file_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            chunk_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            processed_at INTEGER,
            extracted_text TEXT,
            extracted_content_type TEXT,
            FOREIGN KEY (kb_id) REFERENCES knowledge_base(id)
        )`,
        `CREATE TABLE IF NOT EXISTS kb_chunk (
            id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (kb_id) REFERENCES knowledge_base(id),
            FOREIGN KEY (document_id) REFERENCES kb_document(id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_kb_document_kb_id ON kb_document(kb_id)',
        'CREATE INDEX IF NOT EXISTS idx_kb_chunk_kb_id ON kb_chunk(kb_id)',
        'CREATE INDEX IF NOT EXISTS idx_kb_chunk_document_id ON kb_chunk(document_id)',
    ];

    for (const statement of statements) {
        await dbClient.execute(statement);
    }

    await ensureColumn('kb_document', 'attempt_count', 'INTEGER DEFAULT 0');
    await ensureColumn('kb_document', 'processing_started_at', 'INTEGER');
    await ensureColumn('kb_document', 'failed_at', 'INTEGER');
    await ensureColumn('kb_document', 'completed_at', 'INTEGER');
    await ensureColumn('kb_document', 'last_error', 'TEXT');
    await ensureColumn('kb_document', 'content_type', 'TEXT');
    await ensureColumn('kb_document', 'guide_status', "TEXT DEFAULT 'idle'");
    await ensureColumn('kb_document', 'guide_markdown', 'TEXT');
    await ensureColumn('kb_document', 'guide_generated_at', 'INTEGER');
    await ensureColumn('kb_document', 'guide_error', 'TEXT');
    await ensureColumn('kb_document', 'extracted_text', 'TEXT');
    await ensureColumn('kb_document', 'extracted_content_type', 'TEXT');

    await ensureColumn('kb_chunk', 'content_type', 'TEXT');
    await ensureColumn('kb_chunk', 'char_length', 'INTEGER DEFAULT 0');
    await ensureColumn('kb_chunk', 'section_title', 'TEXT');
    await ensureColumn('kb_chunk', 'page_number', 'INTEGER');
    await ensureColumn('kb_chunk', 'paragraph_index', 'INTEGER');

    await dbClient.execute(`
        UPDATE kb_document
        SET last_error = COALESCE(last_error, error)
        WHERE error IS NOT NULL AND (last_error IS NULL OR last_error = '')
    `);
    await dbClient.execute(`
        UPDATE kb_document
        SET completed_at = COALESCE(completed_at, processed_at)
        WHERE processed_at IS NOT NULL AND status = 'done'
    `);
    await dbClient.execute(`
        UPDATE kb_document
        SET failed_at = COALESCE(failed_at, updated_at)
        WHERE status = 'failed' AND failed_at IS NULL
    `);
    await dbClient.execute(`
        UPDATE kb_document
        SET guide_status = COALESCE(guide_status, 'idle')
        WHERE guide_status IS NULL OR guide_status = ''
    `);

    return dbClient;
}

function getDb() {
    if (!dbClient) {
        throw new Error('Knowledge base database is not initialized.');
    }

    return dbClient;
}

function getDbPath() {
    return dbPath;
}

async function closeDatabase() {
    if (!dbClient) {
        return;
    }

    if (typeof dbClient.close === 'function') {
        await dbClient.close();
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    dbClient = null;
    dbPath = null;
}

module.exports = {
    initializeDatabase,
    getDb,
    getDbPath,
    closeDatabase,
};

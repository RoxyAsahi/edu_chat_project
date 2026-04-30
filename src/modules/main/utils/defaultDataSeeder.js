const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createClient } = require('@libsql/client');

const KNOWLEDGE_BASE_SCHEMA = [
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
        attempt_count INTEGER DEFAULT 0,
        processing_started_at INTEGER,
        failed_at INTEGER,
        completed_at INTEGER,
        last_error TEXT,
        content_type TEXT,
        guide_status TEXT DEFAULT 'idle',
        guide_markdown TEXT,
        guide_generated_at INTEGER,
        guide_error TEXT,
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
        content_type TEXT,
        char_length INTEGER DEFAULT 0,
        section_title TEXT,
        page_number INTEGER,
        paragraph_index INTEGER,
        FOREIGN KEY (kb_id) REFERENCES knowledge_base(id),
        FOREIGN KEY (document_id) REFERENCES kb_document(id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_kb_document_kb_id ON kb_document(kb_id)',
    'CREATE INDEX IF NOT EXISTS idx_kb_chunk_kb_id ON kb_chunk(kb_id)',
    'CREATE INDEX IF NOT EXISTS idx_kb_chunk_document_id ON kb_chunk(document_id)',
];

function isAsarPath(filePath) {
    return String(filePath || '').split(path.sep).includes('app.asar')
        || String(filePath || '').includes('.asar/');
}

async function getSourceStat(sourcePath) {
    try {
        return await fs.stat(sourcePath);
    } catch (_error) {
        return null;
    }
}

async function sourcePathExists(sourcePath) {
    return Boolean(await getSourceStat(sourcePath));
}

async function copySourceFile(sourcePath, targetPath) {
    await fs.ensureDir(path.dirname(targetPath));
    const contents = await fs.readFile(sourcePath);
    await fs.writeFile(targetPath, contents);
}

async function copyMissingTree(sourcePath, targetPath) {
    const stat = await getSourceStat(sourcePath);
    if (!stat) {
        return { copiedFiles: 0, skippedFiles: 0, copiedFilePaths: [] };
    }

    if (stat.isDirectory()) {
        await fs.ensureDir(targetPath);
        let copiedFiles = 0;
        let skippedFiles = 0;
        const copiedFilePaths = [];
        const entries = await fs.readdir(sourcePath);

        for (const entry of entries) {
            const childResult = await copyMissingTree(
                path.join(sourcePath, entry),
                path.join(targetPath, entry),
            );
            copiedFiles += childResult.copiedFiles;
            skippedFiles += childResult.skippedFiles;
            copiedFilePaths.push(...childResult.copiedFilePaths);
        }

        return { copiedFiles, skippedFiles, copiedFilePaths };
    }

    if (await fs.pathExists(targetPath)) {
        return { copiedFiles: 0, skippedFiles: 1, copiedFilePaths: [] };
    }

    await copySourceFile(sourcePath, targetPath);
    return { copiedFiles: 1, skippedFiles: 0, copiedFilePaths: [targetPath] };
}

async function hydrateHistoryAttachmentPaths(historyPath, dataRoot) {
    let history;
    try {
        history = await fs.readJson(historyPath);
    } catch (_error) {
        return false;
    }

    if (!Array.isArray(history)) {
        return false;
    }

    let changed = false;
    const attachmentsDir = path.join(dataRoot, 'UserData', 'attachments');

    for (const message of history) {
        if (!Array.isArray(message?.attachments)) {
            continue;
        }

        for (const attachment of message.attachments) {
            if (!attachment?.internalFileName) {
                continue;
            }
            const attachmentUrl = pathToFileURL(path.join(attachmentsDir, attachment.internalFileName)).href;
            if (attachment.internalPath !== attachmentUrl) {
                attachment.internalPath = attachmentUrl;
                changed = true;
            }
            if (attachment.src !== attachmentUrl) {
                attachment.src = attachmentUrl;
                changed = true;
            }
        }
    }

    if (changed) {
        await fs.writeJson(historyPath, history, { spaces: 2 });
    }

    return changed;
}

async function initializeKnowledgeBaseDb(dbPath) {
    await fs.ensureDir(path.dirname(dbPath));
    const db = createClient({
        url: `file:${dbPath}`,
    });

    for (const statement of KNOWLEDGE_BASE_SCHEMA) {
        await db.execute(statement);
    }

    return db;
}

async function getTableColumnNames(db, tableName) {
    const result = await db.execute(`PRAGMA table_info(${tableName})`);
    return (result.rows || []).map((row) => String(row.name));
}

async function insertRowsIfMissing(targetDb, tableName, rows, mutateRow = null) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return 0;
    }

    const targetColumns = await getTableColumnNames(targetDb, tableName);
    const targetColumnSet = new Set(targetColumns);
    let insertedRows = 0;

    for (const sourceRow of rows) {
        const row = mutateRow ? mutateRow({ ...sourceRow }) : { ...sourceRow };
        const columns = Object.keys(row).filter((column) => targetColumnSet.has(column));
        if (columns.length === 0) {
            continue;
        }

        const placeholders = columns.map(() => '?').join(', ');
        const result = await targetDb.execute({
            sql: `INSERT OR IGNORE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
            args: columns.map((column) => row[column]),
        });
        insertedRows += Number(result.rowsAffected || 0);
    }

    return insertedRows;
}

async function rewriteKnowledgeBaseStoredPaths(dbPath, targetFilesDir) {
    const db = createClient({ url: `file:${dbPath}` });

    try {
        const result = await db.execute('SELECT id, stored_path FROM kb_document');
        for (const row of result.rows || []) {
            const documentId = String(row.id || '').trim();
            const storedPath = String(row.stored_path || '').trim();
            if (!documentId || !storedPath) {
                continue;
            }

            await db.execute({
                sql: 'UPDATE kb_document SET stored_path = ? WHERE id = ?',
                args: [path.join(targetFilesDir, path.basename(storedPath)), documentId],
            });
        }
    } finally {
        if (typeof db.close === 'function') {
            await db.close();
        }
    }
}

async function importSeedKnowledgeBase({ dataRoot, seedRoot }) {
    const seedDbPath = path.join(seedRoot, 'KnowledgeBase', 'knowledge-base.db');
    if (!await sourcePathExists(seedDbPath)) {
        return { knowledgeBases: 0, documents: 0, chunks: 0 };
    }

    const targetDbPath = path.join(dataRoot, 'KnowledgeBase', 'knowledge-base.db');
    const targetFilesDir = path.join(dataRoot, 'KnowledgeBase', 'files');
    if (isAsarPath(seedDbPath) && !await fs.pathExists(targetDbPath)) {
        await copySourceFile(seedDbPath, targetDbPath);
        await rewriteKnowledgeBaseStoredPaths(targetDbPath, targetFilesDir);
        return { knowledgeBases: 0, documents: 0, chunks: 0 };
    }

    let readableSeedDbPath = seedDbPath;
    let tempSeedDbRoot = null;
    if (isAsarPath(seedDbPath)) {
        tempSeedDbRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-seed-kb-'));
        readableSeedDbPath = path.join(tempSeedDbRoot, 'knowledge-base.db');
        await copySourceFile(seedDbPath, readableSeedDbPath);
    }

    const seedDb = createClient({ url: `file:${readableSeedDbPath}` });
    const targetDb = await initializeKnowledgeBaseDb(targetDbPath);

    try {
        const knowledgeBases = (await seedDb.execute('SELECT * FROM knowledge_base')).rows || [];
        const documents = (await seedDb.execute('SELECT * FROM kb_document')).rows || [];
        const chunks = (await seedDb.execute('SELECT * FROM kb_chunk')).rows || [];

        return {
            knowledgeBases: await insertRowsIfMissing(targetDb, 'knowledge_base', knowledgeBases),
            documents: await insertRowsIfMissing(targetDb, 'kb_document', documents, (row) => ({
                ...row,
                stored_path: path.join(targetFilesDir, path.basename(String(row.stored_path || ''))),
            })),
            chunks: await insertRowsIfMissing(targetDb, 'kb_chunk', chunks),
        };
    } finally {
        if (typeof seedDb.close === 'function') {
            await seedDb.close();
        }
        if (typeof targetDb.close === 'function') {
            await targetDb.close();
        }
        if (tempSeedDbRoot) {
            await fs.remove(tempSeedDbRoot);
        }
    }
}

async function seedDefaultDataRoot({ dataRoot, seedRoot }) {
    if (!dataRoot || !seedRoot || !await sourcePathExists(seedRoot)) {
        return {
            copiedFiles: 0,
            skippedFiles: 0,
            hydratedHistories: 0,
            knowledgeBaseImports: { knowledgeBases: 0, documents: 0, chunks: 0 },
            seedRootMissing: true,
        };
    }

    const seedTargets = [
        'Agents',
        'UserData',
        path.join('KnowledgeBase', 'files'),
        'StudyLogs',
        'StudyDiary',
    ];

    let copiedFiles = 0;
    let skippedFiles = 0;
    const copiedFilePaths = [];

    for (const targetName of seedTargets) {
        const result = await copyMissingTree(
            path.join(seedRoot, targetName),
            path.join(dataRoot, targetName),
        );
        copiedFiles += result.copiedFiles;
        skippedFiles += result.skippedFiles;
        copiedFilePaths.push(...result.copiedFilePaths);
    }

    let hydratedHistories = 0;
    for (const copiedPath of copiedFilePaths) {
        if (path.basename(copiedPath) === 'history.json'
            && await hydrateHistoryAttachmentPaths(copiedPath, dataRoot)) {
            hydratedHistories += 1;
        }
    }

    return {
        copiedFiles,
        skippedFiles,
        hydratedHistories,
        knowledgeBaseImports: await importSeedKnowledgeBase({ dataRoot, seedRoot }),
        seedRootMissing: false,
    };
}

module.exports = {
    copyMissingTree,
    hydrateHistoryAttachmentPaths,
    importSeedKnowledgeBase,
    seedDefaultDataRoot,
    sourcePathExists,
};

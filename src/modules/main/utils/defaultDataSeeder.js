const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createClient } = require('@libsql/client');
const { createChatHistoryStore } = require('../chat-history/store');

const KNOWLEDGE_BASE_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS knowledge_base (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'source',
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

async function copyMissingTree(sourcePath, targetPath, options = {}) {
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
                options,
            );
            copiedFiles += childResult.copiedFiles;
            skippedFiles += childResult.skippedFiles;
            copiedFilePaths.push(...childResult.copiedFilePaths);
        }

        return { copiedFiles, skippedFiles, copiedFilePaths };
    }

    if (typeof options.shouldCopyFile === 'function' && !options.shouldCopyFile(sourcePath, targetPath)) {
        return { copiedFiles: 0, skippedFiles: 1, copiedFilePaths: [] };
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

function hydrateHistoryAttachmentUrls(history = [], dataRoot) {
    if (!Array.isArray(history)) {
        return { history: [], changed: false };
    }

    let changed = false;
    const attachmentsDir = path.join(dataRoot, 'UserData', 'attachments');
    const hydrated = history.map((message) => {
        if (!Array.isArray(message?.attachments)) {
            return message;
        }

        let messageChanged = false;
        const attachments = message.attachments.map((attachment) => {
            if (!attachment?.internalFileName) {
                return attachment;
            }
            const attachmentUrl = pathToFileURL(path.join(attachmentsDir, attachment.internalFileName)).href;
            if (attachment.internalPath === attachmentUrl && attachment.src === attachmentUrl) {
                return attachment;
            }
            changed = true;
            messageChanged = true;
            return {
                ...attachment,
                internalPath: attachmentUrl,
                src: attachmentUrl,
            };
        });

        return messageChanged ? { ...message, attachments } : message;
    });

    return { history: hydrated, changed };
}

async function initializeKnowledgeBaseDb(dbPath) {
    await fs.ensureDir(path.dirname(dbPath));
    const db = createClient({
        url: `file:${dbPath}`,
    });

    for (const statement of KNOWLEDGE_BASE_SCHEMA) {
        await db.execute(statement);
    }

    await ensureTableColumn(db, 'knowledge_base', 'kind', "TEXT NOT NULL DEFAULT 'source'");
    await db.execute(`
        UPDATE knowledge_base
        SET kind = 'source'
        WHERE kind IS NULL OR kind = ''
    `);

    await ensureTableColumn(db, 'kb_document', 'attempt_count', 'INTEGER DEFAULT 0');
    await ensureTableColumn(db, 'kb_document', 'processing_started_at', 'INTEGER');
    await ensureTableColumn(db, 'kb_document', 'failed_at', 'INTEGER');
    await ensureTableColumn(db, 'kb_document', 'completed_at', 'INTEGER');
    await ensureTableColumn(db, 'kb_document', 'last_error', 'TEXT');
    await ensureTableColumn(db, 'kb_document', 'content_type', 'TEXT');
    await ensureTableColumn(db, 'kb_document', 'guide_status', "TEXT DEFAULT 'idle'");
    await ensureTableColumn(db, 'kb_document', 'guide_markdown', 'TEXT');
    await ensureTableColumn(db, 'kb_document', 'guide_generated_at', 'INTEGER');
    await ensureTableColumn(db, 'kb_document', 'guide_error', 'TEXT');
    await ensureTableColumn(db, 'kb_document', 'extracted_text', 'TEXT');
    await ensureTableColumn(db, 'kb_document', 'extracted_content_type', 'TEXT');

    await ensureTableColumn(db, 'kb_chunk', 'content_type', 'TEXT');
    await ensureTableColumn(db, 'kb_chunk', 'char_length', 'INTEGER DEFAULT 0');
    await ensureTableColumn(db, 'kb_chunk', 'section_title', 'TEXT');
    await ensureTableColumn(db, 'kb_chunk', 'page_number', 'INTEGER');
    await ensureTableColumn(db, 'kb_chunk', 'paragraph_index', 'INTEGER');

    return db;
}

async function getTableColumnNames(db, tableName) {
    const result = await db.execute(`PRAGMA table_info(${tableName})`);
    return (result.rows || []).map((row) => String(row.name));
}

async function ensureTableColumn(db, tableName, columnName, definition) {
    const columns = await getTableColumnNames(db, tableName);
    if (columns.includes(columnName)) {
        return false;
    }

    await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    return true;
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

async function repairSeedKnowledgeBaseKinds(targetDb, knowledgeBases = []) {
    if (!Array.isArray(knowledgeBases) || knowledgeBases.length === 0) {
        return;
    }

    const targetColumns = await getTableColumnNames(targetDb, 'knowledge_base');
    if (!targetColumns.includes('kind')) {
        return;
    }

    for (const row of knowledgeBases) {
        const kbId = String(row?.id || '').trim();
        const kind = String(row?.kind || '').trim().toLowerCase();
        if (!kbId || kind !== 'shelf') {
            continue;
        }

        await targetDb.execute({
            sql: `UPDATE knowledge_base
                SET kind = 'shelf'
                WHERE id = ? AND (kind IS NULL OR kind = '' OR kind = 'source')`,
            args: [kbId],
        });
    }
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

        const imported = {
            knowledgeBases: await insertRowsIfMissing(targetDb, 'knowledge_base', knowledgeBases),
            documents: await insertRowsIfMissing(targetDb, 'kb_document', documents, (row) => ({
                ...row,
                stored_path: path.join(targetFilesDir, path.basename(String(row.stored_path || ''))),
            })),
            chunks: await insertRowsIfMissing(targetDb, 'kb_chunk', chunks),
        };
        await repairSeedKnowledgeBaseKinds(targetDb, knowledgeBases);
        return imported;
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

function parseSeedHistoryTarget(userDataRoot, historyPath) {
    const relative = path.relative(userDataRoot, historyPath);
    const segments = relative.split(path.sep);
    if (segments.length !== 4 || segments[1] !== 'topics' || segments[3] !== 'history.json') {
        return null;
    }

    const [agentId, , topicId] = segments;
    return agentId && topicId ? { agentId, topicId } : null;
}

async function collectHistoryJsonPaths(rootPath) {
    const stat = await getSourceStat(rootPath);
    if (!stat) {
        return [];
    }
    if (!stat.isDirectory()) {
        return path.basename(rootPath) === 'history.json' ? [rootPath] : [];
    }

    const entries = await fs.readdir(rootPath);
    const results = [];
    for (const entry of entries) {
        results.push(...await collectHistoryJsonPaths(path.join(rootPath, entry)));
    }
    return results;
}

async function importSeedChatHistories({ dataRoot, seedRoot, historyPaths = [] }) {
    const seedUserDataRoot = seedRoot ? path.join(seedRoot, 'UserData') : null;
    const targetUserDataRoot = path.join(dataRoot, 'UserData');
    const seedHistoryPaths = seedUserDataRoot ? await collectHistoryJsonPaths(seedUserDataRoot) : [];
    const normalizedHistoryPaths = [
        ...seedHistoryPaths.map((historyPath) => ({
            historyPath: path.resolve(historyPath),
            userDataRoot: path.resolve(seedUserDataRoot),
            removeAfterImport: false,
        })),
        ...(Array.isArray(historyPaths) ? historyPaths : []).map((historyPath) => ({
            historyPath: path.resolve(historyPath),
            userDataRoot: path.resolve(targetUserDataRoot),
            removeAfterImport: true,
        })),
    ].filter((entry) => path.basename(entry.historyPath) === 'history.json');

    const store = createChatHistoryStore({ dataRoot });
    let importedHistories = 0;
    let hydratedHistories = 0;
    const cleanupPaths = [];
    try {
        const seenTargets = new Set();
        for (const { historyPath, userDataRoot, removeAfterImport } of normalizedHistoryPaths) {
            const target = parseSeedHistoryTarget(userDataRoot, historyPath);
            if (!target) {
                continue;
            }
            const targetKey = `${target.agentId}\0${target.topicId}`;
            if (seenTargets.has(targetKey)) {
                if (removeAfterImport) cleanupPaths.push(historyPath);
                continue;
            }
            seenTargets.add(targetKey);

            let history = [];
            try {
                const data = await fs.readJson(historyPath);
                history = Array.isArray(data) ? data : [];
            } catch (_error) {
                continue;
            }

            const existingState = await store.getTopicState(target.agentId, target.topicId);
            if (existingState && (Number(existingState.message_count || 0) > 0 || history.length === 0)) {
                if (removeAfterImport) cleanupPaths.push(historyPath);
                continue;
            }

            const hydrated = hydrateHistoryAttachmentUrls(history, dataRoot);
            if (hydrated.changed) {
                hydratedHistories += 1;
            }
            await store.replaceHistory(target.agentId, target.topicId, hydrated.history);
            importedHistories += 1;
            if (removeAfterImport) cleanupPaths.push(historyPath);
        }
    } finally {
        await store.close();
    }

    await removeImportedSeedHistoryFiles({ dataRoot, historyPaths: cleanupPaths });
    return { importedHistories, hydratedHistories };
}

async function removeImportedSeedHistoryFiles({ dataRoot, historyPaths = [] }) {
    const userDataRoot = path.join(dataRoot, 'UserData');
    for (const historyPath of historyPaths) {
        const resolvedHistoryPath = path.resolve(historyPath);
        const relativeToUserData = path.relative(path.resolve(userDataRoot), resolvedHistoryPath);
        if (!relativeToUserData || relativeToUserData.startsWith('..') || path.isAbsolute(relativeToUserData)) {
            continue;
        }
        await fs.remove(resolvedHistoryPath).catch(() => {});
    }
}

async function seedDefaultDataRoot({ dataRoot, seedRoot }) {
    if (!dataRoot || !seedRoot || !await sourcePathExists(seedRoot)) {
        return {
            copiedFiles: 0,
            skippedFiles: 0,
            hydratedHistories: 0,
            chatHistoryImports: 0,
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

    for (const targetName of seedTargets) {
        const result = await copyMissingTree(
            path.join(seedRoot, targetName),
            path.join(dataRoot, targetName),
            {
                shouldCopyFile(sourcePath) {
                    return !(targetName === 'UserData' && path.basename(sourcePath) === 'history.json');
                },
            },
        );
        copiedFiles += result.copiedFiles;
        skippedFiles += result.skippedFiles;
    }

    let hydratedHistories = 0;
    const existingTargetHistoryPaths = await collectHistoryJsonPaths(path.join(dataRoot, 'UserData'));
    const chatHistoryImportResult = await importSeedChatHistories({
        dataRoot,
        seedRoot,
        historyPaths: existingTargetHistoryPaths,
    });
    hydratedHistories += chatHistoryImportResult.hydratedHistories;

    return {
        copiedFiles,
        skippedFiles,
        hydratedHistories,
        chatHistoryImports: chatHistoryImportResult.importedHistories,
        knowledgeBaseImports: await importSeedKnowledgeBase({ dataRoot, seedRoot }),
        seedRootMissing: false,
    };
}

module.exports = {
    copyMissingTree,
    hydrateHistoryAttachmentPaths,
    importSeedChatHistories,
    importSeedKnowledgeBase,
    seedDefaultDataRoot,
    sourcePathExists,
};

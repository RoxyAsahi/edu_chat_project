const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
    seedDefaultDataRoot,
} = require('../src/modules/main/utils/defaultDataSeeder');

test('default data seeder copies missing agents and rewrites seeded attachment file URLs', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-default-seed-test-'));
    const dataRoot = path.join(tempRoot, 'data');
    const seedRoot = path.join(tempRoot, 'seed');
    const agentId = 'seed_agent';
    const topicId = 'default';
    const attachmentFileName = 'seed-image.png';

    t.after(async () => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            try {
                await fs.remove(tempRoot);
                return;
            } catch (error) {
                if (error.code !== 'EBUSY' || attempt === 9) {
                    if (error.code === 'EBUSY') {
                        return;
                    }
                    throw error;
                }
            }
        }
    });

    await fs.outputJson(path.join(seedRoot, 'Agents', agentId, 'config.json'), {
        name: 'Seed Agent',
        topics: [{ id: topicId, name: 'Seed Topic' }],
    }, { spaces: 2 });
    await fs.outputFile(path.join(seedRoot, 'UserData', 'attachments', attachmentFileName), 'fake image bytes');
    await fs.outputJson(path.join(seedRoot, 'UserData', agentId, 'topics', topicId, 'history.json'), [{
        role: 'user',
        content: 'hello',
        attachments: [{
            internalFileName: attachmentFileName,
            internalPath: 'file://C:/old/path/seed-image.png',
            src: 'file://C:/old/path/seed-image.png',
        }],
    }], { spaces: 2 });

    const seedKbDbPath = path.join(seedRoot, 'KnowledgeBase', 'knowledge-base.db');
    await fs.ensureDir(path.dirname(seedKbDbPath));
    const { createClient } = require('@libsql/client');
    const seedKbDb = createClient({ url: `file:${seedKbDbPath}` });
    await seedKbDb.execute('CREATE TABLE knowledge_base (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    await seedKbDb.execute(`CREATE TABLE kb_document (
        id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, name TEXT NOT NULL, stored_path TEXT NOT NULL, mime_type TEXT,
        file_size INTEGER DEFAULT 0, file_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT,
        chunk_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, processed_at INTEGER,
        extracted_text TEXT, extracted_content_type TEXT, attempt_count INTEGER DEFAULT 0, processing_started_at INTEGER,
        failed_at INTEGER, completed_at INTEGER, last_error TEXT, content_type TEXT, guide_status TEXT DEFAULT 'idle',
        guide_markdown TEXT, guide_generated_at INTEGER, guide_error TEXT
    )`);
    await seedKbDb.execute(`CREATE TABLE kb_chunk (
        id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL, embedding TEXT NOT NULL, created_at INTEGER NOT NULL, content_type TEXT,
        char_length INTEGER DEFAULT 0, section_title TEXT, page_number INTEGER, paragraph_index INTEGER
    )`);
    await seedKbDb.execute({
        sql: 'INSERT INTO knowledge_base (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        args: ['kb_seed', 'Seed KB', 1, 2],
    });
    await seedKbDb.execute({
        sql: `INSERT INTO kb_document
            (id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, chunk_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ['doc_seed', 'kb_seed', 'Seed Source.png', 'C:/old/kb/seed-source.png', 'image/png', 10, 'seed-source', 'done', 1, 3, 4],
    });
    await seedKbDb.execute({
        sql: `INSERT INTO kb_chunk
            (id, kb_id, document_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['chunk_seed', 'kb_seed', 'doc_seed', 0, 'source content', '[]', 5],
    });
    await seedKbDb.close?.();
    await fs.outputFile(path.join(seedRoot, 'KnowledgeBase', 'files', 'seed-source.png'), 'source bytes');
    await fs.outputJson(path.join(seedRoot, 'StudyLogs', agentId, topicId, 'entries.json'), [{
        id: 'study_log_seed',
        agentId,
        topicId,
        topicNameSnapshot: 'Seed Topic',
        dateKey: '2026-04-30',
        contentMarkdown: 'seed diary entry',
    }], { spaces: 2 });
    await fs.outputJson(path.join(seedRoot, 'StudyDiary', 'seed_notebook', '2026-04-30.json'), {
        id: 'study_diary_seed_notebook_2026-04-30',
        notebookId: 'seed_notebook',
        dateKey: '2026-04-30',
        contentMarkdown: 'seed diary',
    }, { spaces: 2 });

    const result = await seedDefaultDataRoot({ dataRoot, seedRoot });

    assert.equal(result.seedRootMissing, false);
    assert.equal(result.hydratedHistories, 1);
    assert.deepEqual(result.knowledgeBaseImports, { knowledgeBases: 1, documents: 1, chunks: 1 });
    assert.ok(await fs.pathExists(path.join(dataRoot, 'Agents', agentId, 'config.json')));
    assert.ok(await fs.pathExists(path.join(dataRoot, 'UserData', 'attachments', attachmentFileName)));
    assert.ok(await fs.pathExists(path.join(dataRoot, 'KnowledgeBase', 'files', 'seed-source.png')));
    assert.ok(await fs.pathExists(path.join(dataRoot, 'StudyLogs', agentId, topicId, 'entries.json')));
    assert.ok(await fs.pathExists(path.join(dataRoot, 'StudyDiary', 'seed_notebook', '2026-04-30.json')));

    const history = await fs.readJson(path.join(dataRoot, 'UserData', agentId, 'topics', topicId, 'history.json'));
    const expectedUrl = pathToFileURL(path.join(dataRoot, 'UserData', 'attachments', attachmentFileName)).href;
    assert.equal(history[0].attachments[0].internalPath, expectedUrl);
    assert.equal(history[0].attachments[0].src, expectedUrl);

    const targetKbDb = createClient({ url: `file:${path.join(dataRoot, 'KnowledgeBase', 'knowledge-base.db')}` });
    const docs = await targetKbDb.execute({
        sql: 'SELECT kb_id, stored_path FROM kb_document WHERE id = ?',
        args: ['doc_seed'],
    });
    assert.equal(docs.rows[0].kb_id, 'kb_seed');
    assert.equal(docs.rows[0].stored_path, path.join(dataRoot, 'KnowledgeBase', 'files', 'seed-source.png'));
    await targetKbDb.close?.();
});

test('default data seeder uses stat-based source checks for packaged asar paths', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-default-seed-asar-test-'));
    const dataRoot = path.join(tempRoot, 'data');
    const seedRoot = path.join(tempRoot, 'seed');
    const originalPathExists = fs.pathExists;

    t.after(async () => {
        fs.pathExists = originalPathExists;
        await fs.remove(tempRoot);
    });

    await fs.outputJson(path.join(seedRoot, 'Agents', 'seed_agent', 'config.json'), {
        name: 'Packaged Seed Agent',
        topics: [],
    }, { spaces: 2 });

    fs.pathExists = async (targetPath) => {
        if (path.resolve(String(targetPath)).startsWith(path.resolve(seedRoot))) {
            return false;
        }
        return originalPathExists(targetPath);
    };

    const result = await seedDefaultDataRoot({ dataRoot, seedRoot });

    assert.equal(result.seedRootMissing, false);
    assert.equal(result.copiedFiles, 1);
    assert.ok(await originalPathExists(path.join(dataRoot, 'Agents', 'seed_agent', 'config.json')));
});

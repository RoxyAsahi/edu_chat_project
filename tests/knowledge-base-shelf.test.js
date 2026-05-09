const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { initializeDatabase, closeDatabase } = require('../src/modules/main/knowledge-base/db');
const { createKnowledgeBaseRepository } = require('../src/modules/main/knowledge-base/repository');

test('knowledge base shelf kind, document clone, and document delete behavior', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-kb-shelf-'));
    t.after(async () => {
        await closeDatabase();
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                await fs.remove(tempRoot);
                return;
            } catch (error) {
                if (error?.code === 'EBUSY' && attempt === 7) {
                    return;
                }
                if (error?.code !== 'EBUSY') {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
    });

    await initializeDatabase(tempRoot);
    const repository = createKnowledgeBaseRepository();

    const source = await repository.createKnowledgeBase({ name: '话题 Source' });
    const shelf = await repository.createKnowledgeBase({ name: '教材资料', kind: 'shelf' });

    assert.equal(source.kind, 'source');
    assert.equal(shelf.kind, 'shelf');
    assert.deepEqual((await repository.listKnowledgeBases()).map((item) => item.id), [source.id]);
    assert.deepEqual((await repository.listKnowledgeBases({ kind: 'shelf' })).map((item) => item.id), [shelf.id]);

    const storedPath = path.join(tempRoot, 'KnowledgeBase', 'files', 'lesson.txt');
    await fs.ensureFile(storedPath);
    const document = await repository.createDocument({
        kbId: shelf.id,
        name: 'lesson.txt',
        storedPath,
        mimeType: 'text/plain',
        fileSize: 11,
        fileHash: 'hash-lesson',
    });
    await repository.updateDocumentState(document.id, {
        status: 'done',
        chunkCount: 1,
        processedAt: 101,
        completedAt: 101,
        contentType: 'plain',
    });
    await repository.updateDocumentDerivedContent(document.id, {
        extractedText: 'hello lesson',
        extractedContentType: 'plain',
    });
    await repository.updateDocumentGuideState(document.id, {
        guideStatus: 'done',
        guideMarkdown: '# guide',
        guideGeneratedAt: 202,
    });
    await repository.insertDocumentChunk({
        kbId: shelf.id,
        documentId: document.id,
        chunkIndex: 0,
        content: 'hello lesson chunk',
        embedding: [0.1, 0.2],
        createdAt: 303,
        contentType: 'plain',
        charLength: 18,
        sectionTitle: 'Intro',
        paragraphIndex: 1,
    });

    const copied = await repository.cloneDocumentToKnowledgeBase(document.id, source.id);
    assert.equal(copied.kbId, source.id);
    assert.equal(copied.status, 'done');
    assert.equal(copied.chunkCount, 1);
    assert.equal(copied.extractedText, 'hello lesson');
    assert.equal(copied.guideMarkdown, '# guide');

    const copiedChunks = await repository.listChunkRowsByKnowledgeBase(source.id);
    assert.equal(copiedChunks.length, 1);
    assert.equal(copiedChunks[0].document_id, copied.id);
    assert.equal(copiedChunks[0].content, 'hello lesson chunk');
    assert.equal(copiedChunks[0].document_name, 'lesson.txt');

    const copiedAgain = await repository.cloneDocumentToKnowledgeBase(document.id, source.id);
    assert.equal(copiedAgain.id, copied.id);

    const links = await repository.getShelfLinksForDocuments([copied.id]);
    assert.deepEqual(links, [{
        sourceDocumentId: copied.id,
        fileHash: 'hash-lesson',
        shelfDocumentId: document.id,
        shelfDocumentName: 'lesson.txt',
        shelfKbId: shelf.id,
        shelfKbName: '教材资料',
    }]);

    const targetShelf = await repository.createKnowledgeBase({ name: '未归类', kind: 'shelf' });
    const moved = await repository.moveDocumentToKnowledgeBase(document.id, targetShelf.id);
    assert.equal(moved.kbId, targetShelf.id);
    const movedChunks = await repository.listChunkRowsByKnowledgeBase(targetShelf.id);
    assert.equal(movedChunks.length, 1);
    assert.equal(movedChunks[0].document_id, document.id);
    assert.equal((await repository.listChunkRowsByKnowledgeBase(shelf.id)).length, 0);

    const pendingDocument = await repository.createDocument({
        kbId: shelf.id,
        name: 'pending.txt',
        storedPath: path.join(tempRoot, 'KnowledgeBase', 'files', 'pending.txt'),
        mimeType: 'text/plain',
        fileSize: 1,
        fileHash: 'hash-pending',
    });
    await assert.rejects(
        () => repository.cloneDocumentToKnowledgeBase(pendingDocument.id, source.id),
        /Only indexed documents/,
    );

    await repository.deleteKnowledgeBaseDocumentData(document.id);
    assert.equal(await repository.countDocumentsByStoredPath(storedPath), 1);
    await repository.deleteKnowledgeBaseDocumentData(copied.id);
    assert.equal(await repository.countDocumentsByStoredPath(storedPath), 0);
});

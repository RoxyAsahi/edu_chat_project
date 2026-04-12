const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');

let notesRootDir = null;
let agentConfigManager = null;
let handlersRegistered = false;

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTopicNotesFile(agentId, topicId) {
    return path.join(notesRootDir, agentId, topicId, 'notes.json');
}

function getLegacyNotesRoot(appDataRoot) {
    return path.join(appDataRoot, 'Notemodules');
}

function getNotesRoot(appDataRoot) {
    return path.join(appDataRoot, 'Notes');
}

function getNoteAttachmentTempRoot(appDataRoot) {
    return path.join(appDataRoot, '.tmp', 'note-attachments');
}

function sanitizeFileName(value, fallback = 'note') {
    const normalized = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || fallback;
}

function buildNoteAttachmentMarkdown(note = {}) {
    const title = String(note.title || '未命名笔记').trim() || '未命名笔记';
    const contentMarkdown = String(note.contentMarkdown || '').trim();
    return contentMarkdown
        ? `# ${title}\n\n${contentMarkdown}\n`
        : `# ${title}\n`;
}

function buildLegacySearchPathLabel(fullPath, rootDir) {
    const relative = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    return relative || path.basename(fullPath);
}

function buildTopicNotePathLabel(agentId, topicId) {
    return `${agentId}/${topicId}`;
}

function normalizeSourceDocumentRefs(refs, fallback = []) {
    return Array.isArray(refs)
        ? refs.filter(Boolean)
        : fallback;
}

function normalizeFlashcardDeck(deck, fallbackDocumentRefs = []) {
    if (!deck || typeof deck !== 'object') {
        return null;
    }

    const cards = Array.isArray(deck.cards)
        ? deck.cards
            .map((card, index) => {
                if (!card || typeof card !== 'object') {
                    return null;
                }

                const front = String(card.front || '').trim();
                const back = String(card.back || '').trim();
                if (!front || !back) {
                    return null;
                }

                return {
                    id: String(card.id || makeId(`flashcard_${index + 1}`)),
                    front,
                    back,
                    sourceDocumentRefs: normalizeSourceDocumentRefs(card.sourceDocumentRefs, fallbackDocumentRefs),
                };
            })
            .filter(Boolean)
        : [];

    if (cards.length === 0) {
        return null;
    }

    return {
        title: String(deck.title || '闪卡集合').trim() || '闪卡集合',
        cards,
    };
}

function normalizeFlashcardProgress(progress, deck) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return null;
    }

    const cardIds = new Set(deck.cards.map((card) => card.id));
    const rawStates = Array.isArray(progress?.cardStates) ? progress.cardStates : [];
    const cardStates = deck.cards.map((card) => {
        const existing = rawStates.find((item) => item && String(item.cardId || '') === card.id);
        const result = existing?.result === 'known' || existing?.result === 'unknown'
            ? existing.result
            : null;

        return {
            cardId: card.id,
            result,
            updatedAt: Number(existing?.updatedAt || 0),
        };
    }).filter((item) => cardIds.has(item.cardId));

    const knownCount = cardStates.filter((item) => item.result === 'known').length;
    const unknownCount = cardStates.filter((item) => item.result === 'unknown').length;

    return {
        currentIndex: Math.max(0, Math.min(Number(progress?.currentIndex || 0), deck.cards.length - 1)),
        flipped: progress?.flipped === true,
        knownCount,
        unknownCount,
        cardStates,
    };
}

async function readTopicNotes(agentId, topicId) {
    if (!agentId || !topicId) {
        return [];
    }

    const notesFile = getTopicNotesFile(agentId, topicId);
    if (!await fs.pathExists(notesFile)) {
        return [];
    }

    try {
        const data = await fs.readJson(notesFile);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`[UniStudyNotes] Failed to read notes for ${agentId}/${topicId}:`, error);
        return [];
    }
}

async function writeTopicNotes(agentId, topicId, notes) {
    const notesFile = getTopicNotesFile(agentId, topicId);
    await fs.ensureDir(path.dirname(notesFile));
    await fs.writeJson(notesFile, notes, { spaces: 2 });
}

async function searchLegacyNotes(appDataRoot, queryText) {
    const lowerCaseQuery = String(queryText || '').trim().toLowerCase();
    if (!lowerCaseQuery) {
        return [];
    }

    const rootDir = getLegacyNotesRoot(appDataRoot);
    const results = [];

    async function searchInDirectory(directory) {
        let entries = [];
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.error(`[UniStudyNotes] Failed to read notes directory ${directory}:`, error);
            }
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await searchInDirectory(fullPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const lowerName = entry.name.toLowerCase();
            if (!lowerName.endsWith('.md') && !lowerName.endsWith('.txt')) {
                continue;
            }

            if (!lowerName.includes(lowerCaseQuery)) {
                continue;
            }

            results.push({
                name: entry.name,
                path: fullPath,
                pathLabel: buildLegacySearchPathLabel(fullPath, rootDir),
                sourceType: 'legacy-note-file',
            });
        }
    }

    await searchInDirectory(rootDir);
    return results;
}

async function searchStructuredNotes(appDataRoot, queryText) {
    const lowerCaseQuery = String(queryText || '').trim().toLowerCase();
    if (!lowerCaseQuery) {
        return [];
    }

    const rootDir = getNotesRoot(appDataRoot);
    let agentEntries = [];
    try {
        agentEntries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.error(`[UniStudyNotes] Failed to list notes root ${rootDir}:`, error);
        }
        return [];
    }

    const results = [];
    for (const agentEntry of agentEntries) {
        if (!agentEntry.isDirectory()) {
            continue;
        }

        const agentId = agentEntry.name;
        const agentRoot = path.join(rootDir, agentId);
        let topicEntries = [];
        try {
            topicEntries = await fs.readdir(agentRoot, { withFileTypes: true });
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.error(`[UniStudyNotes] Failed to list notes for agent ${agentId}:`, error);
            }
            continue;
        }

        for (const topicEntry of topicEntries) {
            if (!topicEntry.isDirectory()) {
                continue;
            }

            const topicId = topicEntry.name;
            const notesFile = path.join(agentRoot, topicId, 'notes.json');
            if (!await fs.pathExists(notesFile)) {
                continue;
            }

            let notes = [];
            try {
                const data = await fs.readJson(notesFile);
                notes = Array.isArray(data) ? data : [];
            } catch (error) {
                console.error(`[UniStudyNotes] Failed to read structured notes ${notesFile}:`, error);
                continue;
            }

            for (const note of notes) {
                const title = String(note?.title || '').trim();
                const contentMarkdown = String(note?.contentMarkdown || '').trim();
                const haystack = `${title}\n${contentMarkdown}`.toLowerCase();
                if (!haystack.includes(lowerCaseQuery)) {
                    continue;
                }

                results.push({
                    name: title || '未命名笔记',
                    path: '',
                    pathLabel: buildTopicNotePathLabel(agentId, topicId),
                    sourceType: 'topic-note',
                    noteId: String(note?.id || ''),
                    agentId,
                    topicId,
                    updatedAt: Number(note?.updatedAt || note?.createdAt || 0),
                });
            }
        }
    }

    return results.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

async function searchNotesIndex(appDataRoot, queryText) {
    const [structuredNotes, legacyNotes] = await Promise.all([
        searchStructuredNotes(appDataRoot, queryText),
        searchLegacyNotes(appDataRoot, queryText),
    ]);
    return [...structuredNotes, ...legacyNotes].slice(0, 30);
}

async function exportNoteToTempAttachment(appDataRoot, payload = {}) {
    const agentId = String(payload.agentId || '').trim();
    const topicId = String(payload.topicId || '').trim();
    const noteId = String(payload.noteId || '').trim();
    if (!agentId || !topicId || !noteId) {
        throw new Error('agentId, topicId, and noteId are required.');
    }

    const notesFile = path.join(getNotesRoot(appDataRoot), agentId, topicId, 'notes.json');
    if (!await fs.pathExists(notesFile)) {
        throw new Error('Note file not found.');
    }

    const data = await fs.readJson(notesFile);
    const notes = Array.isArray(data) ? data : [];
    const note = notes.find((item) => String(item?.id || '') === noteId);
    if (!note) {
        throw new Error('Note not found.');
    }

    const tempRoot = getNoteAttachmentTempRoot(appDataRoot);
    await fs.ensureDir(tempRoot);

    const baseName = sanitizeFileName(note.title || noteId, 'note').slice(0, 80);
    const fileName = `${baseName}-${Date.now()}.md`;
    const filePath = path.join(tempRoot, fileName);
    await fs.writeFile(filePath, buildNoteAttachmentMarkdown(note), 'utf8');

    return {
        success: true,
        path: filePath,
        name: fileName,
        sourceType: 'topic-note',
        noteId,
        agentId,
        topicId,
    };
}

function normalizeNote(agentId, topicId, payload = {}, existing = null) {
    const now = Date.now();
    const sourceDocumentRefs = normalizeSourceDocumentRefs(
        payload.sourceDocumentRefs,
        existing?.sourceDocumentRefs || []
    );
    const flashcardDeck = normalizeFlashcardDeck(
        payload.flashcardDeck ?? existing?.flashcardDeck ?? null,
        sourceDocumentRefs
    );

    return {
        id: String(payload.id || existing?.id || makeId('note')),
        agentId,
        topicId,
        title: String(payload.title || existing?.title || '未命名笔记').trim() || '未命名笔记',
        contentMarkdown: String(payload.contentMarkdown || existing?.contentMarkdown || '').trim(),
        sourceMessageIds: Array.isArray(payload.sourceMessageIds)
            ? payload.sourceMessageIds.filter(Boolean)
            : (existing?.sourceMessageIds || []),
        sourceDocumentRefs,
        kind: String(payload.kind || existing?.kind || 'note'),
        flashcardDeck,
        flashcardProgress: normalizeFlashcardProgress(
            payload.flashcardProgress ?? existing?.flashcardProgress ?? null,
            flashcardDeck
        ),
        createdAt: Number(existing?.createdAt || payload.createdAt || now),
        updatedAt: now,
    };
}

async function listAgentNotes(agentId) {
    if (!agentId || !notesRootDir) {
        return [];
    }

    let validTopicIds = null;
    if (agentConfigManager) {
        try {
            const config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
            validTopicIds = new Set(
                Array.isArray(config?.topics)
                    ? config.topics.map((topic) => String(topic?.id || '')).filter(Boolean)
                    : []
            );
        } catch (error) {
            console.error(`[UniStudyNotes] Failed to read topic config for ${agentId}:`, error);
            return [];
        }
    }

    const agentRoot = path.join(notesRootDir, agentId);
    let topicEntries = [];
    try {
        topicEntries = await fs.readdir(agentRoot, { withFileTypes: true });
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.error(`[UniStudyNotes] Failed to list agent notes for ${agentId}:`, error);
        }
        return [];
    }

    const allNotes = [];
    for (const entry of topicEntries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const topicId = entry.name;
        if (validTopicIds && !validTopicIds.has(topicId)) {
            continue;
        }
        const topicNotes = await readTopicNotes(agentId, topicId);
        allNotes.push(...topicNotes);
    }

    return allNotes.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function initialize(context = {}) {
    if (handlersRegistered) {
        return;
    }

    const { DATA_ROOT, agentConfigManager: nextAgentConfigManager } = context;
    notesRootDir = path.join(DATA_ROOT, 'Notes');
    agentConfigManager = nextAgentConfigManager || null;

    ipcMain.handle('list-topic-notes', async (_event, agentId, topicId) => {
        try {
            const notes = await readTopicNotes(agentId, topicId);
            return {
                success: true,
                items: notes.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
            };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.handle('list-agent-notes', async (_event, agentId) => {
        try {
            return { success: true, items: await listAgentNotes(agentId) };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.handle('save-topic-note', async (_event, agentId, topicId, payload) => {
        try {
            const notes = await readTopicNotes(agentId, topicId);
            const currentIndex = notes.findIndex((note) => note.id === payload?.id);
            const existing = currentIndex > -1 ? notes[currentIndex] : null;
            const nextNote = normalizeNote(agentId, topicId, payload, existing);

            if (currentIndex > -1) {
                notes[currentIndex] = nextNote;
            } else {
                notes.unshift(nextNote);
            }

            await writeTopicNotes(agentId, topicId, notes);
            return { success: true, item: nextNote };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-topic-note', async (_event, agentId, topicId, noteId) => {
        try {
            const notes = await readTopicNotes(agentId, topicId);
            const nextNotes = notes.filter((note) => note.id !== noteId);
            await writeTopicNotes(agentId, topicId, nextNotes);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('create-note-from-message', async (_event, payload = {}) => {
        try {
            const {
                agentId,
                topicId,
                title,
                contentMarkdown,
                sourceMessageIds,
                sourceDocumentRefs,
                kind,
            } = payload;

            const notePayload = {
                title,
                contentMarkdown,
                sourceMessageIds,
                sourceDocumentRefs,
                kind: kind || 'message-note',
            };

            const notes = await readTopicNotes(agentId, topicId);
            const nextNote = normalizeNote(agentId, topicId, notePayload);
            notes.unshift(nextNote);
            await writeTopicNotes(agentId, topicId, notes);
            return { success: true, item: nextNote };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('create-note-from-selection', async (_event, payload = {}) => {
        try {
            const {
                agentId,
                topicId,
                title,
                items,
                sourceMessageIds,
                sourceDocumentRefs,
                kind,
            } = payload;

            const itemBlocks = Array.isArray(items)
                ? items
                    .map((item) => {
                        const blockTitle = String(item?.title || '片段').trim();
                        const blockContent = String(item?.content || '').trim();
                        return blockContent ? `## ${blockTitle}\n\n${blockContent}` : '';
                    })
                    .filter(Boolean)
                : [];

            const notes = await readTopicNotes(agentId, topicId);
            const nextNote = normalizeNote(agentId, topicId, {
                title: title || '整理笔记',
                contentMarkdown: itemBlocks.join('\n\n---\n\n'),
                sourceMessageIds,
                sourceDocumentRefs,
                kind: kind || 'selection-note',
            });
            notes.unshift(nextNote);
            await writeTopicNotes(agentId, topicId, notes);
            return { success: true, item: nextNote };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('search-notes', async (_event, query) => {
        try {
            return await searchNotesIndex(DATA_ROOT, query);
        } catch (error) {
            console.error('[UniStudyNotes] Failed to search notes:', error);
            return [];
        }
    });

    ipcMain.handle('export-note-as-attachment', async (_event, payload = {}) => {
        try {
            return await exportNoteToTempAttachment(DATA_ROOT, payload);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    handlersRegistered = true;
}

module.exports = {
    initialize,
    searchNotesIndex,
    exportNoteToTempAttachment,
};

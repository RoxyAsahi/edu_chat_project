import {
    normalizeFlashcardDeck,
    normalizeFlashcardProgress,
} from '../flashcards/flashcardUtils.js';
import {
    parseQuizSetFromMarkdown,
} from '../quiz/quizUtils.js';

function normalizeHistory(history) {
    return Array.isArray(history)
        ? history.map((message) => ({
            ...message,
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
            favorited: message.favorited === true,
            favoriteAt: message.favoriteAt || null,
            noteRefs: Array.isArray(message.noteRefs) ? message.noteRefs : [],
            selectionContextRefs: Array.isArray(message.selectionContextRefs) ? message.selectionContextRefs : [],
        }))
        : [];
}

function removeDeletedNoteReferencesFromHistory(history, noteId) {
    let changed = false;
    const nextHistory = normalizeHistory(history).map((message) => {
        const existingNoteRefs = Array.isArray(message.noteRefs) ? message.noteRefs : [];
        if (!existingNoteRefs.includes(noteId)) {
            return message;
        }

        changed = true;
        const nextNoteRefs = existingNoteRefs.filter((id) => id !== noteId);
        return {
            ...message,
            noteRefs: nextNoteRefs,
            favorited: nextNoteRefs.length > 0 ? message.favorited === true : false,
            favoriteAt: nextNoteRefs.length > 0 ? (message.favoriteAt || null) : null,
        };
    });

    return {
        changed,
        nextHistory,
    };
}

function normalizeNote(note = {}, options = {}) {
    const sourceDocumentRefs = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs : [];
    const flashcardDeck = normalizeFlashcardDeck(note.flashcardDeck, sourceDocumentRefs);
    const kind = String(note.kind || 'note');
    const quizSet = kind === 'quiz'
        ? (note.quizSet || parseQuizSetFromMarkdown(note.contentMarkdown, note.title || '选择题练习'))
        : null;

    return {
        ...note,
        id: String(note.id || ''),
        agentId: String(note.agentId || options.defaultAgentId || ''),
        topicId: String(note.topicId || options.defaultTopicId || ''),
        title: String(note.title || '未命名笔记').trim() || '未命名笔记',
        contentMarkdown: String(note.contentMarkdown || ''),
        sourceMessageIds: Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds : [],
        sourceDocumentRefs,
        kind,
        quizSet,
        flashcardDeck,
        flashcardProgress: normalizeFlashcardProgress(note.flashcardProgress, flashcardDeck),
        createdAt: Number(note.createdAt || Date.now()),
        updatedAt: Number(note.updatedAt || note.createdAt || Date.now()),
    };
}

function getNormalizedNoteKind(note) {
    if (note?.kind === 'flashcards' && note?.flashcardDeck && Array.isArray(note.flashcardDeck.cards) && note.flashcardDeck.cards.length > 0) {
        return 'flashcards';
    }

    const kind = String(note?.kind || 'note');
    if (kind === 'analysis' || kind === 'quiz' || kind === 'flashcards') {
        return kind;
    }

    return 'note';
}

function isManualNote(note) {
    return getNormalizedNoteKind(note) === 'note';
}

function isGeneratedNote(note) {
    const kind = getNormalizedNoteKind(note);
    return kind === 'analysis' || kind === 'quiz' || kind === 'flashcards';
}

function filterManualNotes(notes = []) {
    return Array.isArray(notes) ? notes.filter((note) => isManualNote(note)) : [];
}

function filterGeneratedNotes(notes = []) {
    return Array.isArray(notes) ? notes.filter((note) => isGeneratedNote(note)) : [];
}

function buildNotesSelectionSummary({
    notesScope = 'topic',
    selectedCount = 0,
    visibleCount = 0,
} = {}) {
    if (selectedCount > 0) {
        return `已选 ${selectedCount} 条笔记 · 生成时优先使用这些内容`;
    }

    const scopeLabel = notesScope === 'agent' ? '学科汇总' : '当前话题';

    if (visibleCount > 0) {
        return `${scopeLabel} · ${visibleCount} 条笔记，未选择时回退到当前 Source`;
    }

    return `${scopeLabel} · 暂无笔记，可直接从当前来源开始生成`;
}

function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return '';
    }

    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return '';
    }
}

function buildBlankNoteTitle({ currentTopicName = '', hasCurrentTopic = false } = {}) {
    return hasCurrentTopic
        ? `${String(currentTopicName || '').trim()} 学习笔记`.trim()
        : '';
}

function buildNoteSaveRequest({
    currentNote = null,
    currentTopicId = '',
    title = '',
    contentMarkdown = '',
} = {}) {
    const resolvedTitle = String(title || '').trim();
    const resolvedContent = String(contentMarkdown || '');
    if (!resolvedTitle && !resolvedContent.trim()) {
        return null;
    }

    const kind = currentNote?.kind || 'note';
    const quizSet = kind === 'quiz'
        ? parseQuizSetFromMarkdown(
            resolvedContent,
            resolvedTitle || currentNote?.title || '选择题练习',
        )
        : null;

    return {
        targetTopicId: currentNote?.topicId || currentTopicId || '',
        payload: {
            id: currentNote?.id,
            title: resolvedTitle || currentNote?.title || '未命名笔记',
            contentMarkdown: resolvedContent,
            sourceMessageIds: Array.isArray(currentNote?.sourceMessageIds) ? currentNote.sourceMessageIds : [],
            sourceDocumentRefs: Array.isArray(currentNote?.sourceDocumentRefs) ? currentNote.sourceDocumentRefs : [],
            kind,
            quizSet,
            createdAt: currentNote?.createdAt,
        },
    };
}

function deriveDeletedNoteState({
    selectedNoteIds = [],
    activeNoteId = null,
    activeFlashcardNoteId = null,
} = {}, noteId) {
    return {
        selectedNoteIds: Array.isArray(selectedNoteIds)
            ? selectedNoteIds.filter((id) => id !== noteId)
            : [],
        activeNoteId: activeNoteId === noteId ? null : activeNoteId,
        activeFlashcardNoteId: activeFlashcardNoteId === noteId ? null : activeFlashcardNoteId,
    };
}

function buildMessageNoteContent(message = {}) {
    const titleMap = {
        user: '我的提问摘录',
        assistant: 'AI 回答摘录',
    };
    const textContent = typeof message.content === 'string'
        ? message.content
        : (message.content?.text || JSON.stringify(message.content || '', null, 2));
    const attachmentSection = Array.isArray(message.attachments) && message.attachments.length > 0
        ? `\n\n## 附件\n\n${message.attachments.map((item) => `- ${item.name}`).join('\n')}`
        : '';

    return {
        title: titleMap[message.role] || '聊天摘录',
        contentMarkdown: `${textContent}${attachmentSection}`.trim(),
    };
}

export {
    buildBlankNoteTitle,
    buildMessageNoteContent,
    buildNotesSelectionSummary,
    buildNoteSaveRequest,
    deriveDeletedNoteState,
    filterGeneratedNotes,
    filterManualNotes,
    formatRelativeTime,
    getNormalizedNoteKind,
    isGeneratedNote,
    isManualNote,
    normalizeNote,
    removeDeletedNoteReferencesFromHistory,
};

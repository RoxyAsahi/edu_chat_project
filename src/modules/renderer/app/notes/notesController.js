import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import {
    buildBlankNoteTitle,
    buildMessageNoteContent,
    buildNotesSelectionSummary,
    buildNoteSaveRequest,
    deriveDeletedNoteState,
    formatRelativeTime,
    getNormalizedNoteKind,
    normalizeNote as normalizeStoredNote,
    removeDeletedNoteReferencesFromHistory,
} from './notesUtils.js';

const NOTE_DETAIL_META = Object.freeze({
    note: {
        eyebrow: '手动笔记',
        subtitle: '查看、编辑并继续沉淀当前话题的学习记录。',
    },
    analysis: {
        eyebrow: '深度分析',
        subtitle: '结构化整理关键结论、关系图景与后续学习建议。',
    },
    quiz: {
        eyebrow: '选择题练习',
        subtitle: '围绕当前学习材料生成题目、答案与解析。',
    },
    flashcards: {
        eyebrow: '闪卡练习',
        subtitle: '进入抽认卡模式，持续复习与标记掌握进度。',
    },
});

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripMarkdown(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function createNotesController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const setSidePanelTab = deps.setSidePanelTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const getCurrentTopicDisplayName = deps.getCurrentTopicDisplayName || (() => '请选择一个话题');
    const persistHistory = deps.persistHistory || (async () => {});
    const buildTopicContext = deps.buildTopicContext || (() => ({}));
    const createId = deps.createId || ((prefix) => `${prefix}_${Date.now()}`);
    const flashcardsApi = deps.flashcardsApi || {
        activateNote: () => null,
        beginPendingGeneration: () => {},
        buildGeneratedFlashcardContent: () => null,
        clearPendingGeneration: () => {},
        getFlashcardSourceCount: () => 0,
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
        resetState: () => {},
    };
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);

    const HTMLElementCtor = windowObj.HTMLElement || globalThis.HTMLElement;
    const ElementCtor = windowObj.Element || globalThis.Element;
    let noteDetailTrigger = null;

    function getNotesSlice() {
        return store.getState().notes;
    }

    function patchNotes(patch) {
        return store.patchState('notes', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        topicNotes: {
            get: () => getNotesSlice().topicNotes,
            set: (value) => patchNotes({ topicNotes: value }),
        },
        agentNotes: {
            get: () => getNotesSlice().agentNotes,
            set: (value) => patchNotes({ agentNotes: value }),
        },
        notesScope: {
            get: () => getNotesSlice().notesScope,
            set: (value) => patchNotes({ notesScope: value }),
        },
        activeNoteId: {
            get: () => getNotesSlice().activeNoteId,
            set: (value) => patchNotes({ activeNoteId: value }),
        },
        selectedNoteIds: {
            get: () => getNotesSlice().selectedNoteIds,
            set: (value) => patchNotes({ selectedNoteIds: value }),
        },
        notesStudioView: {
            get: () => getNotesSlice().notesStudioView,
            set: (value) => patchNotes({ notesStudioView: value }),
        },
        noteDetailKind: {
            get: () => getNotesSlice().noteDetailKind,
            set: (value) => patchNotes({ noteDetailKind: value }),
        },
        activeNoteMenu: {
            get: () => getNotesSlice().activeNoteMenu,
            set: (value) => patchNotes({ activeNoteMenu: value }),
        },
        activeFlashcardNoteId: {
            get: () => getNotesSlice().activeFlashcardNoteId,
            set: (value) => patchNotes({ activeFlashcardNoteId: value }),
        },
        pendingFlashcardGeneration: {
            get: () => getNotesSlice().pendingFlashcardGeneration,
            set: (value) => patchNotes({ pendingFlashcardGeneration: value }),
        },
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: null, config: null },
        },
        currentTopicId: {
            get: () => getCurrentTopicId(),
        },
        currentChatHistory: {
            get: () => {
                const history = getCurrentChatHistory();
                return Array.isArray(history) ? history : [];
            },
        },
    });

    function normalizeNote(note = {}) {
        return normalizeStoredNote(note, {
            defaultAgentId: state.currentSelectedItem.id,
            defaultTopicId: state.currentTopicId,
        });
    }

    function getVisibleNotes() {
        return state.notesScope === 'agent' ? state.agentNotes : state.topicNotes;
    }

    function getActiveNote() {
        return getVisibleNotes().find((note) => note.id === state.activeNoteId)
            || state.topicNotes.find((note) => note.id === state.activeNoteId)
            || state.agentNotes.find((note) => note.id === state.activeNoteId)
            || null;
    }

    function findNoteById(noteId) {
        if (!noteId) {
            return null;
        }

        return state.topicNotes.find((note) => note.id === noteId)
            || state.agentNotes.find((note) => note.id === noteId)
            || null;
    }

    function getCurrentDetailNote() {
        return state.activeFlashcardNoteId
            ? normalizeNote(findNoteById(state.activeFlashcardNoteId) || {})
            : (getActiveNote() ? normalizeNote(getActiveNote()) : null);
    }

    function patchCurrentHistoryMessage(messageId, updater) {
        let nextMessage = null;
        updateCurrentChatHistory((history = []) => history.map((item) => {
            if (item?.id !== messageId) {
                return item;
            }

            nextMessage = updater({ ...item });
            return nextMessage;
        }));
        return nextMessage;
    }

    function clearNoteEditor() {
        state.activeNoteId = null;
        if (el.noteTitleInput) {
            el.noteTitleInput.value = '';
        }
        if (el.noteContentInput) {
            el.noteContentInput.value = '';
        }
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = '当前没有打开的笔记。';
        }
    }

    function fillNoteEditor(note) {
        if (!note) {
            clearNoteEditor();
            return;
        }

        state.activeFlashcardNoteId = null;
        state.activeNoteId = note.id;
        if (el.noteTitleInput) {
            el.noteTitleInput.value = note.title || '';
        }
        if (el.noteContentInput) {
            el.noteContentInput.value = note.contentMarkdown || '';
        }

        const sourceCount = Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
        const refCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
        const topicLabel = note.topicId ? ` · 话题 ${note.topicId}` : '';
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = `更新时间：${formatRelativeTime(note.updatedAt)}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
        }
        if (!state.noteDetailKind || state.noteDetailKind === 'note') {
            state.noteDetailKind = getNormalizedNoteKind(note);
        }
        syncNoteDetailChrome(note);
    }

    function getNoteHighlightId() {
        return state.activeFlashcardNoteId || state.activeNoteId;
    }

    function replaceNoteInCollections(note) {
        if (!note) {
            return null;
        }

        const normalized = normalizeNote(note);
        const replaceInList = (list) => {
            const nextList = list.map((item) => (item.id === normalized.id ? normalized : item));
            if (!nextList.some((item) => item.id === normalized.id)) {
                nextList.unshift(normalized);
            }
            return nextList;
        };

        state.topicNotes = replaceInList(state.topicNotes);
        state.agentNotes = replaceInList(state.agentNotes);
        return normalized;
    }

    function buildNoteDetailSubtitle(note, fallback = '') {
        if (!note) {
            return fallback;
        }

        const sourceCount = flashcardsApi.getFlashcardSourceCount(note);
        const updatedLabel = formatRelativeTime(note.updatedAt) || '刚刚';
        const kind = getNormalizedNoteKind(note);
        const kindLabel = kind === 'analysis'
            ? '分析报告'
            : kind === 'quiz'
                ? '选择题'
                : kind === 'flashcards'
                    ? '闪卡'
                    : '笔记';
        return `${kindLabel} · ${sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题'} · ${updatedLabel}`;
    }

    function syncNoteDetailChrome(note = null) {
        const kind = state.noteDetailKind || 'note';
        const meta = NOTE_DETAIL_META[kind] || NOTE_DETAIL_META.note;
        const flashcards = kind === 'flashcards';
        const editable = !flashcards;
        const noteTitle = flashcards
            ? (note?.flashcardDeck?.title || note?.title || '闪卡练习')
            : (note?.title || '新建笔记');
        const subtitle = note
            ? buildNoteDetailSubtitle(note, meta.subtitle)
            : (state.currentTopicId
                ? `当前话题：${getCurrentTopicDisplayName()} · 新建内容会保存到当前话题并自动归档到学科汇总。`
                : meta.subtitle);

        if (el.noteDetailEyebrow) {
            el.noteDetailEyebrow.textContent = meta.eyebrow;
        }
        if (el.noteDetailTitle) {
            el.noteDetailTitle.textContent = noteTitle;
        }
        if (el.noteDetailSubtitle) {
            el.noteDetailSubtitle.textContent = subtitle;
        }
        el.saveNoteBtn?.classList.toggle('hidden', !editable);
        el.deleteNoteBtn?.classList.toggle('hidden', !note?.id);
        el.noteEditorCard?.classList.toggle('hidden', !editable);
        el.flashcardsPracticeCard?.classList.toggle('hidden', !flashcards);
    }

    function openNoteDetail(note = null, options = {}) {
        const normalized = note ? normalizeNote(note) : null;
        const requestedKind = options.kind || getNormalizedNoteKind(normalized);
        if (options.trigger instanceof HTMLElementCtor) {
            noteDetailTrigger = options.trigger;
        }

        state.notesStudioView = 'detail';
        state.noteDetailKind = requestedKind;
        el.noteDetailModal?.classList.remove('hidden');
        el.noteDetailModal?.classList.add('note-detail-modal--open');
        el.noteDetailModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('note-detail-open');

        if (requestedKind === 'flashcards') {
            if (normalized?.id) {
                replaceNoteInCollections(normalized);
                flashcardsApi.activateNote(normalized);
            } else {
                flashcardsApi.resetState({ clearPending: false });
            }
            syncNoteDetailChrome(normalized);
            flashcardsApi.renderPractice();
        } else {
            flashcardsApi.resetState({ clearPending: false });
            setRightPanelMode('notes');
            if (normalized) {
                fillNoteEditor(normalized);
            } else {
                clearNoteEditor();
                if (el.noteTitleInput) {
                    el.noteTitleInput.value = buildBlankNoteTitle({
                        currentTopicName: getCurrentTopicDisplayName(),
                        hasCurrentTopic: Boolean(state.currentTopicId),
                    });
                }
                if (el.noteMetaSummary) {
                    el.noteMetaSummary.textContent = '新建笔记将保存到当前话题，并自动归档到当前学科汇总。';
                }
            }
            syncNoteDetailChrome(normalized);
        }

        el.noteDetailCloseBtn?.focus();
        renderNotesPanel();
    }

    function closeNoteDetail(options = {}) {
        state.notesStudioView = 'overview';
        state.noteDetailKind = null;
        setRightPanelMode('notes');
        el.noteDetailModal?.classList.add('hidden');
        el.noteDetailModal?.classList.remove('note-detail-modal--open');
        el.noteDetailModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('note-detail-open');
        if (
            options.restoreFocus !== false
            && noteDetailTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(noteDetailTrigger)
        ) {
            noteDetailTrigger.focus();
        }
        noteDetailTrigger = null;
        closeNoteActionMenu();
    }

    function closeNoteActionMenu() {
        state.activeNoteMenu = null;
        if (!el.noteActionMenu) {
            return;
        }

        el.noteActionMenu.classList.add('hidden');
        el.noteActionMenu.innerHTML = '';
        el.noteActionMenu.style.left = '0px';
        el.noteActionMenu.style.top = '0px';
        el.noteActionMenu.style.visibility = '';
    }

    function renderNoteActionMenu() {
        if (!el.noteActionMenu || !state.activeNoteMenu?.note || !state.activeNoteMenu?.anchorRect) {
            closeNoteActionMenu();
            return;
        }

        const note = normalizeNote(state.activeNoteMenu.note);
        const selected = state.selectedNoteIds.includes(note.id);
        const actions = [
            { key: 'open', label: '打开详情', icon: 'open_in_new' },
            { key: 'toggle-select', label: selected ? '取消选择' : '选择用于生成', icon: selected ? 'check_circle' : 'radio_button_unchecked' },
            { key: 'delete', label: '删除', icon: 'delete', danger: true },
        ];

        el.noteActionMenu.innerHTML = actions.map((action) => `
            <button
                type="button"
                class="topic-action-menu__item ${action.danger ? 'topic-action-menu__item--danger' : ''}"
                data-note-action="${escapeHtml(action.key)}"
            >
                <span class="material-symbols-outlined">${escapeHtml(action.icon)}</span>
                <span>${escapeHtml(action.label)}</span>
            </button>
        `).join('');

        el.noteActionMenu.classList.remove('hidden');
        el.noteActionMenu.style.visibility = 'hidden';
        positionFloatingElement(el.noteActionMenu, state.activeNoteMenu.anchorRect, 'left', windowObj);
        el.noteActionMenu.style.visibility = 'visible';

        el.noteActionMenu.querySelectorAll('[data-note-action]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const action = button.dataset.noteAction;
                if (action === 'open') {
                    openNoteDetail(note, { trigger: state.activeNoteMenu?.anchorElement || null });
                } else if (action === 'toggle-select') {
                    toggleNoteSelection(note.id);
                } else if (action === 'delete') {
                    await deleteNoteRecord(note);
                }
                closeNoteActionMenu();
            });
        });
    }

    function openNoteItemMenu(note, anchorElement) {
        if (!note || !anchorElement) {
            return;
        }

        if (state.activeNoteMenu?.noteId === note.id) {
            closeNoteActionMenu();
            return;
        }

        closeTopicActionMenu();
        closeSourceFileActionMenu();
        state.activeNoteMenu = {
            noteId: note.id,
            note,
            anchorElement,
            anchorRect: anchorElement.getBoundingClientRect(),
        };
        renderNoteActionMenu();
    }

    function revealNote(note) {
        if (!note) {
            return;
        }

        openNoteDetail(note);
        renderNotesPanel();
    }

    function updateNotesSelectionSummary() {
        if (!el.notesSelectionSummary) {
            return;
        }

        el.notesSelectionSummary.textContent = buildNotesSelectionSummary({
            notesScope: state.notesScope,
            selectedCount: state.selectedNoteIds.length,
            visibleCount: getVisibleNotes().length,
        });
    }

    function renderNotesPanel() {
        const notes = getVisibleNotes();
        closeNoteActionMenu();

        el.topicNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'topic');
        el.agentNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'agent');
        updateNotesSelectionSummary();

        if (!el.notesList) {
            return;
        }

        el.notesList.innerHTML = '';
        const pendingFlashcards = flashcardsApi.getPendingGeneration();

        if (pendingFlashcards) {
            const pendingCard = documentObj.createElement('div');
            pendingCard.className = 'note-card note-card--studio note-card--flashcard-entry note-card--pending note-card--active';
            pendingCard.innerHTML = `
                <div class="note-card__studio-main">
                    <div class="note-card__studio-icon note-card__flashcard-icon note-card__flashcard-icon--pending">
                        <span class="material-symbols-outlined">autorenew</span>
                    </div>
                    <div class="note-card__studio-body">
                        <div class="note-card__studio-heading">
                            <strong class="note-card__flashcard-title">正在生成闪卡...</strong>
                        </div>
                        <div class="note-card__flashcard-meta">${pendingFlashcards.sourceCount > 0 ? `基于 ${pendingFlashcards.sourceCount} 个来源` : '基于当前学习材料'}</div>
                    </div>
                </div>
            `;
            el.notesList.appendChild(pendingCard);
        }

        if (notes.length === 0 && !pendingFlashcards) {
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state';
            empty.innerHTML = `
                <strong>还没有笔记</strong>
                <span>收藏聊天气泡、手动新建笔记，或在这里沉淀当前话题的学习成果。</span>
            `;
            el.notesList.appendChild(empty);
            if (!getActiveNote() && state.notesStudioView !== 'detail') {
                clearNoteEditor();
            }
            return;
        }

        notes.forEach((note) => {
            const normalized = normalizeNote(note);
            const card = documentObj.createElement('div');
            card.className = 'note-card note-card--studio';
            const isInteractiveFlashcard = flashcardsApi.hasStructuredFlashcards(normalized);
            const isSelected = state.selectedNoteIds.includes(normalized.id);
            card.classList.toggle('note-card--flashcard-entry', isInteractiveFlashcard);
            card.classList.toggle('note-card--active', normalized.id === getNoteHighlightId());
            card.classList.toggle('note-card--selected', isSelected);

            const preview = escapeHtml(stripMarkdown(normalized.contentMarkdown || '').trim());
            const sourceCount = flashcardsApi.getFlashcardSourceCount(normalized);
            const typeKind = getNormalizedNoteKind(normalized);
            const typeConfig = {
                note: { icon: 'edit_note', label: '笔记', accent: 'note' },
                analysis: { icon: 'analytics', label: '分析', accent: 'analysis' },
                quiz: { icon: 'quiz', label: '测验', accent: 'quiz' },
                flashcards: { icon: 'style', label: '闪卡', accent: 'flashcards' },
            }[typeKind] || { icon: 'description', label: '笔记', accent: 'note' };
            const metaParts = [
                sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题',
                formatRelativeTime(normalized.updatedAt),
            ];
            if (state.notesScope === 'agent' && normalized.topicId) {
                metaParts.push(`话题 ${escapeHtml(normalized.topicId)}`);
            }
            const selectedBadge = isSelected
                ? '<span class="note-card__selection-pill"><span class="material-symbols-outlined">check</span><span>已选</span></span>'
                : '';

            if (isInteractiveFlashcard) {
                const cardCount = Array.isArray(normalized.flashcardDeck?.cards) ? normalized.flashcardDeck.cards.length : 0;
                const flashcardMeta = `${sourceCount > 0 ? `${sourceCount} 个来源` : `${cardCount} 张卡`} · ${formatRelativeTime(normalized.updatedAt)}`;
                card.innerHTML = `
                    <div class="note-card__studio-main">
                        <div class="note-card__studio-icon note-card__flashcard-icon">
                            <span class="material-symbols-outlined">cards_star</span>
                        </div>
                        <div class="note-card__studio-body">
                            <div class="note-card__studio-heading">
                                <strong class="note-card__flashcard-title">${escapeHtml(normalized.flashcardDeck?.title || normalized.title)}</strong>
                                ${selectedBadge}
                            </div>
                            <div class="note-card__flashcard-meta">${flashcardMeta}</div>
                        </div>
                        <button class="note-card__menu-button" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="note-card__studio-main">
                        <div class="note-card__studio-icon note-card__studio-icon--${typeConfig.accent}">
                            <span class="material-symbols-outlined">${escapeHtml(typeConfig.icon)}</span>
                        </div>
                        <div class="note-card__studio-body">
                            <div class="note-card__studio-heading">
                                <strong>${escapeHtml(normalized.title)}</strong>
                                ${selectedBadge}
                            </div>
                            <div class="note-card__studio-preview">${preview || '暂无内容。'}</div>
                            <div class="note-card__studio-meta">
                                <span class="note-card__kind note-card__kind--studio">
                                    <span class="material-symbols-outlined">${escapeHtml(typeConfig.icon)}</span>
                                    <span>${escapeHtml(typeConfig.label)}</span>
                                </span>
                                ${metaParts.map((item) => `<span>${item}</span>`).join('')}
                            </div>
                        </div>
                        <button class="note-card__menu-button" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                `;
            }

            card.addEventListener('click', (event) => {
                const target = event.target;
                if (target instanceof ElementCtor && target.closest('[data-note-menu]')) {
                    return;
                }
                if (flashcardsApi.openPractice(normalized, { trigger: card })) {
                    return;
                }
                openNoteDetail(normalized, { trigger: card });
                renderNotesPanel();
            });

            card.querySelector('[data-note-menu]')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openNoteItemMenu(normalized, event.currentTarget);
            });

            el.notesList.appendChild(card);
        });
    }

    async function loadTopicNotes() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            state.topicNotes = [];
            renderNotesPanel();
            return;
        }

        const result = await chatAPI.listTopicNotes(state.currentSelectedItem.id, state.currentTopicId).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载话题笔记失败：${result?.error || '未知错误'}`, 'error');
            state.topicNotes = [];
            renderNotesPanel();
            return;
        }

        state.topicNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function loadAgentNotes() {
        if (!state.currentSelectedItem.id) {
            state.agentNotes = [];
            renderNotesPanel();
            return;
        }

        const result = await chatAPI.listAgentNotes(state.currentSelectedItem.id).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载学科笔记失败：${result?.error || '未知错误'}`, 'error');
            state.agentNotes = [];
            renderNotesPanel();
            return;
        }

        state.agentNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function refreshNotesData() {
        await loadTopicNotes();
        await loadAgentNotes();
    }

    function createBlankNote() {
        openNoteDetail(null, {
            kind: 'note',
            trigger: documentObj.activeElement instanceof HTMLElementCtor ? documentObj.activeElement : null,
        });
        renderNotesPanel();
    }

    async function saveActiveNote() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题，再保存笔记。', 'warning');
            return;
        }

        const request = buildNoteSaveRequest({
            currentNote: getActiveNote(),
            currentTopicId: state.currentTopicId,
            title: el.noteTitleInput?.value.trim() || '',
            contentMarkdown: el.noteContentInput?.value || '',
        });

        if (!request) {
            ui.showToastNotification('请输入笔记标题或内容。', 'warning');
            return;
        }

        const result = await chatAPI.saveTopicNote(
            state.currentSelectedItem.id,
            request.targetTopicId,
            request.payload,
        );

        if (!result?.success) {
            ui.showToastNotification(`保存笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.activeNoteId = result.item?.id || null;
        await refreshNotesData();
        openNoteDetail(normalizeNote(result.item || {}));
        ui.showToastNotification('笔记已保存。', 'success');
    }

    async function syncDeletedNoteReferences(note) {
        const noteId = String(note?.id || '').trim();
        const agentId = String(note?.agentId || '').trim();
        const topicId = String(note?.topicId || '').trim();
        if (!noteId || !agentId || !topicId) {
            return { success: true, changed: false };
        }

        const isCurrentTopic = agentId === state.currentSelectedItem.id && topicId === state.currentTopicId;
        const history = isCurrentTopic
            ? state.currentChatHistory
            : await chatAPI.getChatHistory(agentId, topicId).catch(() => null);

        if (!Array.isArray(history)) {
            return {
                success: false,
                changed: false,
                error: '无法读取关联会话的历史记录。',
            };
        }

        const { changed, nextHistory } = removeDeletedNoteReferencesFromHistory(history, noteId);
        if (!changed) {
            return { success: true, changed: false };
        }

        const saveResult = await chatAPI.saveChatHistory(agentId, topicId, nextHistory).catch((error) => ({
            error: error.message,
        }));
        if (saveResult?.error) {
            return {
                success: false,
                changed: false,
                error: saveResult.error,
            };
        }

        if (isCurrentTopic) {
            updateCurrentChatHistory(nextHistory);
            decorateChatMessages();
        }

        return { success: true, changed: true };
    }

    async function deleteNoteRecord(note) {
        const currentNote = note ? normalizeNote(note) : (getCurrentDetailNote() ? normalizeNote(getCurrentDetailNote()) : null);
        if (!currentNote?.id) {
            ui.showToastNotification('请先选择一条笔记。', 'warning');
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除笔记“${currentNote.title}”吗？`,
            '删除笔记',
            '删除',
            '取消',
            true,
        );
        if (!confirmed) {
            return;
        }

        const result = await chatAPI.deleteTopicNote(currentNote.agentId, currentNote.topicId, currentNote.id);
        if (!result?.success) {
            ui.showToastNotification(`删除笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        const syncResult = await syncDeletedNoteReferences(currentNote);
        const nextState = deriveDeletedNoteState({
            selectedNoteIds: state.selectedNoteIds,
            activeNoteId: state.activeNoteId,
            activeFlashcardNoteId: state.activeFlashcardNoteId,
        }, currentNote.id);
        state.selectedNoteIds = nextState.selectedNoteIds;
        state.activeNoteId = nextState.activeNoteId;
        state.activeFlashcardNoteId = nextState.activeFlashcardNoteId;
        if (!state.activeNoteId) {
            clearNoteEditor();
        }
        await refreshNotesData();
        if (state.notesStudioView === 'detail') {
            closeNoteDetail({ restoreFocus: false });
        }
        if (!syncResult?.success) {
            ui.showToastNotification(`笔记已删除，但消息引用清理失败：${syncResult?.error || '未知错误'}`, 'warning', 5000);
            return;
        }
        ui.showToastNotification('笔记已删除。', 'success');
    }

    async function deleteActiveNote() {
        await deleteNoteRecord(null);
    }

    async function createNoteFromMessage(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        const noteBase = buildMessageNoteContent(message);
        const timestamp = new Date(message.timestamp || Date.now()).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\//g, '-');
        const result = await chatAPI.createNoteFromMessage({
            agentId: state.currentSelectedItem.id,
            topicId: state.currentTopicId,
            title: `${noteBase.title} ${timestamp}`,
            contentMarkdown: noteBase.contentMarkdown,
            sourceMessageIds: [message.id],
            sourceDocumentRefs: Array.isArray(message.kbContextRefs) ? message.kbContextRefs : [],
            kind: 'message-note',
        });

        if (!result?.success) {
            ui.showToastNotification(`生成笔记失败：${result?.error || '未知错误'}`, 'error');
            return null;
        }

        patchCurrentHistoryMessage(messageId, (entry) => ({
            ...entry,
            favorited: true,
            favoriteAt: Date.now(),
            noteRefs: Array.isArray(entry.noteRefs)
                ? [...new Set([...entry.noteRefs, result.item.id])]
                : [result.item.id],
        }));
        await persistHistory();
        await refreshNotesData();
        revealNote(result.item);
        decorateChatMessages();
        ui.showToastNotification('已从当前气泡生成笔记。', 'success');
        return normalizeNote(result.item);
    }

    async function toggleMessageFavorite(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        if (message.favorited) {
            patchCurrentHistoryMessage(messageId, (entry) => ({
                ...entry,
                favorited: false,
                favoriteAt: null,
            }));
            await persistHistory();
            decorateChatMessages();
            ui.showToastNotification('已取消收藏，已生成的笔记会继续保留。', 'info');
            return null;
        }

        let favoriteNote = null;
        const existingNoteId = Array.isArray(message.noteRefs) ? message.noteRefs[0] : null;
        if (existingNoteId) {
            await refreshNotesData();
            favoriteNote = findNoteById(existingNoteId);
        }

        if (!favoriteNote) {
            favoriteNote = await createNoteFromMessage(messageId);
            if (!favoriteNote) {
                return null;
            }
        } else {
            patchCurrentHistoryMessage(messageId, (entry) => ({
                ...entry,
                favorited: true,
                favoriteAt: Date.now(),
            }));
            await persistHistory();
            revealNote(favoriteNote);
            decorateChatMessages();
            ui.showToastNotification('已收藏，并已定位到右侧笔记。', 'success');
        }

        return favoriteNote;
    }

    function decorateChatMessages() {
        for (const message of state.currentChatHistory) {
            if (!message?.id || message.isThinking || (message.role !== 'user' && message.role !== 'assistant')) {
                continue;
            }

            const messageItem = el.chatMessages?.querySelector(`.message-item[data-message-id="${message.id}"]`);
            const wrapper = messageItem?.querySelector('.details-and-bubble-wrapper');
            if (!messageItem || !wrapper) {
                continue;
            }

            wrapper.querySelector('.study-message-actions')?.remove();

            const actions = documentObj.createElement('div');
            actions.className = 'study-message-actions';

            const favoriteButton = documentObj.createElement('button');
            favoriteButton.type = 'button';
            favoriteButton.className = `study-message-action${message.favorited ? ' study-message-action--active' : ''}`;
            favoriteButton.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">star</span>${message.favorited ? '已收藏' : '收藏'}`;
            favoriteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                void toggleMessageFavorite(message.id);
            });

            const noteButton = documentObj.createElement('button');
            noteButton.type = 'button';
            noteButton.className = 'study-message-action';
            noteButton.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">note_add</span>${message.noteRefs?.length > 0 ? '新增笔记' : '记入笔记'}`;
            noteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                void createNoteFromMessage(message.id);
            });

            actions.appendChild(favoriteButton);
            actions.appendChild(noteButton);
            wrapper.appendChild(actions);
        }
    }

    function getSelectedNotes() {
        return getVisibleNotes().filter((note) => state.selectedNoteIds.includes(note.id));
    }

    function toggleNoteSelection(noteId) {
        const normalizedId = String(noteId || '').trim();
        if (!normalizedId) {
            return;
        }

        if (state.selectedNoteIds.includes(normalizedId)) {
            state.selectedNoteIds = state.selectedNoteIds.filter((id) => id !== normalizedId);
        } else {
            state.selectedNoteIds = [...state.selectedNoteIds, normalizedId];
        }

        renderNotesPanel();
    }

    async function resolveStudyInputText() {
        const selectedNotes = getSelectedNotes();
        if (selectedNotes.length > 0) {
            return {
                sourceLabel: 'selected-notes',
                text: selectedNotes
                    .map((note) => `# ${note.title}\n\n${note.contentMarkdown}`)
                    .join('\n\n---\n\n'),
                sourceMessageIds: [...new Set(selectedNotes.flatMap((note) => note.sourceMessageIds || []))],
                sourceDocumentRefs: selectedNotes.flatMap((note) => note.sourceDocumentRefs || []),
            };
        }

        const currentTopic = getCurrentTopic();
        if (!currentTopic?.knowledgeBaseId) {
            return null;
        }

        const sourceResult = await chatAPI.retrieveKnowledgeBaseContext({
            kbId: currentTopic.knowledgeBaseId,
            query: '请概览当前来源资料的核心知识点、重点概念和常见考点。',
        }).catch(() => null);

        if (!sourceResult?.success || !sourceResult.contextText) {
            return null;
        }

        return {
            sourceLabel: 'topic-source',
            text: sourceResult.contextText,
            sourceMessageIds: [],
            sourceDocumentRefs: Array.isArray(sourceResult.refs) ? sourceResult.refs : [],
        };
    }

    async function runNotesTool(kind) {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }

        const studyInput = await resolveStudyInputText();
        if (!studyInput?.text) {
            ui.showToastNotification('请先选择笔记，或为当前话题绑定并导入来源资料。', 'warning');
            return;
        }

        const prompts = {
            analysis: {
                title: `深度分析报告 ${new Date().toLocaleString()}`,
                instruction: '请基于以下学习材料生成一份结构化深度分析报告，包含：核心结论、关键知识点、关联关系、疑难点/待补问题、后续学习建议。使用简体中文 Markdown。',
                kind: 'analysis',
            },
            quiz: {
                title: `选择题练习 ${new Date().toLocaleString()}`,
                instruction: '请基于以下学习材料生成 8 道选择题。每题包含题干、4 个选项、正确答案、简短解析。使用简体中文 Markdown。',
                kind: 'quiz',
            },
            flashcards: {
                title: `闪卡集合 ${new Date().toLocaleString()}`,
                instruction: [
                    '请基于以下学习材料生成一组适合复习记忆的结构化闪卡。',
                    '你必须返回严格 JSON，不要输出 JSON 之外的说明。',
                    'JSON 结构如下：',
                    '{',
                    '  "title": "卡组标题",',
                    '  "cards": [',
                    '    { "id": "card-1", "front": "问题正面", "back": "答案背面" }',
                    '  ]',
                    '}',
                    '要求：',
                    '1. 生成 12 张卡。',
                    '2. front 与 back 都使用简体中文，可包含少量 Markdown 强调。',
                    '3. 每张卡必须信息准确、去重、适合抽认卡练习。',
                    '4. title 要简洁、像一个可学习的卡组名称。',
                ].join('\n'),
                kind: 'flashcards',
            },
        };

        const prompt = prompts[kind];
        if (!prompt) {
            return;
        }

        if (prompt.kind === 'flashcards') {
            flashcardsApi.beginPendingGeneration({
                title: prompt.title,
                sourceCount: Array.isArray(studyInput.sourceDocumentRefs) ? studyInput.sourceDocumentRefs.length : 0,
            });
        }

        ui.showToastNotification('正在生成内容，请稍候…', 'info', 2500);

        const response = await chatAPI.sendToVCP({
            requestId: createId(`study_${kind}`),
            endpoint: state.settings.vcpServerUrl,
            apiKey: state.settings.vcpApiKey,
            messages: [
                { role: 'system', content: '你是 UniStudy 的学习助手，请输出结构清晰、适合学习沉淀的 Markdown。' },
                { role: 'user', content: `${prompt.instruction}\n\n学习材料如下：\n\n${studyInput.text}` },
            ],
            modelConfig: {
                model: state.currentSelectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
                temperature: 0.4,
                max_tokens: Number(state.currentSelectedItem.config?.maxOutputTokens ?? 2400),
                top_p: 0.95,
                stream: false,
            },
            context: buildTopicContext(),
        });

        if (response?.error) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`生成失败：${response.error}`, 'error');
            return;
        }

        const responseContent = response?.response?.choices?.[0]?.message?.content || '';
        if (!responseContent.trim()) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification('模型没有返回可保存的内容。', 'warning');
            return;
        }

        let contentMarkdown = responseContent;
        let flashcardDeck = null;
        let flashcardProgress = null;

        if (prompt.kind === 'flashcards') {
            const generated = flashcardsApi.buildGeneratedFlashcardContent(
                responseContent,
                prompt.title,
                studyInput.sourceDocumentRefs,
            );

            if (!generated) {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
                ui.showToastNotification('闪卡生成结果格式无效，请重试。', 'error');
                return;
            }

            flashcardDeck = generated.flashcardDeck;
            flashcardProgress = generated.flashcardProgress;
            contentMarkdown = generated.contentMarkdown;
        }

        const saveResult = await chatAPI.saveTopicNote(state.currentSelectedItem.id, state.currentTopicId, {
            title: prompt.title,
            contentMarkdown,
            sourceMessageIds: studyInput.sourceMessageIds,
            sourceDocumentRefs: studyInput.sourceDocumentRefs,
            kind: prompt.kind,
            flashcardDeck,
            flashcardProgress,
        });

        if (!saveResult?.success) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`保存生成结果失败：${saveResult?.error || '未知错误'}`, 'error');
            return;
        }

        await refreshNotesData();
        const savedNote = normalizeNote(saveResult.item);
        if (prompt.kind === 'flashcards' && flashcardsApi.hasStructuredFlashcards(savedNote)) {
            flashcardsApi.clearPendingGeneration();
            flashcardsApi.openPractice(savedNote, { trigger: el.generateFlashcardsBtn || null });
        } else {
            flashcardsApi.clearPendingGeneration();
            openNoteDetail(savedNote, {
                kind: getNormalizedNoteKind(savedNote),
                trigger: prompt.kind === 'analysis'
                    ? el.analyzeNotesBtn
                    : (prompt.kind === 'quiz' ? el.generateQuizBtn : null),
            });
        }

        setSidePanelTab('notes');
        ui.showToastNotification('已生成并保存到当前话题笔记。', 'success');
    }

    function resetState(options = {}) {
        const clearTopicNotes = options.clearTopicNotes === true;
        const clearAgentNotes = options.clearAgentNotes === true;
        const clearSelection = options.clearSelection !== false;
        const clearActiveNote = options.clearActiveNote !== false;
        const closeDetailView = options.closeDetailView === true;
        const clearFlashcards = options.clearFlashcards !== false;

        if (closeDetailView) {
            closeNoteDetail({ restoreFocus: false });
        } else {
            closeNoteActionMenu();
        }

        if (clearSelection) {
            state.selectedNoteIds = [];
        }
        if (clearTopicNotes) {
            state.topicNotes = [];
        }
        if (clearAgentNotes) {
            state.agentNotes = [];
        }
        if (clearActiveNote) {
            clearNoteEditor();
        }
        if (clearFlashcards) {
            flashcardsApi.resetState();
        }

        renderNotesPanel();
    }

    function setNotesScope(scope) {
        state.notesScope = scope === 'agent' ? 'agent' : 'topic';
        state.selectedNoteIds = [];
        renderNotesPanel();
    }

    function openNotesStudio() {
        const note = getCurrentDetailNote();
        if (note) {
            openNoteDetail(note, { trigger: el.notesStudioOpenBtn });
        } else {
            openNoteDetail(null, { kind: 'note', trigger: el.notesStudioOpenBtn });
        }
    }

    function bindEvents() {
        documentObj.addEventListener('click', (event) => {
            const target = event.target;
            if (!state.activeNoteMenu) {
                return;
            }

            if (target instanceof ElementCtor && (target.closest('#noteActionMenu') || target.closest('[data-note-menu]'))) {
                return;
            }
            closeNoteActionMenu();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            if (state.activeNoteMenu) {
                closeNoteActionMenu();
            }
            if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
                closeNoteDetail();
            }
        });
        el.notesList?.addEventListener('scroll', closeNoteActionMenu);
        el.topicNotesScopeBtn?.addEventListener('click', () => setNotesScope('topic'));
        el.agentNotesScopeBtn?.addEventListener('click', () => setNotesScope('agent'));
        el.newNoteBtn?.addEventListener('click', createBlankNote);
        el.newNoteFabBtn?.addEventListener('click', createBlankNote);
        el.notesStudioOpenBtn?.addEventListener('click', openNotesStudio);
        el.saveNoteBtn?.addEventListener('click', () => {
            void saveActiveNote();
        });
        el.deleteNoteBtn?.addEventListener('click', () => {
            void deleteActiveNote();
        });
        el.analyzeNotesBtn?.addEventListener('click', () => {
            void runNotesTool('analysis');
        });
        el.generateQuizBtn?.addEventListener('click', () => {
            void runNotesTool('quiz');
        });
        el.generateFlashcardsBtn?.addEventListener('click', () => {
            void runNotesTool('flashcards');
        });
        el.noteDetailCloseBtn?.addEventListener('click', () => closeNoteDetail());
        el.noteDetailModalBackdrop?.addEventListener('click', () => closeNoteDetail());
    }

    return {
        bindEvents,
        closeNoteActionMenu,
        closeNoteDetail,
        createBlankNote,
        decorateChatMessages,
        findNoteById,
        getActiveNote,
        getCurrentDetailNote,
        loadAgentNotes,
        loadTopicNotes,
        normalizeNote,
        openNoteDetail,
        refreshNotesData,
        renderNotesPanel,
        replaceNoteInCollections,
        resetState,
    };
}

export {
    createNotesController,
};

import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import {
    buildNotesSelectionSummary,
    formatRelativeTime,
    getNormalizedNoteKind,
} from './notesUtils.js';
import { hasStructuredQuiz } from '../quiz/quizUtils.js';

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

function createNotesDom(deps = {}) {
    const state = deps.state || {};
    const el = deps.el;
    const documentObj = deps.documentObj || document;
    const windowObj = deps.windowObj || window;
    const flashcardsApi = deps.flashcardsApi || {
        getFlashcardSourceCount: () => 0,
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
    };
    const normalizeNote = deps.normalizeNote || ((note) => note);
    const getVisibleNotes = deps.getVisibleNotes || (() => []);
    const getGeneratedVisibleNotes = deps.getGeneratedVisibleNotes || (() => []);
    const getManualLibraryNotes = deps.getManualLibraryNotes || (() => []);
    const getActiveNote = deps.getActiveNote || (() => null);
    const getCurrentTopicDisplayName = deps.getCurrentTopicDisplayName || (() => '请选择一个话题');
    const getTopicDisplayLabel = deps.getTopicDisplayLabel || ((topicId) => topicId || '未归类话题');
    const getNoteHighlightId = deps.getNoteHighlightId || (() => null);
    const openNoteDetail = deps.openNoteDetail || (() => {});
    const toggleNoteSelection = deps.toggleNoteSelection || (() => {});
    const deleteNoteRecord = deps.deleteNoteRecord || (async () => {});
    const createNoteFromMessage = deps.createNoteFromMessage || (async () => null);
    const toggleMessageFavorite = deps.toggleMessageFavorite || (async () => null);
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});

    const ElementCtor = windowObj.Element || globalThis.Element;

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
        const structuredQuiz = kind === 'quiz' && hasStructuredQuiz(note);
        const analysisPreviewMode = kind === 'analysis' && state.noteDetailMode === 'view';
        const notePreviewMode = kind === 'note' && state.noteDetailMode === 'view';
        if (kind === 'quiz' && !structuredQuiz) {
            state.noteDetailMode = 'edit';
        }
        const practiceMode = kind === 'quiz' && structuredQuiz && state.noteDetailMode === 'practice';
        const editable = !flashcards
            && !analysisPreviewMode
            && !notePreviewMode
            && (!structuredQuiz || state.noteDetailMode === 'edit');
        const noteTitle = flashcards
            ? (note?.flashcardDeck?.title || note?.title || '闪卡练习')
            : structuredQuiz
                ? (note?.quizSet?.title || note?.title || '选择题练习')
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
        el.analysisEditMarkdownBtn?.classList.toggle('hidden', !(kind === 'analysis' && analysisPreviewMode));
        el.analysisViewReportBtn?.classList.toggle('hidden', !(kind === 'analysis' && !analysisPreviewMode && Boolean(note?.id)));
        el.noteEditMarkdownBtn?.classList.toggle('hidden', !(kind === 'note' && notePreviewMode));
        el.noteViewPreviewBtn?.classList.toggle('hidden', !(kind === 'note' && !notePreviewMode));
        el.quizEditSourceBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && practiceMode));
        el.quizViewPracticeBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && !practiceMode));
        el.deleteNoteBtn?.classList.toggle('hidden', !note?.id);
        el.analysisPreviewCard?.classList.toggle('hidden', !analysisPreviewMode);
        el.noteMarkdownPreviewCard?.classList.toggle('hidden', !notePreviewMode);
        el.noteEditorCard?.classList.toggle('hidden', flashcards || practiceMode || analysisPreviewMode || notePreviewMode);
        el.quizPracticeCard?.classList.toggle('hidden', !practiceMode);
        el.flashcardsPracticeCard?.classList.toggle('hidden', !flashcards);
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
        const topicLabel = note.topicId ? ` · ${getTopicDisplayLabel(note.topicId)}` : '';
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = `更新时间：${formatRelativeTime(note.updatedAt)}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
        }
        if (!state.noteDetailKind || state.noteDetailKind === 'note') {
            state.noteDetailKind = getNormalizedNoteKind(note);
        }
        syncNoteDetailChrome(note);
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

    function updateNotesSelectionSummary() {
        if (!el.notesSelectionSummary) {
            return;
        }

        const selectedCount = state.selectedNoteIds.length;
        const scopeLabel = state.notesScope === 'agent' ? '学科汇总' : '当前话题';
        const generatedCount = getGeneratedVisibleNotes().length;

        if (selectedCount > 0) {
            el.notesSelectionSummary.textContent = buildNotesSelectionSummary({
                notesScope: state.notesScope,
                selectedCount,
                visibleCount: getVisibleNotes().length,
            });
            return;
        }

        if (generatedCount > 0) {
            el.notesSelectionSummary.textContent = `${scopeLabel} · 最近生成 ${generatedCount} 条内容`;
            return;
        }

        el.notesSelectionSummary.textContent = `${scopeLabel} · 暂无生成内容，普通笔记请到顶部“我的笔记”查看`;
    }

    function renderNotesPanel() {
        if (state.notesScope !== 'topic') {
            state.notesScope = 'topic';
        }

        const notes = getGeneratedVisibleNotes();
        closeNoteActionMenu();

        el.topicNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'topic');
        el.agentNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'agent');
        if (el.openPomodoroBtn) {
            el.openPomodoroBtn.classList.toggle('notes-tool-tile--active', state.studioPomodoroVisible === true);
            const pomodoroArrow = el.openPomodoroBtn.querySelector('.notes-tool-tile__arrow');
            if (pomodoroArrow) {
                pomodoroArrow.textContent = state.studioPomodoroVisible === true ? 'expand_more' : 'chevron_right';
            }
        }
        updateNotesSelectionSummary();

        if (!el.notesList) {
            return;
        }

        el.notesList.innerHTML = '';
        const pendingFlashcards = flashcardsApi.getPendingGeneration();

        if (el.studioPomodoroPanel && state.studioPomodoroVisible) {
            el.studioPomodoroPanel.classList.remove('hidden');
            el.studioPomodoroPanel.classList.toggle('notes-pomodoro-panel--collapsed', state.studioPomodoroExpanded === false);
            el.studioPomodoroBody?.classList.toggle('hidden', state.studioPomodoroExpanded === false);
            el.studioPomodoroToggleBtn?.setAttribute('aria-expanded', state.studioPomodoroExpanded === false ? 'false' : 'true');
            el.notesList.appendChild(el.studioPomodoroPanel);
        }

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
                <strong>还没有生成内容</strong>
                <span>右侧这里会显示分析报告、选择题和闪卡；你手写的普通笔记会收纳到顶部“我的笔记”。</span>
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
                analysis: { icon: 'analytics', label: '分析', accent: 'analysis' },
                quiz: { icon: 'quiz', label: '测验', accent: 'quiz' },
                flashcards: { icon: 'style', label: '闪卡', accent: 'flashcards' },
            }[typeKind] || { icon: 'description', label: '内容', accent: 'note' };
            const metaParts = [
                sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题',
                formatRelativeTime(normalized.updatedAt),
            ];
            if (state.notesScope === 'agent' && normalized.topicId) {
                metaParts.push(getTopicDisplayLabel(normalized.topicId));
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
                                ${metaParts.map((item) => `<span>${escapeHtml(item || '')}</span>`).join('')}
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

    function renderManualNotesLibrary() {
        if (!el.manualNotesLibraryGrid) {
            return;
        }

        const allManualNotes = getManualLibraryNotes();
        const manualNotes = state.manualNotesLibraryFilter === 'selected'
            ? allManualNotes.filter((note) => state.selectedNoteIds.includes(note.id))
            : allManualNotes;
        const currentAgentName = state.currentSelectedItem?.name || '当前学科';
        const setGridEmptyState = (empty) => {
            el.manualNotesLibraryGrid.classList.toggle('manual-notes-library-grid--empty', empty);
        };

        el.manualNotesLibraryFilterAllBtn?.classList.toggle('manual-notes-library-page__filter--active', state.manualNotesLibraryFilter !== 'selected');
        el.manualNotesLibraryFilterAllBtn?.setAttribute('aria-pressed', state.manualNotesLibraryFilter !== 'selected' ? 'true' : 'false');
        el.manualNotesLibraryFilterSelectedBtn?.classList.toggle('manual-notes-library-page__filter--active', state.manualNotesLibraryFilter === 'selected');
        el.manualNotesLibraryFilterSelectedBtn?.setAttribute('aria-pressed', state.manualNotesLibraryFilter === 'selected' ? 'true' : 'false');

        if (el.manualNotesLibraryTitle) {
            el.manualNotesLibraryTitle.textContent = `${currentAgentName} · 我的笔记`;
        }
        if (el.manualNotesLibrarySubtitle) {
            const selectedCount = allManualNotes.filter((note) => state.selectedNoteIds.includes(note.id)).length;
            el.manualNotesLibrarySubtitle.textContent = state.currentSelectedItem?.id
                ? `这里收纳当前学科下的 ${allManualNotes.length} 条手写笔记，已选 ${selectedCount} 条可直接用于 Studio。`
                : '选择一个学科后，这里会显示该学科下的所有手写笔记。';
        }

        el.manualNotesLibraryGrid.innerHTML = '';
        if (!state.currentSelectedItem?.id) {
            setGridEmptyState(true);
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state manual-notes-library-grid__empty';
            empty.innerHTML = `
                <strong>还没有选中学科</strong>
                <span>请选择一个学科后，再查看当前学科下的手写笔记总览。</span>
            `;
            el.manualNotesLibraryGrid.appendChild(empty);
            return;
        }

        if (manualNotes.length === 0) {
            setGridEmptyState(true);
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state manual-notes-library-grid__empty';
            empty.innerHTML = `
                <strong>${state.manualNotesLibraryFilter === 'selected' ? '还没有加入 Studio 的笔记' : '当前学科还没有手写笔记'}</strong>
                <span>${state.manualNotesLibraryFilter === 'selected'
                    ? '你可以在卡片右上角把需要的笔记加入 Studio，方便后续生成分析、选择题和闪卡。'
                    : '你可以继续使用右侧的“新建笔记”或底部“添加笔记”，写下的内容会自动收纳到这里。'}</span>
            `;
            el.manualNotesLibraryGrid.appendChild(empty);
            return;
        }

        setGridEmptyState(false);

        manualNotes.forEach((note) => {
            const normalized = normalizeNote(note);
            const preview = escapeHtml(stripMarkdown(normalized.contentMarkdown || '').trim());
            const topicLabel = escapeHtml(getTopicDisplayLabel(normalized.topicId));
            const updatedLabel = escapeHtml(formatRelativeTime(normalized.updatedAt) || '');
            const isSelected = state.selectedNoteIds.includes(normalized.id);
            const card = documentObj.createElement('article');

            card.className = 'manual-note-card';
            card.classList.toggle('manual-note-card--selected', isSelected);
            card.innerHTML = `
                <div class="manual-note-card__header">
                    <div class="manual-note-card__header-main">
                        <span class="manual-note-card__eyebrow">手写笔记</span>
                        <strong class="manual-note-card__title">${escapeHtml(normalized.title)}</strong>
                    </div>
                    <div class="manual-note-card__header-actions">
                        <button
                            class="ghost-button manual-note-card__studio-btn ${isSelected ? 'manual-note-card__studio-btn--active' : ''}"
                            type="button"
                            data-manual-note-select="${escapeHtml(normalized.id)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}"
                        >
                            <span class="material-symbols-outlined">${isSelected ? 'check_circle' : 'add_circle'}</span>
                            <span>${isSelected ? '已加入 Studio' : '加入 Studio'}</span>
                        </button>
                        <button class="note-card__menu-button manual-note-card__menu" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                </div>
                <p class="manual-note-card__preview">${preview || '暂无内容。'}</p>
                <div class="manual-note-card__meta">
                    <span>${topicLabel}</span>
                    <span>${updatedLabel}</span>
                    ${isSelected ? '<span class="manual-note-card__selection">已选用于生成</span>' : ''}
                </div>
            `;

            card.addEventListener('click', (event) => {
                const target = event.target;
                if (target instanceof ElementCtor && target.closest('[data-note-menu]')) {
                    return;
                }
                openNoteDetail(normalized, { trigger: card });
            });

            card.querySelector('[data-note-menu]')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openNoteItemMenu(normalized, event.currentTarget);
            });

            card.querySelector('[data-manual-note-select]')?.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleNoteSelection(normalized.id);
            });

            el.manualNotesLibraryGrid.appendChild(card);
        });
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

            if (message.role !== 'assistant') {
                continue;
            }

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

    return {
        clearNoteEditor,
        closeNoteActionMenu,
        fillNoteEditor,
        openNoteItemMenu,
        renderManualNotesLibrary,
        renderNoteActionMenu,
        renderNotesPanel,
        decorateChatMessages,
        syncNoteDetailChrome,
    };
}

export {
    createNotesDom,
};

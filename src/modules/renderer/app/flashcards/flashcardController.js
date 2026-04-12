import {
    applyFlashcardResult,
    buildFlashcardPersistPayload,
    buildFlashcardSummaryMarkdown,
    createInitialFlashcardProgress,
    getFlashcardSourceCount,
    hasStructuredFlashcards,
    navigateFlashcardProgress,
    normalizeFlashcardProgress,
    parseFlashcardDeckFromResponse,
    toggleFlashcardProgressFlipped,
} from './flashcardUtils.js';

function createFlashcardController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => value);
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const getNoteById = deps.getNoteById || (() => null);
    const normalizeNote = deps.normalizeNote || ((note) => note);
    const replaceNoteInCollections = deps.replaceNoteInCollections || ((note) => note);
    const openNoteDetail = deps.openNoteDetail || (() => {});
    const closeNoteDetail = deps.closeNoteDetail || (() => {});
    const renderNotesPanel = deps.renderNotesPanel || (() => {});

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
        activeNoteId: {
            get: () => getNotesSlice().activeNoteId,
            set: (value) => patchNotes({ activeNoteId: value }),
        },
        activeFlashcardNoteId: {
            get: () => getNotesSlice().activeFlashcardNoteId,
            set: (value) => patchNotes({ activeFlashcardNoteId: value }),
        },
        pendingFlashcardGeneration: {
            get: () => getNotesSlice().pendingFlashcardGeneration,
            set: (value) => patchNotes({ pendingFlashcardGeneration: value }),
        },
    });

    function getActiveFlashcardNote() {
        const note = getNoteById(state.activeFlashcardNoteId);
        return note ? normalizeNote(note) : null;
    }

    function getPendingGeneration() {
        return state.pendingFlashcardGeneration || null;
    }

    function beginPendingGeneration(payload = {}) {
        state.activeFlashcardNoteId = null;
        state.pendingFlashcardGeneration = {
            title: String(payload.title || '闪卡生成中').trim() || '闪卡生成中',
            sourceCount: Number(payload.sourceCount || 0),
            startedAt: Date.now(),
        };
        setRightPanelMode('notes');
        renderNotesPanel();
    }

    function clearPendingGeneration() {
        state.pendingFlashcardGeneration = null;
    }

    function resetState(options = {}) {
        if (options.clearActive !== false) {
            state.activeFlashcardNoteId = null;
        }
        if (options.clearPending !== false) {
            state.pendingFlashcardGeneration = null;
        }
        if (options.render === true) {
            renderNotesPanel();
            renderPractice();
        }
    }

    function activateNote(note) {
        const normalized = normalizeNote(note);
        if (!hasStructuredFlashcards(normalized)) {
            return null;
        }

        replaceNoteInCollections(normalized);
        state.activeNoteId = null;
        state.activeFlashcardNoteId = normalized.id;
        setRightPanelMode('flashcards');
        return normalized;
    }

    function renderFlashcardContent(target, markdown) {
        if (!target) {
            return;
        }

        target.innerHTML = renderMarkdownFragment(markdown);
    }

    function renderPractice() {
        const pending = getPendingGeneration();
        if (pending && !state.activeFlashcardNoteId) {
            if (el.flashcardsDeckTitle) {
                el.flashcardsDeckTitle.textContent = pending.title;
            }
            if (el.flashcardsDeckMeta) {
                el.flashcardsDeckMeta.textContent = `${pending.sourceCount > 0 ? `${pending.sourceCount} 个来源` : '正在整理学习材料'} · 正在生成闪卡`;
            }
            if (el.flashcardsDeckProgress) {
                el.flashcardsDeckProgress.textContent = '生成中';
            }
            if (el.flashcardsKnownCount?.lastElementChild) {
                el.flashcardsKnownCount.lastElementChild.textContent = '—';
            }
            if (el.flashcardsUnknownCount?.lastElementChild) {
                el.flashcardsUnknownCount.lastElementChild.textContent = '—';
            }
            if (el.flashcardFrontContent) {
                el.flashcardFrontContent.innerHTML = `
                    <div class="flashcards-skeleton">
                        <div class="flashcards-skeleton__pill"></div>
                        <div class="flashcards-skeleton__line flashcards-skeleton__line--short"></div>
                        <div class="flashcards-skeleton__line"></div>
                        <div class="flashcards-skeleton__line flashcards-skeleton__line--wide"></div>
                        <div class="flashcards-skeleton__card"></div>
                    </div>
                `;
            }
            if (el.flashcardBackContent) {
                el.flashcardBackContent.innerHTML = '';
            }
            el.flashcardCardButton?.classList.remove('flashcard-card--flipped');
            el.flashcardCardButton?.classList.add('flashcard-card--pending');
            el.flashcardsPrevBtn?.toggleAttribute('disabled', true);
            el.flashcardsNextBtn?.toggleAttribute('disabled', true);
            el.flashcardsMarkKnownBtn?.toggleAttribute('disabled', true);
            el.flashcardsMarkUnknownBtn?.toggleAttribute('disabled', true);
            el.flashcardsMarkKnownBtn?.classList.remove('flashcards-practice__result-btn--active');
            el.flashcardsMarkUnknownBtn?.classList.remove('flashcards-practice__result-btn--active');
            return;
        }

        const note = getActiveFlashcardNote();
        if (!hasStructuredFlashcards(note)) {
            setRightPanelMode('notes');
            state.activeFlashcardNoteId = null;
            return;
        }

        const deck = note.flashcardDeck;
        const progress = note.flashcardProgress || createInitialFlashcardProgress(deck);
        const currentIndex = Number(progress?.currentIndex || 0);
        const currentCard = deck.cards[currentIndex];
        const currentState = progress?.cardStates?.find((item) => item.cardId === currentCard.id)?.result || null;

        if (el.flashcardsDeckTitle) {
            el.flashcardsDeckTitle.textContent = deck.title || note.title || '闪卡练习';
        }
        if (el.flashcardsDeckMeta) {
            el.flashcardsDeckMeta.textContent = `基于 ${getFlashcardSourceCount(note)} 个来源 · 共 ${deck.cards.length} 张卡`;
        }
        if (el.flashcardsDeckProgress) {
            el.flashcardsDeckProgress.textContent = `${currentIndex + 1} / ${deck.cards.length}`;
        }
        if (el.flashcardsKnownCount?.lastElementChild) {
            el.flashcardsKnownCount.lastElementChild.textContent = String(progress?.knownCount ?? 0);
        }
        if (el.flashcardsUnknownCount?.lastElementChild) {
            el.flashcardsUnknownCount.lastElementChild.textContent = String(progress?.unknownCount ?? 0);
        }

        renderFlashcardContent(el.flashcardFrontContent, currentCard.front);
        renderFlashcardContent(el.flashcardBackContent, currentCard.back);

        el.flashcardCardButton?.classList.remove('flashcard-card--pending');
        el.flashcardCardButton?.classList.toggle('flashcard-card--flipped', progress?.flipped === true);
        el.flashcardsPrevBtn?.toggleAttribute('disabled', currentIndex <= 0);
        el.flashcardsNextBtn?.toggleAttribute('disabled', currentIndex >= deck.cards.length - 1);
        el.flashcardsMarkKnownBtn?.toggleAttribute('disabled', false);
        el.flashcardsMarkUnknownBtn?.toggleAttribute('disabled', false);
        el.flashcardsMarkKnownBtn?.classList.toggle('flashcards-practice__result-btn--active', currentState === 'known');
        el.flashcardsMarkUnknownBtn?.classList.toggle('flashcards-practice__result-btn--active', currentState === 'unknown');
    }

    async function persistProgress(note, nextProgress) {
        const request = buildFlashcardPersistPayload(note, nextProgress);
        if (!request) {
            return false;
        }

        const result = await chatAPI.saveTopicNote(request.agentId, request.topicId, request.payload).catch((error) => ({
            success: false,
            error: error.message,
        }));

        if (!result?.success) {
            ui.showToastNotification(`保存闪卡进度失败：${result?.error || '未知错误'}`, 'error');
            return false;
        }

        replaceNoteInCollections(result.item || request.payload);
        renderNotesPanel();
        renderPractice();
        return true;
    }

    async function updateProgress(mutator) {
        const note = getActiveFlashcardNote();
        if (!hasStructuredFlashcards(note)) {
            return;
        }

        const currentProgress = note.flashcardProgress || createInitialFlashcardProgress(note.flashcardDeck);
        const nextProgress = mutator({
            ...currentProgress,
            cardStates: Array.isArray(currentProgress?.cardStates)
                ? currentProgress.cardStates.map((item) => ({ ...item }))
                : [],
        }, note.flashcardDeck);

        if (!nextProgress) {
            return;
        }

        await persistProgress(note, normalizeFlashcardProgress(nextProgress, note.flashcardDeck));
    }

    function buildGeneratedFlashcardContent(responseText, fallbackTitle, fallbackRefs = []) {
        const flashcardDeck = parseFlashcardDeckFromResponse(responseText, fallbackTitle, fallbackRefs);
        if (!flashcardDeck) {
            return null;
        }

        return {
            flashcardDeck,
            flashcardProgress: createInitialFlashcardProgress(flashcardDeck),
            contentMarkdown: buildFlashcardSummaryMarkdown(flashcardDeck),
        };
    }

    function openPractice(note, options = {}) {
        const normalized = normalizeNote(note);
        if (!hasStructuredFlashcards(normalized)) {
            return false;
        }

        openNoteDetail(normalized, {
            ...options,
            kind: 'flashcards',
        });
        renderNotesPanel();
        return true;
    }

    function returnToNotesPanel() {
        closeNoteDetail();
        renderNotesPanel();
    }

    function toggleFlip() {
        if (getPendingGeneration()) {
            return;
        }

        void updateProgress((progress, deck) => toggleFlashcardProgressFlipped(progress, deck));
    }

    async function navigate(direction) {
        await updateProgress((progress, deck) => navigateFlashcardProgress(progress, deck, direction));
    }

    async function setResult(result) {
        await updateProgress((progress, deck) => applyFlashcardResult(progress, deck, result));
    }

    function bindEvents() {
        el.flashcardsBackToNotesBtn?.addEventListener('click', returnToNotesPanel);
        el.flashcardCardButton?.addEventListener('click', toggleFlip);
        el.flashcardsPrevBtn?.addEventListener('click', () => {
            void navigate(-1);
        });
        el.flashcardsNextBtn?.addEventListener('click', () => {
            void navigate(1);
        });
        el.flashcardsMarkUnknownBtn?.addEventListener('click', () => {
            void setResult('unknown');
        });
        el.flashcardsMarkKnownBtn?.addEventListener('click', () => {
            void setResult('known');
        });
    }

    return {
        activateNote,
        beginPendingGeneration,
        bindEvents,
        buildGeneratedFlashcardContent,
        clearPendingGeneration,
        getActiveFlashcardNote,
        getFlashcardSourceCount,
        getPendingGeneration,
        hasStructuredFlashcards,
        openPractice,
        renderPractice,
        resetState,
    };
}

export {
    createFlashcardController,
};

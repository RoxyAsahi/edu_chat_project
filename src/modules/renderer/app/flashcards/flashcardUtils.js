function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }

    return Math.min(Math.max(value, min), max);
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

function extractStructuredJsonPayload(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1]?.trim() || raw;

    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function normalizeFlashcardSourceRefs(refs, fallback = []) {
    return Array.isArray(refs)
        ? refs.filter(Boolean)
        : (Array.isArray(fallback) ? fallback.filter(Boolean) : []);
}

function normalizeFlashcardDeck(deck, fallbackRefs = []) {
    if (!deck || typeof deck !== 'object') {
        return null;
    }

    const cards = Array.isArray(deck.cards)
        ? deck.cards.map((card, index) => {
            if (!card || typeof card !== 'object') {
                return null;
            }

            const front = String(card.front || '').trim();
            const back = String(card.back || '').trim();
            if (!front || !back) {
                return null;
            }

            return {
                id: String(card.id || `flashcard_${index + 1}`),
                front,
                back,
                sourceDocumentRefs: normalizeFlashcardSourceRefs(card.sourceDocumentRefs, fallbackRefs),
            };
        }).filter(Boolean)
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
    });

    return {
        currentIndex: clamp(Number(progress?.currentIndex ?? 0), 0, deck.cards.length - 1),
        flipped: progress?.flipped === true,
        knownCount: cardStates.filter((item) => item.result === 'known').length,
        unknownCount: cardStates.filter((item) => item.result === 'unknown').length,
        cardStates,
    };
}

function hasStructuredFlashcards(note) {
    return Boolean(
        note?.kind === 'flashcards'
        && note?.flashcardDeck
        && Array.isArray(note.flashcardDeck.cards)
        && note.flashcardDeck.cards.length > 0
    );
}

function buildFlashcardSummaryMarkdown(deck) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return '';
    }

    return [
        `# ${deck.title || '闪卡集合'}`,
        '',
        ...deck.cards.map((card, index) => [
            `## 卡片 ${index + 1}`,
            `- 正面：${stripMarkdown(card.front) || card.front}`,
            `- 背面：${stripMarkdown(card.back) || card.back}`,
        ].join('\n')),
    ].join('\n\n');
}

function parseFlashcardDeckFromResponse(text, fallbackTitle, fallbackRefs = []) {
    const payload = extractStructuredJsonPayload(text);
    const candidateDeck = payload?.flashcardDeck && typeof payload.flashcardDeck === 'object'
        ? payload.flashcardDeck
        : payload;

    return normalizeFlashcardDeck(
        {
            title: candidateDeck?.title || fallbackTitle,
            cards: candidateDeck?.cards,
        },
        fallbackRefs,
    );
}

function createInitialFlashcardProgress(deck) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return null;
    }

    return normalizeFlashcardProgress({
        currentIndex: 0,
        flipped: false,
        cardStates: deck.cards.map((card) => ({
            cardId: card.id,
            result: null,
            updatedAt: 0,
        })),
    }, deck);
}

function toggleFlashcardProgressFlipped(progress, deck) {
    if (!deck) {
        return null;
    }

    return normalizeFlashcardProgress({
        ...progress,
        flipped: progress?.flipped !== true,
    }, deck);
}

function navigateFlashcardProgress(progress, deck, direction) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return null;
    }

    return normalizeFlashcardProgress({
        ...progress,
        currentIndex: clamp((progress?.currentIndex || 0) + Number(direction || 0), 0, deck.cards.length - 1),
        flipped: false,
    }, deck);
}

function applyFlashcardResult(progress, deck, result, now = Date.now()) {
    if (
        !deck
        || !Array.isArray(deck.cards)
        || deck.cards.length === 0
        || (result !== 'known' && result !== 'unknown')
    ) {
        return null;
    }

    const currentIndex = clamp(progress?.currentIndex || 0, 0, deck.cards.length - 1);
    const currentCard = deck.cards[currentIndex];
    const nextStates = Array.isArray(progress?.cardStates)
        ? progress.cardStates.map((item) => (
            item.cardId === currentCard.id
                ? { ...item, result, updatedAt: Number(now || Date.now()) }
                : item
        ))
        : [];

    return normalizeFlashcardProgress({
        ...progress,
        currentIndex: Math.min(currentIndex + 1, deck.cards.length - 1),
        flipped: false,
        cardStates: nextStates,
    }, deck);
}

function getFlashcardSourceCount(note) {
    if (!note) {
        return 0;
    }

    const documentCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
    if (documentCount > 0) {
        return documentCount;
    }

    return Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
}

function buildFlashcardPersistPayload(note, nextProgress) {
    if (!note?.id || !note?.agentId || !note?.topicId) {
        return null;
    }

    return {
        agentId: note.agentId,
        topicId: note.topicId,
        payload: {
            id: note.id,
            title: note.title,
            contentMarkdown: note.contentMarkdown,
            sourceMessageIds: note.sourceMessageIds,
            sourceDocumentRefs: note.sourceDocumentRefs,
            kind: note.kind,
            flashcardDeck: note.flashcardDeck,
            flashcardProgress: normalizeFlashcardProgress(nextProgress, note.flashcardDeck),
            createdAt: note.createdAt,
        },
    };
}

export {
    applyFlashcardResult,
    buildFlashcardPersistPayload,
    buildFlashcardSummaryMarkdown,
    createInitialFlashcardProgress,
    getFlashcardSourceCount,
    hasStructuredFlashcards,
    navigateFlashcardProgress,
    normalizeFlashcardDeck,
    normalizeFlashcardProgress,
    normalizeFlashcardSourceRefs,
    parseFlashcardDeckFromResponse,
    toggleFlashcardProgressFlipped,
};

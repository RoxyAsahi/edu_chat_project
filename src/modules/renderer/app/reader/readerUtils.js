function toFiniteNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized !== 0
        ? normalized
        : null;
}

function createInitialReaderState() {
    return {
        documentId: null,
        documentName: '',
        contentType: null,
        status: 'idle',
        isIndexed: false,
        view: null,
        activePageNumber: null,
        activeParagraphIndex: null,
        activeSectionTitle: null,
        pendingSelection: null,
        guideStatus: 'idle',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: null,
    };
}

function isReaderSupportedDocument(documentItem = {}) {
    const contentType = String(documentItem.contentType || '').trim();
    if (['pdf-text', 'docx-text', 'plain', 'markdown', 'html'].includes(contentType)) {
        return true;
    }

    const mimeType = String(documentItem.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('text/')) {
        return true;
    }

    return mimeType === 'application/pdf'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || mimeType === 'application/xml';
}

function getReaderLocatorLabel(ref = {}) {
    if (ref.pageNumber !== null && ref.pageNumber !== undefined && Number.isFinite(Number(ref.pageNumber))) {
        return `第 ${Number(ref.pageNumber)} 页`;
    }
    if (ref.paragraphIndex !== null && ref.paragraphIndex !== undefined && Number.isFinite(Number(ref.paragraphIndex))) {
        return `第 ${Number(ref.paragraphIndex)} 段`;
    }
    if (ref.sectionTitle) {
        return String(ref.sectionTitle);
    }
    return '未定位';
}

function resolveReaderInitialLocation({ locator = {}, view = {} } = {}) {
    const pages = Array.isArray(view.pages) ? view.pages : [];
    const paragraphs = Array.isArray(view.paragraphs) ? view.paragraphs : [];
    const firstPage = pages[0] || null;
    const firstPageParagraph = Array.isArray(firstPage?.paragraphs) ? firstPage.paragraphs[0] : null;
    const firstParagraph = paragraphs[0] || firstPageParagraph || null;
    const hasExplicitLocation = Boolean(
        toFiniteNumber(locator.pageNumber)
        || toFiniteNumber(locator.paragraphIndex)
        || locator.sectionTitle
    );

    return {
        activePageNumber: toFiniteNumber(locator.pageNumber) ?? toFiniteNumber(firstPage?.pageNumber),
        activeParagraphIndex: toFiniteNumber(locator.paragraphIndex) ?? toFiniteNumber(firstParagraph?.index),
        activeSectionTitle: locator.sectionTitle || firstParagraph?.sectionTitle || null,
        preferredTab: locator.preferTab === 'content' || hasExplicitLocation
            ? 'content'
            : 'guide',
    };
}

function shouldRefreshReaderGuide(current = {}, options = {}) {
    if (options.forceRefresh === true) {
        return true;
    }
    if (!current?.success) {
        return true;
    }
    return !current.guideMarkdown && !['processing', 'pending'].includes(current.guideStatus);
}

function buildReaderSelectionPayload(readerState = {}, selection = {}) {
    const selectionText = String(selection.selectionText || '').replace(/\s+/g, ' ').trim();
    if (!selectionText || !readerState.documentId) {
        return null;
    }

    return {
        documentId: readerState.documentId,
        documentName: readerState.documentName,
        contentType: readerState.contentType,
        selectionText,
        snippet: selectionText.slice(0, 180),
        pageNumber: toFiniteNumber(selection.pageNumber),
        paragraphIndex: toFiniteNumber(selection.paragraphIndex),
        sectionTitle: selection.sectionTitle || null,
    };
}

function getReaderNavigationTarget(readerState = {}, step = 1) {
    if (!readerState.documentId || !readerState.view) {
        return null;
    }

    if (readerState.view.type === 'pdf') {
        const pages = Array.isArray(readerState.view.pages) ? readerState.view.pages : [];
        if (pages.length === 0) {
            return null;
        }

        const currentIndex = Math.max(0, pages.findIndex((page) => Number(page.pageNumber) === Number(readerState.activePageNumber)));
        const nextIndex = Math.min(Math.max(currentIndex + step, 0), Math.max(pages.length - 1, 0));
        const nextPage = pages[nextIndex] || null;
        if (!nextPage) {
            return null;
        }

        return {
            pageNumber: toFiniteNumber(nextPage.pageNumber),
            paragraphIndex: toFiniteNumber(nextPage.paragraphs?.[0]?.index) ?? toFiniteNumber(readerState.activeParagraphIndex),
            sectionTitle: readerState.activeSectionTitle || null,
        };
    }

    const paragraphs = Array.isArray(readerState.view.paragraphs) ? readerState.view.paragraphs : [];
    if (paragraphs.length === 0) {
        return null;
    }

    const currentIndex = Math.max(0, paragraphs.findIndex((paragraph) => Number(paragraph.index) === Number(readerState.activeParagraphIndex)));
    const nextIndex = Math.min(Math.max(currentIndex + step, 0), Math.max(paragraphs.length - 1, 0));
    const nextParagraph = paragraphs[nextIndex] || null;
    if (!nextParagraph) {
        return null;
    }

    return {
        pageNumber: null,
        paragraphIndex: toFiniteNumber(nextParagraph.index),
        sectionTitle: nextParagraph.sectionTitle || null,
    };
}

export {
    buildReaderSelectionPayload,
    createInitialReaderState,
    getReaderLocatorLabel,
    getReaderNavigationTarget,
    isReaderSupportedDocument,
    resolveReaderInitialLocation,
    shouldRefreshReaderGuide,
};

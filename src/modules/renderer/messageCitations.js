const CITATION_TARGET_SELECTOR = 'p, li, blockquote';
const INLINE_CITATION_SELECTOR = '.message-inline-citations';
const EXCLUDED_CITATION_ANCESTOR_SELECTOR = [
    'pre',
    'code',
    '.tool-request-bubble',
    '.unistudy-tool-result-bubble',
    '.learning-diary-bubble',
    '.reasoning-bubble',
    '.message-attachments',
].join(', ');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCitationText(text = '') {
    return String(text || '')
        .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/[`*_>#~\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function compactCitationText(text = '') {
    return normalizeCitationText(text)
        .replace(/[\s.,!?;:'"()[\]{}<>/\\|+=*&^%$#@`~\-，。！？；：、“”‘’（）【】《》〈〉、…·]/g, '');
}

function buildCharacterBigrams(text = '') {
    const chars = Array.from(String(text || ''));
    if (chars.length === 0) {
        return new Set();
    }
    if (chars.length === 1) {
        return new Set(chars);
    }
    const result = new Set();
    for (let index = 0; index < chars.length - 1; index += 1) {
        result.add(`${chars[index]}${chars[index + 1]}`);
    }
    return result;
}

function computeBigramOverlapRate(left = '', right = '') {
    const leftBigrams = buildCharacterBigrams(left);
    const rightBigrams = buildCharacterBigrams(right);
    if (leftBigrams.size === 0 || rightBigrams.size === 0) {
        return 0;
    }
    const smaller = leftBigrams.size <= rightBigrams.size ? leftBigrams : rightBigrams;
    const larger = smaller === leftBigrams ? rightBigrams : leftBigrams;
    let overlapCount = 0;
    smaller.forEach((item) => {
        if (larger.has(item)) {
            overlapCount += 1;
        }
    });
    return overlapCount / Math.max(1, smaller.size);
}

function getLongestSharedSegmentLength(left = '', right = '') {
    const leftText = String(left || '');
    const rightText = String(right || '');
    if (!leftText || !rightText) {
        return 0;
    }
    const shorter = leftText.length <= rightText.length ? leftText : rightText;
    const longer = shorter === leftText ? rightText : leftText;
    if (longer.includes(shorter)) {
        return shorter.length;
    }
    const maxWindow = Math.min(shorter.length, 24);
    for (let windowSize = maxWindow; windowSize >= 4; windowSize -= 1) {
        for (let startIndex = 0; startIndex <= shorter.length - windowSize; startIndex += 1) {
            const segment = shorter.slice(startIndex, startIndex + windowSize);
            if (longer.includes(segment)) {
                return windowSize;
            }
        }
    }
    return 0;
}

function scoreCitationRefAgainstBlock(ref = {}, block = {}) {
    const refCompact = compactCitationText(ref.snippet || ref.selectionText || '');
    const blockCompact = block.compactText || '';
    if (!refCompact || !blockCompact) {
        return 0;
    }
    if (blockCompact.includes(refCompact) || refCompact.includes(blockCompact)) {
        return 1;
    }
    const overlapScore = computeBigramOverlapRate(refCompact, blockCompact);
    const sharedSegmentLength = getLongestSharedSegmentLength(refCompact, blockCompact);
    const sharedSegmentBonus = sharedSegmentLength >= 4
        ? Math.min(0.45, sharedSegmentLength / 20)
        : 0;
    return overlapScore + sharedSegmentBonus;
}

function isEligibleCitationTarget(element) {
    if (!element || typeof element.matches !== 'function') {
        return false;
    }
    if (!element.matches(CITATION_TARGET_SELECTOR)) {
        return false;
    }
    if (element.closest(EXCLUDED_CITATION_ANCESTOR_SELECTOR)) {
        return false;
    }
    if (element.tagName === 'BLOCKQUOTE' && element.querySelector('p, li')) {
        return false;
    }
    return Boolean(element.textContent && element.textContent.trim());
}

function collectCitationTargetBlocks(contentDiv) {
    if (!contentDiv || typeof contentDiv.querySelectorAll !== 'function') {
        return [];
    }
    return Array.from(contentDiv.querySelectorAll(CITATION_TARGET_SELECTOR))
        .filter(isEligibleCitationTarget)
        .map((element) => {
            const text = String(element.textContent || '').trim();
            return {
                element,
                text,
                compactText: compactCitationText(text),
            };
        });
}

function assignCitationRefsToBlocks(contentDiv, refs = [], options = {}) {
    const blocks = collectCitationTargetBlocks(contentDiv);
    const normalizedRefs = Array.isArray(refs) ? refs : [];
    const threshold = Number.isFinite(options.threshold) ? Number(options.threshold) : 0.18;
    const blockRefs = blocks.map(() => []);

    if (blocks.length === 0 || normalizedRefs.length === 0) {
        return { blocks, blockRefs };
    }

    normalizedRefs.forEach((ref, refIndex) => {
        let bestBlockIndex = blocks.length - 1;
        let bestScore = -1;
        blocks.forEach((block, blockIndex) => {
            const score = scoreCitationRefAgainstBlock(ref, block);
            if (score > bestScore) {
                bestScore = score;
                bestBlockIndex = blockIndex;
            }
        });
        const finalBlockIndex = bestScore >= threshold ? bestBlockIndex : blocks.length - 1;
        blockRefs[finalBlockIndex].push(refIndex);
    });

    return { blocks, blockRefs };
}

function clearInlineCitationBadges(contentDiv) {
    if (!contentDiv || typeof contentDiv.querySelectorAll !== 'function') {
        return;
    }
    contentDiv.querySelectorAll(INLINE_CITATION_SELECTOR).forEach((element) => element.remove());
}

function renderInlineCitationBadges(contentDiv, refs = [], options = {}) {
    clearInlineCitationBadges(contentDiv);

    const normalizedRefs = Array.isArray(refs) ? refs : [];
    if (!contentDiv || normalizedRefs.length === 0) {
        return { blocks: [], blockRefs: [] };
    }

    const assignment = assignCitationRefsToBlocks(contentDiv, normalizedRefs, options);
    assignment.blockRefs.forEach((refIndexes, blockIndex) => {
        if (!Array.isArray(refIndexes) || refIndexes.length === 0) {
            return;
        }
        const block = assignment.blocks[blockIndex];
        if (!block?.element) {
            return;
        }
        const wrapper = block.element.ownerDocument.createElement('span');
        wrapper.className = 'message-inline-citations';
        wrapper.setAttribute('aria-label', '消息引用');

        refIndexes.forEach((refIndex) => {
            const button = block.element.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'message-citation-chip';
            button.dataset.messageCitationIndex = String(refIndex);
            button.dataset.interactivePreview = 'true';
            button.setAttribute('aria-label', `查看引用 ${refIndex + 1}`);
            button.setAttribute('aria-expanded', 'false');
            button.textContent = `${refIndex + 1}`;
            wrapper.appendChild(button);
        });

        block.element.appendChild(wrapper);
    });

    return assignment;
}

function buildCitationLocationLabel(ref = {}) {
    const parts = [];
    if (ref.pageNumber !== null && ref.pageNumber !== undefined && Number.isFinite(Number(ref.pageNumber))) {
        parts.push(`第 ${Number(ref.pageNumber)} 页`);
    }
    if (ref.paragraphIndex !== null && ref.paragraphIndex !== undefined && Number.isFinite(Number(ref.paragraphIndex))) {
        parts.push(`第 ${Number(ref.paragraphIndex)} 段`);
    }
    if (ref.sectionTitle) {
        parts.push(String(ref.sectionTitle));
    }
    return parts.join(' · ');
}

function buildCitationSnippetPreview(ref = {}, maxLength = 160) {
    const rawText = String(ref.snippet || ref.selectionText || '')
        .replace(/\s+/g, ' ')
        .replace(/[`*_>#~]+/g, '')
        .trim();
    if (!rawText) {
        return '';
    }
    return rawText.length > maxLength
        ? `${rawText.slice(0, Math.max(0, maxLength - 1)).trim()}…`
        : rawText;
}

function createCitationPopoverController({
    popoverEl = null,
    documentObj = document,
    windowObj = window,
    positionFloatingElement = () => {},
    escapeHtmlFn = escapeHtml,
    onOpenRef = () => {},
} = {}) {
    let activeAnchor = null;
    let activeMessageId = '';
    let activeRefIndex = -1;
    let activeRef = null;

    function resetAnchorState() {
        if (!activeAnchor || typeof activeAnchor.classList?.remove !== 'function') {
            return;
        }
        activeAnchor.classList.remove('message-citation-chip--active');
        activeAnchor.setAttribute('aria-expanded', 'false');
    }

    function hide() {
        resetAnchorState();
        activeAnchor = null;
        activeMessageId = '';
        activeRefIndex = -1;
        activeRef = null;
        if (!popoverEl) {
            return;
        }
        popoverEl.classList.add('hidden');
        popoverEl.innerHTML = '';
        popoverEl.style.left = '0px';
        popoverEl.style.top = '0px';
        popoverEl.style.visibility = '';
        popoverEl.setAttribute('aria-hidden', 'true');
    }

    function render(ref = {}, refNumber = 1) {
        if (!popoverEl) {
            return;
        }
        const locationLabel = buildCitationLocationLabel(ref);
        const previewText = buildCitationSnippetPreview(ref);
        popoverEl.innerHTML = `
            <div class="message-citation-popover__header">
                <span class="message-citation-popover__badge">${refNumber}</span>
                <strong class="message-citation-popover__title">${escapeHtmlFn(ref.documentName || ref.documentId || '未知文档')}</strong>
            </div>
            ${locationLabel ? `<div class="message-citation-popover__meta">${escapeHtmlFn(locationLabel)}</div>` : ''}
            ${previewText ? `<p class="message-citation-popover__snippet">${escapeHtmlFn(previewText)}</p>` : ''}
            <button type="button" class="message-citation-popover__action" data-citation-open-original="true">打开原文</button>
        `;
        popoverEl.classList.remove('hidden');
        popoverEl.setAttribute('aria-hidden', 'false');
    }

    function show({ anchorElement, messageId = '', refIndex = -1, ref = null } = {}) {
        if (!popoverEl || !anchorElement || !ref) {
            return false;
        }
        resetAnchorState();
        activeAnchor = anchorElement;
        activeMessageId = String(messageId || '');
        activeRefIndex = Number(refIndex);
        activeRef = { ...ref };

        activeAnchor.classList.add('message-citation-chip--active');
        activeAnchor.setAttribute('aria-expanded', 'true');
        if (popoverEl.id) {
            activeAnchor.setAttribute('aria-controls', popoverEl.id);
        }

        render(activeRef, activeRefIndex + 1);
        popoverEl.style.visibility = 'hidden';
        positionFloatingElement(popoverEl, anchorElement.getBoundingClientRect(), 'right', windowObj);
        popoverEl.style.visibility = 'visible';
        return true;
    }

    function toggle({ anchorElement, messageId = '', refIndex = -1, ref = null } = {}) {
        const normalizedMessageId = String(messageId || '');
        const normalizedRefIndex = Number(refIndex);
        if (
            activeAnchor
            && activeMessageId === normalizedMessageId
            && activeRefIndex === normalizedRefIndex
            && activeAnchor === anchorElement
        ) {
            hide();
            return false;
        }
        hide();
        return show({
            anchorElement,
            messageId: normalizedMessageId,
            refIndex: normalizedRefIndex,
            ref,
        });
    }

    function handleDocumentClick(event) {
        if (!activeRef || !popoverEl) {
            return;
        }
        const target = event?.target;
        if (target && (popoverEl.contains(target) || activeAnchor?.contains?.(target))) {
            return;
        }
        hide();
    }

    function handleKeyDown(event) {
        if (!activeRef) {
            return;
        }
        if (event?.key === 'Escape') {
            hide();
        }
    }

    function handleScroll() {
        if (activeRef) {
            hide();
        }
    }

    function isOpen() {
        return Boolean(activeRef);
    }

    function handlePopoverClick(event) {
        const button = event.target?.closest?.('[data-citation-open-original]');
        if (!button || !activeRef) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpenRef({ ...activeRef });
        hide();
    }

    if (popoverEl) {
        popoverEl.addEventListener('click', handlePopoverClick);
        popoverEl.setAttribute('aria-hidden', 'true');
    }

    function destroy() {
        if (popoverEl) {
            popoverEl.removeEventListener('click', handlePopoverClick);
        }
        hide();
    }

    return {
        destroy,
        handleDocumentClick,
        handleKeyDown,
        handleScroll,
        hide,
        isOpen,
        toggle,
    };
}

export {
    assignCitationRefsToBlocks,
    buildCitationLocationLabel,
    buildCitationSnippetPreview,
    collectCitationTargetBlocks,
    compactCitationText,
    computeBigramOverlapRate,
    createCitationPopoverController,
    getLongestSharedSegmentLength,
    normalizeCitationText,
    renderInlineCitationBadges,
    scoreCitationRefAgainstBlock,
};

const {
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_OVERLAP,
} = require('./constants');

function normalizeWhitespace(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\u0000/g, '')
        .trim();
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function createChunk(content, meta = {}) {
    const normalized = normalizeWhitespace(content);
    if (!normalized) {
        return null;
    }

    return {
        content: normalized,
        contentType: meta.contentType || 'plain',
        sectionTitle: meta.sectionTitle || null,
        pageNumber: Number.isFinite(Number(meta.pageNumber)) ? Number(meta.pageNumber) : null,
        paragraphIndex: Number.isFinite(Number(meta.paragraphIndex)) ? Number(meta.paragraphIndex) : null,
        charLength: normalized.length,
    };
}

function splitLongSegment(segment, size, overlap, meta = {}) {
    const chunks = [];
    const cleanSegment = normalizeWhitespace(segment);
    const prefix = meta.prefix ? `${meta.prefix}\n\n` : '';
    const usableSize = Math.max(80, size - prefix.length);
    let start = 0;

    while (start < cleanSegment.length) {
        const end = Math.min(cleanSegment.length, start + usableSize);
        const slice = cleanSegment.slice(start, end).trim();
        const chunk = createChunk(prefix ? `${prefix}${slice}` : slice, meta);
        if (chunk) {
            chunks.push(chunk);
        }
        if (end >= cleanSegment.length) {
            break;
        }
        start = Math.max(end - overlap, start + 1);
    }

    return chunks;
}

function splitSectionBlocks(sectionText) {
    const normalized = normalizeWhitespace(sectionText);
    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function buildChunksFromSections(sections, size, overlap, contentType) {
    const chunks = [];

    for (const section of sections) {
        const blocks = Array.isArray(section.blocks) && section.blocks.length > 0
            ? section.blocks
            : splitSectionBlocks(section.text || '');
        const prefix = section.sectionTitle || '';
        let current = '';

        const flushCurrent = () => {
            const body = current.trim();
            if (!body) {
                current = '';
                return;
            }
            const chunk = createChunk(prefix ? `${prefix}\n\n${body}` : body, {
                contentType,
                sectionTitle: section.sectionTitle || null,
                prefix,
            });
            if (chunk) {
                chunks.push(chunk);
            }
            current = '';
        };

        for (const rawBlock of blocks) {
            const block = normalizeWhitespace(rawBlock);
            if (!block) {
                continue;
            }

            const nextValue = current ? `${current}\n\n${block}` : block;
            const nextWithPrefix = prefix ? `${prefix}\n\n${nextValue}` : nextValue;

            if (nextWithPrefix.length <= size) {
                current = nextValue;
                continue;
            }

            if (current) {
                flushCurrent();
            }

            const singleWithPrefix = prefix ? `${prefix}\n\n${block}` : block;
            if (singleWithPrefix.length <= size) {
                current = block;
                continue;
            }

            chunks.push(...splitLongSegment(block, size, overlap, {
                contentType,
                sectionTitle: section.sectionTitle || null,
                prefix,
            }));
        }

        flushCurrent();
    }

    return chunks.map((chunk, index) => ({
        index,
        ...chunk,
    }));
}

function buildChunksFromParagraphEntries(entries, size, overlap, contentType) {
    const chunks = [];
    const normalizedEntries = Array.isArray(entries)
        ? entries
            .map((entry) => ({
                ...entry,
                text: normalizeWhitespace(entry?.text || ''),
            }))
            .filter((entry) => entry.text)
        : [];

    if (normalizedEntries.length === 0) {
        return [];
    }

    let currentEntries = [];
    let currentLength = 0;

    const flushCurrent = () => {
        if (currentEntries.length === 0) {
            return;
        }

        const firstEntry = currentEntries[0];
        const sectionTitle = firstEntry.sectionTitle || null;
        const content = currentEntries.map((entry) => entry.text).join('\n\n');
        const chunk = createChunk(sectionTitle ? `${sectionTitle}\n\n${content}` : content, {
            contentType,
            sectionTitle,
            pageNumber: firstEntry.pageNumber ?? null,
            paragraphIndex: firstEntry.paragraphIndex ?? null,
        });
        if (chunk) {
            chunks.push(chunk);
        }

        currentEntries = [];
        currentLength = 0;
    };

    normalizedEntries.forEach((entry) => {
        const prefix = entry.sectionTitle ? `${entry.sectionTitle}\n\n` : '';
        const nextLength = currentLength === 0
            ? prefix.length + entry.text.length
            : currentLength + 2 + entry.text.length;

        if (nextLength <= size) {
            currentEntries.push(entry);
            currentLength = nextLength;
            return;
        }

        if (currentEntries.length > 0) {
            flushCurrent();
        }

        if ((prefix.length + entry.text.length) <= size) {
            currentEntries.push(entry);
            currentLength = prefix.length + entry.text.length;
            return;
        }

        const splitChunks = splitLongSegment(entry.text, size, overlap, {
            contentType,
            sectionTitle: entry.sectionTitle || null,
            prefix: entry.sectionTitle || '',
            pageNumber: entry.pageNumber ?? null,
            paragraphIndex: entry.paragraphIndex ?? null,
        });
        chunks.push(...splitChunks);
    });

    flushCurrent();

    return chunks.map((chunk, index) => ({
        index,
        ...chunk,
    }));
}

function chunkPlainText(text, size, overlap, contentType) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
        return [];
    }

    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);

    const sections = [{
        sectionTitle: null,
        blocks: paragraphs,
    }];

    return buildChunksFromSections(sections, size, overlap, contentType);
}

function chunkMarkdown(text, size, overlap) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
        return [];
    }

    const lines = normalized.split('\n');
    const sections = [];
    let currentSection = {
        sectionTitle: null,
        blocks: [],
    };
    let blockLines = [];
    let inCodeFence = false;

    const flushBlock = () => {
        const block = blockLines.join('\n').trim();
        if (block) {
            currentSection.blocks.push(block);
        }
        blockLines = [];
    };

    const flushSection = () => {
        flushBlock();
        if (currentSection.blocks.length > 0 || currentSection.sectionTitle) {
            sections.push(currentSection);
        }
        currentSection = {
            sectionTitle: null,
            blocks: [],
        };
    };

    for (const line of lines) {
        if (/^```/.test(line.trim())) {
            inCodeFence = !inCodeFence;
            blockLines.push(line);
            continue;
        }

        if (!inCodeFence) {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                flushSection();
                currentSection.sectionTitle = `${headingMatch[1]} ${headingMatch[2].trim()}`;
                continue;
            }

            if (!line.trim()) {
                flushBlock();
                continue;
            }
        }

        blockLines.push(line);
    }

    flushSection();

    if (sections.length === 0) {
        sections.push({
            sectionTitle: null,
            blocks: splitSectionBlocks(normalized),
        });
    }

    return buildChunksFromSections(sections, size, overlap, 'markdown');
}

function htmlToSections(html) {
    const cleaned = String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|section|article|ul|ol|pre|table|blockquote|li)>/gi, '$&\n\n')
        .replace(/<(br|hr)\s*\/?>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<(h[1-6])\b[^>]*>/gi, '\n\n<$1>')
        .replace(/<\/(h[1-6])>/gi, '</$1>\n');

    const tagRegex = /<(h[1-6]|p|li|pre|code|blockquote|td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    const sections = [];
    let currentSection = {
        sectionTitle: null,
        blocks: [],
    };

    const pushCurrentSection = () => {
        if (currentSection.sectionTitle || currentSection.blocks.length > 0) {
            sections.push(currentSection);
        }
        currentSection = {
            sectionTitle: null,
            blocks: [],
        };
    };

    let match = tagRegex.exec(cleaned);
    while (match) {
        const tag = match[1].toLowerCase();
        const inner = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
        if (inner) {
            if (tag.startsWith('h')) {
                pushCurrentSection();
                currentSection.sectionTitle = inner;
            } else {
                currentSection.blocks.push(inner);
            }
        }
        match = tagRegex.exec(cleaned);
    }

    pushCurrentSection();

    if (sections.length > 0) {
        return sections;
    }

    const plain = decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return [{
        sectionTitle: null,
        blocks: splitSectionBlocks(plain),
    }];
}

function chunkHtml(text, size, overlap) {
    const sections = htmlToSections(text);
    return buildChunksFromSections(sections, size, overlap, 'html');
}

function chunkStructuredPdf(structure, size, overlap) {
    const entries = [];
    const pages = Array.isArray(structure?.pages) ? structure.pages : [];
    pages.forEach((page) => {
        const pageNumber = Number(page?.pageNumber) || null;
        const paragraphs = Array.isArray(page?.paragraphs) ? page.paragraphs : [];
        paragraphs.forEach((paragraph) => {
            entries.push({
                text: paragraph?.text || '',
                pageNumber,
                paragraphIndex: paragraph?.index ?? null,
                sectionTitle: null,
            });
        });
    });
    return buildChunksFromParagraphEntries(entries, size, overlap, 'pdf-text');
}

function chunkStructuredDocx(structure, size, overlap) {
    const paragraphs = Array.isArray(structure?.paragraphs) ? structure.paragraphs : [];
    const entries = paragraphs.map((paragraph) => ({
        text: paragraph?.text || '',
        pageNumber: null,
        paragraphIndex: paragraph?.index ?? null,
        sectionTitle: paragraph?.sectionTitle || null,
    }));
    return buildChunksFromParagraphEntries(entries, size, overlap, 'docx-text');
}

function chunkText(text, options = {}) {
    const size = Number(options.size) > 0 ? Number(options.size) : DEFAULT_CHUNK_SIZE;
    const overlap = Number(options.overlap) >= 0 ? Number(options.overlap) : DEFAULT_CHUNK_OVERLAP;
    const contentType = String(options.contentType || 'plain').trim() || 'plain';
    const structure = options.structure || null;

    if (contentType === 'pdf-text' && structure?.type === 'pdf') {
        return chunkStructuredPdf(structure, size, overlap);
    }

    if (contentType === 'docx-text' && structure?.type === 'docx') {
        return chunkStructuredDocx(structure, size, overlap);
    }

    if (contentType === 'markdown') {
        return chunkMarkdown(text, size, overlap);
    }

    if (contentType === 'html') {
        return chunkHtml(text, size, overlap);
    }

    return chunkPlainText(text, size, overlap, contentType);
}

module.exports = {
    chunkText,
    htmlToSections,
};

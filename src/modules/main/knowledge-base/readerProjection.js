const { htmlToSections } = require('./chunking');

function splitReaderParagraphs(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function buildParagraphView(paragraphs = []) {
    let paragraphIndex = 1;
    return {
        type: 'text',
        paragraphs: paragraphs
            .map((paragraph) => {
                const text = String(paragraph?.text || '').trim();
                if (!text) {
                    return null;
                }
                return {
                    index: paragraphIndex++,
                    sectionTitle: paragraph?.sectionTitle || null,
                    text,
                };
            })
            .filter(Boolean),
    };
}

function buildMarkdownReaderView(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const paragraphs = [];
    let currentSectionTitle = null;
    let currentBlock = [];
    let inCodeFence = false;

    const flushBlock = () => {
        const blockText = currentBlock.join('\n').trim();
        if (blockText) {
            paragraphs.push({
                sectionTitle: currentSectionTitle,
                text: blockText,
            });
        }
        currentBlock = [];
    };

    for (const line of lines) {
        if (/^```/.test(line.trim())) {
            inCodeFence = !inCodeFence;
            currentBlock.push(line);
            continue;
        }

        if (!inCodeFence) {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                flushBlock();
                currentSectionTitle = `${headingMatch[1]} ${headingMatch[2].trim()}`;
                continue;
            }

            if (!line.trim()) {
                flushBlock();
                continue;
            }
        }

        currentBlock.push(line);
    }

    flushBlock();
    return buildParagraphView(paragraphs);
}

function buildPlainReaderView(text) {
    return buildParagraphView(
        splitReaderParagraphs(text).map((paragraphText) => ({
            sectionTitle: null,
            text: paragraphText,
        })),
    );
}

function buildHtmlReaderView(text) {
    const sections = htmlToSections(text);
    const paragraphs = [];
    sections.forEach((section) => {
        const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
        blocks.forEach((blockText) => {
            paragraphs.push({
                sectionTitle: section?.sectionTitle || null,
                text: blockText,
            });
        });
    });
    return buildParagraphView(paragraphs);
}

function buildReaderViewFromParsedDocument(parsed) {
    if (parsed?.structure?.type === 'pdf' || parsed?.structure?.type === 'docx') {
        return {
            type: parsed.structure.type,
            contentType: parsed.contentType,
            ...(parsed.structure || {}),
        };
    }

    if (parsed?.contentType === 'markdown') {
        return {
            contentType: parsed.contentType,
            ...buildMarkdownReaderView(parsed.text),
        };
    }

    if (parsed?.contentType === 'html') {
        return {
            contentType: parsed.contentType,
            ...buildHtmlReaderView(parsed.text),
        };
    }

    return {
        contentType: parsed?.contentType || 'plain',
        ...buildPlainReaderView(parsed?.text || ''),
    };
}

module.exports = {
    splitReaderParagraphs,
    buildParagraphView,
    buildMarkdownReaderView,
    buildPlainReaderView,
    buildHtmlReaderView,
    buildReaderViewFromParsedDocument,
};

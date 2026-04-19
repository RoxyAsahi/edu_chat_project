const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fileManager = require('../fileManager');
const {
    KB_UNSUPPORTED_OCR_ERROR,
    KB_IMAGE_TRANSCRIPTION_PENDING_ERROR,
    SUPPORTED_MIME_TYPES,
    SUPPORTED_IMAGE_MIME_TYPES,
    SUPPORTED_TEXT_MIME_PREFIX,
} = require('./constants');
const { htmlToSections } = require('./chunking');

function inferMimeType(document) {
    const mimeType = String(document?.mimeType || '').trim();
    if (mimeType) {
        return mimeType;
    }

    const ext = path.extname(String(document?.name || '')).toLowerCase();
    switch (ext) {
        case '.md':
            return 'text/markdown';
        case '.txt':
        case '.js':
        case '.ts':
        case '.tsx':
        case '.jsx':
        case '.json':
        case '.yaml':
        case '.yml':
        case '.css':
        case '.sql':
            return 'text/plain';
        case '.html':
            return 'text/html';
        case '.xml':
            return 'application/xml';
        case '.csv':
            return 'text/csv';
        case '.pdf':
            return 'application/pdf';
        case '.docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        default:
            return mimeType || 'application/octet-stream';
    }
}

function isSupportedMimeType(mimeType) {
    return mimeType.startsWith(SUPPORTED_TEXT_MIME_PREFIX)
        || SUPPORTED_MIME_TYPES.has(mimeType)
        || SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

function isImageMimeType(mimeType = '') {
    return SUPPORTED_IMAGE_MIME_TYPES.has(String(mimeType || '').trim().toLowerCase());
}

function resolveDocumentContentType(mimeType) {
    if (mimeType === 'text/markdown') {
        return 'markdown';
    }

    if (mimeType === 'text/html' || mimeType === 'application/xml') {
        return 'html';
    }

    if (mimeType === 'application/pdf') {
        return 'pdf-text';
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return 'docx-text';
    }

    if (isImageMimeType(mimeType)) {
        return 'markdown';
    }

    return 'plain';
}

function splitParagraphs(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((part) => part.replace(/\u0000/g, '').trim())
        .filter(Boolean);
}

async function parsePdfStructure(storedPath) {
    const dataBuffer = await require('fs-extra').readFile(storedPath);
    const pages = [];
    let pageCounter = 0;

    const renderPage = (pageData) => {
        const currentPage = pageCounter + 1;
        const renderOptions = {
            normalizeWhitespace: false,
            disableCombineTextItems: false,
        };

        return pageData.getTextContent(renderOptions)
            .then((textContent) => {
                let lastY;
                let text = '';
                for (const item of textContent.items) {
                    if (lastY == null || lastY === item.transform[5]) {
                        text += item.str;
                    } else {
                        text += `\n${item.str}`;
                    }
                    lastY = item.transform[5];
                }
                const normalized = String(text || '').trim();
                pages.push({
                    pageNumber: currentPage,
                    text: normalized,
                });
                pageCounter += 1;
                return normalized;
            });
    };

    const result = await pdf(dataBuffer, { pagerender: renderPage });
    const resolvedPages = pages.length > 0
        ? pages
        : splitParagraphs(result?.text || '').map((text, index) => ({
            pageNumber: index + 1,
            text,
        }));

    let paragraphIndex = 1;
    const structuredPages = resolvedPages.map((page) => {
        const paragraphs = splitParagraphs(page.text).map((paragraphText) => ({
            index: paragraphIndex++,
            text: paragraphText,
        }));

        return {
            pageNumber: page.pageNumber,
            text: page.text,
            paragraphs,
        };
    }).filter((page) => page.paragraphs.length > 0);

    const fullText = structuredPages
        .map((page) => page.paragraphs.map((paragraph) => paragraph.text).join('\n\n'))
        .join('\n\n');

    return {
        text: fullText.trim(),
        structure: {
            type: 'pdf',
            totalPages: Number(result?.numpages || structuredPages.length || 0),
            pages: structuredPages,
        },
    };
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

async function parseDocxStructure(storedPath) {
    const result = await mammoth.convertToHtml({ path: storedPath });
    const html = String(result?.value || '').trim();
    const sections = htmlToSections(html);
    const paragraphs = [];
    let paragraphIndex = 1;

    sections.forEach((section) => {
        const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
        blocks.forEach((blockText) => {
            const normalized = stripHtml(blockText);
            if (!normalized) {
                return;
            }
            paragraphs.push({
                index: paragraphIndex++,
                sectionTitle: section?.sectionTitle || null,
                text: normalized,
            });
        });
    });

    if (paragraphs.length === 0) {
        const rawTextResult = await mammoth.extractRawText({ path: storedPath });
        splitParagraphs(rawTextResult?.value || '').forEach((paragraphText) => {
            paragraphs.push({
                index: paragraphIndex++,
                sectionTitle: null,
                text: paragraphText,
            });
        });
    }

    const text = paragraphs.map((paragraph) => paragraph.text).join('\n\n').trim();

    return {
        text,
        structure: {
            type: 'docx',
            paragraphs,
        },
    };
}

async function parseKnowledgeBaseDocument(document) {
    const mimeType = inferMimeType(document);
    if (!isSupportedMimeType(mimeType)) {
        throw new Error(KB_UNSUPPORTED_OCR_ERROR);
    }

    if (isImageMimeType(mimeType)) {
        const extractedText = String(document?.extractedText || '').trim();
        if (!extractedText) {
            throw new Error(KB_IMAGE_TRANSCRIPTION_PENDING_ERROR);
        }

        return {
            mimeType,
            contentType: document?.extractedContentType || document?.contentType || 'markdown',
            text: extractedText,
            structure: null,
        };
    }

    const contentType = resolveDocumentContentType(mimeType);
    let parsed = null;

    if (mimeType === 'application/pdf') {
        parsed = await parsePdfStructure(document.storedPath);
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        parsed = await parseDocxStructure(document.storedPath);
    } else {
        const result = await fileManager.getTextContent(document.storedPath, mimeType);
        if (Array.isArray(result?.imageFrames) && result.imageFrames.length > 0) {
            throw new Error(KB_UNSUPPORTED_OCR_ERROR);
        }

        const text = typeof result?.text === 'string' ? result.text.trim() : '';
        if (!text) {
            throw new Error(KB_UNSUPPORTED_OCR_ERROR);
        }

        parsed = {
            text,
            structure: null,
        };
    }

    return {
        mimeType,
        contentType,
        text: parsed.text,
        structure: parsed.structure,
    };
}

module.exports = {
    inferMimeType,
    isImageMimeType,
    parseKnowledgeBaseDocument,
    resolveDocumentContentType,
};

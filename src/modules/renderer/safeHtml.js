const DEFAULT_ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|blob|data|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

function resolvePurifier(explicitPurifier) {
    if (explicitPurifier && typeof explicitPurifier.sanitize === 'function') {
        return explicitPurifier;
    }

    if (typeof globalThis !== 'undefined' && globalThis.DOMPurify && typeof globalThis.DOMPurify.sanitize === 'function') {
        return globalThis.DOMPurify;
    }

    return null;
}

function sanitizeHtml(html, options = {}) {
    const purifier = resolvePurifier(options.purifier);
    const unsafeHtml = String(html || '');
    if (!purifier) {
        return unsafeHtml;
    }

    return purifier.sanitize(unsafeHtml, {
        ALLOWED_URI_REGEXP: DEFAULT_ALLOWED_URI_REGEXP,
        ...options.config,
    });
}

function renderMarkdownToSafeHtml(markdown, markedLike, options = {}) {
    const source = String(markdown || '');
    const rendered = markedLike && typeof markedLike.parse === 'function'
        ? markedLike.parse(source)
        : source;

    return sanitizeHtml(rendered, options);
}

export {
    DEFAULT_ALLOWED_URI_REGEXP,
    renderMarkdownToSafeHtml,
    sanitizeHtml,
};

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createMarkdownFragmentRenderer({ renderMarkdownToSafeHtml, getMarkedInstance }) {
    return function renderMarkdownFragment(text) {
        const markdown = String(text || '').trim();
        if (!markdown) {
            return '';
        }

        return renderMarkdownToSafeHtml(
            markdown,
            getMarkedInstance() || {
                parse(value) {
                    return `<p>${escapeHtml(value)}</p>`;
                },
            },
        );
    };
}

function createMarkedInitializer(windowObj) {
    return function initMarked() {
        if (windowObj.marked && typeof windowObj.marked.Marked === 'function') {
            return new windowObj.marked.Marked({
                gfm: true,
                tables: true,
                breaks: true,
                pedantic: false,
                sanitize: false,
                smartLists: true,
                smartypants: false,
                highlight(code, lang) {
                    if (windowObj.hljs) {
                        const language = windowObj.hljs.getLanguage(lang) ? lang : 'plaintext';
                        return windowObj.hljs.highlight(code, { language }).value;
                    }
                    return code;
                },
            });
        }

        return {
            parse(text) {
                return `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`;
            },
        };
    };
}

function normalizeTopic(topic = {}) {
    return {
        ...topic,
        knowledgeBaseId: topic.knowledgeBaseId || null,
        selectedKnowledgeBaseDocumentIds: Array.isArray(topic.selectedKnowledgeBaseDocumentIds)
            ? topic.selectedKnowledgeBaseDocumentIds
            : null,
    };
}

function extractPromptTextFromConfig(config = {}) {
    if (typeof config.originalSystemPrompt === 'string' && config.originalSystemPrompt.trim()) {
        return config.originalSystemPrompt;
    }

    if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
        return config.systemPrompt;
    }

    return '';
}

export {
    createMarkdownFragmentRenderer,
    createMarkedInitializer,
    extractPromptTextFromConfig,
    normalizeTopic,
};

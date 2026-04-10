const { normalizeEmbeddingEndpoint } = require('../knowledge-base/embeddings');
const { normalizeRerankEndpoint } = require('../knowledge-base/rerank');

function normalizeChatEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        throw new Error('VCP endpoint is required.');
    }

    return new URL(endpoint.trim()).toString();
}

function buildInterruptEndpoint(endpoint) {
    const url = new URL(endpoint);
    url.pathname = '/v1/interrupt';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function describeUpstreamCapabilities(settings = {}) {
    const warnings = [];
    const chatEndpoint = String(settings?.vcpServerUrl || '').trim();
    const kbBaseUrl = String(settings?.kbBaseUrl || '').trim();

    const capabilities = {
        chat: {
            supported: false,
            endpoint: null,
            protocol: 'openai-chat-completions-compatible',
        },
        stream: {
            supported: false,
            transport: 'http-stream',
        },
        interrupt: {
            supported: false,
            endpoint: null,
            strategy: 'local-first-remote-best-effort',
        },
        embeddings: {
            supported: false,
            endpoint: null,
            protocol: 'openai-embeddings-compatible',
        },
        rerank: {
            supported: false,
            endpoint: null,
            protocol: 'rerank-compatible',
        },
        guideGeneration: {
            supported: false,
            dependency: 'chat',
        },
        warnings,
    };

    if (chatEndpoint) {
        try {
            const normalizedChatEndpoint = normalizeChatEndpoint(chatEndpoint);
            capabilities.chat.supported = true;
            capabilities.chat.endpoint = normalizedChatEndpoint;
            capabilities.stream.supported = true;
            capabilities.interrupt.supported = true;
            capabilities.interrupt.endpoint = buildInterruptEndpoint(normalizedChatEndpoint);
            capabilities.guideGeneration.supported = true;
        } catch (error) {
            warnings.push(`Invalid vcpServerUrl: ${error.message}`);
        }
    }

    if (kbBaseUrl) {
        try {
            const embeddingsEndpoint = normalizeEmbeddingEndpoint(kbBaseUrl);
            capabilities.embeddings.supported = true;
            capabilities.embeddings.endpoint = embeddingsEndpoint;
        } catch (error) {
            warnings.push(`Invalid kbBaseUrl for embeddings: ${error.message}`);
        }

        try {
            const rerankEndpoint = normalizeRerankEndpoint(kbBaseUrl);
            capabilities.rerank.supported = true;
            capabilities.rerank.endpoint = rerankEndpoint;
        } catch (error) {
            warnings.push(`Invalid kbBaseUrl for rerank: ${error.message}`);
        }
    }

    return capabilities;
}

module.exports = {
    buildInterruptEndpoint,
    describeUpstreamCapabilities,
    normalizeChatEndpoint,
};

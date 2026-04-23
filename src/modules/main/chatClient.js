const DEFAULT_TIMEOUT_MS = 300000;
const STREAM_CHANNEL = 'chat-stream-event';
const {
    logOutboundRequest,
    logUpstreamRawReply,
} = require('./study/chatDebugLogger');

const activeRequests = new Map();

let moduleConfig = {
    settingsManager: null,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
};

function initialize(config = {}) {
    const envTimeoutMs = Number(process.env.UNISTUDY_CHAT_TIMEOUT_MS);
    moduleConfig = {
        settingsManager: config.settingsManager || null,
        defaultTimeoutMs: Number(config.defaultTimeoutMs) > 0
            ? Number(config.defaultTimeoutMs)
            : envTimeoutMs > 0
                ? envTimeoutMs
            : DEFAULT_TIMEOUT_MS,
    };
    console.log('[ChatClient] Initialized.');
}

async function readSettings() {
    if (!moduleConfig.settingsManager || typeof moduleConfig.settingsManager.readSettings !== 'function') {
        return {};
    }

    try {
        return await moduleConfig.settingsManager.readSettings();
    } catch (error) {
        console.error('[ChatClient] Failed to read settings:', error);
        return {};
    }
}

function normalizeEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        throw new Error('Chat endpoint is required.');
    }

    return new URL(endpoint.trim()).toString();
}

function buildRequestHeaders(apiKey = '', extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(
            extraHeaders
            && typeof extraHeaders === 'object'
            && !Array.isArray(extraHeaders)
                ? extraHeaders
                : {}
        ),
    };

    const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (normalizedApiKey) {
        headers.Authorization = `Bearer ${normalizedApiKey}`;
    } else {
        delete headers.Authorization;
    }

    return headers;
}

function normalizeMessage(message) {
    if (!message || typeof message !== 'object') {
        return { role: 'system', content: '[Invalid message]' };
    }

    let content = message.content;

    if (content && typeof content === 'object' && !Array.isArray(content)) {
        if (typeof content.text === 'string') {
            content = content.text;
        } else {
            content = JSON.stringify(content);
        }
    }

    if (content !== undefined && !Array.isArray(content) && typeof content !== 'string') {
        content = String(content);
    }

    const normalized = {
        role: message.role,
        content,
    };

    if (message.name) normalized.name = message.name;
    if (message.tool_calls) normalized.tool_calls = message.tool_calls;
    if (message.tool_call_id) normalized.tool_call_id = message.tool_call_id;
    if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
        normalized.reasoning_content = message.reasoning_content;
    }

    return normalized;
}

function normalizeMessages(messages) {
    if (!Array.isArray(messages)) {
        throw new Error('Messages must be an array.');
    }

    return messages.map(normalizeMessage);
}

function extractTextFromCandidate(candidate) {
    if (typeof candidate === 'string') {
        return candidate;
    }

    if (Array.isArray(candidate)) {
        return candidate
            .map((part) => extractTextFromCandidate(part?.text ?? part?.content ?? part))
            .filter(Boolean)
            .join('');
    }

    if (candidate && typeof candidate === 'object') {
        if (typeof candidate.text === 'string') {
            return candidate.text;
        }
        if (typeof candidate.content === 'string') {
            return candidate.content;
        }
        if (Array.isArray(candidate.content)) {
            return extractTextFromCandidate(candidate.content);
        }
    }

    return '';
}

function extractTextDelta(chunk) {
    const candidates = [
        chunk?.choices?.[0]?.delta?.content,
        chunk?.choices?.[0]?.message?.content,
        chunk?.delta?.content,
        chunk?.content,
        chunk?.message?.content,
    ];

    for (const candidate of candidates) {
        const text = extractTextFromCandidate(candidate);
        if (text) {
            return text;
        }
    }

    return '';
}

function extractReasoningDelta(chunk) {
    const candidates = [
        chunk?.choices?.[0]?.delta?.reasoning_content,
        chunk?.choices?.[0]?.delta?.reasoning,
        chunk?.choices?.[0]?.message?.reasoning_content,
        chunk?.choices?.[0]?.message?.reasoning,
        chunk?.delta?.reasoning_content,
        chunk?.delta?.reasoning,
        chunk?.message?.reasoning_content,
        chunk?.message?.reasoning,
        chunk?.reasoning_content,
        chunk?.reasoning,
    ];

    for (const candidate of candidates) {
        const text = extractTextFromCandidate(candidate);
        if (text) {
            return text;
        }
    }

    return '';
}

function extractFinishReason(chunk) {
    return chunk?.choices?.[0]?.finish_reason
        || chunk?.finish_reason
        || chunk?.finishReason
        || null;
}

async function parseErrorResponse(response) {
    const errorText = await response.text().catch(() => '');
    let errorData = { message: `Server returned status ${response.status}`, details: errorText };

    try {
        const parsed = JSON.parse(errorText);
        if (parsed && typeof parsed === 'object') {
            errorData = parsed;
        }
    } catch (_error) {
        // Ignore plain-text error bodies.
    }

    let errorMessage = '';
    if (typeof errorData?.message === 'string') {
        errorMessage = errorData.message;
    } else if (typeof errorData?.error === 'string') {
        errorMessage = errorData.error;
    } else if (typeof errorData?.error?.message === 'string') {
        errorMessage = errorData.error.message;
    } else if (errorData?.error && typeof errorData.error === 'object') {
        errorMessage = JSON.stringify(errorData.error);
    } else if (typeof errorData === 'string') {
        errorMessage = errorData;
    } else {
        errorMessage = 'Unknown server error';
    }

    return {
        errorData,
        errorMessage,
        formattedMessage: `Chat request failed: ${response.status} - ${errorMessage}`,
    };
}

function normalizeCapabilityList(requiredCapability = '') {
    const values = Array.isArray(requiredCapability)
        ? requiredCapability
        : [requiredCapability];
    return [...new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
}

function buildExecutionComparisonTarget(execution = {}, fallback = {}) {
    const endpoint = typeof execution?.endpoint === 'string' && execution.endpoint.trim()
        ? execution.endpoint.trim()
        : (typeof fallback?.endpoint === 'string' ? fallback.endpoint.trim() : '');
    const apiKey = typeof execution?.apiKey === 'string' && execution.apiKey.trim()
        ? execution.apiKey.trim()
        : (typeof fallback?.apiKey === 'string' ? fallback.apiKey.trim() : '');
    const modelId = typeof execution?.model?.id === 'string' && execution.model.id.trim()
        ? execution.model.id.trim()
        : (typeof fallback?.modelId === 'string' ? fallback.modelId.trim() : '');
    const extraHeaders = execution?.extraHeaders && typeof execution.extraHeaders === 'object' && !Array.isArray(execution.extraHeaders)
        ? execution.extraHeaders
        : (fallback?.extraHeaders && typeof fallback.extraHeaders === 'object' && !Array.isArray(fallback.extraHeaders)
            ? fallback.extraHeaders
            : {});

    return {
        providerId: typeof execution?.ref?.providerId === 'string' ? execution.ref.providerId : '',
        modelId,
        endpoint,
        apiKey,
        extraHeaders,
    };
}

function buildExecutionDescriptor(execution = {}, fallback = {}) {
    const comparable = buildExecutionComparisonTarget(execution, fallback);
    return {
        providerId: comparable.providerId,
        modelId: comparable.modelId,
        endpoint: comparable.endpoint,
    };
}

function areExecutionTargetsEquivalent(primaryExecution = {}, fallbackExecution = {}) {
    const primary = buildExecutionComparisonTarget(primaryExecution);
    const fallback = buildExecutionComparisonTarget(fallbackExecution);
    return String(primary?.endpoint || '') === String(fallback?.endpoint || '')
        && String(primary?.apiKey || '') === String(fallback?.apiKey || '')
        && String(primary?.modelId || '') === String(fallback?.modelId || '')
        && String(primary?.providerId || '') === String(fallback?.providerId || '')
        && JSON.stringify(primary?.extraHeaders || {}) === JSON.stringify(fallback?.extraHeaders || {});
}

function createFallbackMeta(primary = {}, fallback = null) {
    return {
        attempted: false,
        used: false,
        skippedReason: '',
        trigger: null,
        primary: buildExecutionDescriptor(primary),
        fallback: fallback ? buildExecutionDescriptor(fallback) : null,
    };
}

function isRetryableStatusCode(statusCode = 0) {
    const code = Number(statusCode);
    return code === 401
        || code === 403
        || code === 408
        || code === 429
        || code >= 500;
}

function buildHttpFailureMeta(statusCode = 0, errorMessage = '') {
    return {
        retryable: isRetryableStatusCode(statusCode),
        trigger: {
            type: 'http_error',
            statusCode: Number(statusCode) || 0,
            error: errorMessage || '',
        },
    };
}

function buildRuntimeFailureMeta(error, requestState) {
    if (error?.name === 'AbortError') {
        if (requestState?.timedOut === true) {
            return {
                retryable: true,
                trigger: {
                    type: 'timeout',
                    error: 'Request timed out.',
                },
            };
        }
        return {
            retryable: false,
            trigger: {
                type: 'cancelled',
                error: 'Request cancelled.',
            },
        };
    }

    return {
        retryable: true,
        trigger: {
            type: 'network_error',
            error: error?.message || 'Unknown network error',
        },
    };
}

function resolveFallbackSkipReason({
    primaryExecution = null,
    fallbackExecution = null,
    fallbackMeta = null,
    requiredCapability = '',
}) {
    if (!fallbackExecution?.endpoint || !fallbackExecution?.model?.id) {
        if (fallbackMeta) {
            fallbackMeta.skippedReason = 'not-configured';
        }
        return 'not-configured';
    }

    const requiredCapabilities = normalizeCapabilityList(requiredCapability);
    if (requiredCapabilities.length > 0) {
        const capabilities = fallbackExecution?.model?.capabilities || {};
        const isCompatible = requiredCapabilities.every((capability) => capabilities?.[capability] === true);
        if (!isCompatible) {
            if (fallbackMeta) {
                fallbackMeta.skippedReason = 'incompatible-capability';
            }
            return 'incompatible-capability';
        }
    }

    if (primaryExecution && fallbackExecution && areExecutionTargetsEquivalent(primaryExecution, fallbackExecution)) {
        fallbackMeta.skippedReason = 'same-target';
        return 'same-target';
    }

    return '';
}

function createRequestState({
    requestId,
    endpoint,
    apiKey,
    extraHeaders,
    context,
    webContents,
    streamChannel,
    onStreamEnd,
    timeoutMs,
    fallbackMeta = null,
}) {
    const requestState = {
        requestId,
        endpoint,
        apiKey,
        extraHeaders,
        controller: new AbortController(),
        context,
        webContents,
        streamChannel,
        onStreamEnd,
        accumulatedResponse: '',
        accumulatedReasoning: '',
        finishReason: null,
        interrupted: false,
        timedOut: false,
        terminalSent: false,
        cleanedUp: false,
        timeoutId: null,
        fallbackMeta,
    };

    requestState.timeoutId = setTimeout(() => {
        requestState.timedOut = true;
        requestState.controller.abort();
    }, Number(timeoutMs) > 0 ? Number(timeoutMs) : moduleConfig.defaultTimeoutMs);

    activeRequests.set(requestId, requestState);
    return requestState;
}

function buildRequestAttemptBody(normalizedMessages, modelConfig, requestId) {
    return {
        messages: normalizedMessages,
        ...modelConfig,
        stream: modelConfig.stream === true,
        requestId,
    };
}

function emitStreamEvent(webContents, payload, channel = STREAM_CHANNEL) {
    if (!webContents || webContents.isDestroyed()) {
        return;
    }

    webContents.send(channel, payload);
}

function invokeFinalizeCallback(requestState, payload) {
    if (typeof requestState.onStreamEnd !== 'function') {
        return;
    }

    try {
        if (payload.type === 'end') {
            requestState.onStreamEnd({
                success: true,
                requestId: requestState.requestId,
                context: requestState.context,
                content: payload.fullResponse || '',
                reasoningContent: payload.reasoning_content || '',
                finishReason: payload.finishReason,
                interrupted: payload.interrupted === true,
                timedOut: payload.timedOut === true,
                fallbackMeta: payload.fallbackMeta || requestState.fallbackMeta || null,
            });
            return;
        }

        requestState.onStreamEnd({
            success: false,
            requestId: requestState.requestId,
            context: requestState.context,
            content: payload.partialResponse || '',
            reasoningContent: payload.reasoning_content || '',
            error: payload.error,
            interrupted: payload.interrupted === true,
            timedOut: payload.timedOut === true,
            fallbackMeta: payload.fallbackMeta || requestState.fallbackMeta || null,
        });
    } catch (error) {
        console.error('[ChatClient] onStreamEnd callback failed:', error);
    }
}

function emitTerminalEvent(requestState, payload) {
    if (requestState.terminalSent) {
        return;
    }

    requestState.terminalSent = true;
    emitStreamEvent(requestState.webContents, payload, requestState.streamChannel);
    invokeFinalizeCallback(requestState, payload);
}

function cleanupRequest(requestState) {
    if (!requestState || requestState.cleanedUp) {
        return;
    }

    requestState.cleanedUp = true;

    if (requestState.timeoutId) {
        clearTimeout(requestState.timeoutId);
        requestState.timeoutId = null;
    }

    activeRequests.delete(requestState.requestId);
}

async function processStreamResponse(response, requestState) {
    const reader = response.body?.getReader();
    if (!reader) {
        cleanupRequest(requestState);
        emitTerminalEvent(requestState, {
            type: 'error',
            requestId: requestState.requestId,
            context: requestState.context,
            error: 'Streaming response did not contain a readable body.',
            partialResponse: '',
            interrupted: false,
            timedOut: false,
        });
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (value) {
                buffer += decoder.decode(value, { stream: !done });
            }

            const lines = buffer.split(/\r?\n/);
            buffer = done ? '' : lines.pop();

            for (const line of lines) {
                if (!line || !line.trim() || !line.startsWith('data:')) {
                    continue;
                }

                const jsonData = line.slice(5).trim();
                if (!jsonData) {
                    continue;
                }

                if (jsonData === '[DONE]') {
                    emitTerminalEvent(requestState, {
                        type: 'end',
                        requestId: requestState.requestId,
                        context: requestState.context,
                        fullResponse: requestState.accumulatedResponse,
                        reasoning_content: requestState.accumulatedReasoning,
                        finishReason: requestState.finishReason || 'completed',
                        interrupted: false,
                        timedOut: false,
                        fallbackMeta: requestState.fallbackMeta || null,
                    });
                    return;
                }

                try {
                    const parsedChunk = JSON.parse(jsonData);
                    const textDelta = extractTextDelta(parsedChunk);
                    const reasoningDelta = extractReasoningDelta(parsedChunk);
                    if (textDelta) {
                        requestState.accumulatedResponse += textDelta;
                    }
                    if (reasoningDelta) {
                        requestState.accumulatedReasoning += reasoningDelta;
                    }

                    const finishReason = extractFinishReason(parsedChunk);
                    if (finishReason) {
                        requestState.finishReason = finishReason;
                    }

                    emitStreamEvent(requestState.webContents, {
                        type: 'data',
                        requestId: requestState.requestId,
                        context: requestState.context,
                        chunk: parsedChunk,
                        textDelta,
                        reasoningDelta,
                        hasRenderableText: Boolean(textDelta),
                        hasRenderableReasoning: Boolean(reasoningDelta),
                    }, requestState.streamChannel);
                } catch (_error) {
                    emitStreamEvent(requestState.webContents, {
                        type: 'data',
                        requestId: requestState.requestId,
                        context: requestState.context,
                        chunk: { raw: jsonData, error: 'json_parse_error' },
                        textDelta: '',
                        reasoningDelta: '',
                        hasRenderableText: false,
                        hasRenderableReasoning: false,
                    }, requestState.streamChannel);
                }
            }

            if (done) {
                emitTerminalEvent(requestState, {
                    type: 'end',
                    requestId: requestState.requestId,
                    context: requestState.context,
                    fullResponse: requestState.accumulatedResponse,
                    reasoning_content: requestState.accumulatedReasoning,
                    finishReason: requestState.finishReason || 'completed',
                    interrupted: false,
                    timedOut: false,
                    fallbackMeta: requestState.fallbackMeta || null,
                });
                return;
            }
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            emitTerminalEvent(requestState, {
                type: 'end',
                requestId: requestState.requestId,
                context: requestState.context,
                fullResponse: requestState.accumulatedResponse,
                reasoning_content: requestState.accumulatedReasoning,
                finishReason: requestState.timedOut ? 'timed_out' : 'cancelled_by_user',
                interrupted: requestState.interrupted === true,
                timedOut: requestState.timedOut === true,
                fallbackMeta: requestState.fallbackMeta || null,
            });
            return;
        }

        emitTerminalEvent(requestState, {
            type: 'error',
            requestId: requestState.requestId,
            context: requestState.context,
            error: `Chat stream failed: ${error.message}`,
            partialResponse: requestState.accumulatedResponse,
            reasoning_content: requestState.accumulatedReasoning,
            interrupted: requestState.interrupted === true,
            timedOut: requestState.timedOut === true,
            fallbackMeta: requestState.fallbackMeta || null,
        });
    } finally {
        try {
            reader.releaseLock();
        } catch (_error) {
            // Ignore release failures.
        }
        cleanupRequest(requestState);
    }
}

async function executeRequestAttempt({
    requestId,
    endpoint,
    apiKey,
    extraHeaders = {},
    normalizedMessages,
    modelConfig = {},
    context = null,
    webContents = null,
    streamChannel = STREAM_CHANNEL,
    onStreamEnd = null,
    timeoutMs = moduleConfig.defaultTimeoutMs,
    round = 1,
    fallbackMeta = null,
}) {
    let serializedBody;
    try {
        serializedBody = JSON.stringify(buildRequestAttemptBody(normalizedMessages, modelConfig, requestId));
    } catch (error) {
        return {
            error: `Failed to serialize request body: ${error.message}`,
            failure: {
                retryable: false,
                trigger: {
                    type: 'serialization_error',
                    error: error.message,
                },
            },
        };
    }

    const requestState = createRequestState({
        requestId,
        endpoint,
        apiKey,
        extraHeaders,
        context,
        webContents,
        streamChannel,
        onStreamEnd,
        timeoutMs,
        fallbackMeta,
    });

    try {
        logOutboundRequest({
            requestId,
            round,
            endpoint,
            model: modelConfig.model || '',
            context,
            messages: normalizedMessages,
        });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: buildRequestHeaders(apiKey, extraHeaders),
            body: serializedBody,
            signal: requestState.controller.signal,
        });

        if (!response.ok) {
            const { formattedMessage, errorMessage } = await parseErrorResponse(response);
            cleanupRequest(requestState);
            return {
                error: formattedMessage,
                failure: buildHttpFailureMeta(response.status, errorMessage),
            };
        }

        if (modelConfig.stream === true) {
            if (!response.body) {
                cleanupRequest(requestState);
                return {
                    error: 'Streaming response did not contain a readable body.',
                    failure: {
                        retryable: false,
                        trigger: {
                            type: 'stream_body_missing',
                            error: 'Streaming response did not contain a readable body.',
                        },
                    },
                };
            }

            void processStreamResponse(response, requestState);
            return {
                streamingStarted: true,
                requestId,
                context,
                fallbackMeta: requestState.fallbackMeta || null,
            };
        }

        const parsedResponse = await response.json();
        logUpstreamRawReply({
            requestId,
            round,
            content: extractTextFromCandidate(
                parsedResponse?.choices?.[0]?.message?.content
                ?? parsedResponse?.message?.content
                ?? parsedResponse?.content
                ?? ''
            ),
        });
        cleanupRequest(requestState);
        return {
            response: parsedResponse,
            context,
            requestId,
            fallbackMeta: requestState.fallbackMeta || null,
        };
    } catch (error) {
        cleanupRequest(requestState);
        const failure = buildRuntimeFailureMeta(error, requestState);

        if (error?.name === 'AbortError') {
            return {
                error: requestState.timedOut ? 'Request timed out.' : 'Request cancelled.',
                failure,
            };
        }

        return {
            error: `Chat request error: ${error.message}`,
            failure,
        };
    }
}

async function send(request) {
    const {
        requestId,
        endpoint,
        apiKey,
        extraHeaders = {},
        messages,
        modelConfig = {},
        context = null,
        webContents = null,
        streamChannel = STREAM_CHANNEL,
        onStreamEnd = null,
        timeoutMs = moduleConfig.defaultTimeoutMs,
        fallbackExecution = null,
        requiredCapability = '',
    } = request || {};

    if (!requestId || typeof requestId !== 'string') {
        return { error: 'requestId is required.' };
    }

    let finalEndpoint;
    let normalizedMessages;

    try {
        finalEndpoint = normalizeEndpoint(endpoint);
        normalizedMessages = normalizeMessages(messages);
    } catch (error) {
        return { error: error.message };
    }

    let normalizedFallbackExecution = null;
    if (fallbackExecution && typeof fallbackExecution === 'object') {
        const fallbackEndpoint = typeof fallbackExecution.endpoint === 'string'
            ? fallbackExecution.endpoint.trim()
            : '';
        if (fallbackEndpoint) {
            try {
                normalizedFallbackExecution = {
                    ...fallbackExecution,
                    endpoint: normalizeEndpoint(fallbackEndpoint),
                    apiKey: typeof fallbackExecution.apiKey === 'string' ? fallbackExecution.apiKey.trim() : '',
                    extraHeaders: fallbackExecution.extraHeaders && typeof fallbackExecution.extraHeaders === 'object' && !Array.isArray(fallbackExecution.extraHeaders)
                        ? fallbackExecution.extraHeaders
                        : {},
                };
            } catch (_error) {
                normalizedFallbackExecution = null;
            }
        }
    }

    const primaryExecution = {
        endpoint: finalEndpoint,
        apiKey,
        extraHeaders,
        model: { id: modelConfig.model || '' },
    };
    const fallbackMeta = fallbackExecution || normalizeCapabilityList(requiredCapability).length > 0
        ? createFallbackMeta(primaryExecution, normalizedFallbackExecution)
        : null;

    const primaryResult = await executeRequestAttempt({
        requestId,
        endpoint: finalEndpoint,
        apiKey,
        extraHeaders,
        normalizedMessages,
        modelConfig,
        context,
        webContents,
        streamChannel,
        onStreamEnd,
        timeoutMs,
        round: request.round || 1,
        fallbackMeta,
    });

    if (!primaryResult?.error) {
        return fallbackMeta
            ? { ...primaryResult, fallbackMeta }
            : primaryResult;
    }

    if (!fallbackMeta) {
        return primaryResult;
    }

    const skipReason = resolveFallbackSkipReason({
        primaryExecution,
        fallbackExecution: normalizedFallbackExecution,
        fallbackMeta,
        requiredCapability,
    });
    if (skipReason) {
        return {
            ...primaryResult,
            fallbackMeta,
        };
    }

    if (primaryResult?.failure?.retryable !== true) {
        fallbackMeta.skippedReason = 'not-triggered';
        return {
            ...primaryResult,
            fallbackMeta,
        };
    }

    fallbackMeta.attempted = true;
    fallbackMeta.trigger = primaryResult.failure.trigger || null;
    fallbackMeta.skippedReason = '';

    const fallbackResult = await executeRequestAttempt({
        requestId,
        endpoint: normalizedFallbackExecution.endpoint,
        apiKey: normalizedFallbackExecution.apiKey || '',
        extraHeaders: normalizedFallbackExecution.extraHeaders || {},
        normalizedMessages,
        modelConfig: {
            ...modelConfig,
            ...(normalizedFallbackExecution?.model?.id ? { model: normalizedFallbackExecution.model.id } : {}),
        },
        context,
        webContents,
        streamChannel,
        onStreamEnd,
        timeoutMs,
        round: request.round || 1,
        fallbackMeta,
    });

    if (fallbackResult?.error) {
        return {
            error: `${primaryResult.error}；回退后仍失败：${fallbackResult.error}`,
            failure: fallbackResult.failure,
            fallbackMeta,
        };
    }

    fallbackMeta.used = true;
    return {
        ...fallbackResult,
        fallbackMeta,
    };
}

function buildInterruptUrl(endpoint) {
    const url = new URL(endpoint);
    url.pathname = '/v1/interrupt';
    url.search = '';
    url.hash = '';
    return url.toString();
}

async function interrupt(request = {}) {
    const requestId = typeof request === 'string' ? request : request.requestId;
    const remote = typeof request === 'object' && request !== null
        ? request.remote !== false
        : true;

    if (!requestId || typeof requestId !== 'string') {
        return { success: false, error: 'requestId is required.' };
    }

    const requestState = activeRequests.get(requestId);
    let localAborted = false;

    if (requestState?.controller && requestState.controller.signal.aborted !== true) {
        requestState.interrupted = true;
        requestState.controller.abort();
        localAborted = true;
    }

    let remoteAttempted = false;
    let remoteSucceeded = false;
    let remoteError = null;

    if (remote) {
        const settings = await readSettings();
        const endpoint = requestState?.endpoint || settings?.chatEndpoint;
        const apiKey = requestState?.apiKey || settings?.chatApiKey;
        const extraHeaders = requestState?.extraHeaders || {};

        if (endpoint) {
            remoteAttempted = true;
            try {
                const response = await fetch(buildInterruptUrl(endpoint), {
                    method: 'POST',
                    headers: buildRequestHeaders(apiKey, extraHeaders),
                    body: JSON.stringify({ requestId }),
                });

                if (!response.ok) {
                    const { formattedMessage } = await parseErrorResponse(response);
                    remoteError = formattedMessage;
                } else {
                    remoteSucceeded = true;
                }
            } catch (error) {
                remoteError = error.message;
            }
        } else if (!localAborted) {
            remoteError = 'No active request or configured endpoint was available for interrupt.';
        }
    }

    if (localAborted || remoteSucceeded) {
        const result = {
            success: true,
            requestId,
            localAborted,
            remoteAttempted,
            remoteSucceeded,
        };

        if (remoteError) {
            result.warning = `Local abort completed, but remote interrupt failed: ${remoteError}`;
        }

        return result;
    }

    return {
        success: false,
        requestId,
        error: remoteError || 'No active request found.',
        localAborted: false,
        remoteAttempted,
        remoteSucceeded: false,
    };
}

function getActiveRequestCount() {
    return activeRequests.size;
}

module.exports = {
    buildRequestHeaders,
    initialize,
    send,
    interrupt,
    getActiveRequestCount,
};

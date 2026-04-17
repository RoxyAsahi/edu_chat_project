const DEFAULT_TIMEOUT_MS = 300000;
const STREAM_CHANNEL = 'vcp-stream-event';
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
    const envTimeoutMs = Number(process.env.UNISTUDY_VCP_TIMEOUT_MS);
    moduleConfig = {
        settingsManager: config.settingsManager || null,
        defaultTimeoutMs: Number(config.defaultTimeoutMs) > 0
            ? Number(config.defaultTimeoutMs)
            : envTimeoutMs > 0
                ? envTimeoutMs
            : DEFAULT_TIMEOUT_MS,
    };
    console.log('[VCPClient] Initialized.');
}

async function readSettings() {
    if (!moduleConfig.settingsManager || typeof moduleConfig.settingsManager.readSettings !== 'function') {
        return {};
    }

    try {
        return await moduleConfig.settingsManager.readSettings();
    } catch (error) {
        console.error('[VCPClient] Failed to read settings:', error);
        return {};
    }
}

function normalizeEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        throw new Error('VCP endpoint is required.');
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
        formattedMessage: `VCP request failed: ${response.status} - ${errorMessage}`,
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
                finishReason: payload.finishReason,
                interrupted: payload.interrupted === true,
                timedOut: payload.timedOut === true,
            });
            return;
        }

        requestState.onStreamEnd({
            success: false,
            requestId: requestState.requestId,
            context: requestState.context,
            content: payload.partialResponse || '',
            error: payload.error,
            interrupted: payload.interrupted === true,
            timedOut: payload.timedOut === true,
        });
    } catch (error) {
        console.error('[VCPClient] onStreamEnd callback failed:', error);
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
                        finishReason: requestState.finishReason || 'completed',
                        interrupted: false,
                        timedOut: false,
                    });
                    return;
                }

                try {
                    const parsedChunk = JSON.parse(jsonData);
                    const textDelta = extractTextDelta(parsedChunk);
                    if (textDelta) {
                        requestState.accumulatedResponse += textDelta;
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
                        hasRenderableText: Boolean(textDelta),
                    }, requestState.streamChannel);
                } catch (_error) {
                    emitStreamEvent(requestState.webContents, {
                        type: 'data',
                        requestId: requestState.requestId,
                        context: requestState.context,
                        chunk: { raw: jsonData, error: 'json_parse_error' },
                        textDelta: '',
                        hasRenderableText: false,
                    }, requestState.streamChannel);
                }
            }

            if (done) {
                emitTerminalEvent(requestState, {
                    type: 'end',
                    requestId: requestState.requestId,
                    context: requestState.context,
                    fullResponse: requestState.accumulatedResponse,
                    finishReason: requestState.finishReason || 'completed',
                    interrupted: false,
                    timedOut: false,
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
                finishReason: requestState.timedOut ? 'timed_out' : 'cancelled_by_user',
                interrupted: requestState.interrupted === true,
                timedOut: requestState.timedOut === true,
            });
            return;
        }

        emitTerminalEvent(requestState, {
            type: 'error',
            requestId: requestState.requestId,
            context: requestState.context,
            error: `VCP stream failed: ${error.message}`,
            partialResponse: requestState.accumulatedResponse,
            interrupted: requestState.interrupted === true,
            timedOut: requestState.timedOut === true,
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

    const requestBody = {
        messages: normalizedMessages,
        ...modelConfig,
        stream: modelConfig.stream === true,
        requestId,
    };

    let serializedBody;
    try {
        serializedBody = JSON.stringify(requestBody);
    } catch (error) {
        return { error: `Failed to serialize request body: ${error.message}` };
    }

    const requestState = {
        requestId,
        endpoint: finalEndpoint,
        apiKey,
        extraHeaders,
        controller: new AbortController(),
        context,
        webContents,
        streamChannel,
        onStreamEnd,
        accumulatedResponse: '',
        finishReason: null,
        interrupted: false,
        timedOut: false,
        terminalSent: false,
        cleanedUp: false,
        timeoutId: null,
    };

    requestState.timeoutId = setTimeout(() => {
        requestState.timedOut = true;
        requestState.controller.abort();
    }, Number(timeoutMs) > 0 ? Number(timeoutMs) : moduleConfig.defaultTimeoutMs);

    activeRequests.set(requestId, requestState);

    try {
        logOutboundRequest({
            requestId,
            round: request.round || 1,
            endpoint: finalEndpoint,
            model: modelConfig.model || '',
            context,
            messages: normalizedMessages,
        });

        const response = await fetch(finalEndpoint, {
            method: 'POST',
            headers: buildRequestHeaders(apiKey, extraHeaders),
            body: serializedBody,
            signal: requestState.controller.signal,
        });

        if (!response.ok) {
            const { formattedMessage } = await parseErrorResponse(response);
            cleanupRequest(requestState);
            return { error: formattedMessage };
        }

        if (modelConfig.stream === true) {
            if (!response.body) {
                cleanupRequest(requestState);
                return { error: 'Streaming response did not contain a readable body.' };
            }

            void processStreamResponse(response, requestState);
            return { streamingStarted: true, requestId, context };
        }

        const parsedResponse = await response.json();
        logUpstreamRawReply({
            requestId,
            round: request.round || 1,
            content: extractTextFromCandidate(
                parsedResponse?.choices?.[0]?.message?.content
                ?? parsedResponse?.message?.content
                ?? parsedResponse?.content
                ?? ''
            ),
        });
        cleanupRequest(requestState);
        return { response: parsedResponse, context, requestId };
    } catch (error) {
        cleanupRequest(requestState);

        if (error?.name === 'AbortError') {
            if (requestState.timedOut) {
                return { error: 'Request timed out.' };
            }
            return { error: 'Request cancelled.' };
        }

        return { error: `VCP request error: ${error.message}` };
    }
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
        const endpoint = requestState?.endpoint || settings?.vcpServerUrl;
        const apiKey = requestState?.apiKey || settings?.vcpApiKey;
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

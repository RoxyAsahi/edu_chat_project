const {
    buildToolPayloadMessage,
    extractResponseContent,
    injectResponseContent,
    parseToolRequests,
    THINK_BLOCK_REGEX,
} = require('./toolProtocol');
const {
    logFinalAssistantReply,
    logParsedToolRequests,
    logToolExecutionResults,
    logVisibleAssistantReply,
} = require('./chatDebugLogger');

const DEFAULT_SYNTHETIC_STREAM_INTERVAL_MS = 18;
const DEFAULT_MAX_TOOL_ROUNDS = 3;
const syntheticRequestState = new Map();

function cloneMessages(messages = []) {
    return Array.isArray(messages)
        ? messages.map((message) => ({ ...message }))
        : [];
}

function getLastUserMessageText(messages = []) {
    const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
    if (!lastUserMessage) {
        return '';
    }

    if (typeof lastUserMessage.content === 'string') {
        return lastUserMessage.content.trim();
    }

    if (Array.isArray(lastUserMessage.content)) {
        return lastUserMessage.content
            .map((part) => part?.text || '')
            .join('\n')
            .trim();
    }

    return '';
}

function insertTemporarySystemMessages(messages = [], temporaryMessages = []) {
    if (!Array.isArray(temporaryMessages) || temporaryMessages.length === 0) {
        return cloneMessages(messages);
    }

    const clonedMessages = cloneMessages(messages);
    let insertIndex = -1;

    for (let index = clonedMessages.length - 1; index >= 0; index -= 1) {
        if (clonedMessages[index]?.role === 'system') {
            insertIndex = index;
            break;
        }
    }

    if (insertIndex === -1) {
        return [...temporaryMessages, ...clonedMessages];
    }

    return [
        ...clonedMessages.slice(0, insertIndex + 1),
        ...temporaryMessages,
        ...clonedMessages.slice(insertIndex + 1),
    ];
}

function splitSyntheticChunks(text = '') {
    const normalized = String(text || '');
    if (!normalized) {
        return [];
    }

    const tokens = normalized.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9_]+|[^\u4e00-\u9fa5a-zA-Z0-9\s]+|\s+/g) || [normalized];
    const chunks = [];
    let current = '';
    tokens.forEach((token) => {
        if ((current + token).length > 26 && current) {
            chunks.push(current);
            current = token;
            return;
        }
        current += token;
    });
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

function stripThoughtArtifacts(content = '') {
    return String(content || '')
        .replace(THINK_BLOCK_REGEX, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildVisibleAssistantTranscript(segments = []) {
    return segments
        .map((segment) => String(segment || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim();
}

function makeSyntheticChunkEvent(requestId, context, content) {
    return {
        type: 'data',
        requestId,
        context,
        chunk: { content },
        textDelta: content,
        hasRenderableText: Boolean(content),
    };
}

function makeSyntheticEndEvent(requestId, context, payload = {}) {
    return {
        type: 'end',
        requestId,
        context,
        fullResponse: payload.fullResponse || '',
        finishReason: payload.finishReason || 'completed',
        interrupted: payload.interrupted === true,
        timedOut: payload.timedOut === true,
        error: payload.error || '',
    };
}

function emitSyntheticStream(options = {}) {
    const {
        requestId,
        context,
        webContents,
        streamChannel,
        fullResponse,
        finishReason,
    } = options;

    const isDestroyed = typeof webContents?.isDestroyed === 'function'
        ? webContents.isDestroyed()
        : false;
    if (!requestId || !webContents || typeof webContents.send !== 'function' || isDestroyed) {
        return;
    }

    const state = syntheticRequestState.get(requestId) || {
        aborted: false,
        timers: new Set(),
    };
    syntheticRequestState.set(requestId, state);

    const chunks = splitSyntheticChunks(fullResponse);
    chunks.forEach((chunk, index) => {
        const timer = setTimeout(() => {
            state.timers.delete(timer);
            if (state.aborted || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
                return;
            }
            webContents.send(streamChannel, makeSyntheticChunkEvent(requestId, context, chunk));
        }, index * DEFAULT_SYNTHETIC_STREAM_INTERVAL_MS);
        state.timers.add(timer);
    });

    const finalTimer = setTimeout(() => {
        state.timers.delete(finalTimer);
        if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
            syntheticRequestState.delete(requestId);
            return;
        }

        webContents.send(streamChannel, makeSyntheticEndEvent(requestId, context, {
            fullResponse: state.aborted ? '' : fullResponse,
            finishReason: state.aborted ? 'cancelled_by_user' : finishReason,
            interrupted: state.aborted,
        }));
        syntheticRequestState.delete(requestId);
    }, Math.max(chunks.length, 1) * DEFAULT_SYNTHETIC_STREAM_INTERVAL_MS + 4);
    state.timers.add(finalTimer);
}

function abortSyntheticRequest(requestId) {
    const state = syntheticRequestState.get(requestId);
    if (!state) {
        return false;
    }

    state.aborted = true;
    return true;
}

function createChatOrchestrator(options = {}) {
    const vcpClient = options.vcpClient;
    const studyToolRuntime = options.studyToolRuntime;
    const studyMemoryService = options.studyMemoryService;

    async function runLocalLoop(request = {}) {
        const {
            requestId,
            endpoint,
            apiKey,
            extraHeaders = {},
            messages,
            modelConfig = {},
            context,
            settings = {},
        } = request;
        const maxRounds = Math.max(
            1,
            Number(settings?.studyLogPolicy?.maxToolRounds || DEFAULT_MAX_TOOL_ROUNDS)
        );
        const baseMessages = cloneMessages(messages);
        const query = getLastUserMessageText(baseMessages);
        const studyMemory = await studyMemoryService.searchStudyMemory({
            agentId: context?.agentId,
            topicId: context?.topicId,
            query,
            topK: Number(settings?.studyLogPolicy?.memoryTopK || 4),
            fallbackTopK: Number(settings?.studyLogPolicy?.memoryFallbackTopK || 2),
        }).catch(() => ({
            refs: [],
            contextText: '',
            itemCount: 0,
        }));

        let currentMessages = studyMemory.contextText
            ? insertTemporarySystemMessages(baseMessages, [{ role: 'system', content: studyMemory.contextText }])
            : baseMessages;

        const toolEvents = [];
        let finalText = '';
        let finalResponse = null;
        let finishReason = 'completed';
        let rawResult = null;
        const visibleAssistantSegments = [];

        for (let round = 0; round < maxRounds; round += 1) {
            const upstreamResult = await vcpClient.send({
                requestId,
                endpoint,
                apiKey,
                extraHeaders,
                messages: currentMessages,
                round: round + 1,
                modelConfig: {
                    ...modelConfig,
                    stream: false,
                },
                context,
                timeoutMs: request.timeoutMs,
            });

            if (upstreamResult?.error) {
                return {
                    error: upstreamResult.error,
                    studyMemoryRefs: studyMemory.refs,
                    toolEvents,
                };
            }

            rawResult = upstreamResult;
            const parsedResponse = upstreamResult.response || {};
            const rawContent = extractResponseContent(parsedResponse);
            const visibleRoundText = stripThoughtArtifacts(rawContent);
            const toolRequests = parseToolRequests(rawContent);
            logParsedToolRequests({
                requestId,
                round: round + 1,
                toolRequests,
            });
            finalResponse = parsedResponse;

            if (visibleRoundText) {
                visibleAssistantSegments.push(visibleRoundText);
            }

            if (toolRequests.length === 0) {
                finalText = buildVisibleAssistantTranscript(visibleAssistantSegments);
                logVisibleAssistantReply({
                    requestId,
                    round: round + 1,
                    content: visibleRoundText,
                });
                injectResponseContent(finalResponse, finalText);
                break;
            }

            logVisibleAssistantReply({
                requestId,
                round: round + 1,
                content: visibleRoundText,
            });

            const roundResults = [];
            for (const toolRequest of toolRequests) {
                const result = await studyToolRuntime.executeToolRequest(toolRequest, {
                    agentId: context?.agentId,
                    agentName: context?.agentName,
                    topicId: context?.topicId,
                    topicName: context?.topicName,
                    studentName: context?.studentName,
                    studyWorkspace: context?.studyWorkspace,
                    workEnvironment: context?.workEnvironment,
                    dateKey: context?.currentDate,
                    sourceMessageIds: [
                        context?.lastUserMessageId,
                        context?.assistantMessageId || requestId,
                    ].filter(Boolean),
                });
                roundResults.push(result);
                toolEvents.push({
                    ...result,
                    requestedToolName: toolRequest.requestedToolName,
                    requestedCommand: toolRequest.requestedCommand,
                    protocol: toolRequest.protocol,
                    timestamp: Date.now(),
                });
            }
            logToolExecutionResults({
                requestId,
                round: round + 1,
                results: roundResults,
            });

            currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: rawContent },
                { role: 'user', content: buildToolPayloadMessage(roundResults) },
            ];
        }

        if (!finalText && finalResponse) {
            finalText = buildVisibleAssistantTranscript(visibleAssistantSegments)
                || stripThoughtArtifacts(extractResponseContent(finalResponse));
            injectResponseContent(finalResponse, finalText);
        }
        logFinalAssistantReply({
            requestId,
            content: finalText,
        });

        return {
            response: finalResponse,
            fullResponse: finalText,
            finishReason,
            rawResult,
            studyMemoryRefs: studyMemory.refs,
            toolEvents,
        };
    }

    async function runRequest(request = {}) {
        const result = await runLocalLoop(request);
        if (result?.error) {
            return result;
        }

        if (request.modelConfig?.stream === true) {
            emitSyntheticStream({
                requestId: request.requestId,
                context: request.context,
                webContents: request.webContents,
                streamChannel: request.streamChannel,
                fullResponse: result.fullResponse || '',
                finishReason: result.finishReason || 'completed',
            });

            return {
                streamingStarted: true,
                requestId: request.requestId,
                context: request.context,
                toolEvents: result.toolEvents,
                studyMemoryRefs: result.studyMemoryRefs,
            };
        }

        return {
            ...(result.rawResult || { response: result.response, requestId: request.requestId, context: request.context }),
            toolEvents: result.toolEvents,
            studyMemoryRefs: result.studyMemoryRefs,
        };
    }

    return {
        abortSyntheticRequest,
        runRequest,
    };
}

module.exports = {
    abortSyntheticRequest,
    createChatOrchestrator,
};

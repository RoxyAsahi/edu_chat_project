const {
    buildToolPayloadMessage,
    extractResponseContent,
    injectResponseContent,
    parseToolRequests,
    stripToolArtifacts,
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

function mergeTemporarySystemMessages(messages = [], temporaryMessages = []) {
    const clonedMessages = cloneMessages(messages);
    const mergedTemporaryContent = (Array.isArray(temporaryMessages) ? temporaryMessages : [])
        .map((message) => (typeof message?.content === 'string' ? message.content.trim() : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim();

    if (!mergedTemporaryContent) {
        return clonedMessages;
    }

    const firstNonSystemIndex = clonedMessages.findIndex((message) => message?.role !== 'system');
    const leadingSystemMessages = firstNonSystemIndex === -1
        ? clonedMessages
        : clonedMessages.slice(0, firstNonSystemIndex);
    const remainingMessages = firstNonSystemIndex === -1
        ? []
        : clonedMessages.slice(firstNonSystemIndex);
    const mergedLeadingSystemContent = leadingSystemMessages
        .map((message) => (typeof message?.content === 'string' ? message.content.trim() : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim();
    const nextSystemContent = [mergedLeadingSystemContent, mergedTemporaryContent]
        .filter(Boolean)
        .join('\n\n')
        .trim();

    return [
        ...(nextSystemContent ? [{ role: 'system', content: nextSystemContent }] : []),
        ...remainingMessages,
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

function makeSyntheticChunkEvent(requestId, context, content, options = {}) {
    const reasoningDelta = typeof options.reasoningDelta === 'string'
        ? options.reasoningDelta
        : '';

    return {
        type: 'data',
        requestId,
        context,
        chunk: {
            ...(content ? { content } : {}),
            ...(reasoningDelta ? { reasoning_content: reasoningDelta } : {}),
        },
        textDelta: content,
        reasoningDelta,
        hasRenderableText: Boolean(content),
        hasRenderableReasoning: Boolean(reasoningDelta),
    };
}

function makeSyntheticEndEvent(requestId, context, payload = {}) {
    return {
        type: 'end',
        requestId,
        context,
        fullResponse: payload.fullResponse || '',
        reasoning_content: payload.reasoning_content || '',
        finishReason: payload.finishReason || 'completed',
        interrupted: payload.interrupted === true,
        timedOut: payload.timedOut === true,
        error: payload.error || '',
        fallbackMeta: payload.fallbackMeta || null,
    };
}

function makeSyntheticErrorEvent(requestId, context, payload = {}) {
    return {
        type: 'error',
        requestId,
        context,
        error: payload.error || 'Streaming request failed.',
        partialResponse: payload.partialResponse || '',
        reasoning_content: payload.reasoning_content || '',
        interrupted: payload.interrupted === true,
        timedOut: payload.timedOut === true,
        fallbackMeta: payload.fallbackMeta || null,
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
        fallbackMeta,
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
            fallbackMeta,
        }));
        syntheticRequestState.delete(requestId);
    }, Math.max(chunks.length, 1) * DEFAULT_SYNTHETIC_STREAM_INTERVAL_MS + 4);
    state.timers.add(finalTimer);
}

function mergeFallbackMeta(current = null, next = null, round = 0) {
    if (!next || typeof next !== 'object') {
        return current;
    }

    const nextRoundMeta = {
        ...next,
        round,
    };

    return {
        attempted: current?.attempted === true || next.attempted === true,
        used: current?.used === true || next.used === true,
        skippedReason: next.skippedReason || current?.skippedReason || '',
        trigger: next.trigger || current?.trigger || null,
        primary: next.primary || current?.primary || null,
        fallback: next.fallback || current?.fallback || null,
        rounds: [
            ...(Array.isArray(current?.rounds) ? current.rounds : []),
            nextRoundMeta,
        ],
    };
}

function abortSyntheticRequest(requestId) {
    const state = syntheticRequestState.get(requestId);
    if (!state) {
        return false;
    }

    state.aborted = true;
    return true;
}

function findUnclosedThoughtMarkerStart(text = '') {
    const normalized = String(text || '');
    const markerPairs = [
        { start: '<thinking>', end: '</thinking>' },
        { start: '<think>', end: '</think>' },
    ];

    let earliestUnsafeIndex = -1;
    markerPairs.forEach(({ start, end }) => {
        const startIndex = normalized.lastIndexOf(start);
        if (startIndex === -1) {
            return;
        }

        const endIndex = normalized.indexOf(end, startIndex + start.length);
        if (endIndex !== -1) {
            return;
        }

        earliestUnsafeIndex = earliestUnsafeIndex === -1
            ? startIndex
            : Math.min(earliestUnsafeIndex, startIndex);
    });

    return earliestUnsafeIndex;
}

function computeRawStreamingRoundText(content = '', finalized = false) {
    let safePrefix = String(content || '');
    if (!finalized) {
        const unsafeThoughtIndex = findUnclosedThoughtMarkerStart(safePrefix);
        if (unsafeThoughtIndex >= 0) {
            safePrefix = safePrefix.slice(0, unsafeThoughtIndex);
        }
    }

    return stripThoughtArtifacts(safePrefix).replace(/\s+$/u, '');
}

function buildRoundDisplayText(visibleText = '', completedSegmentCount = 0) {
    const normalized = String(visibleText || '');
    if (!normalized) {
        return '';
    }

    return completedSegmentCount > 0
        ? `\n\n${normalized}`
        : normalized;
}

function createChatOrchestrator(options = {}) {
    const chatClient = options.chatClient;
    const studyToolRuntime = options.studyToolRuntime;
    const studyMemoryService = options.studyMemoryService;

    async function prepareRequestMessages(request = {}) {
        const {
            messages,
            context,
            settings = {},
        } = request;
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

        const preparedMessages = studyMemory.contextText
            ? mergeTemporarySystemMessages(baseMessages, [{ role: 'system', content: studyMemory.contextText }])
            : baseMessages;

        return {
            messages: preparedMessages,
            studyMemoryRefs: studyMemory.refs,
        };
    }

    async function runDirectRequest(request = {}) {
        const prepared = await prepareRequestMessages(request);
        const directResult = await chatClient.send({
            requestId: request.requestId,
            endpoint: request.endpoint,
            apiKey: request.apiKey,
            extraHeaders: request.extraHeaders || {},
            messages: prepared.messages,
            round: 1,
            modelConfig: request.modelConfig || {},
            context: request.context,
            timeoutMs: request.timeoutMs,
            fallbackExecution: request.fallbackExecution || null,
            webContents: request.webContents,
            streamChannel: request.streamChannel,
            onStreamEnd: request.onStreamEnd,
            onStreamChunk: request.onStreamChunk,
        });

        if (directResult?.error) {
            return {
                error: directResult.error,
                studyMemoryRefs: prepared.studyMemoryRefs,
                toolEvents: [],
                fallbackMeta: directResult?.fallbackMeta || null,
            };
        }

        return {
            ...(directResult || {}),
            toolEvents: [],
            studyMemoryRefs: prepared.studyMemoryRefs,
            fallbackMeta: directResult?.fallbackMeta || null,
        };
    }

    async function runStreamedToolLoop(request = {}) {
        const {
            requestId,
            endpoint,
            apiKey,
            extraHeaders = {},
            modelConfig = {},
            context,
            settings = {},
            webContents,
            streamChannel = 'chat-stream-event',
        } = request;
        const maxRounds = Math.max(
            1,
            Number(settings?.studyLogPolicy?.maxToolRounds || DEFAULT_MAX_TOOL_ROUNDS)
        );
        const prepared = await prepareRequestMessages(request);
        let currentMessages = prepared.messages;
        const toolEvents = [];
        const visibleAssistantSegments = [];
        let finalResponse = null;
        let finishReason = 'completed';
        let fallbackMeta = null;
        let accumulatedReasoning = '';
        let terminalEventSent = false;

        const emitChunkDelta = (nextDisplayText = '', state) => {
            const normalizedNextText = String(nextDisplayText || '');
            const previousDisplayText = state.emittedDisplayText || '';
            if (!normalizedNextText || normalizedNextText === previousDisplayText) {
                return;
            }

             if (previousDisplayText && previousDisplayText.startsWith(normalizedNextText)) {
                state.emittedDisplayText = normalizedNextText;
                return;
            }

            if (!normalizedNextText.startsWith(previousDisplayText)) {
                console.warn('[ChatOrchestrator] Stream display text diverged; suppressing non-prefix delta.', {
                    requestId,
                });
                return;
            }

            const delta = normalizedNextText.slice(previousDisplayText.length);
            if (!delta) {
                return;
            }

            state.emittedDisplayText = normalizedNextText;
            if (!webContents || typeof webContents.send !== 'function') {
                return;
            }
            if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
                return;
            }

            webContents.send(streamChannel, makeSyntheticChunkEvent(requestId, context, delta));
        };

        const emitReasoningDelta = (reasoningDelta = '') => {
            const normalizedReasoningDelta = String(reasoningDelta || '');
            if (!normalizedReasoningDelta) {
                return;
            }
            if (!webContents || typeof webContents.send !== 'function') {
                return;
            }
            if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
                return;
            }

            webContents.send(streamChannel, makeSyntheticChunkEvent(requestId, context, '', {
                reasoningDelta: normalizedReasoningDelta,
            }));
        };

        const emitTerminal = (type, payload = {}) => {
            if (terminalEventSent) {
                return;
            }
            terminalEventSent = true;

            if (!webContents || typeof webContents.send !== 'function') {
                return;
            }
            if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
                return;
            }

            if (type === 'error') {
                webContents.send(streamChannel, makeSyntheticErrorEvent(requestId, context, payload));
                return;
            }

            webContents.send(streamChannel, makeSyntheticEndEvent(requestId, context, payload));
        };

        for (let round = 0; round < maxRounds; round += 1) {
            const roundState = {
                rawContent: '',
                emittedDisplayText: '',
                reasoningContent: '',
                completedSegmentCountAtStart: visibleAssistantSegments.length,
            };

            const streamEndResult = await new Promise(async (resolve) => {
                let resolved = false;
                let fallbackMetaFromSend = null;
                const safeResolve = (value) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(value);
                    }
                };

                const sendResult = await chatClient.send({
                    requestId,
                    endpoint,
                    apiKey,
                    extraHeaders,
                    messages: currentMessages,
                    round: round + 1,
                    modelConfig: {
                        ...modelConfig,
                        stream: true,
                    },
                    context,
                    timeoutMs: request.timeoutMs,
                    fallbackExecution: request.fallbackExecution || null,
                    webContents,
                    streamChannel,
                    emitStreamEvents: false,
                    onStreamChunk: (payload) => {
                        if (payload?.chunk?.error === 'json_parse_error') {
                            return;
                        }

                        if (payload?.textDelta) {
                            roundState.rawContent += payload.textDelta;
                        }
                        if (payload?.reasoningDelta) {
                            roundState.reasoningContent += payload.reasoningDelta;
                            emitReasoningDelta(payload.reasoningDelta);
                        }

                        const visibleRoundText = computeRawStreamingRoundText(roundState.rawContent, false);
                        emitChunkDelta(
                            buildRoundDisplayText(visibleRoundText, roundState.completedSegmentCountAtStart),
                            roundState
                        );
                    },
                    onStreamEnd: (endResult = {}) => safeResolve({
                        ...endResult,
                        success: endResult.success !== false && endResult.type !== 'error',
                        content: typeof endResult.content === 'string'
                            ? endResult.content
                            : (endResult.fullResponse || endResult.partialResponse || ''),
                        reasoningContent: typeof endResult.reasoningContent === 'string'
                            ? endResult.reasoningContent
                            : (endResult.reasoning_content || ''),
                        fallbackMeta: fallbackMetaFromSend || endResult?.fallbackMeta || null,
                    }),
                });

                fallbackMetaFromSend = sendResult?.fallbackMeta || null;

                if (sendResult?.error) {
                    safeResolve({
                        success: false,
                        error: sendResult.error,
                        fallbackMeta: sendResult?.fallbackMeta || null,
                    });
                    return;
                }

                if (!sendResult?.streamingStarted) {
                    safeResolve({
                        success: false,
                        error: 'Streaming did not start.',
                        fallbackMeta: sendResult?.fallbackMeta || null,
                    });
                }
            });

            fallbackMeta = mergeFallbackMeta(fallbackMeta, streamEndResult?.fallbackMeta, round + 1);

            const rawContent = typeof streamEndResult?.content === 'string'
                ? streamEndResult.content
                : roundState.rawContent;
            const roundVisibleText = computeRawStreamingRoundText(rawContent, true).trim();
            const roundFinalText = stripThoughtArtifacts(rawContent);
            emitChunkDelta(
                buildRoundDisplayText(roundVisibleText, roundState.completedSegmentCountAtStart),
                roundState
            );

            if (streamEndResult?.reasoningContent) {
                accumulatedReasoning += streamEndResult.reasoningContent;
            }

            if (streamEndResult?.success !== true) {
                const partialVisibleTranscript = buildVisibleAssistantTranscript([
                    ...visibleAssistantSegments,
                    ...(roundVisibleText ? [roundVisibleText] : []),
                ]);

                if (!partialVisibleTranscript && round === 0) {
                    return {
                        error: streamEndResult?.error || 'Streaming request failed.',
                        toolEvents,
                        studyMemoryRefs: prepared.studyMemoryRefs,
                        fallbackMeta,
                    };
                }

                emitTerminal('error', {
                    error: streamEndResult?.error || 'Streaming request failed.',
                    partialResponse: partialVisibleTranscript,
                    reasoning_content: accumulatedReasoning,
                    interrupted: streamEndResult?.interrupted === true,
                    timedOut: streamEndResult?.timedOut === true,
                    fallbackMeta,
                });

                return {
                    streamingStarted: true,
                    requestId,
                    context,
                    toolEvents,
                    studyMemoryRefs: prepared.studyMemoryRefs,
                    fallbackMeta,
                };
            }

            const parsedResponse = {
                choices: [{
                    message: {
                        content: rawContent,
                        ...(streamEndResult?.reasoningContent
                            ? { reasoning_content: streamEndResult.reasoningContent }
                            : {}),
                    },
                }],
            };
            finalResponse = parsedResponse;
            finishReason = streamEndResult?.finishReason || finishReason || 'completed';
            const toolRequests = parseToolRequests(rawContent);
            logParsedToolRequests({
                requestId,
                round: round + 1,
                toolRequests,
            });

            if (toolRequests.length === 0 || finishReason === 'cancelled_by_user' || finishReason === 'timed_out') {
                if (roundVisibleText) {
                    visibleAssistantSegments.push(roundVisibleText);
                }

                const finalVisibleText = buildVisibleAssistantTranscript(visibleAssistantSegments)
                    || stripToolArtifacts(rawContent);
                logVisibleAssistantReply({
                    requestId,
                    round: round + 1,
                    content: roundVisibleText,
                });
                logFinalAssistantReply({
                    requestId,
                    content: finalVisibleText,
                });
                injectResponseContent(finalResponse, finalVisibleText);

                emitTerminal('end', {
                    fullResponse: finalVisibleText,
                    reasoning_content: accumulatedReasoning,
                    finishReason,
                    interrupted: streamEndResult?.interrupted === true,
                    timedOut: streamEndResult?.timedOut === true,
                    fallbackMeta,
                });

                return {
                    streamingStarted: true,
                    requestId,
                    context,
                    response: finalResponse,
                    fullResponse: finalVisibleText,
                    finishReason,
                    toolEvents,
                    studyMemoryRefs: prepared.studyMemoryRefs,
                    fallbackMeta,
                };
            }

            if (roundFinalText) {
                visibleAssistantSegments.push(roundFinalText);
            }
            logVisibleAssistantReply({
                requestId,
                round: round + 1,
                content: roundVisibleText,
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

        const fallbackVisibleText = buildVisibleAssistantTranscript(visibleAssistantSegments);
        emitTerminal('end', {
            fullResponse: fallbackVisibleText,
            reasoning_content: accumulatedReasoning,
            finishReason,
            fallbackMeta,
        });

        return {
            streamingStarted: true,
            requestId,
            context,
            response: finalResponse,
            fullResponse: fallbackVisibleText,
            finishReason,
            toolEvents,
            studyMemoryRefs: prepared.studyMemoryRefs,
            fallbackMeta,
        };
    }

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
        const prepared = await prepareRequestMessages(request);
        let currentMessages = prepared.messages;

        const toolEvents = [];
        let finalText = '';
        let finalResponse = null;
        let finishReason = 'completed';
        let rawResult = null;
        const visibleAssistantSegments = [];
        let fallbackMeta = null;

        for (let round = 0; round < maxRounds; round += 1) {
            const upstreamResult = await chatClient.send({
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
                fallbackExecution: request.fallbackExecution || null,
            });

            fallbackMeta = mergeFallbackMeta(fallbackMeta, upstreamResult?.fallbackMeta, round + 1);

            if (upstreamResult?.error) {
                return {
                    error: upstreamResult.error,
                    studyMemoryRefs: prepared.studyMemoryRefs,
                    toolEvents,
                    fallbackMeta,
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
            studyMemoryRefs: prepared.studyMemoryRefs,
            toolEvents,
            fallbackMeta,
        };
    }

    async function runRequest(request = {}) {
        const executionMode = request.executionMode === 'tool-orchestrated'
            ? 'tool-orchestrated'
            : 'direct-stream';

        if (executionMode === 'direct-stream') {
            return runDirectRequest(request);
        }

        if (request.modelConfig?.stream === true) {
            return runStreamedToolLoop(request);
        }

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
                fallbackMeta: result.fallbackMeta || null,
            });

            return {
                streamingStarted: true,
                requestId: request.requestId,
                context: request.context,
                toolEvents: result.toolEvents,
                studyMemoryRefs: result.studyMemoryRefs,
                fallbackMeta: result.fallbackMeta || null,
            };
        }

        return {
            ...(result.rawResult || { response: result.response, requestId: request.requestId, context: request.context }),
            toolEvents: result.toolEvents,
            studyMemoryRefs: result.studyMemoryRefs,
            fallbackMeta: result.fallbackMeta || null,
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

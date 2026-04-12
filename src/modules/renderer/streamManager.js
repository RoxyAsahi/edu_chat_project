// modules/renderer/streamManager.js
import { formatMessageTimestamp } from './domBuilder.js';
import { createContentPipeline, PIPELINE_MODES } from './contentPipeline.js';

// --- Stream State ---
const streamingChunkQueues = new Map(); // messageId -> array of original chunk strings
const streamingTimers = new Map();      // messageId -> intervalId
const accumulatedStreamText = new Map(); // messageId -> string
const streamSegmentStates = new Map(); // messageId -> { stableCutoff, stableHtml, lastTailText }
let activeStreamingMessageId = null; // Track the currently active streaming message
const elementContentLengthCache = new Map(); // Track previous DOM content lengths per message.
const TOOL_REQUEST_START = '<<<[TOOL_REQUEST]>>>';
const TOOL_REQUEST_END = '<<<[END_TOOL_REQUEST]>>>';
const TOOL_RESULT_MARKERS = [
    {
        start: '[[' + '\u0056\u0043\u0050\u8c03\u7528\u7ed3\u679c\u4fe1\u606f\u6c47\u603b',
        end: '\u0056\u0043\u0050\u8c03\u7528\u7ed3\u679c\u7ed3\u675f]]',
    },
];
const DESKTOP_PUSH_START = '<<<[DESKTOP_PUSH]>>>';
const DESKTOP_PUSH_END = '<<<[DESKTOP_PUSH_END]>>>';
const CODE_FENCE = '```';

// --- DOM Cache ---
const messageDomCache = new Map(); // messageId -> { messageItem, contentDiv }

// --- Performance Caches & Throttling ---
const scrollThrottleTimers = new Map(); // messageId -> timerId
const SCROLL_THROTTLE_MS = 100; // 100ms scroll throttle
const viewContextCache = new Map(); // messageId -> boolean (is current view)
let currentViewSignature = null; // current view signature
let globalRenderLoopRunning = false;

// --- Pre-buffering state ---
const preBufferedChunks = new Map(); // messageId -> array of chunks waiting for initialization
const messageInitializationStatus = new Map(); // messageId -> 'pending' | 'ready' | 'finalized'

// --- Message context mapping ---
const messageContextMap = new Map(); // messageId -> { agentId, topicId, ... }

// --- Local Reference Store ---
let refs = {};
let contentPipeline = null;

/**
 * Initializes the Stream Manager with necessary dependencies from the main renderer.
 * @param {object} dependencies - An object containing all required functions and references.
 */
export function initStreamManager(dependencies) {
    refs = dependencies;

    contentPipeline = createContentPipeline({
        fixEmoticonUrlsInMarkdown: (text) => {
            if (!text || typeof text !== 'string' || !refs.emoticonUrlFixer) return text;

            let processedText = text;

            processedText = processedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
                const fixedUrl = refs.emoticonUrlFixer.fixEmoticonUrl(url);
                return `![${alt}](${fixedUrl})`;
            });

            processedText = processedText.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, url, after) => {
                const fixedUrl = refs.emoticonUrlFixer.fixEmoticonUrl(url);
                return `<img${before}src="${fixedUrl}"${after}>`;
            });

            return processedText;
        },
        processStartEndMarkers: (text) => refs.processStartEndMarkers ? refs.processStartEndMarkers(text) : text,
        deIndentMisinterpretedCodeBlocks: (text) => refs.deIndentMisinterpretedCodeBlocks ? refs.deIndentMisinterpretedCodeBlocks(text) : text,
        applyContentProcessors: (text) => {
            let processedText = text;
            if (refs.removeSpeakerTags) {
                processedText = refs.removeSpeakerTags(processedText);
            }
            if (refs.ensureNewlineAfterCodeBlock) {
                processedText = refs.ensureNewlineAfterCodeBlock(processedText);
            }
            if (refs.ensureSpaceAfterTilde) {
                processedText = refs.ensureSpaceAfterTilde(processedText);
            }
            if (refs.ensureSeparatorBetweenImgAndCode) {
                processedText = refs.ensureSeparatorBetweenImgAndCode(processedText);
            }
            return processedText;
        }
    });

    // Assume morphdom is passed in dependencies, warn if not present.
    if (!refs.morphdom) {
        console.warn('[StreamManager] `morphdom` not provided. Streaming rendering will fall back to inefficient innerHTML updates.');
    }
}

function shouldEnableSmoothStreaming() {
    const globalSettings = refs.globalSettingsRef.get();
    return globalSettings.enableSmoothStreaming === true;
}

function messageIsFinalized(messageId) {
    // Do not rely on current history; use initialization state instead.
    const initStatus = messageInitializationStatus.get(messageId);
    return initStatus === 'finalized';
}

function isThinkingPlaceholderText(text) {
    if (typeof text !== 'string') return false;
    const normalized = text.trim();
    return normalized === '\u601d\u8003\u4e2d...'
        || normalized === '\u601d\u8003\u4e2d'
        || normalized === 'Thinking'
        || normalized === 'Thinking...'
        || normalized === 'thinking'
        || normalized === 'thinking...';
}

function stripThinkingPlaceholderPrefix(text) {
    if (typeof text !== 'string') return '';

    return text.replace(/^(?:\u601d\u8003\u4e2d(?:\.\.\.)?|Thinking(?:\.\.\.)?|thinking(?:\.\.\.)?)\s*/u, '');
}

/**
 * Build a stable signature for the current view.
 */
function getCurrentViewSignature() {
    const currentSelectedItem = refs.currentSelectedItemRef.get();
    const currentTopicId = refs.currentTopicIdRef.get();
    return `${currentSelectedItem?.id || 'none'}-${currentTopicId || 'none'}`;
}

/**
 * Check whether a message belongs to the current view, with caching.
 */
function isMessageForCurrentView(context) {
    if (!context) return false;

    const newSignature = getCurrentViewSignature();

    // Clear cached view matches when the active view changes.
    if (currentViewSignature !== newSignature) {
        currentViewSignature = newSignature;
        viewContextCache.clear();
    }

    const currentSelectedItem = refs.currentSelectedItemRef.get();
    const currentTopicId = refs.currentTopicIdRef.get();

    if (!currentSelectedItem || !currentTopicId) return false;

    return context.agentId === currentSelectedItem.id && context.topicId === currentTopicId;
}

async function getHistoryForContext(context) {
    const { electronAPI } = refs;
    if (!context) return null;

    const { agentId, topicId } = context;

    if (!agentId || !topicId) return null;

    try {
        const historyResult = await electronAPI.getChatHistory(agentId, topicId);

        if (historyResult && !historyResult.error) {
            return historyResult;
        }
    } catch (e) {
        console.error('[StreamManager] Failed to get history for context', context, e);
    }

    return null;
}

// Debounced history saves
const historySaveQueue = new Map(); // context signature -> {context, history, timerId}
const HISTORY_SAVE_DEBOUNCE = 1000; // 1 second debounce for history writes

async function debouncedSaveHistory(context, history) {
    if (!context?.agentId || !context?.topicId) {
        return;
    }

    const signature = `${context.agentId}-${context.topicId}`;

    // Replace the pending timer so only the latest history snapshot is written.
    const existing = historySaveQueue.get(signature);
    if (existing?.timerId) {
        clearTimeout(existing.timerId);
    }

    // Schedule a new debounced save timer.
    const timerId = setTimeout(async () => {
        const queuedData = historySaveQueue.get(signature);
        if (queuedData) {
            await saveHistoryForContext(queuedData.context, queuedData.history);
            historySaveQueue.delete(signature);
        }
    }, HISTORY_SAVE_DEBOUNCE);

    // Clone the latest history snapshot to avoid stale references.
    historySaveQueue.set(signature, { context, history: [...history], timerId });
}
async function saveHistoryForContext(context, history) {
    const { electronAPI } = refs;
    if (!context?.agentId || !context?.topicId) {
        return;
    }

    const { agentId, topicId } = context;
    
    if (!agentId || !topicId) return;
    
    const historyToSave = history.filter(msg => !msg.isThinking);
    
    try {
        await electronAPI.saveChatHistory(agentId, topicId, historyToSave);
    } catch (e) {
        console.error(`[StreamManager] Failed to save history for context`, context, e);
    }
}

/**
 * Apply the lightweight preprocessors needed for streaming rendering.
 * This keeps the incremental path aligned with the full render pipeline.
 */
function applyStreamingPreprocessors(text) {
    if (!text) return '';
    if (!contentPipeline) return text;

    return contentPipeline.process(text, {
        mode: PIPELINE_MODES.STREAM_FAST
    }).text;
}

function ensureStreamingRoots(contentDiv) {
    let stableRoot = contentDiv.querySelector('.unistudy-stream-stable-root');
    let tailRoot = contentDiv.querySelector('.unistudy-stream-tail-root');

    if (!stableRoot || !tailRoot) {
        contentDiv.innerHTML = '';
        stableRoot = document.createElement('div');
        stableRoot.className = 'unistudy-stream-stable-root';
        tailRoot = document.createElement('div');
        tailRoot.className = 'unistudy-stream-tail-root';
        contentDiv.appendChild(stableRoot);
        contentDiv.appendChild(tailRoot);
    }

    return { stableRoot, tailRoot };
}

function getOrCreateStreamSegmentState(messageId) {
    let state = streamSegmentStates.get(messageId);
    if (!state) {
        state = {
            stableCutoff: 0,
            stableHtml: '',
            lastTailText: ''
        };
        streamSegmentStates.set(messageId, state);
    }
    return state;
}

function startsWithAt(text, index, token) {
    return text.startsWith(token, index);
}

function getToolResultMarkerAt(text, index) {
    for (const marker of TOOL_RESULT_MARKERS) {
        if (startsWithAt(text, index, marker.start)) {
            return marker;
        }
    }
    return null;
}

function findMatchingFenceEnd(text, startIndex) {
    const openEnd = text.indexOf('\n', startIndex);
    if (openEnd === -1) return -1;

    let searchIndex = openEnd + 1;
    while (searchIndex < text.length) {
        const closeIndex = text.indexOf(CODE_FENCE, searchIndex);
        if (closeIndex === -1) return -1;

        const lineStart = closeIndex === 0 ? 0 : text.lastIndexOf('\n', closeIndex - 1) + 1;
        const prefix = text.slice(lineStart, closeIndex);
        if (prefix.trim() === '') {
            const lineEnd = text.indexOf('\n', closeIndex);
            return lineEnd === -1 ? text.length : lineEnd + 1;
        }

        searchIndex = closeIndex + CODE_FENCE.length;
    }

    return -1;
}

function findExplicitStablePrefix(text, startOffset = 0) {
    let index = Math.max(0, startOffset);
    let stableCutoff = startOffset;

    while (index < text.length) {
        if (startsWithAt(text, index, CODE_FENCE)) {
            const fenceEnd = findMatchingFenceEnd(text, index);
            if (fenceEnd === -1) break;
            stableCutoff = fenceEnd;
            index = fenceEnd;
            continue;
        }

        if (startsWithAt(text, index, TOOL_REQUEST_START)) {
            const endIndex = text.indexOf(TOOL_REQUEST_END, index + TOOL_REQUEST_START.length);
            if (endIndex === -1) break;
            stableCutoff = endIndex + TOOL_REQUEST_END.length;
            index = stableCutoff;
            continue;
        }

        const toolResultMarker = getToolResultMarkerAt(text, index);
        if (toolResultMarker) {
            const endIndex = text.indexOf(toolResultMarker.end, index + toolResultMarker.start.length);
            if (endIndex === -1) break;
            stableCutoff = endIndex + toolResultMarker.end.length;
            index = stableCutoff;
            continue;
        }

        if (startsWithAt(text, index, DESKTOP_PUSH_START)) {
            const endIndex = text.indexOf(DESKTOP_PUSH_END, index + DESKTOP_PUSH_START.length);
            if (endIndex === -1) break;
            stableCutoff = endIndex + DESKTOP_PUSH_END.length;
            index = stableCutoff;
            continue;
        }

        index += 1;
    }

    return stableCutoff;
}

/**
 * Get or refresh cached DOM references for a message.
 */
function getCachedMessageDom(messageId) {
    let cached = messageDomCache.get(messageId);

    if (cached) {
        // Verify that the cached DOM nodes are still attached.
        if (cached.messageItem.isConnected) {
            return cached;
        }
        // Drop invalid DOM cache entries.
        messageDomCache.delete(messageId);
    }
    // Re-query the DOM and refresh the cache.
    const { chatMessagesDiv } = refs;
    const messageItem = chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
    
    if (!messageItem) return null;
    
    const contentDiv = messageItem.querySelector('.md-content');
    if (!contentDiv) return null;
    
    cached = { messageItem, contentDiv };
    messageDomCache.set(messageId, cached);
    
    return cached;
}

/**
 * Sets up onload and onerror handlers for an emoticon image to fix its URL on error
 * and prevent flickering by controlling its visibility.
 * @param {HTMLImageElement} img The image element.
 */
function setupEmoticonHandlers(img) {
    img.onload = function() {
        this.style.visibility = 'visible';
        this.onload = null;
        this.onerror = null;
    };
    
    img.onerror = function() {
        // If a fix was already attempted, make it visible (as a broken image) and stop.
        if (this.dataset.emoticonFixAttempted === 'true') {
            this.style.visibility = 'visible';
            this.onload = null;
            this.onerror = null;
            return;
        }
        this.dataset.emoticonFixAttempted = 'true';
        
        const fixedSrc = refs.emoticonUrlFixer.fixEmoticonUrl(this.src);
        if (fixedSrc !== this.src) {
            this.src = fixedSrc; // This will re-trigger either onload or onerror
        } else {
            // If the URL can't be fixed, show the broken image and clean up handlers.
            this.style.visibility = 'visible';
            this.onload = null;
            this.onerror = null;
        }
    };
}

function processStreamTailImages(container) {
    if (!refs.emoticonUrlFixer || !container) return;

    const newImages = container.querySelectorAll('img[src*=\"\u8868\u60c5\u5305\"]:not([data-emoticon-handler-attached])');

    newImages.forEach(img => {
        img.dataset.emoticonHandlerAttached = 'true';
        img.style.visibility = 'hidden';

        if (img.complete && img.naturalWidth > 0) {
            img.style.visibility = 'visible';
        } else {
            setupEmoticonHandlers(img);
        }
    });
}

/**
 * Renders a single frame of the streaming message using morphdom for efficient DOM updates.
 * This version performs minimal processing to keep it fast and avoid destroying JS state.
 * @param {string} messageId The ID of the message.
 */
function renderStreamFrame(messageId) {
    // Prefer cached view membership when available.
    let isForCurrentView = viewContextCache.get(messageId);
    
    // Fall back to a live view check for uncached or restored messages.
    if (isForCurrentView === undefined) {
        const context = messageContextMap.get(messageId);
        isForCurrentView = isMessageForCurrentView(context);
        viewContextCache.set(messageId, isForCurrentView);
    }
    
    if (!isForCurrentView) return;

    // Use cached DOM references when possible.
    const cachedDom = getCachedMessageDom(messageId);
    if (!cachedDom) return;
    
    const { contentDiv } = cachedDom;
    const { stableRoot, tailRoot } = ensureStreamingRoots(contentDiv);
    const segmentState = getOrCreateStreamSegmentState(messageId);

    const textForRendering = accumulatedStreamText.get(messageId) || "";
    const nextStableCutoff = findExplicitStablePrefix(textForRendering, segmentState.stableCutoff);

    // Remove the temporary thinking indicator before painting streamed content.
    const streamingIndicator = contentDiv.querySelector('.streaming-indicator, .thinking-indicator');
    if (streamingIndicator) streamingIndicator.remove();

    if (nextStableCutoff > segmentState.stableCutoff) {
        const stableText = textForRendering.slice(0, nextStableCutoff);
        const processedStableText = applyStreamingPreprocessors(stableText);
        const stableHtml = refs.markedInstance.parse(processedStableText);
        stableRoot.innerHTML = stableHtml;
        segmentState.stableCutoff = nextStableCutoff;
        segmentState.stableHtml = stableHtml;
    }

    const tailText = textForRendering.slice(segmentState.stableCutoff);
    const processedText = applyStreamingPreprocessors(tailText);
    const rawHtml = refs.markedInstance.parse(processedText);

    if (refs.morphdom) {
        try {
            refs.morphdom(tailRoot, `<div>${rawHtml}</div>`, {
                childrenOnly: true,
                
                onBeforeElUpdated: function(fromEl, toEl) {
                // Skip identical nodes.
                if (fromEl.isEqualNode(toEl)) {
                    return false;
                }
                
                // Preserve runtime animation classes that do not exist in marked output.
                if (fromEl.classList.contains('unistudy-stream-element-fade-in')) {
                    toEl.classList.add('unistudy-stream-element-fade-in');
                }
                if (fromEl.classList.contains('unistudy-stream-content-pulse')) {
                    toEl.classList.add('unistudy-stream-content-pulse');
                }

                // Detect meaningful block-level growth and pulse the element once.
                if (/^(P|DIV|UL|OL|LI|PRE|BLOCKQUOTE|H[1-6]|TABLE|TR|FIGURE)$/.test(fromEl.tagName)) {
                    const oldLength = elementContentLengthCache.get(fromEl) || fromEl.textContent.length;
                    const newLength = toEl.textContent.length;
                    const lengthDiff = newLength - oldLength;
                    
                    // Trigger a pulse when content grows significantly.
                    if (lengthDiff > 20) {
                        // Use a pulse instead of a slide animation.
                        fromEl.classList.add('unistudy-stream-content-pulse');
                        setTimeout(() => {
                            fromEl.classList.remove('unistudy-stream-content-pulse');
                        }, 300);
                    }
                    
                    // Refresh the cached length.
                    elementContentLengthCache.set(fromEl, newLength);
                }
                
                // Preserve interactive button state.
                if (fromEl.tagName === 'BUTTON' && fromEl.dataset.vcpInteractive === 'true') {
                    if (fromEl.disabled) {
                        toEl.disabled = true;
                        toEl.style.opacity = fromEl.style.opacity;
                        toEl.textContent = fromEl.textContent; // Preserve completion markers.
                    }
                }
                
                // Preserve active media playback.
                if ((fromEl.tagName === 'VIDEO' || fromEl.tagName === 'AUDIO') && !fromEl.paused) {
                    return false; // Do not replace currently playing media.
                }
                
                // Preserve input focus.
                if (fromEl === document.activeElement) {
                    requestAnimationFrame(() => toEl.focus());
                }
                
                // Simplify image handling to state preservation only.
                if (fromEl.tagName === 'IMG') {
                    // Preserve the handler-attached flag.
                    if (fromEl.dataset.emoticonHandlerAttached) {
                        toEl.dataset.emoticonHandlerAttached = 'true';
                    }
                    if (fromEl.dataset.emoticonFixAttempted) {
                        toEl.dataset.emoticonFixAttempted = 'true';
                    }
                    
                    // Preserve DOM event handlers copied by morphdom.
                    if (fromEl.onerror && !toEl.onerror) {
                        toEl.onerror = fromEl.onerror;
                    }
                    if (fromEl.onload && !toEl.onload) {
                        toEl.onload = fromEl.onload;
                    }
                    
                    // Preserve visibility state.
                    if (fromEl.style.visibility) {
                        toEl.style.visibility = fromEl.style.visibility;
                    }
                    
                    // Do not replace images that have already loaded successfully.
                    if (fromEl.complete && fromEl.naturalWidth > 0) {
                        return false;
                    }
                }
                
                return true;
            },
            
            onBeforeNodeDiscarded: function(node) {
                // Keep nodes that are explicitly marked as persistent.
                if (node.classList?.contains('keep-alive')) {
                    return false;
                }
                return true;
            },
            
            onNodeAdded: function(node) {
                // Animate common block elements so list and table updates stay smooth.
                if (node.nodeType === 1 && /^(P|DIV|UL|OL|LI|PRE|BLOCKQUOTE|H[1-6]|TABLE|TR|FIGURE)$/.test(node.tagName)) {
                    // Mark new nodes for entry animation.
                    node.classList.add('unistudy-stream-element-fade-in');
                    
                    // Cache initial text length for later pulse detection.
                    elementContentLengthCache.set(node, node.textContent.length);
                    
                    // Remove the animation class after the DOM has settled.
                    setTimeout(() => {
                        if (node && node.classList) {
                            node.classList.remove('unistudy-stream-element-fade-in');
                        }
                    }, 1000);
                }
                return node;
            }
        });
        } catch (error) {
            // Catch morphdom failures caused by incomplete HTML while streaming.
            // This is expected mid-stream; a later chunk usually completes the structure.
            console.debug('[StreamManager] morphdom skipped frame due to incomplete HTML, waiting for more chunks...');
        }
    } else {
        tailRoot.innerHTML = rawHtml;
    }

    processStreamTailImages(stableRoot);
    processStreamTailImages(tailRoot);
    segmentState.lastTailText = tailText;
}

/**
 * Scroll-to-bottom helper with simple throttling.
 */
function throttledScrollToBottom(messageId) {
    if (scrollThrottleTimers.has(messageId)) {
        return; // Skip while the throttle window is active.
    }
    
    refs.uiHelper.scrollToBottom();
    
    const timerId = setTimeout(() => {
        scrollThrottleTimers.delete(messageId);
    }, SCROLL_THROTTLE_MS);
    
    scrollThrottleTimers.set(messageId, timerId);
}

function processAndRenderSmoothChunk(messageId) {
    const queue = streamingChunkQueues.get(messageId);
    if (!queue || queue.length === 0) return;

    const globalSettings = refs.globalSettingsRef.get();
    const minChunkSize = globalSettings.minChunkBufferSize !== undefined && globalSettings.minChunkBufferSize >= 1 ? globalSettings.minChunkBufferSize : 1;

    // Drain a small batch from the queue. The rendering uses the accumulated text,
    // so we don't need the return value here. This just advances the stream.
    let processedChars = 0;
    while (queue.length > 0 && processedChars < minChunkSize) {
        processedChars += queue.shift().length;
    }

    // Render the current state of the accumulated text using our lightweight method.
    renderStreamFrame(messageId);
    
    // Scroll if the message is in the current view.
    const context = messageContextMap.get(messageId);
    if (isMessageForCurrentView(context)) {
        throttledScrollToBottom(messageId);
    }
}

function renderChunkDirectlyToDOM(messageId, textToAppend) {
    // For non-smooth streaming, we just render the new frame immediately using the lightweight method.
    // The check for whether it's in the current view is handled inside renderStreamFrame.
    renderStreamFrame(messageId);
}

export async function startStreamingMessage(message, passedMessageItem = null) {
    const messageId = message.id;
    
    // Reuse the existing DOM node when initialization already matches the current thinking state.
    const currentStatus = messageInitializationStatus.get(messageId);
    const cached = getCachedMessageDom(messageId);
    const isCurrentlyThinking = cached?.messageItem?.classList.contains('thinking');

    if ((currentStatus === 'pending' || currentStatus === 'ready') && (isCurrentlyThinking === !!message.isThinking)) {
        console.debug(`[StreamManager] Message ${messageId} already initialized (${currentStatus}) with same thinking state, skipping re-init`);
        return cached?.messageItem || null;
    }

    // Store the context for this message - ensure proper context structure
    const context = {
        agentId: message.agentId || message.context?.agentId || refs.currentSelectedItemRef.get()?.id,
        topicId: message.topicId || message.context?.topicId || refs.currentTopicIdRef.get(),
        agentName: message.name || message.context?.agentName,
        avatarUrl: message.avatarUrl || message.context?.avatarUrl,
        avatarColor: message.avatarColor || message.context?.avatarColor,
    };
    
    // Validate context
    if (!context.topicId || !context.agentId) {
        console.error(`[StreamManager] Invalid context for message ${messageId}`, context);
        return null;
    }
    
    messageContextMap.set(messageId, context);
    
    // Avoid resetting an already initialized message back to pending.
    if (!currentStatus || currentStatus === 'finalized') {
        messageInitializationStatus.set(messageId, 'pending');
    }
    
    activeStreamingMessageId = messageId;
    
    const { chatMessagesDiv, electronAPI, currentChatHistoryRef, uiHelper } = refs;
    const isForCurrentView = isMessageForCurrentView(context);
    // Cache the current view result for later frames.
    viewContextCache.set(messageId, isForCurrentView);
    
    // Get the correct history for this message's context
    let historyForThisMessage;
    if (isForCurrentView) {
        historyForThisMessage = currentChatHistoryRef.get();
    } else {
        // For background chats, load from disk
        historyForThisMessage = await getHistoryForContext(context);
        if (!historyForThisMessage) {
            console.error(`[StreamManager] Could not load history for background message ${messageId}`, context);
            messageInitializationStatus.set(messageId, 'finalized');
            return null;
        }
    }
    // Only manipulate the DOM when the message belongs to the visible view.
    let messageItem = null;
    if (isForCurrentView) {
        messageItem = passedMessageItem || chatMessagesDiv.querySelector(`.message-item[data-message-id="${message.id}"]`);
        if (!messageItem) {
            const placeholderMessage = {
                ...message,
                content: message.content || '\u601d\u8003\u4e2d...',
                isThinking: true,
                timestamp: message.timestamp || Date.now()
            };
            messageItem = refs.renderMessage(placeholderMessage, false);
            if (!messageItem) {
                console.error(`[StreamManager] Failed to render message item for ${message.id}`);
                messageInitializationStatus.set(messageId, 'finalized');
                return null;
            }
        }

        if (messageItem.classList) {
            messageItem.classList.add('streaming');
            messageItem.classList.remove('thinking');
        }
    }

    // Initialize streaming state
    if (shouldEnableSmoothStreaming()) {
        if (!streamingChunkQueues.has(messageId)) {
            streamingChunkQueues.set(messageId, []);
        }
    }
    
    // Prefer the longer accumulated text unless we are still holding a placeholder.
    const existingText = accumulatedStreamText.get(messageId);
    const newText = isThinkingPlaceholderText(message.content) ? '' : (message.content || '');
    const shouldOverwrite = !existingText
        || isThinkingPlaceholderText(existingText)
        || newText.length > existingText.length;
    
    if (shouldOverwrite) {
        accumulatedStreamText.set(messageId, newText);
    }
    
    // Prepare placeholder for history
    const placeholderForHistory = {
        ...message,
        content: newText,
        isThinking: false,
        timestamp: message.timestamp || Date.now(),
        name: context.agentName,
        agentId: context.agentId
    };
    
    // Update the appropriate history
    const historyIndex = historyForThisMessage.findIndex(m => m.id === message.id);
    if (historyIndex === -1) {
        historyForThisMessage.push(placeholderForHistory);
    } else {
        historyForThisMessage[historyIndex] = { ...historyForThisMessage[historyIndex], ...placeholderForHistory };
    }
    
    // Save the history
    if (isForCurrentView) {
        // Update in-memory reference for current view
        currentChatHistoryRef.set([...historyForThisMessage]);
        window.updateSendButtonState?.();
    }
    
    // Save history through the debounced writer.
    debouncedSaveHistory(context, historyForThisMessage);
    
    // Initialization is complete, message is ready to process chunks.
    messageInitializationStatus.set(messageId, 'ready');
    
    // Process any chunks that were pre-buffered during initialization.
    const bufferedChunks = preBufferedChunks.get(messageId);
    if (bufferedChunks && bufferedChunks.length > 0) {
        console.debug(`[StreamManager] Processing ${bufferedChunks.length} pre-buffered chunks for message ${messageId}`);
        for (const chunkData of bufferedChunks) {
            appendStreamChunk(messageId, chunkData.chunk, chunkData.context);
        }
        preBufferedChunks.delete(messageId);
    }
    
    if (isForCurrentView) {
        // If the message leaves thinking mode, rerender immediately to clear the placeholder.
        if (!message.isThinking && isCurrentlyThinking) {
            renderStreamFrame(messageId);
        }
        uiHelper.scrollToBottom();
    }
    
    return messageItem;
}

// Global render loop used instead of one timer per message.
let lastFrameTime = 0;
const TARGET_FPS = 30; // 30fps is enough for streaming updates.
const FRAME_INTERVAL = 1000 / TARGET_FPS;

function startGlobalRenderLoop() {
    if (globalRenderLoopRunning) return;

    globalRenderLoopRunning = true;
    lastFrameTime = 0; // Reset the frame timestamp.

    function renderLoop(currentTime) {
        if (streamingTimers.size === 0) {
            globalRenderLoopRunning = false;
            return;
        }

        // Enforce the target frame rate.
        if (!currentTime) { // Fallback for browsers that don't pass currentTime
            currentTime = performance.now();
        }
        if (!lastFrameTime) {
            lastFrameTime = currentTime;
        }
        const elapsed = currentTime - lastFrameTime;
        if (elapsed < FRAME_INTERVAL) {
            requestAnimationFrame(renderLoop);
            return;
        }

        lastFrameTime = currentTime - (elapsed % FRAME_INTERVAL); // More accurate timing

        // Process all active streaming messages.
        for (const [messageId, _] of streamingTimers) {
            processAndRenderSmoothChunk(messageId);

            const currentQueue = streamingChunkQueues.get(messageId);
            if ((!currentQueue || currentQueue.length === 0) && messageIsFinalized(messageId)) {
                streamingTimers.delete(messageId);

                const storedContext = messageContextMap.get(messageId);
                const isForCurrentView = viewContextCache.get(messageId) ?? isMessageForCurrentView(storedContext);

                if (isForCurrentView) {
                    const finalMessageItem = getCachedMessageDom(messageId)?.messageItem;
                    if (finalMessageItem) finalMessageItem.classList.remove('streaming');
                }

                streamingChunkQueues.delete(messageId);
            }
        }

        requestAnimationFrame(renderLoop);
    }

    requestAnimationFrame(renderLoop);
}

/**
 * Split streamed text by semantic units rather than individual characters.
 */
function intelligentChunkSplit(text) {
    const MIN_SPLIT_SIZE = 20;
    const MAX_CHUNK_SIZE = 10; // Maximum semantic units per chunk.

    if (text.length < MIN_SPLIT_SIZE) {
        return [text];
    }

    // matchAll keeps the tokenizer concise and fast enough here.
    const regex = /[\u4e00-\u9fa5]+|[a-zA-Z0-9]+|[^\u4e00-\u9fa5a-zA-Z0-9\s]+|\s+/g;
    const semanticUnits = [...text.matchAll(regex)].map(m => m[0]);

    // Merge semantic units into reasonably sized chunks.
    const chunks = [];
    let currentChunk = '';

    for (const unit of semanticUnits) {
        if (currentChunk.length + unit.length > MAX_CHUNK_SIZE) {
            if (currentChunk) { // Avoid pushing empty strings
                chunks.push(currentChunk);
            }
            currentChunk = unit;
        } else {
            currentChunk += unit;
        }
    }

    if (currentChunk) chunks.push(currentChunk);

    return chunks;
}

/**
 * Desktop-push streaming interceptor.
 * It captures <<<[DESKTOP_PUSH]>>> blocks from token flow and forwards them live.
 *
 * Tool-result blocks do not need extra protection here because:
 * 1. They arrive as a single assembled block rather than token-by-token text.
 * 2. preprocessFullContent already protects them with toolResultMap.
 * 3. Character-level tool-result parsing here would conflict with push marker detection.
 */
function processDesktopPushToken(_messageId, textToAppend) {
    return textToAppend;
}
/**
 * Reset desktop-push state tracked for a message.
 */
function cleanupDesktopPushState(_messageId) {}


export function appendStreamChunk(messageId, chunkData, context) {
    const initStatus = messageInitializationStatus.get(messageId);
    
    if (!initStatus || initStatus === 'pending') {
        if (!preBufferedChunks.has(messageId)) {
            preBufferedChunks.set(messageId, []);
        }
        const buffer = preBufferedChunks.get(messageId);
        buffer.push({ chunk: chunkData, context });
        
        // Guard against unbounded pre-buffer growth if initialization stalls.
        if (buffer.length > 1000) {
            console.warn(`[StreamManager] Pre-buffer overflow for ${messageId}, discarding old chunks.`);
            buffer.splice(0, buffer.length - 1000); // Keep only the newest 1000 buffered chunks.
            return;
        }
        return;
    }
    
    if (initStatus === 'finalized') {
        console.warn(`[StreamManager] Received chunk for already finalized message ${messageId}. Ignoring.`);
        return;
    }
    
    // Extract text from chunk
    // Drop malformed JSON chunks silently; they are only useful for diagnostics.
    if (chunkData?.error === 'json_parse_error') {
        console.warn(`[StreamManager] Filtered JSON parse error chunk for messageId: ${messageId}`, chunkData.raw);
        return;
    }
    
    let textToAppend = "";
    if (chunkData?.choices?.[0]?.delta?.content) {
        textToAppend = chunkData.choices[0].delta.content;
    } else if (chunkData?.delta?.content) {
        textToAppend = chunkData.delta.content;
    } else if (typeof chunkData?.content === 'string') {
        textToAppend = chunkData.content;
    } else if (typeof chunkData?.message?.content === 'string') {
        textToAppend = chunkData.message.content;
    } else if (typeof chunkData === 'string') {
        textToAppend = chunkData;
    } else if (chunkData?.raw && !chunkData?.error) {
        // Surface raw payloads only when the chunk is not already flagged as an error.
        textToAppend = chunkData.raw;
    }
    
    if (!textToAppend) return;

    // Intercept desktop-push markers before they are appended to accumulated text.
    // The returned value only contains normal message text.
    const normalText = processDesktopPushToken(messageId, textToAppend);
    
    // Keep the raw accumulated text intact so final transforms can still see the full marker stream.
    let currentAccumulated = accumulatedStreamText.get(messageId) || "";
    currentAccumulated += textToAppend; // Preserve full text for final rendering.
    accumulatedStreamText.set(messageId, currentAccumulated);
    
    // Update context if provided
    if (context) {
        const storedContext = messageContextMap.get(messageId);
        if (storedContext) {
            if (context.agentName) storedContext.agentName = context.agentName;
            if (context.agentId) storedContext.agentId = context.agentId;
            messageContextMap.set(messageId, storedContext);
        }
    }
    
    if (shouldEnableSmoothStreaming()) {
        const queue = streamingChunkQueues.get(messageId);
        if (queue) {
            // Use semantic chunk splitting for smoother streaming.
            const semanticChunks = intelligentChunkSplit(textToAppend);
            for (const chunk of semanticChunks) {
                queue.push(chunk);
            }
        } else {
            renderChunkDirectlyToDOM(messageId, textToAppend);
            return;
        }
        
        // Use the global loop instead of per-message timers.
        if (!streamingTimers.has(messageId)) {
            streamingTimers.set(messageId, true); // Marker only; no timer id is stored.
            startGlobalRenderLoop(); // Start or keep the shared render loop alive.
        }
    } else {
        renderChunkDirectlyToDOM(messageId, textToAppend);
    }
}

export async function finalizeStreamedMessage(messageId, finishReason, context, finalPayload = null) {
    // With the global render loop, we no longer need to manually drain the queue here or clear timers.
    // The loop will continue to process chunks until the queue is empty and the message is finalized, then clean itself up.
    if (activeStreamingMessageId === messageId) {
        activeStreamingMessageId = null;
    }
    
    // Clear any pending scroll throttle timer.
    const scrollTimer = scrollThrottleTimers.get(messageId);
    if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollThrottleTimers.delete(messageId);
    }
    
    messageInitializationStatus.set(messageId, 'finalized');
    
    // Get the stored context for this message
    const storedContext = messageContextMap.get(messageId) || context;
    if (!storedContext) {
        console.error(`[StreamManager] No context available for message ${messageId}`);
        return;
    }
    
    const { chatMessagesDiv, markedInstance, uiHelper } = refs;
    const isForCurrentView = isMessageForCurrentView(storedContext);
    
    // Get the correct history
    let historyForThisMessage = await getHistoryForContext(storedContext);
    if (!historyForThisMessage) {
        console.error('[StreamManager] Could not load history for finalization', storedContext);
        return;
    }
    
    // Find and update the message
    const accumulatedText = accumulatedStreamText.get(messageId) || "";
    const cleanedAccumulatedText = stripThinkingPlaceholderPrefix(accumulatedText);
    const payloadFullResponse = typeof finalPayload?.fullResponse === 'string' ? finalPayload.fullResponse : "";
    const payloadError = typeof finalPayload?.error === 'string' ? finalPayload.error.trim() : "";
    const streamedTextIsUsable = cleanedAccumulatedText.trim() !== "" && !isThinkingPlaceholderText(cleanedAccumulatedText);
    const payloadResponseIsUsable = payloadFullResponse.trim() !== "" && !isThinkingPlaceholderText(payloadFullResponse);

    let finalFullText = cleanedAccumulatedText;
    
    // --- Consistency Logic: Choose the most complete text available ---
    // If the main process payload has more content (as in error recovery) or is explicitly marked as recovery, prefer it.
    if (payloadResponseIsUsable && (
        !streamedTextIsUsable
        || payloadFullResponse.length >= cleanedAccumulatedText.length
        || cleanedAccumulatedText !== accumulatedText
        || payloadFullResponse.includes('[!WARNING]')
    )) {
        finalFullText = payloadFullResponse;
    }

    if (!finalFullText || isThinkingPlaceholderText(finalFullText)) {
        if (payloadError) {
            finalFullText = `[System Error] ${payloadError}`;
        } else {
            finalFullText = "";
        }
    }
    const messageIndex = historyForThisMessage.findIndex(msg => msg.id === messageId);
    
    if (messageIndex === -1) {
        console.error(`[StreamManager] Message ${messageId} not found in history`, storedContext);
        return;
    }
    
    const message = historyForThisMessage[messageIndex];
    message.content = finalFullText;
    message.finishReason = finishReason;
    message.isThinking = false;
    
    // Update UI if it's the current view
    if (isForCurrentView) {
        refs.currentChatHistoryRef.set([...historyForThisMessage]);

        const messageItem = chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
        if (messageItem) {
            messageItem.classList.remove('streaming', 'thinking');

            const contentDiv = messageItem.querySelector('.md-content');
            if (contentDiv) {
                contentDiv.querySelectorAll('.unistudy-stream-stable-root, .unistudy-stream-tail-root').forEach((el) => el.remove());

                const globalSettings = refs.globalSettingsRef.get();
                // Use the more thorough preprocessFullContent for the final render
                const processedFinalText = refs.preprocessFullContent(finalFullText, globalSettings);
                const rawHtml = markedInstance.parse(processedFinalText);
                
                // Perform the final, high-quality render using the original global refresh method.
                // This ensures images, KaTeX, code highlighting, etc., are all processed correctly.
                refs.setContentAndProcessImages(contentDiv, rawHtml, messageId);
                
                // Step 1: Run synchronous processors (KaTeX, hljs, etc.)
                refs.processRenderedContent(contentDiv);

                // Step 2: Defer TreeWalker-based highlighters to ensure DOM is stable
                setTimeout(() => {
                    if (contentDiv && contentDiv.isConnected) {
                        refs.runTextHighlights(contentDiv);
                    }
                }, 0);

                // Step 3: Process animations, scripts, and 3D scenes
                if (refs.processAnimationsInContent) {
                    refs.processAnimationsInContent(contentDiv);
                }
            }
            
            const nameTimeBlock = messageItem.querySelector('.name-time-block');
            if (nameTimeBlock && !nameTimeBlock.querySelector('.message-timestamp')) {
                const timestampDiv = document.createElement('div');
                timestampDiv.classList.add('message-timestamp');
                timestampDiv.textContent = formatMessageTimestamp(message.timestamp || Date.now());
                nameTimeBlock.appendChild(timestampDiv);
            }

            uiHelper.scrollToBottom();
        }

        window.updateSendButtonState?.();
    }
    
    // Save history through the debounced writer.
    debouncedSaveHistory(storedContext, historyForThisMessage);
    
    // Cleanup
    streamingChunkQueues.delete(messageId);
    accumulatedStreamText.delete(messageId);
    streamSegmentStates.delete(messageId);
    cleanupDesktopPushState(messageId);
    
    // Delayed cleanup
    setTimeout(() => {
        messageDomCache.delete(messageId);
        messageInitializationStatus.delete(messageId);
        preBufferedChunks.delete(messageId);
        messageContextMap.delete(messageId);
        viewContextCache.delete(messageId);
    }, 5000);
}

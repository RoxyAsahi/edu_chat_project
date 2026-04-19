import { getReaderLocatorLabel } from '../reader/readerUtils.js';
import {
    buildAttachmentTransferPayload,
    buildKnowledgeBaseQuery,
    buildSelectionContextTemporaryMessages,
    normalizeAttachmentList,
    normalizeStoredAttachment,
    resolveComposerAvailabilityState,
    resolveComposerSendAction,
} from './composerUtils.js';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inferImageMimeTypeFromName(fileName = '') {
    const normalized = String(fileName || '').trim().toLowerCase();
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
    if (normalized.endsWith('.gif')) return 'image/gif';
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.bmp')) return 'image/bmp';
    if (normalized.endsWith('.svg')) return 'image/svg+xml';
    return 'image/png';
}

function isEmoticonAttachment(attachment = {}) {
    const renderPath = typeof attachment?.renderPath === 'string' ? attachment.renderPath.trim() : '';
    if (!renderPath) {
        return false;
    }

    return attachment?.attachmentKind === 'emoticon'
        || Boolean(attachment?.emoticonId)
        || Boolean(attachment?.emoticonCategory)
        || attachment?.source === 'bundled';
}

function buildEmoticonMarkup(renderPath = '', width = 80) {
    const normalizedPath = String(renderPath || '').trim();
    if (!normalizedPath) {
        return '';
    }

    return `<img src="${normalizedPath}" width="${width}">`;
}

function createComposerController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const interruptRequest = deps.interruptRequest || (async () => ({ success: false, error: 'Interrupt unavailable' }));
    const messageRendererApi = deps.messageRendererApi;
    const createId = deps.createId || ((prefix) => `${prefix}_${Date.now()}`);
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const loadTopics = deps.loadTopics || (async () => {});
    const loadAgents = deps.loadAgents || (async () => {});
    const buildTopicContext = deps.buildTopicContext || (() => ({}));
    const persistHistory = deps.persistHistory || (async () => {});
    const resolveLivePrompt = deps.resolveLivePrompt || (async () => '');
    const autoResizeTextarea = deps.autoResizeTextarea || (() => {});
    const decorateChatMessages = deps.decorateChatMessages || (() => {});
    const generateFollowUpsForAssistantMessage = deps.generateFollowUpsForAssistantMessage || (async () => []);
    const generateTopicTitleForAssistantMessage = deps.generateTopicTitleForAssistantMessage || (async () => '');
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);
    const getGlobalSettings = deps.getGlobalSettings || (() => store.getState().settings.settings);
    const defaultSendButtonHtml = deps.defaultSendButtonHtml ?? (el.sendMessageBtn?.innerHTML || '');
    const interruptSendButtonHtml = deps.interruptSendButtonHtml || `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect>
    </svg>
`;

    function getComposerSlice() {
        return store.getState().composer;
    }

    function patchComposer(patch) {
        return store.patchState('composer', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        pendingAttachments: {
            get: () => getComposerSlice().pendingAttachments,
            set: (value) => patchComposer({ pendingAttachments: value }),
        },
        pendingSelectionContextRefs: {
            get: () => getComposerSlice().pendingSelectionContextRefs,
            set: (value) => patchComposer({ pendingSelectionContextRefs: value }),
        },
        activeRequestId: {
            get: () => getComposerSlice().activeRequestId,
            set: (value) => patchComposer({ activeRequestId: value }),
        },
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: null, avatarUrl: null, config: null },
        },
        currentTopicId: {
            get: () => getCurrentTopicId(),
        },
        currentChatHistory: {
            get: () => {
                const history = getCurrentChatHistory();
                return Array.isArray(history) ? history : [];
            },
        },
        settings: {
            get: () => getGlobalSettings() || {},
        },
    });

    function refreshAttachmentPreview() {
        ui.updateAttachmentPreview(state.pendingAttachments, el.attachmentPreviewArea);
    }

    function syncComposerAvailability() {
        const availability = resolveComposerAvailabilityState({
            hasAgentId: Boolean(state.currentSelectedItem.id),
            hasTopicId: Boolean(state.currentTopicId),
            activeRequestId: state.activeRequestId,
        });

        el.messageInput.disabled = availability.disableInput;
        el.attachFileBtn.disabled = availability.disableAttachments;
        el.emoticonTriggerBtn.disabled = availability.disableEmoticons;
        el.composerQuickNewTopicBtn.disabled = availability.disableQuickNewTopic;
        el.sendMessageBtn.disabled = availability.disableSend;

        if (availability.shouldClearDragOver) {
            el.chatInputCard?.classList.remove('drag-over');
        }

        return availability;
    }

    function clearPendingSelectionContext() {
        state.pendingSelectionContextRefs = [];
        renderSelectionContextPreview();
    }

    function injectSelection(selection) {
        state.pendingSelectionContextRefs = selection ? [{ ...selection }] : [];
        renderSelectionContextPreview();
    }

    function renderSelectionContextPreview() {
        if (!el.selectionContextPreview) {
            return;
        }

        const current = state.pendingSelectionContextRefs[0] || null;
        if (!current) {
            el.selectionContextPreview.innerHTML = '';
            el.selectionContextPreview.classList.add('hidden');
            return;
        }

        el.selectionContextPreview.classList.remove('hidden');
        el.selectionContextPreview.innerHTML = `
        <div>
            <strong>本轮已注入 1 段资料上下文</strong>
            <div>${escapeHtml(current.documentName || '未知文档')} · ${escapeHtml(getReaderLocatorLabel(current))}</div>
            <div>${escapeHtml(current.selectionText || current.snippet || '')}</div>
        </div>
        <button type="button" class="ghost-button icon-text-btn" data-selection-context-action="clear">
            <span class="material-symbols-outlined">close</span> 清空
        </button>
    `;

        el.selectionContextPreview.querySelector('[data-selection-context-action="clear"]')
            ?.addEventListener('click', () => clearPendingSelectionContext());
    }

    function summarizeAttachmentErrors(results) {
        const failures = results.filter((item) => item?.error);
        if (failures.length === 0) {
            return;
        }

        const names = failures.map((item) => item.name || 'Unknown file').join(', ');
        ui.showToastNotification(`部分附件导入失败：${names}`, 'warning', 4500);
    }

    function appendStoredAttachments(attachments) {
        const normalized = normalizeAttachmentList(attachments);
        if (normalized.length === 0) {
            return;
        }

        state.pendingAttachments = [...state.pendingAttachments, ...normalized];
        refreshAttachmentPreview();
    }

    async function addEmoticonAttachment(emoticon = {}) {
        const previewSrc = typeof emoticon?.url === 'string' ? emoticon.url.trim() : '';
        if (!previewSrc) {
            return { success: false, error: '表情资源地址无效。' };
        }

        const fileName = typeof emoticon?.filename === 'string' && emoticon.filename.trim()
            ? emoticon.filename.trim()
            : `${String(emoticon?.name || 'emoticon').trim() || 'emoticon'}.png`;
        const attachment = normalizeStoredAttachment({
            id: `emoticon_attachment_${String(emoticon?.id || Date.now())}_${Date.now()}`,
            name: fileName,
            originalName: fileName,
            type: inferImageMimeTypeFromName(fileName),
            src: previewSrc,
            internalPath: previewSrc.startsWith('file://') ? previewSrc : '',
            attachmentKind: 'emoticon',
            renderPath: typeof emoticon?.renderPath === 'string' ? emoticon.renderPath : '',
            emoticonId: typeof emoticon?.id === 'string' ? emoticon.id : '',
            emoticonCategory: typeof emoticon?.category === 'string' ? emoticon.category : '',
            source: typeof emoticon?.source === 'string' ? emoticon.source : 'emoticon',
        });

        if (!attachment) {
            return { success: false, error: '表情附件创建失败。' };
        }

        appendStoredAttachments([attachment]);
        el.messageInput?.focus?.();

        return {
            success: true,
            attachment,
        };
    }

    function resetState(options = {}) {
        const {
            clearAttachments = true,
            clearSelectionContext = true,
            syncAvailability = true,
        } = options;

        if (clearAttachments) {
            state.pendingAttachments = [];
            refreshAttachmentPreview();
        }

        if (clearSelectionContext) {
            state.pendingSelectionContextRefs = [];
            renderSelectionContextPreview();
        }

        if (syncAvailability) {
            syncComposerAvailability();
        }
    }

    function getComposerContext() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return null;
        }

        return {
            agentId: state.currentSelectedItem.id,
            topicId: state.currentTopicId,
        };
    }

    async function getNativePathForFile(file) {
        if (!file) {
            return '';
        }

        if (typeof file.path === 'string' && file.path.trim()) {
            return file.path.trim();
        }

        if (typeof windowObj.electronPath?.getPathForFile === 'function') {
            const nativePath = await windowObj.electronPath.getPathForFile(file);
            if (typeof nativePath === 'string' && nativePath.trim()) {
                return nativePath.trim();
            }
        }

        return '';
    }

    async function fileToTransferPayload(file, index = 0) {
        const nativePath = await getNativePathForFile(file);
        const buffer = nativePath ? null : new Uint8Array(await file.arrayBuffer());
        return buildAttachmentTransferPayload({
            fileName: file?.name,
            fileType: file?.type,
            nativePath,
            buffer,
            index,
        });
    }

    async function addFiles(filesOrList, source = 'drop') {
        const context = getComposerContext();
        if (!context) {
            return;
        }

        if (source === 'picker') {
            const result = await chatAPI.selectFilesToSend(context.agentId, context.topicId);
            if (!result?.success) {
                if (result?.error) {
                    ui.showToastNotification(`添加附件失败：${result.error}`, 'error');
                }
                return;
            }

            const attachments = Array.isArray(result.attachments)
                ? result.attachments.filter((item) => !item?.error)
                : [];
            appendStoredAttachments(attachments);
            summarizeAttachmentErrors(Array.isArray(result.attachments) ? result.attachments : []);
            return;
        }

        const files = Array.from(filesOrList || []);
        if (files.length === 0) {
            return;
        }

        const payload = await Promise.all(files.map((file, index) => fileToTransferPayload(file, index)));
        const result = await chatAPI.handleFileDrop(context.agentId, context.topicId, payload);
        const entries = Array.isArray(result) ? result : [];
        const attachments = entries
            .filter((item) => item?.success && item.attachment)
            .map((item) => item.attachment);

        appendStoredAttachments(attachments);
        summarizeAttachmentErrors(entries);
    }

    function materializeAttachments() {
        return normalizeAttachmentList(state.pendingAttachments);
    }

    async function buildApiMessages(options = {}) {
        const temporarySystemMessages = Array.isArray(options.temporarySystemMessages)
            ? options.temporarySystemMessages.filter((item) => item && item.content)
            : [];
        const history = Array.isArray(options.historyOverride)
            ? options.historyOverride
            : state.currentChatHistory;
        const agentId = typeof options.agentIdOverride === 'string' && options.agentIdOverride
            ? options.agentIdOverride
            : state.currentSelectedItem.id;
        const activePrompt = await chatAPI.getActiveSystemPrompt(agentId).catch(() => ({ success: false, systemPrompt: '' }));
        const livePrompt = await resolveLivePrompt();
        const systemPrompt = livePrompt || (activePrompt?.success ? activePrompt.systemPrompt : '');
        const messages = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        for (const temporaryMessage of temporarySystemMessages) {
            messages.push(temporaryMessage);
        }

        for (const message of history.filter((item) => !item.isThinking)) {
            if (message.role !== 'user') {
                messages.push({ role: message.role, content: message.content, name: message.name });
                continue;
            }

            if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
                messages.push({ role: 'user', content: message.content });
                continue;
            }

            const parts = [];
            if (message.content?.trim()) {
                parts.push({ type: 'text', text: message.content });
            }

            for (const attachment of normalizeAttachmentList(message.attachments)) {
                if (isEmoticonAttachment(attachment)) {
                    const emoticonMarkup = buildEmoticonMarkup(attachment.renderPath, 80);
                    if (emoticonMarkup) {
                        parts.push({ type: 'text', text: emoticonMarkup });
                        continue;
                    }
                }

                if (attachment.type?.startsWith('image/')) {
                    const fileResult = await chatAPI.getFileAsBase64(attachment.internalPath || attachment.src).catch(() => null);
                    const base64Frames = Array.isArray(fileResult?.base64Frames) ? fileResult.base64Frames : [];

                    if (base64Frames.length > 0) {
                        base64Frames.forEach((frame) => {
                            parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                        });
                        continue;
                    }

                    if (attachment.src?.startsWith('data:')) {
                        parts.push({ type: 'image_url', image_url: { url: attachment.src } });
                        continue;
                    }

                    parts.push({ type: 'text', text: `Image attachment: ${attachment.name}` });
                    continue;
                }

                if (Array.isArray(attachment.imageFrames) && attachment.imageFrames.length > 0) {
                    attachment.imageFrames.forEach((frame) => {
                        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                    });
                    if (attachment.extractedText) {
                        parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
                    }
                } else if (attachment.extractedText) {
                    parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
                } else {
                    parts.push({ type: 'text', text: `Attachment reference: ${attachment.name}` });
                }
            }

            messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
        }

        return messages;
    }

    async function buildKnowledgeBaseRetrieval(userMessage, topicOverride = null) {
        const currentTopic = topicOverride || getCurrentTopic();
        const kbId = currentTopic?.knowledgeBaseId;
        const query = buildKnowledgeBaseQuery(userMessage);

        if (!kbId || !query) {
            return {
                refs: [],
                temporarySystemMessages: [],
            };
        }

        const result = await chatAPI.retrieveKnowledgeBaseContext({
            kbId,
            query,
        }).catch((error) => ({
            success: false,
            error: error.message,
            refs: [],
            contextText: '',
        }));

        if (!result?.success) {
            ui.showToastNotification(`跳过 Source 检索：${result?.error || '未知错误'}`, 'warning', 4500);
            return {
                refs: [],
                temporarySystemMessages: [],
            };
        }

        return {
            refs: Array.isArray(result.refs) ? result.refs : [],
            temporarySystemMessages: result.contextText
                ? [{ role: 'system', content: result.contextText }]
                : [],
        };
    }

    function updateSendButtonState() {
        const interrupting = Boolean(state.activeRequestId);
        el.sendMessageBtn.dataset.mode = interrupting ? 'interrupt' : 'send';
        el.sendMessageBtn.classList.toggle('interrupt-mode', interrupting);
        el.sendMessageBtn.innerHTML = interrupting ? interruptSendButtonHtml : defaultSendButtonHtml;
        el.sendMessageBtn.title = interrupting ? '中止回复' : '发送消息';
        syncComposerAvailability();
    }

    function setActiveRequestId(requestId = null) {
        state.activeRequestId = requestId || null;
        updateSendButtonState();
    }

    function patchCurrentHistoryMessage(messageId, updater) {
        let nextMessage = null;
        updateCurrentChatHistory((history = []) => history.map((item) => {
            if (item?.id !== messageId) {
                return item;
            }

            nextMessage = updater({ ...item });
            return nextMessage;
        }));
        return nextMessage;
    }

    function isCurrentViewContext(context = {}) {
        return context?.agentId === state.currentSelectedItem.id
            && context?.topicId === state.currentTopicId;
    }

    function buildTurnContextSnapshot(topic = null) {
        return {
            selectedItem: {
                ...state.currentSelectedItem,
                config: state.currentSelectedItem?.config ? { ...state.currentSelectedItem.config } : null,
            },
            topicId: state.currentTopicId,
            topicName: topic?.name || getCurrentTopic()?.name || '',
            settings: { ...state.settings },
        };
    }

    function buildRequestContext(snapshot, extra = {}) {
        return {
            agentId: snapshot?.selectedItem?.id || '',
            topicId: snapshot?.topicId || '',
            agentName: snapshot?.selectedItem?.name || '',
            avatarUrl: snapshot?.selectedItem?.avatarUrl || '',
            avatarColor: snapshot?.selectedItem?.config?.avatarCalculatedColor || null,
            isGroupMessage: false,
            ...extra,
        };
    }

    function selectVisibleConversationMessages(history = []) {
        return (Array.isArray(history) ? history : [])
            .filter((message) => (
                message
                && (message.role === 'user' || message.role === 'assistant')
                && message.isThinking !== true
            ));
    }

    function shouldAttemptTopicTitleGeneration(messageId = '', historySnapshot = null) {
        if (state.settings.enableTopicTitleGeneration === false) {
            return false;
        }

        if (!Array.isArray(historySnapshot)) {
            return true;
        }

        const visibleMessages = selectVisibleConversationMessages(historySnapshot);
        return visibleMessages.length === 2
            && visibleMessages[0]?.role === 'user'
            && visibleMessages[1]?.role === 'assistant'
            && visibleMessages[1]?.id === messageId;
    }

    function triggerPostReplyTasks({
        agentId = '',
        topicId = '',
        messageId = '',
        model = '',
        historySnapshot = null,
    }) {
        const tasks = [
            generateFollowUpsForAssistantMessage({
                agentId,
                topicId,
                messageId,
                model,
                historySnapshot,
            }),
        ];

        if (shouldAttemptTopicTitleGeneration(messageId, historySnapshot)) {
            tasks.push(generateTopicTitleForAssistantMessage({
                agentId,
                topicId,
                messageId,
                model,
                historySnapshot,
            }));
        }

        void Promise.allSettled(tasks);
    }

    function applyAssistantResponseMetadata(messageId, payload = {}) {
        if (!messageId) {
            return;
        }

        const unresolvedTokens = Array.isArray(payload?.promptVariableResolution?.unresolvedTokens)
            ? payload.promptVariableResolution.unresolvedTokens
            : [];
        if (unresolvedTokens.length > 0) {
            ui.showToastNotification(`提示词变量未解析：${unresolvedTokens.join(', ')}`, 'warning', 5000);
        }

        patchCurrentHistoryMessage(messageId, (entry) => ({
            ...entry,
            toolEvents: Array.isArray(payload?.toolEvents) ? payload.toolEvents : (entry.toolEvents || []),
            studyMemoryRefs: Array.isArray(payload?.studyMemoryRefs) ? payload.studyMemoryRefs : (entry.studyMemoryRefs || []),
        }));
    }

    async function submitTurn({
        text,
        attachments = [],
        selectionContextRefs = [],
        clearComposerDraft = false,
        topicOverride = null,
    }) {
        const trimmedText = String(text || '').trim();
        const requestTopic = topicOverride || getCurrentTopic();
        const requestContext = buildTurnContextSnapshot(requestTopic);
        if (!requestContext.selectedItem.id || !requestContext.topicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }

        const userMessage = {
            id: createId('user'),
            role: 'user',
            content: trimmedText,
            timestamp: Date.now(),
            attachments: normalizeAttachmentList(attachments),
            selectionContextRefs: Array.isArray(selectionContextRefs)
                ? selectionContextRefs.map((item) => ({ ...item }))
                : [],
        };

        updateCurrentChatHistory((history = []) => [...history, userMessage]);
        await persistHistory();
        await messageRendererApi.renderMessage(userMessage, false, true);
        decorateChatMessages();

        if (clearComposerDraft) {
            el.messageInput.value = '';
            autoResizeTextarea(el.messageInput);
            resetState({
                clearAttachments: true,
                clearSelectionContext: true,
                syncAvailability: false,
            });
        }

        const assistantMessage = {
            id: createId('assistant'),
            role: 'assistant',
            name: requestContext.selectedItem.name,
            agentId: requestContext.selectedItem.id,
            avatarUrl: requestContext.selectedItem.avatarUrl,
            avatarColor: requestContext.selectedItem.config?.avatarCalculatedColor || null,
            content: 'Thinking',
            timestamp: Date.now(),
            isThinking: true,
            topicId: requestContext.topicId,
            toolEvents: [],
            studyMemoryRefs: [],
        };

        const retrieval = await buildKnowledgeBaseRetrieval(userMessage, requestTopic);
        const selectionRefsForCitation = userMessage.selectionContextRefs.map((ref) => ({
            ...ref,
            score: null,
            sourceType: 'reader-selection',
            snippet: ref.selectionText || ref.snippet || '',
        }));
        const combinedRefs = [...selectionRefsForCitation, ...retrieval.refs];
        if (combinedRefs.length > 0) {
            assistantMessage.kbContextRefs = combinedRefs;
        }

        updateCurrentChatHistory((history = []) => [...history, assistantMessage]);
        await persistHistory();
        messageRendererApi.startStreamingMessage(assistantMessage);
        decorateChatMessages();

        const modelConfig = {
            model: requestContext.selectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
            temperature: Number(requestContext.selectedItem.config?.temperature ?? 0.7),
            max_tokens: Number(requestContext.selectedItem.config?.maxOutputTokens ?? 1000),
            top_p: requestContext.selectedItem.config?.top_p,
            top_k: requestContext.selectedItem.config?.top_k,
            stream: requestContext.selectedItem.config?.streamOutput !== false,
        };

        state.activeRequestId = assistantMessage.id;
        updateSendButtonState();

        const requestPayloadContext = buildRequestContext(requestContext, {
            topicName: requestContext.topicName,
            lastUserMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            model: modelConfig.model,
        });
        const historyForRequest = state.currentChatHistory;
        const response = await chatAPI.sendToVCP({
            requestId: assistantMessage.id,
            endpoint: requestContext.settings.vcpServerUrl,
            apiKey: requestContext.settings.vcpApiKey,
            messages: await buildApiMessages({
                agentIdOverride: requestContext.selectedItem.id,
                historyOverride: historyForRequest,
                temporarySystemMessages: [
                    ...buildSelectionContextTemporaryMessages(userMessage.selectionContextRefs, getReaderLocatorLabel),
                    ...retrieval.temporarySystemMessages,
                ],
            }),
            modelConfig,
            context: requestPayloadContext,
        });

        if (response?.error) {
            await messageRendererApi.finalizeStreamedMessage(assistantMessage.id, 'error', requestPayloadContext, {
                error: response.error,
            });
            state.activeRequestId = null;
            updateSendButtonState();
            ui.showToastNotification(`请求失败：${response.error}`, 'error');
            return;
        }

        applyAssistantResponseMetadata(assistantMessage.id, response);
        await persistHistory();

        if (!modelConfig.stream && response?.response) {
            const content = response.response?.choices?.[0]?.message?.content || '';
            patchCurrentHistoryMessage(assistantMessage.id, (entry) => ({
                ...entry,
                isThinking: false,
                content,
            }));
            await persistHistory();
            await messageRendererApi.finalizeStreamedMessage(assistantMessage.id, 'completed', requestPayloadContext, {
                fullResponse: content,
            });
            decorateChatMessages();
            state.activeRequestId = null;
            updateSendButtonState();
            triggerPostReplyTasks({
                agentId: requestContext.selectedItem.id,
                topicId: requestContext.topicId,
                messageId: assistantMessage.id,
                model: modelConfig.model,
                historySnapshot: isCurrentViewContext(requestPayloadContext) ? state.currentChatHistory : null,
            });
        }
    }

    async function sendMessage(prefillText) {
        if (typeof prefillText === 'string') {
            el.messageInput.value = prefillText;
            autoResizeTextarea(el.messageInput);
        }

        return handleSend();
    }

    async function sendFollowUp(prompt) {
        if (state.activeRequestId) {
            return;
        }

        const text = String(prompt || '').trim();
        if (!text) {
            return;
        }

        return submitTurn({
            text,
            attachments: [],
            selectionContextRefs: [],
            clearComposerDraft: false,
        });
    }

    async function handleSend() {
        const sendAction = resolveComposerSendAction({
            hasAgentId: Boolean(state.currentSelectedItem.id),
            hasTopicId: Boolean(state.currentTopicId),
            activeRequestId: state.activeRequestId,
            text: el.messageInput.value,
            pendingAttachmentCount: state.pendingAttachments.length,
        });

        if (sendAction.kind === 'interrupt') {
            const requestId = state.activeRequestId;
            const result = await interruptRequest(requestId);
            if (!result?.success) {
                await messageRendererApi.finalizeStreamedMessage(requestId, 'error', buildTopicContext(), {
                    error: result?.error || 'Interrupt failed',
                });
                ui.showToastNotification(result?.error || '中断失败', 'error');
                state.activeRequestId = null;
                updateSendButtonState();
            } else if (result.warning) {
                ui.showToastNotification(result.warning, 'warning');
            }
            return;
        }

        if (sendAction.kind === 'blocked') {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }

        if (sendAction.kind === 'noop') {
            return;
        }

        const text = el.messageInput.value.trim();
        const attachments = materializeAttachments();
        const selectionContextRefsForTurn = Array.isArray(state.pendingSelectionContextRefs)
            ? state.pendingSelectionContextRefs.map((item) => ({ ...item }))
            : [];

        return submitTurn({
            text,
            attachments,
            selectionContextRefs: selectionContextRefsForTurn,
            clearComposerDraft: true,
        });
    }

    async function handleStreamEvent(eventData) {
        const {
            type,
            requestId,
            context,
            chunk,
            error,
            partialResponse,
            fullResponse,
            finishReason,
            interrupted,
            timedOut,
        } = eventData || {};

        if (!requestId) {
            return;
        }

        if (type === 'data') {
            messageRendererApi.appendStreamChunk(requestId, chunk, context);
            return;
        }

        if (type === 'end') {
            const resolvedFinishReason = finishReason || (timedOut ? 'timed_out' : interrupted ? 'cancelled_by_user' : 'completed');
            await messageRendererApi.finalizeStreamedMessage(requestId, resolvedFinishReason, context, {
                fullResponse,
                error: error || (timedOut ? 'Request timed out.' : ''),
            });
            decorateChatMessages();
            state.activeRequestId = null;
            updateSendButtonState();
            await persistHistory();
            if (!error && !timedOut && !interrupted && resolvedFinishReason === 'completed') {
                triggerPostReplyTasks({
                    agentId: context?.agentId || '',
                    topicId: context?.topicId || '',
                    messageId: requestId,
                    model: context?.model || '',
                    historySnapshot: isCurrentViewContext(context) ? state.currentChatHistory : null,
                });
            }
            await loadTopics();
            await loadAgents();
            return;
        }

        if (type === 'error') {
            await messageRendererApi.finalizeStreamedMessage(requestId, 'error', context, {
                fullResponse: partialResponse || fullResponse,
                error,
            });
            decorateChatMessages();
            state.activeRequestId = null;
            updateSendButtonState();
            await persistHistory();
            ui.showToastNotification(error || '流式输出错误', timedOut ? 'warning' : 'error');
        }
    }

    function bindEvents() {
        el.attachFileBtn?.addEventListener('click', async () => {
            await addFiles([], 'picker');
        });

        el.messageInput?.addEventListener('keydown', async (event) => {
            if (event.defaultPrevented || event.isComposing) {
                return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                await handleSend();
            }
        });

        el.sendMessageBtn?.addEventListener('click', () => {
            void handleSend();
        });

        el.emoticonTriggerBtn?.addEventListener('click', () => {
            if (el.emoticonTriggerBtn.disabled || !windowObj.emoticonManager) {
                return;
            }

            windowObj.emoticonManager.togglePanel(el.emoticonTriggerBtn, el.messageInput);
        });
    }

    return {
        addFiles,
        addEmoticonAttachment,
        appendStoredAttachments,
        bindEvents,
        buildApiMessages,
        buildKnowledgeBaseRetrieval,
        clearPendingSelectionContext,
        getNativePathForFile,
        handleSend,
        handleStreamEvent,
        injectSelection,
        refreshAttachmentPreview,
        renderSelectionContextPreview,
        resetState,
        sendMessage,
        sendFollowUp,
        setActiveRequestId,
        syncComposerAvailability,
        updateSendButtonState,
    };
}

export {
    createComposerController,
};

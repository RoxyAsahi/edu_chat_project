// modules/renderer/messageContextMenu.js

let mainRefs = {};
let contextMenuDependencies = {};
let isInitialized = false;

const CHAT_CONTEXT_MENU_VIEWPORT_GAP = 12;

const CHAT_CONTEXT_MENU_ACTIONS = Object.freeze({
    interrupt: 'interrupt',
    edit: 'edit',
    copy: 'copy',
    cut: 'cut',
    paste: 'paste',
    cancelEdit: 'cancel-edit',
    readMode: 'read-mode',
    regenerate: 'regenerate',
    delete: 'delete',
});

function initializeContextMenu(refs, dependencies) {
    mainRefs = refs;
    contextMenuDependencies = dependencies;
    if (isInitialized) {
        return;
    }
    document.addEventListener('click', closeContextMenuOnClickOutside, true);
    document.addEventListener('keydown', closeContextMenuOnEscape, true);
    isInitialized = true;
}

function closeContextMenu() {
    document.getElementById('chatContextMenu')?.remove();
}

function closeTopicContextMenu() {
    document.getElementById('topicContextMenu')?.remove();
}

function closeContextMenuOnEscape(event) {
    if (event.key !== 'Escape') {
        return;
    }

    if (document.getElementById('chatContextMenu')) {
        closeContextMenu();
    }
}

function closeContextMenuOnClickOutside(event) {
    const menu = document.getElementById('chatContextMenu');
    if (menu && !menu.contains(event.target)) {
        closeContextMenu();
    }

    const topicMenu = document.getElementById('topicContextMenu');
    if (topicMenu && !topicMenu.contains(event.target)) {
        closeTopicContextMenu();
    }
}

function createMenuElement(tagName, className, textContent = '') {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (textContent) {
        element.textContent = textContent;
    }
    return element;
}

function normalizeTextContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (content && typeof content.text === 'string') {
        return content.text;
    }

    return '';
}

export function buildChatContextMenuModel({
    isEditing = false,
    isThinkingOrStreaming = false,
    canRegenerate = false,
}) {
    const model = {
        sections: [],
    };

    if (isThinkingOrStreaming) {
        model.sections.push({
            items: [
                {
                    id: CHAT_CONTEXT_MENU_ACTIONS.interrupt,
                    icon: 'stop_circle',
                    label: '中断生成',
                    tone: 'danger',
                },
            ],
        });
        return model;
    }

    if (isEditing) {
        model.sections.push({
            items: [
                {
                    id: CHAT_CONTEXT_MENU_ACTIONS.cut,
                    icon: 'content_cut',
                    label: '剪切',
                },
                {
                    id: CHAT_CONTEXT_MENU_ACTIONS.paste,
                    icon: 'content_paste',
                    label: '粘贴',
                },
                {
                    id: CHAT_CONTEXT_MENU_ACTIONS.cancelEdit,
                    icon: 'close',
                    label: '取消编辑',
                },
            ],
        });
        return model;
    }

    model.sections.push({
        items: [
            {
                id: CHAT_CONTEXT_MENU_ACTIONS.edit,
                icon: 'edit',
                label: '编辑消息',
            },
            {
                id: CHAT_CONTEXT_MENU_ACTIONS.copy,
                icon: 'content_copy',
                label: '复制内容',
            },
        ],
    });

    model.sections.push({
        items: [
            {
                id: CHAT_CONTEXT_MENU_ACTIONS.readMode,
                icon: 'menu_book',
                label: '阅读模式',
                tone: 'info',
            },
            ...(canRegenerate
                ? [
                    {
                        id: CHAT_CONTEXT_MENU_ACTIONS.regenerate,
                        icon: 'autorenew',
                        label: '重新生成',
                        tone: 'success',
                    },
                ]
                : []),
        ],
    });

    model.sections.push({
        items: [
            {
                id: CHAT_CONTEXT_MENU_ACTIONS.delete,
                icon: 'delete',
                label: '删除消息',
                tone: 'danger',
            },
        ],
    });

    return model;
}

function appendMenuDivider(menu) {
    menu.appendChild(createMenuElement('div', 'context-menu__divider'));
}

function appendMenuSections(menu, model, actionHandlers) {
    model.sections.forEach((section, sectionIndex) => {
        if (sectionIndex > 0) {
            appendMenuDivider(menu);
        }

        const sectionElement = createMenuElement('div', 'context-menu__section');
        section.items.forEach((item) => {
            const button = createMenuElement(
                'button',
                [
                    'context-menu__item',
                    item.tone ? `context-menu__item--${item.tone}` : '',
                ].filter(Boolean).join(' ')
            );
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.dataset.action = item.id;

            const main = createMenuElement('span', 'context-menu__item-main');
            const icon = createMenuElement('span', 'material-symbols-outlined context-menu__icon', item.icon);
            icon.setAttribute('aria-hidden', 'true');

            main.appendChild(icon);
            main.appendChild(createMenuElement('span', 'context-menu__label', item.label));
            button.appendChild(main);

            button.addEventListener('click', async () => {
                const handler = actionHandlers[item.id];
                if (typeof handler === 'function') {
                    await handler();
                }
            });

            sectionElement.appendChild(button);
        });
        menu.appendChild(sectionElement);
    });
}

function showContextMenu(event, messageItem, message) {
    closeContextMenu();
    closeTopicContextMenu();

    const { electronAPI, uiHelper } = mainRefs;
    const currentSelectedItemVal = mainRefs.currentSelectedItemRef.get() || {};
    const currentTopicIdVal = mainRefs.currentTopicIdRef.get();
    const menu = document.createElement('div');
    menu.id = 'chatContextMenu';
    menu.classList.add('context-menu', 'context-menu--chat');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '消息操作菜单');

    const isThinkingOrStreaming = message.isThinking || messageItem.classList.contains('streaming');
    const isEditing = messageItem.classList.contains('message-item-editing');
    const textarea = isEditing ? messageItem.querySelector('.message-edit-textarea') : null;
    const canRegenerate = message.role === 'assistant' && currentSelectedItemVal.type === 'agent';
    const model = buildChatContextMenuModel({
        isEditing,
        isThinkingOrStreaming,
        canRegenerate,
    });

    const actionHandlers = {
        [CHAT_CONTEXT_MENU_ACTIONS.interrupt]: async () => {
            closeContextMenu();
            const activeMessageId = message.id;
            if (!activeMessageId) {
                return;
            }

            if (contextMenuDependencies.interruptHandler?.interrupt) {
                const result = await contextMenuDependencies.interruptHandler.interrupt(activeMessageId);
                if (result?.success) {
                    uiHelper.showToastNotification('已发送中断信号。', 'success');
                } else {
                    await contextMenuDependencies.finalizeStreamedMessage?.(activeMessageId, 'cancelled_by_user', {
                        agentId: currentSelectedItemVal.id,
                        topicId: currentTopicIdVal,
                        isGroupMessage: false,
                    }, {
                        error: result?.error || 'Interrupted locally',
                    });
                    uiHelper.showToastNotification(result?.error || '已在本地中断。', 'warning');
                }
            }
        },
        [CHAT_CONTEXT_MENU_ACTIONS.edit]: async () => {
            toggleEditMode(messageItem, message);
            closeContextMenu();
        },
        [CHAT_CONTEXT_MENU_ACTIONS.copy]: async () => {
            const contentDiv = messageItem.querySelector('.md-content');
            let textToCopy = normalizeTextContent(message.content);
            if (contentDiv) {
                const contentClone = contentDiv.cloneNode(true);
                contentClone.querySelectorAll('.vcp-tool-use-bubble, .unistudy-tool-result-bubble, style, script').forEach((el) => el.remove());
                textToCopy = contentClone.innerText.replace(/\n{3,}/g, '\n\n').trim();
            }
            await navigator.clipboard.writeText(textToCopy);
            uiHelper.showToastNotification('已复制消息内容。', 'success');
            closeContextMenu();
        },
        [CHAT_CONTEXT_MENU_ACTIONS.cut]: async () => {
            if (!textarea) {
                return;
            }
            textarea.focus();
            document.execCommand('cut');
            closeContextMenu();
        },
        [CHAT_CONTEXT_MENU_ACTIONS.paste]: async () => {
            if (!textarea) {
                return;
            }
            textarea.focus();
            const text = await electronAPI.readTextFromClipboard().catch(() => '');
            if (text) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
                textarea.selectionStart = textarea.selectionEnd = start + text.length;
                textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
            closeContextMenu();
        },
        [CHAT_CONTEXT_MENU_ACTIONS.cancelEdit]: async () => {
            toggleEditMode(messageItem, message);
            closeContextMenu();
        },
        [CHAT_CONTEXT_MENU_ACTIONS.readMode]: async () => {
            closeContextMenu();
            if (!currentSelectedItemVal.id || !currentTopicIdVal || !message.id) {
                uiHelper.showToastNotification('当前消息无法进入阅读模式。', 'error');
                return;
            }

            const result = await electronAPI.getOriginalMessageContent(
                currentSelectedItemVal.id,
                currentSelectedItemVal.type,
                currentTopicIdVal,
                message.id
            ).catch((error) => ({ success: false, error: error.message }));

            if (!result?.success || result.content === undefined) {
                uiHelper.showToastNotification(`读取原始消息失败：${result?.error || '未知错误'}`, 'error');
                return;
            }

            const rawContent = result.content;
            const contentString = typeof rawContent === 'string' ? rawContent : (rawContent?.text || '');
            const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
            await electronAPI.openTextInNewWindow(contentString, `Read: ${String(message.id).slice(0, 10)}...`, currentTheme);
        },
        [CHAT_CONTEXT_MENU_ACTIONS.regenerate]: async () => {
            closeContextMenu();
            await handleRegenerateResponse(message);
        },
        [CHAT_CONTEXT_MENU_ACTIONS.delete]: async () => {
            const preview = normalizeTextContent(message.content);
            const confirmed = await uiHelper.showConfirmDialog(
                `删除这条消息？\n\"${preview.substring(0, 50)}${preview.length > 50 ? '...' : ''}\"`,
                '删除消息',
                '删除',
                '取消',
                true
            );
            if (confirmed) {
                contextMenuDependencies.removeMessageById(message.id, true);
            }
            closeContextMenu();
        },
    };

    appendMenuSections(menu, model, actionHandlers);

    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let top = event.clientY;
    let left = event.clientX;

    if (top + menuHeight > windowHeight - CHAT_CONTEXT_MENU_VIEWPORT_GAP) {
        top = Math.max(CHAT_CONTEXT_MENU_VIEWPORT_GAP, event.clientY - menuHeight);
    }

    if (left + menuWidth > windowWidth - CHAT_CONTEXT_MENU_VIEWPORT_GAP) {
        left = Math.max(CHAT_CONTEXT_MENU_VIEWPORT_GAP, event.clientX - menuWidth);
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';

    requestAnimationFrame(() => {
        menu.classList.add('context-menu--open');
    });
}

function toggleEditMode(messageItem, message) {
    const { electronAPI, markedInstance, uiHelper } = mainRefs;
    const currentChatHistoryArray = mainRefs.currentChatHistoryRef.get();
    const currentSelectedItemVal = mainRefs.currentSelectedItemRef.get();
    const currentTopicIdVal = mainRefs.currentTopicIdRef.get();
    const contentDiv = messageItem.querySelector('.md-content');
    if (!contentDiv) {
        return;
    }

    const existingTextarea = messageItem.querySelector('.message-edit-textarea');
    const existingControls = messageItem.querySelector('.message-edit-controls');

    if (existingTextarea) {
        const textToDisplay = normalizeTextContent(message.content) || '[Invalid content]';
        if (contextMenuDependencies.updateMessageContent) {
            contextMenuDependencies.updateMessageContent(message.id, textToDisplay);
        } else {
            const rawHtml = markedInstance.parse(contextMenuDependencies.preprocessFullContent(textToDisplay));
            contextMenuDependencies.setContentAndProcessImages(contentDiv, rawHtml, message.id);
            contextMenuDependencies.processRenderedContent(contentDiv);
            setTimeout(() => {
                if (contentDiv.isConnected) {
                    contextMenuDependencies.runTextHighlights(contentDiv);
                }
            }, 0);
        }

        messageItem.classList.remove('message-item-editing');
        existingTextarea.remove();
        existingControls?.remove();
        contentDiv.style.display = '';
        messageItem.querySelector('.chat-avatar')?.style.removeProperty('display');
        messageItem.querySelector('.name-time-block')?.style.removeProperty('display');
        return;
    }

    const originalContentHeight = contentDiv.offsetHeight;
    contentDiv.style.display = 'none';
    messageItem.querySelector('.chat-avatar')?.style.setProperty('display', 'none');
    messageItem.querySelector('.name-time-block')?.style.setProperty('display', 'none');
    messageItem.classList.add('message-item-editing');

    const textarea = document.createElement('textarea');
    textarea.classList.add('message-edit-textarea');
    textarea.value = normalizeTextContent(message.content) || '[Content unavailable]';
    textarea.style.minHeight = `${Math.max(originalContentHeight, 50)}px`;
    textarea.style.width = '100%';

    const controlsDiv = document.createElement('div');
    controlsDiv.classList.add('message-edit-controls');

    const saveButton = document.createElement('button');
    saveButton.textContent = '保存';
    saveButton.onclick = async () => {
        const newContent = textarea.value;
        const originalTextContent = normalizeTextContent(message.content);
        if (newContent === originalTextContent) {
            toggleEditMode(messageItem, message);
            return;
        }

        const messageIndex = currentChatHistoryArray.findIndex((msg) => msg.id === message.id);
        if (messageIndex === -1) {
            uiHelper.showToastNotification('未找到对应消息。', 'error');
            return;
        }

        const originalContent = currentChatHistoryArray[messageIndex].content;
        try {
            currentChatHistoryArray[messageIndex].content = newContent;
            message.content = newContent;
            mainRefs.currentChatHistoryRef.set([...currentChatHistoryArray]);

            const saveResult = await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, currentChatHistoryArray);
            if (saveResult && saveResult.success === false) {
                throw new Error(saveResult.error || 'Failed to save edited message');
            }

            if (contextMenuDependencies.updateMessageContent) {
                contextMenuDependencies.updateMessageContent(message.id, newContent);
            }
            uiHelper.showToastNotification('消息已保存。', 'success');
            toggleEditMode(messageItem, message);
        } catch (error) {
            currentChatHistoryArray[messageIndex].content = originalContent;
            message.content = originalContent;
            mainRefs.currentChatHistoryRef.set([...currentChatHistoryArray]);
            uiHelper.showToastNotification(`保存失败：${error.message}`, 'error');
        }
    };

    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.onclick = () => toggleEditMode(messageItem, message);

    controlsDiv.appendChild(saveButton);
    controlsDiv.appendChild(cancelButton);
    messageItem.appendChild(textarea);
    messageItem.appendChild(controlsDiv);

    uiHelper.autoResizeTextarea?.(textarea);
    textarea.focus();
    textarea.addEventListener('input', () => uiHelper.autoResizeTextarea?.(textarea));
    textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            cancelButton.click();
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
            event.preventDefault();
            saveButton.click();
        } else if (event.ctrlKey && event.key === 'Enter') {
            saveButton.click();
        }
    });
}

function normalizeAttachmentForRegeneration(rawAttachment) {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
        return null;
    }

    const src = rawAttachment.src || rawAttachment.internalPath || rawAttachment.localPath || '';
    const internalPath = rawAttachment.internalPath || rawAttachment.localPath || src;

    return {
        ...rawAttachment,
        src,
        internalPath,
        extractedText: rawAttachment.extractedText ?? rawAttachment._fileManagerData?.extractedText ?? null,
        imageFrames: Array.isArray(rawAttachment.imageFrames)
            ? rawAttachment.imageFrames
            : (Array.isArray(rawAttachment._fileManagerData?.imageFrames) ? rawAttachment._fileManagerData.imageFrames : []),
    };
}

async function buildMessageContentForRegeneration(message, electronAPI) {
    if (message.role !== 'user') {
        return message.content;
    }

    const attachments = Array.isArray(message.attachments)
        ? message.attachments.map(normalizeAttachmentForRegeneration).filter(Boolean)
        : [];

    if (attachments.length === 0) {
        return message.content;
    }

    const parts = [];
    const textContent = normalizeTextContent(message.content);
    if (textContent.trim()) {
        parts.push({ type: 'text', text: textContent });
    }

    for (const attachment of attachments) {
        const pathForRead = attachment.internalPath || attachment.src;
        if (attachment.type?.startsWith('image/')) {
            const base64Result = pathForRead
                ? await electronAPI.getFileAsBase64(pathForRead).catch(() => null)
                : null;
            const base64Frames = Array.isArray(base64Result?.base64Frames) ? base64Result.base64Frames : [];
            if (base64Frames.length > 0) {
                for (const frame of base64Frames) {
                    parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                }
                continue;
            }
        }

        if (Array.isArray(attachment.imageFrames) && attachment.imageFrames.length > 0) {
            for (const frame of attachment.imageFrames) {
                parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
            }
        }

        if (attachment.extractedText) {
            parts.push({ type: 'text', text: `Attachment: ${attachment.name || 'Attachment'}\n${attachment.extractedText}` });
        } else {
            parts.push({ type: 'text', text: `Attachment reference: ${attachment.name || 'Attachment'}` });
        }
    }

    if (parts.length === 0) {
        return textContent || '(User sent attachments without readable text)';
    }

    if (parts.length === 1 && parts[0].type === 'text') {
        return parts[0].text;
    }

    return parts;
}

async function handleRegenerateResponse(originalAssistantMessage) {
    const { electronAPI, uiHelper } = mainRefs;
    const currentChatHistoryArray = mainRefs.currentChatHistoryRef.get();
    const currentSelectedItemVal = mainRefs.currentSelectedItemRef.get();
    const currentTopicIdVal = mainRefs.currentTopicIdRef.get();
    const globalSettingsVal = mainRefs.globalSettingsRef.get();

    if (!currentSelectedItemVal.id || currentSelectedItemVal.type !== 'agent' || !currentTopicIdVal || !originalAssistantMessage || originalAssistantMessage.role !== 'assistant') {
        uiHelper.showToastNotification('只有 agent 对话里的助手回复支持重新生成。', 'warning');
        return;
    }

    const originalMessageIndex = currentChatHistoryArray.findIndex((msg) => msg.id === originalAssistantMessage.id);
    if (originalMessageIndex === -1) {
        return;
    }

    const historyForRegeneration = currentChatHistoryArray.slice(0, originalMessageIndex).filter((msg) => !msg.isThinking);
    const context = {
        agentId: currentSelectedItemVal.id,
        topicId: currentTopicIdVal,
        agentName: currentSelectedItemVal.name,
        avatarUrl: currentSelectedItemVal.avatarUrl,
        avatarColor: currentSelectedItemVal.config?.avatarCalculatedColor || null,
        isGroupMessage: false,
    };

    currentChatHistoryArray.splice(originalMessageIndex);
    mainRefs.currentChatHistoryRef.set([...currentChatHistoryArray]);
    await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, currentChatHistoryArray);

    const regenerationThinkingMessage = {
        role: 'assistant',
        name: currentSelectedItemVal.name || 'Assistant',
        content: '',
        timestamp: Date.now(),
        id: `msg_${Date.now()}_assistant_${Math.random().toString(36).substring(2, 9)}`,
        isThinking: true,
        topicId: currentTopicIdVal,
        agentId: currentSelectedItemVal.id,
        avatarUrl: currentSelectedItemVal.avatarUrl,
        avatarColor: currentSelectedItemVal.config?.avatarCalculatedColor || null,
    };

    currentChatHistoryArray.push(regenerationThinkingMessage);
    mainRefs.currentChatHistoryRef.set([...currentChatHistoryArray]);
    await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, currentChatHistoryArray);
    contextMenuDependencies.renderMessage(regenerationThinkingMessage, false);

    try {
        const agentConfig = await electronAPI.getAgentConfig(currentSelectedItemVal.id);
        if (agentConfig?.error) {
            throw new Error(agentConfig.error);
        }

        const promptResult = await electronAPI.getActiveSystemPrompt(currentSelectedItemVal.id).catch(() => ({ success: false, systemPrompt: '' }));
        const messagesForVCP = [];
        if (promptResult?.success && promptResult.systemPrompt) {
            messagesForVCP.push({ role: 'system', content: promptResult.systemPrompt });
        }

        for (const msg of historyForRegeneration) {
            messagesForVCP.push({
                role: msg.role,
                content: await buildMessageContentForRegeneration(msg, electronAPI),
                name: msg.name,
            });
        }

        const modelConfigForVCP = {
            model: agentConfig.model || currentSelectedItemVal.config?.model || 'gemini-3.1-flash-lite-preview',
            temperature: Number(agentConfig.temperature ?? currentSelectedItemVal.config?.temperature ?? 0.7),
            max_tokens: Number(agentConfig.maxOutputTokens ?? currentSelectedItemVal.config?.maxOutputTokens ?? 1000),
            top_p: agentConfig.top_p,
            top_k: agentConfig.top_k,
            stream: agentConfig.streamOutput !== false,
        };

        if (modelConfigForVCP.stream) {
            contextMenuDependencies.startStreamingMessage({ ...regenerationThinkingMessage, content: '' });
        }

        contextMenuDependencies.setActiveRequestId?.(regenerationThinkingMessage.id);

        const vcpResult = await electronAPI.sendToVCP({
            requestId: regenerationThinkingMessage.id,
            endpoint: globalSettingsVal.vcpServerUrl,
            apiKey: globalSettingsVal.vcpApiKey,
            messages: messagesForVCP,
            modelConfig: modelConfigForVCP,
            context,
        });

        if (modelConfigForVCP.stream) {
            if (vcpResult?.error || !vcpResult?.streamingStarted) {
                const detailedError = vcpResult?.error || 'Unable to start streaming regeneration.';
                contextMenuDependencies.setActiveRequestId?.(null);
                await contextMenuDependencies.finalizeStreamedMessage(regenerationThinkingMessage.id, 'error', context, {
                    error: detailedError,
                });
                await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, mainRefs.currentChatHistoryRef.get());
            }
            return;
        }

        const response = vcpResult?.response;
        if (response?.error) {
            throw new Error(response.error);
        }

        const assistantMessageContent = response?.choices?.[0]?.message?.content || '';
        const finalHistory = currentChatHistoryArray.filter((msg) => msg.id !== regenerationThinkingMessage.id && !msg.isThinking);
        const assistantMessage = {
            role: 'assistant',
            name: agentConfig.name || currentSelectedItemVal.name,
            avatarUrl: agentConfig.avatarUrl || currentSelectedItemVal.avatarUrl,
            avatarColor: agentConfig.avatarCalculatedColor || currentSelectedItemVal.config?.avatarCalculatedColor || null,
            content: assistantMessageContent,
            timestamp: Date.now(),
            topicId: currentTopicIdVal,
            agentId: currentSelectedItemVal.id,
            id: response?.id || `msg_${Date.now()}_assistant_${Math.random().toString(36).substring(2, 9)}`,
        };

        finalHistory.push(assistantMessage);
        mainRefs.currentChatHistoryRef.set(finalHistory);
        await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, finalHistory);
        contextMenuDependencies.removeMessageById(regenerationThinkingMessage.id, false);
        contextMenuDependencies.renderMessage(assistantMessage);
        contextMenuDependencies.setActiveRequestId?.(null);
        void contextMenuDependencies.generateFollowUpsForAssistantMessage?.({
            agentId: currentSelectedItemVal.id,
            topicId: currentTopicIdVal,
            messageId: assistantMessage.id,
            historySnapshot: finalHistory,
        });
        uiHelper.scrollToBottom();
    } catch (error) {
        contextMenuDependencies.setActiveRequestId?.(null);
        await contextMenuDependencies.finalizeStreamedMessage(regenerationThinkingMessage.id, 'error', context, {
            error: `Regenerate failed: ${error.message}`,
        });
        await electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, mainRefs.currentChatHistoryRef.get());
        uiHelper.showToastNotification(`Regenerate failed: ${error.message}`, 'error');
        uiHelper.scrollToBottom();
    }
}

function setContextMenuDependencies(newDependencies) {
    contextMenuDependencies = { ...contextMenuDependencies, ...newDependencies };
}

export {
    initializeContextMenu,
    showContextMenu,
    closeContextMenu,
    toggleEditMode,
    handleRegenerateResponse,
    setContextMenuDependencies
};

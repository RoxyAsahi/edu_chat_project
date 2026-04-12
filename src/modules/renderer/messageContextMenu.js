// modules/renderer/messageContextMenu.js

let mainRefs = {};
let contextMenuDependencies = {};
let isInitialized = false;

function initializeContextMenu(refs, dependencies) {
    mainRefs = refs;
    contextMenuDependencies = dependencies;
    if (isInitialized) {
        return;
    }
    document.addEventListener('click', closeContextMenuOnClickOutside, true);
    isInitialized = true;
}

function closeContextMenu() {
    document.getElementById('chatContextMenu')?.remove();
}

function closeTopicContextMenu() {
    document.getElementById('topicContextMenu')?.remove();
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

function appendMenuItem(menu, label, onClick, className = '') {
    const item = document.createElement('div');
    item.className = ['context-menu-item', className].filter(Boolean).join(' ');
    item.textContent = label;
    item.onclick = async () => {
        await onClick();
    };
    menu.appendChild(item);
    return item;
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

function showContextMenu(event, messageItem, message) {
    closeContextMenu();
    closeTopicContextMenu();

    const { electronAPI, uiHelper } = mainRefs;
    const currentSelectedItemVal = mainRefs.currentSelectedItemRef.get();
    const currentTopicIdVal = mainRefs.currentTopicIdRef.get();
    const menu = document.createElement('div');
    menu.id = 'chatContextMenu';
    menu.classList.add('context-menu');

    const isThinkingOrStreaming = message.isThinking || messageItem.classList.contains('streaming');
    const isEditing = messageItem.classList.contains('message-item-editing');
    const textarea = isEditing ? messageItem.querySelector('.message-edit-textarea') : null;

    if (isThinkingOrStreaming) {
        appendMenuItem(menu, 'Interrupt', async () => {
            closeContextMenu();
            const activeMessageId = message.id;
            if (!activeMessageId) {
                return;
            }

            if (contextMenuDependencies.interruptHandler?.interrupt) {
                const result = await contextMenuDependencies.interruptHandler.interrupt(activeMessageId);
                if (result?.success) {
                    uiHelper.showToastNotification('Interrupt signal sent.', 'success');
                } else {
                    await contextMenuDependencies.finalizeStreamedMessage?.(activeMessageId, 'cancelled_by_user', {
                        agentId: currentSelectedItemVal.id,
                        topicId: currentTopicIdVal,
                        isGroupMessage: false,
                    }, {
                        error: result?.error || 'Interrupted locally',
                    });
                    uiHelper.showToastNotification(result?.error || 'Interrupted locally.', 'warning');
                }
            }
        }, 'danger-item');
    } else {
        if (!isEditing) {
            appendMenuItem(menu, 'Edit', async () => {
                toggleEditMode(messageItem, message);
                closeContextMenu();
            });
        }

        appendMenuItem(menu, 'Copy', async () => {
            const contentDiv = messageItem.querySelector('.md-content');
            let textToCopy = normalizeTextContent(message.content);
            if (contentDiv) {
                const contentClone = contentDiv.cloneNode(true);
                contentClone.querySelectorAll('.vcp-tool-use-bubble, .vcp-tool-result-bubble, style, script').forEach((el) => el.remove());
                textToCopy = contentClone.innerText.replace(/\n{3,}/g, '\n\n').trim();
            }
            await navigator.clipboard.writeText(textToCopy);
            uiHelper.showToastNotification('Copied message text.', 'success');
            closeContextMenu();
        });

        if (isEditing && textarea) {
            appendMenuItem(menu, 'Cut', async () => {
                textarea.focus();
                document.execCommand('cut');
                closeContextMenu();
            });

            appendMenuItem(menu, 'Paste', async () => {
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
            });
        }

        appendMenuItem(menu, 'Read Mode', async () => {
            closeContextMenu();
            if (!currentSelectedItemVal.id || !currentTopicIdVal || !message.id) {
                uiHelper.showToastNotification('Read mode is unavailable for this message.', 'error');
                return;
            }

            const result = await electronAPI.getOriginalMessageContent(
                currentSelectedItemVal.id,
                currentSelectedItemVal.type,
                currentTopicIdVal,
                message.id
            ).catch((error) => ({ success: false, error: error.message }));

            if (!result?.success || result.content === undefined) {
                uiHelper.showToastNotification(`Failed to load original message: ${result?.error || 'Unknown error'}`, 'error');
                return;
            }

            const rawContent = result.content;
            const contentString = typeof rawContent === 'string' ? rawContent : (rawContent?.text || '');
            const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
            await electronAPI.openTextInNewWindow(contentString, `Read: ${String(message.id).slice(0, 10)}...`, currentTheme);
        }, 'info-item');

        if (message.role === 'assistant' && currentSelectedItemVal.type === 'agent') {
            appendMenuItem(menu, 'Regenerate', async () => {
                closeContextMenu();
                await handleRegenerateResponse(message);
            }, 'regenerate-text');
        }

        appendMenuItem(menu, 'Delete', async () => {
            const preview = normalizeTextContent(message.content);
            const confirmed = await uiHelper.showConfirmDialog(
                `Delete this message?\n\"${preview.substring(0, 50)}${preview.length > 50 ? '...' : ''}\"`,
                'Delete Message',
                'Delete',
                'Cancel',
                true
            );
            if (confirmed) {
                contextMenuDependencies.removeMessageById(message.id, true);
            }
            closeContextMenu();
        }, 'danger-item');
    }

    menu.style.visibility = 'hidden';
    menu.style.position = 'absolute';
    document.body.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let top = event.clientY;
    let left = event.clientX;

    if (top + menuHeight > windowHeight) {
        top = Math.max(5, event.clientY - menuHeight);
    }

    if (left + menuWidth > windowWidth) {
        left = Math.max(5, event.clientX - menuWidth);
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';
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
    saveButton.textContent = 'Save';
    saveButton.onclick = async () => {
        const newContent = textarea.value;
        const originalTextContent = normalizeTextContent(message.content);
        if (newContent === originalTextContent) {
            toggleEditMode(messageItem, message);
            return;
        }

        const messageIndex = currentChatHistoryArray.findIndex((msg) => msg.id === message.id);
        if (messageIndex === -1) {
            uiHelper.showToastNotification('Message was not found.', 'error');
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
            uiHelper.showToastNotification('Message saved.', 'success');
            toggleEditMode(messageItem, message);
        } catch (error) {
            currentChatHistoryArray[messageIndex].content = originalContent;
            message.content = originalContent;
            mainRefs.currentChatHistoryRef.set([...currentChatHistoryArray]);
            uiHelper.showToastNotification(`Save failed: ${error.message}`, 'error');
        }
    };

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
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
        uiHelper.showToastNotification('Only assistant replies in agent chats can be regenerated.', 'warning');
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

        window.setLiteActiveRequestId?.(regenerationThinkingMessage.id);

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
                window.setLiteActiveRequestId?.(null);
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
        window.setLiteActiveRequestId?.(null);
        uiHelper.scrollToBottom();
    } catch (error) {
        window.setLiteActiveRequestId?.(null);
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

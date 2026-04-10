const LONG_TEXT_THRESHOLD = 2000;

function initializeInputEnhancer(refs) {
    const {
        messageInput,
        dropTargetElement,
        electronAPI,
        electronPath,
        autoResizeTextarea,
        appendAttachments,
        getCurrentAgentId,
        getCurrentTopicId,
        showToast,
    } = refs || {};

    if (!messageInput || !dropTargetElement || !electronAPI || !appendAttachments || !getCurrentAgentId || !getCurrentTopicId) {
        console.error('[LiteInputEnhancer] Initialization failed: missing required refs.');
        return;
    }

    let dragDepth = 0;
    let noteSuggestionPopup = null;
    let noteSuggestions = [];
    let activeSuggestionIndex = -1;

    const notify = (message, type = 'info') => {
        if (typeof showToast === 'function') {
            showToast(message, type);
            return;
        }
        console.log(`[LiteInputEnhancer][${type}] ${message}`);
    };

    const getContext = () => {
        const agentId = getCurrentAgentId();
        const topicId = getCurrentTopicId();
        if (!agentId || !topicId) {
            return null;
        }
        return { agentId, topicId };
    };

    const ensureContext = (message) => {
        const context = getContext();
        if (!context) {
            notify(message, 'warning');
            return null;
        }
        return context;
    };

    const appendStoredAttachment = (attachment) => {
        if (!attachment) return;
        appendAttachments([attachment]);
    };

    const readFileAsUint8Array = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const arrayBuffer = event.target?.result;
            if (!arrayBuffer) {
                reject(new Error(`Unable to read file contents for ${file.name}.`));
                return;
            }
            resolve(new Uint8Array(arrayBuffer));
        };
        reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}.`));
        reader.readAsArrayBuffer(file);
    });

    const importBinaryFiles = async (files, context) => {
        const payload = await Promise.all(files.map(async (file) => ({
            name: file.name,
            type: file.type || 'application/octet-stream',
            data: await readFileAsUint8Array(file),
            size: file.size,
        })));

        const results = await electronAPI.handleFileDrop(context.agentId, context.topicId, payload);
        const entries = Array.isArray(results) ? results : [];
        const attachments = entries
            .filter((entry) => entry?.success && entry.attachment)
            .map((entry) => entry.attachment);

        appendAttachments(attachments);

        entries
            .filter((entry) => entry?.error)
            .forEach((entry) => notify(`导入附件失败: ${entry.name || '未知文件'} - ${entry.error}`, 'error'));
    };

    const importPathAttachment = async (filePath, fileName, context) => {
        const results = await electronAPI.handleFileDrop(context.agentId, context.topicId, [{ path: filePath, name: fileName }]);
        const first = Array.isArray(results) ? results[0] : null;
        if (first?.success && first.attachment) {
            appendStoredAttachment(first.attachment);
            return;
        }
        notify(`导入附件失败: ${first?.error || '未知错误'}`, 'error');
    };

    const resolveNoteAttachment = async (note) => {
        if (note?.sourceType === 'topic-note') {
            if (typeof electronAPI.exportNoteAsAttachment !== 'function') {
                throw new Error('当前环境不支持导出笔记附件。');
            }

            const result = await electronAPI.exportNoteAsAttachment({
                noteId: note.noteId,
                agentId: note.agentId,
                topicId: note.topicId,
            });
            if (!result?.success || !result.path) {
                throw new Error(result?.error || '笔记导出失败');
            }

            return {
                filePath: result.path,
                fileName: result.name || note.name,
            };
        }

        if (typeof note?.path === 'string' && note.path.trim()) {
            return {
                filePath: note.path.trim(),
                fileName: note.name,
            };
        }

        throw new Error('未找到可导入的笔记附件路径。');
    };

    const handlePastedImage = async (imageData, context) => {
        const result = await electronAPI.handleFilePaste(context.agentId, context.topicId, {
            type: 'base64',
            data: imageData.data,
            extension: imageData.extension || 'png',
        });
        if (result?.success && result.attachment) {
            appendStoredAttachment(result.attachment);
            return;
        }
        notify(`无法从剪贴板粘贴图片: ${result?.error || '截图处理失败'}`, 'error');
    };

    const handleLongTextPaste = async (text, context) => {
        const result = await electronAPI.handleTextPasteAsFile(context.agentId, context.topicId, text);
        if (result?.success && result.attachment) {
            appendStoredAttachment(result.attachment);
            notify('长文本已作为附件加入。', 'success');
            return;
        }
        notify(`长文本转附件失败: ${result?.error || '未知错误'}`, 'error');
    };

    const activateDropTarget = () => dropTargetElement.classList.add('drag-over');
    const deactivateDropTarget = () => {
        dragDepth = 0;
        dropTargetElement.classList.remove('drag-over');
    };

    dropTargetElement.addEventListener('dragenter', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth += 1;
        activateDropTarget();
    });

    dropTargetElement.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        if (!dropTargetElement.classList.contains('drag-over')) {
            activateDropTarget();
        }
    });

    dropTargetElement.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            dropTargetElement.classList.remove('drag-over');
        }
    });

    dropTargetElement.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        deactivateDropTarget();

        const context = ensureContext('请先选择一个 Agent 和话题，再拖拽文件。');
        if (!context) return;

        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length === 0) return;

        try {
            await importBinaryFiles(files, context);
        } catch (error) {
            console.error('[LiteInputEnhancer] Failed to import dropped files:', error);
            notify(`拖拽文件失败: ${error.message}`, 'error');
        }
    });

    messageInput.addEventListener('paste', async (event) => {
        const clipboardData = event.clipboardData || window.clipboardData;
        if (!clipboardData) {
            return;
        }

        const items = Array.from(clipboardData.items || []);
        const fileItems = items
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter(Boolean);

        if (fileItems.length > 0) {
            event.preventDefault();
            const context = ensureContext('请先选择一个 Agent 和话题，再粘贴文件。');
            if (!context) return;

            try {
                await importBinaryFiles(fileItems, context);
            } catch (error) {
                console.error('[LiteInputEnhancer] Failed to import pasted files:', error);
                notify(`粘贴文件失败: ${error.message}`, 'error');
            }
            return;
        }

        const imageData = await electronAPI.readImageFromClipboard?.().catch(() => null);
        if (imageData?.data) {
            event.preventDefault();
            const context = ensureContext('请先选择一个 Agent 和话题，再粘贴图片。');
            if (!context) return;
            await handlePastedImage(imageData, context);
            return;
        }

        const pastedText = clipboardData.getData('text/plain');
        if (pastedText && pastedText.length > LONG_TEXT_THRESHOLD) {
            event.preventDefault();
            const context = ensureContext('请先选择一个 Agent 和话题，再粘贴长文本。');
            if (!context) return;
            await handleLongTextPaste(pastedText, context);
        }
    });

    if (typeof electronAPI.onAddFileToInput === 'function') {
        electronAPI.onAddFileToInput(async (filePath) => {
            const context = ensureContext('请先选择一个 Agent 和话题，才能接收共享文件。');
            if (!context || !filePath) return;

            try {
                const fileName = await electronPath?.basename?.(filePath);
                await importPathAttachment(filePath, fileName || 'shared-file', context);
            } catch (error) {
                console.error('[LiteInputEnhancer] Failed to import shared file:', error);
                notify(`接收共享文件失败: ${error.message}`, 'error');
            }
        });
    }

    const hideNoteSuggestions = () => {
        if (noteSuggestionPopup) {
            noteSuggestionPopup.style.display = 'none';
        }
        noteSuggestions = [];
        activeSuggestionIndex = -1;
    };

    const updateSuggestionHighlight = () => {
        if (!noteSuggestionPopup) return;
        const items = noteSuggestionPopup.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            item.classList.toggle('active', index === activeSuggestionIndex);
        });
    };

    const selectNoteSuggestion = async (note) => {
        const context = ensureContext('请先选择一个 Agent 和话题，才能附加笔记。');
        if (!context) {
            hideNoteSuggestions();
            return;
        }

        const cursorPos = messageInput.selectionStart ?? messageInput.value.length;
        const textBeforeCursor = messageInput.value.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@([\w\u4e00-\u9fa5-]*)$/);

        if (atMatch) {
            const mentionLength = atMatch[0].length;
            messageInput.value = messageInput.value.substring(0, cursorPos - mentionLength) + messageInput.value.substring(cursorPos);
            messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        hideNoteSuggestions();
        try {
            const attachment = await resolveNoteAttachment(note);
            await importPathAttachment(attachment.filePath, attachment.fileName, context);
        } catch (error) {
            console.error('[LiteInputEnhancer] Failed to import note suggestion:', error);
            notify(`导入笔记失败: ${error.message}`, 'error');
        }
    };

    const ensureSuggestionPopup = () => {
        if (!noteSuggestionPopup) {
            noteSuggestionPopup = document.createElement('div');
            noteSuggestionPopup.id = 'note-suggestion-popup';
            noteSuggestionPopup.style.display = 'none';
            document.body.appendChild(noteSuggestionPopup);
        }
        return noteSuggestionPopup;
    };

    const showNoteSuggestions = (notes) => {
        const popup = ensureSuggestionPopup();
        popup.innerHTML = '';
        noteSuggestions = notes;

        notes.forEach((note, index) => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';

            const name = document.createElement('span');
            name.className = 'suggestion-name';
            name.textContent = note.name;
            item.appendChild(name);

            const relativePath = typeof note.pathLabel === 'string' && note.pathLabel.trim()
                ? note.pathLabel.trim()
                : (typeof note.path === 'string' && note.path.trim()
                    ? note.path.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')
                    : (note.sourceType || 'note'));
            const path = document.createElement('span');
            path.className = 'suggestion-path';
            path.textContent = relativePath;
            item.appendChild(path);

            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                void selectNoteSuggestion(note);
            });

            popup.appendChild(item);
            if (index === 0) {
                activeSuggestionIndex = 0;
            }
        });

        const rect = messageInput.getBoundingClientRect();
        popup.style.left = `${Math.max(12, rect.left)}px`;
        popup.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
        popup.style.display = 'block';
        updateSuggestionHighlight();
    };

    messageInput.addEventListener('input', async () => {
        autoResizeTextarea?.(messageInput);

        const cursorPos = messageInput.selectionStart ?? messageInput.value.length;
        const atMatch = messageInput.value.substring(0, cursorPos).match(/@([\w\u4e00-\u9fa5-]*)$/);
        if (!atMatch || typeof electronAPI.searchNotes !== 'function') {
            hideNoteSuggestions();
            return;
        }

        const query = atMatch[1];
        if (!query) {
            hideNoteSuggestions();
            return;
        }

        try {
            const notes = await electronAPI.searchNotes(query);
            if (Array.isArray(notes) && notes.length > 0) {
                showNoteSuggestions(notes.slice(0, 8));
                return;
            }
        } catch (error) {
            console.error('[LiteInputEnhancer] Failed to search notes:', error);
        }

        hideNoteSuggestions();
    });

    messageInput.addEventListener('keydown', (event) => {
        const popupVisible = noteSuggestionPopup && noteSuggestionPopup.style.display === 'block' && noteSuggestions.length > 0;
        if (!popupVisible) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopImmediatePropagation();
            activeSuggestionIndex = (activeSuggestionIndex + 1) % noteSuggestions.length;
            updateSuggestionHighlight();
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopImmediatePropagation();
            activeSuggestionIndex = (activeSuggestionIndex - 1 + noteSuggestions.length) % noteSuggestions.length;
            updateSuggestionHighlight();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (activeSuggestionIndex > -1 && noteSuggestions[activeSuggestionIndex]) {
                void selectNoteSuggestion(noteSuggestions[activeSuggestionIndex]);
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            hideNoteSuggestions();
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!noteSuggestionPopup || noteSuggestionPopup.style.display !== 'block') return;
        if (noteSuggestionPopup.contains(event.target) || event.target === messageInput) return;
        hideNoteSuggestions();
    });

    window.addEventListener('resize', hideNoteSuggestions);
}

export { initializeInputEnhancer };

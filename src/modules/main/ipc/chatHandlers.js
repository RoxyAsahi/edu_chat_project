// modules/ipc/chatHandlers.js
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const contextSanitizer = require('../contextSanitizer');
const knowledgeBase = require('../knowledge-base');
const vcpClient = require('../vcpClient');
const { resolvePromptMessageSet } = require('../utils/promptVariableResolver');

/**
 * Initializes chat and topic related IPC handlers.
 * @param {BrowserWindow} mainWindow The main window instance.
 * @param {object} context - An object containing necessary context.
 * @param {string} context.AGENT_DIR - The path to the agents directory.
 * @param {string} context.USER_DATA_DIR - The path to the user data directory.
 * @param {string} context.DATA_ROOT - The path to the app data root.
 * @param {function} context.getSelectionListenerStatus - Function to get the current status of the selection listener.
 * @param {function} context.stopSelectionListener - Function to stop the selection listener.
 * @param {function} context.startSelectionListener - Function to start the selection listener.
 */
let ipcHandlersRegistered = false;

const AGENT_BUBBLE_THEME_INJECTION = 'Output formatting requirement: {{VarDivRender}}';

function normalizeMessageForPreprocessing(message) {
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

function stripThoughtChains(messages) {
    return messages.map((message) => {
        if (typeof message.content === 'string') {
            return { ...message, content: contextSanitizer.stripThoughtChains(message.content) };
        }

        if (Array.isArray(message.content)) {
            return {
                ...message,
                content: message.content.map((part) => {
                    if (part?.type === 'text' && typeof part.text === 'string') {
                        return { ...part, text: contextSanitizer.stripThoughtChains(part.text) };
                    }
                    return part;
                }),
            };
        }

        return message;
    });
}

function applyAgentBubbleTheme(messages) {
    const nextMessages = [...messages];
    let systemMessageIndex = nextMessages.findIndex((message) => message.role === 'system');

    if (systemMessageIndex === -1) {
        nextMessages.unshift({ role: 'system', content: '' });
        systemMessageIndex = 0;
    }

    const systemMessage = nextMessages[systemMessageIndex];
    const currentContent = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    if (!currentContent.includes(AGENT_BUBBLE_THEME_INJECTION)) {
        nextMessages[systemMessageIndex] = {
            ...systemMessage,
            content: `${currentContent}\n\n${AGENT_BUBBLE_THEME_INJECTION}`.trim(),
        };
    }

    return nextMessages;
}

function applyContextSanitizer(messages, settings) {
    if (settings.enableContextSanitizer !== true) {
        return messages;
    }

    const sanitizerDepth = settings.contextSanitizerDepth !== undefined
        ? settings.contextSanitizerDepth
        : 2;
    const systemMessages = messages.filter((message) => message.role === 'system');
    const nonSystemMessages = messages.filter((message) => message.role !== 'system');
    const sanitizedMessages = contextSanitizer.sanitizeMessages(
        nonSystemMessages,
        sanitizerDepth,
        settings.enableThoughtChainInjection === true
    );

    return [...systemMessages, ...sanitizedMessages];
}

async function buildPromptResolutionOptions({ settings, context, modelConfig, agentConfigManager }) {
    const nextContext = { ...(context || {}) };
    let agentConfig = null;

    if (nextContext.agentId && agentConfigManager && typeof agentConfigManager.readAgentConfig === 'function') {
        try {
            agentConfig = await agentConfigManager.readAgentConfig(nextContext.agentId);
        } catch (error) {
            console.warn(`[Main - sendToVCP] Failed to read agent config for prompt resolution (${nextContext.agentId}):`, error);
        }
    }

    if (agentConfig) {
        if (!nextContext.agentName && typeof agentConfig.name === 'string') {
            nextContext.agentName = agentConfig.name;
        }

        if (!nextContext.topicName && nextContext.topicId && Array.isArray(agentConfig.topics)) {
            const matchedTopic = agentConfig.topics.find((topic) => topic?.id === nextContext.topicId);
            if (matchedTopic?.name) {
                nextContext.topicName = matchedTopic.name;
            }
        }
    }

    return {
        settings,
        agentConfig,
        context: nextContext,
        modelConfig,
    };
}

function initialize(mainWindow, context) {
    const {
        AGENT_DIR,
        USER_DATA_DIR,
        DATA_ROOT,
        fileWatcher,
        settingsManager,
        agentConfigManager,
    } = context;

    vcpClient.initialize({ settingsManager });

    // Ensure the watcher is in a clean state on initialization
    if (fileWatcher) {
        fileWatcher.stopWatching();
    }

    if (ipcHandlersRegistered) {
        return;
    }

    ipcMain.handle('save-topic-order', async (event, agentId, orderedTopicIds) => {
        if (!agentId || !Array.isArray(orderedTopicIds)) {
            return { success: false, error: 'Invalid agentId or topic IDs.' };
        }
        try {
            if (agentConfigManager) {
                await agentConfigManager.updateAgentConfig(agentId, config => {
                    if (!config.topics || !Array.isArray(config.topics)) {
                        return config;
                    }
                    const topicMap = new Map(config.topics.map(topic => [topic.id, topic]));
                    const newTopicsArray = [];
                    orderedTopicIds.forEach(id => {
                        if (topicMap.has(id)) {
                            newTopicsArray.push(topicMap.get(id));
                            topicMap.delete(id);
                        }
                    });
                    newTopicsArray.push(...topicMap.values());
                    return { ...config, topics: newTopicsArray };
                });
            } else {
                return { success: false, error: 'AgentConfigManager is unavailable.' };
            }
            return { success: true };
        } catch (error) {
            console.error(`Error saving topic order for agent ${agentId}:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('search-topics-by-content', async (event, itemId, itemType, searchTerm) => {
        if (!itemId || itemType !== 'agent' || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
            return { success: false, error: 'Invalid arguments for topic content search.', matchedTopicIds: [] };
        }
        const searchTermLower = searchTerm.toLowerCase();
        const matchedTopicIds = [];

        try {
            const configPath = path.join(AGENT_DIR, itemId, 'config.json');
            if (!await fs.pathExists(configPath)) {
                return { success: true, matchedTopicIds: [] };
            }

            const itemConfig = await fs.readJson(configPath);
            if (!itemConfig || !Array.isArray(itemConfig.topics)) {
                return { success: true, matchedTopicIds: [] };
            }

            for (const topic of itemConfig.topics) {
                const historyFilePath = path.join(USER_DATA_DIR, itemId, 'topics', topic.id, 'history.json');
                if (!await fs.pathExists(historyFilePath)) {
                    continue;
                }
                try {
                    const history = await fs.readJson(historyFilePath);
                    if (Array.isArray(history) && history.some(message => typeof message.content === 'string' && message.content.toLowerCase().includes(searchTermLower))) {
                        matchedTopicIds.push(topic.id);
                    }
                } catch (e) {
                    console.error(`Error reading history for agent ${itemId}, topic ${topic.id}:`, e);
                }
            }

            return { success: true, matchedTopicIds: [...new Set(matchedTopicIds)] };
        } catch (error) {
            console.error(`Error searching topic content for agent ${itemId}:`, error);
            return { success: false, error: error.message, matchedTopicIds: [] };
        }
    });

    ipcMain.handle('save-agent-topic-title', async (event, agentId, topicId, newTitle) => {
        if (!topicId || !newTitle) return { error: 'Missing topicId or newTitle.' };
        try {
            if (agentConfigManager) {
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => {
                    if (!existingConfig.topics || !Array.isArray(existingConfig.topics)) {
                        return existingConfig;
                    }
                    const updatedConfig = { ...existingConfig, topics: [...existingConfig.topics] };
                    const topicIndex = updatedConfig.topics.findIndex(t => t.id === topicId);
                    if (topicIndex !== -1) {
                        updatedConfig.topics[topicIndex] = { ...updatedConfig.topics[topicIndex], name: newTitle };
                    }
                    return updatedConfig;
                });
                const updatedConfig = await agentConfigManager.readAgentConfig(agentId);
                return { success: true, topics: updatedConfig.topics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely save topic title for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to save topic title for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('get-chat-history', async (event, agentId, topicId) => {
        if (!topicId) return { error: `Missing topicId for agent ${agentId}.` };
        try {
            const historyFile = path.join(USER_DATA_DIR, agentId, 'topics', topicId, 'history.json');
            await fs.ensureDir(path.dirname(historyFile));


            if (await fs.pathExists(historyFile)) {
                return await fs.readJson(historyFile);
            }
            return [];
        } catch (error) {
            console.error(`Failed to load chat history for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('save-chat-history', async (event, agentId, topicId, history) => {
        if (!topicId) return { error: `Missing topicId for agent ${agentId}.` };
        try {
            if (fileWatcher) {
                fileWatcher.signalInternalSave();
            }
            const historyDir = path.join(USER_DATA_DIR, agentId, 'topics', topicId);
            await fs.ensureDir(historyDir);
            const historyFile = path.join(historyDir, 'history.json');
            await fs.writeJson(historyFile, history, { spaces: 2 });
            return { success: true };
        } catch (error) {
            console.error(`Failed to save chat history for agent ${agentId}, topic ${topicId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('get-agent-topics', async (event, agentId) => {
        try {
            let config;
            if (agentConfigManager) {
                try {
                    config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                } catch (readError) {
                    console.error(`Failed to read config for agent ${agentId} (get-agent-topics):`, readError);
                    return { error: `Failed to read config file: ${readError.message}` };
                }
            } else {
                const configPath = path.join(AGENT_DIR, agentId, 'config.json');
                if (await fs.pathExists(configPath)) {
                    try {
                        config = await fs.readJson(configPath);
                    } catch (readError) {
                        console.error(`Failed to read config.json for agent ${agentId}:`, readError);
                        return { error: `Failed to read config file: ${readError.message}` };
                    }
                }
            }

            if (config && config.topics && Array.isArray(config.topics)) {
                // Part A: 鍘嗗彶鏁版嵁鍏煎澶勭悊 - 鑷姩涓虹己灏戞柊瀛楁鐨勮瘽棰樻坊鍔犻粯璁わ拷?
                const normalizedTopics = config.topics.map(topic => ({
                    ...topic,
                    locked: topic.locked !== undefined ? topic.locked : true,
                    unread: topic.unread !== undefined ? topic.unread : false,
                    creatorSource: topic.creatorSource || 'unknown',
                    knowledgeBaseId: topic.knowledgeBaseId || null,
                }));
                return normalizedTopics;
            }
            return [];
        } catch (error) {
            console.error(`Failed to load topics for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('create-new-topic-for-agent', async (event, agentId, topicName, isBranch = false, locked = true) => {
        try {
            const newTopicId = `topic_${Date.now()}`;
            const timestamp = Date.now();

            if (agentConfigManager) {
                // Read the current config first so the fallback topic number is stable.
                const currentConfig = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                if (currentConfig.topics && !Array.isArray(currentConfig.topics)) {
                    return { error: `Invalid topics array in agent config.` };
                }
                const existingTopics = currentConfig.topics || [];

                const newTopic = {
                    id: newTopicId,
                    name: topicName || `New Topic ${existingTopics.length + 1}`,
                    createdAt: timestamp,
                    locked: locked,
                    unread: false,
                    creatorSource: "ui",
                    knowledgeBaseId: null,
                };
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => ({
                    ...existingConfig,
                    topics: [newTopic, ...(existingConfig.topics || [])]
                }));
                const updatedConfig = await agentConfigManager.readAgentConfig(agentId);

                const topicHistoryDir = path.join(USER_DATA_DIR, agentId, 'topics', newTopicId);
                await fs.ensureDir(topicHistoryDir);
                await fs.writeJson(path.join(topicHistoryDir, 'history.json'), [], { spaces: 2 });

                return { success: true, topicId: newTopicId, topicName: newTopic.name, topics: updatedConfig.topics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely create topic for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to create a topic for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('delete-topic', async (event, agentId, topicIdToDelete) => {
        try {
            if (agentConfigManager) {
                // Read the current config before validating the deletion target.
                const currentConfig = await agentConfigManager.readAgentConfig(agentId);
                if (!currentConfig.topics || !Array.isArray(currentConfig.topics)) {
                    return { error: 'Agent topics are unavailable.' };
                }
                const topicToDelete = currentConfig.topics.find(t => t.id === topicIdToDelete);
                if (!topicToDelete) {
                    return { error: `Topic not found: ${topicIdToDelete}` };
                }
                const knowledgeBaseId = topicToDelete.knowledgeBaseId || null;

                let remainingTopics;
                await agentConfigManager.updateAgentConfig(agentId, existingConfig => {
                    let filtered = (existingConfig.topics || []).filter(topic => topic.id !== topicIdToDelete);
                    if (filtered.length === 0) {
                        filtered = [{ id: "default", name: "Main Conversation", createdAt: Date.now(), knowledgeBaseId: null }];
                    }
                    remainingTopics = filtered;
                    return { ...existingConfig, topics: filtered };
                });

                // Recreate the default history file when the last topic is deleted.
                if (remainingTopics.length === 1 && remainingTopics[0].id === 'default') {
                    const defaultTopicHistoryDir = path.join(USER_DATA_DIR, agentId, 'topics', 'default');
                    await fs.ensureDir(defaultTopicHistoryDir);
                    const historyPath = path.join(defaultTopicHistoryDir, 'history.json');
                    if (!await fs.pathExists(historyPath)) {
                        await fs.writeJson(historyPath, [], { spaces: 2 });
                    }
                }

                const topicDataDir = path.join(USER_DATA_DIR, agentId, 'topics', topicIdToDelete);
                const topicNotesDir = path.join(DATA_ROOT, 'Notes', agentId, topicIdToDelete);
                const cleanupErrors = [];

                if (await fs.pathExists(topicDataDir)) {
                    try {
                        await fs.remove(topicDataDir);
                    } catch (error) {
                        cleanupErrors.push(`history cleanup failed: ${error.message}`);
                    }
                }

                if (await fs.pathExists(topicNotesDir)) {
                    try {
                        await fs.remove(topicNotesDir);
                    } catch (error) {
                        cleanupErrors.push(`notes cleanup failed: ${error.message}`);
                    }
                }

                if (knowledgeBaseId) {
                    try {
                        await knowledgeBase.deleteKnowledgeBase(knowledgeBaseId);
                        const refreshedConfig = await agentConfigManager.readAgentConfig(agentId, { allowDefault: true });
                        if (Array.isArray(refreshedConfig?.topics)) {
                            remainingTopics = refreshedConfig.topics;
                        }
                    } catch (error) {
                        cleanupErrors.push(`source cleanup failed: ${error.message}`);
                    }
                }

                if (cleanupErrors.length > 0) {
                    const warning = cleanupErrors.join('；');
                    console.error(`Topic ${topicIdToDelete} for agent ${agentId} deleted with cleanup warnings: ${warning}`);
                    return { success: true, remainingTopics, warning };
                }

                return { success: true, remainingTopics };
            } else {
                console.error(`AgentConfigManager not available, cannot safely delete topic for agent ${agentId}`);
                return { error: 'AgentConfigManager is unavailable.' };
            }
        } catch (error) {
            console.error(`Failed to delete topic ${topicIdToDelete} for agent ${agentId}:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('handle-file-paste', async (event, agentId, topicId, fileData) => {
        if (!topicId) return { error: 'Missing topicId.' };
        try {
            let storedFileObject;
            if (fileData.type === 'path') {
                const originalFileName = path.basename(fileData.path);
                const ext = path.extname(fileData.path).toLowerCase();
                let fileTypeHint = 'application/octet-stream';
                if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                    let mimeExt = ext.substring(1);
                    if (mimeExt === 'jpg') mimeExt = 'jpeg';
                    fileTypeHint = `image/${mimeExt}`;
                } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(ext)) {
                    const mimeExt = ext.substring(1);
                    fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                } else if (['.mp4', '.webm'].includes(ext)) {
                    fileTypeHint = `video/${ext.substring(1)}`;
                }

                const fileManager = require('../fileManager');
                storedFileObject = await fileManager.storeFile(fileData.path, originalFileName, agentId, topicId, fileTypeHint);
            } else if (fileData.type === 'base64') {
                const fileManager = require('../fileManager');
                const originalFileName = `pasted_image_${Date.now()}.${fileData.extension || 'png'}`;
                const buffer = Buffer.from(fileData.data, 'base64');
                const fileTypeHint = `image/${fileData.extension || 'png'}`;
                storedFileObject = await fileManager.storeFile(buffer, originalFileName, agentId, topicId, fileTypeHint);
            } else {
                throw new Error('Unsupported pasted file type.');
            }
            return { success: true, attachment: storedFileObject };
        } catch (error) {
            console.error('Failed to process pasted file:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('select-files-to-send', async (event, agentId, topicId) => {
        if (!agentId || !topicId) {
            console.error('[Main - select-files-to-send] Agent ID or Topic ID not provided.');
            return { error: "Agent ID and Topic ID are required to select files." };
        }

        const listenerWasActive = context.getSelectionListenerStatus();
        if (listenerWasActive) {
            context.stopSelectionListener();
            console.log('[Main] Temporarily stopped selection listener for file dialog.');
        }

        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select files to send',
            properties: ['openFile', 'multiSelections']
        });

        if (listenerWasActive) {
            context.startSelectionListener();
            console.log('[Main] Restarted selection listener after file dialog.');
        }

        if (!result.canceled && result.filePaths.length > 0) {
            const storedFilesInfo = [];
            for (const filePath of result.filePaths) {
                try {
                    const originalName = path.basename(filePath);
                    const ext = path.extname(filePath).toLowerCase();
                    let fileTypeHint = 'application/octet-stream';
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                        let mimeExt = ext.substring(1);
                        if (mimeExt === 'jpg') mimeExt = 'jpeg';
                        fileTypeHint = `image/${mimeExt}`;
                    } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(ext)) {
                        const mimeExt = ext.substring(1);
                        fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                    } else if (['.mp4', '.webm'].includes(ext)) {
                        fileTypeHint = `video/${ext.substring(1)}`;
                    }

                    const fileManager = require('../fileManager');
                    const storedFile = await fileManager.storeFile(filePath, originalName, agentId, topicId, fileTypeHint);
                    storedFilesInfo.push(storedFile);
                } catch (error) {
                    console.error(`[Main - select-files-to-send] Error storing file ${filePath}:`, error);
                    storedFilesInfo.push({ name: path.basename(filePath), error: error.message });
                }
            }
            return { success: true, attachments: storedFilesInfo };
        }
        return { success: false, attachments: [] };
    });

    ipcMain.handle('handle-text-paste-as-file', async (event, agentId, topicId, textContent) => {
        if (!agentId || !topicId) return { error: 'Missing agentId or topicId.' };
        if (typeof textContent !== 'string') return { error: 'Text content must be a string.' };

        try {
            const originalFileName = `pasted_text_${Date.now()}.txt`;
            const buffer = Buffer.from(textContent, 'utf8');
            const fileManager = require('../fileManager');
            const storedFileObject = await fileManager.storeFile(buffer, originalFileName, agentId, topicId, 'text/plain');
            return { success: true, attachment: storedFileObject };
        } catch (error) {
            console.error('[Main - handle-text-paste-as-file] Failed to convert pasted text into a file:', error);
            return { error: `Failed to convert pasted text into a file: ${error.message}` };
        }
    });

    ipcMain.handle('handle-file-drop', async (event, agentId, topicId, droppedFilesData) => {
        if (!agentId || !topicId) return { error: 'Missing agentId or topicId.' };
        if (!Array.isArray(droppedFilesData) || droppedFilesData.length === 0) return { error: 'No dropped files provided.' };

        const storedFilesInfo = [];
        for (const fileData of droppedFilesData) {
            try {
                // Check if we have a path or data. One of them must exist.
                if (!fileData.data && !fileData.path) {
                    console.warn('[Main - handle-file-drop] Skipping a dropped file due to missing data and path. fileData:', JSON.stringify(fileData));
                    storedFilesInfo.push({ name: fileData.name || 'Unknown file', error: 'Missing file data and path.' });
                    continue;
                }

                let fileSource;
                if (fileData.path) {
                    // If path is provided, use it as the source.
                    fileSource = fileData.path;
                } else {
                    // Otherwise, use the buffer from data.
                    fileSource = Buffer.isBuffer(fileData.data) ? fileData.data : Buffer.from(fileData.data);
                }

                let fileTypeHint = fileData.type;
                const fileExtension = path.extname(fileData.name).toLowerCase();

                // If file type is generic, try to guess from extension.
                if (fileTypeHint === 'application/octet-stream' || !fileTypeHint) {
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExtension)) {
                        fileTypeHint = `image/${fileExtension.substring(1).replace('jpg', 'jpeg')}`;
                    } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.aiff'].includes(fileExtension)) {
                        const mimeExt = fileExtension.substring(1);
                        fileTypeHint = `audio/${mimeExt === 'mp3' ? 'mpeg' : mimeExt}`;
                    } else if (['.mp4', '.webm'].includes(fileExtension)) {
                        fileTypeHint = `video/${fileExtension.substring(1)}`;
                    } else if (['.md', '.txt'].includes(fileExtension)) {
                        fileTypeHint = 'text/plain';
                    }
                }

                console.log(`[Main - handle-file-drop] Attempting to store dropped file: ${fileData.name} (Type: ${fileTypeHint}) for Agent: ${agentId}, Topic: ${topicId}`);

                const fileManager = require('../fileManager');
                const storedFile = await fileManager.storeFile(fileSource, fileData.name, agentId, topicId, fileTypeHint);
                storedFilesInfo.push({ success: true, attachment: storedFile, name: fileData.name });

            } catch (error) {
                console.error(`[Main - handle-file-drop] Error storing dropped file ${fileData.name || 'unknown'}:`, error);
                console.error(`[Main - handle-file-drop] Full error details:`, error.stack);
                storedFilesInfo.push({ name: fileData.name || 'Unknown file', error: error.message });
            }
        }
        return storedFilesInfo;
    });

    ipcMain.handle('get-original-message-content', async (event, itemId, itemType, topicId, messageId) => {
        if (!itemId || !itemType || !topicId || !messageId) {
            return { success: false, error: 'Missing required identifiers.' };
        }

        try {
            if (itemType !== 'agent') {
                return { success: false, error: 'Unsupported item type.' };
            }

            const historyFile = path.join(USER_DATA_DIR, itemId, 'topics', topicId, 'history.json');

            if (await fs.pathExists(historyFile)) {
                const history = await fs.readJson(historyFile);
                const message = history.find(m => m.id === messageId);
                if (message) {
                    return { success: true, content: message.content };
                } else {
                    return { success: false, error: 'Message not found in history.' };
                }
            } else {
                return { success: false, error: 'History file not found.' };
            }
        } catch (error) {
            console.error(`Failed to load original message content (itemId: ${itemId}, topicId: ${topicId}, messageId: ${messageId}):`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-to-vcp', async (event, request) => {
        const {
            requestId,
            endpoint,
            apiKey,
            messages,
            modelConfig = {},
            context = null,
        } = request || {};

        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            return { error: 'send-to-vcp expects a request object.' };
        }

        let processedMessages;
        try {
            processedMessages = Array.isArray(messages)
                ? messages.map(normalizeMessageForPreprocessing)
                : [];
        } catch (error) {
            console.error('[Main - sendToVCP] Message normalization failed:', error);
            return { error: `Message normalization failed: ${error.message}` };
        }

        let settings = {};
        try {
            settings = settingsManager && typeof settingsManager.readSettings === 'function'
                ? await settingsManager.readSettings()
                : {};
        } catch (error) {
            console.error('[Main - sendToVCP] Failed to read settings:', error);
        }

        let promptVariableResolution = {
            unresolvedTokens: [],
            substitutions: {},
            variableSources: {},
        };

        try {
            if (settings.enableAgentBubbleTheme === true) {
                processedMessages = applyAgentBubbleTheme(processedMessages);
            }

            if (settings.enableThoughtChainInjection !== true) {
                processedMessages = stripThoughtChains(processedMessages);
            }

            processedMessages = applyContextSanitizer(processedMessages, settings);

            const promptResolutionOptions = await buildPromptResolutionOptions({
                settings,
                context,
                modelConfig,
                agentConfigManager,
            });
            const resolution = resolvePromptMessageSet(processedMessages, promptResolutionOptions);
            processedMessages = resolution.messages;
            promptVariableResolution = {
                unresolvedTokens: resolution.unresolvedTokens,
                substitutions: resolution.substitutions,
                variableSources: resolution.variableSources,
            };

            if (resolution.unresolvedTokens.length > 0) {
                console.warn(
                    `[Main - sendToVCP] Unresolved prompt variables for request ${requestId || 'unknown'}: ${resolution.unresolvedTokens.join(', ')}`
                );
            }
        } catch (error) {
            console.error('[Main - sendToVCP] Message preprocessing failed:', error);
            return { error: `Message preprocessing failed: ${error.message}` };
        }

        try {
            if (modelConfig && modelConfig.model) {
                const modelUsageTracker = require('../modelUsageTracker');
                await modelUsageTracker.recordModelUsage(modelConfig.model);
            }
        } catch (error) {
            console.error('[ModelUsage] Failed to record model usage:', error);
        }

        const result = await vcpClient.send({
            requestId,
            endpoint,
            apiKey,
            messages: processedMessages,
            modelConfig,
            context,
            webContents: event.sender,
            streamChannel: 'vcp-stream-event',
        });

        return {
            ...(result || {}),
            promptVariableResolution,
        };
    });

    ipcMain.handle('interrupt-vcp-request', async (_event, request) => {
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            return { success: false, error: 'interrupt-vcp-request expects a request object.' };
        }

        return vcpClient.interrupt(request);
    });

    /**
     * Part C: 鏅鸿兘璁℃暟閫昏緫杈呭姪鍑芥暟
     * 鍒ゆ柇鏄惁搴旇婵€娲昏锟?
     * 瑙勫垯锛氫笂涓嬫枃锛堟帓闄ょ郴缁熸秷鎭級鏈変笖鍙湁涓€锟?AI 鐨勫洖澶嶏紝涓旀病鏈夌敤鎴峰洖锟?
     * @param {Array} history - 娑堟伅鍘嗗彶
     * @returns {boolean}
     */
    function shouldActivateCount(history) {
        if (!history || history.length === 0) return false;

        // 杩囨护鎺夌郴缁熸秷锟?
        const nonSystemMessages = history.filter(msg => msg.role !== 'system');

        // 蹇呴』鏈変笖鍙湁涓€鏉℃秷鎭紝涓旇娑堟伅锟?AI 鍥炲
        return nonSystemMessages.length === 1 && nonSystemMessages[0].role === 'assistant';
    }

    /**
     * Part C: 璁＄畻鏈娑堟伅鏁伴噺
     * @param {Array} history - 娑堟伅鍘嗗彶
     * @returns {number}
     */
    function countUnreadMessages(history) {
        return shouldActivateCount(history) ? 1 : 0;
    }

    /**
     * Part C: 璁＄畻鍗曚釜璇濋鐨勬湭璇绘秷鎭暟
     * @param {Object} topic - 璇濋瀵硅薄
     * @param {Array} history - 璇濋鍘嗗彶娑堟伅
     * @returns {number} - 鏈娑堟伅鏁帮紝-1 琛ㄧず浠呮樉绀哄皬锟?
     */
    function calculateTopicUnreadCount(topic, history) {
        // 浼樺厛妫€鏌ヨ嚜鍔ㄨ鏁版潯浠讹紙AI鍥炲浜嗕絾鐢ㄦ埛娌″洖锟?
        if (shouldActivateCount(history)) {
            const count = countUnreadMessages(history);
            if (count > 0) return count;
        }

        // 濡傛灉涓嶆弧瓒宠嚜鍔ㄨ鏁版潯浠讹紝浣嗚鎵嬪姩鏍囪涓烘湭璇伙紝鍒欐樉绀哄皬锟?
        if (topic.unread === true) {
            return -1; // 浠呮樉绀哄皬鐐癸紝涓嶆樉绀烘暟锟?
        }

        return 0; // 涓嶆樉锟?
    }

    ipcMain.handle('get-unread-topic-counts', async () => {
        const counts = {};
        try {
            const agentDirs = await fs.readdir(AGENT_DIR, { withFileTypes: true });
            for (const dirent of agentDirs) {
                if (dirent.isDirectory()) {
                    const agentId = dirent.name;
                    let totalCount = 0;
                    let hasUnreadMarker = false; // 鐢ㄤ簬鏍囪鏄惁鏈夋湭璇绘爣璁颁絾鏃犺锟?
                    const configPath = path.join(AGENT_DIR, agentId, 'config.json');

                    if (await fs.pathExists(configPath)) {
                        const config = await fs.readJson(configPath);
                        if (config.topics && Array.isArray(config.topics)) {
                            for (const topic of config.topics) {
                                const historyPath = path.join(USER_DATA_DIR, agentId, 'topics', topic.id, 'history.json');
                                if (await fs.pathExists(historyPath)) {
                                    try {
                                        const history = await fs.readJson(historyPath);
                                        const topicCount = calculateTopicUnreadCount(topic, history);
                                        if (topicCount > 0) {
                                            totalCount += topicCount;
                                        } else if (topicCount === -1) {
                                            // 鏈夋湭璇绘爣璁颁絾鏃犺鏁帮紝璁板綍杩欎釜鐘讹拷?
                                            hasUnreadMarker = true;
                                        }
                                    } catch (readJsonError) {
                                        console.error(`Failed to read history.json: ${historyPath}`, readJsonError);
                                    }
                                }
                            }
                        }
                    }

                    // 濡傛灉鏈夎鏁帮紝鏄剧ず鏁板瓧
                    if (totalCount > 0) {
                        counts[agentId] = totalCount;
                    } else if (hasUnreadMarker) {
                        // 濡傛灉鍙湁鏈鏍囪娌℃湁璁℃暟锛岃繑锟?0锛堝墠绔細璇嗗埆涓轰粎鏄剧ず灏忕偣锟?
                        counts[agentId] = 0;
                    }
                }
            }
            return { success: true, counts };
        } catch (error) {
            console.error('Failed to compute unread topic counts:', error);
            return { success: false, error: error.message, counts: {} };
        }
    });

    // Toggle topic lock state.
    ipcMain.handle('toggle-topic-lock', async (event, agentId, topicId) => {
        try {
            const agentConfigPath = path.join(AGENT_DIR, agentId, 'config.json');
            if (!await fs.pathExists(agentConfigPath)) {
                return { success: false, error: `Agent config file not found for ${agentId}.` };
            }

            if (agentConfigManager) {
                const result = await agentConfigManager.updateTopic(agentId, topicId, (topic) => {
                    const currentLocked = topic.locked === undefined ? true : topic.locked;
                    return {
                        ...topic,
                        locked: !currentLocked,
                    };
                });

                return {
                    success: true,
                    locked: result.topic.locked,
                    message: result.topic.locked ? 'Topic locked.' : 'Topic unlocked.'
                };
            }

            let config;
            try {
                config = await fs.readJson(agentConfigPath);
            } catch (e) {
                console.error(`Failed to read agent config for ${agentId} (toggle-topic-lock):`, e);
                return { success: false, error: `Failed to read config file: ${e.message}` };
            }

            if (!config.topics || !Array.isArray(config.topics)) {
                return { success: false, error: 'Topics are unavailable for this agent.' };
            }

            const topic = config.topics.find(t => t.id === topicId);
            if (!topic) {
                return { success: false, error: `Topic not found: ${topicId}` };
            } else {
                // Part A: 鍘嗗彶鏁版嵁鍏煎 - 濡傛灉璇濋娌℃湁 locked 瀛楁锛岄粯璁よ缃负 true
                if (topic.locked === undefined) {
                    topic.locked = true;
                }

                // Toggle the lock flag.
                topic.locked = !topic.locked;

                await fs.writeJson(agentConfigPath, config, { spaces: 2 });

                return {
                    success: true,
                    locked: topic.locked,
                    message: topic.locked ? 'Topic locked.' : 'Topic unlocked.'
                };
            }
        } catch (error) {
            console.error('[toggleTopicLock] Error:', error);
            return { success: false, error: error.message };
        }
    });

    // Set topic unread state.
    ipcMain.handle('set-topic-unread', async (event, agentId, topicId, unread) => {
        try {
            const agentConfigPath = path.join(AGENT_DIR, agentId, 'config.json');
            if (!await fs.pathExists(agentConfigPath)) {
                return { success: false, error: `Agent config file not found for ${agentId}.` };
            }

            if (agentConfigManager) {
                const result = await agentConfigManager.updateTopic(agentId, topicId, (topic) => {
                    const normalizedTopic = topic.unread === undefined
                        ? { ...topic, unread: false }
                        : topic;
                    return {
                        ...normalizedTopic,
                        unread,
                    };
                });

                return { success: true, unread: result.topic.unread };
            }

            let config;
            try {
                config = await fs.readJson(agentConfigPath);
            } catch (e) {
                console.error(`Failed to read agent config for ${agentId} (set-topic-unread):`, e);
                return { success: false, error: `Failed to read config file: ${e.message}` };
            }

            if (!config.topics || !Array.isArray(config.topics)) {
                return { success: false, error: 'Topics are unavailable for this agent.' };
            }

            const topic = config.topics.find(t => t.id === topicId);
            if (!topic) {
                return { success: false, error: `Topic not found: ${topicId}` };
            } else {
                // Part A: 鍘嗗彶鏁版嵁鍏煎 - 濡傛灉璇濋娌℃湁 unread 瀛楁锛岄粯璁よ缃负 false
                if (topic.unread === undefined) {
                    topic.unread = false;
                }

                topic.unread = unread;
                await fs.writeJson(agentConfigPath, config, { spaces: 2 });

                return { success: true, unread: topic.unread };
            }
        } catch (error) {
            console.error('[setTopicUnread] Error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcHandlersRegistered = true;
}

module.exports = {
    initialize
};




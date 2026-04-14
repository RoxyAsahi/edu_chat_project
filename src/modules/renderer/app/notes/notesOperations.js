import {
    buildMessageNoteContent,
    buildNoteSaveRequest,
    deriveDeletedNoteState,
    getNormalizedNoteKind,
    removeDeletedNoteReferencesFromHistory,
} from './notesUtils.js';
import {
    buildQuizSummaryMarkdown,
    parseQuizSetFromResponse,
} from '../quiz/quizUtils.js';

function createNotesOperations(deps = {}) {
    const state = deps.state || {};
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const flashcardsApi = deps.flashcardsApi || {
        beginPendingGeneration: () => {},
        buildGeneratedFlashcardContent: () => null,
        clearPendingGeneration: () => {},
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
    };
    const persistHistory = deps.persistHistory || (async () => {});
    const buildTopicContext = deps.buildTopicContext || (() => ({}));
    const createId = deps.createId || ((prefix) => `${prefix}_${Date.now()}`);
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const normalizeNote = deps.normalizeNote || ((note) => note);
    const getActiveNote = deps.getActiveNote || (() => null);
    const getCurrentDetailNote = deps.getCurrentDetailNote || (() => null);
    const findNoteById = deps.findNoteById || (() => null);
    const patchCurrentHistoryMessage = deps.patchCurrentHistoryMessage || (() => null);
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const getSelectedNotes = deps.getSelectedNotes || (() => []);
    const renderNotesPanel = deps.renderNotesPanel || (() => {});
    const renderManualNotesLibrary = deps.renderManualNotesLibrary || (() => {});
    const clearNoteEditor = deps.clearNoteEditor || (() => {});
    const openNoteDetail = deps.openNoteDetail || (() => {});
    const closeNoteDetail = deps.closeNoteDetail || (() => {});
    const decorateChatMessages = deps.decorateChatMessages || (() => {});
    const revealNote = deps.revealNote || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const setSidePanelTab = deps.setSidePanelTab || (() => {});

    async function loadTopicNotes() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            state.topicNotes = [];
            renderNotesPanel();
            if (state.manualNotesLibraryOpen) {
                renderManualNotesLibrary();
            }
            return;
        }

        const result = await chatAPI.listTopicNotes(state.currentSelectedItem.id, state.currentTopicId).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载话题笔记失败：${result?.error || '未知错误'}`, 'error');
            state.topicNotes = [];
            renderNotesPanel();
            if (state.manualNotesLibraryOpen) {
                renderManualNotesLibrary();
            }
            return;
        }

        state.topicNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.manualNotesLibraryOpen) {
            renderManualNotesLibrary();
        }
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function loadAgentNotes() {
        if (!state.currentSelectedItem.id) {
            state.agentNotes = [];
            renderNotesPanel();
            if (state.manualNotesLibraryOpen) {
                renderManualNotesLibrary();
            }
            return;
        }

        const result = await chatAPI.listAgentNotes(state.currentSelectedItem.id).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载学科笔记失败：${result?.error || '未知错误'}`, 'error');
            state.agentNotes = [];
            renderNotesPanel();
            if (state.manualNotesLibraryOpen) {
                renderManualNotesLibrary();
            }
            return;
        }

        state.agentNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.manualNotesLibraryOpen) {
            renderManualNotesLibrary();
        }
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function refreshNotesData() {
        await loadTopicNotes();
        await loadAgentNotes();
    }

    async function saveActiveNote() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题，再保存笔记。', 'warning');
            return;
        }

        const request = buildNoteSaveRequest({
            currentNote: getActiveNote(),
            currentTopicId: state.currentTopicId,
            title: el.noteTitleInput?.value.trim() || '',
            contentMarkdown: el.noteContentInput?.value || '',
        });

        if (!request) {
            ui.showToastNotification('请输入笔记标题或内容。', 'warning');
            return;
        }

        const result = await chatAPI.saveTopicNote(
            state.currentSelectedItem.id,
            request.targetTopicId,
            request.payload,
        );

        if (!result?.success) {
            ui.showToastNotification(`保存笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.activeNoteId = result.item?.id || null;
        await refreshNotesData();
        openNoteDetail(normalizeNote(result.item || {}));
        ui.showToastNotification('笔记已保存。', 'success');
    }

    async function syncDeletedNoteReferences(note) {
        const noteId = String(note?.id || '').trim();
        const agentId = String(note?.agentId || '').trim();
        const topicId = String(note?.topicId || '').trim();
        if (!noteId || !agentId || !topicId) {
            return { success: true, changed: false };
        }

        const isCurrentTopic = agentId === state.currentSelectedItem.id && topicId === state.currentTopicId;
        const history = isCurrentTopic
            ? state.currentChatHistory
            : await chatAPI.getChatHistory(agentId, topicId).catch(() => null);

        if (!Array.isArray(history)) {
            return {
                success: false,
                changed: false,
                error: '无法读取关联会话的历史记录。',
            };
        }

        const { changed, nextHistory } = removeDeletedNoteReferencesFromHistory(history, noteId);
        if (!changed) {
            return { success: true, changed: false };
        }

        const saveResult = await chatAPI.saveChatHistory(agentId, topicId, nextHistory).catch((error) => ({
            error: error.message,
        }));
        if (saveResult?.error) {
            return {
                success: false,
                changed: false,
                error: saveResult.error,
            };
        }

        if (isCurrentTopic) {
            updateCurrentChatHistory(nextHistory);
            decorateChatMessages();
        }

        return { success: true, changed: true };
    }

    async function deleteNoteRecord(note) {
        const currentNote = note ? normalizeNote(note) : (getCurrentDetailNote() ? normalizeNote(getCurrentDetailNote()) : null);
        if (!currentNote?.id) {
            ui.showToastNotification('请先选择一条笔记。', 'warning');
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除笔记“${currentNote.title}”吗？`,
            '删除笔记',
            '删除',
            '取消',
            true,
        );
        if (!confirmed) {
            return;
        }

        const result = await chatAPI.deleteTopicNote(currentNote.agentId, currentNote.topicId, currentNote.id);
        if (!result?.success) {
            ui.showToastNotification(`删除笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        const syncResult = await syncDeletedNoteReferences(currentNote);
        const nextState = deriveDeletedNoteState({
            selectedNoteIds: state.selectedNoteIds,
            activeNoteId: state.activeNoteId,
            activeFlashcardNoteId: state.activeFlashcardNoteId,
        }, currentNote.id);
        state.selectedNoteIds = nextState.selectedNoteIds;
        state.activeNoteId = nextState.activeNoteId;
        state.activeFlashcardNoteId = nextState.activeFlashcardNoteId;
        if (!state.activeNoteId) {
            clearNoteEditor();
        }
        await refreshNotesData();
        if (state.notesStudioView === 'detail') {
            closeNoteDetail({ restoreFocus: false });
        }
        if (!syncResult?.success) {
            ui.showToastNotification(`笔记已删除，但消息引用清理失败：${syncResult?.error || '未知错误'}`, 'warning', 5000);
            return;
        }
        ui.showToastNotification('笔记已删除。', 'success');
    }

    async function deleteActiveNote() {
        await deleteNoteRecord(null);
    }

    async function createNoteFromMessage(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        const noteBase = buildMessageNoteContent(message);
        const timestamp = new Date(message.timestamp || Date.now()).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\//g, '-');
        const result = await chatAPI.createNoteFromMessage({
            agentId: state.currentSelectedItem.id,
            topicId: state.currentTopicId,
            title: `${noteBase.title} ${timestamp}`,
            contentMarkdown: noteBase.contentMarkdown,
            sourceMessageIds: [message.id],
            sourceDocumentRefs: Array.isArray(message.kbContextRefs) ? message.kbContextRefs : [],
            kind: 'message-note',
        });

        if (!result?.success) {
            ui.showToastNotification(`生成笔记失败：${result?.error || '未知错误'}`, 'error');
            return null;
        }

        patchCurrentHistoryMessage(messageId, (entry) => ({
            ...entry,
            favorited: true,
            favoriteAt: Date.now(),
            noteRefs: Array.isArray(entry.noteRefs)
                ? [...new Set([...entry.noteRefs, result.item.id])]
                : [result.item.id],
        }));
        await persistHistory();
        await refreshNotesData();
        revealNote(result.item);
        decorateChatMessages();
        ui.showToastNotification('已从当前气泡生成笔记。', 'success');
        return normalizeNote(result.item);
    }

    async function toggleMessageFavorite(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        if (message.favorited) {
            patchCurrentHistoryMessage(messageId, (entry) => ({
                ...entry,
                favorited: false,
                favoriteAt: null,
            }));
            await persistHistory();
            decorateChatMessages();
            ui.showToastNotification('已取消收藏，已生成的笔记会继续保留。', 'info');
            return null;
        }

        let favoriteNote = null;
        const existingNoteId = Array.isArray(message.noteRefs) ? message.noteRefs[0] : null;
        if (existingNoteId) {
            await refreshNotesData();
            favoriteNote = findNoteById(existingNoteId);
        }

        if (!favoriteNote) {
            favoriteNote = await createNoteFromMessage(messageId);
            if (!favoriteNote) {
                return null;
            }
        } else {
            patchCurrentHistoryMessage(messageId, (entry) => ({
                ...entry,
                favorited: true,
                favoriteAt: Date.now(),
            }));
            await persistHistory();
            revealNote(favoriteNote);
            decorateChatMessages();
            ui.showToastNotification('已收藏，并已打开关联笔记。', 'success');
        }

        return favoriteNote;
    }

    async function resolveStudyInputText() {
        const selectedNotes = getSelectedNotes();
        if (selectedNotes.length > 0) {
            return {
                sourceLabel: 'selected-notes',
                text: selectedNotes
                    .map((note) => `# ${note.title}\n\n${note.contentMarkdown}`)
                    .join('\n\n---\n\n'),
                sourceMessageIds: [...new Set(selectedNotes.flatMap((note) => note.sourceMessageIds || []))],
                sourceDocumentRefs: selectedNotes.flatMap((note) => note.sourceDocumentRefs || []),
            };
        }

        const currentTopic = getCurrentTopic();
        if (!currentTopic?.knowledgeBaseId) {
            return null;
        }

        const sourceResult = await chatAPI.retrieveKnowledgeBaseContext({
            kbId: currentTopic.knowledgeBaseId,
            query: '请概览当前来源资料的核心知识点、重点概念和常见考点。',
        }).catch(() => null);

        if (!sourceResult?.success || !sourceResult.contextText) {
            return null;
        }

        return {
            sourceLabel: 'topic-source',
            text: sourceResult.contextText,
            sourceMessageIds: [],
            sourceDocumentRefs: Array.isArray(sourceResult.refs) ? sourceResult.refs : [],
        };
    }

    async function runNotesTool(kind) {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }

        const studyInput = await resolveStudyInputText();
        if (!studyInput?.text) {
            ui.showToastNotification('请先选择笔记，或为当前话题绑定并导入来源资料。', 'warning');
            return;
        }

        const prompts = {
            analysis: {
                title: `深度分析报告 ${new Date().toLocaleString()}`,
                instruction: '请基于以下学习材料生成一份结构化深度分析报告，包含：核心结论、关键知识点、关联关系、疑难点/待补问题、后续学习建议。使用简体中文 Markdown。',
                kind: 'analysis',
            },
            quiz: {
                title: '选择题练习',
                instruction: [
                    '请基于以下学习材料生成一组结构化选择题练习。',
                    '你必须只返回严格 JSON，不要输出 JSON 之外的任何文字。',
                    '禁止输出寒暄、前言、分隔线、时间戳标题、Markdown 标题或额外说明。',
                    'JSON 结构如下：',
                    '{',
                    '  "title": "测验标题",',
                    '  "items": [',
                    '    {',
                    '      "id": "quiz_1",',
                    '      "stem": "题干",',
                    '      "options": [',
                    '        { "id": "option_a", "label": "A", "text": "选项内容" },',
                    '        { "id": "option_b", "label": "B", "text": "选项内容" },',
                    '        { "id": "option_c", "label": "C", "text": "选项内容" },',
                    '        { "id": "option_d", "label": "D", "text": "选项内容" }',
                    '      ],',
                    '      "correctOptionId": "option_a",',
                    '      "explanation": "简明解析"',
                    '    }',
                    '  ]',
                    '}',
                    '要求：',
                    '1. 生成 8 道题。',
                    '2. 每题必须且只能有 4 个选项，label 必须严格为 A/B/C/D。',
                    '3. correctOptionId 必须严格对应某个 option.id。',
                    '4. 题干、选项、答案、解析全部使用简体中文。',
                    '5. title 使用简洁的练习名称，不要带时间戳。',
                ].join('\n'),
                kind: 'quiz',
            },
            flashcards: {
                title: `闪卡集合 ${new Date().toLocaleString()}`,
                instruction: [
                    '请基于以下学习材料生成一组适合复习记忆的结构化闪卡。',
                    '你必须返回严格 JSON，不要输出 JSON 之外的说明。',
                    'JSON 结构如下：',
                    '{',
                    '  "title": "卡组标题",',
                    '  "cards": [',
                    '    { "id": "card-1", "front": "问题正面", "back": "答案背面" }',
                    '  ]',
                    '}',
                    '要求：',
                    '1. 生成 12 张卡。',
                    '2. front 与 back 都使用简体中文，可包含少量 Markdown 强调。',
                    '3. 每张卡必须信息准确、去重、适合抽认卡练习。',
                    '4. title 要简洁、像一个可学习的卡组名称。',
                ].join('\n'),
                kind: 'flashcards',
            },
        };

        const prompt = prompts[kind];
        if (!prompt) {
            return;
        }

        if (prompt.kind === 'flashcards') {
            flashcardsApi.beginPendingGeneration({
                title: prompt.title,
                sourceCount: Array.isArray(studyInput.sourceDocumentRefs) ? studyInput.sourceDocumentRefs.length : 0,
            });
        }

        ui.showToastNotification('正在生成内容，请稍候…', 'info', 2500);

        const response = await chatAPI.sendToVCP({
            requestId: createId(`study_${kind}`),
            endpoint: state.settings.vcpServerUrl,
            apiKey: state.settings.vcpApiKey,
            messages: [
                {
                    role: 'system',
                    content: prompt.kind === 'quiz' || prompt.kind === 'flashcards'
                        ? '你是 UniStudy 的学习助手。请严格遵守输出格式要求，不要输出任何额外说明。'
                        : '你是 UniStudy 的学习助手，请输出结构清晰、适合学习沉淀的 Markdown。',
                },
                { role: 'user', content: `${prompt.instruction}\n\n学习材料如下：\n\n${studyInput.text}` },
            ],
            modelConfig: {
                model: state.currentSelectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
                temperature: 0.4,
                max_tokens: Number(state.currentSelectedItem.config?.maxOutputTokens ?? 2400),
                top_p: 0.95,
                stream: false,
            },
            context: buildTopicContext(),
        });

        if (response?.error) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`生成失败：${response.error}`, 'error');
            return;
        }

        const responseContent = response?.response?.choices?.[0]?.message?.content || '';
        if (!responseContent.trim()) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification('模型没有返回可保存的内容。', 'warning');
            return;
        }

        let contentMarkdown = responseContent;
        let quizSet = null;
        let flashcardDeck = null;
        let flashcardProgress = null;

        if (prompt.kind === 'quiz') {
            quizSet = parseQuizSetFromResponse(responseContent, prompt.title);
            if (!quizSet) {
                ui.showToastNotification('选择题生成结果格式无效，请重试。', 'error');
                return;
            }

            contentMarkdown = buildQuizSummaryMarkdown(quizSet);
        } else if (prompt.kind === 'flashcards') {
            const generated = flashcardsApi.buildGeneratedFlashcardContent(
                responseContent,
                prompt.title,
                studyInput.sourceDocumentRefs,
            );

            if (!generated) {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
                ui.showToastNotification('闪卡生成结果格式无效，请重试。', 'error');
                return;
            }

            flashcardDeck = generated.flashcardDeck;
            flashcardProgress = generated.flashcardProgress;
            contentMarkdown = generated.contentMarkdown;
        }

        const saveResult = await chatAPI.saveTopicNote(state.currentSelectedItem.id, state.currentTopicId, {
            title: prompt.kind === 'quiz'
                ? (quizSet?.title || prompt.title)
                : prompt.title,
            contentMarkdown,
            sourceMessageIds: studyInput.sourceMessageIds,
            sourceDocumentRefs: studyInput.sourceDocumentRefs,
            kind: prompt.kind,
            quizSet,
            flashcardDeck,
            flashcardProgress,
        });

        if (!saveResult?.success) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`保存生成结果失败：${saveResult?.error || '未知错误'}`, 'error');
            return;
        }

        await refreshNotesData();
        const savedNote = normalizeNote(saveResult.item);
        if (prompt.kind === 'flashcards' && flashcardsApi.hasStructuredFlashcards(savedNote)) {
            flashcardsApi.clearPendingGeneration();
            flashcardsApi.openPractice(savedNote, { trigger: el.generateFlashcardsBtn || null });
        } else {
            flashcardsApi.clearPendingGeneration();
            openNoteDetail(savedNote, {
                kind: getNormalizedNoteKind(savedNote),
                trigger: prompt.kind === 'analysis'
                    ? el.analyzeNotesBtn
                    : (prompt.kind === 'quiz' ? el.generateQuizBtn : null),
            });
        }

        setSidePanelTab('notes');
        ui.showToastNotification('已生成并保存到当前话题笔记。', 'success');
    }

    return {
        createNoteFromMessage,
        deleteActiveNote,
        deleteNoteRecord,
        loadAgentNotes,
        loadTopicNotes,
        refreshNotesData,
        runNotesTool,
        saveActiveNote,
        toggleMessageFavorite,
    };
}

export {
    createNotesOperations,
};

import {
    buildMessageNoteContent,
    buildNoteSaveRequest,
    deriveDeletedNoteState,
    getNormalizedNoteKind,
    normalizeRenderSnapshot,
    removeDeletedNoteReferencesFromHistory,
} from './notesUtils.js';
import {
    buildQuizSummaryMarkdown,
    parseQuizSetFromResponse,
} from '../quiz/quizUtils.js';

const QUIZ_COUNT_PRESETS = {
    less: 5,
    standard: 8,
    more: 12,
};

const FLASHCARD_COUNT_PRESETS = {
    less: 8,
    standard: 12,
    more: 18,
};

const QUIZ_DIFFICULTY_LABELS = {
    easy: '简单',
    medium: '中等',
    hard: '困难',
};

const QUIZ_DIFFICULTY_DESCRIPTIONS = {
    easy: '偏基础理解，主要考查核心概念、定义和直接应用。',
    medium: '兼顾概念理解、常见应用和必要辨析，适合作为默认练习。',
    hard: '提高综合性和辨析度，覆盖易错点、跨概念判断和更细的干扰项。',
};

const DEFAULT_QUIZ_GENERATION_CONFIG = {
    countPreset: 'standard',
    questionCount: QUIZ_COUNT_PRESETS.standard,
    difficulty: 'medium',
    focus: '',
    includeChatContext: false,
};

const DEFAULT_FLASHCARD_GENERATION_CONFIG = {
    countPreset: 'standard',
    cardCount: FLASHCARD_COUNT_PRESETS.standard,
    difficulty: 'medium',
    focus: '',
    includeChatContext: false,
};

const RECENT_CHAT_CONTEXT_LIMIT = 12;
const RECENT_CHAT_MESSAGE_CHAR_LIMIT = 3000;
const HTML_ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

function normalizeAnalysisGenerationOptions(options = {}) {
    return {
        selectedNoteIds: Array.isArray(options.selectedNoteIds)
            ? [...new Set(options.selectedNoteIds.map((id) => String(id || '').trim()).filter(Boolean))]
            : null,
        requireSelectedNotes: options.requireSelectedNotes === true,
        guidance: String(options.guidance || '').trim(),
        title: String(options.title || '').trim(),
        openAfterSave: options.openAfterSave !== false,
        returnSavedNote: options.returnSavedNote === true,
        trigger: options.trigger || null,
    };
}

function buildAnalysisInstruction(options = {}) {
    const config = normalizeAnalysisGenerationOptions(options);
    const guidance = config.guidance || '请全面分析这些笔记，找出共性主题、关键知识点、迁移关系和后续改进方向。';
    return [
        '你是一位专业的学习教练和教育分析专家，擅长把多条学习笔记进行横向迁移、综合诊断和行动建议提炼。',
        '',
        `本次分析指引：${guidance}`,
        '',
        '请基于以下学习材料生成一份结构清晰的简体中文 Markdown 深度分析报告。请引用笔记标题来支撑你的判断，并尽量体现跨话题/跨学科之间的关联。',
        '',
        '报告结构必须包含：',
        '# 深度分析报告',
        '## 1. 整体概览',
        '概括这些笔记覆盖的主题、材料范围和最重要的总体结论。',
        '## 2. 共性主题与关联网络',
        '提炼反复出现的概念、方法、模型或问题，并说明它们之间如何关联。',
        '## 3. 知识点诊断',
        '指出掌握较好的部分、容易混淆的部分、证据不足的部分。',
        '## 4. 跨话题/跨学科迁移',
        '说明哪些思想、方法或解题策略可以迁移到其他话题或学科场景。',
        '## 5. 薄弱点与待补问题',
        '列出需要补齐的理解漏洞、值得追问的问题和可能的误区。',
        '## 6. 后续学习计划',
        '给出可执行的复习顺序、练习方向和下一步产出建议。',
        '## 7. 代表性笔记解析',
        '挑选 2-3 条最有代表性的笔记，解释它们为什么关键。',
        '',
        '格式要求：使用 Markdown；数学公式使用 LaTeX；语言专业但易懂；不要输出 JSON；不要编造材料中不存在的事实。',
    ].join('\n');
}

function normalizeQuizGenerationOptions(options = {}) {
    const requestedPreset = String(options.countPreset || '').trim();
    const countPreset = Object.prototype.hasOwnProperty.call(QUIZ_COUNT_PRESETS, requestedPreset)
        ? requestedPreset
        : DEFAULT_QUIZ_GENERATION_CONFIG.countPreset;
    const requestedCount = Number(options.questionCount);
    const questionCount = Number.isFinite(requestedCount) && requestedCount > 0
        ? Math.max(1, Math.min(30, Math.round(requestedCount)))
        : QUIZ_COUNT_PRESETS[countPreset];
    const requestedDifficulty = String(options.difficulty || '').trim();
    const difficulty = Object.prototype.hasOwnProperty.call(QUIZ_DIFFICULTY_LABELS, requestedDifficulty)
        ? requestedDifficulty
        : DEFAULT_QUIZ_GENERATION_CONFIG.difficulty;

    return {
        countPreset,
        questionCount,
        difficulty,
        focus: String(options.focus || '').trim(),
        includeChatContext: options.includeChatContext === true,
    };
}

function normalizeFlashcardGenerationOptions(options = {}) {
    const requestedPreset = String(options.countPreset || '').trim();
    const countPreset = Object.prototype.hasOwnProperty.call(FLASHCARD_COUNT_PRESETS, requestedPreset)
        ? requestedPreset
        : DEFAULT_FLASHCARD_GENERATION_CONFIG.countPreset;
    const requestedCount = Number(options.cardCount);
    const cardCount = Number.isFinite(requestedCount) && requestedCount > 0
        ? Math.max(1, Math.min(60, Math.round(requestedCount)))
        : FLASHCARD_COUNT_PRESETS[countPreset];
    const requestedDifficulty = String(options.difficulty || '').trim();
    const difficulty = Object.prototype.hasOwnProperty.call(QUIZ_DIFFICULTY_LABELS, requestedDifficulty)
        ? requestedDifficulty
        : DEFAULT_FLASHCARD_GENERATION_CONFIG.difficulty;

    return {
        countPreset,
        cardCount,
        difficulty,
        focus: String(options.focus || '').trim(),
        includeChatContext: options.includeChatContext === true,
    };
}

function decodeHtmlEntities(value = '') {
    return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
        const normalized = String(entity || '').toLowerCase();
        if (normalized.startsWith('#x')) {
            const codePoint = parseInt(normalized.slice(2), 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        if (normalized.startsWith('#')) {
            const codePoint = parseInt(normalized.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, normalized)
            ? HTML_ENTITY_MAP[normalized]
            : match;
    });
}

function normalizeStudyTextWhitespace(value = '') {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripHtmlForStudyContext(value = '') {
    return decodeHtmlEntities(String(value || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\s*(script|style|noscript|template|svg|canvas)\b[\s\S]*?<\/\s*\1\s*>/gi, '')
        .replace(/<\s*img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, '\n$2\n')
        .replace(/<\s*img\b[^>]*>/gi, '\n')
        .replace(/<\s*(?:br|hr)\b[^>]*\/?>/gi, '\n')
        .replace(/<\s*\/?\s*(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|tr|td|th|table|thead|tbody|blockquote|pre)\b[^>]*>/gi, '\n')
        .replace(/<\s*\/?\s*[a-z][a-z0-9:-]*\b[^>]*>/gi, ' '));
}

function sanitizeStudyMessageText(value = '') {
    const sanitized = normalizeStudyTextWhitespace(stripHtmlForStudyContext(value)
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)]\((?:https?:\/\/|file:|\/)[^)]+\)/g, '$1'));
    if (sanitized.length <= RECENT_CHAT_MESSAGE_CHAR_LIMIT) {
        return sanitized;
    }

    return `${sanitized.slice(0, RECENT_CHAT_MESSAGE_CHAR_LIMIT).trimEnd()}\n...（内容过长，已截断）`;
}

function getRawMessageTextContent(message = {}) {
    const content = message.content;
    if (typeof content === 'string') {
        return content.trim();
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    return part.text;
                }
                return typeof part?.text === 'string' ? part.text : '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') {
        return content.text.trim();
    }
    if (content && typeof content === 'object') {
        try {
            return JSON.stringify(content, null, 2).trim();
        } catch {
            return '';
        }
    }
    return '';
}

function getMessageTextContent(message = {}) {
    return sanitizeStudyMessageText(getRawMessageTextContent(message));
}

function buildRecentChatContext(history = []) {
    const messages = Array.isArray(history)
        ? history
            .filter((message) => (
                message
                && message.isThinking !== true
                && (message.role === 'user' || message.role === 'assistant')
                && getMessageTextContent(message)
            ))
            .slice(-RECENT_CHAT_CONTEXT_LIMIT)
        : [];

    if (messages.length === 0) {
        return { text: '', sourceMessageIds: [] };
    }

    return {
        text: [
            `# 当前对话摘录（最近 ${messages.length} 条）`,
            ...messages.map((message, index) => {
                const roleLabel = message.role === 'user' ? '用户' : 'AI';
                return `## ${index + 1}. ${roleLabel}\n\n${getMessageTextContent(message)}`;
            }),
        ].join('\n\n'),
        sourceMessageIds: messages.map((message) => message.id).filter(Boolean),
    };
}

function buildQuizInstruction(options = {}) {
    const config = normalizeQuizGenerationOptions(options);
    const difficultyLabel = QUIZ_DIFFICULTY_LABELS[config.difficulty];
    const difficultyDescription = QUIZ_DIFFICULTY_DESCRIPTIONS[config.difficulty];
    const requirements = [
        `1. 生成 ${config.questionCount} 道题。`,
        '2. 每题必须且只能有 4 个选项，label 必须严格为 A/B/C/D。',
        '3. correctOptionId 必须严格对应某个 option.id。',
        '4. 题干、选项、答案、解析全部使用简体中文。',
        '5. title 使用简洁的练习名称，不要带时间戳。',
        `6. 难度等级：${difficultyLabel}。${difficultyDescription}`,
    ];

    if (config.focus) {
        requirements.push(`7. 主题范围：${config.focus}。请优先围绕这个主题出题，不要偏离学习材料。`);
    }

    return [
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
        ...requirements,
    ].join('\n');
}

function buildFlashcardInstruction(options = {}) {
    const config = normalizeFlashcardGenerationOptions(options);
    const difficultyLabel = QUIZ_DIFFICULTY_LABELS[config.difficulty];
    const difficultyDescription = QUIZ_DIFFICULTY_DESCRIPTIONS[config.difficulty];
    const requirements = [
        `1. 生成 ${config.cardCount} 张卡。`,
        '2. front 与 back 都使用简体中文，可包含少量 Markdown 强调。',
        '3. 每张卡必须信息准确、去重、适合抽认卡练习。',
        '4. front 必须简短易记，优先控制在 1-5 个字或一个短问题。',
        '5. back 必须直接回答 front，不要写成长篇报告。',
        '6. title 要简洁、像一个可学习的卡组名称，不要带时间戳。',
        `7. 难度等级：${difficultyLabel}。${difficultyDescription}`,
    ];

    if (config.focus) {
        requirements.push(`8. 主题范围：${config.focus}。请优先围绕这个主题制卡，不要偏离学习材料。`);
    }

    return [
        '请基于以下学习材料生成一组适合复习记忆的结构化闪卡。',
        '你必须只返回严格 JSON，不要输出 JSON 之外的任何文字。',
        '禁止输出寒暄、前言、分隔线、时间戳标题、Markdown 标题或额外说明。',
        'JSON 结构如下：',
        '{',
        '  "title": "卡组标题",',
        '  "cards": [',
        '    { "id": "card-1", "front": "问题正面", "back": "答案背面" }',
        '  ]',
        '}',
        '要求：',
        ...requirements,
    ].join('\n');
}

function cloneArray(value) {
    return Array.isArray(value) ? [...value] : [];
}

function snapshotTopic(topic) {
    if (!topic || typeof topic !== 'object') {
        return null;
    }

    return {
        ...topic,
        selectedKnowledgeBaseDocumentIds: cloneArray(topic.selectedKnowledgeBaseDocumentIds),
    };
}

function snapshotChatHistory(history = []) {
    return Array.isArray(history)
        ? history.map((message) => ({
            ...message,
            attachments: cloneArray(message?.attachments),
            kbContextRefs: cloneArray(message?.kbContextRefs),
            studyMemoryRefs: cloneArray(message?.studyMemoryRefs),
            followUps: cloneArray(message?.followUps),
            citations: cloneArray(message?.citations),
        }))
        : [];
}

function snapshotNotes(notes = []) {
    return Array.isArray(notes)
        ? notes.map((note) => ({
            ...note,
            sourceMessageIds: cloneArray(note?.sourceMessageIds),
            sourceDocumentRefs: cloneArray(note?.sourceDocumentRefs),
        }))
        : [];
}

function countStudyInputSources(studyInput = {}, selectedNoteCount = 0) {
    if (Number(selectedNoteCount) > 0) {
        return Number(selectedNoteCount);
    }

    const documentCount = Array.isArray(studyInput.sourceDocumentRefs)
        ? studyInput.sourceDocumentRefs.length
        : 0;
    if (documentCount > 0) {
        return documentCount;
    }

    return Array.isArray(studyInput.sourceMessageIds)
        ? studyInput.sourceMessageIds.length
        : 0;
}

function extractResponseText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (typeof part?.text === 'string') {
                    return part.text;
                }
                if (typeof part?.content === 'string') {
                    return part.content;
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    if (value && typeof value === 'object' && typeof value.text === 'string') {
        return value.text;
    }
    return '';
}

function extractStudyToolResponseContent(response = {}) {
    const payload = response?.response || response || {};
    const candidates = [
        payload?.choices?.[0]?.message?.content,
        payload?.choices?.[0]?.text,
        payload?.message?.content,
        payload?.output_text,
        payload?.content,
    ];

    for (const candidate of candidates) {
        const text = extractResponseText(candidate);
        if (text.trim()) {
            return text;
        }
    }

    return '';
}

function createNotesOperations(deps = {}) {
    const state = deps.state || {};
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const messageRendererApi = deps.messageRendererApi || {};
    const flashcardsApi = deps.flashcardsApi || {
        beginPendingGeneration: () => {},
        buildGeneratedFlashcardContent: () => null,
        clearPendingGeneration: () => {},
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
        updatePendingGeneration: () => {},
    };
    const persistHistory = deps.persistHistory || (async () => {});
    const buildTopicContext = deps.buildTopicContext || (() => ({}));
    const createId = deps.createId || ((prefix) => `${prefix}_${Date.now()}`);
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const normalizeNote = deps.normalizeNote || ((note) => note);
    const getActiveNote = deps.getActiveNote || (() => null);
    const getCurrentDetailNote = deps.getCurrentDetailNote || (() => null);
    const findNoteById = deps.findNoteById || (() => null);
    const getAgentDisplayLabel = deps.getAgentDisplayLabel || ((agentId) => {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return '未归类学科';
        }
        const agent = (Array.isArray(state.agents) ? state.agents : [])
            .find((item) => String(item?.id || '') === normalizedAgentId);
        return agent?.name || normalizedAgentId;
    });
    const getTopicDisplayLabel = deps.getTopicDisplayLabel || ((topicId) => {
        const normalizedTopicId = String(topicId || '').trim();
        if (!normalizedTopicId) {
            return '未归类话题';
        }
        const topic = (Array.isArray(state.topics) ? state.topics : [])
            .find((item) => String(item?.id || '') === normalizedTopicId);
        return topic?.name || normalizedTopicId;
    });
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

    function getPendingQuizGenerations() {
        return Array.isArray(state.pendingQuizGenerations)
            ? state.pendingQuizGenerations
            : [];
    }

    function hasPendingQuizGeneration(agentId, topicId) {
        return getPendingQuizGenerations().some((pending) => (
            pending
            && String(pending.agentId || '') === String(agentId || '')
            && String(pending.topicId || '') === String(topicId || '')
        ));
    }

    function beginPendingQuizGeneration(payload = {}) {
        const requestId = String(payload.requestId || '').trim();
        if (!requestId) {
            return;
        }

        state.pendingQuizGenerations = [
            ...getPendingQuizGenerations().filter((pending) => pending?.requestId !== requestId),
            {
                requestId,
                agentId: String(payload.agentId || ''),
                topicId: String(payload.topicId || ''),
                title: String(payload.title || '选择题练习'),
                questionCount: Number(payload.questionCount || 0),
                difficulty: String(payload.difficulty || 'medium'),
                sourceCount: Number(payload.sourceCount || 0),
                focus: String(payload.focus || ''),
                startedAt: Number(payload.startedAt || Date.now()),
            },
        ];
        setRightPanelMode('notes');
        renderNotesPanel();
    }

    function updatePendingQuizGeneration(requestId, patch = {}) {
        const normalizedRequestId = String(requestId || '').trim();
        if (!normalizedRequestId) {
            return;
        }

        let changed = false;
        state.pendingQuizGenerations = getPendingQuizGenerations().map((pending) => {
            if (pending?.requestId !== normalizedRequestId) {
                return pending;
            }
            changed = true;
            return {
                ...pending,
                ...patch,
            };
        });
        if (changed) {
            renderNotesPanel();
        }
    }

    function clearPendingQuizGeneration(requestId) {
        const normalizedRequestId = String(requestId || '').trim();
        if (!normalizedRequestId) {
            return;
        }

        const nextPending = getPendingQuizGenerations().filter((pending) => pending?.requestId !== normalizedRequestId);
        if (nextPending.length === getPendingQuizGenerations().length) {
            return;
        }
        state.pendingQuizGenerations = nextPending;
        renderNotesPanel();
    }

    function createGenerationContext(kind, options = {}) {
        const selectedItem = state.currentSelectedItem || {};
        return {
            kind,
            requestId: createId(`study_${kind}`),
            agentId: String(selectedItem.id || ''),
            topicId: String(state.currentTopicId || ''),
            selectedItem: {
                ...selectedItem,
                config: { ...(selectedItem.config || {}) },
            },
            settings: { ...(state.settings || {}) },
            currentTopic: snapshotTopic(getCurrentTopic()),
            currentChatHistory: snapshotChatHistory(state.currentChatHistory),
            selectedNotes: snapshotNotes(getSelectedNotes(options.selectedNoteIds)),
            topicContext: buildTopicContext(),
            startedAt: Date.now(),
        };
    }

    function isActiveGenerationContext(context = {}) {
        return (
            String(state.currentSelectedItem?.id || '') === String(context.agentId || '')
            && String(state.currentTopicId || '') === String(context.topicId || '')
        );
    }

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

    async function loadAllAgentManualNotes() {
        const agents = Array.isArray(state.agents) ? state.agents : [];
        if (!agents.length || typeof chatAPI.listAgentNotes !== 'function') {
            state.allAgentManualNotes = [];
            if (state.manualNotesLibraryOpen) {
                renderManualNotesLibrary();
            }
            return;
        }

        const results = await Promise.all(agents.map(async (agent) => {
            const agentId = String(agent?.id || '').trim();
            if (!agentId) {
                return [];
            }
            const result = await chatAPI.listAgentNotes(agentId).catch(() => ({ success: false, items: [] }));
            return result?.success && Array.isArray(result.items)
                ? result.items.map((note) => normalizeNote({ ...note, agentId: note?.agentId || agentId }))
                : [];
        }));

        state.allAgentManualNotes = results.flat().filter((note) => {
            const kind = getNormalizedNoteKind(note);
            return kind === 'note' || kind === 'analysis';
        });
        if (state.manualNotesLibraryOpen) {
            renderManualNotesLibrary();
        }
    }

    async function refreshNotesData() {
        await loadTopicNotes();
        await loadAgentNotes();
        if (state.manualNotesLibraryOpen) {
            await loadAllAgentManualNotes();
        }
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
        let renderSnapshot = null;
        if (typeof messageRendererApi.createMessageRenderSnapshot === 'function') {
            try {
                renderSnapshot = normalizeRenderSnapshot(messageRendererApi.createMessageRenderSnapshot(message));
            } catch (error) {
                console.warn('[Notes] Failed to capture message render snapshot:', error);
                renderSnapshot = null;
            }
        }
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
            renderSnapshot,
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

    async function resolveStudyInputText(options = {}, generationContext = {}) {
        const getChatContext = () => buildRecentChatContext(
            Array.isArray(generationContext.currentChatHistory)
                ? generationContext.currentChatHistory
                : state.currentChatHistory,
        );
        const buildChatOnlyInput = () => {
            if (!options.includeChatContext) {
                return null;
            }

            const chatContext = getChatContext();
            if (!chatContext.text) {
                return null;
            }

            return {
                sourceLabel: 'chat-context',
                text: chatContext.text,
                sourceMessageIds: chatContext.sourceMessageIds,
                sourceDocumentRefs: [],
            };
        };
        const appendChatContext = (studyInput) => {
            if (!options.includeChatContext || !studyInput?.text) {
                return studyInput;
            }

            const chatContext = getChatContext();
            if (!chatContext.text) {
                return studyInput;
            }

            return {
                ...studyInput,
                text: `${studyInput.text}\n\n---\n\n${chatContext.text}`,
                sourceMessageIds: [
                    ...new Set([
                        ...(Array.isArray(studyInput.sourceMessageIds) ? studyInput.sourceMessageIds : []),
                        ...chatContext.sourceMessageIds,
                    ]),
                ],
            };
        };

        const selectedNotes = Array.isArray(generationContext.selectedNotes)
            ? generationContext.selectedNotes
            : getSelectedNotes();
        if (selectedNotes.length > 0) {
            return appendChatContext({
                sourceLabel: 'selected-notes',
                text: selectedNotes
                    .map((note, index) => {
                        const agentLabel = getAgentDisplayLabel(note.agentId);
                        const topicLabel = getTopicDisplayLabel(note.topicId);
                        const updatedLabel = note.updatedAt
                            ? new Date(note.updatedAt).toLocaleString('zh-CN', { hour12: false })
                            : '未知';
                        return [
                            `# 笔记 ${index + 1}：${note.title}`,
                            '',
                            `- 学科：${agentLabel}`,
                            `- 话题：${topicLabel}`,
                            `- 更新时间：${updatedLabel}`,
                            '',
                            note.contentMarkdown,
                        ].join('\n');
                    })
                    .join('\n\n---\n\n'),
                sourceMessageIds: [...new Set(selectedNotes.flatMap((note) => note.sourceMessageIds || []))],
                sourceDocumentRefs: selectedNotes.flatMap((note) => note.sourceDocumentRefs || []),
            });
        }

        const currentTopic = generationContext.currentTopic || getCurrentTopic();
        if (!currentTopic?.knowledgeBaseId) {
            return buildChatOnlyInput();
        }

        const sourceResult = await chatAPI.retrieveKnowledgeBaseContext({
            kbId: currentTopic.knowledgeBaseId,
            query: '请概览当前来源资料的核心知识点、重点概念和常见考点。',
            ...(Array.isArray(currentTopic.selectedKnowledgeBaseDocumentIds)
                ? { documentIds: currentTopic.selectedKnowledgeBaseDocumentIds }
                : {}),
        }).catch(() => null);

        if (!sourceResult?.success || !sourceResult.contextText) {
            return buildChatOnlyInput();
        }

        return appendChatContext({
            sourceLabel: 'topic-source',
            text: sourceResult.contextText,
            sourceMessageIds: [],
            sourceDocumentRefs: Array.isArray(sourceResult.refs) ? sourceResult.refs : [],
        });
    }

    async function runNotesTool(kind, options = {}) {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return false;
        }

        const quizOptions = kind === 'quiz'
            ? normalizeQuizGenerationOptions(options)
            : DEFAULT_QUIZ_GENERATION_CONFIG;
        const flashcardOptions = kind === 'flashcards'
            ? normalizeFlashcardGenerationOptions(options)
            : DEFAULT_FLASHCARD_GENERATION_CONFIG;
        const analysisOptions = kind === 'analysis'
            ? normalizeAnalysisGenerationOptions(options)
            : normalizeAnalysisGenerationOptions();
        const prompts = {
            analysis: {
                title: analysisOptions.title || `深度分析报告 ${new Date().toLocaleString()}`,
                instruction: buildAnalysisInstruction(analysisOptions),
                kind: 'analysis',
            },
            quiz: {
                title: '选择题练习',
                instruction: buildQuizInstruction(quizOptions),
                kind: 'quiz',
            },
            flashcards: {
                title: `闪卡集合 ${new Date().toLocaleString()}`,
                instruction: buildFlashcardInstruction(flashcardOptions),
                kind: 'flashcards',
            },
        };

        const prompt = prompts[kind];
        if (!prompt) {
            return false;
        }

        const generationContext = createGenerationContext(kind, kind === 'analysis' ? analysisOptions : {});
        if (prompt.kind === 'analysis' && analysisOptions.requireSelectedNotes && generationContext.selectedNotes.length === 0) {
            ui.showToastNotification('请先选择需要深度分析的笔记。', 'warning');
            return false;
        }
        if (prompt.kind === 'quiz' && hasPendingQuizGeneration(generationContext.agentId, generationContext.topicId)) {
            ui.showToastNotification('当前话题已有选择题正在生成，请稍候。', 'info');
            return false;
        }

        let pendingQuizRequestId = null;
        let pendingFlashcardRequestId = null;
        if (prompt.kind === 'quiz') {
            pendingQuizRequestId = generationContext.requestId;
            beginPendingQuizGeneration({
                requestId: generationContext.requestId,
                agentId: generationContext.agentId,
                topicId: generationContext.topicId,
                title: prompt.title,
                questionCount: quizOptions.questionCount,
                difficulty: quizOptions.difficulty,
                sourceCount: 0,
                focus: quizOptions.focus,
                startedAt: generationContext.startedAt,
            });
        }
        if (prompt.kind === 'flashcards') {
            pendingFlashcardRequestId = generationContext.requestId;
            flashcardsApi.beginPendingGeneration({
                requestId: generationContext.requestId,
                agentId: generationContext.agentId,
                topicId: generationContext.topicId,
                title: prompt.title,
                cardCount: flashcardOptions.cardCount,
                difficulty: flashcardOptions.difficulty,
                sourceCount: 0,
                focus: flashcardOptions.focus,
                startedAt: generationContext.startedAt,
            });
        }

        try {
            const generationOptions = prompt.kind === 'quiz'
                ? quizOptions
                : (
                    prompt.kind === 'flashcards'
                        ? flashcardOptions
                        : analysisOptions
                );
            const studyInput = await resolveStudyInputText(generationOptions, generationContext);
            if (!studyInput?.text) {
                const missingInputMessage = prompt.kind === 'quiz' || prompt.kind === 'flashcards'
                    ? '请先选择笔记、导入来源资料，或勾选“包含当前对话”。'
                    : (
                        analysisOptions.requireSelectedNotes
                            ? '请先选择需要深度分析的笔记。'
                            : '请先选择笔记，或为当前话题绑定并导入来源资料。'
                    );
                ui.showToastNotification(missingInputMessage, 'warning');
                return false;
            }

            if (prompt.kind === 'quiz') {
                updatePendingQuizGeneration(generationContext.requestId, {
                    sourceCount: countStudyInputSources(studyInput, generationContext.selectedNotes.length),
                });
            }

            if (prompt.kind === 'flashcards') {
                flashcardsApi.updatePendingGeneration(generationContext.requestId, {
                    sourceCount: countStudyInputSources(studyInput, generationContext.selectedNotes.length),
                });
            }

            ui.showToastNotification('正在生成内容，请稍候…', 'info', 2500);

            const response = await chatAPI.sendChatRequest({
                requestId: generationContext.requestId,
                endpoint: generationContext.settings.chatEndpoint,
                apiKey: generationContext.settings.chatApiKey,
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
                    purpose: 'studyTool',
                    modelRef: generationContext.settings.modelService?.defaults?.studyTool || null,
                    model: String(generationContext.settings.studyToolDefaultModel || '').trim()
                        || generationContext.selectedItem.config?.model
                        || 'gemini-3.1-flash-lite-preview',
                    temperature: 0.4,
                    max_tokens: Number(generationContext.selectedItem.config?.maxOutputTokens ?? 2400),
                    top_p: 0.95,
                    stream: false,
                },
                context: generationContext.topicContext,
            });

            if (response?.error) {
                ui.showToastNotification(`生成失败：${response.error}`, 'error');
                return false;
            }

            const responseContent = extractStudyToolResponseContent(response);
            if (!responseContent.trim()) {
                ui.showToastNotification('模型这次没有返回内容，已取消本次生成。可以稍后重试或换一个学习工具模型。', 'warning');
                return false;
            }

            let contentMarkdown = responseContent;
            let quizSet = null;
            let flashcardDeck = null;
            let flashcardProgress = null;

            if (prompt.kind === 'quiz') {
                quizSet = parseQuizSetFromResponse(responseContent, prompt.title);
                if (!quizSet) {
                    ui.showToastNotification('选择题生成结果格式无效，请重试。', 'error');
                    return false;
                }

                contentMarkdown = buildQuizSummaryMarkdown(quizSet);
            } else if (prompt.kind === 'flashcards') {
                const generated = flashcardsApi.buildGeneratedFlashcardContent(
                    responseContent,
                    prompt.title,
                    studyInput.sourceDocumentRefs,
                );

                if (!generated) {
                    ui.showToastNotification('闪卡生成结果格式无效，请重试。', 'error');
                    return false;
                }

                flashcardDeck = generated.flashcardDeck;
                flashcardProgress = generated.flashcardProgress;
                contentMarkdown = generated.contentMarkdown;
            }

            const saveResult = await chatAPI.saveTopicNote(generationContext.agentId, generationContext.topicId, {
                title: prompt.kind === 'quiz'
                    ? (quizSet?.title || prompt.title)
                    : (
                        prompt.kind === 'flashcards'
                            ? (flashcardDeck?.title || prompt.title)
                            : prompt.title
                    ),
                contentMarkdown,
                sourceMessageIds: studyInput.sourceMessageIds,
                sourceDocumentRefs: studyInput.sourceDocumentRefs,
                kind: prompt.kind,
                quizSet,
                flashcardDeck,
                flashcardProgress,
            });

            if (!saveResult?.success) {
                ui.showToastNotification(`保存生成结果失败：${saveResult?.error || '未知错误'}`, 'error');
                return false;
            }

            const savedNote = normalizeNote({
                ...(saveResult.item || {}),
                agentId: saveResult.item?.agentId || generationContext.agentId,
                topicId: saveResult.item?.topicId || generationContext.topicId,
            });

            if (!isActiveGenerationContext(generationContext)) {
                if (prompt.kind === 'flashcards') {
                    flashcardsApi.clearPendingGeneration(generationContext.requestId);
                }
                ui.showToastNotification('已生成并保存到发起的话题笔记。', 'success');
                return analysisOptions.returnSavedNote ? savedNote : true;
            }

            await refreshNotesData();
            if (!isActiveGenerationContext(generationContext)) {
                if (prompt.kind === 'flashcards') {
                    flashcardsApi.clearPendingGeneration(generationContext.requestId);
                }
                ui.showToastNotification('已生成并保存到发起的话题笔记。', 'success');
                return analysisOptions.returnSavedNote ? savedNote : true;
            }

            if (prompt.kind === 'flashcards' && flashcardsApi.hasStructuredFlashcards(savedNote)) {
                flashcardsApi.clearPendingGeneration(generationContext.requestId);
                flashcardsApi.openPractice(savedNote, { trigger: el.generateFlashcardsBtn || null });
            } else if (prompt.kind !== 'analysis' || analysisOptions.openAfterSave) {
                openNoteDetail(savedNote, {
                    kind: getNormalizedNoteKind(savedNote),
                    trigger: prompt.kind === 'analysis'
                        ? (analysisOptions.trigger || el.manualNewNoteBtn || el.analyzeNotesBtn)
                        : (prompt.kind === 'quiz' ? el.generateQuizBtn : null),
                });
            }

            setSidePanelTab('notes');
            ui.showToastNotification('已生成并保存到当前话题笔记。', 'success');
            return analysisOptions.returnSavedNote ? savedNote : true;
        } finally {
            if (pendingQuizRequestId) {
                clearPendingQuizGeneration(pendingQuizRequestId);
            }
            if (pendingFlashcardRequestId) {
                flashcardsApi.clearPendingGeneration(pendingFlashcardRequestId);
            }
        }
    }

    return {
        createNoteFromMessage,
        deleteActiveNote,
        deleteNoteRecord,
        loadAllAgentManualNotes,
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

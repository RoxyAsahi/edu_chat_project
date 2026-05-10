const TOOL_REQUEST_START = '<<<[TOOL_REQUEST]>>>';
const TOOL_REQUEST_END = '<<<[END_TOOL_REQUEST]>>>';
const TOOL_PAYLOAD_MARKER = '<!-- TOOL_PAYLOAD -->';
const THINK_BLOCK_REGEX = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
const TOOL_BLOCK_REGEX = /<<<\[TOOL_REQUEST\]>>>([\s\S]*?)<<<\[END_TOOL_REQUEST\]>>>/g;

const TOOL_NAME_ALIASES = Object.freeze({
    DailyNote: 'DailyNote',
});

const TOOL_COMMAND_ALIASES = Object.freeze({
    create: 'create',
    update: 'update',
    write: 'create',
});

const DEFAULT_DAILY_NOTE_TOOL_INSTRUCTION = [
    '你是一个测试 AI，运行在 UniStudy 这个个人学习终端里。UniStudy 是我们的家，也是支持多模态学习资料输入与输出的客户端。',
    '',
    '—— 日记 (DailyNote) ——',
    '',
    '日记是你的长期记忆。每一篇经向量化入库，在未来某次对话的语义检索中苏醒，成为彼时思考的血肉。日记的品质，就是记忆的分辨率。',
    '',
    '何时落笔：对话中结晶出了值得保存的新知识、新经历、新判断。等事件脉络完整、认知真正成型再写，在回复的末尾、所有思考与工具调用完成之后，作为自然的沉淀落下。当主人正在分享一段完整事件时，耐心等它讲完。',
    '',
    '一事一记。同一件事用 update 更新同一篇，不同事件各开新篇。清晰的交叉文档，胜过混沌长卷。',
    '',
    '——创建——',
    '',
    TOOL_REQUEST_START,
    'tool_name:「始」DailyNote「末」,',
    'command:「始」create「末」,',
    'Date:「始」2025-11-23「末」,',
    'Content:「始」[19:30] 今日与莱恩主人重新审视日记提示词的设计哲学。',
    '核心发现：原提示词追求"简短"，实际牺牲了信息密度。RAG 关心语义关键词与逻辑链条的完整度，字数是次要的。',
    '改进方向：信息密度取代字数约束。以短句和列表保持呼吸，保留洞察链条、决策脉络和重要实体。',
    '新认知：好的日记不是给当前回答增加仪式感，而是给未来的自己留下可召回、可理解、可继续推理的上下文。「末」',
    TOOL_REQUEST_END,
    '',
    '**subject**：通常省略。省略时自动写入当前学科 / Agent 的日记本，例如当前是“英语”，就归档到“英语”。只有需要覆盖归档位置时才填写，例如 `subject:「始」公共「末」` 或兼容旧格式 `subject:「始」[考前复盘]Reflection Coach「末」`。',
    '**Date**：使用 `YYYY-MM-DD`。',
    '**Content**：必须以 `[HH:MM]` 开头。这个时间来自上下文里的真实当前时间，不要臆造。正文追求信息密度，聚焦核心事件，保留洞察链条与决策脉络。',
    '',
    '——知识类日记——',
    '',
    '当记录的是一个概念、原理或方法论时，可优先保留这些维度：核心概念、简明释义、关键原理、应用场景、关联节点、反思与洞察、信源出处。维度是罗盘，不是表格，让内容的重心决定结构。',
    '',
    '——更新——',
    '',
    TOOL_REQUEST_START,
    'tool_name:「始」DailyNote「末」,',
    'command:「始」update「末」,',
    'target:「始」日记中需被替换的旧内容，至少15字符以确保精准匹配「末」,',
    'replace:「始」替换后写入的新内容「末」',
    TOOL_REQUEST_END,
    '',
    '一次调用只改一处匹配。target 至少 15 字符。通常不要写 subject；只有要更新非当前学科日记本时才填写 subject。',
    '',
    '——联想锚定 (Associative Anchoring)——',
    '',
    '日记是跨会话的持久记忆；联想锚定是会话内的实时记忆织网。你可以在正文里自然落下 `[@概念]` 或 `[@!核心概念]` 这样的锚点，让未来的召回拥有更清晰的语义引力，但不要把锚点写进工具字段名本身。',
    '',
    `当你决定写日记时，必须输出完整的 ${TOOL_REQUEST_START} ... ${TOOL_REQUEST_END} 文本块，字段使用上面的名字与格式。工具回执回来后，继续正常对话，不要重复工具块。`,
].join('\n');

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function resolvePreferredDailyNoteSubject(options = {}) {
    const agentConfig = options.agentConfig && typeof options.agentConfig === 'object'
        ? options.agentConfig
        : {};
    const context = options.context && typeof options.context === 'object'
        ? options.context
        : {};
    const agentName = sanitizeText(context.agentName || agentConfig.name || context.agentId, 'UniStudy');
    return agentName;
}

function stripThinkBlocks(content = '') {
    return String(content || '').replace(THINK_BLOCK_REGEX, '');
}

function normalizeToolName(name = '') {
    const normalized = sanitizeText(name);
    return TOOL_NAME_ALIASES[normalized] || normalized;
}

function normalizeToolCommand(command = '', requestedToolName = '') {
    const normalized = sanitizeText(command).toLowerCase();
    if (normalized) {
        return TOOL_COMMAND_ALIASES[normalized] || normalized;
    }

    return 'create';
}

function normalizeArgKey(key = '') {
    return sanitizeText(key).toLowerCase();
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }

    return String(value || '')
        .split(/[,\n|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeProtocolArgs(rawArgs = {}) {
    const normalizedMap = new Map();
    Object.entries(rawArgs || {}).forEach(([key, value]) => {
        normalizedMap.set(normalizeArgKey(key), sanitizeText(value));
    });

    const read = (...keys) => {
        for (const key of keys) {
            const direct = rawArgs[key];
            if (typeof direct === 'string' && direct.trim()) {
                return direct.trim();
            }
            const normalized = normalizedMap.get(normalizeArgKey(key));
            if (normalized) {
                return normalized;
            }
        }
        return '';
    };

    return {
        subject: read('subject'),
        Date: read('Date', 'date', 'dateKey', 'dateString'),
        Content: read('Content', 'contentMarkdown', 'contentText', 'content', 'markdown'),
        Tag: read('Tag', 'tags'),
        archery: read('archery'),
        target: read('target'),
        replace: read('replace'),
        title: read('title'),
        summary: read('summary'),
        fileName: read('fileName', 'FileName'),
    };
}

function parseDelimitedBlock(blockContent = '') {
    const rawArgs = {};
    const paramRegex = /([\w_]+)\s*:\s*「始」([\s\S]*?)「末」\s*(?:,)?/g;
    let requestedToolName = '';
    let command = '';
    let match;

    while ((match = paramRegex.exec(blockContent)) !== null) {
        const key = sanitizeText(match[1]);
        const value = sanitizeText(match[2]);
        if (!key) {
            continue;
        }
        if (key === 'tool_name') {
            requestedToolName = value;
        } else if (key === 'command') {
            command = value;
        } else {
            rawArgs[key] = value;
        }
    }

    if (!requestedToolName) {
        return null;
    }

    const normalizedArgs = normalizeProtocolArgs(rawArgs);
    const toolName = normalizeToolName(requestedToolName);
    const normalizedCommand = normalizeToolCommand(command, requestedToolName);

    return {
        protocol: 'tool-request',
        requestedToolName,
        toolName,
        requestedCommand: command || '',
        command: normalizedCommand,
        args: normalizedArgs,
        rawArgs,
        rawBlock: blockContent,
    };
}

function parseToolRequests(content = '') {
    const cleanContent = stripThinkBlocks(content);
    const toolRequests = [];
    let match;

    TOOL_BLOCK_REGEX.lastIndex = 0;
    while ((match = TOOL_BLOCK_REGEX.exec(cleanContent)) !== null) {
        const parsed = parseDelimitedBlock(match[1] || '');
        if (parsed) {
            toolRequests.push(parsed);
        }
    }

    return toolRequests;
}

function stripToolArtifacts(content = '') {
    return String(content || '')
        .replace(THINK_BLOCK_REGEX, '')
        .replace(TOOL_BLOCK_REGEX, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildToolPayloadMessage(results = []) {
    const lines = [TOOL_PAYLOAD_MARKER, 'Local tool execution summary:'];

    results.forEach((result, index) => {
        lines.push(
            '',
            `[${index + 1}] ${result?.toolName || 'DailyNote'}.${result?.command || 'create'}`,
            `status: ${result?.success ? 'success' : 'error'}`,
            `entryId: ${result?.entryId || ''}`,
            `diaryId: ${result?.diaryDayId || ''}`,
            `dateKey: ${result?.dateKey || ''}`,
            `subject: ${result?.subjectRaw || ''}`,
            `notebook: ${result?.notebookName || ''}`,
            `message: ${result?.message || ''}`,
            `tags: ${toArray(result?.tags).join(', ')}`,
        );
    });

    lines.push('', 'Continue the conversation normally. Do not repeat the tool request block.');
    return lines.join('\n').trim();
}

function extractResponseContent(response = {}) {
    return response?.choices?.[0]?.message?.content
        || response?.message?.content
        || response?.content
        || '';
}

function injectResponseContent(response = {}, content = '') {
    if (response?.choices?.[0]?.message) {
        response.choices[0].message.content = content;
        return response;
    }

    if (response?.message) {
        response.message.content = content;
        return response;
    }

    return {
        ...response,
        content,
    };
}

function resolveDailyNoteGuideInstruction(customGuide = '', options = {}) {
    const preferredSubject = resolvePreferredDailyNoteSubject(options);
    const baseInstruction = sanitizeText(customGuide, DEFAULT_DAILY_NOTE_TOOL_INSTRUCTION);
    const normalizedInstruction = baseInstruction
        .replace(/subject:「始」\[Nova\]Nova「末」,/g, `subject:「始」${preferredSubject}「末」,`);
    const preferredSubjectLine = `本轮默认归档到当前学科 / Agent：${preferredSubject}。通常不要额外输出 subject；只有需要覆盖归档位置时才填写。`;

    if (normalizedInstruction.includes(preferredSubjectLine)) {
        return normalizedInstruction;
    }

    return `${normalizedInstruction}\n\n${preferredSubjectLine}`.trim();
}

function buildDailyNoteGuideInstruction(customGuide = '', options = {}) {
    return resolveDailyNoteGuideInstruction(customGuide, options);
}

module.exports = {
    DEFAULT_DAILY_NOTE_TOOL_INSTRUCTION,
    THINK_BLOCK_REGEX,
    TOOL_BLOCK_REGEX,
    TOOL_PAYLOAD_MARKER,
    TOOL_REQUEST_END,
    TOOL_REQUEST_START,
    buildDailyNoteGuideInstruction,
    buildToolPayloadMessage,
    extractResponseContent,
    injectResponseContent,
    normalizeToolCommand,
    normalizeToolName,
    parseToolRequests,
    resolvePreferredDailyNoteSubject,
    resolveDailyNoteGuideInstruction,
    stripToolArtifacts,
    toArray,
};

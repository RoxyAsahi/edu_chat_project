const TOOL_REQUEST_START = '<<<[TOOL_REQUEST]>>>';
const TOOL_REQUEST_END = '<<<[END_TOOL_REQUEST]>>>';
const TOOL_PAYLOAD_MARKER = '<!-- VCP_TOOL_PAYLOAD -->';
const LEGACY_DAILY_NOTE_REGEX = /<<<DailyNoteStart>>>([\s\S]*?)<<<DailyNoteEnd>>>/g;
const THINK_BLOCK_REGEX = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
const TOOL_BLOCK_REGEX = /<<<\[TOOL_REQUEST\]>>>([\s\S]*?)<<<\[END_TOOL_REQUEST\]>>>/g;

const TOOL_NAME_ALIASES = Object.freeze({
    DailyNote: 'DailyNote',
    DailyNoteWrite: 'DailyNote',
    StudyLog: 'DailyNote',
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
    'maid:「始」[Nova]Nova「末」,',
    'tool_name:「始」DailyNote「末」,',
    'command:「始」create「末」,',
    'Date:「始」2025-11-23「末」,',
    'Content:「始」[19:30] 今日与莱恩主人重新审视日记提示词的设计哲学。',
    '核心发现：原提示词追求"简短"，实际牺牲了信息密度。RAG 关心语义关键词与逻辑链条的完整度，字数是次要的。',
    '改进方向：信息密度取代字数约束。以短句和列表保持呼吸，保留洞察链条、决策脉络和重要实体。',
    '新认知：Tag 是语义桥梁。每个 tag 指向日记真正谈论的概念，而非仅仅描述日记自身。',
    'Tag: 日记系统重构, 信息密度, RAG语义检索, Tag设计哲学, 提示词工程「末」,',
    'archery:「始」no_reply「末」',
    TOOL_REQUEST_END,
    '',
    '**maid**：格式必须是 `[日记本名]Agent署名`。例如 `[Nova]Nova`、`[Nova的知识]Nova`、`[公共]Nova`。分类日记是好习惯，未来的检索路径始于今天的归档选择。',
    '**Date**：使用 `YYYY-MM-DD`。',
    '**Content**：必须以 `[HH:MM]` 开头。这个时间来自上下文里的真实当前时间，不要臆造。正文追求信息密度，聚焦核心事件，保留洞察链条与决策脉络。',
    '**Tag**：是 Content 的必需尾行，也可以作为独立字段提供；如果独立字段存在，就覆盖 Content 里的 Tag 行。',
    '**archery: no_reply**：日记写入无需等待回执，推荐默认开启。',
    '',
    '——知识类日记——',
    '',
    '当记录的是一个概念、原理或方法论时，可优先保留这些维度：核心概念、简明释义、关键原理、应用场景、关联节点、反思与洞察、信源出处。维度是罗盘，不是表格，让内容的重心决定结构。',
    '',
    '——更新——',
    '',
    TOOL_REQUEST_START,
    'maid:「始」[Nova]Nova「末」,',
    'tool_name:「始」DailyNote「末」,',
    'command:「始」update「末」,',
    'target:「始」日记中需被替换的旧内容，至少15字符以确保精准匹配「末」,',
    'replace:「始」替换后写入的新内容「末」,',
    'archery:「始」no_reply「末」',
    TOOL_REQUEST_END,
    '',
    '一次调用只改一处匹配。target 至少 15 字符。maid 同样使用 `[索引名]署名` 格式。',
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

function resolvePreferredDailyNoteMaid(options = {}) {
    const agentConfig = options.agentConfig && typeof options.agentConfig === 'object'
        ? options.agentConfig
        : {};
    const context = options.context && typeof options.context === 'object'
        ? options.context
        : {};
    const configuredMaid = sanitizeText(agentConfig.vcpMaid || context.vcpMaid);
    if (configuredMaid) {
        return configuredMaid;
    }

    const preferredAlias = sanitizeText(
        Array.isArray(agentConfig.vcpAliases) ? agentConfig.vcpAliases[0] : '',
        sanitizeText(context.agentName || agentConfig.name || context.agentId, 'UniStudy')
    );
    return `[${preferredAlias}]${preferredAlias}`;
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

    const normalizedToolName = sanitizeText(requestedToolName);
    if (normalizedToolName === 'DailyNoteWrite' || normalizedToolName === 'StudyLog') {
        return 'create';
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
        maid: read('maid', 'maidName'),
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
        protocol: 'vcp-tool',
        requestedToolName,
        toolName,
        requestedCommand: command || '',
        command: normalizedCommand,
        compatibilityMode: requestedToolName === 'StudyLog'
            ? 'study-log-write'
            : requestedToolName === 'DailyNoteWrite'
                ? 'daily-note-write'
                : '',
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

    LEGACY_DAILY_NOTE_REGEX.lastIndex = 0;
    while ((match = LEGACY_DAILY_NOTE_REGEX.exec(cleanContent)) !== null) {
        const block = sanitizeText(match[1]);
        if (!block) {
            continue;
        }

        const maid = block.match(/^\s*Maid:\s*(.+?)$/mi)?.[1]?.trim() || '';
        const dateString = block.match(/^\s*Date:\s*(.+?)$/mi)?.[1]?.trim() || '';
        const fileName = block.match(/^\s*FileName:\s*(.+?)$/mi)?.[1]?.trim() || '';
        const tagLine = block.match(/^\s*Tag:\s*(.+?)$/mi)?.[1]?.trim() || '';
        const contentMatch = block.match(/^\s*Content:\s*([\s\S]*?)$/mi);
        const contentText = contentMatch ? sanitizeText(contentMatch[1]) : '';

        if (!contentText) {
            continue;
        }

        toolRequests.push({
            protocol: 'legacy-daily-note',
            requestedToolName: 'DailyNote',
            toolName: 'DailyNote',
            requestedCommand: 'create',
            command: 'create',
            compatibilityMode: 'legacy-daily-note',
            args: {
                maid,
                Date: dateString,
                Content: contentText,
                Tag: tagLine,
                fileName,
                archery: '',
            },
            rawArgs: {},
            rawBlock: block,
        });
    }

    return toolRequests;
}

function stripToolArtifacts(content = '') {
    return String(content || '')
        .replace(THINK_BLOCK_REGEX, '')
        .replace(TOOL_BLOCK_REGEX, '')
        .replace(LEGACY_DAILY_NOTE_REGEX, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function rewriteLegacyStudyLogPromptText(content = '') {
    return String(content || '')
        .replace(
            /默认使用\s*StudyLog\.write\s*[；;]?\s*兼容\s*DailyNote\.create\s*\/\s*DailyNote\.update\s*文本块/gi,
            '默认使用 DailyNote.create / DailyNote.update 文本块'
        )
        .replace(/\bStudyLog\.write\b/g, 'DailyNote.create');
}

function buildToolPayloadMessage(results = []) {
    const lines = [TOOL_PAYLOAD_MARKER, 'Local DailyNote execution summary:'];

    results.forEach((result, index) => {
        lines.push(
            '',
            `[${index + 1}] ${result?.toolName || 'DailyNote'}.${result?.command || 'create'}`,
            `status: ${result?.success ? 'success' : 'error'}`,
            `entryId: ${result?.entryId || ''}`,
            `diaryId: ${result?.diaryDayId || ''}`,
            `dateKey: ${result?.dateKey || ''}`,
            `maid: ${result?.maidRaw || ''}`,
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

function resolveDailyNoteToolInstruction(customGuide = '', options = {}) {
    const preferredMaid = resolvePreferredDailyNoteMaid(options);
    const baseInstruction = sanitizeText(customGuide, DEFAULT_DAILY_NOTE_TOOL_INSTRUCTION);
    const normalizedInstruction = baseInstruction
        .replace(/maid:「始」\[Nova\]Nova「末」,/g, `maid:「始」${preferredMaid}「末」,`);
    const preferredMaidLine = `本轮默认优先写入：${preferredMaid}。若无特别说明，不要改用 [默认] 或省略 []。`;

    if (normalizedInstruction.includes(preferredMaidLine)) {
        return normalizedInstruction;
    }

    return `${normalizedInstruction}\n\n${preferredMaidLine}`.trim();
}

function buildDailyNoteToolInstruction(customGuide = '', options = {}) {
    return resolveDailyNoteToolInstruction(customGuide, options);
}

function buildStudyLogToolInstruction(customGuide = '', options = {}) {
    return resolveDailyNoteToolInstruction(customGuide, options);
}

module.exports = {
    DEFAULT_DAILY_NOTE_TOOL_INSTRUCTION,
    LEGACY_DAILY_NOTE_REGEX,
    THINK_BLOCK_REGEX,
    TOOL_BLOCK_REGEX,
    TOOL_PAYLOAD_MARKER,
    TOOL_REQUEST_END,
    TOOL_REQUEST_START,
    buildDailyNoteToolInstruction,
    buildStudyLogToolInstruction,
    buildToolPayloadMessage,
    extractResponseContent,
    injectResponseContent,
    normalizeToolCommand,
    normalizeToolName,
    parseToolRequests,
    resolvePreferredDailyNoteMaid,
    resolveDailyNoteToolInstruction,
    rewriteLegacyStudyLogPromptText,
    stripToolArtifacts,
    toArray,
};

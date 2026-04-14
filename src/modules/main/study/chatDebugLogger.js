const TOOL_REQUEST_START = '<<<[TOOL_REQUEST]>>>';
const TOOL_REQUEST_END = '<<<[END_TOOL_REQUEST]>>>';

function sanitizeText(value, fallback = '') {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return fallback;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch (_error) {
        return String(value);
    }
}

function summarizeDataUrl(url = '') {
    const text = String(url || '');
    if (!text.startsWith('data:')) {
        return text;
    }

    const commaIndex = text.indexOf(',');
    if (commaIndex === -1) {
        return `${text.slice(0, 64)}...`;
    }

    const header = text.slice(0, commaIndex);
    const body = text.slice(commaIndex + 1);
    return `${header},<base64 len=${body.length}>`;
}

function formatContentPart(part = {}, index = 0) {
    const type = typeof part?.type === 'string' ? part.type : 'unknown';
    if (type === 'text') {
        return [
            `  [part ${index + 1}] text`,
            sanitizeText(part.text, '(empty text part)'),
        ].join('\n');
    }

    if (type === 'image_url') {
        const imageUrl = typeof part?.image_url?.url === 'string'
            ? part.image_url.url
            : '';
        return `  [part ${index + 1}] image_url ${summarizeDataUrl(imageUrl)}`;
    }

    return [
        `  [part ${index + 1}] ${type}`,
        sanitizeText(part, '(empty part)'),
    ].join('\n');
}

function formatMessageContent(content) {
    if (typeof content === 'string') {
        return content || '(empty)';
    }

    if (Array.isArray(content)) {
        if (content.length === 0) {
            return '(empty parts)';
        }
        return content.map((part, index) => formatContentPart(part, index)).join('\n');
    }

    if (content === undefined || content === null) {
        return '(empty)';
    }

    return sanitizeText(content, '(empty)');
}

function formatMessage(message = {}, index = 0) {
    const header = [`[${index + 1}] ${message?.role || 'unknown'}`];
    if (message?.name) {
        header.push(`name=${message.name}`);
    }
    if (message?.tool_call_id) {
        header.push(`tool_call_id=${message.tool_call_id}`);
    }

    return [
        header.join(' '),
        formatMessageContent(message?.content),
    ].join('\n');
}

function formatMessages(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return '(no messages)';
    }

    return messages.map((message, index) => formatMessage(message, index)).join('\n\n');
}

function formatToolRequest(toolRequest = {}, index = 0) {
    const args = toolRequest?.args || {};
    const lines = [
        `[${index + 1}] ${toolRequest?.toolName || 'UnknownTool'}.${toolRequest?.command || 'unknown'}`,
        `requested: ${(toolRequest?.requestedToolName || '').trim() || '(none)'}.${(toolRequest?.requestedCommand || '').trim() || '(none)'}`,
        `maid: ${args.maid || '(none)'}`,
        `date: ${args.Date || '(none)'}`,
        `target: ${args.target || '(none)'}`,
        `replace: ${args.replace || '(none)'}`,
        `tag: ${args.Tag || '(none)'}`,
        `archery: ${args.archery || '(none)'}`,
    ];

    const rawBlock = sanitizeText(toolRequest?.rawBlock, '');
    if (rawBlock) {
        lines.push('raw block:');
        lines.push(TOOL_REQUEST_START);
        lines.push(rawBlock);
        lines.push(TOOL_REQUEST_END);
    }

    return lines.join('\n');
}

function formatToolRequests(toolRequests = []) {
    if (!Array.isArray(toolRequests) || toolRequests.length === 0) {
        return '(no parsed tool requests)';
    }

    return toolRequests.map((toolRequest, index) => formatToolRequest(toolRequest, index)).join('\n\n');
}

function formatToolResult(result = {}, index = 0) {
    return [
        `[${index + 1}] ${result?.success ? 'success' : 'error'} ${result?.toolName || 'UnknownTool'}.${result?.command || 'unknown'}`,
        `entryId: ${result?.entryId || '(none)'}`,
        `dateKey: ${result?.dateKey || '(none)'}`,
        `notebook: ${result?.notebookName || '(none)'}`,
        `maid: ${result?.maidRaw || '(none)'}`,
        `message: ${result?.message || '(none)'}`,
    ].join('\n');
}

function formatToolResults(results = []) {
    if (!Array.isArray(results) || results.length === 0) {
        return '(no tool execution results)';
    }

    return results.map((result, index) => formatToolResult(result, index)).join('\n\n');
}

function logSection(title, lines = []) {
    const body = Array.isArray(lines)
        ? lines.filter((line) => line !== undefined && line !== null && line !== '').join('\n')
        : String(lines || '');
    console.log([
        `[ChatDebug] ===== ${title} =====`,
        body || '(empty)',
        `[ChatDebug] ===== end ${title} =====`,
    ].join('\n'));
}

function logOutboundRequest(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    const round = Number.isFinite(Number(payload.round)) ? Number(payload.round) : 1;
    logSection(`Outbound request ${requestId} round ${round}`, [
        `endpoint: ${payload.endpoint || '(none)'}`,
        `model: ${payload.model || '(none)'}`,
        `agentId: ${payload.context?.agentId || '(none)'}`,
        `agentName: ${payload.context?.agentName || '(none)'}`,
        `topicId: ${payload.context?.topicId || '(none)'}`,
        `topicName: ${payload.context?.topicName || '(none)'}`,
        `messageCount: ${Array.isArray(payload.messages) ? payload.messages.length : 0}`,
        '',
        formatMessages(payload.messages),
    ]);
}

function logUpstreamRawReply(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    const round = Number.isFinite(Number(payload.round)) ? Number(payload.round) : 1;
    logSection(`Upstream raw reply ${requestId} round ${round}`, [
        sanitizeText(payload.content, '(empty reply)'),
    ]);
}

function logParsedToolRequests(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    const round = Number.isFinite(Number(payload.round)) ? Number(payload.round) : 1;
    logSection(`Parsed tool requests ${requestId} round ${round}`, [
        `count: ${Array.isArray(payload.toolRequests) ? payload.toolRequests.length : 0}`,
        '',
        formatToolRequests(payload.toolRequests),
    ]);
}

function logToolExecutionResults(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    const round = Number.isFinite(Number(payload.round)) ? Number(payload.round) : 1;
    logSection(`Tool execution results ${requestId} round ${round}`, [
        formatToolResults(payload.results),
    ]);
}

function logVisibleAssistantReply(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    const round = Number.isFinite(Number(payload.round)) ? Number(payload.round) : 1;
    logSection(`Visible assistant reply ${requestId} round ${round}`, [
        sanitizeText(payload.content, '(empty visible reply)'),
    ]);
}

function logFinalAssistantReply(payload = {}) {
    const requestId = payload.requestId || 'unknown';
    logSection(`Final assistant reply ${requestId}`, [
        sanitizeText(payload.content, '(empty final reply)'),
    ]);
}

module.exports = {
    logFinalAssistantReply,
    logOutboundRequest,
    logParsedToolRequests,
    logToolExecutionResults,
    logUpstreamRawReply,
    logVisibleAssistantReply,
};

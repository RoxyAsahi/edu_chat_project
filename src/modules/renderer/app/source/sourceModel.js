const TOPIC_SOURCE_FILE_LIMIT = 50;

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildTopicSourceName({ topic = null, agentName = '' } = {}) {
    const topicLabel = String(topic?.name || topic?.id || '未命名话题').trim();
    const agentLabel = String(agentName || '当前学科').trim();
    return `${agentLabel} · ${topicLabel}`;
}

function formatDocumentStatus(documentItem = {}) {
    const statusLabels = {
        pending: '排队中',
        processing: '处理中',
        paused: '已暂停',
        done: '已完成',
        failed: '失败',
    };
    const contentTypeLabels = {
        plain: 'plain',
        markdown: 'markdown',
        html: 'html',
        'pdf-text': 'pdf-text',
        'docx-text': 'docx-text',
    };

    const detailParts = [`${statusLabels[documentItem.status] || documentItem.status}`];
    detailParts.push(`${documentItem.chunkCount || 0} chunks`);

    if (documentItem.contentType) {
        detailParts.push(contentTypeLabels[documentItem.contentType] || documentItem.contentType);
    }

    if (documentItem.attemptCount) {
        detailParts.push(`尝试 ${documentItem.attemptCount}`);
    }

    return detailParts.join(' · ');
}

function getKnowledgeBaseDocumentVisual(documentItem = {}) {
    const name = String(documentItem.name || '').toLowerCase();
    const contentType = String(documentItem.contentType || '').toLowerCase();
    const mimeType = String(documentItem.mimeType || '').toLowerCase();
    const status = String(documentItem.status || '').toLowerCase();

    if (status === 'pending' || status === 'processing') {
        return { icon: 'progress_activity', tone: 'loading', spinning: true };
    }

    if (contentType === 'pdf-text' || mimeType === 'application/pdf' || name.endsWith('.pdf')) {
        return { icon: 'picture_as_pdf', tone: 'pdf', spinning: false };
    }

    if (
        contentType === 'docx-text'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || name.endsWith('.docx')
        || name.endsWith('.doc')
    ) {
        return { icon: 'description', tone: 'doc', spinning: false };
    }

    if (contentType === 'markdown' || name.endsWith('.md')) {
        return { icon: 'article', tone: 'text', spinning: false };
    }

    if (
        contentType === 'plain'
        || contentType === 'html'
        || mimeType.startsWith('text/')
        || name.endsWith('.txt')
        || name.endsWith('.html')
        || name.endsWith('.htm')
    ) {
        return { icon: 'article', tone: 'text', spinning: false };
    }

    if (mimeType.startsWith('image/')) {
        return { icon: 'image', tone: 'text', spinning: false };
    }

    return { icon: 'draft', tone: 'neutral', spinning: false };
}

function canReuseSelectedKnowledgeBaseDocuments({
    topicKnowledgeBaseId = null,
    selectedKnowledgeBaseId = null,
    reuseSelected = true,
} = {}) {
    return reuseSelected !== false
        && Boolean(topicKnowledgeBaseId)
        && topicKnowledgeBaseId === selectedKnowledgeBaseId;
}

function shouldPollKnowledgeBaseItems({
    knowledgeBaseDocuments = [],
    topicKnowledgeBaseDocuments = [],
} = {}) {
    return [...knowledgeBaseDocuments, ...topicKnowledgeBaseDocuments]
        .some((item) => (
            item.status === 'pending'
            || item.status === 'processing'
            || item.guideStatus === 'pending'
            || item.guideStatus === 'processing'
        ));
}

export {
    TOPIC_SOURCE_FILE_LIMIT,
    buildTopicSourceName,
    canReuseSelectedKnowledgeBaseDocuments,
    escapeHtml,
    formatDocumentStatus,
    getKnowledgeBaseDocumentVisual,
    shouldPollKnowledgeBaseItems,
};

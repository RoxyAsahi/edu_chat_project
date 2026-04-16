function normalizeStoredAttachment(rawAttachment) {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
        return null;
    }

    const src = rawAttachment.src || rawAttachment.internalPath || '';
    const internalPath = rawAttachment.internalPath || (src.startsWith('file://') ? src : '');

    return {
        ...rawAttachment,
        name: rawAttachment.name || rawAttachment.originalName || 'Attachment',
        type: rawAttachment.type || 'application/octet-stream',
        src,
        internalPath,
        extractedText: rawAttachment.extractedText ?? null,
        imageFrames: Array.isArray(rawAttachment.imageFrames) ? rawAttachment.imageFrames : null,
    };
}

function normalizeAttachmentList(attachments) {
    return Array.isArray(attachments)
        ? attachments.map(normalizeStoredAttachment).filter(Boolean)
        : [];
}

function normalizeFollowUpList(followUps) {
    return Array.isArray(followUps)
        ? [...new Set(
            followUps
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        )].slice(0, 3)
        : [];
}

function normalizeHistory(history) {
    return Array.isArray(history)
        ? history.map((message) => ({
            ...message,
            attachments: normalizeAttachmentList(message.attachments),
            favorited: message.favorited === true,
            favoriteAt: message.favoriteAt || null,
            noteRefs: Array.isArray(message.noteRefs) ? message.noteRefs : [],
            selectionContextRefs: Array.isArray(message.selectionContextRefs) ? message.selectionContextRefs : [],
            toolEvents: Array.isArray(message.toolEvents) ? message.toolEvents : [],
            studyMemoryRefs: Array.isArray(message.studyMemoryRefs) ? message.studyMemoryRefs : [],
            followUps: normalizeFollowUpList(message.followUps),
        }))
        : [];
}

function inferExtensionFromType(type = '') {
    if (!type.includes('/')) {
        return 'bin';
    }

    const subtype = type.split('/')[1] || 'bin';
    if (subtype === 'jpeg') {
        return 'jpg';
    }

    return subtype.replace(/[^a-z0-9]/gi, '') || 'bin';
}

function buildAttachmentTransferPayload({
    fileName = '',
    fileType = '',
    nativePath = '',
    buffer = null,
    index = 0,
    now = Date.now(),
} = {}) {
    const resolvedType = fileType || 'application/octet-stream';
    const resolvedName = fileName || `attachment_${now}_${index}.${inferExtensionFromType(resolvedType)}`;

    if (nativePath) {
        return {
            name: resolvedName,
            path: nativePath,
            type: resolvedType,
        };
    }

    const resolvedBuffer = buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer || []);

    return {
        name: resolvedName,
        data: resolvedBuffer,
        type: resolvedType,
    };
}

function buildKnowledgeBaseQuery(message) {
    const segments = [];
    if (message?.content?.trim()) {
        segments.push(message.content.trim());
    }

    for (const attachment of normalizeAttachmentList(message?.attachments)) {
        if (attachment?.extractedText) {
            segments.push(`Attachment: ${attachment.name}\n${String(attachment.extractedText).slice(0, 1200)}`);
        }
    }

    return segments.join('\n\n').trim();
}

function buildSelectionContextTemporaryMessages(
    selectionContextRefs = [],
    getLocatorLabel = () => '未定位',
) {
    if (!Array.isArray(selectionContextRefs) || selectionContextRefs.length === 0) {
        return [];
    }

    const lines = selectionContextRefs.map((ref, index) => {
        const location = getLocatorLabel(ref);
        return `[${index + 1}] ${ref.documentName || ref.documentId} | ${location}\n${ref.selectionText || ref.snippet || ''}`;
    });

    return [{
        role: 'system',
        content: [
            'Selected document excerpts for this turn:',
            ...lines,
            'Use these excerpts when they are relevant to the current user request.',
        ].join('\n\n'),
    }];
}

function resolveComposerAvailabilityState({
    hasAgentId = false,
    hasTopicId = false,
    activeRequestId = null,
} = {}) {
    const hasTopic = Boolean(hasAgentId && hasTopicId);
    const interrupting = Boolean(activeRequestId);

    return {
        hasTopic,
        interrupting,
        disableInput: !hasTopic,
        disableAttachments: !hasTopic,
        disableEmoticons: !hasTopic,
        disableQuickNewTopic: !hasTopic,
        disableSend: !hasTopic && !interrupting,
        shouldClearDragOver: !hasTopic,
    };
}

function resolveComposerSendAction({
    hasAgentId = false,
    hasTopicId = false,
    activeRequestId = null,
    text = '',
    pendingAttachmentCount = 0,
} = {}) {
    if (activeRequestId) {
        return { kind: 'interrupt' };
    }

    if (!hasAgentId || !hasTopicId) {
        return { kind: 'blocked', reason: 'missing-topic' };
    }

    if (!String(text || '').trim() && Number(pendingAttachmentCount || 0) <= 0) {
        return { kind: 'noop', reason: 'empty' };
    }

    return { kind: 'send' };
}

export {
    buildAttachmentTransferPayload,
    buildKnowledgeBaseQuery,
    buildSelectionContextTemporaryMessages,
    inferExtensionFromType,
    normalizeAttachmentList,
    normalizeFollowUpList,
    normalizeHistory,
    normalizeStoredAttachment,
    resolveComposerAvailabilityState,
    resolveComposerSendAction,
};

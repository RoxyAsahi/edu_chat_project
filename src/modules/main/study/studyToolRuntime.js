const {
    normalizeNotebookId,
    normalizeTagList,
} = require('./studyLogStore');

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function resolveDateKey(value, fallbackDateKey) {
    const normalized = sanitizeText(value, fallbackDateKey).replace(/[./\\\s]/g, '-');
    return normalized;
}

function isValidDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function hasTimePrefix(value = '') {
    return /^\[\d{2}:\d{2}\]/.test(String(value || '').trim());
}

function buildDefaultSubject(runtimeContext = {}) {
    const signature = sanitizeText(runtimeContext.agentName || runtimeContext.agentId, 'UniStudy');
    return `[${signature}]${signature}`;
}

function parseSubject(value = '', runtimeContext = {}) {
    const raw = sanitizeText(value, buildDefaultSubject(runtimeContext));
    const bracketMatch = raw.match(/^\[([^\]]+)\](.+)$/);
    if (bracketMatch) {
        const notebookName = sanitizeText(bracketMatch[1], sanitizeText(runtimeContext.agentName, '默认'));
        const subjectSignature = sanitizeText(bracketMatch[2], sanitizeText(runtimeContext.agentName, notebookName));
        return {
            subjectRaw: raw,
            notebookName,
            notebookId: normalizeNotebookId(notebookName, 'default'),
            subjectSignature,
            isPublicNotebook: notebookName === '公共',
        };
    }

    const fallbackNotebookName = sanitizeText(runtimeContext.agentName || runtimeContext.agentId, '默认');
    return {
        subjectRaw: raw,
        notebookName: raw.startsWith('[') && raw.endsWith(']')
            ? raw.slice(1, -1).trim() || fallbackNotebookName
            : fallbackNotebookName,
        notebookId: normalizeNotebookId(raw.startsWith('[') && raw.endsWith(']')
            ? raw.slice(1, -1).trim()
            : fallbackNotebookName, 'default'),
        subjectSignature: raw,
        isPublicNotebook: raw === '[公共]' || raw === '公共',
    };
}

function splitContentAndTags(content = '', explicitTagValue = '') {
    const trimmed = String(content || '').trim();
    const tagMatch = trimmed.match(/(?:^|\n)Tag:\s*(.+)$/i);
    const contentWithoutTag = tagMatch
        ? trimmed.replace(/(?:^|\n)Tag:\s*(.+)$/i, '').trim()
        : trimmed;
    const tagSource = sanitizeText(explicitTagValue) || (tagMatch ? sanitizeText(tagMatch[1]) : '');
    const tags = normalizeTagList(tagSource);
    const contentMarkdown = tags.length > 0
        ? `${contentWithoutTag}\nTag: ${tags.join(', ')}`
        : contentWithoutTag;

    return {
        contentMarkdown,
        tags,
    };
}

function buildStoredToolRequest(toolRequest = {}, args = {}, subjectInfo = {}) {
    const subject = subjectInfo.subjectRaw || sanitizeText(args.subject);
    return {
        toolName: 'DailyNote',
        command: sanitizeText(toolRequest.command, 'create'),
        args: {
            subject,
            command: sanitizeText(toolRequest.command, 'create'),
            Date: sanitizeText(args.Date),
            Content: sanitizeText(args.Content),
            Tag: sanitizeText(args.Tag),
            target: sanitizeText(args.target),
            replace: sanitizeText(args.replace),
            archery: sanitizeText(args.archery),
        },
    };
}

function createStudyToolRuntime(options = {}) {
    const studyLogStore = options.studyLogStore;
    const diaryProjector = options.diaryProjector;

    async function executeCreate(toolRequest = {}, runtimeContext = {}) {
        const args = toolRequest.args || {};
        const compatibilityMode = sanitizeText(toolRequest.compatibilityMode);
        const subjectInfo = parseSubject(args.subject, runtimeContext);
        const dateKey = resolveDateKey(args.Date, runtimeContext.dateKey);
        const contentValue = sanitizeText(args.Content);

        if (!contentValue) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'create',
                message: 'DailyNote.create requires Content.',
            };
        }
        if (!dateKey || !isValidDateKey(dateKey)) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'create',
                message: 'DailyNote.create requires Date in YYYY-MM-DD format.',
            };
        }
        if (!compatibilityMode && !hasTimePrefix(contentValue)) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'create',
                message: 'DailyNote.create requires Content to start with [HH:MM].',
            };
        }

        const contentParts = splitContentAndTags(contentValue, args.Tag);
        const storedToolRequest = buildStoredToolRequest(toolRequest, args, subjectInfo);
        const entry = await studyLogStore.writeEntry({
            agentId: runtimeContext.agentId,
            agentNameSnapshot: runtimeContext.agentName,
            topicId: runtimeContext.topicId,
            topicNameSnapshot: runtimeContext.topicName,
            dateKey,
            studentNameSnapshot: runtimeContext.studentName,
            workspaceSnapshot: runtimeContext.studyWorkspace,
            environmentSnapshot: runtimeContext.workEnvironment,
            sourceMessageIds: runtimeContext.sourceMessageIds,
            toolRequest: storedToolRequest,
            contentMarkdown: contentParts.contentMarkdown,
            tags: contentParts.tags,
            status: 'written',
            notebookId: subjectInfo.notebookId,
            notebookName: subjectInfo.notebookName,
            subjectRaw: subjectInfo.subjectRaw,
            subjectSignature: subjectInfo.subjectSignature,
            requestedToolName: 'DailyNote',
            requestedCommand: 'create',
            archery: sanitizeText(args.archery),
            modelSnapshot: sanitizeText(runtimeContext.model),
        });
        const diaryDay = await diaryProjector.projectEntry(entry);

        return {
            success: true,
            toolName: 'DailyNote',
            command: 'create',
            entryId: entry.id,
            dateKey,
            tags: entry.tags,
            entry,
            diaryDayId: diaryDay?.id || '',
            message: `DailyNote.create saved to [${subjectInfo.notebookName}] for ${dateKey}.`,
            notebookId: subjectInfo.notebookId,
            notebookName: subjectInfo.notebookName,
            subjectRaw: subjectInfo.subjectRaw,
            subjectSignature: subjectInfo.subjectSignature,
        };
    }

    async function executeUpdate(toolRequest = {}, runtimeContext = {}) {
        const args = toolRequest.args || {};
        const subjectInfo = parseSubject(args.subject, runtimeContext);
        const target = sanitizeText(args.target);
        const replace = sanitizeText(args.replace);
        const dateKey = sanitizeText(args.Date);

        if (target.length < 15) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'update',
                message: 'DailyNote.update requires target with at least 15 characters.',
            };
        }
        if (!replace) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'update',
                message: 'DailyNote.update requires replace.',
            };
        }

        const scopedEntries = await studyLogStore.listEntries({
            agentId: runtimeContext.agentId,
            topicId: runtimeContext.topicId,
            notebookId: subjectInfo.notebookId,
            dateKey,
            limit: 5000,
        });
        const fallbackEntries = scopedEntries.length > 0
            ? []
            : await studyLogStore.listEntries({
                agentId: runtimeContext.agentId,
                notebookId: subjectInfo.notebookId,
                dateKey,
                limit: 5000,
            });
        const candidates = [...scopedEntries, ...fallbackEntries];
        const matchedEntry = candidates.find((entry) => String(entry.contentMarkdown || '').includes(target));

        if (!matchedEntry) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'update',
                message: `DailyNote.update could not find the target text in notebook [${subjectInfo.notebookName}].`,
                notebookId: subjectInfo.notebookId,
                notebookName: subjectInfo.notebookName,
                subjectRaw: subjectInfo.subjectRaw,
                subjectSignature: subjectInfo.subjectSignature,
            };
        }

        const nextContent = String(matchedEntry.contentMarkdown || '').replace(target, replace);
        const nextContentParts = splitContentAndTags(nextContent, args.Tag);
        const storedToolRequest = buildStoredToolRequest(toolRequest, {
            ...args,
            Date: matchedEntry.dateKey,
            Content: nextContentParts.contentMarkdown,
        }, subjectInfo);
        const updatedEntry = await studyLogStore.updateEntry({
            agentId: matchedEntry.agentId,
            topicId: matchedEntry.topicId,
            entryId: matchedEntry.id,
            updater(current) {
                return {
                    ...current,
                    contentMarkdown: nextContentParts.contentMarkdown,
                    tags: nextContentParts.tags,
                    toolRequest: storedToolRequest,
                    requestedToolName: 'DailyNote',
                    requestedCommand: 'update',
                    archery: sanitizeText(args.archery),
                };
            },
        });
        const diaryDay = updatedEntry
            ? await diaryProjector.rebuildDiaryDay({
                notebookId: updatedEntry.notebookId,
                notebookName: updatedEntry.notebookName,
                dateKey: updatedEntry.dateKey,
            })
            : null;

        if (!updatedEntry) {
            return {
                success: false,
                toolName: 'DailyNote',
                command: 'update',
                message: 'DailyNote.update failed to persist the updated entry.',
            };
        }

        return {
            success: true,
            toolName: 'DailyNote',
            command: 'update',
            entryId: updatedEntry.id,
            dateKey: updatedEntry.dateKey,
            tags: updatedEntry.tags,
            entry: updatedEntry,
            diaryDayId: diaryDay?.id || '',
            message: `DailyNote.update updated entry ${updatedEntry.id} in [${subjectInfo.notebookName}].`,
            notebookId: subjectInfo.notebookId,
            notebookName: subjectInfo.notebookName,
            subjectRaw: subjectInfo.subjectRaw,
            subjectSignature: subjectInfo.subjectSignature,
        };
    }

    async function executeToolRequest(toolRequest = {}, runtimeContext = {}) {
        const toolName = sanitizeText(toolRequest.toolName, 'DailyNote');
        const command = sanitizeText(toolRequest.command, 'create');

        if (toolName !== 'DailyNote') {
            return {
                success: false,
                toolName,
                command,
                message: `Unsupported tool request: ${toolName}.${command}`,
            };
        }

        if (command === 'create') {
            return executeCreate(toolRequest, runtimeContext);
        }

        if (command === 'update') {
            return executeUpdate(toolRequest, runtimeContext);
        }

        return {
            success: false,
            toolName,
            command,
            message: `Unsupported tool request: ${toolName}.${command}`,
        };
    }

    return {
        executeToolRequest,
    };
}

module.exports = {
    createStudyToolRuntime,
};

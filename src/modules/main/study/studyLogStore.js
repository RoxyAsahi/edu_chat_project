const fs = require('fs-extra');
const path = require('path');

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function sanitizeIdentifier(value, fallback = 'default') {
    const normalized = sanitizeText(value, fallback)
        .replace(/[^\p{L}\p{N}_-]+/gu, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function normalizeTagList(tags) {
    if (Array.isArray(tags)) {
        return tags
            .map((tag) => sanitizeText(tag))
            .filter(Boolean);
    }

    return String(tags || '')
        .split(/[,\n|]/)
        .map((tag) => sanitizeText(tag))
        .filter(Boolean);
}

function normalizeArray(values) {
    return Array.isArray(values)
        ? values.filter(Boolean).map((value) => String(value))
        : [];
}

function normalizeNotebookName(value, fallback = '默认') {
    return sanitizeText(value, fallback);
}

function normalizeNotebookId(value, fallback = 'default') {
    return sanitizeIdentifier(value, fallback);
}

function createStudyLogStore(options = {}) {
    const dataRoot = options.dataRoot;
    const logsRoot = path.join(dataRoot, 'StudyLogs');

    function getTopicEntriesFile(agentId, topicId) {
        return path.join(logsRoot, agentId, topicId, 'entries.json');
    }

    async function listAgentIds() {
        const items = await fs.readdir(logsRoot).catch(() => []);
        return items.filter(Boolean);
    }

    async function listTopicIds(agentId) {
        if (!agentId) {
            return [];
        }

        const items = await fs.readdir(path.join(logsRoot, agentId)).catch(() => []);
        return items.filter(Boolean);
    }

    async function readTopicEntries(agentId, topicId) {
        if (!agentId || !topicId) {
            return [];
        }

        const filePath = getTopicEntriesFile(agentId, topicId);
        if (!await fs.pathExists(filePath)) {
            return [];
        }

        const payload = await fs.readJson(filePath).catch(() => []);
        return Array.isArray(payload) ? payload : [];
    }

    async function writeTopicEntries(agentId, topicId, entries) {
        const filePath = getTopicEntriesFile(agentId, topicId);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeJson(filePath, entries, { spaces: 2 });
    }

    function normalizeEntry(entryInput = {}) {
        const agentId = sanitizeText(entryInput.agentId);
        const topicId = sanitizeText(entryInput.topicId, 'default');
        const createdAt = Number(entryInput.createdAt || Date.now());
        const notebookName = normalizeNotebookName(
            entryInput.notebookName || entryInput.notebookId || '默认',
            '默认'
        );
        const notebookId = normalizeNotebookId(entryInput.notebookId || notebookName, 'default');

        return {
            id: sanitizeText(entryInput.id, makeId('study_log')),
            agentId,
            agentNameSnapshot: sanitizeText(entryInput.agentNameSnapshot),
            topicId,
            topicNameSnapshot: sanitizeText(entryInput.topicNameSnapshot),
            createdAt,
            updatedAt: Number(entryInput.updatedAt || createdAt),
            dateKey: sanitizeText(entryInput.dateKey),
            studentNameSnapshot: sanitizeText(entryInput.studentNameSnapshot),
            workspaceSnapshot: sanitizeText(entryInput.workspaceSnapshot),
            environmentSnapshot: sanitizeText(entryInput.environmentSnapshot),
            sourceMessageIds: normalizeArray(entryInput.sourceMessageIds),
            toolRequest: entryInput.toolRequest && typeof entryInput.toolRequest === 'object'
                ? entryInput.toolRequest
                : {},
            contentMarkdown: sanitizeText(entryInput.contentMarkdown),
            tags: normalizeTagList(entryInput.tags),
            status: sanitizeText(entryInput.status, 'written'),
            recallCount: Number(entryInput.recallCount || 0),
            lastRecalledAt: Number(entryInput.lastRecalledAt || 0),
            filePath: sanitizeText(entryInput.filePath),
            topicTag: sanitizeText(entryInput.topicTag),
            agentTag: sanitizeText(entryInput.agentTag),
            modelSnapshot: sanitizeText(entryInput.modelSnapshot),
            notebookId,
            notebookName,
            diaryId: sanitizeText(entryInput.diaryId, `study_diary_${notebookId}_${sanitizeText(entryInput.dateKey)}`),
            maidRaw: sanitizeText(entryInput.maidRaw),
            maidSignature: sanitizeText(entryInput.maidSignature),
            requestedToolName: sanitizeText(entryInput.requestedToolName, 'DailyNote'),
            requestedCommand: sanitizeText(entryInput.requestedCommand, 'create'),
            archery: sanitizeText(entryInput.archery),
            isPublicNotebook: notebookName === '公共',
        };
    }

    function buildEntrySearchText(entry = {}) {
        return [
            entry.contentMarkdown,
            entry.topicNameSnapshot,
            entry.studentNameSnapshot,
            entry.agentNameSnapshot,
            entry.notebookName,
            entry.maidRaw,
            entry.maidSignature,
            (entry.tags || []).join(' '),
        ].join('\n').toLowerCase();
    }

    function entryMatchesFilters(entry = {}, options = {}) {
        const query = sanitizeText(options.query).toLowerCase();
        const dateKey = sanitizeText(options.dateKey);
        const notebookId = sanitizeText(options.notebookId);
        const notebookName = sanitizeText(options.notebookName);
        const tag = sanitizeText(options.tag).toLowerCase();

        if (dateKey && entry.dateKey !== dateKey) {
            return false;
        }

        if (notebookId && sanitizeText(entry.notebookId) !== notebookId) {
            return false;
        }

        if (notebookName && sanitizeText(entry.notebookName) !== notebookName) {
            return false;
        }

        if (tag) {
            const hasTag = Array.isArray(entry.tags)
                && entry.tags.some((value) => String(value || '').toLowerCase().includes(tag));
            if (!hasTag) {
                return false;
            }
        }

        if (!query) {
            return true;
        }

        return buildEntrySearchText(entry).includes(query);
    }

    async function listEntries(options = {}) {
        const agentId = sanitizeText(options.agentId);
        const topicId = sanitizeText(options.topicId);
        const limit = Math.max(1, Number(options.limit || 200));

        const agentIds = agentId
            ? [agentId]
            : await listAgentIds();

        const allEntries = [];
        for (const currentAgentId of agentIds) {
            const topicIds = topicId
                ? [topicId]
                : await listTopicIds(currentAgentId);

            for (const currentTopicId of topicIds) {
                const entries = await readTopicEntries(currentAgentId, currentTopicId);
                allEntries.push(...entries.map((entry) => normalizeEntry(entry)));
            }
        }

        return allEntries
            .filter((entry) => entryMatchesFilters(entry, options))
            .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
            .slice(0, limit);
    }

    async function getEntry(options = {}) {
        const agentId = sanitizeText(options.agentId);
        const topicId = sanitizeText(options.topicId);
        const entryId = sanitizeText(options.entryId);
        if (!entryId) {
            return null;
        }

        if (agentId && topicId) {
            const entries = await readTopicEntries(agentId, topicId);
            const found = entries.find((entry) => entry.id === entryId);
            return found ? normalizeEntry(found) : null;
        }

        const entries = await listEntries({
            agentId,
            topicId,
            limit: Number(options.limit || 5000),
        });
        return entries.find((entry) => entry.id === entryId) || null;
    }

    async function writeEntry(entryInput = {}) {
        const entry = normalizeEntry(entryInput);
        const entries = await readTopicEntries(entry.agentId, entry.topicId);
        entries.unshift(entry);
        await writeTopicEntries(entry.agentId, entry.topicId, entries);
        return entry;
    }

    async function updateEntry(options = {}) {
        const entryId = sanitizeText(options.entryId);
        const agentId = sanitizeText(options.agentId);
        const topicId = sanitizeText(options.topicId);
        const updater = typeof options.updater === 'function' ? options.updater : null;
        if (!entryId || !updater) {
            return null;
        }

        const candidateEntries = agentId && topicId
            ? [{ agentId, topicId }]
            : (await listEntries({
                agentId,
                topicId,
                limit: Number(options.limit || 5000),
            })).map((entry) => ({
                agentId: entry.agentId,
                topicId: entry.topicId,
            }));

        const seen = new Set();
        for (const candidate of candidateEntries) {
            const key = `${candidate.agentId}::${candidate.topicId}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            const entries = await readTopicEntries(candidate.agentId, candidate.topicId);
            const entryIndex = entries.findIndex((entry) => sanitizeText(entry.id) === entryId);
            if (entryIndex === -1) {
                continue;
            }

            const current = normalizeEntry(entries[entryIndex]);
            const updated = normalizeEntry({
                ...current,
                ...(updater(current) || {}),
                updatedAt: Date.now(),
            });
            entries[entryIndex] = updated;
            await writeTopicEntries(candidate.agentId, candidate.topicId, entries);
            return updated;
        }

        return null;
    }

    async function markEntriesRecalled(refs = []) {
        const grouped = new Map();
        refs.forEach((ref) => {
            const explicitEntryRefs = Array.isArray(ref.entryRefs)
                ? ref.entryRefs
                    .map((entryRef) => ({
                        agentId: sanitizeText(entryRef?.agentId),
                        topicId: sanitizeText(entryRef?.topicId),
                        entryId: sanitizeText(entryRef?.entryId),
                    }))
                    .filter((entryRef) => entryRef.agentId && entryRef.topicId && entryRef.entryId)
                : [];

            if (explicitEntryRefs.length > 0) {
                explicitEntryRefs.forEach((entryRef) => {
                    const key = `${entryRef.agentId}::${entryRef.topicId}`;
                    if (!grouped.has(key)) {
                        grouped.set(key, {
                            agentId: entryRef.agentId,
                            topicId: entryRef.topicId,
                            entryIds: new Set(),
                        });
                    }

                    grouped.get(key).entryIds.add(entryRef.entryId);
                });
                return;
            }

            const agentId = sanitizeText(ref.agentId);
            const topicId = sanitizeText(ref.topicId);
            if (!agentId || !topicId || !Array.isArray(ref.entryIds) || ref.entryIds.length === 0) {
                return;
            }

            const key = `${agentId}::${topicId}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    agentId,
                    topicId,
                    entryIds: new Set(),
                });
            }

            ref.entryIds.forEach((entryId) => grouped.get(key).entryIds.add(String(entryId)));
        });

        const recalledAt = Date.now();
        for (const { agentId, topicId, entryIds } of grouped.values()) {
            const entries = await readTopicEntries(agentId, topicId);
            let changed = false;
            const nextEntries = entries.map((entry) => {
                if (!entryIds.has(String(entry.id))) {
                    return entry;
                }

                changed = true;
                return {
                    ...entry,
                    recallCount: Number(entry.recallCount || 0) + 1,
                    lastRecalledAt: recalledAt,
                };
            });

            if (changed) {
                await writeTopicEntries(agentId, topicId, nextEntries);
            }
        }
    }

    return {
        getEntry,
        getTopicEntriesFile,
        listAgentIds,
        listEntries,
        listTopicIds,
        markEntriesRecalled,
        normalizeEntry,
        normalizeNotebookId,
        normalizeNotebookName,
        readTopicEntries,
        updateEntry,
        writeEntry,
        writeTopicEntries,
    };
}

module.exports = {
    createStudyLogStore,
    normalizeNotebookId,
    normalizeNotebookName,
    normalizeTagList,
};

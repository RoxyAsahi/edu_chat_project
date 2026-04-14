const fs = require('fs-extra');
const path = require('path');

function sanitizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function uniqueValues(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value)))];
}

function formatTime(timestamp) {
    const date = new Date(Number(timestamp || Date.now()));
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function sortDateKeysDescending(left, right) {
    return String(right || '').localeCompare(String(left || ''));
}

function buildEntryMarkdown(entry = {}) {
    const tags = Array.isArray(entry.tags) && entry.tags.length > 0
        ? `\n\nTags: ${entry.tags.map((tag) => `#${tag}`).join(' ')}`
        : '';
    const maidLine = sanitizeText(entry.maidRaw)
        ? `\n\nMaid: ${entry.maidRaw}`
        : sanitizeText(entry.maidSignature)
            ? `\n\nMaid: ${entry.maidSignature}`
            : '';

    return [
        `#### ${formatTime(entry.createdAt)}${sanitizeText(entry.maidSignature) ? ` · ${entry.maidSignature}` : ''}`,
        sanitizeText(entry.contentMarkdown, '_No content_'),
        maidLine,
        tags,
    ].join('\n');
}

function buildDiaryMarkdownFromEntries(entries = [], metadata = {}) {
    const notebookName = sanitizeText(metadata.notebookName, '默认');
    const dateKey = sanitizeText(metadata.dateKey);
    const groupedTopics = new Map();

    [...entries]
        .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
        .forEach((entry) => {
            const topicId = sanitizeText(entry.topicId, 'default');
            if (!groupedTopics.has(topicId)) {
                groupedTopics.set(topicId, {
                    topicId,
                    topicName: sanitizeText(entry.topicNameSnapshot, topicId),
                    entries: [],
                });
            }
            groupedTopics.get(topicId).entries.push(entry);
        });

    return [
        `# DailyNote ${dateKey}`,
        `> 日记本：[${notebookName}]`,
        ...[...groupedTopics.values()].map((topic) => [
            `## ${sanitizeText(topic.topicName, topic.topicId)}`,
            ...topic.entries.map((entry) => buildEntryMarkdown(entry)),
        ].join('\n\n')),
    ].join('\n\n').trim();
}

function buildDiaryId(notebookId, dateKey) {
    return `study_diary_${sanitizeText(notebookId)}_${sanitizeText(dateKey)}`;
}

function createStudyDiaryProjector(options = {}) {
    const dataRoot = options.dataRoot;
    const diaryRoot = path.join(dataRoot, 'StudyDiary');
    const studyLogStore = options.studyLogStore;

    function getDiaryDayFile(notebookId, dateKey) {
        return path.join(diaryRoot, notebookId, `${dateKey}.json`);
    }

    async function readDiaryDayFile(notebookId, dateKey) {
        if (!notebookId || !dateKey) {
            return null;
        }

        const filePath = getDiaryDayFile(notebookId, dateKey);
        if (!await fs.pathExists(filePath)) {
            return null;
        }

        return fs.readJson(filePath).catch(() => null);
    }

    async function writeDiaryDayFile(notebookId, dateKey, payload) {
        const filePath = getDiaryDayFile(notebookId, dateKey);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeJson(filePath, payload, { spaces: 2 });
        return payload;
    }

    async function removeDiaryDayFile(notebookId, dateKey) {
        const filePath = getDiaryDayFile(notebookId, dateKey);
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
        }
    }

    async function listAllDiaryFiles() {
        const notebookIds = await fs.readdir(diaryRoot).catch(() => []);
        const items = [];
        for (const notebookId of notebookIds.filter(Boolean)) {
            const fileNames = await fs.readdir(path.join(diaryRoot, notebookId)).catch(() => []);
            fileNames
                .filter((fileName) => fileName.endsWith('.json'))
                .forEach((fileName) => {
                    items.push({
                        notebookId,
                        dateKey: fileName.replace(/\.json$/i, ''),
                    });
                });
        }
        return items;
    }

    async function buildDiaryPayload(entries = [], existingDiary = null, scope = {}) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return null;
        }

        const sortedEntries = [...entries]
            .map((entry) => studyLogStore?.normalizeEntry ? studyLogStore.normalizeEntry(entry) : entry)
            .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
        const firstEntry = sortedEntries[0];
        const lastEntry = sortedEntries[sortedEntries.length - 1];
        const notebookId = sanitizeText(scope.notebookId || firstEntry.notebookId);
        const notebookName = sanitizeText(scope.notebookName || firstEntry.notebookName, '默认');
        const dateKey = sanitizeText(scope.dateKey || firstEntry.dateKey);
        const entryIds = sortedEntries.map((entry) => entry.id);
        const tags = uniqueValues(sortedEntries.flatMap((entry) => entry.tags || []));
        const agentIds = uniqueValues(sortedEntries.map((entry) => entry.agentId));
        const topicIds = uniqueValues(sortedEntries.map((entry) => entry.topicId));
        const sourceMessageIds = uniqueValues(sortedEntries.flatMap((entry) => entry.sourceMessageIds || []));
        const maidSignatures = uniqueValues(sortedEntries.map((entry) => entry.maidSignature || entry.maidRaw));
        const agentNames = uniqueValues(sortedEntries.map((entry) => (
            sanitizeText(entry.agentNameSnapshot)
            || sanitizeText(entry.maidSignature)
            || sanitizeText(entry.agentId)
        )));
        const entryRefs = sortedEntries.map((entry) => ({
            agentId: sanitizeText(entry.agentId),
            topicId: sanitizeText(entry.topicId),
            entryId: sanitizeText(entry.id),
        })).filter((entry) => entry.agentId && entry.topicId && entry.entryId);
        const topicSummary = {};

        sortedEntries.forEach((entry) => {
            const topicId = sanitizeText(entry.topicId, 'default');
            const current = topicSummary[topicId] || {
                topicId,
                topicName: sanitizeText(entry.topicNameSnapshot, topicId),
                entryIds: [],
                count: 0,
            };
            current.topicName = sanitizeText(entry.topicNameSnapshot, current.topicName);
            current.entryIds.push(entry.id);
            current.count += 1;
            topicSummary[topicId] = current;
        });

        return {
            id: buildDiaryId(notebookId, dateKey),
            notebookId,
            notebookName,
            dateKey,
            createdAt: Number(existingDiary?.createdAt || firstEntry.createdAt || Date.now()),
            updatedAt: Number(lastEntry.updatedAt || lastEntry.createdAt || Date.now()),
            lastEntryAt: Number(lastEntry.createdAt || 0),
            entryIds,
            entryRefs,
            entryCount: entryIds.length,
            recallCount: Number(existingDiary?.recallCount || 0),
            lastRecalledAt: Number(existingDiary?.lastRecalledAt || 0),
            tags,
            topicIds,
            topics: topicSummary,
            agentIds,
            agentNames,
            sourceMessageIds,
            maidSignatures,
            isPublicNotebook: notebookName === '公共',
            contentMarkdown: buildDiaryMarkdownFromEntries(sortedEntries, {
                notebookName,
                dateKey,
            }),
        };
    }

    async function rebuildDiaryDay(options = {}) {
        const notebookId = sanitizeText(options.notebookId);
        const notebookName = sanitizeText(options.notebookName);
        const dateKey = sanitizeText(options.dateKey);
        if (!notebookId || !dateKey || !studyLogStore?.listEntries) {
            return null;
        }

        const entries = await studyLogStore.listEntries({
            notebookId,
            dateKey,
            limit: 5000,
        });
        if (!entries.length) {
            await removeDiaryDayFile(notebookId, dateKey);
            return null;
        }

        const existing = await readDiaryDayFile(notebookId, dateKey);
        const payload = await buildDiaryPayload(entries, existing, { notebookId, notebookName, dateKey });
        await writeDiaryDayFile(notebookId, dateKey, payload);
        return payload;
    }

    async function projectEntry(entry = {}) {
        return rebuildDiaryDay({
            notebookId: entry.notebookId,
            notebookName: entry.notebookName,
            dateKey: entry.dateKey,
        });
    }

    function groupEntriesByDiary(entries = []) {
        const grouped = new Map();
        entries.forEach((entry) => {
            const notebookId = sanitizeText(entry.notebookId);
            const dateKey = sanitizeText(entry.dateKey);
            if (!notebookId || !dateKey) {
                return;
            }
            const key = `${notebookId}::${dateKey}`;
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key).push(entry);
        });
        return grouped;
    }

    async function listDiaryDays(options = {}) {
        if (!studyLogStore?.listEntries) {
            return [];
        }

        const limit = Math.max(1, Number(options.limit || 90));
        const scopeEntries = await studyLogStore.listEntries({
            agentId: sanitizeText(options.agentId),
            topicId: sanitizeText(options.topicId),
            query: sanitizeText(options.query),
            dateKey: sanitizeText(options.dateKey),
            notebookId: sanitizeText(options.notebookId),
            notebookName: sanitizeText(options.notebookName),
            tag: sanitizeText(options.tag),
            limit: Number(options.entryLimit || 5000),
        });
        const grouped = groupEntriesByDiary(scopeEntries);
        const items = [];

        for (const entries of grouped.values()) {
            const firstEntry = entries[0];
            const fullDiary = await readDiaryDayFile(firstEntry.notebookId, firstEntry.dateKey)
                || await rebuildDiaryDay({
                    notebookId: firstEntry.notebookId,
                    notebookName: firstEntry.notebookName,
                    dateKey: firstEntry.dateKey,
                });
            const scopedDiary = await buildDiaryPayload(entries, fullDiary, {
                notebookId: firstEntry.notebookId,
                notebookName: firstEntry.notebookName,
                dateKey: firstEntry.dateKey,
            });
            if (!scopedDiary) {
                continue;
            }

            items.push({
                ...fullDiary,
                agentIds: scopedDiary.agentIds,
                agentNames: scopedDiary.agentNames,
                entryCount: scopedDiary.entryCount,
                tags: scopedDiary.tags,
                topicIds: scopedDiary.topicIds,
                topics: scopedDiary.topics,
                sourceMessageIds: scopedDiary.sourceMessageIds,
                maidSignatures: scopedDiary.maidSignatures,
                viewContentMarkdown: scopedDiary.contentMarkdown,
                matchedEntryIds: scopedDiary.entryIds,
                matchedEntryRefs: scopedDiary.entryRefs,
                matchedTopicIds: scopedDiary.topicIds,
            });
        }

        return items
            .sort((left, right) => {
                const dateOrder = sortDateKeysDescending(left.dateKey, right.dateKey);
                if (dateOrder !== 0) {
                    return dateOrder;
                }
                return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
            })
            .slice(0, limit);
    }

    async function getDiaryDay(options = {}) {
        const diaryId = sanitizeText(options.diaryId);
        const notebookIdFromOptions = sanitizeText(options.notebookId);
        const notebookName = sanitizeText(options.notebookName);
        const dateKey = sanitizeText(options.dateKey);

        let notebookId = notebookIdFromOptions;
        if (!notebookId && diaryId.startsWith('study_diary_')) {
            const suffix = diaryId.replace(/^study_diary_/, '');
            const lastUnderscore = suffix.lastIndexOf('_');
            if (lastUnderscore !== -1) {
                notebookId = suffix.slice(0, lastUnderscore);
            }
        }

        let diary = notebookId && dateKey
            ? await readDiaryDayFile(notebookId, dateKey)
            : null;

        if (!diary && notebookId && dateKey) {
            diary = await rebuildDiaryDay({ notebookId, notebookName, dateKey });
        }

        if (!diary && sanitizeText(options.agentId) && dateKey) {
            const scopedDays = await listDiaryDays({
                agentId: options.agentId,
                topicId: sanitizeText(options.topicId),
                dateKey,
                notebookName,
                limit: 20,
            });
            if (scopedDays.length === 1) {
                diary = scopedDays[0];
            }
        }

        if (!diary) {
            return null;
        }

        if (!sanitizeText(options.agentId) && !sanitizeText(options.topicId)) {
            return diary;
        }

        const scopedEntries = await studyLogStore.listEntries({
            agentId: sanitizeText(options.agentId),
            topicId: sanitizeText(options.topicId),
            notebookId: sanitizeText(diary.notebookId),
            dateKey: diary.dateKey,
            limit: 5000,
        });
        if (!scopedEntries.length) {
            return null;
        }

        const scopedDiary = await buildDiaryPayload(scopedEntries, diary, {
            notebookId: diary.notebookId,
            notebookName: diary.notebookName,
            dateKey: diary.dateKey,
        });
        return {
            ...diary,
            viewContentMarkdown: scopedDiary?.contentMarkdown || diary.contentMarkdown,
            entryCount: scopedDiary?.entryCount || diary.entryCount,
            matchedEntryIds: scopedDiary?.entryIds || diary.entryIds,
        };
    }

    async function listDiaryWallCards(options = {}) {
        const limit = Math.max(1, Number(options.limit || 120));
        const items = await listDiaryDays({
            agentId: sanitizeText(options.agentId),
            topicId: sanitizeText(options.topicId),
            query: sanitizeText(options.query),
            dateKey: sanitizeText(options.dateKey),
            notebookId: sanitizeText(options.notebookId),
            notebookName: sanitizeText(options.notebookName),
            tag: sanitizeText(options.tag),
            limit,
            entryLimit: Number(options.entryLimit || 5000),
        });

        return items.map((item) => ({
            id: item.id,
            diaryId: item.id,
            notebookId: item.notebookId,
            notebookName: item.notebookName,
            dateKey: item.dateKey,
            updatedAt: item.updatedAt,
            lastEntryAt: item.lastEntryAt,
            entryCount: Number(item.entryCount || 0),
            recallCount: Number(item.recallCount || 0),
            lastRecalledAt: Number(item.lastRecalledAt || 0),
            agentIds: item.agentIds || [],
            agentNames: item.agentNames || [],
            topicIds: item.topicIds || [],
            topics: item.topics || {},
            tags: item.tags || [],
            entryRefs: item.matchedEntryRefs || item.entryRefs || [],
            maidSignatures: item.maidSignatures || [],
            previewMarkdown: String(item.viewContentMarkdown || item.contentMarkdown || '').slice(0, 480),
            contentMarkdown: item.contentMarkdown || '',
            isPublicNotebook: item.isPublicNotebook === true,
        }));
    }

    async function getDiaryWallDetail(options = {}) {
        const diary = await getDiaryDay({
            diaryId: options.diaryId,
            notebookId: options.notebookId,
            notebookName: options.notebookName,
            dateKey: options.dateKey,
            agentId: options.agentId,
            topicId: options.topicId,
        });
        if (!diary) {
            return null;
        }

        const entries = await studyLogStore.listEntries({
            agentId: sanitizeText(options.agentId),
            topicId: sanitizeText(options.topicId),
            notebookId: diary.notebookId,
            dateKey: diary.dateKey,
            limit: 5000,
        });

        return {
            ...diary,
            entries,
        };
    }

    async function markDaysRecalled(refs = []) {
        const grouped = new Map();
        refs.forEach((ref) => {
            const diaryId = sanitizeText(ref.diaryId);
            const notebookId = sanitizeText(ref.notebookId);
            const dateKey = sanitizeText(ref.dateKey);
            if (!dateKey || (!diaryId && !notebookId)) {
                return;
            }

            const key = diaryId || `${notebookId}::${dateKey}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    diaryId,
                    notebookId,
                    dateKey,
                });
            }
        });

        const recalledAt = Date.now();
        for (const ref of grouped.values()) {
            let notebookId = sanitizeText(ref.notebookId);
            if (!notebookId && ref.diaryId.startsWith('study_diary_')) {
                const suffix = ref.diaryId.replace(/^study_diary_/, '');
                const lastUnderscore = suffix.lastIndexOf('_');
                if (lastUnderscore !== -1) {
                    notebookId = suffix.slice(0, lastUnderscore);
                }
            }

            const diary = notebookId && ref.dateKey
                ? await readDiaryDayFile(notebookId, ref.dateKey)
                : null;
            if (!diary) {
                continue;
            }

            await writeDiaryDayFile(notebookId, ref.dateKey, {
                ...diary,
                recallCount: Number(diary.recallCount || 0) + 1,
                lastRecalledAt: recalledAt,
            });
        }
    }

    return {
        getDiaryDay,
        getDiaryDayFile,
        getDiaryWallDetail,
        listAllDiaryFiles,
        listDiaryDays,
        listDiaryWallCards,
        markDaysRecalled,
        projectEntry,
        readDiaryDay: readDiaryDayFile,
        rebuildDiaryDay,
        writeDiaryDay: writeDiaryDayFile,
    };
}

module.exports = {
    createStudyDiaryProjector,
};

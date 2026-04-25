const fs = require('fs-extra');
const path = require('path');
const { createClient } = require('@libsql/client');

function toFiniteInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeIdentifier(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function escapeLikePattern(value = '') {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

function extractContentText(content) {
    if (content === null || content === undefined) {
        return '';
    }

    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === 'string') {
                return part;
            }
            if (part && typeof part === 'object') {
                if (typeof part.text === 'string') {
                    return part.text;
                }
                if (typeof part.content === 'string') {
                    return part.content;
                }
            }
            return '';
        }).filter(Boolean).join('\n');
    }

    if (typeof content === 'object') {
        if (typeof content.text === 'string') {
            return content.text;
        }
        if (typeof content.content === 'string') {
            return content.content;
        }
        try {
            return JSON.stringify(content);
        } catch (_error) {
            return '';
        }
    }

    return String(content);
}

function serializeMessageForRow(message, index, now) {
    const messageObject = message && typeof message === 'object' ? message : { value: message };
    const messageId = normalizeIdentifier(messageObject.id, `message_${index}`);
    const role = messageObject.role === null || messageObject.role === undefined
        ? ''
        : String(messageObject.role);
    const timestamp = toFiniteInteger(messageObject.timestamp, now);

    return {
        id: messageId,
        sortIndex: index,
        role,
        timestamp,
        contentText: extractContentText(messageObject.content),
        messageJson: JSON.stringify(message === undefined ? null : message),
        createdAt: now,
        updatedAt: now,
    };
}

function parseMessageRow(row) {
    try {
        return JSON.parse(row.message_json);
    } catch (_error) {
        return null;
    }
}

function createChatHistoryStore(options = {}) {
    const dataRoot = options.dataRoot;
    const dbDir = options.dbDir || path.join(dataRoot || '', 'ChatHistory');
    const dbPath = options.dbPath || path.join(dbDir, 'chat-history.db');
    const createClientImpl = options.createClient || createClient;
    const fsImpl = options.fs || fs;

    let client = options.client || null;
    let initialized = false;
    let initializePromise = null;

    async function initialize() {
        if (initialized) {
            return client;
        }
        if (initializePromise) {
            return initializePromise;
        }

        initializePromise = (async () => {
            await fsImpl.ensureDir(dbDir);
            if (!client) {
                client = createClientImpl({
                    url: `file:${dbPath}`,
                });
            }

            const statements = [
                `CREATE TABLE IF NOT EXISTS chat_message (
                    id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    topic_id TEXT NOT NULL,
                    sort_index INTEGER NOT NULL,
                    role TEXT,
                    timestamp INTEGER,
                    content_text TEXT,
                    message_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (agent_id, topic_id, sort_index)
                )`,
                `CREATE TABLE IF NOT EXISTS chat_topic_state (
                    agent_id TEXT NOT NULL,
                    topic_id TEXT NOT NULL,
                    migrated_at INTEGER,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (agent_id, topic_id)
                )`,
                'CREATE INDEX IF NOT EXISTS idx_chat_message_topic_sort ON chat_message(agent_id, topic_id, sort_index)',
                'CREATE INDEX IF NOT EXISTS idx_chat_message_topic_timestamp ON chat_message(agent_id, topic_id, timestamp)',
                'CREATE INDEX IF NOT EXISTS idx_chat_message_agent_content ON chat_message(agent_id, content_text)',
                'CREATE INDEX IF NOT EXISTS idx_chat_message_topic_id ON chat_message(agent_id, topic_id, id)',
            ];

            for (const statement of statements) {
                await client.execute(statement);
            }

            initialized = true;
            return client;
        })();

        try {
            return await initializePromise;
        } finally {
            initializePromise = null;
        }
    }

    async function getClient() {
        return initialize();
    }

    async function executeWriteBatch(statements) {
        const db = await getClient();
        if (statements.length === 0) {
            return;
        }
        if (typeof db.batch === 'function') {
            await db.batch(statements, 'write');
            return;
        }
        for (const statement of statements) {
            await db.execute(statement);
        }
    }

    async function getTopicState(agentId, topicId) {
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT agent_id, topic_id, migrated_at, message_count, updated_at
                FROM chat_topic_state
                WHERE agent_id = ? AND topic_id = ?
                LIMIT 1`,
            args: [agentId, topicId],
        });
        return result.rows?.[0] || null;
    }

    async function countTopicMessages(agentId, topicId) {
        const db = await getClient();
        const result = await db.execute({
            sql: 'SELECT COUNT(*) AS count FROM chat_message WHERE agent_id = ? AND topic_id = ?',
            args: [agentId, topicId],
        });
        return toFiniteInteger(result.rows?.[0]?.count, 0);
    }

    async function markTopicState(agentId, topicId, messageCount, migratedAt = Date.now()) {
        const now = Date.now();
        await executeWriteBatch([{
            sql: `INSERT INTO chat_topic_state (agent_id, topic_id, migrated_at, message_count, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(agent_id, topic_id) DO UPDATE SET
                    migrated_at = excluded.migrated_at,
                    message_count = excluded.message_count,
                    updated_at = excluded.updated_at`,
            args: [agentId, topicId, migratedAt, messageCount, now],
        }]);
    }

    async function replaceHistory(agentId, topicId, history = [], optionsForReplace = {}) {
        const messages = Array.isArray(history) ? history : [];
        const now = Date.now();
        const migratedAt = optionsForReplace.migratedAt || now;
        const statements = [{
            sql: 'DELETE FROM chat_message WHERE agent_id = ? AND topic_id = ?',
            args: [agentId, topicId],
        }];

        for (let index = 0; index < messages.length; index += 1) {
            const row = serializeMessageForRow(messages[index], index, now);
            statements.push({
                sql: `INSERT INTO chat_message
                    (id, agent_id, topic_id, sort_index, role, timestamp, content_text, message_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    row.id,
                    agentId,
                    topicId,
                    row.sortIndex,
                    row.role,
                    row.timestamp,
                    row.contentText,
                    row.messageJson,
                    row.createdAt,
                    row.updatedAt,
                ],
            });
        }

        statements.push({
            sql: `INSERT INTO chat_topic_state (agent_id, topic_id, migrated_at, message_count, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(agent_id, topic_id) DO UPDATE SET
                    migrated_at = excluded.migrated_at,
                    message_count = excluded.message_count,
                    updated_at = excluded.updated_at`,
            args: [agentId, topicId, migratedAt, messages.length, now],
        });

        await executeWriteBatch(statements);
        return { success: true, messageCount: messages.length };
    }

    async function readLegacyHistory(legacyHistoryPath) {
        if (!legacyHistoryPath || !await fsImpl.pathExists(legacyHistoryPath)) {
            return { exists: false, history: [] };
        }

        try {
            const history = await fsImpl.readJson(legacyHistoryPath);
            return {
                exists: true,
                history: Array.isArray(history) ? history : [],
                invalidShape: !Array.isArray(history),
            };
        } catch (error) {
            return {
                exists: true,
                history: [],
                error,
            };
        }
    }

    async function ensureMigrated(agentId, topicId, legacyHistoryPath = '') {
        const state = await getTopicState(agentId, topicId);
        if (state) {
            return { migrated: false, state };
        }

        const existingMessageCount = await countTopicMessages(agentId, topicId);
        if (existingMessageCount > 0) {
            await markTopicState(agentId, topicId, existingMessageCount);
            return { migrated: false, state: await getTopicState(agentId, topicId) };
        }

        const legacy = await readLegacyHistory(legacyHistoryPath);
        if (legacy.error) {
            console.warn(`[ChatHistoryStore] Failed to migrate legacy history: ${legacyHistoryPath}`, legacy.error);
            return { migrated: false, error: legacy.error };
        }

        await replaceHistory(agentId, topicId, legacy.history, { migratedAt: Date.now() });
        return {
            migrated: legacy.exists && legacy.history.length > 0,
            state: await getTopicState(agentId, topicId),
            invalidShape: legacy.invalidShape === true,
        };
    }

    async function getHistory(agentId, topicId, optionsForGet = {}) {
        await ensureMigrated(agentId, topicId, optionsForGet.legacyHistoryPath);
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT message_json
                FROM chat_message
                WHERE agent_id = ? AND topic_id = ?
                ORDER BY sort_index ASC`,
            args: [agentId, topicId],
        });

        return (result.rows || []).map(parseMessageRow).filter((message) => message !== null);
    }

    async function getHistoryPage(agentId, topicId, pageOptions = {}, migrationOptions = {}) {
        await ensureMigrated(agentId, topicId, migrationOptions.legacyHistoryPath);
        const limit = Math.max(1, Math.min(200, toFiniteInteger(pageOptions.limit, 50)));
        const before = Number(pageOptions.before);
        const hasBefore = Number.isFinite(before);
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT sort_index, message_json
                FROM chat_message
                WHERE agent_id = ? AND topic_id = ?
                    ${hasBefore ? 'AND sort_index < ?' : ''}
                ORDER BY sort_index DESC
                LIMIT ?`,
            args: hasBefore
                ? [agentId, topicId, Math.trunc(before), limit + 1]
                : [agentId, topicId, limit + 1],
        });
        const rows = result.rows || [];
        const selectedRows = rows.slice(0, limit).reverse();
        const messages = selectedRows.map(parseMessageRow).filter((message) => message !== null);
        const firstSortIndex = selectedRows[0]?.sort_index;

        return {
            success: true,
            messages,
            hasMore: rows.length > limit,
            nextBefore: firstSortIndex === undefined ? null : toFiniteInteger(firstSortIndex, 0),
        };
    }

    async function getMessageById(agentId, topicId, messageId, optionsForGet = {}) {
        await ensureMigrated(agentId, topicId, optionsForGet.legacyHistoryPath);
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT message_json
                FROM chat_message
                WHERE agent_id = ? AND topic_id = ? AND id = ?
                ORDER BY sort_index ASC
                LIMIT 1`,
            args: [agentId, topicId, messageId],
        });
        const row = result.rows?.[0];
        return row ? parseMessageRow(row) : null;
    }

    async function findTopicIdsByContent(agentId, topicIds = [], searchTerm = '', optionsForSearch = {}) {
        const normalizedTopicIds = [...new Set((Array.isArray(topicIds) ? topicIds : [])
            .map((topicId) => normalizeIdentifier(topicId))
            .filter(Boolean))];
        const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
        if (!agentId || normalizedTopicIds.length === 0 || !normalizedSearch) {
            return [];
        }

        const legacyPathForTopic = typeof optionsForSearch.legacyHistoryPathForTopic === 'function'
            ? optionsForSearch.legacyHistoryPathForTopic
            : () => '';
        for (const topicId of normalizedTopicIds) {
            await ensureMigrated(agentId, topicId, legacyPathForTopic(topicId));
        }

        const placeholders = normalizedTopicIds.map(() => '?').join(', ');
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT DISTINCT topic_id
                FROM chat_message
                WHERE agent_id = ?
                    AND topic_id IN (${placeholders})
                    AND LOWER(COALESCE(content_text, '')) LIKE ? ESCAPE '\\'`,
            args: [
                agentId,
                ...normalizedTopicIds,
                `%${escapeLikePattern(normalizedSearch)}%`,
            ],
        });
        const matched = new Set((result.rows || []).map((row) => String(row.topic_id)));
        return normalizedTopicIds.filter((topicId) => matched.has(topicId));
    }

    async function getUnreadSummary(agentId, topicId, optionsForGet = {}) {
        await ensureMigrated(agentId, topicId, optionsForGet.legacyHistoryPath);
        const db = await getClient();
        const result = await db.execute({
            sql: `SELECT
                    COUNT(*) AS non_system_count,
                    SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_count
                FROM chat_message
                WHERE agent_id = ? AND topic_id = ? AND COALESCE(role, '') <> 'system'`,
            args: [agentId, topicId],
        });
        const row = result.rows?.[0] || {};
        const nonSystemCount = toFiniteInteger(row.non_system_count, 0);
        const assistantCount = toFiniteInteger(row.assistant_count, 0);
        return {
            nonSystemCount,
            assistantCount,
            shouldActivateCount: nonSystemCount === 1 && assistantCount === 1,
        };
    }

    async function deleteTopic(agentId, topicId) {
        await executeWriteBatch([
            {
                sql: 'DELETE FROM chat_message WHERE agent_id = ? AND topic_id = ?',
                args: [agentId, topicId],
            },
            {
                sql: 'DELETE FROM chat_topic_state WHERE agent_id = ? AND topic_id = ?',
                args: [agentId, topicId],
            },
        ]);
    }

    async function close() {
        if (client && typeof client.close === 'function') {
            await client.close();
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        client = null;
        initialized = false;
        initializePromise = null;
    }

    return {
        close,
        deleteTopic,
        ensureMigrated,
        findTopicIdsByContent,
        getDbPath: () => dbPath,
        getHistory,
        getHistoryPage,
        getMessageById,
        getTopicState,
        getUnreadSummary,
        initialize,
        replaceHistory,
    };
}

module.exports = {
    createChatHistoryStore,
    extractContentText,
};

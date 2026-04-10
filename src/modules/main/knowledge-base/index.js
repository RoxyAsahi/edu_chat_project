const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const {
    initializeDatabase,
    getDb,
    closeDatabase,
} = require('./db');
const { chunkText, htmlToSections } = require('./chunking');
const { requestEmbeddings, cosineSimilarity, resolveRetrievalConfig } = require('./embeddings');
const { requestRerank, resolveRerankConfig } = require('./rerank');
const { parseKnowledgeBaseDocument } = require('./parserAdapter');
const { KB_UNSUPPORTED_OCR_ERROR } = require('./constants');
const vcpClient = require('../vcpClient');

let moduleState = {
    initialized: false,
    dataRoot: null,
    filesRoot: null,
    settingsManager: null,
    agentConfigManager: null,
    agentDir: null,
    processing: false,
    queue: [],
    shuttingDown: false,
};
const guideJobs = new Map();

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function toNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundScore(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return Number(value.toFixed(4));
}

function buildSnippet(text, maxLength = 180) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength).trim()}...`;
}

function splitReaderParagraphs(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function buildParagraphView(paragraphs = []) {
    let paragraphIndex = 1;
    return {
        type: 'text',
        paragraphs: paragraphs
            .map((paragraph) => {
                const text = String(paragraph?.text || '').trim();
                if (!text) {
                    return null;
                }
                return {
                    index: paragraphIndex++,
                    sectionTitle: paragraph?.sectionTitle || null,
                    text,
                };
            })
            .filter(Boolean),
    };
}

function buildMarkdownReaderView(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const paragraphs = [];
    let currentSectionTitle = null;
    let currentBlock = [];
    let inCodeFence = false;

    const flushBlock = () => {
        const blockText = currentBlock.join('\n').trim();
        if (blockText) {
            paragraphs.push({
                sectionTitle: currentSectionTitle,
                text: blockText,
            });
        }
        currentBlock = [];
    };

    for (const line of lines) {
        if (/^```/.test(line.trim())) {
            inCodeFence = !inCodeFence;
            currentBlock.push(line);
            continue;
        }

        if (!inCodeFence) {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                flushBlock();
                currentSectionTitle = `${headingMatch[1]} ${headingMatch[2].trim()}`;
                continue;
            }

            if (!line.trim()) {
                flushBlock();
                continue;
            }
        }

        currentBlock.push(line);
    }

    flushBlock();
    return buildParagraphView(paragraphs);
}

function buildPlainReaderView(text) {
    return buildParagraphView(
        splitReaderParagraphs(text).map((paragraphText) => ({
            sectionTitle: null,
            text: paragraphText,
        })),
    );
}

function buildHtmlReaderView(text) {
    const sections = htmlToSections(text);
    const paragraphs = [];
    sections.forEach((section) => {
        const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
        blocks.forEach((blockText) => {
            paragraphs.push({
                sectionTitle: section?.sectionTitle || null,
                text: blockText,
            });
        });
    });
    return buildParagraphView(paragraphs);
}

function buildReaderViewFromParsedDocument(parsed) {
    if (parsed?.structure?.type === 'pdf' || parsed?.structure?.type === 'docx') {
        return {
            type: parsed.structure.type,
            contentType: parsed.contentType,
            ...(parsed.structure || {}),
        };
    }

    if (parsed?.contentType === 'markdown') {
        return {
            contentType: parsed.contentType,
            ...buildMarkdownReaderView(parsed.text),
        };
    }

    if (parsed?.contentType === 'html') {
        return {
            contentType: parsed.contentType,
            ...buildHtmlReaderView(parsed.text),
        };
    }

    return {
        contentType: parsed?.contentType || 'plain',
        ...buildPlainReaderView(parsed?.text || ''),
    };
}

function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLength = 1200) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength).trim()}...`;
}

function splitGuideBullets(items = [], fallback = '暂无') {
    const normalized = items
        .map((item) => truncateText(item, 180))
        .filter(Boolean);
    return normalized.length > 0 ? normalized : [fallback];
}

function buildGuideSegments(parsed) {
    if (parsed?.structure?.type === 'pdf') {
        const pages = Array.isArray(parsed.structure.pages) ? parsed.structure.pages : [];
        return pages
            .map((page) => {
                const paragraphTexts = Array.isArray(page?.paragraphs)
                    ? page.paragraphs.map((paragraph) => normalizeWhitespace(paragraph?.text)).filter(Boolean)
                    : [];
                const text = paragraphTexts.join('\n\n');
                if (!text) {
                    return null;
                }
                return {
                    title: `第 ${page.pageNumber} 页`,
                    locator: `第 ${page.pageNumber} 页`,
                    text,
                };
            })
            .filter(Boolean);
    }

    if (parsed?.structure?.type === 'docx') {
        const paragraphs = Array.isArray(parsed.structure.paragraphs) ? parsed.structure.paragraphs : [];
        const groups = [];
        let current = null;
        for (const paragraph of paragraphs) {
            const text = normalizeWhitespace(paragraph?.text);
            if (!text) {
                continue;
            }
            const sectionTitle = normalizeWhitespace(paragraph?.sectionTitle) || '正文';
            if (!current || current.sectionTitle !== sectionTitle || current.paragraphs.length >= 6) {
                current = {
                    sectionTitle,
                    paragraphs: [],
                };
                groups.push(current);
            }
            current.paragraphs.push(paragraph);
        }

        return groups.map((group) => {
            const first = group.paragraphs[0];
            const last = group.paragraphs[group.paragraphs.length - 1];
            return {
                title: group.sectionTitle,
                locator: group.paragraphs.length > 1
                    ? `第 ${first.index}-${last.index} 段`
                    : `第 ${first.index} 段`,
                text: group.paragraphs.map((paragraph) => normalizeWhitespace(paragraph.text)).join('\n\n'),
            };
        });
    }

    const blocks = splitReaderParagraphs(parsed?.text || '');
    const segments = [];
    for (let index = 0; index < blocks.length; index += 4) {
        const slice = blocks.slice(index, index + 4);
        if (slice.length === 0) {
            continue;
        }
        const first = index + 1;
        const last = index + slice.length;
        segments.push({
            title: first === last ? `第 ${first} 段` : `第 ${first}-${last} 段`,
            locator: first === last ? `第 ${first} 段` : `第 ${first}-${last} 段`,
            text: slice.join('\n\n'),
        });
    }
    return segments;
}

function extractTextFromModelResponse(candidate) {
    if (!candidate) {
        return '';
    }

    if (typeof candidate === 'string') {
        return candidate;
    }

    if (Array.isArray(candidate)) {
        return candidate.map((item) => extractTextFromModelResponse(item)).filter(Boolean).join('');
    }

    if (typeof candidate === 'object') {
        if (typeof candidate.text === 'string') {
            return candidate.text;
        }
        if (typeof candidate.content === 'string') {
            return candidate.content;
        }
        if (Array.isArray(candidate.content)) {
            return extractTextFromModelResponse(candidate.content);
        }
        if (candidate.message) {
            return extractTextFromModelResponse(candidate.message);
        }
        if (Array.isArray(candidate.parts)) {
            return extractTextFromModelResponse(candidate.parts);
        }
    }

    return '';
}

function extractGuideTextFromResponse(result) {
    const response = result?.response;
    if (!response) {
        return '';
    }

    const candidates = [
        response?.choices?.[0]?.message?.content,
        response?.choices?.[0]?.content,
        response?.message?.content,
        response?.content,
        response?.output_text,
        response?.output?.[0]?.content,
    ];

    for (const candidate of candidates) {
        const text = extractTextFromModelResponse(candidate);
        if (text) {
            return String(text).trim();
        }
    }

    return '';
}

function buildGuidePrompt(document, parsed, partialSummaries = []) {
    const segments = buildGuideSegments(parsed);
    const navigation = segments
        .slice(0, 8)
        .map((segment) => `- ${segment.title}（${segment.locator}）`)
        .join('\n');
    const sourceText = partialSummaries.length > 0
        ? partialSummaries.map((item, index) => `## 局部摘要 ${index + 1}\n${item}`).join('\n\n')
        : truncateText(parsed?.text || '', 16000);

    return [
        `你是 UniStudy 的“来源指南”生成器。请基于资料内容输出一份面向学习者的中文 Markdown 指南。`,
        `文档名称：${document.name}`,
        `文档类型：${document.contentType || parsed?.contentType || 'plain'}`,
        navigation ? `可用章节/定位：\n${navigation}` : '',
        `输出必须严格使用下面这些一级标题，且每个部分都要简洁、可执行：`,
        `# 文档主题`,
        `# 资料概览`,
        `# 关键知识点`,
        `# 章节导航`,
        `# 推荐阅读路径`,
        `# 可直接提问的问题`,
        `要求：`,
        `1. 不要编造文档中没有的信息。`,
        `2. 如果能识别页码或段落，请在章节导航和推荐阅读路径中明确写出。`,
        `3. “关键知识点”与“可直接提问的问题”都使用项目符号列表。`,
        `4. 输出不要包含额外前言或结尾。`,
        `文档内容如下：`,
        sourceText,
    ].filter(Boolean).join('\n\n');
}

async function requestGuideFromModel(document, parsed, prompt, requestSuffix) {
    const settings = await readSettings();
    const endpoint = String(settings?.vcpServerUrl || '').trim();
    const apiKey = String(settings?.vcpApiKey || '').trim();
    const model = await resolveGuideModel(settings);

    if (!endpoint || !apiKey) {
        throw new Error('VCP 服务配置不完整，无法生成来源指南。');
    }

    const response = await vcpClient.send({
        requestId: makeId(`guide_${requestSuffix}`),
        endpoint,
        apiKey,
        messages: [
            {
                role: 'system',
                content: '你负责为资料生成学习导向的来源指南。输出必须是中文 Markdown。',
            },
            {
                role: 'user',
                content: prompt,
            },
        ],
        modelConfig: {
            model,
            stream: false,
            temperature: 0.2,
        },
        context: {
            source: 'knowledge-base-guide',
            documentId: document.id,
        },
        timeoutMs: 300000,
    });

    if (response?.error) {
        throw new Error(response.error);
    }

    const markdown = extractGuideTextFromResponse(response);
    if (!markdown) {
        throw new Error('模型没有返回可用的来源指南内容。');
    }

    return markdown;
}

async function summarizeGuideSinglePass(document, parsed) {
    const prompt = buildGuidePrompt(document, parsed);
    return requestGuideFromModel(document, parsed, prompt, 'single');
}

async function summarizeGuideMultiPass(document, parsed) {
    const segments = buildGuideSegments(parsed);
    if (segments.length === 0) {
        return summarizeGuideSinglePass(document, parsed);
    }

    const chunkSize = Math.max(1, Math.ceil(segments.length / 6));
    const partialSummaries = [];
    for (let index = 0; index < segments.length; index += chunkSize) {
        const group = segments.slice(index, index + chunkSize);
        const prompt = [
            `你是 UniStudy 的资料分析助手。请阅读下面这个资料片段，并给出简洁的中文 Markdown 局部摘要。`,
            `文档名称：${document.name}`,
            `输出请包含：`,
            `- 这部分主要讲什么`,
            `- 关键知识点`,
            `- 适合用户追问的两个问题`,
            `资料片段：`,
            group.map((segment) => `## ${segment.title}\n定位：${segment.locator}\n${truncateText(segment.text, 3000)}`).join('\n\n'),
        ].join('\n\n');
        partialSummaries.push(await requestGuideFromModel(document, parsed, prompt, `partial_${index}`));
    }

    const finalPrompt = buildGuidePrompt(document, parsed, partialSummaries);
    return requestGuideFromModel(document, parsed, finalPrompt, 'final');
}

async function generateGuideMarkdown(document) {
    const parsed = await parseKnowledgeBaseDocument(document);
    const textLength = normalizeWhitespace(parsed?.text || '').length;
    if (textLength <= 9000) {
        return summarizeGuideSinglePass(document, parsed);
    }
    return summarizeGuideMultiPass(document, parsed);
}

async function initializeKnowledgeBase(options = {}) {
    const dataRoot = options.dataRoot;
    if (!dataRoot) {
        throw new Error('Knowledge base dataRoot is required.');
    }

    if (moduleState.initialized) {
        if (moduleState.dataRoot === dataRoot) {
            return;
        }
        await shutdownKnowledgeBase();
    }

    const kbRoot = path.join(dataRoot, 'KnowledgeBase');
    const filesRoot = path.join(kbRoot, 'files');
    await fs.ensureDir(filesRoot);
    await initializeDatabase(dataRoot);

    moduleState = {
        ...moduleState,
        initialized: true,
        dataRoot,
        filesRoot,
        settingsManager: options.settingsManager || null,
        agentConfigManager: options.agentConfigManager || null,
        agentDir: options.agentDir || null,
        processing: false,
        queue: [],
        shuttingDown: false,
    };

    await recoverQueuedDocuments();
    await drainQueue();
}

async function shutdownKnowledgeBase() {
    moduleState.shuttingDown = true;
    moduleState.queue = [];
    moduleState.processing = false;
    guideJobs.clear();
    await closeDatabase();
    moduleState = {
        initialized: false,
        dataRoot: null,
        filesRoot: null,
        settingsManager: null,
        agentConfigManager: null,
        agentDir: null,
        processing: false,
        queue: [],
        shuttingDown: false,
    };
}

async function recoverQueuedDocuments() {
    const db = getDb();
    const result = await db.execute(`
        SELECT id, status
        FROM kb_document
        WHERE status IN ('pending', 'processing')
        ORDER BY created_at ASC
    `);

    const now = Date.now();
    for (const row of result.rows || []) {
        if (row.status === 'processing') {
            await db.execute({
                sql: `UPDATE kb_document
                    SET status = 'pending', updated_at = ?, processing_started_at = NULL
                    WHERE id = ?`,
                args: [now, row.id],
            });
        }
        enqueueDocument(row.id);
    }
}

async function readSettings() {
    if (!moduleState.settingsManager || typeof moduleState.settingsManager.readSettings !== 'function') {
        return {};
    }

    return moduleState.settingsManager.readSettings();
}

function pickFirstNonEmptyString(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

async function resolveGuideModel(settings = {}) {
    const directModel = pickFirstNonEmptyString(
        settings?.guideModel,
        settings?.defaultModel,
        settings?.lastModel,
    );
    if (directModel) {
        return directModel;
    }

    if (moduleState.agentConfigManager && moduleState.agentDir) {
        const candidateAgentIds = [];
        if (settings?.lastOpenItemType === 'agent' && settings?.lastOpenItemId) {
            candidateAgentIds.push(String(settings.lastOpenItemId));
        }

        const dirEntries = await fs.readdir(moduleState.agentDir, { withFileTypes: true }).catch(() => []);
        for (const entry of dirEntries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (!candidateAgentIds.includes(entry.name)) {
                candidateAgentIds.push(entry.name);
            }
        }

        for (const agentId of candidateAgentIds) {
            const config = await moduleState.agentConfigManager.readAgentConfig(agentId, { allowDefault: true }).catch(() => null);
            const model = pickFirstNonEmptyString(config?.model);
            if (model) {
                return model;
            }
        }
    }

    return 'gemini-3.1-flash-lite-preview';
}

async function listKnowledgeBases() {
    const db = getDb();
    const result = await db.execute(`
        SELECT
            kb.id,
            kb.name,
            kb.created_at,
            kb.updated_at,
            COUNT(doc.id) AS document_count,
            SUM(CASE WHEN doc.status = 'done' THEN 1 ELSE 0 END) AS done_count,
            SUM(CASE WHEN doc.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            SUM(CASE WHEN doc.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN doc.status = 'processing' THEN 1 ELSE 0 END) AS processing_count
        FROM knowledge_base kb
        LEFT JOIN kb_document doc ON doc.kb_id = kb.id
        GROUP BY kb.id
        ORDER BY kb.updated_at DESC
    `);

    return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: toNumber(row.created_at, 0),
        updatedAt: toNumber(row.updated_at, 0),
        documentCount: toNumber(row.document_count, 0),
        doneCount: toNumber(row.done_count, 0),
        failedCount: toNumber(row.failed_count, 0),
        pendingCount: toNumber(row.pending_count, 0),
        processingCount: toNumber(row.processing_count, 0),
    }));
}

async function getKnowledgeBaseById(kbId) {
    const db = getDb();
    const result = await db.execute({
        sql: 'SELECT id, name, created_at, updated_at FROM knowledge_base WHERE id = ? LIMIT 1',
        args: [kbId],
    });

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        name: row.name,
        createdAt: toNumber(row.created_at, 0),
        updatedAt: toNumber(row.updated_at, 0),
    };
}

async function createKnowledgeBase(payload = {}) {
    const name = String(payload.name || '').trim();
    if (!name) {
        throw new Error('Knowledge base name is required.');
    }

    const kb = {
        id: makeId('kb'),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    const db = getDb();
    await db.execute({
        sql: 'INSERT INTO knowledge_base (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        args: [kb.id, kb.name, kb.createdAt, kb.updatedAt],
    });

    return kb;
}

async function updateKnowledgeBase(kbId, payload = {}) {
    const existing = await getKnowledgeBaseById(kbId);
    if (!existing) {
        throw new Error('Knowledge base not found.');
    }

    const name = String(payload.name || existing.name).trim();
    if (!name) {
        throw new Error('Knowledge base name is required.');
    }

    const updatedAt = Date.now();
    const db = getDb();
    await db.execute({
        sql: 'UPDATE knowledge_base SET name = ?, updated_at = ? WHERE id = ?',
        args: [name, updatedAt, kbId],
    });

    return {
        ...existing,
        name,
        updatedAt,
    };
}

async function clearKnowledgeBaseBindings(kbId) {
    if (!moduleState.agentConfigManager || !moduleState.agentDir) {
        return;
    }

    const dirEntries = await fs.readdir(moduleState.agentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const agentId = entry.name;
        const config = await moduleState.agentConfigManager.readAgentConfig(agentId).catch(() => null);
        if (!config || !Array.isArray(config.topics)) {
            continue;
        }

        let changed = false;
        const topics = config.topics.map((topic) => {
            if (topic?.knowledgeBaseId === kbId) {
                changed = true;
                return {
                    ...topic,
                    knowledgeBaseId: null,
                };
            }
            return topic;
        });

        if (changed) {
            await moduleState.agentConfigManager.updateAgentConfig(agentId, (current) => ({
                ...current,
                topics,
            }));
        }
    }
}

async function removeUnreferencedStoredFiles(storedPaths = []) {
    const uniquePaths = [...new Set(
        (Array.isArray(storedPaths) ? storedPaths : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean),
    )];
    if (uniquePaths.length === 0) {
        return;
    }

    const db = getDb();
    for (const storedPath of uniquePaths) {
        const result = await db.execute({
            sql: 'SELECT COUNT(1) AS ref_count FROM kb_document WHERE stored_path = ?',
            args: [storedPath],
        });
        const refCount = toNumber(result.rows?.[0]?.ref_count, 0);
        if (refCount === 0) {
            await fs.remove(storedPath).catch(() => {});
        }
    }
}

async function deleteKnowledgeBase(kbId) {
    const existing = await getKnowledgeBaseById(kbId);
    if (!existing) {
        throw new Error('Knowledge base not found.');
    }

    const db = getDb();
    const documentResult = await db.execute({
        sql: 'SELECT stored_path FROM kb_document WHERE kb_id = ?',
        args: [kbId],
    });

    await db.execute({ sql: 'DELETE FROM kb_chunk WHERE kb_id = ?', args: [kbId] });
    await db.execute({ sql: 'DELETE FROM kb_document WHERE kb_id = ?', args: [kbId] });
    await db.execute({ sql: 'DELETE FROM knowledge_base WHERE id = ?', args: [kbId] });
    await removeUnreferencedStoredFiles((documentResult.rows || []).map((row) => row.stored_path));

    await clearKnowledgeBaseBindings(kbId);
    return { success: true };
}

async function copyDocumentToStore(sourcePath, displayName) {
    const buffer = await fs.readFile(sourcePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(displayName || sourcePath);
    const storedPath = path.join(moduleState.filesRoot, `${hash}${ext}`);
    await fs.ensureDir(path.dirname(storedPath));
    if (!await fs.pathExists(storedPath)) {
        await fs.writeFile(storedPath, buffer);
    }
    return {
        hash,
        storedPath,
        fileSize: buffer.length,
    };
}

async function importKnowledgeBaseFiles(kbId, files = []) {
    const kb = await getKnowledgeBaseById(kbId);
    if (!kb) {
        throw new Error('Knowledge base not found.');
    }

    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }

    const db = getDb();
    const imported = [];

    for (const file of files) {
        const sourcePath = String(file?.path || '').trim();
        if (!sourcePath) {
            continue;
        }

        const displayName = String(file?.name || path.basename(sourcePath));
        const { hash, storedPath, fileSize } = await copyDocumentToStore(sourcePath, displayName);
        const duplicateResult = await db.execute({
            sql: 'SELECT id FROM kb_document WHERE kb_id = ? AND file_hash = ? LIMIT 1',
            args: [kbId, hash],
        });

        if (duplicateResult.rows[0]?.id) {
            imported.push(await getDocumentById(duplicateResult.rows[0].id));
            continue;
        }

        const now = Date.now();
        const documentId = makeId('kbdoc');
        await db.execute({
            sql: `INSERT INTO kb_document
                (id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at, attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, 'idle', '', NULL, NULL)`,
            args: [
                documentId,
                kbId,
                displayName,
                storedPath,
                file?.type || '',
                fileSize,
                hash,
                now,
                now,
            ],
        });

        imported.push(await getDocumentById(documentId));
        enqueueDocument(documentId);
    }

    await touchKnowledgeBase(kbId);
    return imported.filter(Boolean);
}

function mapDocumentRow(row) {
    const lastError = row.last_error || row.error || null;
    return {
        id: row.id,
        kbId: row.kb_id,
        name: row.name,
        storedPath: row.stored_path,
        mimeType: row.mime_type,
        fileSize: toNumber(row.file_size, 0),
        fileHash: row.file_hash,
        status: row.status,
        error: lastError,
        lastError,
        chunkCount: toNumber(row.chunk_count, 0),
        createdAt: toNumber(row.created_at, 0),
        updatedAt: toNumber(row.updated_at, 0),
        processedAt: toNumber(row.processed_at, null),
        attemptCount: toNumber(row.attempt_count, 0),
        processingStartedAt: toNumber(row.processing_started_at, null),
        failedAt: toNumber(row.failed_at, null),
        completedAt: toNumber(row.completed_at, null),
        contentType: row.content_type || null,
        guideStatus: row.guide_status || 'idle',
        guideMarkdown: row.guide_markdown || '',
        guideGeneratedAt: toNumber(row.guide_generated_at, null),
        guideError: row.guide_error || null,
    };
}

async function listKnowledgeBaseDocuments(kbId) {
    const db = getDb();
    const result = await db.execute({
        sql: `SELECT id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at,
            attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error
            FROM kb_document
            WHERE kb_id = ?
            ORDER BY created_at DESC`,
        args: [kbId],
    });

    return result.rows.map(mapDocumentRow);
}

async function getDocumentById(documentId) {
    const db = getDb();
    const result = await db.execute({
        sql: `SELECT id, kb_id, name, stored_path, mime_type, file_size, file_hash, status, error, chunk_count, created_at, updated_at, processed_at,
            attempt_count, processing_started_at, failed_at, completed_at, last_error, content_type, guide_status, guide_markdown, guide_generated_at, guide_error
            FROM kb_document
            WHERE id = ?
            LIMIT 1`,
        args: [documentId],
    });

    const row = result.rows[0];
    return row ? mapDocumentRow(row) : null;
}

function enqueueDocument(documentId) {
    if (!moduleState.queue.includes(documentId)) {
        moduleState.queue.push(documentId);
    }

    void drainQueue();
}

async function drainQueue() {
    if (!moduleState.initialized || moduleState.processing || moduleState.shuttingDown) {
        return;
    }

    moduleState.processing = true;

    try {
        while (moduleState.queue.length > 0 && !moduleState.shuttingDown) {
            const documentId = moduleState.queue.shift();
            if (!documentId) {
                continue;
            }
            await processDocument(documentId);
        }
    } finally {
        moduleState.processing = false;
    }
}

async function updateDocumentState(documentId, patch = {}) {
    const document = await getDocumentById(documentId);
    if (!document) {
        return null;
    }

    const nextDocument = {
        ...document,
        ...patch,
        updatedAt: Date.now(),
    };
    const resolvedError = patch.lastError !== undefined
        ? patch.lastError
        : (patch.error !== undefined ? patch.error : nextDocument.lastError);
    nextDocument.lastError = resolvedError || null;
    nextDocument.error = nextDocument.lastError;

    const db = getDb();
    await db.execute({
        sql: `UPDATE kb_document
            SET status = ?, error = ?, chunk_count = ?, updated_at = ?, processed_at = ?, attempt_count = ?, processing_started_at = ?, failed_at = ?, completed_at = ?, last_error = ?, content_type = ?
            WHERE id = ?`,
        args: [
            nextDocument.status,
            nextDocument.error,
            toNumber(nextDocument.chunkCount, 0),
            nextDocument.updatedAt,
            nextDocument.processedAt,
            toNumber(nextDocument.attemptCount, 0),
            nextDocument.processingStartedAt,
            nextDocument.failedAt,
            nextDocument.completedAt,
            nextDocument.lastError,
            nextDocument.contentType,
            documentId,
        ],
    });

    await touchKnowledgeBase(document.kbId);
    return nextDocument;
}

async function updateDocumentGuideState(documentId, patch = {}) {
    const document = await getDocumentById(documentId);
    if (!document) {
        return null;
    }

    const nextDocument = {
        ...document,
        ...patch,
        guideStatus: patch.guideStatus ?? document.guideStatus ?? 'idle',
        guideMarkdown: patch.guideMarkdown ?? document.guideMarkdown ?? '',
        guideGeneratedAt: patch.guideGeneratedAt ?? document.guideGeneratedAt ?? null,
        guideError: patch.guideError ?? document.guideError ?? null,
        updatedAt: Date.now(),
    };

    const db = getDb();
    await db.execute({
        sql: `UPDATE kb_document
            SET guide_status = ?, guide_markdown = ?, guide_generated_at = ?, guide_error = ?, updated_at = ?
            WHERE id = ?`,
        args: [
            nextDocument.guideStatus || 'idle',
            nextDocument.guideMarkdown || '',
            nextDocument.guideGeneratedAt,
            nextDocument.guideError,
            nextDocument.updatedAt,
            documentId,
        ],
    });

    await touchKnowledgeBase(document.kbId);
    return nextDocument;
}

async function touchKnowledgeBase(kbId) {
    const db = getDb();
    await db.execute({
        sql: 'UPDATE knowledge_base SET updated_at = ? WHERE id = ?',
        args: [Date.now(), kbId],
    });
}

async function deleteDocumentChunks(documentId) {
    const db = getDb();
    await db.execute({
        sql: 'DELETE FROM kb_chunk WHERE document_id = ?',
        args: [documentId],
    });
}

async function processDocument(documentId) {
    const document = await getDocumentById(documentId);
    if (!document) {
        return;
    }

    await updateDocumentState(documentId, {
        status: 'processing',
        error: null,
        lastError: null,
        chunkCount: 0,
        processedAt: null,
        processingStartedAt: Date.now(),
        failedAt: null,
        completedAt: null,
        attemptCount: (document.attemptCount || 0) + 1,
        contentType: document.contentType || null,
    });
    await updateDocumentGuideState(documentId, {
        guideStatus: 'idle',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: null,
    });

    try {
        const {
            text,
            mimeType,
            contentType,
            structure,
        } = await parseKnowledgeBaseDocument(document);
        const chunks = chunkText(text, { contentType, structure });
        if (chunks.length === 0) {
            throw new Error(KB_UNSUPPORTED_OCR_ERROR);
        }

        const settings = await readSettings();
        const chunkInputs = chunks.map((chunk) => `${document.name}\n${chunk.content}`);
        const embeddings = await requestEmbeddings(settings, chunkInputs);

        await deleteDocumentChunks(documentId);

        const db = getDb();
        const createdAt = Date.now();
        for (let index = 0; index < chunks.length; index += 1) {
            await db.execute({
                sql: `INSERT INTO kb_chunk
                    (id, kb_id, document_id, chunk_index, content, embedding, created_at, content_type, char_length, section_title, page_number, paragraph_index)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    makeId('kbchunk'),
                    document.kbId,
                    documentId,
                    index,
                    chunks[index].content,
                    JSON.stringify(embeddings[index]),
                    createdAt,
                    chunks[index].contentType || contentType,
                    toNumber(chunks[index].charLength, chunks[index].content.length),
                    chunks[index].sectionTitle,
                    toOptionalNumber(chunks[index].pageNumber, null),
                    toOptionalNumber(chunks[index].paragraphIndex, null),
                ],
            });
        }

        const completedAt = Date.now();
        await updateDocumentState(documentId, {
            status: 'done',
            error: null,
            lastError: null,
            chunkCount: chunks.length,
            processedAt: completedAt,
            processingStartedAt: null,
            failedAt: null,
            completedAt,
            contentType,
        });
        await updateDocumentGuideState(documentId, {
            guideStatus: 'idle',
            guideMarkdown: '',
            guideGeneratedAt: null,
            guideError: null,
        });

        await db.execute({
            sql: 'UPDATE kb_document SET mime_type = ? WHERE id = ?',
            args: [mimeType, documentId],
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deleteDocumentChunks(documentId).catch(() => {});
        await updateDocumentState(documentId, {
            status: 'failed',
            error: message || KB_UNSUPPORTED_OCR_ERROR,
            lastError: message || KB_UNSUPPORTED_OCR_ERROR,
            chunkCount: 0,
            processedAt: null,
            processingStartedAt: null,
            failedAt: Date.now(),
            completedAt: null,
        });
    }
}

async function retryKnowledgeBaseDocument(documentId) {
    const document = await getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    await deleteDocumentChunks(documentId);
    await updateDocumentState(documentId, {
        status: 'pending',
        error: null,
        lastError: null,
        chunkCount: 0,
        processedAt: null,
        processingStartedAt: null,
        failedAt: null,
        completedAt: null,
    });
    await updateDocumentGuideState(documentId, {
        guideStatus: 'idle',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: null,
    });
    enqueueDocument(documentId);
    return getDocumentById(documentId);
}

function mapChunkRowToCandidate(row, queryEmbedding) {
    let embedding = [];
    try {
        embedding = JSON.parse(row.embedding);
    } catch (_error) {
        embedding = [];
    }

    return {
        chunkId: row.id,
        documentId: row.document_id,
        chunkIndex: toNumber(row.chunk_index, 0),
        content: row.content,
        documentName: row.document_name,
        contentType: row.content_type || 'plain',
        charLength: toNumber(row.char_length, String(row.content || '').length),
        sectionTitle: row.section_title || null,
        pageNumber: toOptionalNumber(row.page_number, null),
        paragraphIndex: toOptionalNumber(row.paragraph_index, null),
        vectorScore: cosineSimilarity(queryEmbedding, embedding),
    };
}

function formatRetrievalRef(kbId, item) {
    return {
        kbId,
        documentId: item.documentId,
        chunkId: item.chunkId,
        documentName: item.documentName,
        chunkIndex: item.chunkIndex,
        contentType: item.contentType,
        sectionTitle: item.sectionTitle || null,
        pageNumber: toOptionalNumber(item.pageNumber, null),
        paragraphIndex: toOptionalNumber(item.paragraphIndex, null),
        snippet: buildSnippet(item.content),
        vectorScore: roundScore(item.vectorScore),
        ...(Number.isFinite(item.rerankScore) ? { rerankScore: roundScore(item.rerankScore) } : {}),
        score: roundScore(item.score),
    };
}

function buildContextText(finalItems) {
    if (finalItems.length === 0) {
        return '';
    }

    return [
        'Knowledge base context:',
        ...finalItems.map((item, index) => {
            const headerParts = [`[${index + 1}] ${item.documentName}`];
            if (Number.isFinite(item.pageNumber)) {
                headerParts.push(`Page: ${item.pageNumber}`);
            }
            if (Number.isFinite(item.paragraphIndex)) {
                headerParts.push(`Paragraph: ${item.paragraphIndex}`);
            }
            if (item.sectionTitle) {
                headerParts.push(`Section: ${item.sectionTitle}`);
            }
            return `${headerParts.join(' | ')}\n${item.content}`;
        }),
        'Use the retrieved context when it is relevant. If it is not relevant, answer normally.',
    ].join('\n\n');
}

async function rankKnowledgeBaseChunks(payload = {}) {
    const kbId = payload.kbId;
    const query = String(payload.query || '').trim();
    if (!kbId || !query) {
        return {
            kbId,
            query,
            refs: [],
            contextText: '',
            itemCount: 0,
            vectorCandidates: [],
            finalItems: [],
            rerankApplied: false,
            rerankFallbackReason: null,
            threshold: 0,
            topK: 0,
            candidateTopK: 0,
        };
    }

    const kb = await getKnowledgeBaseById(kbId);
    if (!kb) {
        throw new Error('Knowledge base not found.');
    }

    const settings = await readSettings();
    const [queryEmbedding] = await requestEmbeddings(settings, [query]);
    const db = getDb();
    const chunkResult = await db.execute({
        sql: `SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding, c.content_type, c.char_length, c.section_title, c.page_number, c.paragraph_index, d.name AS document_name
            FROM kb_chunk c
            JOIN kb_document d ON d.id = c.document_id
            WHERE c.kb_id = ? AND d.status = 'done'`,
        args: [kbId],
    });

    const { topK, scoreThreshold } = resolveRetrievalConfig(settings, payload);
    const { useRerank, rerankModel, candidateTopK } = resolveRerankConfig(settings, payload);
    const vectorCandidates = chunkResult.rows
        .map((row) => mapChunkRowToCandidate(row, queryEmbedding))
        .filter((item) => item.vectorScore >= scoreThreshold)
        .sort((a, b) => b.vectorScore - a.vectorScore);

    const candidateLimit = Math.max(topK, candidateTopK);
    const rerankCandidates = vectorCandidates.slice(0, candidateLimit);
    let finalItems = rerankCandidates.slice(0, topK).map((item) => ({
        ...item,
        score: item.vectorScore,
    }));
    let rerankApplied = false;
    let rerankFallbackReason = null;

    if (useRerank && rerankModel && rerankCandidates.length >= 2) {
        try {
            const rerankResults = await requestRerank(
                {
                    ...settings,
                    kbRerankModel: rerankModel,
                },
                query,
                rerankCandidates.map((item) => `${item.documentName}\n${item.content}`),
            );

            const rerankScoreByIndex = new Map(
                rerankResults.map((item) => [item.index, item.relevanceScore]),
            );

            finalItems = rerankCandidates
                .map((item, index) => {
                    const rerankScore = rerankScoreByIndex.get(index);
                    return {
                        ...item,
                        rerankScore: Number.isFinite(rerankScore) ? rerankScore : null,
                        score: Number.isFinite(rerankScore) ? rerankScore : item.vectorScore,
                    };
                })
                .sort((a, b) => {
                    const leftRerank = Number.isFinite(a.rerankScore) ? a.rerankScore : -Infinity;
                    const rightRerank = Number.isFinite(b.rerankScore) ? b.rerankScore : -Infinity;
                    if (rightRerank !== leftRerank) {
                        return rightRerank - leftRerank;
                    }
                    return b.vectorScore - a.vectorScore;
                })
                .slice(0, topK);

            rerankApplied = true;
        } catch (error) {
            rerankFallbackReason = error?.message || String(error);
            console.warn('[KnowledgeBase] Rerank failed, falling back to vector order:', rerankFallbackReason);
        }
    } else if (useRerank && rerankCandidates.length < 2) {
        rerankFallbackReason = 'Not enough candidates for rerank.';
    }

    const refs = finalItems.map((item) => formatRetrievalRef(kbId, item));
    const contextText = buildContextText(finalItems);

    return {
        kbId,
        kbName: kb.name,
        query,
        refs,
        contextText,
        itemCount: refs.length,
        topK,
        candidateTopK,
        threshold: scoreThreshold,
        useRerank,
        rerankModel,
        rerankApplied,
        rerankFallbackReason,
        vectorCandidates: vectorCandidates.map((item) => ({
            ...formatRetrievalRef(kbId, {
                ...item,
                score: item.vectorScore,
            }),
            charLength: item.charLength,
            content: item.content,
        })),
        finalItems: finalItems.map((item) => ({
            ...formatRetrievalRef(kbId, item),
            charLength: item.charLength,
            content: item.content,
        })),
    };
}

async function retrieveKnowledgeBaseContext(payload = {}) {
    const result = await rankKnowledgeBaseChunks(payload);
    return {
        kbId: result.kbId,
        refs: result.refs,
        contextText: result.contextText,
        itemCount: result.itemCount,
    };
}

async function searchKnowledgeBase(payload = {}) {
    const result = await rankKnowledgeBaseChunks(payload);
    return {
        kbId: result.kbId,
        kbName: result.kbName,
        query: result.query,
        items: result.finalItems,
        itemCount: result.finalItems.length,
        useRerank: result.useRerank,
        rerankApplied: result.rerankApplied,
        rerankFallbackReason: result.rerankFallbackReason,
    };
}

async function getKnowledgeBaseRetrievalDebug(payload = {}) {
    const result = await rankKnowledgeBaseChunks(payload);
    return {
        kbId: result.kbId,
        kbName: result.kbName,
        query: result.query,
        topK: result.topK,
        candidateTopK: result.candidateTopK,
        threshold: result.threshold,
        useRerank: result.useRerank,
        rerankModel: result.rerankModel,
        rerankApplied: result.rerankApplied,
        rerankFallbackReason: result.rerankFallbackReason,
        contextText: result.contextText,
        vectorCandidates: result.vectorCandidates,
        finalItems: result.finalItems,
        itemCount: result.itemCount,
    };
}

async function getKnowledgeBaseDocumentGuide(documentId) {
    const document = await getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    return {
        documentId: document.id,
        guideStatus: document.guideStatus || 'idle',
        guideMarkdown: document.guideMarkdown || '',
        guideGeneratedAt: document.guideGeneratedAt || null,
        guideError: document.guideError || null,
    };
}

async function generateKnowledgeBaseDocumentGuide(documentId, options = {}) {
    const document = await getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    const forceRefresh = options?.forceRefresh === true;
    if (document.status !== 'done') {
        return {
            documentId: document.id,
            guideStatus: document.guideStatus || 'idle',
            guideMarkdown: document.guideMarkdown || '',
            guideGeneratedAt: document.guideGeneratedAt || null,
            guideError: document.guideError || '文档尚未完成入库，暂时无法生成来源指南。',
        };
    }

    if (!forceRefresh && document.guideStatus === 'done' && document.guideMarkdown) {
        return {
            documentId: document.id,
            guideStatus: document.guideStatus,
            guideMarkdown: document.guideMarkdown,
            guideGeneratedAt: document.guideGeneratedAt || null,
            guideError: null,
        };
    }

    if (!forceRefresh && guideJobs.has(documentId)) {
        return getKnowledgeBaseDocumentGuide(documentId);
    }

    const prepared = await updateDocumentGuideState(documentId, {
        guideStatus: 'processing',
        guideError: null,
        ...(forceRefresh ? { guideMarkdown: '', guideGeneratedAt: null } : {}),
    });

    const job = (async () => {
        try {
            const latestDocument = await getDocumentById(documentId);
            if (!latestDocument) {
                throw new Error('Knowledge base document not found.');
            }

            const guideMarkdown = await generateGuideMarkdown(latestDocument);
            await updateDocumentGuideState(documentId, {
                guideStatus: 'done',
                guideMarkdown,
                guideGeneratedAt: Date.now(),
                guideError: null,
            });
        } catch (error) {
            await updateDocumentGuideState(documentId, {
                guideStatus: 'failed',
                guideError: error?.message || String(error),
            }).catch(() => {});
        } finally {
            guideJobs.delete(documentId);
        }
    })();

    guideJobs.set(documentId, job);

    return {
        documentId: prepared.id,
        guideStatus: prepared.guideStatus,
        guideMarkdown: prepared.guideMarkdown || '',
        guideGeneratedAt: prepared.guideGeneratedAt || null,
        guideError: prepared.guideError || null,
    };
}

async function getKnowledgeBaseDocumentViewData(documentId) {
    const document = await getDocumentById(documentId);
    if (!document) {
        throw new Error('Knowledge base document not found.');
    }

    const parsed = await parseKnowledgeBaseDocument(document);
    const view = buildReaderViewFromParsedDocument(parsed);

    return {
        document: {
            ...document,
            isIndexed: document.status === 'done',
        },
        view,
    };
}

module.exports = {
    initializeKnowledgeBase,
    shutdownKnowledgeBase,
    listKnowledgeBases,
    getKnowledgeBaseById,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    importKnowledgeBaseFiles,
    listKnowledgeBaseDocuments,
    retryKnowledgeBaseDocument,
    retrieveKnowledgeBaseContext,
    searchKnowledgeBase,
    getKnowledgeBaseRetrievalDebug,
    getKnowledgeBaseDocumentGuide,
    generateKnowledgeBaseDocumentGuide,
    getKnowledgeBaseDocumentViewData,
};

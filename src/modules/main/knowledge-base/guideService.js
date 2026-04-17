const {
    makeId,
    normalizeWhitespace,
    truncateText,
} = require('./helpers');
const { splitReaderParagraphs } = require('./readerProjection');
const { resolveExecutionConfig } = require('../utils/modelService');

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
        '你是 UniStudy 的“来源指南”生成器。请基于资料内容输出一份面向学习者的中文 Markdown 指南。',
        `文档名称：${document.name}`,
        `文档类型：${document.contentType || parsed?.contentType || 'plain'}`,
        navigation ? `可用章节/定位：\n${navigation}` : '',
        '输出必须严格使用下面这些一级标题，且每个部分都要简洁、可执行：',
        '# 文档主题',
        '# 资料概览',
        '# 关键知识点',
        '# 章节导航',
        '# 推荐阅读路径',
        '# 可直接提问的问题',
        '要求：',
        '1. 不要编造文档中没有的信息。',
        '2. 如果能识别页码或段落，请在章节导航和推荐阅读路径中明确写出。',
        '3. “关键知识点”与“可直接提问的问题”都使用项目符号列表。',
        '4. 输出不要包含额外前言或结尾。',
        '文档内容如下：',
        sourceText,
    ].filter(Boolean).join('\n\n');
}

function createGuideService(deps = {}) {
    const runtime = deps.runtime;
    const repository = deps.repository;
    const parseKnowledgeBaseDocument = deps.parseKnowledgeBaseDocument;
    const vcpClient = deps.vcpClient;

    async function requestGuideFromModel(document, parsed, prompt, requestSuffix) {
        const settings = await runtime.readSettings();
        const execution = resolveExecutionConfig(settings, { purpose: 'chat' });
        const endpoint = String(execution?.endpoint || settings?.vcpServerUrl || '').trim();
        const apiKey = String(execution?.apiKey || settings?.vcpApiKey || '').trim();
        const model = await runtime.resolveGuideModel(settings);

        if (!endpoint) {
            throw new Error('VCP 服务配置不完整，无法生成来源指南。');
        }

        const response = await vcpClient.send({
            requestId: makeId(`guide_${requestSuffix}`),
            endpoint,
            apiKey,
            extraHeaders: execution?.extraHeaders || {},
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
                '你是 UniStudy 的资料分析助手。请阅读下面这个资料片段，并给出简洁的中文 Markdown 局部摘要。',
                `文档名称：${document.name}`,
                '输出请包含：',
                '- 这部分主要讲什么',
                '- 关键知识点',
                '- 适合用户追问的两个问题',
                '资料片段：',
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

    async function getKnowledgeBaseDocumentGuide(documentId) {
        const document = await repository.getDocumentById(documentId);
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
        const document = await repository.getDocumentById(documentId);
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

        if (!forceRefresh && runtime.hasGuideJob(documentId)) {
            return getKnowledgeBaseDocumentGuide(documentId);
        }

        const prepared = await repository.updateDocumentGuideState(documentId, {
            guideStatus: 'processing',
            guideError: null,
            ...(forceRefresh ? { guideMarkdown: '', guideGeneratedAt: null } : {}),
        });

        const job = (async () => {
            try {
                const latestDocument = await repository.getDocumentById(documentId);
                if (!latestDocument) {
                    throw new Error('Knowledge base document not found.');
                }

                const guideMarkdown = await generateGuideMarkdown(latestDocument);
                await repository.updateDocumentGuideState(documentId, {
                    guideStatus: 'done',
                    guideMarkdown,
                    guideGeneratedAt: Date.now(),
                    guideError: null,
                });
            } catch (error) {
                await repository.updateDocumentGuideState(documentId, {
                    guideStatus: 'failed',
                    guideError: error?.message || String(error),
                }).catch(() => {});
            } finally {
                runtime.deleteGuideJob(documentId);
            }
        })();

        runtime.setGuideJob(documentId, job);

        return {
            documentId: prepared.id,
            guideStatus: prepared.guideStatus,
            guideMarkdown: prepared.guideMarkdown || '',
            guideGeneratedAt: prepared.guideGeneratedAt || null,
            guideError: prepared.guideError || null,
        };
    }

    return {
        buildGuideSegments,
        extractGuideTextFromResponse,
        buildGuidePrompt,
        generateGuideMarkdown,
        getKnowledgeBaseDocumentGuide,
        generateKnowledgeBaseDocumentGuide,
    };
}

module.exports = {
    buildGuideSegments,
    extractGuideTextFromResponse,
    buildGuidePrompt,
    createGuideService,
};

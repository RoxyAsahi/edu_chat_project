const fs = require('fs-extra');
const {
    buildChatEndpoint,
    listEnabledModels,
    normalizeModelService,
    resolveExecutionConfig,
    resolveProviderApiKey,
} = require('../utils/modelService');

function extractTextFromCandidate(candidate) {
    if (typeof candidate === 'string') {
        return candidate;
    }

    if (Array.isArray(candidate)) {
        return candidate
            .map((item) => extractTextFromCandidate(item?.text ?? item?.content ?? item))
            .filter(Boolean)
            .join('');
    }

    if (candidate && typeof candidate === 'object') {
        if (typeof candidate.text === 'string') {
            return candidate.text;
        }
        if (typeof candidate.content === 'string') {
            return candidate.content;
        }
        if (Array.isArray(candidate.content)) {
            return extractTextFromCandidate(candidate.content);
        }
        if (candidate.message) {
            return extractTextFromCandidate(candidate.message);
        }
        if (Array.isArray(candidate.parts)) {
            return extractTextFromCandidate(candidate.parts);
        }
    }

    return '';
}

function extractTextFromResponse(response) {
    const candidates = [
        response?.choices?.[0]?.message?.content,
        response?.choices?.[0]?.content,
        response?.message?.content,
        response?.content,
        response?.output_text,
        response?.output?.[0]?.content,
    ];

    for (const candidate of candidates) {
        const text = extractTextFromCandidate(candidate);
        if (text) {
            return String(text).trim();
        }
    }

    return '';
}

function buildImageTranscriptionPrompt(document) {
    return [
        '你是 UniStudy 的图片资料转写助手。请阅读这张学习资料图片，并输出一份可直接入库的中文 Markdown 正文。',
        `文件名：${document.name}`,
        '输出目标：',
        '1. 让阅读区可以像普通文档一样直接展示内容。',
        '2. 让后续“来源指南”生成和知识检索都能基于这份正文工作。',
        '输出要求：',
        '1. 如果图片里有可读文字，优先忠实转录，保留题干、公式、选项、表头、标签等关键信息。',
        '2. 如果图片包含图表、几何图形、坐标系、流程图、示意图，请补充结构化描述。',
        '3. 数学公式请尽量保留为 Markdown/LaTeX 形式，例如 `$...$`、`$$...$$`。',
        '4. 看不清的地方明确写 `[无法辨认]`，不要编造。',
        '5. 输出必须严格使用以下一级标题，且不要额外前言或结尾：',
        '# 图片概览',
        '# 文字转录',
        '# 图像补充描述',
        '# 可继续追问的问题',
    ].join('\n');
}

function resolveVisionExecution(settings = {}) {
    const normalizedService = normalizeModelService(settings?.modelService);
    const defaultExecution = resolveExecutionConfig(settings, { purpose: 'chat' });
    if (defaultExecution?.model?.capabilities?.vision === true) {
        return defaultExecution;
    }

    const firstVisionModel = listEnabledModels(normalizedService, { capability: 'vision' })[0] || null;
    if (!firstVisionModel) {
        return defaultExecution;
    }

    return {
        source: 'model-service',
        purpose: 'chat',
        provider: firstVisionModel.provider,
        model: firstVisionModel.model,
        ref: firstVisionModel.ref,
        endpoint: buildChatEndpoint(firstVisionModel.provider?.apiBaseUrl),
        apiKey: resolveProviderApiKey(firstVisionModel.provider),
        extraHeaders: firstVisionModel.provider?.extraHeaders || {},
    };
}

function createImageDocumentTranscriber(deps = {}) {
    const runtime = deps.runtime;
    const fsImpl = deps.fs || fs;
    const vcpClient = deps.vcpClient;

    async function transcribeImageDocument(document = {}) {
        const settings = await runtime.readSettings();
        const execution = resolveVisionExecution(settings);
        const endpoint = String(execution?.endpoint || settings?.vcpServerUrl || '').trim();
        const apiKey = String(execution?.apiKey || settings?.vcpApiKey || '').trim();
        const model = String(
            execution?.model?.id
            || settings?.defaultModel
            || settings?.lastModel
            || ''
        ).trim();

        if (!endpoint || !model) {
            throw new Error('当前未配置可用的视觉模型，无法转录图片来源。');
        }

        const mimeType = String(document.mimeType || '').trim() || 'image/png';
        const imageBuffer = await fsImpl.readFile(document.storedPath);
        const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        const prompt = buildImageTranscriptionPrompt(document);

        const response = await vcpClient.send({
            requestId: `kb_image_${document.id || Date.now()}`,
            endpoint,
            apiKey,
            extraHeaders: execution?.extraHeaders || {},
            messages: [
                {
                    role: 'system',
                    content: '你负责把学习资料图片转写成适合知识库阅读、来源指南生成和检索召回的中文 Markdown 正文。',
                },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imageDataUrl } },
                    ],
                },
            ],
            modelConfig: {
                model,
                stream: false,
                temperature: 0.2,
            },
            context: {
                source: 'knowledge-base-image-transcription',
                documentId: document.id || null,
            },
            timeoutMs: 300000,
        });

        if (response?.error) {
            throw new Error(response.error);
        }

        const markdown = extractTextFromResponse(response?.response);
        if (!markdown) {
            throw new Error('上游模型没有返回可用的图片转录内容。');
        }

        return {
            mimeType,
            contentType: 'markdown',
            text: markdown,
            structure: null,
        };
    }

    return {
        transcribeImageDocument,
    };
}

module.exports = {
    buildImageTranscriptionPrompt,
    createImageDocumentTranscriber,
    extractTextFromResponse,
    resolveVisionExecution,
};

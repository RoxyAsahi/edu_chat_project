const { ipcMain } = require('electron');
const {
    buildChatEndpoint,
    buildEmbeddingsEndpoint,
    buildModelsEndpoint,
    buildRerankEndpoint,
    createFetchedModelEntry,
    findModelById,
    normalizeApiKeys,
    normalizeProviderConfig,
} = require('../utils/modelService');
const { buildRequestHeaders } = require('../vcpClient');

let initialized = false;

function normalizeTimeout(timeoutMs, fallback = 15000) {
    const numeric = Number(timeoutMs);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

async function readJsonResponse(response) {
    const text = await response.text().catch(() => '');
    try {
        return {
            text,
            data: text ? JSON.parse(text) : null,
        };
    } catch (_error) {
        return {
            text,
            data: null,
        };
    }
}

async function withTimeout(timeoutMs, task) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), normalizeTimeout(timeoutMs));

    try {
        return await task(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

async function fetchProviderModels(provider, options = {}) {
    const normalizedProvider = normalizeProviderConfig(provider);
    const endpoint = buildModelsEndpoint(normalizedProvider.apiBaseUrl);
    if (!endpoint) {
        return { success: false, error: 'Base URL 不完整，无法拉取模型。', models: [] };
    }

    const apiKeys = normalizeApiKeys(options.apiKeys || normalizedProvider.apiKeys);
    const apiKey = apiKeys[0] || '';

    try {
        const response = await withTimeout(options.timeoutMs, (signal) => fetch(endpoint, {
            method: 'GET',
            headers: buildRequestHeaders(apiKey, normalizedProvider.extraHeaders),
            signal,
        }));
        const payload = await readJsonResponse(response);

        if (!response.ok) {
            return {
                success: false,
                error: payload.data?.error?.message || payload.data?.message || payload.text || `拉取失败（${response.status}）`,
                models: [],
            };
        }

        const remoteModels = (Array.isArray(payload.data?.data) ? payload.data.data : [])
            .map((item) => createFetchedModelEntry(item?.id || item?.name || item))
            .filter(Boolean);

        return {
            success: true,
            models: remoteModels,
            itemCount: remoteModels.length,
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            return { success: false, error: '拉取模型超时。', models: [] };
        }
        return { success: false, error: error.message, models: [] };
    }
}

function pickHealthModel(provider, requestedModelId = '') {
    if (requestedModelId) {
        return findModelById(provider, requestedModelId);
    }

    return (provider.models || []).find((model) => model.enabled !== false && model.capabilities?.chat === true) || null;
}

async function requestChatHealth(provider, model, apiKey, timeoutMs) {
    const endpoint = buildChatEndpoint(provider.apiBaseUrl);
    if (!endpoint) {
        throw new Error('Base URL 不完整，无法检测聊天接口。');
    }

    const response = await withTimeout(timeoutMs, (signal) => fetch(endpoint, {
        method: 'POST',
        headers: buildRequestHeaders(apiKey, provider.extraHeaders),
        body: JSON.stringify({
            model: model.id,
            stream: false,
            temperature: 0,
            max_tokens: 12,
            messages: [
                {
                    role: 'user',
                    content: 'ping',
                },
            ],
        }),
        signal,
    }));
    const payload = await readJsonResponse(response);
    if (!response.ok) {
        throw new Error(payload.data?.error?.message || payload.data?.message || payload.text || `聊天接口返回 ${response.status}`);
    }

    return {
        endpoint,
        payload: payload.data,
    };
}

async function requestEmbeddingHealth(provider, model, apiKey, timeoutMs) {
    const endpoint = buildEmbeddingsEndpoint(provider.apiBaseUrl);
    if (!endpoint) {
        throw new Error('Base URL 不完整，无法检测 embedding 接口。');
    }

    const response = await withTimeout(timeoutMs, (signal) => fetch(endpoint, {
        method: 'POST',
        headers: buildRequestHeaders(apiKey, provider.extraHeaders),
        body: JSON.stringify({
            model: model.id,
            input: ['ping'],
        }),
        signal,
    }));
    const payload = await readJsonResponse(response);
    if (!response.ok) {
        throw new Error(payload.data?.error?.message || payload.data?.message || payload.text || `Embedding 接口返回 ${response.status}`);
    }

    return {
        endpoint,
        payload: payload.data,
    };
}

async function requestRerankHealth(provider, model, apiKey, timeoutMs) {
    const endpoint = buildRerankEndpoint(provider.apiBaseUrl);
    if (!endpoint) {
        throw new Error('Base URL 不完整，无法检测 rerank 接口。');
    }

    const response = await withTimeout(timeoutMs, (signal) => fetch(endpoint, {
        method: 'POST',
        headers: buildRequestHeaders(apiKey, provider.extraHeaders),
        body: JSON.stringify({
            model: model.id,
            query: 'ping',
            documents: ['ping document'],
        }),
        signal,
    }));
    const payload = await readJsonResponse(response);
    if (!response.ok) {
        throw new Error(payload.data?.error?.message || payload.data?.message || payload.text || `Rerank 接口返回 ${response.status}`);
    }

    return {
        endpoint,
        payload: payload.data,
    };
}

async function runModelHealthCheck(provider, model, apiKey, timeoutMs) {
    if (model.capabilities?.embedding) {
        return requestEmbeddingHealth(provider, model, apiKey, timeoutMs);
    }
    if (model.capabilities?.rerank) {
        return requestRerankHealth(provider, model, apiKey, timeoutMs);
    }
    return requestChatHealth(provider, model, apiKey, timeoutMs);
}

async function checkProvider(provider, options = {}) {
    const normalizedProvider = normalizeProviderConfig(provider);
    const model = pickHealthModel(normalizedProvider, options.modelId);
    if (!model) {
        return {
            success: false,
            needsModelSelection: true,
            error: '当前 Provider 没有可检测的聊天模型，请先选择或新增一个聊天模型。',
        };
    }

    const apiKeys = normalizeApiKeys(options.apiKeys || normalizedProvider.apiKeys);
    const apiKey = apiKeys[0] || '';
    const startedAt = Date.now();

    try {
        const response = await runModelHealthCheck(
            normalizedProvider,
            model,
            apiKey,
            options.timeoutMs
        );

        return {
            success: true,
            modelId: model.id,
            endpoint: response.endpoint,
            latencyMs: Date.now() - startedAt,
        };
    } catch (error) {
        return {
            success: false,
            modelId: model.id,
            error: error?.name === 'AbortError' ? '检测超时。' : error.message,
            latencyMs: Date.now() - startedAt,
        };
    }
}

async function runBatchHealthCheck(provider, options = {}) {
    const normalizedProvider = normalizeProviderConfig(provider);
    const timeoutMs = normalizeTimeout(options.timeoutMs, 12000);
    const executionMode = options.executionMode === 'serial' ? 'serial' : 'parallel';
    const apiKeys = normalizeApiKeys(options.apiKeys || normalizedProvider.apiKeys);
    const healthApiKeys = apiKeys.length > 0 ? apiKeys : [''];
    const candidateModels = (Array.isArray(options.modelIds) && options.modelIds.length > 0
        ? options.modelIds
            .map((modelId) => findModelById(normalizedProvider, modelId))
            .filter(Boolean)
        : (normalizedProvider.models || []).filter((model) => model.enabled !== false)
    );

    const tasks = [];
    healthApiKeys.forEach((apiKey, keyIndex) => {
        candidateModels.forEach((model) => {
            tasks.push(async () => {
                const startedAt = Date.now();
                try {
                    const response = await runModelHealthCheck(
                        normalizedProvider,
                        model,
                        apiKey,
                        timeoutMs
                    );
                    return {
                        success: true,
                        modelId: model.id,
                        apiKeyIndex: keyIndex,
                        latencyMs: Date.now() - startedAt,
                        endpoint: response.endpoint,
                    };
                } catch (error) {
                    return {
                        success: false,
                        modelId: model.id,
                        apiKeyIndex: keyIndex,
                        latencyMs: Date.now() - startedAt,
                        error: error?.name === 'AbortError' ? '检测超时。' : error.message,
                    };
                }
            });
        });
    });

    const results = [];
    if (executionMode === 'serial') {
        for (const task of tasks) {
            results.push(await task());
        }
    } else {
        const settled = await Promise.all(tasks.map((task) => task()));
        results.push(...settled);
    }

    return {
        success: true,
        executionMode,
        timeoutMs,
        results,
    };
}

function initialize() {
    if (initialized) {
        return;
    }

    ipcMain.handle('model-service:fetch-models', async (_event, payload) => {
        const provider = payload?.provider || {};
        return fetchProviderModels(provider, payload || {});
    });

    ipcMain.handle('model-service:check-provider', async (_event, payload) => {
        const provider = payload?.provider || {};
        return checkProvider(provider, payload || {});
    });

    ipcMain.handle('model-service:check-health', async (_event, payload) => {
        const provider = payload?.provider || {};
        return runBatchHealthCheck(provider, payload || {});
    });

    initialized = true;
}

module.exports = {
    __testUtils: {
        checkProvider,
        fetchProviderModels,
        pickHealthModel,
        runBatchHealthCheck,
    },
    initialize,
};

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { _electron: electron } = require('playwright');
const {
    createTempDataRootFromFixture,
    ensureFixtureDataRoot,
    resolveFixtureDataRoot,
    resolveRequiredExternalDataRoot,
} = require('./lib/runtime-data-roots');
const { buildPreloadBundles } = require('./lib/preload-bundles');

function readOptionalEnv(name, fallback = '') {
    const value = String(process.env[name] || '').trim();
    return value || fallback;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatStamp(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function normalizeForMatch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[：:，,。、“”"'`]/g, '')
        .replace(/<[^>]+>/g, '');
}

function basename(filePath) {
    return path.basename(filePath);
}

function buildHistoryFilePath(dataRoot, agentId, topicId) {
    return path.join(dataRoot, 'UserData', agentId, 'topics', topicId, 'history.json');
}

async function readSettingsFile(dataRoot) {
    const settingsPath = path.join(dataRoot, 'settings.json');
    if (!await fs.pathExists(settingsPath)) {
        return {};
    }

    try {
        return await fs.readJson(settingsPath);
    } catch {
        return {};
    }
}

async function readJsonIfExists(filePath) {
    if (!filePath || !await fs.pathExists(filePath)) {
        return null;
    }

    try {
        return await fs.readJson(filePath);
    } catch {
        return null;
    }
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

async function resolveGuideModel(realDataRoot, persistedSettings, realAgentId) {
    const agentConfigPath = path.join(realDataRoot, 'Agents', realAgentId, 'config.json');
    const agentConfig = await readJsonIfExists(agentConfigPath);

    return firstNonEmpty(
        readOptionalEnv('UNISTUDY_GUIDE_MODEL'),
        readOptionalEnv('GUIDE_MODEL'),
        readOptionalEnv('VCP_MODEL'),
        persistedSettings?.guideModel,
        persistedSettings?.defaultModel,
        persistedSettings?.lastModel,
        agentConfig?.model,
        'gemini-3.1-flash-lite-preview',
    );
}

function makeFixtureName(runStamp, label, ext) {
    return `unistudy-${runStamp}-${label}.${ext}`;
}

async function createFixtureSet(rootDir, repoRoot, runStamp) {
    const fixtures = {
        pdfHandbook: path.join(repoRoot, 'docs', '第五届上海市青少年人工智能与编程实践活动项目手册.pdf'),
        singleNewton: path.join(rootDir, makeFixtureName(runStamp, 'newton-source', 'txt')),
        ohmLaw: path.join(rootDir, makeFixtureName(runStamp, 'ohm-law', 'txt')),
        pythagorean: path.join(rootDir, makeFixtureName(runStamp, 'pythagorean', 'md')),
        photosynthesis: path.join(rootDir, makeFixtureName(runStamp, 'photosynthesis', 'txt')),
        chemistry: path.join(rootDir, makeFixtureName(runStamp, 'chemistry-review', 'md')),
        history: path.join(rootDir, makeFixtureName(runStamp, 'industrial-history', 'txt')),
        english: path.join(rootDir, makeFixtureName(runStamp, 'english-reading', 'md')),
    };

    await fs.outputFile(
        fixtures.singleNewton,
        [
            '资料编号：NEWTON-101',
            '资料主题：牛顿第一定律。',
            '核心内容：当一个物体不受外力作用时，它将保持静止状态或匀速直线运动状态。',
            '测试问题：请根据资料说明 NEWTON-101 对应的知识点是什么。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.ohmLaw,
        [
            '资料编号：OHM-204',
            '知识点：欧姆定律。',
            '关键公式：I=U/R。',
            '学科方向：电学基础。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.pythagorean,
        [
            '# 资料编号：PYTH-305',
            '',
            '知识点：勾股定理。',
            '核心关系：直角三角形中 a^2 + b^2 = c^2。',
            '学科方向：平面几何。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.photosynthesis,
        [
            '资料编号：BIO-410',
            '知识点：光合作用。',
            '核心结论：绿色植物利用光能把二氧化碳和水合成为有机物，并释放氧气。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.chemistry,
        [
            '# 资料编号：CHEM-520',
            '',
            '知识点：元素周期表。',
            '重点结论：同主族元素具有相似的最外层电子排布与化学性质。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.history,
        [
            '资料编号：HIST-630',
            '知识点：第一次工业革命。',
            '核心特征：蒸汽机的大规模应用推动了工厂制度发展。',
        ].join('\n')
    );

    await fs.outputFile(
        fixtures.english,
        [
            '# 资料编号：ENG-740',
            '',
            '知识点：英语阅读定位策略。',
            '核心建议：先读题干关键词，再回原文定位对应句。',
        ].join('\n')
    );

    return fixtures;
}

function buildScenarios(mode, fixtures, runStamp) {
    if (mode !== 'real-data') {
        return [
            {
                id: 'temp-single',
                label: '临时单文件 Smoke',
                topicName: `临时单文件测试-${runStamp}`,
                files: [fixtures.singleNewton],
                uploadTimeoutMs: 45000,
                queries: [
                    {
                        prompt: '请根据资料回答：资料编号 NEWTON-101 对应的知识点名称。请直接回答知识点名称。',
                        expectedAnyKeywords: ['牛顿第一定律', '惯性定律'],
                        expectedDocuments: [basename(fixtures.singleNewton)],
                        minRefCount: 1,
                        minMatchedDocuments: 1,
                    },
                ],
                guideChecks: [
                    {
                        targetFile: basename(fixtures.singleNewton),
                        expectedAnyKeywords: ['牛顿第一定律', 'NEWTON-101'],
                        minLength: 80,
                    },
                ],
            },
        ];
    }

    return [
        {
            id: 'real-single',
            label: '真实单文件测试',
            topicName: `真实单文件测试-${runStamp}`,
            files: [fixtures.singleNewton],
            uploadTimeoutMs: 60000,
                queries: [
                    {
                        prompt: '请根据当前来源回答：资料编号 NEWTON-101 对应的知识点名称。请直接回答知识点名称。',
                        expectedAnyKeywords: ['牛顿第一定律', '惯性定律'],
                        expectedDocuments: [basename(fixtures.singleNewton)],
                    minRefCount: 1,
                        minMatchedDocuments: 1,
                    },
                ],
                guideChecks: [
                    {
                        targetFile: basename(fixtures.singleNewton),
                        expectedAnyKeywords: ['牛顿第一定律', 'NEWTON-101'],
                        minLength: 120,
                    },
                ],
            },
        {
            id: 'real-multi',
            label: '真实多文件测试',
            topicName: `真实多文件测试-${runStamp}`,
            files: [fixtures.pdfHandbook, fixtures.ohmLaw, fixtures.pythagorean],
            uploadTimeoutMs: 180000,
            queries: [
                {
                    prompt: '请根据 PDF 资料回答：这个项目手册标题里写的是第几届活动？请只回答届数。',
                    expectedAnyKeywords: ['第五届'],
                    expectedDocuments: [basename(fixtures.pdfHandbook)],
                    minRefCount: 1,
                    minMatchedDocuments: 1,
                },
                {
                    prompt: '请根据来源回答：资料编号 OHM-204 对应的知识点和关键公式。请简洁作答。',
                    expectedAnyKeywords: ['欧姆定律', 'i=u/r', 'i=u / r', 'i = u / r'],
                    expectedDocuments: [basename(fixtures.ohmLaw)],
                    minRefCount: 1,
                        minMatchedDocuments: 1,
                    },
                ],
                guideChecks: [
                    {
                        targetFile: basename(fixtures.pdfHandbook),
                        expectedAnyKeywords: ['第五届', '人工智能', '项目手册'],
                        minLength: 160,
                    },
                    {
                        targetFile: basename(fixtures.ohmLaw),
                        expectedAnyKeywords: ['欧姆定律', 'OHM-204', 'I=U/R'],
                        minLength: 100,
                    },
                ],
            },
        {
            id: 'real-pressure',
            label: '真实中等压力测试',
            topicName: `真实压力测试-${runStamp}`,
            files: [
                fixtures.pdfHandbook,
                fixtures.singleNewton,
                fixtures.ohmLaw,
                fixtures.pythagorean,
                fixtures.photosynthesis,
                fixtures.chemistry,
                fixtures.history,
                fixtures.english,
            ],
            uploadTimeoutMs: 240000,
            queries: [
                {
                    prompt: '请根据来源回答：资料编号 NEWTON-101 对应的知识点名称。请直接回答知识点名称。',
                    expectedAnyKeywords: ['牛顿第一定律', '惯性定律'],
                    expectedDocuments: [basename(fixtures.singleNewton)],
                    minRefCount: 1,
                    minMatchedDocuments: 1,
                },
                {
                    prompt: '请根据 PDF 来源回答：这个项目手册标题里写的是第几届活动？请只回答届数。',
                    expectedAnyKeywords: ['第五届'],
                    expectedDocuments: [basename(fixtures.pdfHandbook)],
                    minRefCount: 1,
                    minMatchedDocuments: 1,
                },
                {
                    prompt: '请比较资料编号 OHM-204 和 PYTH-305：它们分别对应什么知识点？请用“OHM-204=...；PYTH-305=...”格式回答。',
                    expectedAllKeywords: ['欧姆定律', '勾股定理'],
                    expectedDocuments: [basename(fixtures.ohmLaw), basename(fixtures.pythagorean)],
                    minRefCount: 2,
                        minMatchedDocuments: 2,
                    },
                ],
                guideChecks: [
                    {
                        targetFile: basename(fixtures.pdfHandbook),
                        expectedAnyKeywords: ['第五届', '人工智能', '项目手册'],
                        minLength: 160,
                    },
                    {
                        targetFile: basename(fixtures.pythagorean),
                        expectedAnyKeywords: ['勾股定理', 'PYTH-305'],
                        minLength: 100,
                    },
                ],
            },
    ];
}

async function launchApp(dataRoot) {
    await buildPreloadBundles();
    return electron.launch({
        args: [path.resolve(__dirname, '..')],
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            UNISTUDY_DATA_ROOT: dataRoot,
            ELECTRON_ENABLE_LOGGING: '1',
        },
    });
}

async function waitForWindowCount(app, expectedCount, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const windows = app.windows();
        if (windows.length === expectedCount) {
            return windows;
        }
        await delay(250);
    }

    return app.windows();
}

async function waitForFirstWindow(app, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const windows = app.windows();
        if (windows.length > 0) {
            return windows[0];
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for the first Electron window after ${timeoutMs}ms.`);
}

async function readMainBridgeStatus(page) {
    return page.evaluate(() => ({
        chatAPI: Boolean(window.chatAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
        openTextInNewWindow: typeof window.chatAPI?.openTextInNewWindow === 'function',
        openImageViewer: typeof window.chatAPI?.openImageViewer === 'function',
    })).catch((error) => ({
        chatAPI: false,
        electronAPI: false,
        electronPath: false,
        openTextInNewWindow: false,
        openImageViewer: false,
        evaluationError: error?.message || String(error),
    }));
}

async function waitForMainBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await readMainBridgeStatus(page);
        if (lastStatus.chatAPI
            && lastStatus.electronAPI
            && lastStatus.electronPath
            && lastStatus.openTextInNewWindow
            && lastStatus.openImageViewer) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for main preload bridge: ${JSON.stringify(lastStatus)}`);
}

async function readViewerBridgeStatus(page) {
    return page.evaluate(() => ({
        utilityAPI: Boolean(window.utilityAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
        getCurrentTheme: typeof window.utilityAPI?.getCurrentTheme === 'function',
        openImageViewer: typeof window.utilityAPI?.openImageViewer === 'function',
    })).catch((error) => ({
        utilityAPI: false,
        electronAPI: false,
        electronPath: false,
        getCurrentTheme: false,
        openImageViewer: false,
        evaluationError: error?.message || String(error),
    }));
}

async function waitForViewerBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await readViewerBridgeStatus(page);
        if (lastStatus.utilityAPI
            && lastStatus.electronAPI
            && lastStatus.electronPath
            && lastStatus.getCurrentTheme
            && lastStatus.openImageViewer) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for viewer preload bridge: ${JSON.stringify(lastStatus)}`);
}

function getChildWindow(app, mainWindow) {
    return app.windows().find((window) => window !== mainWindow) || null;
}

async function closeViewerWindow(viewerWindow, app) {
    await viewerWindow.evaluate(() => {
        document.getElementById('close-viewer-btn')?.click();
    }).catch(() => {});
    await waitForWindowCount(app, 1, 15000);
}

function buildRichRenderingSmokeMessage() {
    return [
        '<<<[TOOL_REQUEST]>>>',
        'tool_name: smoke_lookup',
        'content: UI smoke payload',
        '<<<[END_TOOL_REQUEST]>>>',
        '',
        '[[VCP调用结果信息汇总',
        '附加尾注：用于校验 footer 命名迁移。',
        '- 工具名称: smoke_lookup',
        '- 执行状态: SUCCESS',
        '- 返回内容: **smoke ok**',
        '- 可访问URL: https://example.com/smoke.png',
        'VCP调用结果结束]]',
        '',
        '[--- VCP元思考链: "UI Smoke" ---]',
        '这里是 thought chain 冒烟内容。',
        '[--- 元思考链结束 ---]',
        '',
        '```html',
        '<!DOCTYPE html>',
        '<html>',
        '  <body>',
        '    <div id="preview-smoke">preview smoke ok</div>',
        '  </body>',
        '</html>',
        '```',
        '',
        '<style>',
        '.smoke-scoped-card { color: rgb(0, 128, 0); font-weight: 700; }',
        '</style>',
        '<div class="smoke-scoped-card">Scoped CSS Smoke</div>',
        '',
        '<<<[DESKTOP_PUSH]>>><section>Desktop Push Smoke</section><<<[DESKTOP_PUSH_END]>>>',
    ].join('\n');
}

async function runViewerSmoke(dataRoot) {
    let lastResult = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const app = await launchApp(dataRoot);
        const result = {
            passed: false,
            attempt,
            textViewer: {},
            imageViewer: {},
            error: null,
        };

        try {
            const page = await waitForFirstWindow(app, 30000);
            await page.waitForLoadState('domcontentloaded');
            await waitForMainBridge(page, 30000);

            await page.evaluate(() => window.chatAPI.setTheme('dark'));

            await page.evaluate(() => window.chatAPI.openTextInNewWindow('Viewer smoke **ok**', 'Viewer Smoke Text', 'dark'));
            await waitForWindowCount(app, 2, 15000);
            const textWindow = getChildWindow(app, page);
            if (!textWindow) {
                throw new Error('Text viewer window did not open.');
            }

            await textWindow.waitForLoadState('domcontentloaded');
            await waitForViewerBridge(textWindow, 15000);
            await textWindow.waitForFunction(
                () => document.getElementById('viewer-title-text')?.textContent?.includes('Viewer Smoke Text'),
                null,
                { timeout: 15000 },
            );
            await page.evaluate(() => window.chatAPI.setTheme('light'));
            await textWindow.waitForFunction(() => document.body.classList.contains('light-theme'), null, { timeout: 15000 });
            result.textViewer.title = await textWindow.locator('#viewer-title-text').textContent();
            await closeViewerWindow(textWindow, app);

            const imagePayload = {
                src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
                title: 'Viewer Smoke Image',
            };
            await page.evaluate((payload) => window.chatAPI.openImageViewer(payload), imagePayload);
            await waitForWindowCount(app, 2, 15000);
            const imageWindow = getChildWindow(app, page);
            if (!imageWindow) {
                throw new Error('Image viewer window did not open.');
            }

            await imageWindow.waitForLoadState('domcontentloaded');
            await waitForViewerBridge(imageWindow, 15000);
            await imageWindow.waitForFunction(
                () => document.getElementById('image-title-text')?.textContent?.includes('Viewer Smoke Image'),
                null,
                { timeout: 15000 },
            );
            await imageWindow.waitForFunction(
                () => {
                    const image = document.getElementById('viewerImage');
                    return Boolean(image?.getAttribute('src')?.startsWith('data:image/png'));
                },
                null,
                { timeout: 15000 },
            );
            await page.evaluate(() => window.chatAPI.setTheme('light'));
            await imageWindow.waitForFunction(() => document.body.classList.contains('light-theme'), null, { timeout: 15000 });
            result.imageViewer.title = await imageWindow.locator('#image-title-text').textContent();
            await closeViewerWindow(imageWindow, app);

            result.passed = true;
            return result;
        } catch (error) {
            result.error = error && error.stack ? error.stack : String(error);
            lastResult = result;
        } finally {
            await app.close();
        }
    }

    return lastResult || {
        passed: false,
        textViewer: {},
        imageViewer: {},
        error: 'Viewer smoke failed before producing a result.',
    };
}

async function runRichRenderingSmoke(dataRoot, config, runStamp) {
    const prepared = await prepareScenarioWorkspace(dataRoot, config, {
        topicName: `富渲染 UI 冒烟-${runStamp}`,
    });
    const historyFilePath = buildHistoryFilePath(dataRoot, prepared.agentId, prepared.topicId);
    const smokeMessage = buildRichRenderingSmokeMessage();
    const baseTimestamp = Date.now();

    await fs.ensureDir(path.dirname(historyFilePath));
    await fs.writeJson(historyFilePath, [
        {
            id: `user_${baseTimestamp}_smoke`,
            role: 'user',
            content: '请展示富渲染 UI 冒烟样例。',
            timestamp: baseTimestamp,
            attachments: [],
        },
        {
            id: `assistant_${baseTimestamp + 1}_smoke`,
            role: 'assistant',
            name: config.tempAgentName,
            agentId: prepared.agentId,
            avatarUrl: '../assets/default_avatar.png',
            avatarColor: null,
            content: smokeMessage,
            timestamp: baseTimestamp + 1,
            isThinking: false,
            topicId: prepared.topicId,
            finishReason: 'stop',
        },
    ], { spaces: 2 });

    let lastResult = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const app = await launchApp(dataRoot);
        const result = {
            passed: false,
            attempt,
            topicId: prepared.topicId,
            topicName: prepared.topicName,
            historyFilePath,
            initial: {},
            afterInteractions: {},
            error: null,
        };

        try {
            const page = await waitForFirstWindow(app, 30000);
            await page.waitForLoadState('domcontentloaded');
            await waitForMainBridge(page, 30000);
            await page.waitForFunction(
                (topicName) => document.getElementById('currentChatTopicName')?.textContent?.includes(topicName),
                prepared.topicName,
                { timeout: 30000 }
            );
            await page.waitForFunction(() => {
                const assistantMessages = document.querySelectorAll('.message-item.assistant .md-content');
                if (assistantMessages.length === 0) return false;
                const lastContent = assistantMessages[assistantMessages.length - 1];
                return Boolean(
                    lastContent.querySelector('.vcp-tool-use-bubble')
                    && lastContent.querySelector('.unistudy-tool-result-bubble')
                    && lastContent.querySelector('.vcp-thought-chain-bubble')
                    && lastContent.querySelector('.unistudy-html-preview-toggle')
                    && lastContent.querySelector('.unistudy-desktop-push-placeholder')
                );
            }, null, { timeout: 30000 });

            result.initial = await page.evaluate(() => {
                const assistantMessages = Array.from(document.querySelectorAll('.message-item.assistant .md-content'));
                const lastContent = assistantMessages[assistantMessages.length - 1];
                const scopedCard = lastContent?.querySelector('.smoke-scoped-card');
                const scopedColor = scopedCard ? window.getComputedStyle(scopedCard).color : null;

                return {
                    toolUseBubble: Boolean(lastContent?.querySelector('.vcp-tool-use-bubble')),
                    toolUseLabel: lastContent?.querySelector('.unistudy-tool-label')?.textContent?.trim() || '',
                    toolResultBubble: Boolean(lastContent?.querySelector('.unistudy-tool-result-bubble')),
                    legacyToolResultBubble: Boolean(lastContent?.querySelector('.vcp-tool-result-bubble')),
                    toolResultImage: Boolean(lastContent?.querySelector('.unistudy-tool-result-image')),
                    toolResultFooter: Boolean(lastContent?.querySelector('.unistudy-tool-result-footer')),
                    thoughtChainBubble: Boolean(lastContent?.querySelector('.vcp-thought-chain-bubble')),
                    thoughtChainHeader: Boolean(lastContent?.querySelector('.unistudy-thought-chain-header')),
                    toggleIconCount: lastContent?.querySelectorAll('.unistudy-result-toggle-icon').length || 0,
                    legacyToggleIconCount: lastContent?.querySelectorAll('.vcp-result-toggle-icon').length || 0,
                    htmlPreviewToggle: Boolean(lastContent?.querySelector('.unistudy-html-preview-toggle')),
                    htmlPreviewFrame: Boolean(lastContent?.querySelector('.unistudy-html-preview-frame')),
                    desktopPushPlaceholder: Boolean(lastContent?.querySelector('.unistudy-desktop-push-placeholder')),
                    scopedStyleCount: document.querySelectorAll('style[data-unistudy-scope-id]').length,
                    scopedCardColor: scopedColor,
                    legacyScopedStyleCount: document.querySelectorAll('style[data-vcp-scope-id]').length,
                    toolResultExpanded: lastContent?.querySelector('.unistudy-tool-result-bubble')?.classList.contains('expanded') || false,
                    thoughtChainExpanded: lastContent?.querySelector('.vcp-thought-chain-bubble')?.classList.contains('expanded') || false,
                };
            });

            const lastAssistant = page.locator('.message-item.assistant').last();
            await lastAssistant.locator('.unistudy-tool-result-header').click();
            await page.waitForFunction(() => {
                const lastMessage = document.querySelectorAll('.message-item.assistant')[document.querySelectorAll('.message-item.assistant').length - 1];
                return lastMessage?.querySelector('.unistudy-tool-result-bubble')?.classList.contains('expanded') === true;
            }, null, { timeout: 10000 });

            await lastAssistant.locator('.unistudy-thought-chain-header').click();
            await page.waitForFunction(() => {
                const lastMessage = document.querySelectorAll('.message-item.assistant')[document.querySelectorAll('.message-item.assistant').length - 1];
                return lastMessage?.querySelector('.vcp-thought-chain-bubble')?.classList.contains('expanded') === true;
            }, null, { timeout: 10000 });

            await lastAssistant.locator('.unistudy-html-preview-toggle').click();
            await page.waitForFunction(() => {
                const lastMessage = document.querySelectorAll('.message-item.assistant')[document.querySelectorAll('.message-item.assistant').length - 1];
                return Boolean(lastMessage?.querySelector('.unistudy-html-preview-frame'));
            }, null, { timeout: 15000 });

            result.afterInteractions = await page.evaluate(() => {
                const assistantMessages = Array.from(document.querySelectorAll('.message-item.assistant .md-content'));
                const lastContent = assistantMessages[assistantMessages.length - 1];
                return {
                    toolResultExpanded: lastContent?.querySelector('.unistudy-tool-result-bubble')?.classList.contains('expanded') || false,
                    thoughtChainExpanded: lastContent?.querySelector('.vcp-thought-chain-bubble')?.classList.contains('expanded') || false,
                    htmlPreviewFrame: Boolean(lastContent?.querySelector('.unistudy-html-preview-frame')),
                    htmlPreviewMode: Boolean(lastContent?.querySelector('.unistudy-html-preview-container.preview-mode')),
                };
            });

            result.passed = Boolean(
                result.initial.toolUseBubble
                && result.initial.toolUseLabel === 'Tool Use:'
                && result.initial.toolResultBubble
                && !result.initial.legacyToolResultBubble
                && result.initial.toolResultImage
                && result.initial.toolResultFooter
                && result.initial.thoughtChainBubble
                && result.initial.thoughtChainHeader
                && result.initial.toggleIconCount >= 2
                && result.initial.legacyToggleIconCount === 0
                && result.initial.htmlPreviewToggle
                && result.initial.desktopPushPlaceholder
                && result.initial.scopedStyleCount >= 1
                && result.initial.legacyScopedStyleCount === 0
                && result.initial.scopedCardColor === 'rgb(0, 128, 0)'
                && result.afterInteractions.toolResultExpanded
                && result.afterInteractions.thoughtChainExpanded
                && result.afterInteractions.htmlPreviewFrame
                && result.afterInteractions.htmlPreviewMode
            );

            return result;
        } catch (error) {
            result.error = error && error.stack ? error.stack : String(error);
            lastResult = result;
        } finally {
            await app.close();
        }
    }

    return lastResult || {
        passed: false,
        topicId: prepared.topicId,
        topicName: prepared.topicName,
        historyFilePath,
        initial: {},
        afterInteractions: {},
        error: 'Rich rendering smoke failed before producing a result.',
    };
}

async function prepareScenarioWorkspace(dataRoot, config, scenario) {
    const app = await launchApp(dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await delay(1500);

        const result = await page.evaluate(async (payload) => {
            const current = await window.chatAPI.loadSettings();
            await window.chatAPI.saveSettings({
                ...current,
                ...payload.settings,
            });

            let agentId = payload.realAgentId || null;
            if (payload.mode === 'temp') {
                const agent = await window.chatAPI.createAgent(payload.agentName, null);
                agentId = agent.agentId;
            } else {
                const configCheck = await window.chatAPI.getAgentConfig(agentId);
                if (!configCheck || configCheck.error) {
                    throw new Error(`目标学科不存在：${agentId}`);
                }
            }

            const topic = await window.chatAPI.createNewTopicForAgent(agentId, payload.topicName, false, true);
            await window.chatAPI.saveSettings({
                ...current,
                ...payload.settings,
                lastOpenItemId: agentId,
                lastOpenItemType: 'agent',
                lastOpenTopicId: topic.topicId,
            });

            return {
                agentId,
                topicId: topic.topicId,
                topicName: topic.topicName || payload.topicName,
            };
        }, {
            mode: config.mode,
            realAgentId: config.realAgentId,
            agentName: config.tempAgentName,
            topicName: scenario.topicName,
            settings: config.settings,
        });

        return result;
    } finally {
        await app.close();
    }
}

async function readTopicState(page, ids) {
    return page.evaluate(async ({ agentId, topicId }) => {
        const topics = await window.chatAPI.getAgentTopics(agentId);
        const topic = Array.isArray(topics) ? topics.find((item) => item.id === topicId) : null;
        const kbId = topic?.knowledgeBaseId || null;
        const documentsResult = kbId
            ? await window.chatAPI.listKnowledgeBaseDocuments(kbId)
            : { items: [] };

        return {
            topic,
            kbId,
            documents: Array.isArray(documentsResult?.items) ? documentsResult.items : [],
        };
    }, ids);
}

async function waitForTopicSource(page, ids, timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const state = await readTopicState(page, ids);
        if (state.kbId) {
            return state;
        }

        await delay(1000);
    }

    return readTopicState(page, ids);
}

async function waitForDocumentsSettled(page, ids, expectedNames, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const state = await readTopicState(page, ids);
        const matches = expectedNames.map((name) => state.documents.find((item) => item.name === name)).filter(Boolean);
        const allFound = matches.length === expectedNames.length;
        const allSettled = allFound && matches.every((item) => !['pending', 'processing'].includes(item.status));

        if (allSettled) {
            return {
                ...state,
                matchedDocuments: matches,
            };
        }

        await delay(1500);
    }

    const state = await readTopicState(page, ids);
    return {
        ...state,
        matchedDocuments: expectedNames.map((name) => state.documents.find((item) => item.name === name)).filter(Boolean),
    };
}

async function getChatSnapshot(page, ids) {
    return page.evaluate(async ({ agentId, topicId }) => {
        const history = await window.chatAPI.getChatHistory(agentId, topicId);
        const assistantMessages = Array.isArray(history)
            ? history.filter((item) => item.role === 'assistant')
            : [];
        const latestAssistant = assistantMessages[assistantMessages.length - 1] || null;
        const domNodes = Array.from(document.querySelectorAll('.message-item.assistant .md-content'));
        const latestAssistantDomText = domNodes.length > 0
            ? domNodes[domNodes.length - 1].textContent.trim()
            : '';

        return {
            historyCount: Array.isArray(history) ? history.length : 0,
            assistantCount: assistantMessages.length,
            latestAssistant: latestAssistant
                ? {
                    id: latestAssistant.id,
                    content: typeof latestAssistant.content === 'string'
                        ? latestAssistant.content
                        : (latestAssistant.content?.text || ''),
                    isThinking: latestAssistant.isThinking === true,
                    finishReason: latestAssistant.finishReason || null,
                    kbContextRefs: Array.isArray(latestAssistant.kbContextRefs)
                        ? latestAssistant.kbContextRefs.map((ref) => ({
                            documentId: ref.documentId || null,
                            documentName: ref.documentName || null,
                            score: ref.score,
                            vectorScore: ref.vectorScore,
                            rerankScore: ref.rerankScore,
                        }))
                        : [],
                }
                : null,
            latestAssistantDomText,
        };
    }, ids);
}

async function waitForNewAssistantResponse(page, ids, baselineAssistantCount, timeoutMs = 90000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const snapshot = await getChatSnapshot(page, ids);
        const latestContent = `${snapshot.latestAssistantDomText || ''}\n${snapshot.latestAssistant?.content || ''}`;
        const hasResolvedText = Boolean(latestContent.trim()) && !/Thinking\.\.\.|^Thinking$/i.test(latestContent.trim());
        const hasNewAssistant = snapshot.assistantCount > baselineAssistantCount;
        const isFinished = Boolean(snapshot.latestAssistant?.finishReason) || Boolean(snapshot.latestAssistant?.content);

        if (hasNewAssistant && hasResolvedText && snapshot.latestAssistant?.isThinking !== true && isFinished) {
            return snapshot;
        }

        await delay(1500);
    }

    return getChatSnapshot(page, ids);
}

function buildQueryAssertion(query, snapshot) {
    const rawText = `${snapshot.latestAssistantDomText || ''}\n${snapshot.latestAssistant?.content || ''}`;
    const normalizedText = normalizeForMatch(rawText);
    const refs = Array.isArray(snapshot.latestAssistant?.kbContextRefs) ? snapshot.latestAssistant.kbContextRefs : [];
    const refNames = refs.map((ref) => ref.documentName).filter(Boolean);
    const matchedDocuments = (query.expectedDocuments || []).filter((name) => refNames.includes(name));

    const anyKeywords = Array.isArray(query.expectedAnyKeywords) ? query.expectedAnyKeywords : [];
    const allKeywords = Array.isArray(query.expectedAllKeywords) ? query.expectedAllKeywords : [];

    const anyKeywordMatched = anyKeywords.length === 0
        ? true
        : anyKeywords.some((keyword) => normalizedText.includes(normalizeForMatch(keyword)));
    const allKeywordsMatched = allKeywords.every((keyword) => normalizedText.includes(normalizeForMatch(keyword)));
    const minRefCount = Number(query.minRefCount || 1);
    const minMatchedDocuments = Number(query.minMatchedDocuments || 1);
    const nonThinkingOk = !/Thinking\.\.\.|^Thinking$/i.test(rawText.trim()) && snapshot.latestAssistant?.isThinking !== true;
    const refCountOk = refs.length >= minRefCount;
    const documentOk = matchedDocuments.length >= minMatchedDocuments;
    const passed = anyKeywordMatched && allKeywordsMatched && nonThinkingOk && refCountOk && documentOk;

    return {
        prompt: query.prompt,
        expectedDocuments: query.expectedDocuments || [],
        expectedAnyKeywords: anyKeywords,
        expectedAllKeywords: allKeywords,
        matchedDocuments,
        referenceDocuments: refNames,
        answerPreview: rawText.trim().slice(0, 500),
        kbRefCount: refs.length,
        keywordOk: anyKeywordMatched && allKeywordsMatched,
        documentOk,
        refCountOk,
        nonThinkingOk,
        passed,
    };
}

async function openSourceDocumentInReader(page, documentName) {
    const readerVisible = await page.evaluate(
        () => !document.getElementById('workspaceReaderPanel')?.classList.contains('hidden'),
    );
    if (readerVisible) {
        await page.locator('#workspaceReaderBackBtn').click({ force: true }).catch(() => {});
        await delay(500);
    }

    const row = page.locator('#topicKnowledgeBaseFiles .kb-document-row').filter({ hasText: documentName }).first();
    await row.waitFor({ state: 'visible', timeout: 30000 });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
        await row.click({ force: true }).catch(() => {});

        const snapshot = await page.evaluate(() => ({
            readerVisible: !document.getElementById('workspaceReaderPanel')?.classList.contains('hidden'),
            documentTitle: document.getElementById('readerDocumentTitle')?.textContent?.trim() || '',
            guideTabActive: document.getElementById('leftReaderGuideTabBtn')?.classList.contains('workspace-reader-tab--active') === true,
        }));

        if (snapshot.readerVisible && snapshot.guideTabActive && snapshot.documentTitle.includes(documentName)) {
            return;
        }

        await delay(500);
    }

    throw new Error(`打开阅读区超时：${documentName}`);
}

async function getGuideSnapshot(page, documentId) {
    return page.evaluate(async (targetDocumentId) => {
        const guide = await window.chatAPI.getKnowledgeBaseDocumentGuide(targetDocumentId).catch((error) => ({
            success: false,
            error: error?.message || String(error),
        }));

        return {
            guide,
            ui: {
                readerVisible: !document.getElementById('workspaceReaderPanel')?.classList.contains('hidden'),
                activeTab: document.getElementById('leftReaderGuideTabBtn')?.classList.contains('workspace-reader-tab--active')
                    ? 'guide'
                    : (document.getElementById('leftReaderContentTabBtn')?.classList.contains('workspace-reader-tab--active') ? 'content' : 'unknown'),
                documentTitle: document.getElementById('readerDocumentTitle')?.textContent?.trim() || '',
                guideStatusBadge: document.getElementById('readerGuideStatusBadge')?.textContent?.trim() || '',
                guidePreviewText: document.getElementById('readerGuideContent')?.textContent?.trim()?.slice(0, 800) || '',
            },
        };
    }, documentId);
}

async function waitForGuideReady(page, documentId, timeoutMs = 180000) {
    await page.evaluate(async (targetDocumentId) => {
        const current = await window.chatAPI.getKnowledgeBaseDocumentGuide(targetDocumentId).catch(() => null);
        if (!current?.success || (!current.guideMarkdown && !['processing', 'pending', 'done'].includes(current.guideStatus))) {
            await window.chatAPI.generateKnowledgeBaseDocumentGuide(targetDocumentId, { forceRefresh: false }).catch(() => null);
        }
    }, documentId);

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const snapshot = await getGuideSnapshot(page, documentId);
        const guideStatus = snapshot?.guide?.guideStatus || 'idle';
        const guideMarkdown = String(snapshot?.guide?.guideMarkdown || '').trim();
        if (guideStatus === 'done' && guideMarkdown) {
            return snapshot;
        }
        if (guideStatus === 'failed') {
            return snapshot;
        }
        await delay(1500);
    }

    return getGuideSnapshot(page, documentId);
}

function buildGuideAssertion(check, primarySnapshot, cachedGuideResult) {
    const guide = primarySnapshot?.guide || {};
    const markdown = String(guide.guideMarkdown || '').trim();
    const normalizedMarkdown = normalizeForMatch(markdown);
    const expectedAnyKeywords = Array.isArray(check.expectedAnyKeywords) ? check.expectedAnyKeywords : [];
    const expectedAllKeywords = Array.isArray(check.expectedAllKeywords) ? check.expectedAllKeywords : [];
    const minLength = Number(check.minLength || 80);

    const anyKeywordMatched = expectedAnyKeywords.length === 0
        ? true
        : expectedAnyKeywords.some((keyword) => normalizedMarkdown.includes(normalizeForMatch(keyword)));
    const allKeywordsMatched = expectedAllKeywords.every((keyword) => normalizedMarkdown.includes(normalizeForMatch(keyword)));
    const contentLengthOk = markdown.length >= minLength;
    const statusOk = guide.success === true && guide.guideStatus === 'done';
    const readerUiOk = primarySnapshot?.ui?.readerVisible === true
        && primarySnapshot?.ui?.activeTab === 'guide'
        && String(primarySnapshot?.ui?.documentTitle || '').includes(check.targetFile);
    const cacheOk = cachedGuideResult?.success === true
        && cachedGuideResult?.guideStatus === 'done'
        && normalizeForMatch(cachedGuideResult?.guideMarkdown || '') === normalizedMarkdown
        && Boolean(cachedGuideResult?.guideGeneratedAt);
    const passed = statusOk && contentLengthOk && anyKeywordMatched && allKeywordsMatched && readerUiOk && cacheOk;

    return {
        targetFile: check.targetFile,
        expectedAnyKeywords,
        expectedAllKeywords,
        guideStatus: guide.guideStatus || null,
        guideError: guide.guideError || null,
        guideGeneratedAt: guide.guideGeneratedAt || null,
        guideContentLength: markdown.length,
        guidePreview: markdown.slice(0, 500),
        uiGuidePreview: primarySnapshot?.ui?.guidePreviewText || '',
        uiGuideStatusBadge: primarySnapshot?.ui?.guideStatusBadge || '',
        keywordOk: anyKeywordMatched && allKeywordsMatched,
        contentLengthOk,
        readerUiOk,
        cacheOk,
        passed,
    };
}

function buildScenarioNoteMarkdown(scenarioSummary = {}) {
    const uploadedDocuments = Array.isArray(scenarioSummary.uploadedDocuments) ? scenarioSummary.uploadedDocuments : [];
    const guideAssertions = Array.isArray(scenarioSummary.guideAssertions) ? scenarioSummary.guideAssertions : [];
    const retrievalAssertions = Array.isArray(scenarioSummary.retrievalAssertions) ? scenarioSummary.retrievalAssertions : [];

    const uploadedLines = uploadedDocuments.length > 0
        ? uploadedDocuments.map((item) => `- ${item.name}: ${item.status} · chunks=${item.chunkCount ?? 0} · 类型=${item.contentType || 'unknown'}`)
        : ['- 无'];

    const guideLines = guideAssertions.length > 0
        ? guideAssertions.map((item) => {
            const keywords = Array.isArray(item.expectedAnyKeywords) ? item.expectedAnyKeywords.join(' / ') : '';
            return [
                `### ${item.targetFile}`,
                `- 状态：${item.guideStatus || 'unknown'}`,
                `- 命中关键词：${keywords || '无要求'}`,
                `- 内容长度：${item.guideContentLength || 0}`,
                `- 缓存复用：${item.cacheOk ? '是' : '否'}`,
                item.guideError ? `- 错误：${item.guideError}` : null,
                item.guidePreview ? `- 摘要预览：${item.guidePreview.replace(/\n+/g, ' ').slice(0, 260)}` : null,
            ].filter(Boolean).join('\n');
        })
        : ['- 本轮未抽检来源指南。'];

    const retrievalLines = retrievalAssertions.length > 0
        ? retrievalAssertions.map((item, index) => [
            `### 问题 ${index + 1}`,
            `- 提问：${item.prompt}`,
            `- 结果：${item.passed ? '通过' : '失败'}`,
            `- 引用来源：${(item.referenceDocuments || []).join('，') || '无'}`,
            `- 回答预览：${String(item.answerPreview || '').replace(/\n+/g, ' ').slice(0, 260)}`,
        ].join('\n'))
        : ['- 本轮没有对话断言。'];

    return [
        `# ${scenarioSummary.label} 测试记录`,
        '',
        `- Topic：${scenarioSummary.topicName}`,
        `- 结果：${scenarioSummary.passed ? '通过' : '未通过'}`,
        `- 历史文件：${scenarioSummary.historyFilePath}`,
        `- 持久化消息数：${scenarioSummary.persistedHistoryCount || 0}`,
        `- 最后一条助手引用数：${scenarioSummary.persistedAssistantKbRefs || 0}`,
        '',
        '## 上传资料',
        ...uploadedLines,
        '',
        '## 来源指南验证',
        ...guideLines,
        '',
        '## 对话检索验证',
        ...retrievalLines,
    ].join('\n');
}

async function saveScenarioSummaryNote(page, scenarioSummary) {
    const payload = {
        title: `${scenarioSummary.label} 测试记录`,
        contentMarkdown: buildScenarioNoteMarkdown(scenarioSummary),
        kind: 'note',
        sourceDocumentRefs: (scenarioSummary.uploadedDocuments || []).map((item) => ({
            documentId: item.id,
            documentName: item.name,
        })),
    };

    return page.evaluate(
        async ({ agentId, topicId, notePayload }) => window.chatAPI.saveTopicNote(agentId, topicId, notePayload),
        {
            agentId: scenarioSummary.agentId,
            topicId: scenarioSummary.topicId,
            notePayload: payload,
        },
    );
}

async function runScenario(dataRoot, config, scenario, globalSummary) {
    const prepared = await prepareScenarioWorkspace(dataRoot, config, scenario);
    const historyFilePath = buildHistoryFilePath(dataRoot, prepared.agentId, prepared.topicId);
    const scenarioSummary = {
        id: scenario.id,
        label: scenario.label,
        agentId: prepared.agentId,
        topicId: prepared.topicId,
        topicName: prepared.topicName,
        historyFilePath,
        uploadedFiles: scenario.files.map((filePath) => basename(filePath)),
        uploadedDocuments: [],
        retrievalAssertions: [],
        guideAssertions: [],
        rendererErrors: [],
    };

    const app = await launchApp(dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        page.on('pageerror', (error) => {
            const message = String(error);
            scenarioSummary.rendererErrors.push(message);
            globalSummary.rendererErrors.push(message);
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const message = msg.text();
                scenarioSummary.rendererErrors.push(message);
                globalSummary.rendererErrors.push(message);
            }
        });

        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await page.waitForFunction(
            (topicName) => document.getElementById('currentChatTopicName')?.textContent?.includes(topicName),
            prepared.topicName,
            { timeout: 30000 }
        );
        await delay(2500);

        const initialSourceState = await waitForTopicSource(page, prepared, 90000);
        scenarioSummary.sourceStatusBefore = await page.locator('#currentTopicKnowledgeBaseStatus').textContent().catch(() => null);
        scenarioSummary.kbId = initialSourceState.kbId || null;

        await page.locator('#hiddenTopicKnowledgeBaseFileInput').setInputFiles(scenario.files);
        await delay(1500);

        const uploadState = await waitForDocumentsSettled(
            page,
            prepared,
            scenario.files.map((filePath) => basename(filePath)),
            scenario.uploadTimeoutMs || 120000
        );

        scenarioSummary.sourceStatusAfter = await page.locator('#currentTopicKnowledgeBaseStatus').textContent().catch(() => null);
        scenarioSummary.kbId = uploadState.kbId || scenarioSummary.kbId;
        scenarioSummary.uploadedDocuments = uploadState.matchedDocuments.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            chunkCount: item.chunkCount,
            contentType: item.contentType,
            attemptCount: item.attemptCount,
            lastError: item.lastError || null,
            completedAt: item.completedAt || null,
        }));
        scenarioSummary.uploadOk = scenarioSummary.uploadedDocuments.length === scenario.files.length
            && scenarioSummary.uploadedDocuments.every((item) => ['done', 'completed'].includes(item.status));

        for (const guideCheck of (scenario.guideChecks || [])) {
            const targetDocument = uploadState.matchedDocuments.find((item) => item.name === guideCheck.targetFile);
            if (!targetDocument) {
                scenarioSummary.guideAssertions.push({
                    targetFile: guideCheck.targetFile,
                    guideStatus: null,
                    guideError: '未找到目标文档，无法执行来源指南验证。',
                    guideGeneratedAt: null,
                    guideContentLength: 0,
                    guidePreview: '',
                    uiGuidePreview: '',
                    uiGuideStatusBadge: '',
                    keywordOk: false,
                    contentLengthOk: false,
                    readerUiOk: false,
                    cacheOk: false,
                    passed: false,
                });
                continue;
            }

            await openSourceDocumentInReader(page, guideCheck.targetFile);
            const guideSnapshot = await waitForGuideReady(page, targetDocument.id, scenario.uploadTimeoutMs || 180000);
            const cachedGuideResult = await page.evaluate(
                async (documentId) => window.chatAPI.generateKnowledgeBaseDocumentGuide(documentId, { forceRefresh: false }).catch((error) => ({
                    success: false,
                    error: error?.message || String(error),
                })),
                targetDocument.id,
            );
            scenarioSummary.guideAssertions.push(buildGuideAssertion(guideCheck, guideSnapshot, cachedGuideResult));
        }

        for (const query of scenario.queries) {
            const baseline = await getChatSnapshot(page, prepared);
            await page.locator('#messageInput').fill(query.prompt);
            await page.locator('#sendMessageBtn').click();
            const snapshot = await waitForNewAssistantResponse(page, prepared, baseline.assistantCount, 120000);
            scenarioSummary.retrievalAssertions.push(buildQueryAssertion(query, snapshot));
        }

        if (await fs.pathExists(historyFilePath)) {
            const persistedHistory = await fs.readJson(historyFilePath);
            const persistedAssistantMessages = Array.isArray(persistedHistory)
                ? persistedHistory.filter((item) => item.role === 'assistant')
                : [];
            const latestAssistant = persistedAssistantMessages[persistedAssistantMessages.length - 1] || null;

            scenarioSummary.persistedHistoryCount = Array.isArray(persistedHistory) ? persistedHistory.length : 0;
            scenarioSummary.persistedAssistantKbRefs = Array.isArray(latestAssistant?.kbContextRefs)
                ? latestAssistant.kbContextRefs.length
                : 0;
            scenarioSummary.persistedLatestAssistantRefDocuments = Array.isArray(latestAssistant?.kbContextRefs)
                ? latestAssistant.kbContextRefs.map((ref) => ref.documentName || ref.documentId).filter(Boolean)
                : [];
            scenarioSummary.persistedLatestAssistantContentLength = typeof latestAssistant?.content === 'string'
                ? latestAssistant.content.length
                : 0;
        } else {
            scenarioSummary.persistedHistoryCount = 0;
            scenarioSummary.persistedAssistantKbRefs = 0;
            scenarioSummary.persistedLatestAssistantRefDocuments = [];
            scenarioSummary.persistedLatestAssistantContentLength = 0;
        }

        const noteSaveResult = await saveScenarioSummaryNote(page, scenarioSummary).catch((error) => ({
            success: false,
            error: error?.message || String(error),
        }));
        scenarioSummary.noteSaved = noteSaveResult?.success === true;
        scenarioSummary.noteId = noteSaveResult?.item?.id || null;
        scenarioSummary.noteTitle = noteSaveResult?.item?.title || `${scenarioSummary.label} 测试记录`;
        scenarioSummary.noteError = noteSaveResult?.success === true ? null : (noteSaveResult?.error || '保存测试记录笔记失败。');

        scenarioSummary.passed = Boolean(
            scenarioSummary.uploadOk
            && scenarioSummary.guideAssertions.length === (scenario.guideChecks || []).length
            && scenarioSummary.guideAssertions.every((item) => item.passed)
            && scenarioSummary.persistedHistoryCount >= (scenario.queries.length * 2)
            && scenarioSummary.persistedAssistantKbRefs > 0
            && scenarioSummary.persistedLatestAssistantContentLength > 0
            && scenarioSummary.retrievalAssertions.length === scenario.queries.length
            && scenarioSummary.retrievalAssertions.every((item) => item.passed)
            && scenarioSummary.noteSaved
            && scenarioSummary.rendererErrors.length === 0
        );

        return scenarioSummary;
    } finally {
        await app.close();
    }
}

async function run() {
    const repoRoot = path.resolve(__dirname, '..');
    const runStamp = formatStamp();
    const mode = readOptionalEnv('UNISTUDY_TEST_MODE', 'temp');
    const realAgentId = readOptionalEnv('UNISTUDY_REAL_AGENT_ID', 'Lite_Real_Test_Nova_1775682726542');
    const fixtureDataRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot }));
    const realDataRoot = mode === 'real-data'
        ? resolveRequiredExternalDataRoot({
            env: process.env,
            envName: 'UNISTUDY_REAL_DATA_ROOT',
            description: 'UniStudy real-data smoke mode',
        })
        : null;
    const dataRoot = mode === 'real-data'
        ? realDataRoot
        : await createTempDataRootFromFixture({
            prefix: 'unistudy-electron-smoke-',
            fixtureRoot: fixtureDataRoot,
        });
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-fixtures-'));
    const viewerSmokeDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-viewer-smoke-'));
    const richRenderingSmokeDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-rich-rendering-smoke-'));
    const reportDir = path.resolve(readOptionalEnv('UNISTUDY_TEST_REPORT_DIR', path.join(repoRoot, 'docs', 'test-reports')));
    await fs.ensureDir(reportDir);
    const reportPath = path.join(reportDir, `unistudy-${mode}-${runStamp}.json`);

    const settingsSeedRoot = mode === 'real-data' ? realDataRoot : fixtureDataRoot;
    const persistedSettings = await readSettingsFile(settingsSeedRoot);
    const resolvedGuideModel = await resolveGuideModel(settingsSeedRoot, persistedSettings, realAgentId);
    const settings = {
        userName: 'SmokeUser',
        vcpServerUrl: readOptionalEnv('VCP_SERVER_URL', persistedSettings.vcpServerUrl || 'http://vcp.uniquest.us.kg/v1/chat/completions'),
        vcpApiKey: readOptionalEnv('VCP_API_KEY', persistedSettings.vcpApiKey || '123456'),
        guideModel: readOptionalEnv('UNISTUDY_GUIDE_MODEL', persistedSettings.guideModel || resolvedGuideModel),
        defaultModel: readOptionalEnv('DEFAULT_MODEL', persistedSettings.defaultModel || resolvedGuideModel),
        lastModel: readOptionalEnv('LAST_MODEL', persistedSettings.lastModel || resolvedGuideModel),
        kbBaseUrl: readOptionalEnv('KB_BASE_URL', persistedSettings.kbBaseUrl || ''),
        kbApiKey: readOptionalEnv('KB_API_KEY', persistedSettings.kbApiKey || ''),
        kbEmbeddingModel: readOptionalEnv('KB_EMBEDDING_MODEL', persistedSettings.kbEmbeddingModel || 'BAAI/bge-m3'),
        kbRerankModel: readOptionalEnv('KB_RERANK_MODEL', persistedSettings.kbRerankModel || 'BAAI/bge-reranker-v2-m3'),
        kbUseRerank: true,
        kbTopK: 6,
        kbCandidateTopK: 20,
        kbScoreThreshold: 0.25,
    };

    const config = {
        mode,
        dataRoot,
        realAgentId,
        tempAgentName: `Smoke 测试学科 ${runStamp}`,
        settings,
    };

    const fixtures = await createFixtureSet(fixtureRoot, repoRoot, runStamp);
    const scenarios = buildScenarios(mode, fixtures, runStamp);
    const summary = {
        repoRoot,
        mode,
        dataRoot,
        fixtureRoot,
        fixtureDataRoot,
        reportPath,
        targetAgentId: mode === 'real-data' ? config.realAgentId : null,
        viewerSmokeDataRoot,
        richRenderingSmokeDataRoot,
        settings: {
            vcpServerUrl: settings.vcpServerUrl,
            kbBaseUrl: settings.kbBaseUrl,
            guideModel: settings.guideModel,
            defaultModel: settings.defaultModel,
            lastModel: settings.lastModel,
            kbEmbeddingModel: settings.kbEmbeddingModel,
            kbRerankModel: settings.kbRerankModel,
        },
        configurationDiagnostics: {
            hasVcpApiKey: Boolean(String(settings.vcpApiKey || '').trim()),
            hasKbApiKey: Boolean(String(settings.kbApiKey || '').trim()),
        },
        rendererErrors: [],
        scenarios: [],
        errors: [],
        startedAt: new Date().toISOString(),
    };

    summary.skips = [];
    summary.viewerSmoke = await runViewerSmoke(viewerSmokeDataRoot);
    if (!summary.viewerSmoke.passed) {
        summary.errors.push(`viewer smoke 失败：${summary.viewerSmoke.error || '未知错误'}`);
    }
    summary.richRenderingSmoke = await runRichRenderingSmoke(richRenderingSmokeDataRoot, config, runStamp);
    if (!summary.richRenderingSmoke.passed) {
        summary.errors.push(`rich rendering smoke 失败：${summary.richRenderingSmoke.error || '未知错误'}`);
    }

    if (!settings.vcpServerUrl || !settings.vcpApiKey) {
        const message = '未提供有效的 VCP_SERVER_URL / VCP_API_KEY，无法完成真实对话测试。';
        if (mode === 'real-data') {
            summary.errors.push(message);
        } else {
            summary.skips.push(message);
        }
    }
    if (!settings.kbBaseUrl || !settings.kbApiKey) {
        const message = '未提供有效的 KB_BASE_URL / KB_API_KEY，无法完成 Source 检索验证。';
        if (mode === 'real-data') {
            summary.errors.push(message);
        } else {
            summary.skips.push(message);
        }
    }

    const hasConversationConfig = Boolean(settings.vcpServerUrl && settings.vcpApiKey);
    const hasKnowledgeBaseConfig = Boolean(settings.kbBaseUrl && settings.kbApiKey);
    const canRunScenarios = hasConversationConfig && hasKnowledgeBaseConfig;

    if (!canRunScenarios && mode !== 'real-data') {
        summary.skips.push('已跳过 UniStudy 主链场景：当前环境仅验证 preload bridge 与 viewer，未提供完整外部服务配置。');
    }

    if (summary.errors.length === 0 && canRunScenarios) {
        for (const scenario of scenarios) {
            try {
                const result = await runScenario(dataRoot, config, scenario, summary);
                summary.scenarios.push(result);
            } catch (error) {
                summary.scenarios.push({
                    id: scenario.id,
                    label: scenario.label,
                    topicName: scenario.topicName,
                    passed: false,
                    error: error && error.stack ? error.stack : String(error),
                });
                summary.errors.push(`${scenario.label} 失败：${error.message || error}`);
            }
        }
    }

    summary.finishedAt = new Date().toISOString();
    summary.success = summary.errors.length === 0
        && summary.viewerSmoke?.passed === true
        && summary.richRenderingSmoke?.passed === true
        && (summary.scenarios.length === 0 || summary.scenarios.every((item) => item.passed));
    await fs.writeJson(reportPath, summary, { spaces: 2 });
    return summary;
}

if (require.main === module) {
    run()
        .then((summary) => {
            console.log(JSON.stringify(summary, null, 2));
            if (!summary.success) {
                process.exitCode = 1;
            }
        })
        .catch((error) => {
            console.error(error && error.stack ? error.stack : error);
            process.exitCode = 1;
        });
}

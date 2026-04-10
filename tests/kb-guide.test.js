const test = require('node:test');
const assert = require('assert/strict');

const {
    buildGuidePrompt,
    buildGuideSegments,
    extractGuideTextFromResponse,
} = require('../src/modules/main/knowledge-base/guideService');

test('extractGuideTextFromResponse handles nested model payloads', () => {
    const text = extractGuideTextFromResponse({
        response: {
            output: [
                {
                    content: [
                        {
                            parts: [
                                { text: '# 文档主题\n内容摘要' },
                            ],
                        },
                    ],
                },
            ],
        },
    });

    assert.equal(text, '# 文档主题\n内容摘要');
});

test('buildGuidePrompt preserves required headings and navigation', () => {
    const prompt = buildGuidePrompt(
        { name: '线性代数讲义', contentType: 'markdown' },
        {
            contentType: 'markdown',
            text: '# 第一章\n向量空间\n\n# 第二章\n线性变换',
        },
    );

    assert.match(prompt, /# 文档主题/);
    assert.match(prompt, /# 章节导航/);
    assert.match(prompt, /线性代数讲义/);
    assert.match(prompt, /第一章/);
});

test('buildGuideSegments groups plain text into paragraph windows', () => {
    const segments = buildGuideSegments({
        text: '第一段\n\n第二段\n\n第三段\n\n第四段\n\n第五段',
    });

    assert.equal(segments.length, 2);
    assert.equal(segments[0].locator, '第 1-4 段');
    assert.equal(segments[1].locator, '第 5 段');
});

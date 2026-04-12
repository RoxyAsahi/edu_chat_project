const test = require('node:test');
const assert = require('assert/strict');

async function loadQuizUtilsModule() {
    return import('../src/modules/renderer/app/quiz/quizUtils.js');
}

test('parseQuizSetFromResponse accepts strict JSON quiz payloads', async () => {
    const { parseQuizSetFromResponse } = await loadQuizUtilsModule();

    const quizSet = parseQuizSetFromResponse(JSON.stringify({
        title: '线性代数测验',
        items: [
            {
                id: 'quiz_1',
                stem: '矩阵的秩表示什么？',
                options: [
                    { id: 'option_a', label: 'A', text: '线性无关行或列的最大数量' },
                    { id: 'option_b', label: 'B', text: '矩阵的行数' },
                    { id: 'option_c', label: 'C', text: '矩阵的列数' },
                    { id: 'option_d', label: 'D', text: '矩阵的迹' },
                ],
                correctOptionId: 'option_a',
                explanation: '秩反映矩阵中线性无关向量的最大个数。',
            },
        ],
    }));

    assert.equal(quizSet.title, '线性代数测验');
    assert.equal(quizSet.items.length, 1);
    assert.equal(quizSet.items[0].correctOptionId, 'option_a');
});

test('parseQuizSetFromMarkdown parses legacy markdown quiz format', async () => {
    const { parseQuizSetFromMarkdown } = await loadQuizUtilsModule();

    const quizSet = parseQuizSetFromMarkdown([
        '# 概率论测验',
        '',
        '#### 1. 独立事件满足什么条件？',
        'A. P(A∩B)=P(A)+P(B)',
        'B. P(A∩B)=P(A)P(B)',
        'C. P(A|B)=0',
        'D. P(A)=P(B)',
        '正确答案：B',
        '解析：独立事件的定义就是联合概率等于边缘概率之积。',
    ].join('\n'));

    assert.equal(quizSet.title, '概率论测验');
    assert.equal(quizSet.items[0].options[1].label, 'B');
    assert.equal(quizSet.items[0].correctOptionId, 'option_b');
});

test('parseQuizSetFromResponse rejects invalid quiz structures', async () => {
    const { parseQuizSetFromResponse } = await loadQuizUtilsModule();

    const quizSet = parseQuizSetFromResponse(JSON.stringify({
        title: '无效测验',
        items: [
            {
                stem: '少了四个选项',
                options: [
                    { id: 'option_a', label: 'A', text: '甲' },
                    { id: 'option_b', label: 'B', text: '乙' },
                ],
                correctOptionId: 'option_a',
                explanation: '这题不完整。',
            },
        ],
    }));

    assert.equal(quizSet, null);
});

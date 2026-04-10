const test = require('node:test');
const assert = require('assert/strict');

const { buildReaderViewFromParsedDocument } = require('../src/modules/main/knowledge-base/readerProjection');

test('buildReaderViewFromParsedDocument converts markdown into indexed paragraphs', () => {
    const view = buildReaderViewFromParsedDocument({
        contentType: 'markdown',
        text: '# 标题\n第一段内容\n\n第二段内容',
    });

    assert.equal(view.type, 'text');
    assert.equal(view.contentType, 'markdown');
    assert.equal(view.paragraphs.length, 2);
    assert.equal(view.paragraphs[0].index, 1);
    assert.equal(view.paragraphs[0].sectionTitle, '# 标题');
});

test('buildReaderViewFromParsedDocument preserves structured pdf view', () => {
    const view = buildReaderViewFromParsedDocument({
        contentType: 'pdf',
        structure: {
            type: 'pdf',
            pages: [{ pageNumber: 1, paragraphs: [] }],
        },
    });

    assert.equal(view.type, 'pdf');
    assert.equal(view.contentType, 'pdf');
    assert.deepEqual(view.pages, [{ pageNumber: 1, paragraphs: [] }]);
});

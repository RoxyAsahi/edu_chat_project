const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadReaderUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/reader/readerUtils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('getReaderLocatorLabel keeps the current page > paragraph > section fallback order', async () => {
    const { getReaderLocatorLabel } = await loadReaderUtilsModule();

    assert.equal(getReaderLocatorLabel({ pageNumber: 7, paragraphIndex: 3, sectionTitle: '导数' }), '第 7 页');
    assert.equal(getReaderLocatorLabel({ paragraphIndex: 12, sectionTitle: '导数' }), '第 12 段');
    assert.equal(getReaderLocatorLabel({ sectionTitle: '导数' }), '导数');
    assert.equal(getReaderLocatorLabel({}), '未定位');
});

test('resolveReaderInitialLocation falls back to the first available locator and switches tabs only when needed', async () => {
    const { resolveReaderInitialLocation } = await loadReaderUtilsModule();

    assert.deepEqual(
        resolveReaderInitialLocation({
            view: {
                type: 'pdf',
                pages: [
                    { pageNumber: 3, paragraphs: [{ index: 11 }] },
                ],
            },
        }),
        {
            activePageNumber: 3,
            activeParagraphIndex: 11,
            activeSectionTitle: null,
            preferredTab: 'guide',
        }
    );

    assert.deepEqual(
        resolveReaderInitialLocation({
            locator: { paragraphIndex: 6, sectionTitle: '极限定义' },
            view: {
                type: 'docx',
                paragraphs: [{ index: 1, sectionTitle: '引言' }],
            },
        }),
        {
            activePageNumber: null,
            activeParagraphIndex: 6,
            activeSectionTitle: '极限定义',
            preferredTab: 'content',
        }
    );
});

test('shouldRefreshReaderGuide only regenerates when guide data is missing or explicitly forced', async () => {
    const { shouldRefreshReaderGuide } = await loadReaderUtilsModule();

    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'done', guideMarkdown: '## ready' }), false);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'idle', guideMarkdown: '' }), true);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'processing', guideMarkdown: '' }), false);
    assert.equal(shouldRefreshReaderGuide({ success: false }, {}), true);
    assert.equal(shouldRefreshReaderGuide({ success: true, guideStatus: 'done', guideMarkdown: 'cached' }, { forceRefresh: true }), true);
});

test('buildReaderSelectionPayload normalizes selection text and preserves location metadata', async () => {
    const { buildReaderSelectionPayload } = await loadReaderUtilsModule();

    assert.deepEqual(
        buildReaderSelectionPayload(
            {
                documentId: 'doc-1',
                documentName: 'lecture.pdf',
                contentType: 'pdf-text',
            },
            {
                selectionText: '  one\n\n two   three  ',
                pageNumber: '4',
                paragraphIndex: '9',
                sectionTitle: '二阶导数',
            }
        ),
        {
            documentId: 'doc-1',
            documentName: 'lecture.pdf',
            contentType: 'pdf-text',
            selectionText: 'one two three',
            snippet: 'one two three',
            pageNumber: 4,
            paragraphIndex: 9,
            sectionTitle: '二阶导数',
        }
    );

    assert.equal(
        buildReaderSelectionPayload({ documentId: null }, { selectionText: 'hello' }),
        null
    );
});

test('getReaderNavigationTarget clamps pdf navigation and returns the next page locator', async () => {
    const { getReaderNavigationTarget } = await loadReaderUtilsModule();

    const readerState = {
        documentId: 'doc-1',
        activePageNumber: 2,
        activeParagraphIndex: 5,
        activeSectionTitle: '第一页',
        view: {
            type: 'pdf',
            pages: [
                { pageNumber: 1, paragraphs: [{ index: 1 }] },
                { pageNumber: 2, paragraphs: [{ index: 5 }] },
                { pageNumber: 3, paragraphs: [{ index: 8 }] },
            ],
        },
    };

    assert.deepEqual(getReaderNavigationTarget(readerState, 1), {
        pageNumber: 3,
        paragraphIndex: 8,
        sectionTitle: '第一页',
    });
    assert.deepEqual(getReaderNavigationTarget(readerState, -10), {
        pageNumber: 1,
        paragraphIndex: 1,
        sectionTitle: '第一页',
    });
});

test('getReaderNavigationTarget advances paragraph readers by paragraph index and section title', async () => {
    const { getReaderNavigationTarget, isReaderSupportedDocument } = await loadReaderUtilsModule();

    const readerState = {
        documentId: 'doc-2',
        activeParagraphIndex: 2,
        view: {
            type: 'docx',
            paragraphs: [
                { index: 1, sectionTitle: '引言' },
                { index: 2, sectionTitle: '引言' },
                { index: 3, sectionTitle: '证明' },
            ],
        },
    };

    assert.deepEqual(getReaderNavigationTarget(readerState, 1), {
        pageNumber: null,
        paragraphIndex: 3,
        sectionTitle: '证明',
    });
    assert.equal(isReaderSupportedDocument({ contentType: 'markdown' }), true);
    assert.equal(isReaderSupportedDocument({ mimeType: 'application/zip' }), false);
});

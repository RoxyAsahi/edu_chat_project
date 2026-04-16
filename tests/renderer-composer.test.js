const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadComposerUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/composer/composerUtils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('attachment helpers normalize stored entries and build transfer payloads', async () => {
    const {
        buildAttachmentTransferPayload,
        normalizeAttachmentList,
        normalizeStoredAttachment,
    } = await loadComposerUtilsModule();

    assert.deepEqual(
        normalizeStoredAttachment({
            originalName: 'chapter.pdf',
            internalPath: 'file:///tmp/chapter.pdf',
            extractedText: 'content',
        }),
        {
            originalName: 'chapter.pdf',
            internalPath: 'file:///tmp/chapter.pdf',
            name: 'chapter.pdf',
            type: 'application/octet-stream',
            src: 'file:///tmp/chapter.pdf',
            extractedText: 'content',
            imageFrames: null,
        }
    );

    assert.equal(
        normalizeAttachmentList([null, { name: 'img', type: 'image/png', src: 'data:image/png;base64,abc' }]).length,
        1
    );

    assert.deepEqual(
        buildAttachmentTransferPayload({
            fileName: '',
            fileType: 'image/jpeg',
            nativePath: 'C:\\tmp\\image.jpg',
            now: 123,
        }),
        {
            name: 'attachment_123_0.jpg',
            path: 'C:\\tmp\\image.jpg',
            type: 'image/jpeg',
        }
    );

    const inlinePayload = buildAttachmentTransferPayload({
        fileName: 'notes.txt',
        fileType: 'text/plain',
        buffer: new Uint8Array([1, 2, 3]),
    });
    assert.equal(inlinePayload.name, 'notes.txt');
    assert.equal(inlinePayload.type, 'text/plain');
    assert.deepEqual(Array.from(inlinePayload.data), [1, 2, 3]);
});

test('selection context helper assembles stable temporary system messages', async () => {
    const { buildSelectionContextTemporaryMessages } = await loadComposerUtilsModule();

    const messages = buildSelectionContextTemporaryMessages(
        [
            {
                documentId: 'doc-1',
                documentName: 'lecture.pdf',
                selectionText: 'important theorem',
            },
            {
                documentId: 'doc-2',
                snippet: 'fallback snippet',
            },
        ],
        (ref) => (ref.documentId === 'doc-1' ? '第 3 页' : '第 2 段')
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /\[1\] lecture\.pdf \| 第 3 页/);
    assert.match(messages[0].content, /\[2\] doc-2 \| 第 2 段/);
    assert.match(messages[0].content, /Use these excerpts when they are relevant/);
});

test('composer availability and send guards preserve interrupt and empty-send behavior', async () => {
    const {
        resolveComposerAvailabilityState,
        resolveComposerSendAction,
    } = await loadComposerUtilsModule();

    assert.deepEqual(
        resolveComposerAvailabilityState({
            hasAgentId: false,
            hasTopicId: false,
            activeRequestId: null,
        }),
        {
            hasTopic: false,
            interrupting: false,
            disableInput: true,
            disableAttachments: true,
            disableEmoticons: true,
            disableQuickNewTopic: true,
            disableSend: true,
            shouldClearDragOver: true,
        }
    );

    assert.deepEqual(
        resolveComposerAvailabilityState({
            hasAgentId: true,
            hasTopicId: true,
            activeRequestId: 'req-1',
        }),
        {
            hasTopic: true,
            interrupting: true,
            disableInput: false,
            disableAttachments: false,
            disableEmoticons: false,
            disableQuickNewTopic: false,
            disableSend: false,
            shouldClearDragOver: false,
        }
    );

    assert.deepEqual(
        resolveComposerSendAction({
            hasAgentId: true,
            hasTopicId: true,
            activeRequestId: 'req-1',
            text: '',
            pendingAttachmentCount: 0,
        }),
        { kind: 'interrupt' }
    );

    assert.deepEqual(
        resolveComposerSendAction({
            hasAgentId: false,
            hasTopicId: false,
            activeRequestId: null,
            text: 'hello',
            pendingAttachmentCount: 0,
        }),
        { kind: 'blocked', reason: 'missing-topic' }
    );

    assert.deepEqual(
        resolveComposerSendAction({
            hasAgentId: true,
            hasTopicId: true,
            activeRequestId: null,
            text: '   ',
            pendingAttachmentCount: 0,
        }),
        { kind: 'noop', reason: 'empty' }
    );

    assert.deepEqual(
        resolveComposerSendAction({
            hasAgentId: true,
            hasTopicId: true,
            activeRequestId: null,
            text: '',
            pendingAttachmentCount: 2,
        }),
        { kind: 'send' }
    );
});

test('knowledge-base query helper includes attachment excerpts with truncation', async () => {
    const { buildKnowledgeBaseQuery } = await loadComposerUtilsModule();

    const query = buildKnowledgeBaseQuery({
        content: 'Summarize this',
        attachments: [
            {
                name: 'chapter.txt',
                extractedText: 'A'.repeat(1400),
            },
        ],
    });

    assert.match(query, /^Summarize this/);
    assert.match(query, /Attachment: chapter\.txt/);
    assert.equal(query.includes('A'.repeat(1201)), false);
});

test('normalizeHistory stabilizes follow-up arrays when loading stored chat history', async () => {
    const { normalizeHistory } = await loadComposerUtilsModule();

    assert.deepEqual(
        normalizeHistory([{
            id: 'assistant-1',
            role: 'assistant',
            content: '回答',
            followUps: [' 再举个例子 ', '', '再举个例子', null, '总结一下', '继续展开', '换个角度'],
        }]),
        [{
            id: 'assistant-1',
            role: 'assistant',
            content: '回答',
            attachments: [],
            favorited: false,
            favoriteAt: null,
            noteRefs: [],
            selectionContextRefs: [],
            toolEvents: [],
            studyMemoryRefs: [],
            followUps: ['再举个例子', '总结一下', '继续展开'],
        }]
    );
});

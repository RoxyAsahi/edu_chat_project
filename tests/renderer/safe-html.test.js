import createDOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';

import { renderMarkdownToSafeHtml, sanitizeHtml } from '../../src/modules/renderer/safeHtml.js';

describe('safeHtml helpers', () => {
    it('removes active content from rendered markdown fragments', () => {
        const purifier = createDOMPurify(window);
        const safeHtml = renderMarkdownToSafeHtml(
            'Guide body',
            {
                parse() {
                    return '<p><strong>Guide</strong></p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="file:///guide.md">good</a>';
                },
            },
            { purifier },
        );

        expect(safeHtml).toContain('<strong>Guide</strong>');
        expect(safeHtml).toContain('file:///guide.md');
        expect(safeHtml).not.toContain('<script');
        expect(safeHtml).not.toContain('onerror');
        expect(safeHtml).not.toContain('javascript:alert(1)');
    });

    it('preserves safe formatting tags for markdown-driven UI blocks', () => {
        const purifier = createDOMPurify(window);
        const safeHtml = renderMarkdownToSafeHtml(
            'Flashcard body',
            {
                parse() {
                    return '<p><strong>Bold</strong> <em>Italic</em> <code>const x = 1;</code></p><ul><li>one</li><li>two</li></ul>';
                },
            },
            { purifier },
        );

        expect(safeHtml).toContain('<strong>Bold</strong>');
        expect(safeHtml).toContain('<em>Italic</em>');
        expect(safeHtml).toContain('<code>const x = 1;</code>');
        expect(safeHtml).toContain('<ul>');
    });

    it('sanitizes raw HTML payloads used by the text viewer', () => {
        const purifier = createDOMPurify(window);
        const safeHtml = sanitizeHtml(
            '<div><h1>Viewer</h1><img src="data:image/png;base64,abc" onerror="alert(1)"><a href="https://example.com">safe</a></div>',
            { purifier },
        );

        expect(safeHtml).toContain('<h1>Viewer</h1>');
        expect(safeHtml).toContain('https://example.com');
        expect(safeHtml).not.toContain('onerror');
    });
});

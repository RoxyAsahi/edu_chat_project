const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadScopedCssModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/scopedCss.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('scopeCss rewrites comma-separated global selectors onto the local scope root', async () => {
    const { scopeCss } = await loadScopedCssModule();

    const scoped = scopeCss('h1, body, :root.theme-dark { color: red; }', 'bubble-1');

    assert.match(scoped, /#bubble-1 h1/);
    assert.match(scoped, /#bubble-1,/);
    assert.match(scoped, /#bubble-1\.theme-dark \{ color: red; \}/);
    assert.doesNotMatch(scoped, /\bbody\b/);
    assert.doesNotMatch(scoped, /:root/);
});

test('scopeCss keeps nested @media and @supports rules scoped recursively', async () => {
    const { scopeCss } = await loadScopedCssModule();

    const scoped = scopeCss(`
        @media screen and (max-width: 600px) {
            h1, body { color: red; }
            @supports selector(:has(*)) {
                body .card { border-color: blue; }
            }
        }
    `, 'bubble-2');

    assert.match(scoped, /@media screen and \(max-width: 600px\)/);
    assert.match(scoped, /#bubble-2 h1/);
    assert.match(scoped, /#bubble-2 \{ color: red; \}/);
    assert.match(scoped, /@supports selector\(:has\(\*\)\)/);
    assert.match(scoped, /#bubble-2 \.card \{ border-color: blue; \}/);
    assert.doesNotMatch(scoped, /\bbody\b/);
});

test('scopeCss drops top-level at-rules with global side effects such as @import', async () => {
    const { scopeCss } = await loadScopedCssModule();

    const scoped = scopeCss(`
        @import url("https://example.com/evil.css");
        @font-face { font-family: leak; src: url(leak.woff2); }
        h1 { color: red; }
    `, 'bubble-3');

    assert.doesNotMatch(scoped, /@import/);
    assert.doesNotMatch(scoped, /@font-face/);
    assert.match(scoped, /#bubble-3 h1 \{ color: red; \}/);
});

test('contentProcessor and text-viewer both depend on the shared scopedCss helper', async () => {
    const contentProcessorSource = await fs.readFile(
        path.resolve(__dirname, '../src/modules/renderer/contentProcessor.js'),
        'utf8',
    );
    const textViewerSource = await fs.readFile(
        path.resolve(__dirname, '../src/modules/renderer/text-viewer.js'),
        'utf8',
    );

    assert.match(contentProcessorSource, /import\s+\{\s*scopeCss\s*\}\s+from\s+'\.\/scopedCss\.js';/);
    assert.match(textViewerSource, /import\s+\{\s*scopeCss\s*\}\s+from\s+'\.\/scopedCss\.js';/);
});

test('messageRenderer delegates extracted chat styles to the shared scopedCss pipeline', async () => {
    const messageRendererSource = await fs.readFile(
        path.resolve(__dirname, '../src/modules/renderer/messageRenderer.js'),
        'utf8',
    );

    assert.match(
        messageRendererSource,
        /const\s+scopedCss\s*=\s*contentProcessor\.scopeCss\(cssContent,\s*scopeId\);/,
    );
    assert.match(
        messageRendererSource,
        /styleElement\.textContent\s*=\s*scopedCss;/,
    );
});

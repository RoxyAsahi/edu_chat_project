const test = require('node:test');
const assert = require('assert/strict');

const {
    buildInterruptEndpoint,
    describeUpstreamCapabilities,
} = require('../src/modules/main/utils/upstreamCapabilities');

test('buildInterruptEndpoint rewrites the endpoint to /v1/interrupt', () => {
    const endpoint = buildInterruptEndpoint('http://example.com/v1/chat/completions');
    assert.equal(endpoint, 'http://example.com/v1/interrupt');
});

test('describeUpstreamCapabilities summarizes chat and knowledge-base endpoints', () => {
    const capabilities = describeUpstreamCapabilities({
        vcpServerUrl: 'http://example.com/v1/chat/completions',
        kbBaseUrl: 'http://kb.example.com/v1',
    });

    assert.equal(capabilities.chat.supported, true);
    assert.equal(capabilities.stream.supported, true);
    assert.equal(capabilities.interrupt.endpoint, 'http://example.com/v1/interrupt');
    assert.equal(capabilities.embeddings.endpoint, 'http://kb.example.com/v1/embeddings');
    assert.equal(capabilities.rerank.endpoint, 'http://kb.example.com/v1/rerank');
    assert.equal(capabilities.guideGeneration.supported, true);
    assert.deepEqual(capabilities.warnings, []);
});

test('describeUpstreamCapabilities records invalid endpoint warnings', () => {
    const capabilities = describeUpstreamCapabilities({
        vcpServerUrl: 'not a url',
        kbBaseUrl: 'still not a url',
    });

    assert.equal(capabilities.chat.supported, false);
    assert.equal(capabilities.embeddings.supported, false);
    assert.equal(capabilities.rerank.supported, false);
    assert.equal(capabilities.warnings.length, 3);
});

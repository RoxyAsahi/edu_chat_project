const test = require('node:test');
const assert = require('assert/strict');

const {
    send,
    buildSuggestedChatEndpoint,
    buildChatEndpointConfigurationError,
} = require('../src/modules/main/vcpClient');

test('buildSuggestedChatEndpoint expands base /v1 paths to the full chat completions endpoint', () => {
    assert.equal(
        buildSuggestedChatEndpoint('http://127.0.0.1:18080/v1'),
        'http://127.0.0.1:18080/v1/chat/completions',
    );
    assert.equal(
        buildSuggestedChatEndpoint('https://example.com/proxy/v1/'),
        'https://example.com/proxy/v1/chat/completions',
    );
    assert.equal(
        buildSuggestedChatEndpoint('https://example.com/v1/chat/completions'),
        null,
    );
});

test('buildChatEndpointConfigurationError returns a targeted hint for incomplete VCP URLs', () => {
    const error = buildChatEndpointConfigurationError('http://127.0.0.1:18080/v1');

    assert.match(error, /VCP Server URL looks incomplete/i);
    assert.match(error, /http:\/\/127\.0\.0\.1:18080\/v1\/chat\/completions/);
    assert.equal(
        buildChatEndpointConfigurationError('http://127.0.0.1:18080/v1/chat/completions'),
        null,
    );
});

test('send short-circuits with a helpful error when the chat endpoint points to a base /v1 path', async () => {
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        throw new Error('fetch should not be called for incomplete endpoints');
    };

    try {
        const result = await send({
            requestId: 'req_incomplete_endpoint',
            endpoint: 'http://127.0.0.1:18080/v1',
            apiKey: 'demo-key',
            messages: [{ role: 'user', content: 'hello' }],
            modelConfig: { stream: false },
        });

        assert.equal(fetchCalled, false);
        assert.match(result.error, /VCP Server URL looks incomplete/i);
        assert.match(result.error, /\/v1\/chat\/completions/);
    } finally {
        global.fetch = originalFetch;
    }
});

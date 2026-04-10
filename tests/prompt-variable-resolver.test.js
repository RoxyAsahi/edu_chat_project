const test = require('node:test');
const assert = require('assert/strict');

const {
    DEFAULT_DIV_RENDER_INSTRUCTION,
    resolvePromptVariables,
    resolvePromptMessageSet,
} = require('../src/modules/main/utils/promptVariableResolver');

test('resolvePromptVariables resolves builtin and derived agent alias tokens', () => {
    const result = resolvePromptVariables('我是{{Nova}}。{{UserName}} 在 {{TopicName}}。', {
        settings: { userName: 'SmokeUser' },
        agentConfig: { name: 'Lite Real Test Nova' },
        context: { topicName: '真实压力测试' },
    });

    assert.equal(result.resolvedPrompt, '我是Nova。SmokeUser 在 真实压力测试。');
    assert.deepEqual(result.unresolvedTokens, []);
    assert.equal(result.substitutions.Nova, 'Nova');
    assert.equal(result.substitutions.UserName, 'SmokeUser');
});

test('resolvePromptVariables keeps unresolved tokens visible and reports them', () => {
    const result = resolvePromptVariables('Hello {{MissingAlias}}', {
        agentConfig: { name: 'Lite Real Test Nova' },
    });

    assert.equal(result.resolvedPrompt, 'Hello {{MissingAlias}}');
    assert.deepEqual(result.unresolvedTokens, ['MissingAlias']);
});

test('resolvePromptVariables resolves VarDivRender locally', () => {
    const result = resolvePromptVariables('Output formatting requirement: {{VarDivRender}}');

    assert.equal(
        result.resolvedPrompt,
        `Output formatting requirement: ${DEFAULT_DIV_RENDER_INSTRUCTION}`
    );
    assert.deepEqual(result.unresolvedTokens, []);
});

test('resolvePromptMessageSet resolves text content inside message arrays', () => {
    const result = resolvePromptMessageSet([{
        role: 'system',
        content: [
            { type: 'text', text: '你好，{{AgentName}}。' },
            { type: 'image_url', image_url: 'https://example.com/demo.png' },
        ],
    }], {
        context: { agentName: 'Nova' },
    });

    assert.equal(result.messages[0].content[0].text, '你好，Nova。');
    assert.equal(result.messages[0].content[1].image_url, 'https://example.com/demo.png');
});

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

test('resolvePromptVariables resolves study profile variables and DailyNoteTool locally', () => {
    const result = resolvePromptVariables('{{StudentName}} @ {{StudyWorkspace}} / {{WorkEnvironment}}\n{{DailyNoteTool}}', {
        settings: {
            userName: 'FallbackUser',
            studyProfile: {
                studentName: 'Alice',
                studyWorkspace: 'Dorm A-301',
                workEnvironment: 'Laptop + Pen Tablet',
            },
        },
        agentConfig: {
            name: 'Hornet_验收',
            vcpAliases: ['Hornet'],
            vcpMaid: '[Hornet]Hornet',
        },
    });

    assert.match(result.resolvedPrompt, /Alice @ Dorm A-301 \/ Laptop \+ Pen Tablet/);
    assert.match(result.resolvedPrompt, /DailyNote/);
    assert.match(result.resolvedPrompt, /<<<\[TOOL_REQUEST\]>>>/);
    assert.match(result.resolvedPrompt, /\[Hornet\]Hornet/);
    assert.deepEqual(result.unresolvedTokens, []);
});

test('resolvePromptVariables suppresses DailyNoteTool when study log loop is disabled', () => {
    const result = resolvePromptVariables('协议：{{DailyNoteTool}}', {
        settings: {
            studyLogPolicy: {
                enabled: false,
                enableDailyNotePromptVariables: true,
            },
        },
    });

    assert.equal(result.resolvedPrompt, '协议：');
    assert.deepEqual(result.unresolvedTokens, []);
});

test('resolvePromptVariables resolves bundled emoticon variables and aliases', () => {
    const result = resolvePromptVariables('{{VarEmoticonPrompt}}\n{{VarEmojiPrompt}}\n{{GeneralEmoticonPath}}', {
        settings: {
            enableEmoticonPrompt: true,
        },
        context: {
            emoticonPromptData: {
                resolvedPrompt: 'Use <img src="/通用表情包/阿巴阿巴.jpg" width="120">.',
                variables: {
                    GeneralEmoticonPath: '/通用表情包',
                    GeneralEmoticonList: '阿巴阿巴.jpg|啊？.jpg',
                    EmoticonPackSummary: '通用表情包 (/通用表情包): 阿巴阿巴.jpg|啊？.jpg',
                },
            },
        },
    });

    assert.match(result.resolvedPrompt, /Use <img src="\/通用表情包\/阿巴阿巴.jpg" width="120">/);
    assert.match(result.resolvedPrompt, /\/通用表情包/);
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

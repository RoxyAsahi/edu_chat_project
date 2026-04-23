const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    cleanupLegacyPromptConfigProfile,
} = require('../src/modules/main/utils/legacyPromptCleanup');

test('cleanupLegacyPromptConfigProfile rewrites configured prompt files, preserves non-target files, and reports unresolved legacy markers', async (t) => {
    const profileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-legacy-prompt-cleanup-'));
    const agentRoot = path.join(profileRoot, 'Agents', 'agent-1');
    const notesRoot = path.join(profileRoot, 'Notes');
    t.after(() => fs.remove(profileRoot));

    await fs.ensureDir(agentRoot);
    await fs.ensureDir(notesRoot);

    const originalSettings = {
        renderingPrompt: 'Format {{VarDivRender}}\n<div id="vcp-root" style="display:grid">\nVCP工具\n[--- VCP元思考链 ---]',
        emoticonPrompt: 'Emoji {{VarEmojiPrompt}}',
        adaptiveBubbleTip: 'Tip {{VarAdaptiveBubbleTip}}',
        dailyNoteGuide: 'Guide {{StudyLogTool}}',
        followUpPromptTemplate: 'Next {{VarUser}}',
        topicTitlePromptTemplate: 'Time {{VarTimeNow}}',
        agentBubbleThemePrompt: 'Theme {{VarRendering}}',
    };
    const originalAgentConfig = {
        id: 'agent-1',
        name: 'Legacy Agent',
        vcpAliases: ['Nova'],
        vcpMaid: '[Nova]tool',
        systemPrompt: 'Hello {{VarUser}} {{VCPThoughtClusterManager}}',
        originalSystemPrompt: 'Daily {{VarDailyNoteGuide}}',
    };
    const originalAgentBackup = {
        id: 'agent-1',
        name: 'Legacy Agent Backup',
        promptAliases: ['KeepMe'],
        toolSignature: '[Keep]tool',
        vcpAliases: ['OldAlias'],
        vcpMaid: '[Old]tool',
        systemPrompt: 'Backup {{DailyNoteTool}}',
        originalSystemPrompt: 'Backup <div id="vcp-root"> VCP工具',
    };
    const untouchedNote = '这是一条 Notes 内容，里面有 VCP 和 Var，但不应该被脚本改动。';

    await fs.writeJson(path.join(profileRoot, 'settings.json'), originalSettings, { spaces: 2 });
    await fs.writeJson(path.join(profileRoot, 'settings.json.backup'), originalSettings, { spaces: 2 });
    await fs.writeJson(path.join(agentRoot, 'config.json'), originalAgentConfig, { spaces: 2 });
    await fs.writeJson(path.join(agentRoot, 'config.json.backup'), originalAgentBackup, { spaces: 2 });
    await fs.writeFile(path.join(notesRoot, 'keep.txt'), untouchedNote, 'utf8');

    const report = await cleanupLegacyPromptConfigProfile(profileRoot, {
        timestamp: '20260423-120000',
    });

    const rewrittenSettings = await fs.readJson(path.join(profileRoot, 'settings.json'));
    const rewrittenSettingsBackup = await fs.readJson(path.join(profileRoot, 'settings.json.backup'));
    const rewrittenAgentConfig = await fs.readJson(path.join(agentRoot, 'config.json'));
    const rewrittenAgentBackup = await fs.readJson(path.join(agentRoot, 'config.json.backup'));
    const untouchedNoteAfter = await fs.readFile(path.join(notesRoot, 'keep.txt'), 'utf8');

    assert.match(rewrittenSettings.renderingPrompt, /{{RenderingGuide}}/);
    assert.match(rewrittenSettings.renderingPrompt, /response-root/);
    assert.match(rewrittenSettings.renderingPrompt, /内建工具/);
    assert.match(rewrittenSettings.renderingPrompt, /模型思考过程/);
    assert.equal(rewrittenSettings.followUpPromptTemplate, 'Next {{UserName}}');
    assert.equal(rewrittenSettings.topicTitlePromptTemplate, 'Time {{CurrentDateTime}}');
    assert.equal(rewrittenSettings.dailyNoteGuide, 'Guide {{DailyNoteGuide}}');
    assert.equal(rewrittenSettings.adaptiveBubbleTip, 'Tip {{AdaptiveBubbleTip}}');
    assert.equal(rewrittenSettings.emoticonPrompt, 'Emoji {{EmoticonGuide}}');
    assert.equal(rewrittenSettings.agentBubbleThemePrompt, 'Theme {{RenderingGuide}}');

    assert.equal(rewrittenSettingsBackup.followUpPromptTemplate, 'Next {{UserName}}');
    assert.equal(rewrittenSettingsBackup.topicTitlePromptTemplate, 'Time {{CurrentDateTime}}');

    assert.deepEqual(rewrittenAgentConfig.promptAliases, ['Nova']);
    assert.equal(rewrittenAgentConfig.toolSignature, '[Nova]tool');
    assert.equal('vcpAliases' in rewrittenAgentConfig, false);
    assert.equal('vcpMaid' in rewrittenAgentConfig, false);
    assert.equal(rewrittenAgentConfig.systemPrompt, 'Hello {{UserName}} {{VCPThoughtClusterManager}}');
    assert.equal(rewrittenAgentConfig.originalSystemPrompt, 'Daily {{DailyNoteGuide}}');

    assert.deepEqual(rewrittenAgentBackup.promptAliases, ['KeepMe']);
    assert.equal(rewrittenAgentBackup.toolSignature, '[Keep]tool');
    assert.equal('vcpAliases' in rewrittenAgentBackup, false);
    assert.equal('vcpMaid' in rewrittenAgentBackup, false);
    assert.equal(rewrittenAgentBackup.systemPrompt, 'Backup {{DailyNoteGuide}}');
    assert.equal(rewrittenAgentBackup.originalSystemPrompt, 'Backup <div id="response-root"> 内建工具');

    assert.equal(untouchedNoteAfter, untouchedNote);

    const backupRoot = path.join(profileRoot, 'backups', 'legacy-prompt-cleanup-20260423-120000');
    const backedUpSettings = await fs.readJson(path.join(backupRoot, 'settings.json'));
    const backedUpAgentConfig = await fs.readJson(path.join(backupRoot, 'Agents', 'agent-1', 'config.json'));
    const reportJson = await fs.readJson(path.join(backupRoot, 'legacy-prompt-cleanup-report.json'));

    assert.equal(report.backupDir, backupRoot.replace(/\\/g, '/'));
    assert.equal(report.reportPath, path.join(backupRoot, 'legacy-prompt-cleanup-report.json').replace(/\\/g, '/'));
    assert.equal(report.modifiedFiles.length, 4);
    assert.deepEqual(backedUpSettings, originalSettings);
    assert.deepEqual(backedUpAgentConfig, originalAgentConfig);
    assert.equal(
        report.remainingLegacyMarkers.some((item) => (
            item.path === 'Agents/agent-1/config.json'
            && item.fields.some((field) => (
                field.field === 'systemPrompt'
                && field.markers.includes('{{VCPThoughtClusterManager}}')
            ))
        )),
        true,
    );
    assert.equal(
        reportJson.remainingLegacyMarkers.some((item) => item.path === 'Agents/agent-1/config.json'),
        true,
    );
});

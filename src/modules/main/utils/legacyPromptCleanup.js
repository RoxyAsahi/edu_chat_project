const fs = require('fs-extra');
const path = require('path');
const { LEGACY_PROMPT_TOKEN_REPLACEMENTS } = require('./promptVariableResolver');

const SETTINGS_PROMPT_FIELDS = Object.freeze([
    'agentBubbleThemePrompt',
    'renderingPrompt',
    'emoticonPrompt',
    'adaptiveBubbleTip',
    'dailyNoteGuide',
    'followUpPromptTemplate',
    'topicTitlePromptTemplate',
]);

const AGENT_PROMPT_FIELDS = Object.freeze([
    'systemPrompt',
    'originalSystemPrompt',
]);

const LEGACY_AGENT_CONFIG_KEYS = Object.freeze([
    'vcpAliases',
    'promptAliases',
    'toolSignature',
    'temperature',
    'contextTokenLimit',
    'maxOutputTokens',
    'thinkingBudget',
    'top_p',
    'top_k',
    'enableThinkingRequest',
    'includeUsageInStream',
]);

const STATIC_PROMPT_REPLACEMENTS = Object.freeze([
    {
        label: 'response-root',
        apply: (input) => input.replace(/<div([^>]*?)\bid=(["'])vcp-root\2/gi, '<div$1id=$2response-root$2'),
    },
    {
        label: 'builtin-tools',
        apply: (input) => input.replace(/VCP工具/g, '内建工具'),
    },
    {
        label: 'reasoning-block-title',
        apply: (input) => input.replace(/\[--- VCP元思考链 ---\]/g, '[--- 模型思考过程 ---]'),
    },
]);

const REMAINING_LEGACY_PATTERNS = Object.freeze([
    /{{\s*(Var[A-Za-z0-9_]+|StudyLogTool|DailyNoteTool|VCP[A-Za-z0-9_]+)\s*}}/g,
    /\[\[\s*VCP元思考[^\]]*\]\]/g,
    /VCP元思维模块/g,
    /VCP元思考/g,
    /{{\s*VCPThoughtClusterManager\s*}}/g,
    /{{\s*VCPSemanticGroupEditor\s*}}/g,
]);

function toPosixPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function buildDefaultProfileRoot() {
    return path.join(process.env.APPDATA || '', 'UniStudy');
}

function buildTimestampString(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function collectTokenReplacementEntries() {
    return Object.entries(LEGACY_PROMPT_TOKEN_REPLACEMENTS).map(([legacyToken, canonicalToken]) => ({
        legacyToken,
        canonicalToken,
        pattern: new RegExp(`{{\\s*${legacyToken}\\s*}}`, 'g'),
    }));
}

function applyPromptStringRewrites(value = '') {
    if (typeof value !== 'string' || value.length === 0) {
        return {
            value,
            replacements: [],
        };
    }

    let nextValue = value;
    const replacements = [];
    const tokenEntries = collectTokenReplacementEntries();

    tokenEntries.forEach(({ legacyToken, canonicalToken, pattern }) => {
        if (!pattern.test(nextValue)) {
            pattern.lastIndex = 0;
            return;
        }
        pattern.lastIndex = 0;
        nextValue = nextValue.replace(pattern, `{{${canonicalToken}}}`);
        replacements.push(`token:${legacyToken}->${canonicalToken}`);
    });

    STATIC_PROMPT_REPLACEMENTS.forEach((entry) => {
        const updated = entry.apply(nextValue);
        if (updated !== nextValue) {
            nextValue = updated;
            replacements.push(`text:${entry.label}`);
        }
    });

    return {
        value: nextValue,
        replacements,
    };
}

function collectRemainingLegacyMarkers(value = '') {
    if (typeof value !== 'string' || value.length === 0) {
        return [];
    }

    const markers = new Set();
    REMAINING_LEGACY_PATTERNS.forEach((pattern) => {
        const matches = value.match(pattern) || [];
        matches.forEach((match) => markers.add(String(match).trim()));
    });
    return [...markers];
}

function dropLegacyAgentConfigKeys(target = {}) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        return {
            nextValue: target,
            changes: [],
        };
    }

    const nextValue = { ...target };
    const changes = [];

    LEGACY_AGENT_CONFIG_KEYS.forEach((legacyKey) => {
        if (!Object.prototype.hasOwnProperty.call(nextValue, legacyKey)) {
            return;
        }

        delete nextValue[legacyKey];
        changes.push(`key:${legacyKey}->removed`);
    });

    return {
        nextValue,
        changes,
    };
}

function rewritePromptFields(target = {}, fieldNames = []) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        return {
            nextValue: target,
            changes: [],
            remainingMarkers: [],
        };
    }

    const nextValue = { ...target };
    const changes = [];
    const remainingMarkers = [];

    fieldNames.forEach((fieldName) => {
        if (!Object.prototype.hasOwnProperty.call(nextValue, fieldName)) {
            return;
        }

        const currentValue = nextValue[fieldName];
        if (typeof currentValue !== 'string') {
            return;
        }

        const rewritten = applyPromptStringRewrites(currentValue);
        if (rewritten.value !== currentValue) {
            nextValue[fieldName] = rewritten.value;
            rewritten.replacements.forEach((replacement) => {
                changes.push(`${fieldName}:${replacement}`);
            });
        }

        const markers = collectRemainingLegacyMarkers(nextValue[fieldName]);
        if (markers.length > 0) {
            remainingMarkers.push({
                field: fieldName,
                markers,
            });
        }
    });

    return {
        nextValue,
        changes,
        remainingMarkers,
    };
}

function buildCandidateFileList(profileRoot) {
    const candidates = [
        path.join(profileRoot, 'settings.json'),
        path.join(profileRoot, 'settings.json.backup'),
    ];

    return fs.readdir(path.join(profileRoot, 'Agents'))
        .then((entries) => entries || [])
        .catch(() => [])
        .then((entries) => {
            entries.forEach((entry) => {
                candidates.push(path.join(profileRoot, 'Agents', entry, 'config.json'));
                candidates.push(path.join(profileRoot, 'Agents', entry, 'config.json.backup'));
            });
            return candidates.filter((filePath, index, list) => list.indexOf(filePath) === index);
        });
}

async function backupCandidateFiles(profileRoot, backupDir, filePaths = []) {
    for (const filePath of filePaths) {
        if (!await fs.pathExists(filePath)) {
            continue;
        }

        const relativePath = path.relative(profileRoot, filePath);
        const targetPath = path.join(backupDir, relativePath);
        await fs.ensureDir(path.dirname(targetPath));
        await fs.copy(filePath, targetPath, { overwrite: true });
    }
}

async function transformJsonFile(filePath, profileRoot) {
    const relativePath = path.relative(profileRoot, filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));

    const isSettingsFile = path.basename(filePath).startsWith('settings.json');
    const keyRenameResult = isSettingsFile
        ? { nextValue: parsed, changes: [] }
        : dropLegacyAgentConfigKeys(parsed);
    const promptRewriteResult = rewritePromptFields(
        keyRenameResult.nextValue,
        isSettingsFile ? SETTINGS_PROMPT_FIELDS : AGENT_PROMPT_FIELDS
    );

    const nextJson = promptRewriteResult.nextValue;
    const changed = JSON.stringify(parsed) !== JSON.stringify(nextJson);
    if (changed) {
        await fs.writeJson(filePath, nextJson, { spaces: 2 });
    }

    return {
        path: toPosixPath(relativePath),
        changed,
        changes: [...keyRenameResult.changes, ...promptRewriteResult.changes],
        remainingMarkers: promptRewriteResult.remainingMarkers,
    };
}

async function cleanupLegacyPromptConfigProfile(profileRoot = buildDefaultProfileRoot(), options = {}) {
    const resolvedProfileRoot = path.resolve(profileRoot);
    if (!await fs.pathExists(resolvedProfileRoot)) {
        throw new Error(`Profile root not found: ${resolvedProfileRoot}`);
    }

    const timestamp = options.timestamp || buildTimestampString(new Date());
    const backupDir = path.join(resolvedProfileRoot, 'backups', `legacy-prompt-cleanup-${timestamp}`);
    const candidateFiles = await buildCandidateFileList(resolvedProfileRoot);

    await fs.ensureDir(backupDir);
    await backupCandidateFiles(resolvedProfileRoot, backupDir, candidateFiles);

    const processedFiles = [];
    for (const filePath of candidateFiles) {
        if (!await fs.pathExists(filePath)) {
            continue;
        }
        processedFiles.push(await transformJsonFile(filePath, resolvedProfileRoot));
    }

    const report = {
        profileRoot: toPosixPath(resolvedProfileRoot),
        backupDir: toPosixPath(backupDir),
        generatedAt: new Date().toISOString(),
        modifiedFiles: processedFiles
            .filter((item) => item.changed)
            .map((item) => ({
                path: item.path,
                changes: item.changes,
            })),
        remainingLegacyMarkers: processedFiles
            .filter((item) => Array.isArray(item.remainingMarkers) && item.remainingMarkers.length > 0)
            .map((item) => ({
                path: item.path,
                fields: item.remainingMarkers,
            })),
    };

    const reportPath = path.join(backupDir, 'legacy-prompt-cleanup-report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return {
        ...report,
        reportPath: toPosixPath(reportPath),
    };
}

module.exports = {
    AGENT_PROMPT_FIELDS,
    LEGACY_AGENT_CONFIG_KEYS,
    REMAINING_LEGACY_PATTERNS,
    SETTINGS_PROMPT_FIELDS,
    STATIC_PROMPT_REPLACEMENTS,
    applyPromptStringRewrites,
    buildDefaultProfileRoot,
    cleanupLegacyPromptConfigProfile,
    collectRemainingLegacyMarkers,
};

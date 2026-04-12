const fs = require('fs/promises');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TARGET_ROOTS = [
    path.join(REPO_ROOT, 'tests'),
    path.join(REPO_ROOT, 'scripts'),
    path.join(REPO_ROOT, 'src', 'preloads', 'runtime'),
];
const SKIPPED_RELATIVE_PATHS = new Set([
    path.join('scripts', 'rename-audit.js'),
]);

const BLOCKED_PATTERNS = [
    { id: 'brand-name-spaced', regex: /VCPChat Lite/g },
    { id: 'brand-name-camel', regex: /VCPChatLite/g },
    { id: 'brand-name-kebab', regex: /vcpchat-lite/g },
    { id: 'legacy-data-root-env', regex: /VCPCHAT_DATA_ROOT/g },
    { id: 'legacy-timeout-env', regex: /VCPCHAT_VCP_TIMEOUT_MS/g },
];

const WHITELIST_RULES = [
    {
        id: 'fixture-log-trace',
        matches(relativePath) {
            return /^tests[\\/]+fixtures[\\/]+runtime-data-root[\\/]+(?:Local Storage|Session Storage)[\\/]+leveldb[\\/]+LOG(?:\.old)?$/i.test(relativePath)
                || /^tests[\\/]+fixtures[\\/]+runtime-data-root[\\/]+(?:Local Storage|Session Storage)[\\/]+LOG(?:\.old)?$/i.test(relativePath);
        },
    },
    {
        id: 'workspace-path-trace',
        matches(_relativePath, line) {
            return line.includes('C:\\VCP\\Eric\\VCPChatLite')
                || line.includes('/C:/VCP/Eric/VCPChatLite');
        },
    },
];

function toRelative(targetPath) {
    return path.relative(REPO_ROOT, targetPath);
}

async function listFiles(rootPath) {
    let entries = [];
    try {
        entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const nested = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            return listFiles(fullPath);
        }
        return [fullPath];
    }));

    return nested.flat();
}

async function readTextFile(filePath) {
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) {
        return null;
    }
    return buffer.toString('utf8');
}

function findWhitelistRule(relativePath, line) {
    return WHITELIST_RULES.find((rule) => rule.matches(relativePath, line)) || null;
}

function collectMatches(relativePath, text) {
    const blockingMatches = [];
    const allowlistedMatches = [];
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
        BLOCKED_PATTERNS.forEach((pattern) => {
            const matches = line.match(pattern.regex);
            if (!matches) {
                return;
            }

            const whitelistRule = findWhitelistRule(relativePath, line);
            const target = whitelistRule ? allowlistedMatches : blockingMatches;
            matches.forEach(() => {
                target.push({
                    path: relativePath,
                    lineNumber: index + 1,
                    pattern: pattern.id,
                    whitelistRule: whitelistRule?.id || null,
                    line: line.trim(),
                });
            });
        });
    });

    return { blockingMatches, allowlistedMatches };
}

async function run() {
    const allFiles = (await Promise.all(TARGET_ROOTS.map((rootPath) => listFiles(rootPath)))).flat();
    const summary = {
        scannedRoots: TARGET_ROOTS.map((rootPath) => toRelative(rootPath)),
        scannedFiles: 0,
        blockingMatches: [],
        allowlistedMatches: [],
    };

    for (const filePath of allFiles) {
        const text = await readTextFile(filePath).catch(() => null);
        if (text === null) {
            continue;
        }

        summary.scannedFiles += 1;
        const relativePath = toRelative(filePath);
        if (SKIPPED_RELATIVE_PATHS.has(relativePath)) {
            summary.scannedFiles -= 1;
            continue;
        }
        const matches = collectMatches(relativePath, text);
        summary.blockingMatches.push(...matches.blockingMatches);
        summary.allowlistedMatches.push(...matches.allowlistedMatches);
    }

    if (summary.blockingMatches.length > 0) {
        console.error('[rename-audit] blocking matches found:');
        summary.blockingMatches.forEach((match) => {
            console.error(`- ${match.path}:${match.lineNumber} [${match.pattern}] ${match.line}`);
        });
        console.error(`[rename-audit] scanned ${summary.scannedFiles} text files across ${summary.scannedRoots.join(', ')}.`);
        process.exitCode = 1;
        return;
    }

    console.log(JSON.stringify({
        success: true,
        scannedRoots: summary.scannedRoots,
        scannedFiles: summary.scannedFiles,
        allowlistedMatches: summary.allowlistedMatches,
    }, null, 2));
}

if (require.main === module) {
    run().catch((error) => {
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
    });
}

module.exports = {
    BLOCKED_PATTERNS,
    TARGET_ROOTS,
    WHITELIST_RULES,
    collectMatches,
};

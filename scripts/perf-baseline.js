const fs = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');

const REPO_ROOT = path.resolve(__dirname, '..');

async function walkFiles(dir, predicate = () => true) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(fullPath, predicate));
        } else if (entry.isFile() && predicate(fullPath)) {
            files.push(fullPath);
        }
    }
    return files;
}

async function summarizeFiles(label, dir, extensions = []) {
    const files = await walkFiles(dir, (filePath) => extensions.includes(path.extname(filePath)));
    const stats = await Promise.all(files.map(async (filePath) => {
        const stat = await fs.stat(filePath);
        return {
            path: path.relative(REPO_ROOT, filePath),
            bytes: stat.size,
        };
    }));
    const totalBytes = stats.reduce((sum, item) => sum + item.bytes, 0);
    return {
        label,
        count: stats.length,
        totalBytes,
        largest: stats
            .sort((left, right) => right.bytes - left.bytes)
            .slice(0, 10),
    };
}

async function summarizeRendererShell() {
    const htmlPath = path.join(REPO_ROOT, 'src', 'renderer', 'index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    const shellDir = path.dirname(htmlPath);

    async function summarizeRefs(kind, refs) {
        const items = [];
        for (const ref of refs) {
            const filePath = path.resolve(shellDir, ref);
            const stat = await fs.stat(filePath).catch(() => null);
            items.push({
                ref,
                bytes: stat ? stat.size : 0,
            });
        }
        return {
            kind,
            count: items.length,
            totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
            items,
        };
    }

    const scriptRefs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
    const stylesheetRefs = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((match) => match[1]);

    return {
        scripts: await summarizeRefs('scripts', scriptRefs),
        stylesheets: await summarizeRefs('stylesheets', stylesheetRefs),
    };
}

function makeMessage(index, contentLength = 900) {
    const content = `Message ${index}\n${'Study notes, formulas, code blocks, and citations. '.repeat(Math.ceil(contentLength / 48)).slice(0, contentLength)}`;
    return {
        id: `msg-${index}`,
        role: index % 2 === 0 ? 'assistant' : 'user',
        content,
        timestamp: Date.now() - index * 1000,
        attachments: [],
    };
}

function timeSync(fn) {
    const startedAt = performance.now();
    const result = fn();
    return {
        elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
        result,
    };
}

function benchmarkHistoryJson() {
    return [100, 500, 1000].map((messageCount) => {
        const messages = Array.from({ length: messageCount }, (_value, index) => makeMessage(index));
        const stringify = timeSync(() => JSON.stringify(messages));
        const parse = timeSync(() => JSON.parse(stringify.result));
        return {
            messageCount,
            jsonBytes: Buffer.byteLength(stringify.result, 'utf8'),
            stringifyMs: stringify.elapsedMs,
            parseMs: parse.elapsedMs,
        };
    });
}

function makeVector(seed, dimensions) {
    const vector = [];
    let value = seed || 1;
    for (let index = 0; index < dimensions; index += 1) {
        value = (value * 48271) % 0x7fffffff;
        vector.push((value % 1000) / 1000);
    }
    return vector;
}

function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index += 1) {
        const left = Number(a[index]) || 0;
        const right = Number(b[index]) || 0;
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

function benchmarkVectorScan() {
    const dimensions = Number(process.env.UNISTUDY_PERF_VECTOR_DIMS || 256);
    const query = makeVector(42, dimensions);
    return [100, 1000, 5000].map((chunkCount) => {
        const rows = Array.from({ length: chunkCount }, (_value, index) => ({
            id: `chunk-${index}`,
            embedding: JSON.stringify(makeVector(index + 1, dimensions)),
        }));
        const scan = timeSync(() => rows
            .map((row) => ({
                id: row.id,
                score: cosineSimilarity(query, JSON.parse(row.embedding)),
            }))
            .sort((left, right) => right.score - left.score)
            .slice(0, 6));
        return {
            chunkCount,
            dimensions,
            scanAndSortMs: scan.elapsedMs,
        };
    });
}

async function main() {
    const [srcJs, srcCss, vendorAssets, rendererShell] = await Promise.all([
        summarizeFiles('src-js', path.join(REPO_ROOT, 'src'), ['.js']),
        summarizeFiles('src-css', path.join(REPO_ROOT, 'src'), ['.css']),
        summarizeFiles('vendor-js-css', path.join(REPO_ROOT, 'vendor'), ['.js', '.css']),
        summarizeRendererShell(),
    ]);

    const report = {
        generatedAt: new Date().toISOString(),
        repoRoot: REPO_ROOT,
        staticFootprint: [srcJs, srcCss, vendorAssets],
        rendererShell,
        syntheticBenchmarks: {
            historyJson: benchmarkHistoryJson(),
            vectorScan: benchmarkVectorScan(),
        },
    };

    console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

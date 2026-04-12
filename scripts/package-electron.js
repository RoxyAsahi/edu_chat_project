const { spawn } = require('child_process');
const path = require('path');

function resolveBuilderCli(projectRoot) {
    return require.resolve('electron-builder/cli.js', {
        paths: [projectRoot],
    });
}

function resolvePlatformArgs(platform = process.platform) {
    if (platform === 'win32') {
        return ['--win'];
    }

    if (platform === 'darwin') {
        return ['--mac'];
    }

    return ['--linux'];
}

function resolveModeArgs(mode, platform = process.platform) {
    if (mode === 'pack') {
        return ['--dir'];
    }

    if (platform === 'win32') {
        return ['nsis', 'portable'];
    }

    return [];
}

async function main() {
    const mode = process.argv[2] === 'pack' ? 'pack' : 'dist';
    const projectRoot = path.resolve(__dirname, '..');
    const builderCli = resolveBuilderCli(projectRoot);
    const args = [
        builderCli,
        ...resolvePlatformArgs(process.platform),
        ...resolveModeArgs(mode, process.platform),
    ];

    const child = spawn(process.execPath, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 0);
    });

    child.on('error', (error) => {
        console.error('[package-electron] Failed to start electron-builder:', error);
        process.exit(1);
    });
}

main().catch((error) => {
    console.error('[package-electron] Packaging failed:', error);
    process.exit(1);
});

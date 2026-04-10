const os = require('os');
const path = require('path');

const packageJson = require('../package.json');
const { resolveLegacyProjectRoot } = require('../src/modules/main/utils/dataRootResolver');
const { migrateLegacyProjectData } = require('./lib/legacy-data-migration');

function resolveDefaultUserDataRoot(appName = packageJson.name) {
    const platform = process.platform;
    const homeDir = os.homedir();

    if (platform === 'win32') {
        const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        return path.join(appData, appName);
    }

    if (platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', appName);
    }

    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    return path.join(xdgConfigHome, appName);
}

async function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const sourceRoot = resolveLegacyProjectRoot(repoRoot);
    if (!sourceRoot) {
        throw new Error(`Legacy project AppData not found under ${repoRoot}`);
    }

    const targetRoot = resolveDefaultUserDataRoot();
    const report = await migrateLegacyProjectData({
        sourceRoot,
        targetRoot,
    });

    console.log(JSON.stringify({
        success: true,
        ...report,
    }, null, 2));
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});

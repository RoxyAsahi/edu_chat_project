const path = require('path');
const {
    buildDefaultProfileRoot,
    cleanupLegacyPromptConfigProfile,
} = require('../src/modules/main/utils/legacyPromptCleanup');

function parseArgs(argv = []) {
    const args = { root: '' };
    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        if (current === '--root') {
            args.root = argv[index + 1] || '';
            index += 1;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const profileRoot = args.root
        ? path.resolve(args.root)
        : buildDefaultProfileRoot();
    const report = await cleanupLegacyPromptConfigProfile(profileRoot);

    console.log(`[legacy-prompt-cleanup] profileRoot: ${report.profileRoot}`);
    console.log(`[legacy-prompt-cleanup] backupDir: ${report.backupDir}`);
    console.log(`[legacy-prompt-cleanup] reportPath: ${report.reportPath}`);
    console.log(`[legacy-prompt-cleanup] modifiedFiles: ${report.modifiedFiles.length}`);
    console.log(`[legacy-prompt-cleanup] remainingLegacyMarkers: ${report.remainingLegacyMarkers.length}`);
}

main().catch((error) => {
    console.error(`[legacy-prompt-cleanup] ${error.message}`);
    process.exitCode = 1;
});

const { buildPreloadBundles } = require('./lib/preload-bundles');

async function main() {
    const results = await buildPreloadBundles();
    console.log(JSON.stringify({
        success: true,
        bundles: results,
    }, null, 2));
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPreloadBundles } = require('./lib/preload-bundles');
const { resolveElectronBinary } = require('./lib/electron-binary');

async function main() {
  const args = process.argv.slice(2);
  const appDirArg = args[0] || '.';
  const appDir = path.resolve(process.cwd(), appDirArg);
  const electronBinary = resolveElectronBinary(appDir);

  await buildPreloadBundles();

  if (!fs.existsSync(electronBinary)) {
    console.error(`[launch-electron] Electron binary not found: ${electronBinary}`);
    process.exit(1);
  }

  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const childArgs = [appDir, ...args.slice(1)];
  const child = spawn(electronBinary, childArgs, {
    cwd: appDir,
    stdio: 'inherit',
    env: childEnv,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('[launch-electron] Failed to start Electron:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('[launch-electron] Failed to prepare Electron launch:', error);
  process.exit(1);
});

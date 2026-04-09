const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveElectronBinary(appDir) {
  const electronPackagePath = require.resolve('electron/package.json', {
    paths: [appDir],
  });
  const electronPackageDir = path.dirname(electronPackagePath);
  const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(electronPackageDir, 'dist', binaryName);
}

function main() {
  const args = process.argv.slice(2);
  const appDirArg = args[0] || '.';
  const appDir = path.resolve(process.cwd(), appDirArg);
  const electronBinary = resolveElectronBinary(appDir);

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

main();

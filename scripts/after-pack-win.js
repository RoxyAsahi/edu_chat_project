const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function afterPackWin(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const productFilename = context.packager.appInfo.productFilename;
  const productName = context.packager.appInfo.productName;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(projectDir, 'build-resources', 'icon.ico');
  const rceditPath = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  for (const requiredPath of [exePath, iconPath, rceditPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing Windows packaging resource: ${requiredPath}`);
    }
  }

  execFileSync(
    rceditPath,
    [
      exePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'FileDescription',
      productName,
      '--set-version-string',
      'ProductName',
      productName,
      '--set-version-string',
      'InternalName',
      productFilename,
      '--set-version-string',
      'OriginalFilename',
      `${productFilename}.exe`,
      '--set-file-version',
      version,
      '--set-product-version',
      version,
    ],
    { stdio: 'inherit' },
  );
};

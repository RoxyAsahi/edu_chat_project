const path = require('path');

function resolveElectronBinaryRelativePath(platform = process.platform) {
    if (platform === 'win32') {
        return 'electron.exe';
    }

    if (platform === 'darwin') {
        return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    }

    return 'electron';
}

function resolveElectronBinary(appDir) {
    const electronPackagePath = require.resolve('electron/package.json', {
        paths: [appDir],
    });
    const electronPackageDir = path.dirname(electronPackagePath);
    return path.join(
        electronPackageDir,
        'dist',
        resolveElectronBinaryRelativePath(process.platform),
    );
}

module.exports = {
    resolveElectronBinary,
    resolveElectronBinaryRelativePath,
};

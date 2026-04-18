#!/bin/sh
set -eu
cd "$(dirname "$0")"

DEFAULT_NPM_REGISTRY="https://registry.npmmirror.com"
DEFAULT_ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
DEFAULT_ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
DEFAULT_NPM_CONFIG_DISTURL="https://npmmirror.com/mirrors/node/"

if ! command -v node >/dev/null 2>&1; then
  echo "[UniStudy] Node.js is not installed. Please install Node.js 20 LTS first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[UniStudy] npm is not installed. Please install Node.js 20 LTS first."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR}" -gt 22 ]; then
  echo "[UniStudy] Warning: Node $(node -v) is newer than recommended. Node 20 LTS is suggested for this project."
fi

export npm_config_registry="${npm_config_registry:-$DEFAULT_NPM_REGISTRY}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-$DEFAULT_ELECTRON_MIRROR}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-$DEFAULT_ELECTRON_BUILDER_BINARIES_MIRROR}"
export npm_config_disturl="${npm_config_disturl:-$DEFAULT_NPM_CONFIG_DISTURL}"

echo "[UniStudy] npm registry: ${npm_config_registry}"
echo "[UniStudy] Electron mirror: ${ELECTRON_MIRROR}"
echo "[UniStudy] Electron Builder binaries mirror: ${ELECTRON_BUILDER_BINARIES_MIRROR}"
echo "[UniStudy] Node disturl mirror: ${npm_config_disturl}"

electron_ready() {
  if [ ! -f node_modules/electron/path.txt ]; then
    return 1
  fi

  case "$(uname -s)" in
    Darwin)
      [ -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ]
      ;;
    Linux)
      [ -x node_modules/electron/dist/electron ]
      ;;
    *)
      [ -f node_modules/electron/path.txt ]
      ;;
  esac
}

install_dependencies() {
  echo "[UniStudy] Installing dependencies..."
  npm install
}

if [ ! -d node_modules ]; then
  install_dependencies
elif ! electron_ready; then
  echo "[UniStudy] Electron install looks incomplete. Reinstalling Electron..."
  rm -rf node_modules/electron
  install_dependencies
fi

echo "[UniStudy] Launching app..."
npm start

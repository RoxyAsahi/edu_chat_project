#!/bin/zsh
set -e
cd "$(dirname "$0")"

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

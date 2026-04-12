@echo off
setlocal
cd /d "%~dp0"

echo [UniStudy] Working directory: %cd%
if defined VCPCHAT_DATA_ROOT (
  echo [UniStudy] Data root override: %VCPCHAT_DATA_ROOT%
) else (
  echo [UniStudy] Data root: Electron userData default
)

if not exist package.json (
  echo [UniStudy] package.json not found.
  pause
  exit /b 1
)

set "NEEDS_INSTALL="
if not exist node_modules (
  set "NEEDS_INSTALL=1"
) else if not exist node_modules\electron\path.txt (
  echo [UniStudy] Electron install looks incomplete. Reinstalling Electron...
  if exist node_modules\electron rmdir /s /q node_modules\electron
  set "NEEDS_INSTALL=1"
) else if not exist node_modules\electron\dist\electron.exe (
  echo [UniStudy] Electron binary is missing. Reinstalling Electron...
  if exist node_modules\electron rmdir /s /q node_modules\electron
  set "NEEDS_INSTALL=1"
)

if defined NEEDS_INSTALL (
  echo [UniStudy] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [UniStudy] npm install failed.
    pause
    exit /b 1
  )
)

echo [UniStudy] Launching app...
call npm start
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo [UniStudy] App exited with code %ERR%.
  pause
)

exit /b %ERR%

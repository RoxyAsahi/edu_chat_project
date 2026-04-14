@echo off
setlocal
cd /d "%~dp0"

for /f "tokens=2 delims=:." %%A in ('chcp') do set "UNISTUDY_ORIGINAL_CP=%%A"
set "UNISTUDY_ORIGINAL_CP=%UNISTUDY_ORIGINAL_CP: =%"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "NPM_CONFIG_UNICODE=true"

echo [UniStudy] Working directory: %cd%
if defined UNISTUDY_DATA_ROOT (
  echo [UniStudy] Data root override: %UNISTUDY_DATA_ROOT%
) else (
  echo [UniStudy] Data root: Electron userData default (UniStudy namespace)
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

if defined UNISTUDY_ORIGINAL_CP (
  chcp %UNISTUDY_ORIGINAL_CP% >nul
)

exit /b %ERR%

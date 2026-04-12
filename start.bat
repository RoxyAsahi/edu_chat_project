@echo off
setlocal
cd /d "%~dp0"

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

if not exist node_modules (
  echo [UniStudy] node_modules not found. Installing dependencies...
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

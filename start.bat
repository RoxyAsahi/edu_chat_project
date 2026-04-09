@echo off
setlocal
cd /d "%~dp0"

echo [VCPChat Lite] Working directory: %cd%
echo [VCPChat Lite] Data root: %cd%\AppData

if not exist package.json (
  echo [VCPChat Lite] package.json not found.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [VCPChat Lite] node_modules not found. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [VCPChat Lite] npm install failed.
    pause
    exit /b 1
  )
)

echo [VCPChat Lite] Launching app...
call npm start
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo [VCPChat Lite] App exited with code %ERR%.
  pause
)

exit /b %ERR%

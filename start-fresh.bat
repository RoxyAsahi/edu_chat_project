@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  for /f %%I in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd_HHmmss')"') do set "UNISTUDY_RUN_ID=%%I"
  set "UNISTUDY_DATA_ROOT=%cd%\.tmp\runtime-data\fresh-%UNISTUDY_RUN_ID%"
) else (
  set "UNISTUDY_DATA_ROOT=%~f1"
)
set "UNISTUDY_SKIP_DEFAULT_SEED="

echo [UniStudy] Fresh launch data root: %UNISTUDY_DATA_ROOT%
call "%~dp0start.bat"
set ERR=%ERRORLEVEL%
endlocal & exit /b %ERR%

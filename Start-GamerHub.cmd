@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-gamerhub.ps1" %*
set "GAMERHUB_EXIT_CODE=%errorlevel%"
if not "%GAMERHUB_EXIT_CODE%"=="0" if /I not "%~1"=="-NoOpen" pause
exit /b %GAMERHUB_EXIT_CODE%

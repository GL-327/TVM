@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-ipa.ps1" %*
exit /b %ERRORLEVEL%

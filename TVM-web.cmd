@echo off
setlocal
set "TVM_WEB_LAUNCHER=%~dp0scripts\launch-web.mjs"
if not exist "%TVM_WEB_LAUNCHER%" set "TVM_WEB_LAUNCHER=%~dp0launch-web.mjs"
if exist "%~dp0bin\node.exe" (
  "%~dp0bin\node.exe" "%TVM_WEB_LAUNCHER%" %*
) else (
  node "%TVM_WEB_LAUNCHER%" %*
)
if errorlevel 1 (
  echo Install Node.js 22 or newer and extract the whole TVM package.
  pause
  exit /b 1
)

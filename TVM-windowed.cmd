@echo off
rem A window rather than fullscreen, for a laptop.
rem Works from a git checkout (scripts\) and from the desktop package (root).
title TVM
cd /d "%~dp0"
set "TVM_LAUNCHER=%~dp0scripts\launch-tvm.ps1"
if not exist "%TVM_LAUNCHER%" set "TVM_LAUNCHER=%~dp0launch-tvm.ps1"
if not exist "%TVM_LAUNCHER%" (
  echo launch-tvm.ps1 is missing next to this file.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TVM_LAUNCHER%" -Windowed
if errorlevel 1 (
  echo.
  echo TVM failed to start.
  pause
)

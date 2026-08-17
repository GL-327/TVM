@echo off
title TVM
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\launch-tvm.ps1" -Windowed
if errorlevel 1 (
  echo.
  echo TVM failed to start.
  pause
)

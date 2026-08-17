@echo off
title TVM
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-tvm.ps1"
if errorlevel 1 (
  echo.
  echo TVM failed to start.
  pause
)

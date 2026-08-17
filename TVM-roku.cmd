@echo off
title TVM Roku
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\roku-dev.ps1" %*
if errorlevel 1 (
  echo.
  echo TVM Roku helper failed.
  pause
)

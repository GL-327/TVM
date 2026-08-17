@echo off
title TVM — copy to Desktop
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\copy-to-desktop.ps1"
if errorlevel 1 (
  echo.
  echo Could not copy TVM to your Desktop.
  pause
  exit /b 1
)
echo.
echo TVM (laptop window) and TVM Roku are on your Desktop.
pause

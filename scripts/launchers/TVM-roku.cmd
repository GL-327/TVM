@echo off
title TVM Roku
set "TVM_ROKU_LAUNCHER=%~dp0..\roku-dev.ps1"
if not exist "%TVM_ROKU_LAUNCHER%" set "TVM_ROKU_LAUNCHER=%~dp0roku-dev.ps1"
if not exist "%TVM_ROKU_LAUNCHER%" set "TVM_ROKU_LAUNCHER=%~dp0scripts\roku-dev.ps1"
if not exist "%TVM_ROKU_LAUNCHER%" (
  echo roku-dev.ps1 is missing.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TVM_ROKU_LAUNCHER%" %*
if errorlevel 1 (
  echo.
  echo TVM Roku helper failed.
  pause
)

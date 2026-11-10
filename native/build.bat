@echo off
rem Build and test this checkout using an installed Windows C++ toolchain.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %errorlevel%

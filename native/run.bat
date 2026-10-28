@echo off
rem Starts TVM from the build made by build.bat.
if not exist "%~dp0build\tvm.exe" (
  echo tvm.exe is not built yet. Run build.bat first.
  exit /b 1
)
start "" "%~dp0build\tvm.exe"

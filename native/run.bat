@echo off
rem Starts TVM from the build made by build.bat.
if exist "%~dp0build\tvm.exe" (
  start "" "%~dp0build\tvm.exe" %*
  exit /b 0
)
if exist "%~dp0build\Release\tvm.exe" (
  start "" "%~dp0build\Release\tvm.exe" %*
  exit /b 0
)
echo tvm.exe is not built yet. Run native\build.bat first.
exit /b 1

@echo off
rem Windows C++ desktop client. Web, phone and Roku still use their own clients.
call "%~dp0native\run.bat" %*
if errorlevel 1 pause

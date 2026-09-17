@echo off
rem Runs the pretend IPTV panel. Add --check to prove the proxy against a running Core.
title TVM IPTV tester
cd /d "%~dp0.."
node "apps\core\src\Server Side Live\tester\cli.ts" %*
if errorlevel 1 pause

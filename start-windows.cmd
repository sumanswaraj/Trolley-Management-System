@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 or later from https://nodejs.org, then run this file again.
 pause
 exit /b 1
)
node scripts\start-local.mjs %*
set "trolley_exit=%errorlevel%"
pause
exit /b %trolley_exit%

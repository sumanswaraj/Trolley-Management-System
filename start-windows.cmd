@echo off
cd /d "%~dp0"
if not exist .env (
 echo Copy .env.example to .env and set ADMIN_PASSWORD first.
 pause
 exit /b 1
)
node --env-file=.env server.mjs
pause

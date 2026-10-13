@echo off
cd /d "%~dp0"
if not exist .env (
 echo Copy .env.example to .env and set ADMIN_PASSWORD first.
 pause
 exit /b 1
)
if not exist node_modules\jsqr (
 call npm ci --omit=dev --ignore-scripts
 if errorlevel 1 exit /b 1
)
node --env-file=.env server.mjs
pause

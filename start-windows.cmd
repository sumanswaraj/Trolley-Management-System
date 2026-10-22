@echo off
setlocal
cd /d "%~dp0"
node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)" >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 or later, then open this launcher again.
 pause
 exit /b 1
)
if not exist .env (
 echo Copy .env.example to .env and set ADMIN_PASSWORD first.
 pause
 exit /b 1
)
set "trolley_install=0"
for %%D in (jsqr qrcode exceljs pdfkit) do if not exist "node_modules\%%D\package.json" set "trolley_install=1"
if "%trolley_install%"=="1" (
 call npm ci --omit=dev --ignore-scripts
 if errorlevel 1 exit /b 1
)
node --env-file=.env server.mjs
set "trolley_exit=%errorlevel%"
pause
exit /b %trolley_exit%

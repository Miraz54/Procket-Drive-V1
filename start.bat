@echo off
title Pocket Drive Server
echo =======================================
echo    Starting Pocket Drive Server...
echo =======================================
cd /d "%~dp0"
start http://localhost:3000
timeout /t 2 /nobreak >nul
npm start
pause
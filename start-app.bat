@echo off
title File Transfer Fast - Starting...
echo ========================================================
echo        File Transfer Fast - Local Engine
echo ========================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo Starting local engine on ports 8001 (HTTP) and 8443 (HTTPS)...
start /b "" node server.js

:: Wait a brief moment for server to bind
timeout /t 2 /nobreak >nul

echo Opening File Transfer UI in your default browser...
start http://localhost:8001/devices-ui

echo.
echo ========================================================
echo Engine is running! You can minimize this window.
echo To stop the engine, close this window or run stop-app.bat
echo ========================================================
echo.
pause

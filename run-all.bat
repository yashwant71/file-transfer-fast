@echo off
title File Transfer Fast - Starting Live & Local Services...
echo ===================================================================
echo     ⚡ FILE TRANSFER FAST - COMPLETE SYSTEM LAUNCHER
echo ===================================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: 2. Run Bundling for Device UI and Downloads
echo [1/3] Bundling Device UI and distribution packages...
node bundle.js
if %errorlevel% neq 0 (
    echo [WARNING] Bundling had an issue, continuing with startup...
)

:: 3. Start Live Wrapper Site (Port 3000)
echo [2/3] Starting Live Wrapper Site on http://localhost:3000...
start /b "Live-Wrapper" cmd /c "cd live-site && node server.js"

:: Wait 1 second for live site to listen
timeout /t 1 /nobreak >nul

:: 4. Start Local Engine (Port 8001) linked to Live Wrapper
echo [3/3] Starting Local Transfer Engine on port 8001...
set LIVE_WRAPPER_URL=http://localhost:3000
start /b "Local-Engine" cmd /c "node server.js"

:: Wait 2 seconds for server boot and announcement
timeout /t 2 /nobreak >nul

:: 5. Open browser
echo.
echo ===================================================================
echo  ✅ ALL SERVICES RUNNING & CONNECTED!
echo ===================================================================
echo   🌐 Live Wrapper Lobby:  http://localhost:3000
echo   📱 Local Device UI:     http://localhost:8001/devices-ui
echo ===================================================================
echo.
echo Opening Live Wrapper in your browser...
start http://localhost:3000

echo.
echo Keep this window open while using the app.
echo To stop all services, run stop-app.bat
echo.
pause

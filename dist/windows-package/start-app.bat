@echo off
cd /d "%~dp0"
title File Transfer Fast - Live Engine Logs
echo ========================================================
echo        File Transfer Fast - Local Engine
echo ========================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Starting local engine on ports 8001 (HTTP) and 8443 (HTTPS)...
echo Logs will appear live below. Press Ctrl+C or close this window to stop.
echo.

:: Automatically open browser once port 8001 is ready
start "" powershell -NoProfile -Command "$w = 0; while ($w -lt 20) { try { $r = Invoke-WebRequest -Uri 'http://localhost:8001/devices-ui' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 250; $w++ } }; Start-Process 'http://localhost:8001/devices-ui'"

:: Run Node directly in foreground so all logs are visible live in this window
node "%~dp0server.js"

echo.
echo Engine stopped.
pause

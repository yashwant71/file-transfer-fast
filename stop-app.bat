@echo off
title File Transfer Fast - Stopping...
echo Stopping File Transfer Fast engine...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8001 "') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8443 "') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>nul
)
echo All services stopped.
timeout /t 2 /nobreak >nul

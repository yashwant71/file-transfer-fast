#!/usr/bin/env bash
echo "======================================================="
echo "     File Transfer Fast - Local Engine (Mac / Linux)  "
echo "======================================================="

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed! Please install Node.js from https://nodejs.org"
    exit 1
fi

echo "Starting local engine on ports 8001 (HTTP) and 8443 (HTTPS)..."
node server.js &
SERVER_PID=$!
echo $SERVER_PID > .server.pid

sleep 1
echo "Opening browser..."
if command -v open &> /dev/null; then
    open "http://localhost:8001/devices-ui"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8001/devices-ui"
else
    echo "Open http://localhost:8001/devices-ui in your browser."
fi

echo "Server running. To stop, run ./stop-app.sh"

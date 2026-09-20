#!/usr/bin/env bash
echo "Stopping File Transfer Fast engine..."
if [ -f .server.pid ]; then
    kill $(cat .server.pid) 2>/dev/null
    rm .server.pid
fi
pkill -f "node server.js" 2>/dev/null
echo "Engine stopped."

# File Transfer Tool

A secure HTTPS file transfer tool that lets you send files/folders from any device to your PC over the local network. Features smart dedup (skips files already on server), folder browsing, and a changeable save destination.

## Quick Start

```bash
cd file-transfer
npm install
node server.js
```

The server starts on:
- **HTTPS:** `https://192.168.137.1:8443` (recommended)
- **HTTP:** `http://192.168.137.1:8001` (fallback)

Open the HTTPS URL on any device on the same network. Accept the self-signed certificate warning on first visit.

**Status dashboard:** `https://192.168.137.1:8443/status`

## Usage

### Browser (any device)
1. Open the HTTPS URL on your phone/laptop
2. Tap **Change** to pick a save destination (browse all drives)
3. Drop files or tap **Browse Folder** / **Select Files**
4. Files upload with progress, speed display, and smart skip for duplicates

### CLI sender (same network)
```bash
node send.js http://192.168.137.1:8001 D:\my-folder
```
Scans the folder, diffs against the server, and sends only missing files.

## Features

- **Drag & drop** files or entire folders
- **Browse folders** on the sender device (uses FileSystem Access API or webkitdirectory fallback)
- **Change save destination** - browse all drives, pick any folder, or set a new root
- **Smart dedup** - skips files already on server (by name + size)
- **Folder-level skip** - detects whole folders that match by size and file count
- **Progress tracking** - per-file and overall progress, speed display
- **Retry failed** - retries any files that failed during transfer
- **Log tabs** - filter by All / Saved / Skipped / Failed with byte summaries
- **Self-signed HTTPS** - secure over local network, auto-generated certificate
- **No dependencies** - just Node.js (selfsigned is the only npm package)

## Configuration

Edit the top of `server.js`:

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PORT` | `8001` | HTTP fallback port |
| `HTTPS_PORT` | `8443` | HTTPS port (recommended) |
| `HOST_IP` | `192.168.137.1` | Server bind IP / certificate CN |
| `saveDir` | `D:\art` | Initial save directory (changeable at runtime) |

## File Structure

```
file-transfer/
  server.js      - Main server (HTTPS + HTTP + all endpoints)
  send.js        - CLI sender script
  check.js       - Check if server is running
  findfix.js     - Find and fix port conflicts
  fix.js         - Fix common issues
  live.js        - Live reload dev helper
  .cert/         - Auto-generated TLS certificates (gitignored)
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Sender UI (main page) |
| GET | `/status` | Receiver status dashboard |
| GET | `/log-events?since=N` | Fetch log events since index N |
| GET | `/stats` | Get saved/skipped/failed counts |
| GET | `/failed` | List failed files |
| GET | `/drives` | List system drives (for dest browser) |
| GET | `/dest-root` | Get current save directory |
| GET | `/dir-tree?path=X` | List subfolders in saveDir/X |
| GET | `/dir-tree?abs=X` | List subfolders at absolute path X |
| POST | `/upload?name=X&size=N` | Upload a file |
| POST | `/diff` | Diff check (which files are missing) |
| POST | `/set-dest` | Change save directory at runtime |
| POST | `/check` | Check if a single file exists |
| POST | `/check-folder` | Check if a folder exists on server |

## Requirements

- Node.js 14+
- Network connectivity between sender device and PC

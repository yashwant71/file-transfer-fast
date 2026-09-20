// live-site/server.js — Standalone Live Wrapper & Discovery Lobby
// Zero-dependency native Node.js HTTP server for cloud deployment

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DOWNLOADS_DIR = path.join(PUBLIC_DIR, 'downloads');

// In-memory host registry: PIN -> Host Record and PublicIP -> PIN
const hostsByPin = new Map();
const pinByPublicIp = new Map();

// Generate a random 4-digit PIN (1000 - 9999)
function generatePin() {
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (hostsByPin.has(pin));
  return pin;
}

// Clean IP address helper
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Prune stale hosts older than 15 minutes
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [pin, host] of hostsByPin.entries()) {
    if (now - host.lastSeen > 15 * 60 * 1000) {
      hostsByPin.delete(pin);
      if (pinByPublicIp.get(host.publicIp) === pin) {
        pinByPublicIp.delete(host.publicIp);
      }
    }
  }
}, 60 * 1000);
if (pruneTimer.unref) pruneTimer.unref();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive'
};

const handleRequest = (req, res) => {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;
  const clientIp = getClientIp(req);

  // Set CORS headers for API endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Routes ---

  // Health check
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeHosts: hostsByPin.size, uptime: process.uptime() }));
    return;
  }

  // Local engine announces itself to the Live Wrapper
  if (req.method === 'POST' && pathname === '/api/announce') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const pin = data.pin && hostsByPin.has(data.pin) ? data.pin : generatePin();
        const hostRecord = {
          pin,
          publicIp: clientIp,
          hostIp: data.hostIp || '127.0.0.1',
          allIps: Array.isArray(data.allIps) ? data.allIps : [{ address: data.hostIp, name: 'Wi-Fi' }],
          httpPort: data.httpPort || 8001,
          httpsPort: data.httpsPort || 8443,
          deviceName: data.deviceName || 'Host PC',
          lastSeen: Date.now()
        };

        hostsByPin.set(pin, hostRecord);
        pinByPublicIp.set(clientIp, pin);

        console.log(`[ANNOUNCE] Host registered: PIN ${pin} for IP ${hostRecord.hostIp}:${hostRecord.httpPort} (Public: ${clientIp})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          pin,
          publicIp: clientIp,
          expiresInMinutes: 15
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
      }
    });
    return;
  }

  // Mobile / Visitor checks for active host (via PIN or auto-matched public IP)
  if (req.method === 'GET' && pathname === '/api/active-host') {
    const pin = parsedUrl.searchParams.get('pin');
    let host = null;

    if (pin && hostsByPin.has(pin)) {
      host = hostsByPin.get(pin);
    } else if (!pin && pinByPublicIp.has(clientIp)) {
      const matchedPin = pinByPublicIp.get(clientIp);
      host = hostsByPin.get(matchedPin);
    }

    if (host) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        found: true,
        pin: host.pin,
        hostIp: host.hostIp,
        allIps: host.allIps,
        httpPort: host.httpPort,
        httpsPort: host.httpsPort,
        deviceName: host.deviceName,
        lastSeen: host.lastSeen
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ found: false, clientIp }));
    }
    return;
  }

  // APK Download endpoint
  if (req.method === 'GET' && pathname === '/api/download-apk') {
    const apkFile = path.join(DOWNLOADS_DIR, 'file-transfer.apk');
    if (fs.existsSync(apkFile)) {
      const stat = fs.statSync(apkFile);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="file-transfer.apk"'
      });
      fs.createReadStream(apkFile).pipe(res);
      return;
    } else {
      // If APK file isn't physically placed in downloads yet, give clear guidance
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Download Mobile APK</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; text-align: center; }
    .card { max-width: 480px; margin: 2rem auto; background: #1e293b; padding: 2rem; border-radius: 16px; border: 1px solid #334155; }
    h2 { color: #38bdf8; margin-top: 0; }
    p { color: #94a3b8; line-height: 1.6; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Mobile App Setup</h2>
    <p>Place your <code>file-transfer.apk</code> inside the <code>live-site/public/downloads/</code> directory to enable direct 1-click downloads.</p>
    <p>Until then, you can use the web client directly by connecting to your local Wi-Fi IP!</p>
    <a href="/" class="btn">Back to Transfer Lobby</a>
  </div>
</body>
</html>`);
      return;
    }
  }

  // Windows Desktop Package Download
  if (req.method === 'GET' && pathname === '/api/download-windows') {
    const winZip = path.join(DOWNLOADS_DIR, 'file-transfer-windows.zip');
    if (fs.existsSync(winZip)) {
      const stat = fs.statSync(winZip);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="file-transfer-windows.zip"'
      });
      fs.createReadStream(winZip).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Windows package not built yet. Run "node bundle.js" to create it.');
      return;
    }
  }

  // Mobile Web Package Download
  if (req.method === 'GET' && pathname === '/api/download-web') {
    const webZip = path.join(DOWNLOADS_DIR, 'file-transfer-web.zip');
    if (fs.existsSync(webZip)) {
      const stat = fs.statSync(webZip);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="file-transfer-web.zip"'
      });
      fs.createReadStream(webZip).pipe(res);
      return;
    }
  }

  // --- Static Files Serving ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routing
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexFile).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
};

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[LIVE-SITE] Live Wrapper server listening on http://0.0.0.0:${PORT}`);
    console.log(`[LIVE-SITE] Public directory: ${PUBLIC_DIR}`);
  });
}

module.exports = handleRequest;

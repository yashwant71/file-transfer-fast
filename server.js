const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = 8001;
const HTTPS_PORT = 8443;
const HOST_IP = '192.168.137.1';
let saveDir = 'D:\\art';
const CERT_DIR = path.join(__dirname, '.cert');
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

// Performance: increase UV threadpool for concurrent file I/O
process.env.UV_THREADPOOL_SIZE = '16';

// Generate or load self-signed certificate (async API in newer selfsigned)
async function getTlsOptions() {
  const certFile = path.join(CERT_DIR, 'cert.pem');
  const keyFile = path.join(CERT_DIR, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    console.log('[HTTPS] Using cached certificate');
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }
  console.log('[HTTPS] Generating self-signed certificate (one time)...');
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: HOST_IP }];
  const pems = await selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: HOST_IP }, { type: 7, ip: '127.0.0.1' }] }]
  });
  // newer selfsigned uses cert/private, older uses cert/private - check both
  const certPem = pems.cert || pems.certificate;
  const keyPem = pems.private || pems.privateKey || pems.key;
  fs.writeFileSync(certFile, certPem);
  fs.writeFileSync(keyFile, keyPem);
  console.log('[HTTPS] Certificate generated and cached');
  return { cert: certPem, key: keyPem };
}

let logEvents = [];
const MAX_LOG = 2000;
let failedFiles = [];
let stats = { saved: 0, skipped: 0, failed: 0, savedBytes: 0, skippedBytes: 0, failedBytes: 0 };

function addLog(msg, type = 'info', size = 0, dedupKey = '') {
  const entry = { time: new Date().toLocaleTimeString(), msg, type, size, dedupKey };
  logEvents.push(entry);
  if (logEvents.length > MAX_LOG) logEvents.shift();
  // Use setImmediate to avoid blocking the event loop during transfers
  setImmediate(() => console.log(`[${entry.time}] ${msg}`));
}

function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function getFolderSize(dirPath) {
  let total = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dirPath, item.name);
      if (item.isDirectory()) total += getFolderSize(full);
      else total += fs.statSync(full).size;
    }
  } catch(e) {}
  return total;
}

function getFolderFileCount(dirPath) {
  let count = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dirPath, item.name);
      if (item.isDirectory()) count += getFolderFileCount(full);
      else count++;
    }
  } catch(e) {}
  return count;
}

function getFolderFileHash(dirPath) {
  const names = [];
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        names.push(...getFolderFileHash(full));
      } else {
        const stat = fs.statSync(full);
        names.push(item.name + ':' + stat.size);
      }
    }
  } catch(e) {}
  return names;
}

const senderHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Send to PC</title>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; padding: 1rem; }
    .center { display: flex; justify-content: center; }
    .card { background: #16213e; padding: 1.5rem; border-radius: 16px; width: 100%; max-width: 700px; box-shadow: 0 8px 32px rgba(0,0,0,.4); }
    h2 { margin-bottom: .25rem; }
    .sub { color: #888; font-size: .85rem; margin-bottom: 1rem; }
    .drop-zone { border: 2px dashed #444; border-radius: 12px; padding: 1.5rem; text-align: center; cursor: pointer; transition: .2s; }
    .drop-zone.dragover { border-color: #4fc3f7; background: rgba(79,195,247,.1); }
    .drop-zone input { display: none; }
    .drop-zone p { color: #aaa; font-size: .9rem; }
    .top-bar { display: flex; gap: .5rem; align-items: center; margin-top: 1rem; }
    .top-bar .btn { flex: 1; background: #4fc3f7; color: #111; border: none; padding: .6rem 1rem; border-radius: 8px; font-size: .95rem; cursor: pointer; font-weight: 600; }
    .top-bar .btn:disabled { opacity: .4; cursor: not-allowed; }
    .progress-wrap { margin-top: 1rem; display: none; }
    .progress-wrap.active { display: block; }
    .bar-bg { background: #333; border-radius: 8px; overflow: hidden; height: 22px; width: 100%; }
    .bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4fc3f7, #00e676); transition: width .2s; border-radius: 8px; }
    .info-row { display: flex; justify-content: space-between; margin-top: .3rem; font-size: .82rem; color: #aaa; }
    .status { margin-top: .5rem; text-align: center; font-size: .9rem; min-height: 1.5rem; }
    .file-info { margin-top: .5rem; font-size: .78rem; color: #aaa; }
    .logs-section { margin-top: 1rem; border-top: 1px solid #333; padding-top: .5rem; }
    .log-tabs { display: flex; gap: 2px; margin-bottom: .3rem; }
    .log-tab { padding: .3rem .7rem; border-radius: 6px 6px 0 0; font-size: .8rem; cursor: pointer; border: none; color: #aaa; background: #222; }
    .log-tab.active { color: #fff; }
    .log-tab.saved.active { background: #064; }
    .log-tab.skip.active { background: #660; }
    .log-tab.error.active { background: #600; }
    .log-tab.all.active { background: #333; }
    .log-panel { display: none; max-height: 250px; overflow-y: auto; background: #111; border-radius: 0 0 8px 8px; padding: .4rem; font-family: monospace; font-size: .75rem; }
    .log-panel.active { display: block; }
    .log-panel div { padding: 2px 4px; border-bottom: 1px solid #1a1a1a; line-height: 1.4; }
    .log-panel .time { color: #555; margin-right: .3rem; }
    .log-panel .saved { color: #0f0; }
    .log-panel .skip { color: #ff0; }
    .log-panel .error { color: #f33; }
    .log-panel .info { color: #0cf; }
    .log-panel .folder-skip { color: #fb0; font-weight: 600; }
    .log-panel .indent { color: #888; }
    .summary-bar { display: none; background: #0a1628; border: 1px solid #1a3a5c; border-radius: 6px; padding: .5rem .8rem; margin-bottom: .3rem; font-size: .8rem; color: #8ab4f8; }
    .summary-bar.active { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
    .summary-bar .item { display: flex; align-items: center; gap: .3rem; }
    .summary-bar .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .summary-bar .dot.green { background: #0f0; }
    .summary-bar .dot.yellow { background: #ff0; }
    .summary-bar .dot.red { background: #f33; }
    .failed-wrap { margin-top: 1rem; display: none; background: #2a1515; border: 1px solid #f33; border-radius: 8px; padding: .8rem; }
    .failed-wrap.active { display: block; }
    .failed-wrap h3 { color: #f33; font-size: .9rem; margin-bottom: .4rem; }
    .retry-btn { background: #f33; color: #fff; border: none; padding: .5rem 1.5rem; border-radius: 8px; font-size: .9rem; cursor: pointer; font-weight: 600; margin-top: .5rem; }
    .retry-btn:disabled { opacity: .4; cursor: not-allowed; }
    .fb-panel { display:none; margin-bottom:.5rem; background:#0a1628; border:1px solid #1a3a5c; border-radius:8px; overflow:hidden; }
    .fb-panel.active { display:block; }
    .fb-breadcrumb { display:flex; align-items:center; gap:.2rem; flex-wrap:wrap; padding:.5rem .6rem; background:#0d1f3c; border-bottom:1px solid #1a3a5c; font-size:.8rem; }
    .fb-crumb { cursor:pointer; color:#4fc3f7; padding:2px 6px; border-radius:4px; }
    .fb-crumb:active { background:#1a3a5c; }
    .fb-sep { color:#555; font-size:.7rem; }
    .fb-list { max-height:250px; overflow-y:auto; padding:.3rem; }
    .fb-folder { padding:.55rem .7rem; cursor:pointer; border-radius:6px; font-size:.85rem; color:#ccc; display:flex; align-items:center; gap:.5rem; }
    .fb-folder:active { background:#1a3a5c; }
    .fb-empty { color:#666; font-size:.8rem; padding:.5rem .7rem; }
    .fb-bar { display:flex; gap:.4rem; padding:.4rem .5rem; border-top:1px solid #1a3a5c; background:#0d1f3c; }
    .fb-use-btn { flex:1; background:#1a5c3a; color:#4eff8a; border:none; padding:.5rem; border-radius:6px; font-size:.85rem; cursor:pointer; font-weight:600; }
    .fb-use-btn:active { background:#0f4a2e; }
    .fb-cancel-btn { background:#333; color:#aaa; border:none; padding:.5rem .8rem; border-radius:6px; font-size:.85rem; cursor:pointer; }

    .skip-panel { margin-bottom:.5rem; background:#0a1628; border:1px solid #1a3a5c; border-radius:8px; overflow:hidden; }
    .skip-panel-head { display:flex; align-items:center; justify-content:space-between; padding:.45rem .7rem; cursor:pointer; }
    .skip-panel-head span { font-size:.85rem; color:#8ab4f8; }
    .skip-tags { display:flex; flex-wrap:wrap; gap:.3rem; padding:0 .7rem .5rem; }
    .skip-tag { display:inline-flex; align-items:center; gap:.3rem; background:#1a3a5c; color:#ccc; padding:.2rem .5rem; border-radius:12px; font-size:.75rem; }
    .skip-tag .x { cursor:pointer; color:#f66; font-weight:700; margin-left:.1rem; }
    .skip-tag .x:hover { color:#f33; }
    .skip-add { display:flex; gap:.3rem; padding:0 .7rem .5rem; }
    .skip-add input { flex:1; background:#111; border:1px solid #333; color:#ccc; padding:.3rem .5rem; border-radius:6px; font-size:.8rem; }
    .skip-add button { background:#1a3a5c; color:#8ab4f8; border:none; padding:.3rem .7rem; border-radius:6px; font-size:.8rem; cursor:pointer; font-weight:600; }
    .stop-btn { background:#f33; color:#fff; border:none; padding:.6rem 1rem; border-radius:8px; font-size:.95rem; cursor:pointer; font-weight:600; }
    .stop-btn:disabled { opacity:.4; cursor:not-allowed; }
    .resend-btn { background:#ff9800; color:#111; border:none; padding:.6rem 1rem; border-radius:8px; font-size:.95rem; cursor:pointer; font-weight:600; }
    .resend-btn:disabled { opacity:.4; cursor:not-allowed; }
  </style>
</head>
<body>
<div class="center">
<div class="card">
  <h2>Send to this PC</h2>
  <div class="sub" id="saveToLabel">Saves to D:\\art &bull; smart folder skip</div>
  <div class="skip-panel" id="skipPanel">
    <div class="skip-panel-head" id="skipPanelHead">
      <span>⚙️ Skip Folders</span>
      <span style="font-size:.75rem;color:#666" id="skipCount"></span>
    </div>
    <div id="skipPanelBody" style="display:none">
      <div class="skip-tags" id="skipTags"></div>
      <div class="skip-add">
        <input type="text" id="skipInput" placeholder="folder name (e.g. dist)">
        <button id="skipAddBtn">+ Add</button>
      </div>
    </div>
  </div>

  <!-- Destination row -->
  <div style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center;background:#0a1628;border:1px solid #1a3a5c;border-radius:8px;padding:.5rem .7rem">
    <span style="font-size:.85rem;color:#8ab4f8;flex:0 0 auto">\ud83d\udce5 Save to:</span>
    <span id="destLabel" style="flex:1;font-size:.85rem;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">D:\\art (root)</span>
    <button id="destBrowseBtn" style="background:#1a3a5c;color:#8ab4f8;border:none;padding:.35rem .75rem;border-radius:6px;font-size:.8rem;cursor:pointer;font-weight:600;white-space:nowrap">\ud83d\udcc1 Change</button>
  </div>
  <!-- Destination browser panel (server-side folder tree) -->
  <div class="fb-panel" id="destBrowser">
    <div style="padding:.5rem .6rem;background:#0d1f3c;border-bottom:1px solid #1a3a5c;font-size:.85rem;color:#4fc3f7;font-weight:600;display:flex;justify-content:space-between;align-items:center">
      <span>📥 Pick Save Destination</span>
      <span style="font-size:.75rem;color:#888;font-weight:normal">tap folder to go deeper</span>
    </div>
    <div class="fb-breadcrumb" id="dbBreadcrumb"></div>
    <div class="fb-list" id="dbList"><div class="fb-empty">Loading...</div></div>
    <div class="fb-bar">
      <button class="fb-use-btn" id="dbUseBtn">📍 Use this folder</button>
      <button id="dbRootBtn" style="background:#3a1a5c;color:#c084fc;border:none;padding:.5rem .8rem;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600;white-space:nowrap">⬆️ Set as Root</button>
      <button class="fb-cancel-btn" id="dbCancelBtn">Cancel</button>
    </div>
  </div>
  <div class="drop-zone" id="dropZone" style="border: 2px dashed #444; border-radius: 12px; padding: 1.5rem; text-align: center; cursor: default;">
    <p style="margin-bottom: 0.8rem; color: #aaa;">Drag & drop files/folders here</p>
    <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.8rem;">— OR —</p>
    <div style="display: flex; gap: 0.8rem; justify-content: center;">
      <button type="button" class="btn" id="selectFolderBtn" style="background: #1a3a5c; color: #8ab4f8; font-size: 0.85rem; padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600;">📂 Browse Folder</button>
      <button type="button" class="btn" id="selectFilesBtn" style="background: #1a3a5c; color: #8ab4f8; font-size: 0.85rem; padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600;">Select Files</button>
    </div>
    <input type="file" id="folderInput" webkitdirectory multiple style="opacity: 0; position: absolute; width: 0; height: 0; z-index: -1;">
    <input type="file" id="fileInput" multiple style="opacity: 0; position: absolute; width: 0; height: 0; z-index: -1;">
  </div>
  <div id="subfolderList" style="display:none;margin:.5rem 0;max-height:200px;overflow-y:auto;background:#0a1628;border:1px solid #1a3a5c;border-radius:8px;padding:.5rem"></div>
  <div class="top-bar">
    <button class="btn" id="sendBtn" disabled>Send</button>
    <button class="btn" id="stopBtn" style="display:none;background:#f33;color:#fff">Stop</button>
    <button class="btn" id="resendBtn" style="display:none;background:#ff9800;color:#111">Resend All</button>
  </div>
  <div class="file-info" id="fileInfo"></div>
  <div class="progress-wrap" id="progressWrap">
    <div class="bar-bg"><div class="bar-fill" id="barFill"></div></div>
    <div class="info-row">
      <span id="pctText">0%</span>
      <span id="countText">0 / 0</span>
      <span id="speedText">0 MB/s</span>
    </div>
    <div class="status" id="statusText"></div>
  </div>

  <div class="failed-wrap" id="failedWrap">
    <h3 id="failedTitle">Failed Files</h3>
    <button class="retry-btn" id="retryBtn">Retry Failed</button>
  </div>

  <div class="logs-section">
    <div class="log-tabs">
      <button class="log-tab all active" data-tab="all">All</button>
      <button class="log-tab saved" data-tab="saved">Saved <span id="savedCount">0</span></button>
      <button class="log-tab skip" data-tab="skip">Skipped <span id="skipCount">0</span></button>
      <button class="log-tab error" data-tab="error">Failed <span id="failCount">0</span></button>
    </div>
    <div class="summary-bar" id="summaryBar"></div>
    <div class="log-panel active" id="logPanel">
      <div style="color:#666">Waiting for transfers...</div>
    </div>
  </div>
</div>
</div>

<script>
__CLIENT_JS__
</script>
</body>
</html>`;

// Inject client.js into senderHtml at startup (avoids template literal escaping issues)
const clientJs = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
const senderHtmlFinal = senderHtml.replace('__CLIENT_JS__', clientJs);

const statusHtml = `<!DOCTYPE html>
<html>
<head><title>Receiver Status</title><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #111; color: #ddd; padding: 1rem; }
  h2 { color: #fff; margin-bottom: .3rem; }
  .summary { color: #0f0; font-size: .9rem; margin-bottom: .3rem; }
  .failed-header { color: #f33; font-size: .85rem; margin-bottom: .3rem; }
  .log { border: 1px solid #333; padding: .5rem; height: 80vh; overflow-y: auto; }
  .entry { padding: 2px 0; border-bottom: 1px solid #1a1a1a; }
  .entry .time { color: #666; }
  .entry.saved { color: #0f0; }
  .entry.skip { color: #ff0; }
  .entry.error { color: #f33; }
  .entry.info { color: #0cf; }
</style></head>
<body>
  <h2>Receiver Log</h2>
  <div class="summary" id="summary">0 saved, 0 skipped, 0 failed</div>
  <div class="bytes" id="bytesInfo" style="color:#aaa;font-size:.85rem;margin-bottom:.3rem"></div>
  <div class="failed-header" id="failedHeader"></div>
  <div class="log" id="log"></div>
  <script>
    let last = 0;
    setInterval(async () => {
      try {
        const r = await fetch('/log-events?since=' + last);
        const data = await r.json();
        if (data.length) {
          const logDiv = document.getElementById('log');
          data.forEach(e => {
            const d = document.createElement('div');
            d.className = 'entry ' + (e.type || 'info');
            d.innerHTML = '<span class="time">[' + e.time + ']</span> ' + e.msg;
            logDiv.appendChild(d);
            last = e.id;
          });
          logDiv.scrollTop = logDiv.scrollHeight;
        }
        const s = await fetch('/stats');
        const sm = await s.json();
        document.getElementById('summary').textContent = sm.saved + ' saved, ' + sm.skipped + ' skipped, ' + sm.failed + ' failed';
        function fmtGB(b) {
          if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
          if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
          return b + ' B';
        }
        document.getElementById('bytesInfo').textContent =
          fmtGB(sm.savedBytes) + ' saved \u2022 ' + fmtGB(sm.skippedBytes) + ' skipped \u2022 ' + fmtGB(sm.failedBytes) + ' failed';
        const f = await fetch('/failed');
        const fl = await f.json();
        document.getElementById('failedHeader').textContent = fl.length ? 'Failed: ' + fl.map(x => x.file).join(', ') : '';
      } catch(e) {}
    }, 1000);
  </script>
</body></html>`;

const requestHandler = (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET') {
    if (pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(statusHtml); return;
    }
    if (pathname === '/log-events') {
      const since = parseInt(url.searchParams.get('since') || '0');
      const evts = logEvents.filter((_, i) => i + 1 > since).map((e, i) => ({ ...e, id: since + i + 1 }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(evts)); return;
    }
    if (pathname === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats)); return;
    }
    if (pathname === '/failed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(failedFiles)); return;
    }
    if (pathname === '/diff') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ready' })); return;
    }
    if (pathname === '/drives') {
      try {
        const { execSync } = require('child_process');
        const out = execSync('wmic logicaldisk get DeviceID,VolumeName,FreeSpace,Size /format:csv', { encoding: 'utf8', timeout: 5000 });
        const lines = out.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
        const drives = lines.map(l => {
          const parts = l.trim().split(',');
          if (parts.length < 5) return null;
          return { letter: parts[1], name: parts[2] || '', free: parseInt(parts[3]) || 0, total: parseInt(parts[4]) || 0 };
        }).filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(drives));
      } catch(e) {
        // fallback: try common drives
        const drives = [];
        for (const d of ['C','D','E','F','G']) {
          try { if (fs.existsSync(d + ':\\')) drives.push({ letter: d + ':', name: '', free: 0, total: 0 }); } catch(e2) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(drives));
      }
      return;
    }
    if (pathname === '/dest-root') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ root: saveDir })); return;
    }
    if (pathname === '/dir-tree') {
      const absPath = url.searchParams.get('abs');
      let fullPath;
      if (absPath) {
        fullPath = absPath.split('/').join('\\');
        if (/^[A-Za-z]:$/.test(fullPath)) fullPath += '\\';
      } else {
        const subpath = url.searchParams.get('path') || '';
        fullPath = path.join(saveDir, subpath);
      }
      try {
        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const dirs = items.filter(i => i.isDirectory() && !i.name.startsWith('.')).map(i => i.name).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(dirs));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }
    if (pathname === '/source-tree') {
      const absPath = url.searchParams.get('abs');
      let fullPath;
      if (absPath) {
        fullPath = absPath.split('/').join('\\');
        if (/^[A-Za-z]:$/.test(fullPath)) fullPath += '\\';
      } else {
        fullPath = saveDir;
      }
      try {
        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const dirs = items.filter(i => i.isDirectory() && !i.name.startsWith('.')).map(i => ({ name: i.name, type: 'dir' }));
        const files = items.filter(i => i.isFile()).map(i => {
          const stat = fs.statSync(path.join(fullPath, i.name));
          return { name: i.name, type: 'file', size: stat.size };
        });
        dirs.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        files.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ path: fullPath, dirs, files }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: fullPath, dirs: [], files: [] }));
      }
      return;
    }
    if (pathname === '/read-server-file') {
      const absPath = url.searchParams.get('abs');
      if (!absPath) {
        res.writeHead(400); res.end('Missing abs param'); return;
      }
      const fullPath = absPath.split('/').join('\\');
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) { res.writeHead(400); res.end('Not a file'); return; }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': 'attachment; filename="' + path.basename(fullPath) + '"'
        });
        fs.createReadStream(fullPath).pipe(res);
      } catch(e) {
        res.writeHead(404); res.end('File not found');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
    res.end(senderHtmlFinal); return;
  }

  if (req.method === 'POST' && pathname === '/set-dest') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { root } = JSON.parse(body);
        if (!root || typeof root !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const resolved = path.resolve(root);
        if (!fs.existsSync(resolved)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path does not exist' }));
          return;
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not a directory' }));
          return;
        }
        saveDir = resolved;
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
        addLog('DEST CHANGED: ' + saveDir, 'info');
        console.log('[DEST] Changed to: ' + saveDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ root: saveDir }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/diff') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const files = JSON.parse(body);
        const missing = [];
        let existCount = 0, missingCount = 0;

        async function checkFile(f) {
          const savePath = path.join(saveDir, f.name.replace(/\//g, '\\'));
          try {
            const stat = await fs.promises.stat(savePath);
            if (stat.size === f.size) { existCount++; return; }
          } catch(e) {}
          missingCount++;
          missing.push(f);
        }

        // Check files in batches of 200 to avoid blocking
        for (let i = 0; i < files.length; i += 200) {
          const batch = files.slice(i, i + 200);
          await Promise.all(batch.map(checkFile));
        }

        console.log('[DIFF] checked=' + files.length + ' exist=' + existCount + ' missing=' + missingCount);
        addLog('DIFF: ' + existCount + ' exist, ' + missingCount + ' missing (' + fmtBytes(missing.reduce((s,f) => s + f.size, 0)) + ' to send)', 'info');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ missing, existCount, missingCount, missingSize: missing.reduce((s,f) => s + f.size, 0) }));
      } catch(e) {
        console.log('[DIFF] ERROR: ' + e.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ missing: [], existCount: 0, missingCount: 0, missingSize: 0 }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/check-folder') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const tree = JSON.parse(body);
        const skippedFolders = [];

        function checkRecursive(clientNode, serverBasePath, depth, fullPath) {
          const serverFolderPath = path.join(serverBasePath, clientNode.name);
          if (!fs.existsSync(serverFolderPath)) {
            return;
          }

          const serverSize = getFolderSize(serverFolderPath);
          const serverCount = getFolderFileCount(serverFolderPath);
          const sizeMatch = Math.abs(serverSize - clientNode.totalSize) < 10;
          const countMatch = serverCount === clientNode.fileCount;

          if (sizeMatch && countMatch) {
            const indent = '  '.repeat(depth);
            const dedupKey = 'folder:' + fullPath.replace(/\\/g, '/');
            addLog(indent + 'SKIP: ' + fullPath + '/ (' + clientNode.fileCount + ' files, ' + fmtBytes(serverSize) + ')', 'skip', serverSize, dedupKey);
            stats.skipped += clientNode.fileCount;
            stats.skippedBytes += serverSize;
            skippedFolders.push({ path: fullPath.replace(/\\/g, '/'), files: clientNode.fileCount, size: serverSize, depth });
            return;
          }

          if (clientNode.children) {
            for (const child of clientNode.children) {
              checkRecursive(child, serverFolderPath, depth + 1, fullPath + '/' + child.name);
            }
          }
        }

        if (tree.children) {
          for (const child of tree.children) {
            checkRecursive(child, saveDir, 0, child.name);
          }
        }

        const totalSkippedFiles = skippedFolders.reduce((s, f) => s + f.files, 0);
        const totalSkippedSize = skippedFolders.reduce((s, f) => s + f.size, 0);

        if (skippedFolders.length > 0) {
          addLog('--- Skipped ' + totalSkippedFiles + ' files (' + fmtBytes(totalSkippedSize) + ') in ' + skippedFolders.length + ' folders ---', 'skip', totalSkippedSize, 'folder-summary');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ skippedFolders, totalSkippedFiles, totalSkippedSize }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ skippedFolders: [], totalSkippedFiles: 0, totalSkippedSize: 0 }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/check') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { name, size } = JSON.parse(body);
        const savePath = path.join(saveDir, name.replace(/\//g, '\\'));
        try {
          const stat = await fs.promises.stat(savePath);
          const sizeMatch = stat.size === size;
          if (sizeMatch) {
            stats.skipped++;
            stats.skippedBytes += size;
            addLog('SKIP: ' + name + ' (' + fmtBytes(size) + ')', 'skip', size);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: true }));
            return;
          }
        } catch(e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/upload') {
    const filename = decodeURIComponent(url.searchParams.get('name') || 'unnamed');
    const fileSize = parseInt(url.searchParams.get('size') || '0', 10);
    const savePath = path.join(saveDir, filename.replace(/\//g, '\\'));
    const dir = path.dirname(savePath);

    setImmediate(() => console.log('[UPLOAD] Receiving: ' + filename + ' (' + fmtBytes(fileSize) + ')'));

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // High performance write stream: 256KB buffer, no fsync on every write
    const ws = fs.createWriteStream(savePath, {
      highWaterMark: 512 * 1024,
      flags: 'w'
    });
    req.pipe(ws, { end: true });

    ws.on('finish', () => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.saved++;
      stats.savedBytes += fsize;
      addLog('SAVED: ' + filename + ' (' + fmtBytes(fsize) + ')', 'saved', fsize);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Saved: ' + filename);
    });

    req.on('error', (err) => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.failed++;
      stats.failedBytes += fsize;
      failedFiles.push({ file: filename, reason: err.message });
      addLog('FAILED: ' + filename + ' - ' + err.message, 'error', fsize);
      ws.destroy(); try { fs.unlinkSync(savePath); } catch(e) {}
      if (!res.headersSent) { res.writeHead(500); res.end('Error'); }
    });

    ws.on('error', (err) => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.failed++;
      stats.failedBytes += fsize;
      failedFiles.push({ file: filename, reason: err.message });
      addLog('WRITE ERROR: ' + filename + ' - ' + err.message, 'error', fsize);
      try { fs.unlinkSync(savePath); } catch(e) {}
      if (!res.headersSent) { res.writeHead(500); res.end('Write error'); }
    });

    return;
  }

  res.writeHead(404); res.end('Not found');
};

const httpServer = http.createServer(requestHandler);

// ---- Auto-validate browser JS before starting ----
function validateBrowserJS() {
  const vm = require('vm');
  const pages = [
    { name: 'senderHtml', html: senderHtmlFinal },
    { name: 'statusHtml', html: statusHtml }
  ];
  for (const page of pages) {
    const s = page.html.indexOf('<script>') + 8;
    const e = page.html.indexOf('</script>');
    if (s < 8 || e < 0) {
      console.error('FATAL: No <script> block found in ' + page.name);
      process.exit(1);
    }
    const js = page.html.substring(s, e);

    // Syntax check
    try {
      new vm.Script(js);
      console.log('[VALIDATE] ' + page.name + ' browser JS OK (' + js.split('\n').length + ' lines)');
    } catch (err) {
      console.error('\n=== FATAL: ' + page.name + ' browser JS compilation error ===');
      console.error('  ' + err.message);
      const m = err.stack ? err.stack.match(/:(\d+)/) : null;
      if (m) {
        const lines = js.split('\n');
        const ln = parseInt(m[1]);
        console.error('  Line ' + ln + ': ' + (lines[ln - 1] || '').trim());
      }
      console.error('='.repeat(55));
      process.exit(1);
    }

    // Check getElementById IDs exist in HTML
    const ids = [...js.matchAll(/getElementById\(['"](\w+)['"]\)/g)].map(m => m[1]);
    const dynamicIds = ['pickerHint'];
    const missing = ids.filter(id => !page.html.includes('id="' + id + '"') && !dynamicIds.includes(id));
    if (missing.length > 0) {
      console.error('[VALIDATE] WARNING: ' + page.name + ' has getElementById for missing IDs: ' + missing.join(', '));
    }
  }
}

validateBrowserJS();

(async () => {
  const tlsOptions = await getTlsOptions();
  const httpsServer = https.createServer(tlsOptions, requestHandler);

  // TCP optimizations for high throughput
  httpsServer.keepAliveTimeout = 60000;
  httpsServer.on('connection', (socket) => {
    socket.setNoDelay(true);           // Disable Nagle's algorithm
    socket.setKeepAlive(true, 60000);  // Keep connections alive
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log('='.repeat(55));
    console.log('HTTPS (use this): https://' + HOST_IP + ':' + HTTPS_PORT);
    console.log('HTTP  (fallback): http://'  + HOST_IP + ':' + HTTP_PORT);
    console.log('STATUS: https://' + HOST_IP + ':' + HTTPS_PORT + '/status');
    console.log('SAVES TO: ' + saveDir);
    console.log('NOTE: Accept the certificate warning on first open');
    console.log('='.repeat(55));
    addLog('Server started (HTTPS:' + HTTPS_PORT + ' HTTP:' + HTTP_PORT + ')', 'info');
  });

  // TCP optimizations for HTTP too
  httpServer.keepAliveTimeout = 60000;
  httpServer.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000);
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('[HTTP] Also listening on http://' + HOST_IP + ':' + HTTP_PORT);
  });
})();


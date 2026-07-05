const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8001;
const SAVE_DIR = 'D:\\art';
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });

let logEvents = [];
const MAX_LOG = 2000;
let failedFiles = [];
let stats = { saved: 0, skipped: 0, failed: 0, savedBytes: 0, skippedBytes: 0, failedBytes: 0 };

function addLog(msg, type = 'info', size = 0, dedupKey = '') {
  const entry = { time: new Date().toLocaleTimeString(), msg, type, size, dedupKey };
  logEvents.push(entry);
  if (logEvents.length > MAX_LOG) logEvents.shift();
  console.log(`[${entry.time}] ${msg}`);
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
  </style>
</head>
<body>
<div class="center">
<div class="card">
  <h2>Send to this PC</h2>
  <p class="sub">Saves to D:\\art &bull; smart folder skip</p>
  <div class="source-row" style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center">
    <span style="font-size:.85rem;color:#8ab4f8;flex:0 0 auto">Source Root Folder:</span>
    <input type="text" id="sourceRootInput" placeholder="e.g. my-project-folder (optional)" style="flex:1;background:#1a3a5c;color:#fff;border:1px solid #1a3a5c;border-radius:6px;padding:.5rem;font-size:.85rem">
  </div>
  <div class="drop-zone" id="dropZone" style="border: 2px dashed #444; border-radius: 12px; padding: 1.5rem; text-align: center; cursor: default;">
    <p style="margin-bottom: 0.8rem; color: #aaa;">Drag & drop files/folders here</p>
    <p style="color: #666; font-size: 0.85rem; margin-bottom: 0.8rem;">— OR —</p>
    <div style="display: flex; gap: 0.8rem; justify-content: center;">
      <button type="button" class="btn" id="selectFolderBtn" style="background: #1a3a5c; color: #8ab4f8; font-size: 0.85rem; padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600;">Select Folder</button>
      <button type="button" class="btn" id="selectFilesBtn" style="background: #1a3a5c; color: #8ab4f8; font-size: 0.85rem; padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600;">Select Files</button>
    </div>
    <input type="file" id="folderInput" webkitdirectory multiple style="opacity: 0; position: absolute; width: 0; height: 0; z-index: -1;">
    <input type="file" id="fileInput" multiple style="opacity: 0; position: absolute; width: 0; height: 0; z-index: -1;">
  </div>
  <div class="top-bar">
    <button class="btn" id="sendBtn" disabled>Send</button>
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
window.onerror = function(msg, url, line) {
  const statusText = document.getElementById('statusText');
  const progressWrap = document.getElementById('progressWrap');
  if (progressWrap) progressWrap.classList.add('active');
  if (statusText) {
    statusText.innerHTML = 'JS ERROR: ' + msg + ' (line ' + line + ')';
    statusText.style.color = '#f33';
  }
  console.error('JS ERROR:', msg, 'at line', line);
};
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const selectFilesBtn = document.getElementById('selectFilesBtn');
const sendBtn = document.getElementById('sendBtn');
const retryBtn = document.getElementById('retryBtn');
const progressWrap = document.getElementById('progressWrap');
const barFill = document.getElementById('barFill');
const pctText = document.getElementById('pctText');
const countText = document.getElementById('countText');
const speedText = document.getElementById('speedText');
const fileInfo = document.getElementById('fileInfo');
const statusText = document.getElementById('statusText');
const failedWrap = document.getElementById('failedWrap');
const failedTitle = document.getElementById('failedTitle');
const logPanel = document.getElementById('logPanel');
const savedCountEl = document.getElementById('savedCount');
const skipCountEl = document.getElementById('skipCount');
const failCountEl = document.getElementById('failCount');
const summaryBar = document.getElementById('summaryBar');
const sourceRootInput = document.getElementById('sourceRootInput');

let selectedFiles = [];
let localFailed = [];
let localSaved = 0;
let localSkipped = 0;
let localFailedCount = 0;
let localSavedBytes = 0;
let localSkippedBytes = 0;
let localFailedBytes = 0;
let lastLogId = 0;
let activeFilter = 'all';
let allLogs = [];
let autoPrefix = '';

selectFolderBtn.addEventListener('click', () => {
  console.log('[UI] Select Folder clicked, triggering folderInput click');
  folderInput.click();
});
selectFilesBtn.addEventListener('click', () => {
  console.log('[UI] Select Files clicked, triggering fileInput click');
  fileInput.click();
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  console.log('[UI] drop event fired, items:', e.dataTransfer.items.length);
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const allFiles = [];
  const pending = [];
  Array.from(e.dataTransfer.items).forEach(item => {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) pending.push(scanEntry(entry, ''));
  });
  if (!pending.length) {
    Array.from(e.dataTransfer.files).forEach(f => { f._relativePath = f.name; allFiles.push(f); });
    finish();
    return;
  }
  Promise.all(pending).then(finish);
  function finish() {
    let prefix = autoPrefix;
    if (!prefix && allFiles.length) {
      const firstPath = allFiles[0]._relativePath || allFiles[0].name;
      const parts = firstPath.split('/');
      if (parts.length > 1) {
        autoPrefix = parts[0];
        prefix = autoPrefix;
      }
    }
    if (prefix) {
      allFiles.forEach(f => {
        const rp = f._relativePath || f.name;
        if (!rp.startsWith(prefix + '/')) {
          f._relativePath = prefix + '/' + rp;
        }
      });
    }
    if (allFiles.length) {
      selectedFiles = allFiles;
      console.log('[DROP] ' + selectedFiles.length + ' files');
      updateFileList();
      statusText.textContent = selectedFiles.length + ' files ready to send' + (prefix ? ' to ' + prefix + '/' : '');
      statusText.style.color = '#00e676';
    } else {
      statusText.textContent = 'No files found';
      statusText.style.color = '#f33';
    }
  }
  function scanEntry(entry, base) {
    return new Promise(res => {
      if (entry.isFile) {
        entry.file(f => { f._relativePath = base + f.name; allFiles.push(f); res(); }, e2 => { console.log('[DROP] file error:', e2); res(); });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const dirPath = base + entry.name + '/';
        (function readAll() {
          reader.readEntries(batch => {
            if (!batch.length) { res(); return; }
            Promise.all(Array.from(batch).map(e2 => scanEntry(e2, dirPath))).then(readAll);
          }, e2 => { console.log('[DROP] readEntries error:', e2); res(); });
        })();
      } else res();
    });
  }
});

function handleFileSelection(files) {
  console.log('[UI] handleFileSelection invoked, files picked:', files.length);
  if (!files.length) {
    console.log('[UI] Selection was cancelled or empty');
    return;
  }
  selectedFiles = Array.from(files);
  selectedFiles.forEach((f, idx) => {
    f._relativePath = f.webkitRelativePath || f.name;
    if (idx < 5) console.log('[FILE ' + (idx+1) + '] name=' + f.name + ', path=' + f._relativePath + ', size=' + f.size);
  });
  if (selectedFiles.length > 5) console.log('... and ' + (selectedFiles.length - 5) + ' more files');
  updateFileList();
  statusText.textContent = selectedFiles.length + ' files ready to send';
  statusText.style.color = '#00e676';
}

fileInput.addEventListener('change', () => handleFileSelection(fileInput.files));
folderInput.addEventListener('change', () => handleFileSelection(folderInput.files));

document.querySelectorAll('.log-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeFilter = tab.dataset.tab;
    renderLogs();
  });
});

async function fetchLogs() {
  try {
    const r = await fetch('/log-events?since=' + lastLogId);
    const data = await r.json();
    if (data.length) {
      const existingDedupKeys = new Set(allLogs.filter(l => l.dedupKey).map(l => l.dedupKey));
      data.forEach(e => {
        if (e.dedupKey && existingDedupKeys.has(e.dedupKey)) return;
        allLogs.push(e);
        if (e.type === 'saved') { localSaved++; localSavedBytes += (e.size || 0); }
        else if (e.type === 'skip') { localSkipped++; localSkippedBytes += (e.size || 0); }
        else if (e.type === 'error') { localFailedCount++; localFailedBytes += (e.size || 0); }
      });
      lastLogId = data[data.length - 1].id;
      updateCounts();
      renderLogs();
    }
  } catch(e) {}
}
setInterval(fetchLogs, 500);

function renderLogs() {
  logPanel.innerHTML = '';
  const filtered = activeFilter === 'all' ? allLogs : allLogs.filter(l => l.type === activeFilter);
  if (!filtered.length) { logPanel.innerHTML = '<div style="color:#666">No entries yet</div>'; return; }
  filtered.forEach(l => {
    const d = document.createElement('div');
    d.className = l.type;
    let icon = '';
    let cls = l.type;
    if (l.type === 'saved') icon = '\u2705 ';
    else if (l.type === 'skip') {
      if (l.dedupKey && l.dedupKey.startsWith('folder:')) { icon = '\ud83d\udcc1 '; cls = 'folder-skip'; }
      else icon = '\u23f3 ';
    }
    else if (l.type === 'error') icon = '\u274c ';
    else if (l.type === 'info') icon = '\u2139\ufe0f ';
    d.className = cls;
    d.innerHTML = '<span class="time">[' + l.time + ']</span> ' + icon + l.msg;
    logPanel.appendChild(d);
  });
  logPanel.scrollTop = logPanel.scrollHeight;
}

function fmtGB(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  return b + ' B';
}
function updateCounts() {
  savedCountEl.textContent = localSaved + ' (' + fmtGB(localSavedBytes) + ')';
  skipCountEl.textContent = localSkipped + ' (' + fmtGB(localSkippedBytes) + ')';
  failCountEl.textContent = localFailedCount + ' (' + fmtGB(localFailedBytes) + ')';
  if (localSaved + localSkipped + localFailedCount > 0) {
    summaryBar.classList.add('active');
    summaryBar.innerHTML =
      '<div class="item"><span class="dot green"></span> Saved: ' + fmtGB(localSavedBytes) + '</div>' +
      '<div class="item"><span class="dot yellow"></span> Skipped: ' + fmtGB(localSkippedBytes) + '</div>' +
      '<div class="item"><span class="dot red"></span> Failed: ' + fmtGB(localFailedBytes) + '</div>';
  }
}

function updateFileList() {
  fileInfo.innerHTML = '';
  const totalBytes = selectedFiles.reduce((s,f) => s + f.size, 0);
  const totalFolders = new Set(selectedFiles.map(f => (f.webkitRelativePath || f.name).split('/')[0])).size;
  fileInfo.textContent = selectedFiles.length + ' files in ' + totalFolders + ' folders, ~' + fmtGB(totalBytes);
  sendBtn.disabled = false;
}

function buildFolderTree(files) {
  const root = { name: '', children: {}, fileCount: 0, totalSize: 0, files: [] };
  files.forEach(f => {
    const p = f._relativePath || f.webkitRelativePath || f.name;
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { name: parts[i], children: {}, fileCount: 0, totalSize: 0, files: [] };
      }
      node = node.children[parts[i]];
    }
    node.files.push(f);
    node.fileCount++;
    node.totalSize += f.size;
    root.fileCount++;
    root.totalSize += f.size;
  });
  function toArray(node) {
    node.children = Object.values(node.children);
    node.children.forEach(toArray);
  }
  toArray(root);
  return root;
}

function addLocalSkipLog(msg, size, dedupKey) {
  const entry = { time: new Date().toLocaleTimeString(), msg, type: 'skip', size, dedupKey };
  allLogs.push(entry);
  localSkipped++;
  localSkippedBytes += size;
  updateCounts();
  renderLogs();
}

async function sendFiles(files) {
  sendBtn.disabled = true;
  retryBtn.disabled = true;
  progressWrap.classList.add('active');
  barFill.style.width = '0%'; pctText.textContent = '0%';
  statusText.textContent = "Checking what's on server...";
  statusText.style.color = '';

  const sourceRoot = sourceRootInput.value.trim().replace(/\\\\/g, '/');
  const allFileList = files.map(f => {
    let name = f._relativePath || f.webkitRelativePath || f.name;
    if (sourceRoot) {
      const cleanRoot = sourceRoot.replace(/^\/+|\/+$/g, '');
      if (cleanRoot && !name.startsWith(cleanRoot + '/')) {
        name = cleanRoot + '/' + name;
      }
    }
    return { name, size: f.size, _file: f };
  });

  let missingFiles = [];
  try {
    const diffResp = await fetch('/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allFileList.map(f => ({ name: f.name, size: f.size })))
    });
    const diff = await diffResp.json();

    const existCount = diff.existCount || 0;
    const missingSize = diff.missingSize || 0;

    if (existCount > 0) {
      addLocalSkipLog('SKIP: ' + existCount + ' files already on server (' + fmtGB(allFileList.reduce((s,f) => s + f.size, 0) - missingSize) + ')', allFileList.reduce((s,f) => s + f.size, 0) - missingSize, 'diff-skip');
    }

    if (diff.missingCount === 0) {
      statusText.innerHTML = '\u2705 All ' + allFileList.length + ' files already on server!';
      statusText.style.color = '#00e676';
      sendBtn.disabled = false;
      return;
    }

    statusText.textContent = diff.missingCount + ' files to send (' + fmtGB(missingSize) + ')...';
    missingFiles = diff.missing.map(mf => {
      const found = allFileList.find(f => f.name === mf.name && f.size === mf.size);
      return found || null;
    }).filter(Boolean);
  } catch(e) {
    statusText.textContent = 'Diff check failed, sending all files...';
    missingFiles = allFileList;
  }

  const total = missingFiles.length;
  let completed = 0;
  const bytesTotal = missingFiles.reduce((s,f) => s + f.size, 0);
  let bytesSent = 0;
  const startTime = Date.now();
  localFailed = [];

  function updateUI() {
    const pct = total > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0;
    barFill.style.width = pct + '%'; pctText.textContent = pct + '%';
    countText.textContent = completed + ' / ' + total;
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 0.5) speedText.textContent = (bytesSent / 1024 / 1024 / elapsed).toFixed(1) + ' MB/s';
  }

  for (const item of missingFiles) {
    const filePath = item.name;
    statusText.textContent = '(' + (completed+1) + '/' + total + ') Sending: ' + filePath;

    try {
      const resp = await fetch('/upload?name=' + encodeURIComponent(filePath) + '&size=' + item.size, {
        method: 'POST', body: item._file
      });
      const result = await resp.text();
      completed++;
      bytesSent += item.size;
      updateUI();
      statusText.textContent = '\u2705 ' + result;
    } catch(err) {
      completed++;
      bytesSent += item.size;
      localFailed.push({ file: item._file, reason: err.message });
      updateUI();
      statusText.textContent = '\u274c Failed: ' + filePath;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgSpeed = bytesTotal > 0 ? (bytesTotal / 1024 / 1024 / (Date.now() - startTime) * 1000).toFixed(1) : 0;
  statusText.innerHTML = '\u2705 Done! ' + total + ' files sent (' + fmtGB(bytesTotal) + '), ' + elapsed + 's, ' + avgSpeed + ' MB/s<br>' +
    '<span style="color:#0f0">Sent: ' + fmtGB(localSavedBytes) + '</span> &bull; ' +
    '<span style="color:#ff0">Skipped: ' + fmtGB(localSkippedBytes) + '</span> &bull; ' +
    '<span style="color:#f33">Failed: ' + fmtGB(localFailedBytes) + '</span>';
  statusText.style.color = '#00e676';
  barFill.style.width = '100%'; pctText.textContent = '100%';

  if (localFailed.length) {
    failedWrap.classList.add('active');
    failedTitle.textContent = 'Failed (' + localFailed.length + ')';
    retryBtn.disabled = false;
    retryBtn.onclick = () => {
      failedWrap.classList.remove('active');
      sendFiles(localFailed.map(f => f.file));
    };
  }

  sendBtn.disabled = false;
}

sendBtn.addEventListener('click', () => {
  if (!selectedFiles.length) return;
  failedWrap.classList.remove('active');
  localSaved = 0; localSkipped = 0; localFailedCount = 0;
  localSavedBytes = 0; localSkippedBytes = 0; localFailedBytes = 0;
  allLogs = [];
  updateCounts();
  renderLogs();
  sendFiles(selectedFiles);
});
</script>
</body>
</html>`;

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
    res.end(senderHtml); return;
  }

  if (req.method === 'POST' && pathname === '/diff') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const files = JSON.parse(body);
        const missing = [];
        let checked = 0, existCount = 0, missingCount = 0;
        for (const f of files) {
          const savePath = path.join(SAVE_DIR, f.name.replace(/\//g, '\\'));
          checked++;
          if (fs.existsSync(savePath)) {
            const stat = fs.statSync(savePath);
            if (stat.size === f.size) {
              existCount++;
              continue;
            }
          }
          missingCount++;
          missing.push(f);
        }
        console.log('[DIFF] checked=' + checked + ' exist=' + existCount + ' missing=' + missingCount);
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
            console.log('[FOLDER-CHECK] NOT FOUND: ' + fullPath + ' -> will create');
            return;
          }

          const serverSize = getFolderSize(serverFolderPath);
          const serverCount = getFolderFileCount(serverFolderPath);
          const sizeMatch = Math.abs(serverSize - clientNode.totalSize) < 10;
          const countMatch = serverCount === clientNode.fileCount;

          console.log('[FOLDER-CHECK] ' + fullPath + '/ client=' + clientNode.fileCount + 'f/' + fmtBytes(clientNode.totalSize) + ' server=' + serverCount + 'f/' + fmtBytes(serverSize) + ' sizeMatch=' + sizeMatch + ' countMatch=' + countMatch);

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
            checkRecursive(child, SAVE_DIR, 0, child.name);
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
    req.on('end', () => {
      try {
        const { name, size } = JSON.parse(body);
        const savePath = path.join(SAVE_DIR, name.replace(/\//g, '\\'));
        const exists = fs.existsSync(savePath);
        if (exists) {
          const stat = fs.statSync(savePath);
          const sizeMatch = stat.size === size;
          console.log('[CHECK] ' + name + ' exists=' + exists + ' serverSize=' + stat.size + ' clientSize=' + size + ' sizeMatch=' + sizeMatch);
          if (sizeMatch) {
            stats.skipped++;
            stats.skippedBytes += size;
            addLog('SKIP: ' + name + ' (' + fmtBytes(size) + ')', 'skip', size);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: true }));
            return;
          } else {
            console.log('[CHECK] SIZE MISMATCH: ' + name + ' server=' + stat.size + ' client=' + size + ' -> will overwrite');
          }
        } else {
          console.log('[CHECK] NOT FOUND: ' + name + ' -> will send');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
      } catch(e) {
        console.log('[CHECK] ERROR: ' + e.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/upload') {
    const filename = decodeURIComponent(url.searchParams.get('name') || 'unnamed');
    const fileSize = parseInt(url.searchParams.get('size') || '0', 10);
    const savePath = path.join(SAVE_DIR, filename.replace(/\//g, '\\'));
    const dir = path.dirname(savePath);

    console.log('[UPLOAD] Receiving: ' + filename + ' (' + fmtBytes(fileSize) + ') -> ' + savePath);

    if (!fs.existsSync(dir)) {
      console.log('[UPLOAD] Creating dir: ' + dir);
      fs.mkdirSync(dir, { recursive: true });
    }

    const ws = fs.createWriteStream(savePath);
    req.pipe(ws, { end: true });

    ws.on('finish', () => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.saved++;
      stats.savedBytes += fsize;
      addLog('SAVED: ' + filename + ' (' + fmtBytes(fsize) + ')', 'saved', fsize);
      console.log('[UPLOAD] OK: ' + filename + ' (' + fmtBytes(fsize) + ')');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Saved: ' + filename);
    });

    req.on('error', (err) => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.failed++;
      stats.failedBytes += fsize;
      failedFiles.push({ file: filename, reason: err.message });
      addLog('FAILED: ' + filename + ' - ' + err.message, 'error', fsize);
      console.log('[UPLOAD] ERROR: ' + filename + ' - ' + err.message);
      ws.destroy(); try { fs.unlinkSync(savePath); } catch(e) {}
      if (!res.headersSent) { res.writeHead(500); res.end('Error'); }
    });

    ws.on('error', (err) => {
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      stats.failed++;
      stats.failedBytes += fsize;
      failedFiles.push({ file: filename, reason: err.message });
      addLog('WRITE ERROR: ' + filename + ' - ' + err.message, 'error', fsize);
      console.log('[UPLOAD] WRITE ERROR: ' + filename + ' - ' + err.message);
      try { fs.unlinkSync(savePath); } catch(e) {}
      if (!res.headersSent) { res.writeHead(500); res.end('Write error'); }
    });

    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(55));
  console.log('SENDER:  http://192.168.137.1:' + PORT);
  console.log('STATUS:  http://192.168.137.1:' + PORT + '/status');
  console.log('SAVES TO: ' + SAVE_DIR);
  console.log('='.repeat(55));
  addLog('Server started', 'info');
});

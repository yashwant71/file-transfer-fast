const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = 8001;
const HTTPS_PORT = 8443;
const HOST_IP = '192.168.137.1';
const SAVE_DIR = 'D:\\art';
const CERT_DIR = path.join(__dirname, '.cert');
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

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
  </style>
</head>
<body>
<div class="center">
<div class="card">
  <h2>Send to this PC</h2>
  <p class="sub">Saves to D:\\art &bull; smart folder skip</p>
  <!-- Destination row -->
  <div style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center;background:#0a1628;border:1px solid #1a3a5c;border-radius:8px;padding:.5rem .7rem">
    <span style="font-size:.85rem;color:#8ab4f8;flex:0 0 auto">📥 Save to:</span>
    <span id="destLabel" style="flex:1;font-size:.85rem;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">D:\art (root)</span>
    <button id="destBrowseBtn" style="background:#1a3a5c;color:#8ab4f8;border:none;padding:.35rem .75rem;border-radius:6px;font-size:.8rem;cursor:pointer;font-weight:600;white-space:nowrap">📁 Change</button>
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
      <button class="fb-cancel-btn" id="dbCancelBtn">Cancel</button>
    </div>
  </div>
  <div class="fb-panel" id="folderBrowser">
    <div style="padding:.5rem .6rem; background:#0d1f3c; border-bottom:1px solid #1a3a5c; font-size:.85rem; color:#4fc3f7; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
      <span>📂 Browse Folders to Send</span>
      <span style="font-size:.75rem; color:#888; font-weight:normal;">tap folder to go in &bull; tap Send to upload</span>
    </div>
    <div class="fb-breadcrumb" id="fbBreadcrumb"></div>
    <div class="fb-list" id="fbList"><div class="fb-empty">Loading...</div></div>
    <div class="fb-bar">
      <button class="fb-use-btn" id="fbUseBtn">📤 Send this folder</button>
      <button class="fb-cancel-btn" id="fbCancelBtn">Cancel</button>
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
var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('fileInput');
var folderInput = document.getElementById('folderInput');
var selectFolderBtn = document.getElementById('selectFolderBtn');
var selectFilesBtn = document.getElementById('selectFilesBtn');
var sendBtn = document.getElementById('sendBtn');
var retryBtn = document.getElementById('retryBtn');
var progressWrap = document.getElementById('progressWrap');
var barFill = document.getElementById('barFill');
var pctText = document.getElementById('pctText');
var countText = document.getElementById('countText');
var speedText = document.getElementById('speedText');
var fileInfo = document.getElementById('fileInfo');
var statusText = document.getElementById('statusText');
var failedWrap = document.getElementById('failedWrap');
var failedTitle = document.getElementById('failedTitle');
var logPanel = document.getElementById('logPanel');
var savedCountEl = document.getElementById('savedCount');
var skipCountEl = document.getElementById('skipCount');
var failCountEl = document.getElementById('failCount');
var summaryBar = document.getElementById('summaryBar');
var folderBrowser = document.getElementById('folderBrowser');
var fbBreadcrumb = document.getElementById('fbBreadcrumb');
var fbList = document.getElementById('fbList');
var fbUseBtn = document.getElementById('fbUseBtn');
var fbCancelBtn = document.getElementById('fbCancelBtn');
var destBrowser = document.getElementById('destBrowser');
var dbBreadcrumb = document.getElementById('dbBreadcrumb');
var dbList = document.getElementById('dbList');
var dbUseBtn = document.getElementById('dbUseBtn');
var dbCancelBtn = document.getElementById('dbCancelBtn');
var destBrowseBtn = document.getElementById('destBrowseBtn');
var destLabel = document.getElementById('destLabel');

// destPath: relative path within D:\art to save into ('' = root)
var destPath = '';

var selectedFiles = [];
var allBrowsedFiles = [];
var localFailed = [];
var localSaved = 0;
var localSkipped = 0;
var localFailedCount = 0;
var localSavedBytes = 0;
var localSkippedBytes = 0;
var localFailedBytes = 0;
var lastLogId = 0;
var activeFilter = 'all';
var allLogs = [];
var autoSendAfterPick = false;

var localTreeRoot = null;
var localTreeCurrent = null;

function buildLocalTree(files) {
  var firstPath = files[0]._relativePath || files[0].webkitRelativePath || files[0].name;
  var firstPart = firstPath.split('/')[0];
  var root = { name: firstPart, path: firstPart, children: {}, files: [] };
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var pathStr = f._relativePath || f.webkitRelativePath || f.name;
    var parts = pathStr.split('/');
    var current = root;
    var currentPath = firstPart;
    for (var j = 1; j < parts.length - 1; j++) {
      var part = parts[j];
      currentPath = currentPath + '/' + part;
      if (!current.children[part]) {
        current.children[part] = { name: part, path: currentPath, children: {}, files: [] };
      }
      current = current.children[part];
    }
    current.files.push(f);
  }
  return root;
}

function showLocalBrowser(treeNode) {
  localTreeCurrent = treeNode;
  var parts = treeNode.path.split('/');
  var bcHtml = '';
  var accumulated = '';
  for (var i = 0; i < parts.length; i++) {
    accumulated = accumulated ? accumulated + '/' + parts[i] : parts[i];
    var activeClass = (i === parts.length - 1) ? ' style="color:#fff;font-weight:600;"' : '';
    if (i > 0) bcHtml += '<span class="fb-sep">/</span>';
    bcHtml += '<span class="fb-crumb" data-path="' + accumulated + '"' + activeClass + '>' + parts[i] + '</span>';
  }
  fbBreadcrumb.innerHTML = bcHtml;
  var listHtml = '';
  var childKeys = Object.keys(treeNode.children).sort();
  for (var k = 0; k < childKeys.length; k++) {
    var child = treeNode.children[childKeys[k]];
    var fileCount = countFilesInNode(child);
    var sizeStr = fmtGB(sizeInNode(child));
    listHtml += '<div class="fb-folder" data-path="' + child.path + '">' +
                '<span style="font-size:1.1rem;margin-right:.4rem">📁</span>' +
                '<div style="flex:1;">' +
                  '<div style="font-weight:600;">' + child.name + '</div>' +
                  '<div style="font-size:.7rem;color:#888;">' + fileCount + ' files (' + sizeStr + ')</div>' +
                '</div>' +
                '</div>';
  }
  for (var f = 0; f < treeNode.files.length; f++) {
    var file = treeNode.files[f];
    listHtml += '<div class="fb-file" style="padding:.55rem .7rem; border-bottom:1px solid #1a1a1a; font-size:.85rem; color:#aaa; display:flex; align-items:center; gap:.5rem;">' +
                '<span style="font-size:1.1rem;margin-right:.2rem">📄</span>' +
                '<span>' + file.name + ' (' + fmtGB(file.size) + ')</span>' +
                '</div>';
  }
  if (childKeys.length === 0 && treeNode.files.length === 0) {
    listHtml = '<div class="fb-empty">Folder is empty</div>';
  }
  fbList.innerHTML = listHtml;
  fbUseBtn.textContent = '📤 Send Folder: ' + treeNode.name + ' (' + countFilesInNode(treeNode) + ' files)';
}

function countFilesInNode(node) {
  var count = node.files.length;
  var childKeys = Object.keys(node.children);
  for (var i = 0; i < childKeys.length; i++) {
    count += countFilesInNode(node.children[childKeys[i]]);
  }
  return count;
}

function sizeInNode(node) {
  var size = node.files.reduce(function(s, f) { return s + f.size; }, 0);
  var childKeys = Object.keys(node.children);
  for (var i = 0; i < childKeys.length; i++) {
    size += sizeInNode(node.children[childKeys[i]]);
  }
  return size;
}

function collectFilesInNode(node) {
  var files = [].concat(node.files);
  var childKeys = Object.keys(node.children);
  for (var i = 0; i < childKeys.length; i++) {
    files = files.concat(collectFilesInNode(node.children[childKeys[i]]));
  }
  return files;
}

function findNodeByPath(node, pathStr) {
  if (node.path === pathStr) return node;
  var childKeys = Object.keys(node.children);
  for (var i = 0; i < childKeys.length; i++) {
    var found = findNodeByPath(node.children[childKeys[i]], pathStr);
    if (found) return found;
  }
  return null;
}

// (folder browser listeners now in the lazy browser section below)

dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  var allFiles = [];
  var pending = [];
  Array.from(e.dataTransfer.items).forEach(function(item) {
    var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) pending.push(scanEntry(entry, ''));
  });
  if (!pending.length) {
    Array.from(e.dataTransfer.files).forEach(function(f) { f._relativePath = f.name; allFiles.push(f); });
    finish();
    return;
  }
  Promise.all(pending).then(finish);
  function finish() {
    if (allFiles.length) handleFilesWithSubfolders(allFiles);
  }
  function scanEntry(entry, base) {
    return new Promise(function(res) {
      if (entry.isFile) {
        entry.file(function(f) { f._relativePath = base + f.name; allFiles.push(f); res(); }, function() { res(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var dirPath = base + entry.name + '/';
        (function readAll() {
          reader.readEntries(function(batch) {
            if (!batch.length) { res(); return; }
            Promise.all(Array.from(batch).map(function(e2) { return scanEntry(e2, dirPath); })).then(readAll);
          }, function() { res(); });
        })();
      } else res();
    });
  }
});

function handleFilesWithSubfolders(files) {
  allBrowsedFiles = files;
  allBrowsedFiles.forEach(function(f) {
    if (!f._relativePath) f._relativePath = f.webkitRelativePath || f.name;
  });
  localTreeRoot = buildLocalTree(allBrowsedFiles);
  folderBrowser.classList.add('active');
  showLocalBrowser(localTreeRoot);
}

// --- Lazy folder browser (FileSystem Access API) ---
var lbHandles = {};   // path -> FileSystemDirectoryHandle
var lbCurrent = '';   // current path string
var lbRoot = '';      // root folder name

async function lbLoadDir(handle, path) {
  lbHandles[path] = handle;
  lbCurrent = path;
  var subfolders = [];
  var fileCount = 0;
  for await (var entry of handle.values()) {
    if (entry.kind === 'directory') subfolders.push(entry.name);
    else fileCount++;
  }
  subfolders.sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });

  // Breadcrumb
  var parts = path ? path.split('/') : [];
  var bcHtml = '<span class="fb-crumb" data-lbpath="">' + lbRoot + '</span>';
  var acc = '';
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    acc = acc ? acc + '/' + parts[i] : parts[i];
    bcHtml += '<span class="fb-sep">/</span><span class="fb-crumb" data-lbpath="' + acc + '">' + parts[i] + '</span>';
  }
  fbBreadcrumb.innerHTML = bcHtml;

  // List
  var listHtml = '';
  if (subfolders.length === 0 && fileCount === 0) {
    listHtml = '<div class="fb-empty">Empty folder</div>';
  } else {
    for (var k = 0; k < subfolders.length; k++) {
      listHtml += '<div class="fb-folder" data-lbsub="' + subfolders[k] + '">'
        + '<span style="font-size:1.1rem;margin-right:.4rem">📁</span>'
        + '<div style="flex:1"><div style="font-weight:600">' + subfolders[k] + '</div></div>'
        + '<span style="font-size:.75rem;color:#555">▶</span>'
        + '</div>';
    }
    if (fileCount > 0) {
      listHtml += '<div style="padding:.4rem .7rem;font-size:.75rem;color:#666;border-top:1px solid #1a1a1a">' + fileCount + ' file(s) in this folder</div>';
    }
  }
  fbList.innerHTML = listHtml;

  var displayName = path ? path.split('/').pop() : lbRoot;
  fbUseBtn.textContent = '📤 Send: ' + displayName;
}

fbList.addEventListener('click', async function(e) {
  var el = e.target.closest('.fb-folder');
  if (!el) return;
  var subName = el.getAttribute('data-lbsub');
  var parentHandle = lbHandles[lbCurrent];
  if (!parentHandle) return;
  try {
    var subHandle = await parentHandle.getDirectoryHandle(subName);
    var newPath = lbCurrent ? lbCurrent + '/' + subName : subName;
    await lbLoadDir(subHandle, newPath);
  } catch(e) { console.error(e); }
});

fbBreadcrumb.addEventListener('click', async function(e) {
  var el = e.target.closest('.fb-crumb');
  if (!el) return;
  var targetPath = el.getAttribute('data-lbpath');
  var handle = lbHandles[targetPath];
  if (handle) await lbLoadDir(handle, targetPath);
});

async function readDirHandleRecursive(handle, basePath) {
  var results = [];
  for await (var entry of handle.values()) {
    var entryPath = basePath ? basePath + '/' + entry.name : entry.name;
    if (entry.kind === 'file') {
      var file = await entry.getFile();
      file._relativePath = entryPath;
      results.push(file);
    } else if (entry.kind === 'directory') {
      var sub = await readDirHandleRecursive(entry, entryPath);
      results = results.concat(sub);
    }
  }
  return results;
}

// fbUseBtn handles both API and virtual fallback
fbUseBtn.addEventListener('click', async function() {
  // Virtual tree path (webkitdirectory fallback)
  if (lbVirtualTree && lbVirtualCurrent) {
    var files = collectVirtualFiles(lbVirtualCurrent);
    folderBrowser.classList.remove('active');
    if (!files.length) { statusText.textContent = 'No files in this folder.'; progressWrap.classList.add('active'); return; }
    // Strip root folder name from paths so selected folder isn't recreated on server
    var rootStrip = lbRoot + '/';
    files.forEach(function(f) {
      if (f._relativePath && f._relativePath.startsWith(rootStrip))
        f._relativePath = f._relativePath.slice(rootStrip.length);
    });
    selectedFiles = files;
    updateFileList();
    startSend();
    return;
  }
  // FileSystem Access API path
  var handle = lbHandles[lbCurrent];
  if (!handle) return;
  folderBrowser.classList.remove('active');
  progressWrap.classList.add('active');
  statusText.style.color = '';
  var folderName = lbCurrent ? lbCurrent.split('/').pop() : lbRoot;
  statusText.textContent = 'Reading files in ' + folderName + '...';
  try {
    var baseName = lbCurrent || lbRoot;
    var files = await readDirHandleRecursive(handle, baseName);
    if (!files.length) { statusText.textContent = 'No files found in that folder.'; return; }
    // Strip root folder name from paths
    var rootStrip = lbRoot + '/';
    files.forEach(function(f) {
      if (f._relativePath && f._relativePath.startsWith(rootStrip))
        f._relativePath = f._relativePath.slice(rootStrip.length);
    });
    progressWrap.classList.remove('active');
    selectedFiles = files;
    updateFileList();
    startSend();
  } catch(e) {
    progressWrap.classList.remove('active');
    statusText.textContent = 'Error reading files: ' + e.message;
  }
});

fbCancelBtn.addEventListener('click', function() {
  folderBrowser.classList.remove('active');
});

// --- Destination browser (server-side /dir-tree) ---
var dbCurrentPath = '';

async function dbLoadDir(subpath) {
  dbCurrentPath = subpath;
  dbList.innerHTML = '<div class="fb-empty">Loading...</div>';
  // Breadcrumb
  var parts = subpath ? subpath.split('/') : [];
  var bcHtml = '<span class="fb-crumb" data-dbpath="">D:\\art</span>';
  var acc = '';
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    acc = acc ? acc + '/' + parts[i] : parts[i];
    bcHtml += '<span class="fb-sep">/</span><span class="fb-crumb" data-dbpath="' + acc + '">' + parts[i] + '</span>';
  }
  dbBreadcrumb.innerHTML = bcHtml;
  dbBreadcrumb.querySelectorAll('.fb-crumb').forEach(function(el) {
    el.addEventListener('click', function() { dbLoadDir(el.getAttribute('data-dbpath')); });
  });
  // Fetch dir listing from server
  try {
    var resp = await fetch('/dir-tree?path=' + encodeURIComponent(subpath));
    var dirs = await resp.json();
    if (!dirs.length) {
      dbList.innerHTML = '<div class="fb-empty">No subfolders here</div>';
    } else {
      var html = '';
      dirs.forEach(function(d) {
        html += '<div class="fb-folder" data-dbsub="' + d + '">'
          + '<span style="font-size:1.1rem;margin-right:.4rem">📁</span>'
          + '<div style="flex:1"><div style="font-weight:600">' + d + '</div></div>'
          + '<span style="font-size:.75rem;color:#555">▶</span></div>';
      });
      dbList.innerHTML = html;
      dbList.querySelectorAll('.fb-folder').forEach(function(el) {
        el.addEventListener('click', function() {
          var sub = el.getAttribute('data-dbsub');
          var newPath = dbCurrentPath ? dbCurrentPath + '/' + sub : sub;
          dbLoadDir(newPath);
        });
      });
    }
    var displayName = subpath ? subpath.split('/').pop() : 'root';
    dbUseBtn.textContent = '📍 Use: D:\\art' + (subpath ? '\\' + subpath.replace(/\//g, '\\') : '') + ' (' + displayName + ')';
  } catch(e) {
    dbList.innerHTML = '<div class="fb-empty">Error: ' + e.message + '</div>';
  }
}

destBrowseBtn.addEventListener('click', function() {
  destBrowser.classList.add('active');
  dbLoadDir('');
});

dbCancelBtn.addEventListener('click', function() {
  destBrowser.classList.remove('active');
});

dbUseBtn.addEventListener('click', function() {
  destPath = dbCurrentPath;
  var display = destPath ? 'D:\\art\\' + destPath.replace(/\//g, '\\') : 'D:\\art (root)';
  destLabel.textContent = display;
  destBrowser.classList.remove('active');
});

selectFolderBtn.addEventListener('click', async function() {
  if (window.showDirectoryPicker && window.isSecureContext) {
    try {
      var dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      lbHandles = {};
      lbRoot = dirHandle.name;
      lbCurrent = '';
      lbHandles[''] = dirHandle;
      folderBrowser.classList.add('active');
      await lbLoadDir(dirHandle, '');
    } catch(e) {
      if (e.name !== 'AbortError') {
        statusText.textContent = 'Error: ' + e.message;
        progressWrap.classList.add('active');
      }
    }
  } else {
    // HTTP fallback: use webkitdirectory input
    // Show hint so user knows to navigate INTO the specific folder
    showPickerHint();
    folderInput.value = '';
    folderInput.click();
  }
});

function showPickerHint() {
  var hint = document.getElementById('pickerHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'pickerHint';
    hint.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#1a3a5c;color:#8ab4f8;padding:.6rem 1rem;border-radius:8px;font-size:.8rem;z-index:999;max-width:90vw;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.5);';
    hint.textContent = '💡 Navigate into the specific folder you want to send, then tap Select';
    document.body.appendChild(hint);
    setTimeout(function() { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 5000);
  }
}

folderInput.addEventListener('change', function() {
  if (!folderInput.files.length) return;
  var fileArr = Array.from(folderInput.files);
  fileArr.forEach(function(f) {
    f._relativePath = f.webkitRelativePath || f.name;
  });
  // Build virtual dir tree and show lazy browser
  var vRoot = buildVirtualTree(fileArr);
  lbHandles = {};
  lbRoot = vRoot.name;
  lbCurrent = '';
  lbVirtualTree = vRoot;
  folderBrowser.classList.add('active');
  lbShowVirtualNode(vRoot, '');
});

// Virtual tree for webkitdirectory fallback
var lbVirtualTree = null;

function buildVirtualTree(files) {
  // files have _relativePath like "root/sub/file.jpg"
  var root = null;
  files.forEach(function(f) {
    var parts = f._relativePath.split('/');
    if (!root) root = { name: parts[0], path: '', children: {}, files: [] };
    var node = root;
    for (var i = 1; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        var childPath = node.path ? node.path + '/' + parts[i] : parts[i];
        node.children[parts[i]] = { name: parts[i], path: childPath, children: {}, files: [] };
      }
      node = node.children[parts[i]];
    }
    node.files.push(f);
  });
  return root || { name: '(empty)', path: '', children: {}, files: [] };
}

function findVirtualNode(node, path) {
  if (!path || node.path === path) return node;
  var keys = Object.keys(node.children);
  for (var i = 0; i < keys.length; i++) {
    var found = findVirtualNode(node.children[keys[i]], path);
    if (found) return found;
  }
  return null;
}

function lbShowVirtualNode(node, path) {
  lbCurrent = path;
  var subfolders = Object.keys(node.children).sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });
  var fileCount = node.files.length;

  // Breadcrumb
  var parts = path ? path.split('/') : [];
  var bcHtml = '<span class="fb-crumb" data-lbvpath="">' + lbRoot + '</span>';
  var acc = '';
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    acc = acc ? acc + '/' + parts[i] : parts[i];
    bcHtml += '<span class="fb-sep">/</span><span class="fb-crumb" data-lbvpath="' + acc + '">' + parts[i] + '</span>';
  }
  fbBreadcrumb.innerHTML = bcHtml;

  // List
  var listHtml = '';
  if (subfolders.length === 0 && fileCount === 0) {
    listHtml = '<div class="fb-empty">Empty folder</div>';
  } else {
    for (var k = 0; k < subfolders.length; k++) {
      var child = node.children[subfolders[k]];
      var childTotal = countVirtualFiles(child);
      listHtml += '<div class="fb-folder" data-lbvpath="' + child.path + '">'
        + '<span style="font-size:1.1rem;margin-right:.4rem">📁</span>'
        + '<div style="flex:1"><div style="font-weight:600">' + subfolders[k] + '</div>'
        + '<div style="font-size:.7rem;color:#888">' + childTotal + ' files</div></div>'
        + '<span style="font-size:.75rem;color:#555">▶</span>'
        + '</div>';
    }
    if (fileCount > 0) {
      listHtml += '<div style="padding:.4rem .7rem;font-size:.75rem;color:#666;border-top:1px solid #1a1a1a">' + fileCount + ' file(s) in this folder</div>';
    }
  }
  fbList.innerHTML = listHtml;

  var displayName = path ? path.split('/').pop() : lbRoot;
  var totalFiles = countVirtualFiles(node);
  fbUseBtn.textContent = '📤 Send: ' + displayName + ' (' + totalFiles + ' files)';

  // Wire virtual nav on breadcrumb
  fbBreadcrumb.querySelectorAll('[data-lbvpath]').forEach(function(el) {
    el.addEventListener('click', function() {
      var p = el.getAttribute('data-lbvpath');
      var n = findVirtualNode(lbVirtualTree, p) || lbVirtualTree;
      lbShowVirtualNode(n, p);
    });
  });
  fbList.querySelectorAll('[data-lbvpath]').forEach(function(el) {
    el.addEventListener('click', function() {
      var p = el.getAttribute('data-lbvpath');
      var n = findVirtualNode(lbVirtualTree, p);
      if (n) lbShowVirtualNode(n, p);
    });
  });

  // Stash current node for fbUseBtn
  lbVirtualCurrent = node;
}

function countVirtualFiles(node) {
  var c = node.files.length;
  Object.keys(node.children).forEach(function(k) { c += countVirtualFiles(node.children[k]); });
  return c;
}

function collectVirtualFiles(node) {
  var f = [].concat(node.files);
  Object.keys(node.children).forEach(function(k) { f = f.concat(collectVirtualFiles(node.children[k])); });
  return f;
}

var lbVirtualCurrent = null;

selectFilesBtn.addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function() {
  if (!fileInput.files.length) return;
  var fileArr = Array.from(fileInput.files);
  fileArr.forEach(function(f) { f._relativePath = f.name; });
  selectedFiles = fileArr;
  updateFileList();
});

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

  // Build flat file list with relative paths, prepend chosen destination
  const allFileList = files.map(f => {
    var relPath = f._relativePath || f.webkitRelativePath || f.name;
    var uploadName = destPath ? destPath + '/' + relPath : relPath;
    return { _file: f, name: uploadName, size: f.size };
  });

  let missingFiles = allFileList;
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

sendBtn.addEventListener('click', function() {
  if (!selectedFiles.length) return;
  startSend();
});

function startSend() {
  failedWrap.classList.remove('active');
  localSaved = 0; localSkipped = 0; localFailedCount = 0;
  localSavedBytes = 0; localSkippedBytes = 0; localFailedBytes = 0;
  allLogs = [];
  updateCounts();
  renderLogs();
  sendFiles(selectedFiles);
}
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
    if (pathname === '/dir-tree') {
      const subpath = url.searchParams.get('path') || '';
      const fullPath = path.join(SAVE_DIR, subpath);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(path.resolve(SAVE_DIR))) {
        res.writeHead(403); res.end('Forbidden'); return;
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
};

const httpServer = http.createServer(requestHandler);

// ---- Auto-validate browser JS before starting ----
function validateBrowserJS() {
  const vm = require('vm');
  const pages = [
    { name: 'senderHtml', html: senderHtml },
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
  }
}

validateBrowserJS();

(async () => {
  const tlsOptions = await getTlsOptions();
  const httpsServer = https.createServer(tlsOptions, requestHandler);

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log('='.repeat(55));
    console.log('HTTPS (use this): https://' + HOST_IP + ':' + HTTPS_PORT);
    console.log('HTTP  (fallback): http://'  + HOST_IP + ':' + HTTP_PORT);
    console.log('STATUS: https://' + HOST_IP + ':' + HTTPS_PORT + '/status');
    console.log('SAVES TO: ' + SAVE_DIR);
    console.log('NOTE: Accept the certificate warning on first open');
    console.log('='.repeat(55));
    addLog('Server started (HTTPS:' + HTTPS_PORT + ' HTTP:' + HTTP_PORT + ')', 'info');
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('[HTTP] Also listening on http://' + HOST_IP + ':' + HTTP_PORT);
  });
})();


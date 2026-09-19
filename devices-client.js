// devices-client.js — single-view file share: devices + send + unified history.
// Injected into devicesHtml by server.js.

(function() {
'use strict';

// --- DOM ---
var deviceList = document.getElementById('deviceList');
var selfInfo = document.getElementById('selfInfo');
var refreshBtn = document.getElementById('refreshBtn');
var sendPanel = document.getElementById('sendPanel');
var targetDeviceName = document.getElementById('targetDeviceName');
var dropZone = document.getElementById('dropZone');
var pickerStep = document.getElementById('pickerStep');
var readyStep = document.getElementById('readyStep');
var readySummary = document.getElementById('readySummary');
var fileInput = document.getElementById('fileInput');
var folderInput = document.getElementById('folderInput');
var selectFolderBtn = document.getElementById('selectFolderBtn');
var selectFilesBtn = document.getElementById('selectFilesBtn');
var sendBtn = document.getElementById('sendBtn');
var saveLabel = document.getElementById('saveLabel');
var saveChangeBtn = document.getElementById('saveChangeBtn');
var saveFolderBtn = document.getElementById('saveFolderBtn');
var saveBrowser = document.getElementById('saveBrowser');
var sbCrumb = document.getElementById('sbCrumb');
var sbList = document.getElementById('sbList');
var sbUseBtn = document.getElementById('sbUseBtn');
var sbCancelBtn = document.getElementById('sbCancelBtn');
var histList = document.getElementById('histList');
var noHist = document.getElementById('noHist');

// --- Identity ---
var myDeviceId = localStorage.getItem('myDeviceId') || generateId();
localStorage.setItem('myDeviceId', myDeviceId);

function getFriendlyName() {
  var saved = localStorage.getItem('myDeviceName');
  if (saved) return saved;
  var ua = navigator.userAgent || '';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android Phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Mobile Device';
}
var myDeviceName = getFriendlyName();
localStorage.setItem('myDeviceName', myDeviceName);

// --- State ---
var devices = [];
var isHostDevice = false;
var selectedDeviceId = null;
var selectedFiles = [];
var transferActive = false; // one outgoing at a time
var transferAbort = null;
var saveRoot = '';
var destPath = (function(){ try{ return localStorage.getItem('ftDestPath') || localStorage.getItem('destPath') || ''; }catch(e){ return ''; } })();
var sbCurrentAbs = '';
var history = []; // unified: {key,dir,peer,count,size,status,live,speed,peak,path,names,transferId,time,_lastB,_lastT,_t0}
var knownRecv = {};
// This device's own receive location. Host saves to disk (server path);
// other devices auto-save via browser download or a picked folder (File System Access).
var phoneAuto = true; // always on — no toggle needed
var phoneDirHandle = null;
var phoneDirName = localStorage.getItem('phoneDirName') || '';
var FS_DIR = ('showDirectoryPicker' in window);

function generateId() {
  return 'dev_' + Math.random().toString(36).substr(2, 8) + Date.now().toString(36);
}
function fmtGB(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}
function fmtSpeed(bps) {
  if (!isFinite(bps) || bps < 0) bps = 0;
  if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
  if (bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
  return Math.round(bps) + ' B/s';
}
function normalizePath(p) { return String(p).split('\\').join('/'); }
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function saveDisplay() {
  // Host: real server-side path. Others: own local location.
  if (isHostDevice) {
    if (destPath) return saveRoot + '\\' + destPath.split('/').join('\\');
    return (saveRoot || 'PC folder') + ' (root)';
  }
  if (phoneDirHandle || phoneDirName) return 'Folder: ' + (phoneDirHandle ? phoneDirHandle.name : phoneDirName);
  return 'Downloads';
}
function saveRealPath() {
  if (!isHostDevice) return '';
  if (destPath) return saveRoot + '\\' + destPath.split('/').join('\\');
  return saveRoot || '';
}
// Show PC browser controls on host, folder picker elsewhere (if supported).
function updateSaveRow() {
  var host = isHostDevice;
  if (saveChangeBtn) saveChangeBtn.style.display = host ? '' : 'none';
  if (saveFolderBtn) saveFolderBtn.style.display = (!host && FS_DIR) ? '' : 'none';
  refreshSave();
}

// --- Registration / presence ---
async function registerDevice() {
  try {
    var resp = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: myDeviceId, name: myDeviceName, userAgent: navigator.userAgent || '', capabilities: ['send', 'receive'] })
    });
    if (!resp.ok) return;
    var data = await resp.json();
    if (data.id) { myDeviceId = data.id; localStorage.setItem('myDeviceId', myDeviceId); }
    isHostDevice = !!data.isHost;
    devices = data.devices || [];
    renderDevices();
    updateSaveRow();
  } catch(e) {}
}
async function sendHeartbeat() {
  try {
    await fetch('/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: myDeviceId }) });
  } catch(e) {}
}
async function fetchDevices() {
  try {
    var resp = await fetch('/devices');
    if (!resp.ok) return;
    devices = await resp.json();
    renderDevices();
  } catch(e) {}
}
function renderDevices() {
  var other = devices.filter(function(d) { return d.id !== myDeviceId && d.online !== false; });
  var me = devices.find(function(d) { return d.id === myDeviceId; });
  if (me) {
    selfInfo.textContent = me.name + ' (' + me.ip + ')' + (me.isHost ? ' · host' : '');
  }
  deviceList.innerHTML = '';
  if (!other.length) {
    deviceList.innerHTML = '<div class="empty">No other devices yet — open this page on another device on the same Wi-Fi.</div>';
    return;
  }
  other.forEach(function(d) {
    var isOpen = selectedDeviceId === d.id && sendPanel.style.display !== 'none';
    var label = isOpen ? 'Cancel' : 'Send';
    var cls = isOpen ? 'ghost' : 'btn';
    var dis = transferActive ? ' disabled' : '';
    var row = document.createElement('div');
    row.className = 'dev';
    row.innerHTML =
      '<div class="nm"><b>' + escHtml(d.name) + (d.isHost ? ' <span class="dim">· host</span>' : '') + '</b>' +
      '<div class="ip">' + escHtml(d.ip) + '</div></div>' +
      '<button class="' + cls + '" data-dev="' + d.id + '"' + dis + '>' + label + '</button>';
    deviceList.appendChild(row);
  });
  deviceList.querySelectorAll('[data-dev]').forEach(function(b) {
    b.onclick = function() { selectDevice(b.getAttribute('data-dev')); };
  });
}
refreshBtn.addEventListener('click', async function() {
  var orig = refreshBtn.textContent;
  refreshBtn.textContent = '…';
  refreshBtn.disabled = true;
  try {
    await Promise.all([fetchDevices(), pollIncoming(), loadSaveRoot(), loadPhoneDir()]);
    renderHistory();
  } catch(e) {}
  refreshBtn.textContent = orig;
  refreshBtn.disabled = false;
});

// --- Send panel: single box, 2 buttons; device Send toggles to Cancel ---
function selectDevice(id) {
  if (transferActive) return;
  // same device tapped again -> close popup (Send becomes Cancel toggle)
  if (selectedDeviceId === id && sendPanel.style.display !== 'none') {
    hideSendPanel();
    renderDevices();
    return;
  }
  var d = devices.find(function(x) { return x.id === id; });
  if (!d) return;
  selectedDeviceId = id;
  selectedFiles = [];
  targetDeviceName.textContent = 'Send to ' + d.name;
  pickerStep.style.display = '';
  readyStep.style.display = 'none';
  sendPanel.style.display = '';
  if (fileInput) fileInput.value = '';
  if (folderInput) folderInput.value = '';
  renderDevices();
  sendPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideSendPanel() {
  sendPanel.style.display = 'none';
  selectedDeviceId = null;
  selectedFiles = [];
  if (pickerStep) pickerStep.style.display = '';
  if (readyStep) readyStep.style.display = 'none';
}

selectFilesBtn.addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function() {
  if (!fileInput.files.length) return;
  var arr = Array.from(fileInput.files);
  arr.forEach(function(f) { f._relativePath = f.name; });
  setPicked(arr);
  fileInput.value = '';
});
selectFolderBtn.addEventListener('click', function() { folderInput.value = ''; folderInput.click(); });
folderInput.addEventListener('change', function() {
  if (!folderInput.files.length) return;
  var arr = Array.from(folderInput.files);
  arr.forEach(function(f) { f._relativePath = f.webkitRelativePath || f.name; });
  setPicked(arr);
  folderInput.value = '';
});
function setDropOver(v) { if (v) sendPanel.classList.add('over'); else sendPanel.classList.remove('over'); }
if (dropZone) {
  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); setDropOver(true); });
  dropZone.addEventListener('dragleave', function() { setDropOver(false); });
}
sendPanel.addEventListener('dragover', function(e) { e.preventDefault(); setDropOver(true); });
sendPanel.addEventListener('dragleave', function() { setDropOver(false); });
sendPanel.addEventListener('drop', function(e) {
  e.preventDefault();
  setDropOver(false);
  if (!selectedDeviceId || transferActive) return;
  var all = [], pending = [];
  Array.from(e.dataTransfer.items).forEach(function(it) {
    var en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
    if (en) pending.push(scan(en, ''));
  });
  if (!pending.length) {
    Array.from(e.dataTransfer.files).forEach(function(f) { f._relativePath = f.name; all.push(f); });
    if (all.length) setPicked(all);
    return;
  }
  Promise.all(pending).then(function() { if (all.length) setPicked(all); });
  function scan(entry, base) {
    return new Promise(function(res) {
      if (entry.isFile) {
        entry.file(function(f) { f._relativePath = base + f.name; all.push(f); res(); }, function() { res(); });
      } else if (entry.isDirectory) {
        var r = entry.createReader(), dp = base + entry.name + '/';
        (function read() {
          r.readEntries(function(b) {
            if (!b.length) { res(); return; }
            Promise.all(Array.from(b).map(function(x) { return scan(x, dp); })).then(read);
          }, function() { res(); });
        })();
      } else res();
    });
  }
});

function setPicked(files) {
  files.forEach(function(f) { if (!f._relativePath) f._relativePath = f.webkitRelativePath || f.name; });
  selectedFiles = files;
  var bytes = files.reduce(function(s, f) { return s + f.size; }, 0);
  readySummary.textContent = files.length + ' selected (' + fmtGB(bytes) + ') — hits Send and this panel closes; watch it below.';
  pickerStep.style.display = 'none';
  readyStep.style.display = '';
}

// --- Unified history ---
function statusLabel(e) {
  // Row-2 left: live speed while moving, plain state word when settled.
  if (e.dir === 'up') {
    if (e.status === 'sending') return fmtSpeed(e.speed);
    if (e.status === 'done') return 'Sent';
    if (e.status === 'stopped') return 'Stopped';
    return 'Sending';
  }
  if (e.status === 'receiving') return fmtSpeed(e.speed);
  if (e.status === 'ready') return (e.savedToFolder || e.savedToDownloads) ? 'Saved' : 'Tap Get';
  if (e.status === 'done') return 'Received';
  return e.status;
}
function renderHistory() {
  histList.innerHTML = '';
  if (!history.length) { noHist.style.display = ''; return; }
  noHist.style.display = 'none';
  history.forEach(function(e) {
    var el = document.createElement('div');
    el.className = 'h';
    var active = (e.status === 'sending' || e.status === 'receiving');
    // Row 1: badge + file name (ellipsis) … size + count. Tap row to reveal in folder (on host).
    var canReveal = isHostDevice && e.path && (e.status === 'done' || e.status === 'ready') && e.transferId;
    var title = e.count > 1
      ? escHtml((e.names || [])[0] || 'files') + ' +' + (e.count - 1) + ' more'
      : escHtml((e.names || [])[0] || 'files');
    var sizeTxt = fmtGB(e.size) + ' · ' + e.count + (e.count === 1 ? ' file' : ' files');
    // Row 2: speed-or-state … peer + folder path.
    var arrow = e.dir === 'up' ? '↑' : '↓';
    var dest = arrow + ' ' + e.peer + (e.path ? ' · ' + e.path : '');
    var arrowWhite = '<span style="color:#fff;font-weight:800;font-size:18px">' + escHtml(arrow) + '</span>';
    var destHtml = arrowWhite + ' ' + escHtml(e.peer) + (e.path ? ' <span style="color:#888">·</span> ' + escHtml(e.path) : '');
    var html =
      '<div class="l1"' + (canReveal ? ' data-reveal="' + escHtml(e.transferId) + '" data-name="' + escHtml((e.names||[])[0]||e.files&&e.files[0]&&e.files[0].name||'') + '" style="cursor:pointer" title="Show in folder"' : '') + '><span class="dir" title="' + (e.dir==='up'?'Upload':'Download') + '">' + (e.dir === 'up' ? '↑' : '↓') + '</span>' +
      '<span class="nm">' + title + '</span>' +
      '<span class="sz">' + sizeTxt + '</span></div>' +
      '<div class="l2"><span class="sp">' + escHtml(statusLabel(e)) + '</span>' +
      (e.path
        ? '<span class="pp"' + (canReveal ? ' data-reveal="' + escHtml(e.transferId) + '" data-name="' + escHtml((e.names||[])[0]||e.files&&e.files[0]&&e.files[0].name||'') + '" style="cursor:pointer;text-decoration:underline" title="Show in folder"' : ' data-copy="' + escHtml(e.path) + '" title="tap to copy"') + '>' + destHtml + '</span>'
        : '<span class="pp">' + destHtml + '</span>') +
      '</div>';
    if (active) {
      var pct = e.size > 0 ? Math.round((Math.min(e.live, e.size) / e.size) * 100) : 0;
      html += '<div class="bar"><i style="width:' + pct + '%"></i></div>';
    }
    if (e.dir === 'up' && e.status === 'sending') {
      html += '<div class="acts"><button class="ghost" data-stop="' + e.key + '">Stop</button></div>';
    }
    if (e.dir === 'down' && e.status === 'ready' && e.savedToFolder) {
      html += '<div class="meta">Saved to ' + escHtml(e.savedToFolder) + ' — no download needed</div>';
    } else if (e.dir === 'down' && e.status === 'ready') {
      if (e.savedToDownloads) html += '<div class="meta">Saved to Downloads</div>';
      html += '<div style="margin-top:6px">';
      if (e.count > 1) html += '<button class="btn" data-dlall="' + e.transferId + '" style="width:100%;margin-bottom:6px">Download all (' + e.count + ')</button>';
      (e.files || []).forEach(function(f) {
        var url = '/download-transfer-file?transferId=' + encodeURIComponent(e.transferId) + '&name=' + encodeURIComponent(f.name);
        html += '<div class="dl"><span data-reveal="' + escHtml(e.transferId) + '" data-name="' + escHtml(f.name) + '" style="cursor:pointer">' + escHtml(f.name) + ' (' + fmtGB(f.size) + ')</span><a href="' + url + '" download="' + escHtml(f.name) + '">Get</a></div>';
      });
      html += '</div>';
    }

    el.innerHTML = html;
    histList.appendChild(el);
  });
}
document.addEventListener('click', function(ev) {
  var t = ev.target;
  if (!t || !t.getAttribute) return;
  var rv = t.getAttribute('data-reveal');
  if (rv) {
    var nm = t.getAttribute('data-name') || '';
    // clicking a file span inside a ready row should reveal that specific file
    if (t.classList && t.classList.contains('dl')) nm = t.textContent.trim().split(' (')[0];
    revealInFolder(rv, nm);
    return;
  }
  // bubble up: row's l1/pp may contain the attribute, check parents
  var p = t.parentElement;
  while (p && p !== histList) {
    var pr = p.getAttribute && p.getAttribute('data-reveal');
    if (pr) { revealInFolder(pr, p.getAttribute('data-name')||''); return; }
    p = p.parentElement;
  }
  var all = t.getAttribute('data-dlall');
  if (all) { downloadAll(all); return; }
  var cp = t.getAttribute('data-copy');
  if (cp) { copyText(cp); return; }
  var st = t.getAttribute('data-stop');
  if (st) {
    if (transferAbort) { try { transferAbort.abort(); } catch(e) {} }
  }
});
function revealInFolder(transferId, name) {
  fetch('/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transferId: transferId, name: name || '' })
  }).catch(function() {});
}
function downloadAll(transferId) {
  var links = histList.querySelectorAll('a[href*="' + transferId + '"]');
  links.forEach(function(a, i) { setTimeout(function() { a.click(); }, i * 400); });
}
function copyText(s) {
  function done() {}
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(done, function() { prompt('Copy path:', s); });
  } else {
    prompt('Copy path:', s);
  }
}
// Background write — now incremental via queuePhoneDownloads
async function saveToPhoneDirAsync(entry) { queuePhoneDownloads(entry, entry.files||[]); }
async function ackTransfer(transferId, action) {
  // Accept tap is a user gesture: use it to (re-)grant folder permission.
  if (action === 'accept' && FS_DIR && phoneDirHandle) {
    try { await phoneDirHandle.requestPermission({ mode: 'readwrite' }); } catch(e) {}
  }
  try {
    await fetch('/ack-transfer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: myDeviceId, transferId: transferId, action: action })
    });
    pollIncoming();
  } catch(e) {}
}

// --- Outgoing ---
sendBtn.addEventListener('click', function() {
  if (!selectedFiles.length || !selectedDeviceId || transferActive) return;
  startSend();
});
function uploadFileXHR(url, file, onProg) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (transferAbort) {
      transferAbort.signal.addEventListener('abort', function() { try { xhr.abort(); } catch(e) {} });
    }
    xhr.upload.onprogress = function(e) { if (e.lengthComputable) onProg(e.loaded); };
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = function() { reject(new Error('Network error')); };
    xhr.onabort = function() { var er = new Error('Aborted'); er.name = 'AbortError'; reject(er); };
    try { xhr.send(file); } catch(e) { reject(e); }
  });
}
async function startSend() {
  var target = devices.find(function(d) { return d.id === selectedDeviceId; });
  var toHost = !!(target && target.isHost);
  var list = selectedFiles.map(function(f) {
    var rel = f._relativePath || f.webkitRelativePath || f.name;
    var up = (toHost && destPath) ? (destPath + '/' + rel) : rel;
    return { name: up, display: rel, size: f.size, _file: f, _loaded: 0 };
  }).filter(function(f) {
    var l = normalizePath(f.name).toLowerCase();
    return l.indexOf('.git/') === -1 && l !== '.git';
  });
  list.sort(function(a,b){ return a.size - b.size; });
  if (!list.length) return;
  transferActive = true;
  transferAbort = new AbortController();
  renderDevices();
  var entry = {
    key: 'u_' + Date.now(), dir: 'up', peer: target ? target.name : 'device',
    count: list.length, size: list.reduce(function(s, f) { return s + f.size; }, 0),
    status: 'sending', live: 0, speed: 0, peak: 0, avg: 0,
    path: toHost ? saveDisplay() : '',
    names: list.slice(0, 8).map(function(f) { return f.display; }),
    transferId: null, time: new Date().toLocaleTimeString(),
    _lastB: 0, _lastT: Date.now(), _t0: Date.now()
  };
  history.unshift(entry);
  if (history.length > 30) history.pop();
  hideSendPanel(); // picker gone the moment Send is hit; progress lives below
  renderHistory();
  var sentBytes = 0, completed = 0, startTime = Date.now();
  var bytesTotal = entry.size;

  function tick() {
    var live = sentBytes;
    for (var i = 0; i < list.length; i++) live += (list[i]._loaded || 0);
    if (live > bytesTotal) live = bytesTotal;
    var now = Date.now(), dt = (now - entry._lastT) / 1000;
    var inst = dt > 0 ? (live - entry._lastB) / dt : 0;
    if (inst < 0) inst = 0;
    var avg = (now - entry._t0) / 1000 > 0 ? live / ((now - entry._t0) / 1000) : 0;
    entry.live = live;
    entry.speed = (live < bytesTotal && inst > 0) ? inst : avg;
    if (entry.speed > entry.peak) entry.peak = entry.speed;
    entry._lastB = live; entry._lastT = now;
    renderHistory();
  }
  var uiTimer = setInterval(function() { if (transferActive && entry.status === 'sending') tick(); }, 500);

  function spawn(conn) {
    var active = 0, idx = 0;
    return new Promise(function(done) {
      function next() {
        if (!transferActive) return fin();
        if (idx >= list.length) { if (active === 0) fin(); return; }
        while (active < conn && idx < list.length) {
          if (!transferActive) break;
          active++;
          one(list[idx++]).then(function() { active--; next(); }, function() { active--; next(); });
        }
      }
      function fin() {
        try { clearInterval(fin._t); } catch(e) {}
        done();
      }
      fin._t = setInterval(function() { if (idx >= list.length && active === 0) fin(); }, 100);
      next();
    });
    const CHUNK_SIZE = 8 * 1024 * 1024;
    const CHUNK_THRESHOLD = 16 * 1024 * 1024;
    async function one(item) {
      if (!transferActive) return;
      // Large single file: split into 8MB chunks, 4 parallel (biggest win for 300MB)
      if (item._file.size > CHUNK_THRESHOLD) {
        const totalChunks = Math.ceil(item._file.size / CHUNK_SIZE);
        let chunkLoaded = new Array(totalChunks).fill(0);
        const updateLoaded = () => { item._loaded = chunkLoaded.reduce((a,b)=>a+b, 0); };
        let nextIdx = 0;
        let active = 0;
        const MAX_PAR = 4;
        try {
          await new Promise((resolve, reject) => {
            let done = 0;
            let failedErr = null;
            function launch() {
              if (failedErr) return;
              while (active < MAX_PAR && nextIdx < totalChunks && !failedErr) {
                const ci = nextIdx++;
                const start = ci * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, item._file.size);
                const slice = item._file.slice(start, end);
                active++;
                (async () => {
                  for (let ca=0; ca<2; ca++) {
                    if (!transferActive) { failedErr = new Error('Aborted'); failedErr.name='AbortError'; reject(failedErr); return; }
                    try {
                      const curl = '/upload?name=' + encodeURIComponent(item.name) + '&size=' + item.size + (entry.transferId ? '&transferId=' + encodeURIComponent(entry.transferId) : '') + '&chunkIndex=' + ci + '&totalChunks=' + totalChunks;
                      await uploadFileXHR(curl, slice, (ld) => { chunkLoaded[ci]=ld; updateLoaded(); });
                      break;
                    } catch(e) {
                      if (e.name==='AbortError') { failedErr=e; reject(e); return; }
                      const retriable = (e.message==='Network error' || e.name==='TypeError' || /Network/.test(e.message) || e.status>=500);
                      if (retriable && ca===0) { await new Promise(r=>setTimeout(r,700)); continue; }
                      failedErr=e; reject(e); return;
                    }
                  }
                  // mark this chunk as fully uploaded for progress
                  const isLast = ci===totalChunks-1;
                  const expected = isLast ? (item._file.size - ci*CHUNK_SIZE) : CHUNK_SIZE;
                  chunkLoaded[ci]=expected;
                  updateLoaded();
                  active--;
                  done++;
                  if (done===totalChunks) resolve();
                  else launch();
                })();
              }
            }
            launch();
          });
          item._loaded = 0; completed++; sentBytes += item.size;
          entry.live = Math.min(sentBytes, bytesTotal);
          tick();
          return;
        } catch(err) {
          item._loaded = 0;
          if (err.name==='AbortError') { transferActive=false; throw err; }
          completed++; sentBytes += item.size;
          entry._failed = (entry._failed||0)+1;
          tick();
          return;
        }
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!transferActive) return;
        try {
          var url = '/upload?name=' + encodeURIComponent(item.name) + '&size=' + item.size +
            (entry.transferId ? '&transferId=' + encodeURIComponent(entry.transferId) : '');
          await uploadFileXHR(url, item._file, function(ld) { item._loaded = ld; });
          item._loaded = 0; completed++; sentBytes += item.size;
          entry.live = Math.min(sentBytes, bytesTotal);
          tick();
          return;
        } catch(err) {
          item._loaded = 0;
          if (err.name === 'AbortError') { transferActive = false; throw err; }
          const retriable = (err.message === 'Network error' || err.name === 'TypeError' || /Network/.test(err.message) || err.status >= 500);
          if (retriable && attempt === 0) {
            await new Promise(r => setTimeout(r, 700));
            continue;
          }
          completed++; sentBytes += item.size;
          entry._failed = (entry._failed || 0) + 1;
          tick();
          return;
        }
      }
    }
  }

  try {
    var resp = await fetch('/send-to-device', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetDeviceId: target.id, senderId: myDeviceId,
        files: list.map(function(f) { return { name: f.name, size: f.size }; })
      })
    });
    var res = await resp.json();
    if (!res.success) throw new Error(res.error || 'start failed');
    entry.transferId = res.transferId;
    // Server auto-accepts — upload starts immediately, no waiting.
    entry.status = 'sending';
    renderHistory();
    await spawn(6);
  } catch(e) {
    entry.status = 'stopped';
    try { clearInterval(uiTimer); } catch(err) {}
    transferActive = false;
    renderDevices();
    renderHistory();
    return;
  }

  settleSend(entry, startTime, bytesTotal, uiTimer);
}

function settleSend(ent, startTime, bytesTotal, uiTimer) {
  try { clearInterval(uiTimer); } catch(e) {}
  if (!transferActive && ent.status === 'sending') {
    ent.status = 'stopped'; // user hit Stop mid-flight
  } else if (ent.status === 'sending') {
    ent.status = 'done';
    ent.live = bytesTotal;
    ent.avg = bytesTotal / (((Date.now() - startTime) / 1000) || 1);
    ent.speed = ent.avg;
  }
  transferActive = false;
  renderDevices();
  renderHistory();
}

// --- Incoming poll -> unified history ---
async function pollIncoming() {
  try {
    var resp = await fetch('/incoming?deviceId=' + encodeURIComponent(myDeviceId));
    if (!resp.ok) return;
    var transfers = await resp.json();
    var seen = {};
    for (var i = 0; i < transfers.length; i++) {
      var t = transfers[i];
      if (t.status === 'pending') {
        // No manual accept step — approve immediately so receiving starts itself.
        t.status = 'accepted';
        ackTransfer(t.id, 'accept');
      }
      seen[t.id] = true;
      var e = history.find(function(x) { return x.key === 'r_' + t.id; });
      if (!e) {
        e = {
          key: 'r_' + t.id, dir: 'down', peer: t.senderName,
          count: (t.files || []).length, size: t.totalSize || 0,
          status: 'receiving',
          live: 0, speed: 0, peak: 0, path: saveDisplay(),
          names: (t.files || []).slice(0, 8).map(function(f) { return f.name; }),
          files: t.files || [], transferId: t.id,
          time: new Date().toLocaleTimeString(),
          _lastB: 0, _lastT: Date.now(), _t0: Date.now()
        };
        history.unshift(e);
        if (history.length > 30) history.pop();
        knownRecv[t.id] = true;
      }
      e.count = (t.files || []).length;
      e.size = t.totalSize || e.size;
      e.files = t.files || e.files;
      // Completed and ready are terminal — mark done even if first time we see them
      // (fixes the bug where a fast 108 MB file finished between two polls and
      // got stuck at 0 B/s because only 'accepted'/'ready' were handled).
      if (t.status === 'completed') {
        e.status = 'done';
        e.live = e.size;
        e.path = saveDisplay();
      } else if (t.status === 'ready') {
        e.status = 'ready';
        e.live = e.size;
        e.path = saveDisplay();
        if (!isHostDevice) queuePhoneDownloads(e, e.files || []);
      } else if (t.status === 'accepted') {
        if (e.status !== 'receiving') { e.status = 'receiving'; e._t0 = e._t0 || Date.now(); }
        try {
          var r = await fetch('/transfer-status?transferId=' + encodeURIComponent(t.id));
          if (r.ok) {
            var d = await r.json();
            var b = d.receivedBytes || 0;
            var now = Date.now(), dt = (now - e._lastT) / 1000;
            var inst = dt > 0 ? (b - e._lastB) / dt : 0;
            if (inst < 0) inst = 0;
            var avg = (now - e._t0) / 1000 > 0 ? b / ((now - e._t0) / 1000) : 0;
            e.live = Math.min(b, e.size);
            e.speed = (e.live < e.size && inst > 0) ? inst : avg;
            if (e.speed > e.peak) e.peak = e.speed;
            e._lastB = b; e._lastT = now;
            // Trust the server's terminal status even if t.status was still 'accepted'
            // when we polled /incoming — the status can flip to completed/ready
            // between the two requests.
            if (d.status === 'ready' || d.status === 'completed') {
              e.status = d.status === 'ready' ? 'ready' : 'done';
              e.live = e.size;
              e.speed = 0;
              e.path = saveDisplay();
              // Incremental: start each file as it lands (overlap upload+download)
              if (!isHostDevice && d.uploadedFiles && d.uploadedFiles.length) {
                queuePhoneDownloads(e, d.uploadedFiles);
              }
              if (d.status === 'ready' && !isHostDevice && !e._autoDone) {
                e._autoDone = true;
                if (d.uploadedFiles && d.uploadedFiles.length) queuePhoneDownloads(e, d.uploadedFiles);
                else if (phoneDirHandle) queuePhoneDownloads(e, e.files || []);
                else if (phoneAuto) { e.savedToDownloads = true; renderHistory(); }
              }
            }
          }
        } catch(err) {}
      }
    }
    renderHistory();
  } catch(e) {}
}

// --- Save location ---
async function loadSaveRoot() {
  // Restore previously chosen PC folder (survives page reload / server restart)
  var storedRoot = null;
  try { storedRoot = localStorage.getItem('destRoot'); } catch(e) {}
  if (storedRoot && storedRoot !== saveRoot) {
    try {
      await fetch('/set-dest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: storedRoot }) });
    } catch(e) {}
  }
  try {
    var r = await fetch('/dest-root');
    var d = await r.json();
    if (d.root) {
      saveRoot = d.root;
      try { localStorage.setItem('destRoot', saveRoot); } catch(e) {}
      // Validate stored destPath still makes sense; if not under current root, it will be recreated on next upload — keep it.
      refreshSave();
      // after root is known, re-apply stored subpath display
      var storedPath = null;
      try { storedPath = localStorage.getItem('ftDestPath') || localStorage.getItem('destPath'); } catch(e) {}
      if (storedPath !== null && storedPath !== destPath) {
        destPath = storedPath;
        try { localStorage.setItem('ftDestPath', destPath); } catch(e) {}
        refreshSave();
      }
      renderHistory();
    }
  } catch(e) {}
}
function persistDest() {
  try {
    localStorage.setItem('ftDestPath', destPath);
    localStorage.setItem('destPath', destPath);
    if (saveRoot) localStorage.setItem('destRoot', saveRoot);
  } catch(e) {}
}
function refreshSave() {
  if (saveLabel) saveLabel.textContent = saveDisplay();
  history.forEach(function(e) {
    if (e.dir === 'down' && (e.status === 'receiving' || e.status === 'done' || e.status === 'pending')) e.path = saveDisplay();
  });
}
if (saveChangeBtn) saveChangeBtn.addEventListener('click', function() {
  saveBrowser.style.display = saveBrowser.style.display === 'none' ? '' : 'none';
  if (saveBrowser.style.display !== 'none') sbDrives();
});
if (saveLabel) saveLabel.addEventListener('click', function() {
  if (!isHostDevice) return; // phones have no PC folder to reveal
  var p = saveRealPath();
  if (!p) return;
  fetch('/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p }) }).catch(function(){});
});
// Phone control: optional real folder (File System Access) — saving is always automatic.
if (saveFolderBtn) saveFolderBtn.addEventListener('click', async function() {
  try {
    var h = await window.showDirectoryPicker({ mode: 'readwrite' });
    phoneDirHandle = h;
    phoneDirName = h.name || '';
    try { localStorage.setItem('phoneDirName', phoneDirName); } catch(e) {}
    idbSet('dir', h).catch(function() {});
    updateSaveRow();
    renderHistory();
  } catch(e) { /* user cancelled */ }
});
// Tiny IndexedDB wrapper to persist the picked folder handle.
function idbOpen() {
  return new Promise(function(res, rej) {
    try {
      var q = indexedDB.open('ft-save', 1);
      q.onupgradeneeded = function() { q.result.createObjectStore('s'); };
      q.onsuccess = function() { res(q.result); };
      q.onerror = function() { rej(q.error); };
    } catch(e) { rej(e); }
  });
}
function idbSet(k, v) {
  return idbOpen().then(function(db) {
    return new Promise(function(res, rej) {
      try {
        var tx = db.transaction('s', 'readwrite');
        tx.objectStore('s').put(v, k);
        tx.oncomplete = function() { res(); };
        tx.onerror = function() { rej(tx.error); };
      } catch(e) { rej(e); }
    });
  });
}
function idbGet(k) {
  return idbOpen().then(function(db) {
    return new Promise(function(res, rej) {
      try {
        var tx = db.transaction('s', 'readonly');
        var q = tx.objectStore('s').get(k);
        q.onsuccess = function() { res(q.result); };
        q.onerror = function() { rej(q.error); };
      } catch(e) { rej(e); }
    });
  });
}
async function loadPhoneDir() {
  if (!FS_DIR) return;
  try {
    var h = await idbGet('dir');
    if (h) {
      phoneDirHandle = h;
      if (!phoneDirName && h.name) {
        phoneDirName = h.name;
        try { localStorage.setItem('phoneDirName', phoneDirName); } catch(e) {}
      }
      updateSaveRow();
    }
  } catch(e) {}
}
// Parallel streaming save into picked folder (or Downloads fallback) — per-file as it lands
async function saveSingleFile(dirHandle, transferId, file) {
  for (let attempt=0; attempt<2; attempt++) {
    try {
      if (dirHandle) {
        try { const perm = await dirHandle.queryPermission({mode:'readwrite'}); if (perm!=='granted') throw new Error('no perm'); } catch(e){ throw e; }
      }
      const url = '/download-transfer-file?transferId=' + encodeURIComponent(transferId) + '&name=' + encodeURIComponent(file.name);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('fetch '+resp.status);
      if (dirHandle) {
        const parts = String(file.name).split('/').filter(Boolean);
        let d = dirHandle;
        for (let i=0;i<parts.length-1;i++) d = await d.getDirectoryHandle(parts[i], {create:true});
        const fh = await d.getFileHandle(parts[parts.length-1]||'file', {create:true});
        const writable = await fh.createWritable();
        if (resp.body && typeof resp.body.pipeTo === 'function') {
          await resp.body.pipeTo(writable);
        } else {
          const blob = await resp.blob();
          await writable.write(blob);
          await writable.close();
        }
        return true;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.split('/').pop() || 'file';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise(r=>setTimeout(r, 400));
        return true;
      }
    } catch(e) {
      if (attempt===0) { await new Promise(r=>setTimeout(r,700)); continue; }
      return false;
    }
  }
  return false;
}
function queuePhoneDownloads(entry, uploadedFiles) {
  if (isHostDevice) return;
  if (!uploadedFiles || !uploadedFiles.length) return;
  if (!entry._downloaded) entry._downloaded = new Set();
  if (!entry._downloading) entry._downloading = new Set();
  if (!entry._queue) entry._queue = [];
  if (entry._active == null) entry._active = 0;
  const MAX_PAR = 3;
  for (const f of uploadedFiles) {
    if (!entry._downloaded.has(f.name) && !entry._downloading.has(f.name) && !entry._queue.some(x=>x.name===f.name)) {
      entry._queue.push(f);
    }
  }
  while (entry._active < MAX_PAR && entry._queue.length) {
    const file = entry._queue.shift();
    entry._downloading.add(file.name);
    entry._active++;
    (async () => {
      const ok = await saveSingleFile(phoneDirHandle, entry.transferId, file);
      entry._downloading.delete(file.name);
      entry._active--;
      if (ok) {
        entry._downloaded.add(file.name);
        if (entry._downloaded.size >= entry.count) {
          entry.savedToFolder = phoneDirHandle ? (phoneDirHandle.name||'picked folder') : null;
          entry.savedToDownloads = !phoneDirHandle && phoneAuto ? true : entry.savedToDownloads;
        }
        renderHistory();
      } else {
        if (!file._retried) { file._retried=true; entry._queue.push(file); }
      }
      if (entry._queue.length) queuePhoneDownloads(entry, []);
    })();
  }
}
// Legacy wrapper kept for compatibility (now parallel)
async function saveToPhoneDir(entry) {
  if (!phoneDirHandle) return false;
  queuePhoneDownloads(entry, entry.files || []);
  return true;
}
if (sbCancelBtn) sbCancelBtn.addEventListener('click', function() { saveBrowser.style.display = 'none'; });
async function sbDrives() {
  sbList.innerHTML = '<div class="empty">Loading…</div>';
  sbCrumb.innerHTML = 'This PC';
  sbCurrentAbs = '';
  try {
    var r = await fetch('/drives');
    var drives = await r.json();
    if (!drives.length) { sbList.innerHTML = '<div class="empty">No drives</div>'; return; }
    sbList.innerHTML = '';
    drives.forEach(function(d) {
      var row = document.createElement('div');
      row.className = 'f';
      row.innerHTML = '<span>' + escHtml(d.letter + (d.name ? ' (' + d.name + ')' : '')) + '</span><span class="dim">›</span>';
      row.onclick = function() { sbAbs(d.letter + '\\'); };
      sbList.appendChild(row);
    });
    sbUseBtn.textContent = 'Use default';
  } catch(e) { sbList.innerHTML = '<div class="empty">Failed to load</div>'; }
}
async function sbAbs(abs) {
  abs = normalizePath(abs);
  if (/^[A-Za-z]:$/.test(abs)) abs = abs + '/';
  sbCurrentAbs = abs;
  sbList.innerHTML = '<div class="empty">Loading…</div>';
  var parts = abs.split('/').filter(Boolean), acc = '', bc = '<span class="c" data-p="">This PC</span>';
  for (var i = 0; i < parts.length; i++) {
    acc = i === 0 ? parts[0] : acc + '/' + parts[i];
    bc += ' / <span class="c" data-p="' + escHtml(acc) + '">' + escHtml(parts[i]) + '</span>';
  }
  sbCrumb.innerHTML = bc;
  sbCrumb.querySelectorAll('.c').forEach(function(el) {
    el.onclick = function() {
      var p = el.getAttribute('data-p');
      if (!p) sbDrives(); else sbAbs(p);
    };
  });
  try {
    var r = await fetch('/dir-tree?abs=' + encodeURIComponent(abs));
    var dirs = await r.json();
    sbList.innerHTML = '';
    if (!dirs.length) sbList.innerHTML = '<div class="empty">No subfolders — can still use this folder.</div>';
    dirs.forEach(function(d) {
      var row = document.createElement('div');
      row.className = 'f';
      row.innerHTML = '<span>/' + escHtml(d) + '</span><span class="dim">›</span>';
      row.onclick = function() {
        var sep = abs.charAt(abs.length - 1) === '/' ? '' : '/';
        sbAbs(abs + sep + d);
      };
      sbList.appendChild(row);
    });
    sbUseBtn.textContent = 'Use: ' + abs;
  } catch(e) { sbList.innerHTML = '<div class="empty">Failed to load</div>'; }
}
if (sbUseBtn) sbUseBtn.addEventListener('click', async function() {
  if (!sbCurrentAbs) { destPath = ''; persistDest(); saveBrowser.style.display = 'none'; refreshSave(); renderHistory(); return; }
  var cur = normalizePath(sbCurrentAbs).replace(/\/$/, '');
  var root = normalizePath(saveRoot || '').replace(/\/$/, '');
  if (root && (cur === root || cur.indexOf(root + '/') === 0)) {
    destPath = cur === root ? '' : cur.slice(root.length + 1);
    persistDest();
    saveBrowser.style.display = 'none';
    refreshSave(); renderHistory();
  } else {
    try {
      var r = await fetch('/set-dest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: sbCurrentAbs }) });
      var d = await r.json();
      if (d.root) {
        saveRoot = d.root; destPath = '';
        persistDest();
        saveBrowser.style.display = 'none';
        refreshSave(); renderHistory();
      }
    } catch(e) {}
  }
});

// --- Init ---
loadSaveRoot();
loadPhoneDir();
registerDevice();
setInterval(sendHeartbeat, 8000);
setInterval(function() { if (!transferActive) fetchDevices(); }, 4000);
setInterval(pollIncoming, 2500);
setInterval(function() {
  var anyLive = history.some(function(e) { return e.status === 'sending' || e.status === 'receiving'; });
  if (anyLive) renderHistory();
}, 800);
fetchDevices();
pollIncoming();
window.addEventListener('beforeunload', function() {
  fetch('/unregister', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: myDeviceId }), keepalive: true });
});

})();

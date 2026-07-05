// client.js — Browser JS for sender page (standalone, no template literals)
// This file is read by server.js at startup and injected into senderHtml.

(function() {
'use strict';

window.onerror = function(msg, url, line) {
  var statusText = document.getElementById('statusText');
  var progressWrap = document.getElementById('progressWrap');
  if (progressWrap) progressWrap.classList.add('active');
  if (statusText) {
    statusText.innerHTML = 'JS ERROR: ' + msg + ' (line ' + line + ')';
    statusText.style.color = '#f33';
  }
};

// --- DOM refs ---
var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('fileInput');
var folderInput = document.getElementById('folderInput');
var selectFolderBtn = document.getElementById('selectFolderBtn');
var selectFilesBtn = document.getElementById('selectFilesBtn');
var sendBtn = document.getElementById('sendBtn');
var stopBtn = document.getElementById('stopBtn');
var resendBtn = document.getElementById('resendBtn');
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
var destBrowser = document.getElementById('destBrowser');
var dbBreadcrumb = document.getElementById('dbBreadcrumb');
var dbList = document.getElementById('dbList');
var dbUseBtn = document.getElementById('dbUseBtn');
var dbRootBtn = document.getElementById('dbRootBtn');
var dbCancelBtn = document.getElementById('dbCancelBtn');
var destBrowseBtn = document.getElementById('destBrowseBtn');
var destLabel = document.getElementById('destLabel');
var saveToLabel = document.getElementById('saveToLabel');

// --- State ---
var destPath = '';
var saveDir = 'D:\\art';
var selectedFiles = [];
var transferAbort = null;
var transferActive = false;
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

// --- Helpers ---
function fmtGB(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  return b + ' B';
}

function normalizePath(p) {
  return p.split('\\').join('/');
}

// --- Skip folders (localStorage) ---
var defaultSkipFolders = ['node_modules'];
var skipFolders = JSON.parse(localStorage.getItem('skipFolders') || 'null') || defaultSkipFolders.slice();

function saveSkipFolders() {
  localStorage.setItem('skipFolders', JSON.stringify(skipFolders));
}

function renderSkipTags() {
  var el = document.getElementById('skipTags');
  var cnt = document.getElementById('skipCount');
  if (!el) return;
  el.innerHTML = '';
  skipFolders.forEach(function(name) {
    var tag = document.createElement('span');
    tag.className = 'skip-tag';
    tag.innerHTML = name + '<span class="x" data-skip="' + name + '">&times;</span>';
    el.appendChild(tag);
  });
  if (cnt) cnt.textContent = skipFolders.length + ' rules';
  el.querySelectorAll('.x').forEach(function(x) {
    x.addEventListener('click', function() {
      skipFolders = skipFolders.filter(function(s) { return s !== x.getAttribute('data-skip'); });
      saveSkipFolders();
      renderSkipTags();
    });
  });
}

function initSkipPanel() {
  var head = document.getElementById('skipPanelHead');
  var body = document.getElementById('skipPanelBody');
  var input = document.getElementById('skipInput');
  var addBtn = document.getElementById('skipAddBtn');
  if (head) head.addEventListener('click', function() {
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });
  if (addBtn) addBtn.addEventListener('click', function() {
    var val = input.value.trim();
    if (val && skipFolders.indexOf(val) === -1) {
      skipFolders.push(val);
      saveSkipFolders();
      renderSkipTags();
    }
    input.value = '';
    input.focus();
  });
  if (input) input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addBtn.click();
  });
  renderSkipTags();
}

// --- Destination root (localStorage) ---
var savedDest = localStorage.getItem('destRoot');
if (savedDest) {
  saveDir = savedDest;
  fetch('/set-dest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: saveDir })
  }).catch(function() {});
}

// --- Stop / Resend ---
stopBtn.addEventListener('click', function() {
  if (transferAbort) transferAbort.abort();
  transferActive = false;
  stopBtn.style.display = 'none';
  statusText.textContent = '\u23f9 Transfer stopped';
  statusText.style.color = '#ff9800';
});

resendBtn.addEventListener('click', function() {
  resendBtn.style.display = 'none';
  if (selectedFiles.length) startSend();
});

// --- Counts & logs ---
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

function renderLogs() {
  logPanel.innerHTML = '';
  var filtered = activeFilter === 'all' ? allLogs : allLogs.filter(function(l) { return l.type === activeFilter; });
  if (!filtered.length) {
    logPanel.innerHTML = '<div style="color:#666">No entries yet</div>';
    return;
  }
  filtered.forEach(function(l) {
    var d = document.createElement('div');
    var icon = '';
    var cls = l.type;
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

function addLog(entry) {
  allLogs.push(entry);
  if (entry.type === 'saved') { localSaved++; localSavedBytes += (entry.size || 0); }
  else if (entry.type === 'skip') { localSkipped++; localSkippedBytes += (entry.size || 0); }
  else if (entry.type === 'error') { localFailedCount++; localFailedBytes += (entry.size || 0); }
  updateCounts();
  renderLogs();
}

function addLocalSkipLog(msg, size, dedupKey) {
  addLog({ time: new Date().toLocaleTimeString(), msg: msg, type: 'skip', size: size, dedupKey: dedupKey });
}

function setFiles(files) {
  files.forEach(function(f) {
    if (!f._relativePath) f._relativePath = f.webkitRelativePath || f.name;
  });
  selectedFiles = files;
  var totalBytes = files.reduce(function(s, f) { return s + f.size; }, 0);
  var dest = destPath ? saveDir + '\\' + destPath.split('/').join('\\') : saveDir;

  var topFolders = new Set();
  var topFiles = [];
  files.forEach(function(f) {
    var rel = f._relativePath || f.name;
    var parts = rel.split('/');
    if (parts.length > 1) topFolders.add(parts[0]);
    else topFiles.push(f.name);
  });

  var savePreview = dest;
  if (topFolders.size === 1 && topFiles.length === 0) {
    savePreview += '\\' + Array.from(topFolders)[0];
  } else if (topFolders.size > 0) {
    savePreview += '\\' + Array.from(topFolders)[0] + (topFolders.size > 1 ? ' (+ ' + (topFolders.size - 1) + ' more)' : '');
  } else if (topFiles.length === 1) {
    savePreview += '\\' + topFiles[0];
  }

  fileInfo.innerHTML = '<b>' + files.length + '</b> files, ~<b>' + fmtGB(totalBytes) + '</b>' +
    '<br>\ud83d\udce5 <span style="color:#4fc3f7">' + savePreview + '</span>';
  stopBtn.style.display = 'none';
  transferActive = false;
  resendBtn.style.display = '';
  sendBtn.disabled = false;
}

// --- Drag & drop ---
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
    if (allFiles.length) setFiles(allFiles);
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

// --- File input ---
selectFilesBtn.addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function() {
  if (!fileInput.files.length) return;
  var fileArr = Array.from(fileInput.files);
  fileArr.forEach(function(f) { f._relativePath = f.name; });
  setFiles(fileArr);
});

// --- Browse Folder: native local folder picker ---
selectFolderBtn.addEventListener('click', function() {
  folderInput.value = '';
  folderInput.click();
});
folderInput.addEventListener('change', function() {
  if (!folderInput.files.length) return;
  var fileArr = Array.from(folderInput.files);
  fileArr.forEach(function(f) { f._relativePath = f.webkitRelativePath || f.name; });
  setFiles(fileArr);
});

// --- Destination browser (server-side /dir-tree) ---
var dbCurrentAbs = '';

async function dbLoadDrives() {
  dbList.innerHTML = '<div class="fb-empty">Loading drives...</div>';
  dbBreadcrumb.innerHTML = '<span class="fb-crumb">This PC</span>';
  try {
    var resp = await fetch('/drives');
    var drives = await resp.json();
    if (!drives.length) {
      dbList.innerHTML = '<div class="fb-empty">No drives found</div>';
      return;
    }
    var html = '';
    drives.forEach(function(d) {
      var label = d.letter;
      if (d.name) label += ' (' + d.name + ')';
      var freeStr = d.free > 0 ? ' - ' + fmtGB(d.free) + ' free' : '';
      html += '<div class="fb-folder" data-dbdrive="' + d.letter + '\\">' +
        '<span style="font-size:1.1rem;margin-right:.4rem">\ud83d\udcbe</span>' +
        '<div style="flex:1"><div style="font-weight:600">' + label + '</div>' +
        '<div style="font-size:.7rem;color:#888">' + freeStr + '</div></div>' +
        '<span style="font-size:.75rem;color:#555">\u25b6</span></div>';
    });
    dbList.innerHTML = html;
    dbList.querySelectorAll('.fb-folder').forEach(function(el) {
      el.addEventListener('click', function() {
        dbLoadAbs(el.getAttribute('data-dbdrive'));
      });
    });
    dbUseBtn.textContent = '\ud83d\udccd Use current save folder';
    dbRootBtn.style.display = 'none';
  } catch(e) {
    dbList.innerHTML = '<div class="fb-empty">Error loading drives: ' + e.message + '</div>';
  }
}

async function dbLoadAbs(absPath) {
  absPath = normalizePath(absPath);
  if (/^[A-Za-z]:$/.test(absPath)) absPath = absPath + '\\';
  dbCurrentAbs = absPath;
  dbList.innerHTML = '<div class="fb-empty">Loading...</div>';
  var bcHtml = '<span class="fb-crumb" data-dbabs="">This PC</span>';
  var parts = absPath.split('/').filter(Boolean);
  var acc = '';
  for (var i = 0; i < parts.length; i++) {
    acc = i === 0 ? parts[0] : acc + '/' + parts[i];
    var label = i === 0 ? parts[0] : parts[i];
    bcHtml += '<span class="fb-sep">/</span><span class="fb-crumb" data-dbabs="' + acc + '">' + label + '</span>';
  }
  dbBreadcrumb.innerHTML = bcHtml;
  dbBreadcrumb.querySelectorAll('.fb-crumb').forEach(function(el) {
    el.addEventListener('click', function() {
      var p = el.getAttribute('data-dbabs');
      if (!p) dbLoadDrives(); else dbLoadAbs(p);
    });
  });
  try {
    var resp = await fetch('/dir-tree?abs=' + encodeURIComponent(absPath));
    var dirs = await resp.json();
    if (!dirs.length) {
      dbList.innerHTML = '<div class="fb-empty">No subfolders here</div>';
    } else {
      var html = '';
      dirs.forEach(function(d) {
        html += '<div class="fb-folder" data-dbsub="' + d + '">' +
          '<span style="font-size:1.1rem;margin-right:.4rem">\ud83d\udcc1</span>' +
          '<div style="flex:1"><div style="font-weight:600">' + d + '</div></div>' +
          '<span style="font-size:.75rem;color:#555">\u25b6</span></div>';
      });
      dbList.innerHTML = html;
      dbList.querySelectorAll('.fb-folder').forEach(function(el) {
        el.addEventListener('click', function() {
          var sep = absPath.charAt(absPath.length - 1) === '/' ? '' : '/';
          dbLoadAbs(absPath + sep + el.getAttribute('data-dbsub'));
        });
      });
    }
    dbUseBtn.textContent = '\ud83d\udccd Use: ' + absPath;
    dbRootBtn.style.display = '';
    dbRootBtn.textContent = '\u2b06\ufe0f Set as Root';
    dbRootBtn.style.opacity = '1';
  } catch(e) {
    dbList.innerHTML = '<div class="fb-empty">Error: ' + e.message + '</div>';
  }
}

destBrowseBtn.addEventListener('click', function() {
  destBrowser.classList.add('active');
  dbLoadDrives();
});

dbCancelBtn.addEventListener('click', function() {
  destBrowser.classList.remove('active');
});

dbUseBtn.addEventListener('click', function() {
  if (dbCurrentAbs) {
    var normCurrent = normalizePath(dbCurrentAbs);
    var normSave = normalizePath(saveDir);
    if (normCurrent === normSave) {
      destPath = '';
    } else if (normCurrent.startsWith(normSave + '/')) {
      destPath = normCurrent.slice(normSave.length + 1);
    } else {
      statusText.textContent = 'Use "Set as Root" first to save to a different drive.';
      statusText.style.color = '#ff0';
      progressWrap.classList.add('active');
      setTimeout(function() { progressWrap.classList.remove('active'); }, 3000);
      return;
    }
  } else {
    destPath = '';
  }
  var displayParts = [saveDir];
  if (destPath) { displayParts.push(destPath.split('/').join('\\')); }
  var display = displayParts.join('\\') + (destPath ? '' : ' (root)');
  destLabel.textContent = display;
  localStorage.setItem('destRoot', saveDir);
  destBrowser.classList.remove('active');
});

dbRootBtn.addEventListener('click', async function() {
  if (!dbCurrentAbs) return;
  try {
    var resp = await fetch('/set-dest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dbCurrentAbs })
    });
    var result = await resp.json();
    if (result.root) {
      saveDir = result.root;
      localStorage.setItem('destRoot', saveDir);
      destPath = '';
      destLabel.textContent = saveDir + ' (root)';
      if (saveToLabel) saveToLabel.textContent = 'Saves to ' + saveDir + ' \u2022 smart folder skip';
      addLocalSkipLog('Destination root changed to: ' + saveDir, 0);
      destBrowser.classList.remove('active');
    } else {
      statusText.textContent = 'Error: ' + (result.error || 'Unknown');
      statusText.style.color = '#f33';
      progressWrap.classList.add('active');
      setTimeout(function() { progressWrap.classList.remove('active'); }, 3000);
    }
  } catch(e) {
    statusText.textContent = 'Error changing root: ' + e.message;
    statusText.style.color = '#f33';
    progressWrap.classList.add('active');
    setTimeout(function() { progressWrap.classList.remove('active'); }, 3000);
  }
});

// --- Log tabs ---
document.querySelectorAll('.log-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.log-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    activeFilter = tab.dataset.tab;
    renderLogs();
  });
});

// --- Fetch server logs ---
async function fetchLogs() {
  try {
    var r = await fetch('/log-events?since=' + lastLogId);
    var data = await r.json();
    if (data.length) {
      var existingDedupKeys = new Set(allLogs.filter(function(l) { return l.dedupKey; }).map(function(l) { return l.dedupKey; }));
      data.forEach(function(e) {
        if (e.dedupKey && existingDedupKeys.has(e.dedupKey)) return;
        addLog(e);
      });
      lastLogId = data[data.length - 1].id;
      updateCounts();
      renderLogs();
    }
  } catch(e) {}
}
setInterval(fetchLogs, 1000);
initSkipPanel();

// Init dest label from server
(async function() {
  try {
    var r = await fetch('/dest-root');
    var d = await r.json();
    if (d.root) {
      saveDir = d.root;
      destLabel.textContent = saveDir + ' (root)';
      if (saveToLabel) saveToLabel.textContent = 'Saves to ' + saveDir + ' \u2022 smart folder skip';
    }
  } catch(e) {}
})();

// --- Send files ---
async function sendFiles(files) {
  sendBtn.disabled = true;
  stopBtn.style.display = '';
  resendBtn.style.display = 'none';
  retryBtn.disabled = true;
  progressWrap.classList.add('active');
  barFill.style.width = '0%';
  pctText.textContent = '0%';
  statusText.textContent = "Checking what's on server...";
  statusText.style.color = '';
  transferActive = true;
  transferAbort = new AbortController();

  var allFileList = files.map(function(f) {
    var relPath = f._relativePath || f.webkitRelativePath || f.name;
    var uploadName = destPath ? destPath + '/' + relPath : relPath;
    return { _file: f, name: uploadName, size: f.size };
  }).filter(function(f) {
    var lower = normalizePath(f.name).toLowerCase();
    return lower.indexOf('.git/') === -1 && lower.indexOf('.git\\') === -1 && lower !== '.git';
  });

  var missingFiles = allFileList;
  try {
    var diffResp = await fetch('/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allFileList.map(function(f) { return { name: f.name, size: f.size }; }))
    });
    var diff = await diffResp.json();
    var existCount = diff.existCount || 0;
    var missingSize = diff.missingSize || 0;
    if (existCount > 0) {
      var skippedBytes = allFileList.reduce(function(s, f) { return s + f.size; }, 0) - missingSize;
      addLocalSkipLog('SKIP: ' + existCount + ' files already on server (' + fmtGB(skippedBytes) + ')', skippedBytes, 'diff-skip');
    }
    if (diff.missingCount === 0) {
      statusText.innerHTML = '\u2705 All ' + allFileList.length + ' files already on server!';
      statusText.style.color = '#00e676';
      sendBtn.disabled = false;
      return;
    }
    statusText.textContent = diff.missingCount + ' files to send (' + fmtGB(missingSize) + ')...';
    missingFiles = diff.missing.map(function(mf) {
      return allFileList.find(function(f) { return f.name === mf.name && f.size === mf.size; }) || null;
    }).filter(Boolean);
  } catch(e) {
    statusText.textContent = 'Diff check failed, sending all files...';
    missingFiles = allFileList;
  }

  // Sort small files first — keeps workers busy, better throughput
  missingFiles.sort(function(a, b) { return a.size - b.size; });

  var total = missingFiles.length;
  var completed = 0;
  var bytesTotal = missingFiles.reduce(function(s, f) { return s + f.size; }, 0);
  var bytesSent = 0;
  var startTime = Date.now();
  localFailed = [];

  function updateUI() {
    var pct = total > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0;
    barFill.style.width = pct + '%';
    pctText.textContent = pct + '%';
    countText.textContent = completed + ' / ' + total;
    var elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 0.5) speedText.textContent = (bytesSent / 1024 / 1024 / elapsed).toFixed(1) + ' MB/s';
  }

  var CONCURRENCY = 3;
  var MAX_CONCURRENCY = 12;
  var activeWorkers = 0;
  var idx = 0;
  var lastSpeedCheck = Date.now();
  var lastSpeedBytes = 0;

  statusText.textContent = 'Sending ' + total + ' files (' + CONCURRENCY + ' parallel)...';
  var lastUIUpdate = Date.now();

  function spawnWorker() {
    if (!transferActive || activeWorkers >= CONCURRENCY || idx >= missingFiles.length) return;
    activeWorkers++;
    uploadOne().then(function() {
      activeWorkers--;
      if (transferActive) spawnWorker();
    }, function() {
      activeWorkers--;
      if (transferActive) spawnWorker();
    });
  }

  async function uploadOne() {
    while (idx < missingFiles.length) {
      if (!transferActive) return;
      var item = missingFiles[idx++];
      try {
        var resp = await fetch('/upload?name=' + encodeURIComponent(item.name) + '&size=' + item.size, {
          method: 'POST', body: item._file, signal: transferAbort.signal
        });
        var result = await resp.text();
        completed++;
        bytesSent += item.size;
        var now = Date.now();

        // Speed check every 3 seconds
        if (now - lastSpeedCheck > 3000) {
          var recentBytes = bytesSent - lastSpeedBytes;
          var recentSpeed = recentBytes / 1024 / 1024 / ((now - lastSpeedCheck) / 1000);
          lastSpeedBytes = bytesSent;
          lastSpeedCheck = now;

          // If speed dropped below 500 KB/s, boost concurrency
          if (recentSpeed < 0.5 && activeWorkers < MAX_CONCURRENCY) {
            CONCURRENCY = Math.min(CONCURRENCY + 4, MAX_CONCURRENCY);
            allLogs.push({ time: new Date().toLocaleTimeString(), msg: 'Slow speed (' + recentSpeed.toFixed(1) + ' MB/s), boosting to ' + CONCURRENCY + ' workers', type: 'info', size: 0, dedupKey: '' });
            renderLogs();
            // Spawn extra workers immediately
            for (var i = 0; i < 4 && activeWorkers < CONCURRENCY; i++) spawnWorker();
          }
        }

        if (now - lastUIUpdate > 500 || completed === total) {
          updateUI();
          lastUIUpdate = now;
        }
      } catch(err) {
        if (err.name === 'AbortError') {
          statusText.textContent = '\u23f9 Transfer stopped';
          statusText.style.color = '#ff9800';
          stopBtn.style.display = 'none';
          transferActive = false;
          resendBtn.style.display = '';
          sendBtn.disabled = false;
          return;
        }
        // Server down / network error — stop everything
        if (err instanceof TypeError && !transferActive) return;
        if (err instanceof TypeError) {
          transferActive = false;
          CONCURRENCY = 0;
          statusText.innerHTML = '\u274c Server unreachable! Check if server is running.<br>' + completed + ' / ' + total + ' sent before disconnect.';
          statusText.style.color = '#f33';
          stopBtn.style.display = 'none';
          resendBtn.style.display = '';
          sendBtn.disabled = false;
          return;
        }
        // Retry once for network errors
        if (err.name === 'TypeError' && !item._retried) {
          item._retried = true;
          idx--; // re-queue
          return;
        }
        completed++;
        bytesSent += item.size;
        localFailed.push({ file: item._file, reason: err.message });
        updateUI();
      }
    }
  }

  // Spawn workers gradually — one every 300ms, checks cap each time
  function spawnGradual() {
    if (!transferActive || idx >= missingFiles.length) return;
    if (activeWorkers < CONCURRENCY) spawnWorker();
    if (idx < missingFiles.length && transferActive) {
      setTimeout(spawnGradual, 300);
    }
  }
  spawnGradual();
  // Wait until all items are picked up and all workers finish
  await new Promise(function(resolve) {
    var check = setInterval(function() {
      if (idx >= missingFiles.length && activeWorkers === 0) { clearInterval(check); resolve(); }
    }, 100);
  });

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  var avgSpeed = elapsed > 0 ? (bytesSent / 1024 / 1024 / (Date.now() - startTime) * 1000).toFixed(1) : 0;
  statusText.innerHTML = '\u2705 Done! ' + completed + ' files processed (' + elapsed + 's, ' + avgSpeed + ' MB/s)<br>' +
    '<span style="color:#0f0">Sent: ' + fmtGB(bytesSent) + '</span> &bull; ' +
    '<span style="color:#ff0">Skipped: ' + fmtGB(localSkippedBytes) + '</span> &bull; ' +
    '<span style="color:#f33">Failed: ' + fmtGB(localFailedBytes) + '</span>';
  statusText.style.color = '#00e676';
  barFill.style.width = '100%';
  pctText.textContent = '100%';
  stopBtn.style.display = 'none';
  transferActive = false;

  if (localFailed.length) {
    failedWrap.classList.add('active');
    failedTitle.textContent = 'Failed (' + localFailed.length + ')';
    retryBtn.disabled = false;
    retryBtn.onclick = function() {
      failedWrap.classList.remove('active');
      sendFiles(localFailed.map(function(f) { return f.file; }));
    };
  }
  resendBtn.style.display = '';
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

})();

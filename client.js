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
    statusText.style.color = '#fff';
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
var saveDir = 'File Transfer';
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

// --- Destination root + subpath (localStorage) ---
var savedDest = null; try { savedDest = localStorage.getItem('destRoot'); } catch(e) {}
if (savedDest) {
  saveDir = savedDest;
  fetch('/set-dest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: saveDir })
  }).catch(function() {});
}
try { var _dp = localStorage.getItem('ftDestPath') || localStorage.getItem('destPath'); if (_dp) destPath = _dp; } catch(e) {}
function persistDest() {
  try {
    localStorage.setItem('ftDestPath', destPath);
    localStorage.setItem('destPath', destPath);
    if (saveDir) localStorage.setItem('destRoot', saveDir);
  } catch(e) {}
}

// --- Stop / Send-more ---
stopBtn.addEventListener('click', function() {
  if (transferAbort) transferAbort.abort();
  transferActive = false;
  stopBtn.style.display = 'none';
  statusText.textContent = 'Stopped — hit Retry to continue with the same files.';
  statusText.style.color = '#fff';
  // allow retry with same selection
  sendBtn.style.display = '';
  sendBtn.disabled = selectedFiles.length ? false : true;
  sendBtn.textContent = 'Retry Send';
});

resendBtn.addEventListener('click', function() {
  // After a completed batch this button means "send another batch":
  // clear the old selection so the user picks fresh files.
  resendBtn.style.display = 'none';
  transferDone = false;
  selectedFiles = [];
  fileInfo.innerHTML = '<span style="color:#888">Pick files or a folder to send another batch.</span>';
  var sub = document.getElementById('subfolderList');
  if (sub) { sub.style.display = 'none'; sub.innerHTML = ''; }
  progressWrap.classList.remove('active');
  barFill.style.width = '0%';
  pctText.textContent = '0%';
  countText.textContent = '0 / 0';
  statusText.textContent = '';
  sendBtn.style.display = '';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;
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

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fileIcon(name) {
  var n = (name || '').toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(n)) return '🖼️';
  if (/\.(mp4|mkv|mov|avi|webm)$/.test(n)) return '🎬';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(n)) return '🎵';
  if (/\.(pdf)$/.test(n)) return '📕';
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '📦';
  return '📄';
}

var transferDone = false;

function setFiles(files) {
  if (transferActive) return;
  files.forEach(function(f) {
    if (!f._relativePath) f._relativePath = f.webkitRelativePath || f.name;
  });
  selectedFiles = files;
  transferDone = false;
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

  fileInfo.innerHTML = 'Selected: <b>' + files.length + '</b> file' + (files.length === 1 ? '' : 's') + ', ~<b>' + fmtGB(totalBytes) + '</b> — ready to send' +
    '<br>To <span style="color:#fff">' + escHtml(savePreview) + '</span>' +
    (files.length ? ' <a href="#" id="clearSel" style="color:#fff;font-size:.78rem;margin-left:.4rem">Clear</a>' : '');
  var clearLink = document.getElementById('clearSel');
  if (clearLink) {
    clearLink.addEventListener('click', function(e) {
      e.preventDefault();
      if (transferActive) return;
      selectedFiles = [];
      fileInfo.textContent = '';
      var sub = document.getElementById('subfolderList');
      if (sub) { sub.style.display = 'none'; sub.innerHTML = ''; }
      sendBtn.disabled = true;
      sendBtn.style.display = '';
      resendBtn.style.display = 'none';
    });
  }
  renderSelectedPreview();
  stopBtn.style.display = 'none';
  transferActive = false;
  // Fresh selection → show Send, hide "send more"
  resendBtn.style.display = 'none';
  sendBtn.style.display = '';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = files.length ? false : true;
}

function renderSelectedPreview() {
  var sub = document.getElementById('subfolderList');
  if (!sub) return;
  if (!selectedFiles.length || transferActive || transferDone) {
    if (!transferDone) { sub.style.display = 'none'; sub.innerHTML = ''; }
    return;
  }
  var MAX_ROWS = 150;
  var html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:.15rem .2rem .4rem;font-size:.8rem;color:#888">' +
    '<span>' + selectedFiles.length + ' selected</span>' +
    '<span style="color:#666">' + fmtGB(selectedFiles.reduce(function(s, f) { return s + f.size; }, 0)) + '</span></div>';
  selectedFiles.slice(0, MAX_ROWS).forEach(function(f, idx) {
    var rel = f._relativePath || f.name;
    html += '<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .4rem;border-bottom:1px solid #222;font-size:.78rem">' +
      '<span>' + fileIcon(rel) + '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ddd" title="' + escHtml(rel) + '">' + escHtml(rel) + '</span>' +
      '<span style="color:#888;white-space:nowrap">' + fmtGB(f.size) + '</span>' +
      '<button data-rmsel="' + idx + '" style="background:none;border:none;color:#fff;cursor:pointer;font-size:.85rem">✕</button></div>';
  });
  if (selectedFiles.length > MAX_ROWS) {
    html += '<div style="padding:.4rem;text-align:center;color:#666;font-size:.78rem">… + ' + (selectedFiles.length - MAX_ROWS) + ' more (all will be sent)</div>';
  }
  sub.innerHTML = html;
  sub.style.display = 'block';
  sub.querySelectorAll('[data-rmsel]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (transferActive) return;
      var i = parseInt(btn.getAttribute('data-rmsel'), 10);
      selectedFiles.splice(i, 1);
      if (!selectedFiles.length) {
        fileInfo.textContent = '';
        sub.style.display = 'none'; sub.innerHTML = '';
        sendBtn.disabled = true;
      } else {
        setFiles(selectedFiles);
      }
    });
  });
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
      statusText.style.color = '#fff';
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
  persistDest();
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
      persistDest();
      destPath = '';
      try { localStorage.setItem('ftDestPath', ''); localStorage.setItem('destPath', ''); } catch(e) {}
      destLabel.textContent = saveDir + ' (root)';
      if (saveToLabel) saveToLabel.textContent = 'Saves to ' + saveDir + ' \u2022 smart folder skip';
      addLocalSkipLog('Destination root changed to: ' + saveDir, 0);
      destBrowser.classList.remove('active');
    } else {
      statusText.textContent = 'Error: ' + (result.error || 'Unknown');
      statusText.style.color = '#fff';
      progressWrap.classList.add('active');
      setTimeout(function() { progressWrap.classList.remove('active'); }, 3000);
    }
  } catch(e) {
    statusText.textContent = 'Error changing root: ' + e.message;
    statusText.style.color = '#fff';
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
// Pause log polling while uploading: frees a browser connection slot
// (HTTP/1.1 allows ~6 per host) and CPU for the transfer itself.
setInterval(function() { if (!transferActive) fetchLogs(); }, 1000);
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
  sendBtn.style.display = 'none';
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
      statusText.innerHTML = '✅ All ' + allFileList.length + ' files already on server!';
      statusText.style.color = '#fff';
      stopBtn.style.display = 'none';
      transferActive = false;
      transferDone = true;
      // Nothing to send → hide Send, offer next batch
      sendBtn.style.display = 'none';
      resendBtn.style.display = '';
      resendBtn.textContent = 'Send more';
      var sub0 = document.getElementById('subfolderList');
      if (sub0) { sub0.style.display = 'none'; sub0.innerHTML = ''; }
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
  var lastTickBytes = 0;
  var lastTickTime = Date.now();
  var peakBps = 0;
  localFailed = [];

  function fmtSpeed(bps) {
    if (!isFinite(bps) || bps < 0) bps = 0;
    if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
    if (bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
    return Math.round(bps) + ' B/s';
  }

  // Live bytes = finished files + in-flight progress (fetch has no
  // upload-progress events, so uploads below use XHR instead).
  function liveBytes() {
    var live = bytesSent;
    for (var li = 0; li < missingFiles.length; li++) live += (missingFiles[li]._loaded || 0);
    if (live > bytesTotal) live = bytesTotal;
    return live;
  }

  function updateUI() {
    var live = liveBytes();
    var pct = bytesTotal > 0 ? Math.round((live / bytesTotal) * 100) : 0;
    if (pct > 100) pct = 100;
    barFill.style.width = pct + '%';
    pctText.textContent = pct + '%';
    countText.textContent = completed + ' / ' + total;
    var now = Date.now();
    var elapsed = (now - startTime) / 1000;
    var tickDt = (now - lastTickTime) / 1000;
    var inst = tickDt > 0 ? (live - lastTickBytes) / tickDt : 0;
    if (inst < 0) inst = 0;
    var avg = elapsed > 0 ? live / elapsed : 0;
    // Prefer instantaneous speed while moving; fall back to average when idle.
    var show = (live < bytesTotal && inst > 0) ? inst : avg;
    if (show > peakBps) peakBps = show;
    if (elapsed > 0.2 || completed === total) speedText.textContent = fmtSpeed(show);
    lastTickBytes = live;
    lastTickTime = now;
  }

  var uiTimer = setInterval(function() { if (transferActive) updateUI(); }, 250);

  // XHR upload with real upload-progress (fetch can't report it,
  // which is why speed used to stick at 0 until a file finished).
  function uploadFileXHR(url, file, item) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      if (transferAbort) {
        transferAbort.signal.addEventListener('abort', function() { try { xhr.abort(); } catch(e) {} });
      }
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          item._loaded = e.loaded;
        } else {
          item._loaded = 0;
        }
      };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else {
          var err = new Error('HTTP ' + xhr.status);
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = function() { reject(new Error('Network error')); };
      xhr.onabort = function() {
        var err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      try { xhr.send(file); } catch(e) { reject(e); }
    });
  }

  var CONCURRENCY = 6;
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
      item._loaded = 0;
      try {
        var upUrl = '/upload?name=' + encodeURIComponent(item.name) + '&size=' + item.size;
        var result = await uploadFileXHR(upUrl, item._file, item);
        item._loaded = 0;
        completed++;
        bytesSent += item.size;
        var now = Date.now();

        // Speed check every 3 seconds (uses live bytes incl. in-flight)
        if (now - lastSpeedCheck > 3000) {
          var liveNow = liveBytes();
          var recentBytes = liveNow - lastSpeedBytes;
          var recentSpeed = recentBytes / ((now - lastSpeedCheck) / 1000);
          lastSpeedBytes = liveNow;
          lastSpeedCheck = now;

          // If speed dropped below 500 KB/s, boost concurrency
          if (recentSpeed < 0.5 * 1024 * 1024 && activeWorkers < MAX_CONCURRENCY) {
            CONCURRENCY = Math.min(CONCURRENCY + 4, MAX_CONCURRENCY);
            allLogs.push({ time: new Date().toLocaleTimeString(), msg: 'Slow speed (' + fmtSpeed(recentSpeed) + '), boosting to ' + CONCURRENCY + ' workers', type: 'info', size: 0, dedupKey: '' });
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
        item._loaded = 0;
        if (err.name === 'AbortError') {
          statusText.textContent = 'Stopped — hit Retry to continue with the same files.';
          statusText.style.color = '#fff';
          stopBtn.style.display = 'none';
          transferActive = false;
          try { clearInterval(uiTimer); } catch(e) {}
          sendBtn.style.display = '';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Retry Send';
          return;
        }
        // Server down / network error — stop everything
        if (err instanceof TypeError && !transferActive) return;
        if (err instanceof TypeError) {
          transferActive = false;
          try { clearInterval(uiTimer); } catch(e) {}
          CONCURRENCY = 0;
          statusText.innerHTML = 'Server unreachable. Check if server is running.<br>' + completed + ' / ' + total + ' sent before disconnect.';
          statusText.style.color = '#fff';
          stopBtn.style.display = 'none';
          sendBtn.style.display = '';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Retry Send';
          return;
        }
        // Retry once for network errors
        if ((err.message === 'Network error' || err.name === 'TypeError') && !item._retried) {
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

  // Start all workers immediately for max throughput
  for (var w = 0; w < CONCURRENCY; w++) spawnWorker();
  // Wait until all items are picked up and all workers finish
  await new Promise(function(resolve) {
    var check = setInterval(function() {
      if (idx >= missingFiles.length && activeWorkers === 0) { clearInterval(check); resolve(); }
    }, 100);
  });

  try { clearInterval(uiTimer); } catch(e) {}
  if (!transferActive) return; // stopped or disconnected — keep that message
  updateUI();
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  var avgBps = bytesSent / ((Date.now() - startTime) / 1000 || 1);
  var avgSpeed = fmtSpeed(avgBps);
  speedText.textContent = avgSpeed;
  statusText.innerHTML = 'Done. ' + completed + ' files processed (' + elapsed + 's, avg ' + avgSpeed + ', peak ' + fmtSpeed(peakBps) + ')<br>' +
    '<span style="color:#fff">Sent: ' + fmtGB(bytesSent) + '</span> &bull; ' +
    '<span style="color:#fff">Skipped: ' + fmtGB(localSkippedBytes) + '</span> &bull; ' +
    '<span style="color:#fff">Failed: ' + fmtGB(localFailedBytes) + '</span>';
  statusText.style.color = '#fff';
  barFill.style.width = '100%';
  pctText.textContent = '100%';
  stopBtn.style.display = 'none';
  transferActive = false;
  transferDone = true;

  if (localFailed.length) {
    failedWrap.classList.add('active');
    failedTitle.textContent = 'Failed (' + localFailed.length + ')';
    retryBtn.disabled = false;
    retryBtn.onclick = function() {
      failedWrap.classList.remove('active');
      transferDone = false;
      sendBtn.style.display = '';
      sendFiles(localFailed.map(function(f) { return f.file; }));
    };
  }
  // Batch done → hide Send for good, show "Send more" to start a fresh batch.
  sendBtn.style.display = 'none';
  resendBtn.style.display = '';
  resendBtn.textContent = 'Send more';
  var subDone = document.getElementById('subfolderList');
  if (subDone) { subDone.style.display = 'none'; subDone.innerHTML = ''; }
  fileInfo.innerHTML = '<b>' + completed + ' files</b> processed — pick “Send more files” for the next batch.' +
    '<br>To <span style="color:#fff">' + escHtml(destPath ? (saveDir + '\\' + destPath.split('/').join('\\')) : (saveDir + ' (root)')) + '</span>';
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

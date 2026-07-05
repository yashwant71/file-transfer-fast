
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
    if (l.type === 'saved') icon = 'â ';
    else if (l.type === 'skip') {
      if (l.dedupKey && l.dedupKey.startsWith('folder:')) { icon = 'ð '; cls = 'folder-skip'; }
      else icon = 'â³ ';
    }
    else if (l.type === 'error') icon = 'â ';
    else if (l.type === 'info') icon = 'â¹ï¸ ';
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

  const sourceRoot = sourceRootInput.value.trim().replace(/\\/g, '/');
  const allFileList = files.map(f => {
    let name = f._relativePath || f.webkitRelativePath || f.name;
    if (sourceRoot) {
      const cleanRoot = sourceRoot.replace(/^/+|/+$/g, '');
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
      statusText.innerHTML = 'â All ' + allFileList.length + ' files already on server!';
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
      statusText.textContent = 'â ' + result;
    } catch(err) {
      completed++;
      bytesSent += item.size;
      localFailed.push({ file: item._file, reason: err.message });
      updateUI();
      statusText.textContent = 'â Failed: ' + filePath;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgSpeed = bytesTotal > 0 ? (bytesTotal / 1024 / 1024 / (Date.now() - startTime) * 1000).toFixed(1) : 0;
  statusText.innerHTML = 'â Done! ' + total + ' files sent (' + fmtGB(bytesTotal) + '), ' + elapsed + 's, ' + avgSpeed + ' MB/s<br>' +
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


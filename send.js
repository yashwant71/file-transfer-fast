#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER = process.argv[2] || 'http://192.168.137.1:8001';
const FOLDER = process.argv[3];

if (!FOLDER) {
  console.log('Usage: node send.js <server-url> <folder-path>');
  console.log('Example: node send.js http://192.168.137.1:8001 D:\\my-folder');
  process.exit(1);
}

if (!fs.existsSync(FOLDER)) {
  console.error('Folder not found: ' + FOLDER);
  process.exit(1);
}

function walkDir(dir) {
  let results = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        results = results.concat(walkDir(full));
      } else {
        const stat = fs.statSync(full);
        const rel = path.relative(path.dirname(FOLDER), full).replace(/\\/g, '/');
        results.push({ name: rel, fullPath: full, size: stat.size });
      }
    }
  } catch(e) {}
  return results;
}

function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function httpRequest(url, method, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    };
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(name, size, filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const u = new URL(SERVER + '/upload?name=' + encodeURIComponent(name) + '&size=' + size);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function main() {
  console.log('=== FOLDER DIFF CHECK ===');
  console.log('Scanning: ' + FOLDER);

  const files = walkDir(FOLDER);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  console.log('Found: ' + files.length + ' files (' + fmtBytes(totalSize) + ')');
  console.log('Checking server for existing files...');

  const diff = await httpRequest(SERVER + '/diff', 'POST', JSON.stringify(files));

  console.log('');
  console.log('=== SERVER STATUS ===');
  console.log('Already on server: ' + diff.existCount + ' files');
  console.log('Missing:           ' + diff.missingCount + ' files (' + fmtBytes(diff.missingSize) + ')');
  console.log('');

  if (diff.missingCount === 0) {
    console.log('All files already on server. Nothing to send!');
    return;
  }

  console.log('=== SENDING MISSING FILES ===');
  let sent = 0, failed = 0, sentBytes = 0;

  for (let i = 0; i < diff.missing.length; i++) {
    const f = diff.missing[i];
    const pct = Math.round(((i + 1) / diff.missing.length) * 100);
    process.stdout.write('\r[' + pct + '%] (' + (i+1) + '/' + diff.missing.length + ') ' + f.name.substring(0, 70).padEnd(70));

    try {
      await uploadFile(f.name, f.size, f.fullPath);
      sent++;
      sentBytes += f.size;
    } catch(e) {
      failed++;
      console.log('\n  FAILED: ' + f.name + ' - ' + e.message);
    }
  }

  console.log('\n');
  console.log('=== DONE ===');
  console.log('Sent:   ' + sent + ' files (' + fmtBytes(sentBytes) + ')');
  console.log('Skipped: ' + diff.existCount + ' files (already on server)');
  console.log('Failed:  ' + failed + ' files');
}

main().catch(e => { console.error(e); process.exit(1); });

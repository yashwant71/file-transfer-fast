const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HTTP_PORT = 8001;
const HTTPS_PORT = 8443;

function getAllLocalIPs() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        list.push({ name, address: net.address });
      }
    }
  }
  return list;
}

function getLocalIP() {
  const ips = getAllLocalIPs();
  if (!ips.length) return 'localhost';
  // Check Wi-Fi / Hotspot interfaces first
  const wifi = ips.find(i => /wi-?fi|wireless|wlan|hotspot/i.test(i.name));
  if (wifi) return wifi.address;
  // Physical Ethernet
  const eth = ips.find(i => /ethernet|lan/i.test(i.name) && !/vEthernet|virtual|wsl|vmware/i.test(i.name));
  if (eth) return eth.address;
  // Any non-virtual adapter
  const real = ips.find(i => !/vEthernet|virtual|wsl|vmware/i.test(i.name));
  if (real) return real.address;
  return ips[0].address;
}

function cleanIP(ip) {
  if (!ip) return '127.0.0.1';
  let c = ip.replace(/^.*:/, '');
  if (c === '1') c = '127.0.0.1';
  return c;
}

const HOST_IP = getLocalIP();
let activePin = null;
const LIVE_WRAPPER_URL = process.env.LIVE_WRAPPER_URL || 'https://live-site-pi.vercel.app';
let saveDir = path.join(os.homedir(), 'File Transfer');
const CERT_DIR = path.join(__dirname, '.cert');
const TRANSFERS_DIR = path.join(saveDir, '.transfers');
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
if (!fs.existsSync(TRANSFERS_DIR)) fs.mkdirSync(TRANSFERS_DIR, { recursive: true });

// Performance: increase UV threadpool for concurrent file I/O
process.env.UV_THREADPOOL_SIZE = '16';

const DEFAULT_CERT = `-----BEGIN CERTIFICATE-----
MIICzDCCAbSgAwIBAgIJFxDPOhirXAZzMA0GCSqGSIb3DQEBBQUAMBgxFjAUBgNV
BAMTDTE5Mi4xNjguMTM3LjEwHhcNMjYwNzA1MDYwMDA3WhcNMjcwNzA1MDYwMDA3
WjAYMRYwFAYDVQQDEw0xOTIuMTY4LjEzNy4xMIIBIjANBgkqhkiG9w0BAQEFAAOC
AQ8AMIIBCgKCAQEAkD26N/khXiU/dvT19NGw7bkhEc2cweWCs5hNN3rTZHKuUiX+
IWCIyo/0m3lRCwhf865yMWwRpdTPwXivgj+GgTlfaAng+zMo+BhaOyFUDWFpOd7F
vd4SPbHHbqHsXoALAWLnjS9Mv7FNjWPdPClYdNf3YvjS2cahwCQXUmBzdWKTd64/
R2Bdc6Ed+lBp/ug/i2+gOz8E8WR8o9CbwlhC49UqyTusAqUeE4hCOSiU6JhIjj5/
tH0rnXvNPOybUGDM4Dewqflq35VaqXRELuw4iQsqg4Tm0pf59Rh/WUYYtonCWUAo
JNTV+wiL/0KYVKjZRuUoWFw7df+Zf/p977JXIwIDAQABoxkwFzAVBgNVHREEDjAM
hwTAqIkBhwR/AAABMA0GCSqGSIb3DQEBBQUAA4IBAQAEdRC66ZyjHyKRS68PZ6j7
hLXve9Y5DzEe+2/2eUqO+YZ+ZqOT7Z0y7AfGzypSyV9ZsLCm1HbL//Wfe2V4w2Os
I07yLdHF/LBnmPD4avxeO1QDNpMJIcLeDod8IhnaePUyjqIDiSbV7b4hRcO6Y0+v
lPzdRZp/ttLVjMVtFo5uqbJZHO/vhLp/KAOGjOmBxueICKTMP0beTcZ1Yd++goXV
78PPbMgJYizY9Swy19bVhCWFZ+SXIN2vEdLVy7WftW0goJ6iPxaeTe8sR0uW9mHu
FjkRX7vMOFFoXgyYdR7fjTuGUtLbquQIYr3tC4h0GCFig6XoTw2j+7xIS46X+fiM
-----END CERTIFICATE-----`;

const DEFAULT_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCQPbo3+SFeJT92
9PX00bDtuSERzZzB5YKzmE03etNkcq5SJf4hYIjKj/SbeVELCF/zrnIxbBGl1M/B
eK+CP4aBOV9oCeD7Myj4GFo7IVQNYWk53sW93hI9scduoexegAsBYueNL0y/sU2N
Y908KVh01/di+NLZxqHAJBdSYHN1YpN3rj9HYF1zoR36UGn+6D+Lb6A7PwTxZHyj
0JvCWELj1SrJO6wCpR4TiEI5KJTomEiOPn+0fSude8087JtQYMzgN7Cp+WrflVqp
dEQu7DiJCyqDhObSl/n1GH9ZRhi2icJZQCgk1NX7CIv/QphUqNlG5ShYXDt1/5l/
+n3vslcjAgMBAAECggEARm9GGGAY2bLBp3KeClM9HRCaY+muIwbSiKWWC0H4qSPR
GP9BdgYANj4Omb8ngoYv6LwmOhkGEx705opq1eT0ZvTfsFuml7PXTTMDGL3BIBmR
uzccA4fGC4ddFhqO5GSNOzuTS5+t0Cuh7am21lJwRfpR7OwJdlunD77v/oNnzgk9
wXHO2QiB5fbXWF0njYhFvTOmJFJTe80NHpnj7P0NVc5s8NL/CnAWbySbSmqHq64+
u75HLZTGVAlH5kemVYfQkyrpBzdcSF7ZBtDRD0RDhfotnvTX+YxA8vBaRavTELi8
NrXMF6crsmaYXINRkdDfg6uiK2l0uajWHJdD8zjHKQKBgQDBj+/W3qrR+x44mZz0
sM3juIABrJ856vG+HWRfFMOu3/fRNrvCNjF1UKl3qFI+BetKdZoXNbmLapE90EBK
H/U7XhMj2msP12oqBx323cyeb7rIobUkGfemACJdI1wGIf8o7PRLcn9QosAMERRL
h4srHsuCEk2VoXKU8l6stYa46QKBgQC+xO4T6bNC8+AxuePZ4jyeKsADKFIIXxKx
P7hiAxkOp5b7PdvY4GGW8+f3kvZof5aSLUGrJKGvZjMKAqxJycyMR+paX6pr4Xh/
K7IVdu8UVNb4ltd6APV0DYZuw7HKhHrx7rvrPm7aIz2yzz7vHY/mln+WOf9FmdKs
lq9X67oIKwKBgE1HHxUlHwPogx9LzQswD3NMNOb2OTfRYiRp7am8S4fk6TbA6GNY
aZSR2KbqL7ONf2vh2dxMWcCcklIgc5pkee7y1ydoS3guo7cV0lO+J7RVnTf+v6gj
Kek/gni25kWYixuWxs3cb5IM+CmZJAYnnltf1xYeIpWLuIhY342Kh7gJAoGBAK0a
bR5MlYlPWkRE9WgkTfUHvawfzjAidQe5Vko5nWca03mvK+qj0Gn1cKvKAyXXgH2r
60asuro59l5DBqr+Hkm8h/7xh+bUdU6QC8xGW7MLOPXhiiz+6bsg+rdPg+jMRfN6
ObLAuD3gdH/oZqb7IDSQo71hay1w4yYQpZMWJ3x5AoGBAJlHz0M+OICYL0NuUMP2
RjexwxnozxdrDisPkkpvF9d7GZQtjwNMWR9nYHTLtZPym3vgInPWT5yiTNbpZChN
DmhjoWX2TX9rhUif3XIZq+Rj0Mo5Y8gVGe7Cqk40SIKLOlsf/ZjHAR9Xuri1/Sgv
XTAbfNNQabnYIuOJ0iSVvgIW
-----END PRIVATE KEY-----`;

// Generate or load self-signed certificate (async API in newer selfsigned)
async function getTlsOptions() {
  const certFile = path.join(CERT_DIR, 'cert.pem');
  const keyFile = path.join(CERT_DIR, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    console.log('[HTTPS] Using cached certificate');
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }
  
  // Try generating via selfsigned module if available
  try {
    const selfsigned = require('selfsigned');
    console.log('[HTTPS] Generating self-signed certificate...');
    const attrs = [{ name: 'commonName', value: HOST_IP }];
    const altNames = [{ type: 7, ip: HOST_IP }, { type: 7, ip: '127.0.0.1' }];
    for (const item of getAllLocalIPs()) {
      if (item.address !== HOST_IP && item.address !== '127.0.0.1') {
        altNames.push({ type: 7, ip: item.address });
      }
    }
    const pems = await selfsigned.generate(attrs, {
      days: 3650,
      keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames }]
    });
    const certPem = pems.cert || pems.certificate;
    const keyPem = pems.private || pems.privateKey || pems.key;
    try {
      fs.writeFileSync(certFile, certPem);
      fs.writeFileSync(keyFile, keyPem);
    } catch(e) {}
    console.log('[HTTPS] Certificate generated and cached');
    return { cert: certPem, key: keyPem };
  } catch (err) {
    // Fallback: use built-in self-signed certificate (Zero external npm dependency!)
    console.log('[HTTPS] Using built-in self-signed TLS certificate');
    try {
      fs.writeFileSync(certFile, DEFAULT_CERT);
      fs.writeFileSync(keyFile, DEFAULT_KEY);
    } catch(e) {}
    return { cert: DEFAULT_CERT, key: DEFAULT_KEY };
  }
}

let logEvents = [];
const MAX_LOG = 2000;
let failedFiles = [];
let stats = { saved: 0, skipped: 0, failed: 0, savedBytes: 0, skippedBytes: 0, failedBytes: 0 };

const devices = new Map();
const DEVICE_TIMEOUT = 30000;

function registerDevice(deviceInfo) {
  const id = deviceInfo.id || generateId();
  const now = Date.now();
  const isHost = deviceInfo.isHost || false;
  const existing = devices.get(id);
  if (existing) {
    existing.lastSeen = now;
    existing.name = deviceInfo.name || existing.name;
    existing.ip = deviceInfo.ip || existing.ip;
    return id;
  }
  devices.set(id, {
    id,
    name: deviceInfo.name || (isHost ? 'Host PC' : 'Device'),
    ip: deviceInfo.ip || '127.0.0.1',
    userAgent: deviceInfo.userAgent || '',
    capabilities: deviceInfo.capabilities || ['send', 'receive'],
    isHost,
    lastSeen: now,
    registeredAt: now
  });
  addLog('Device connected: ' + devices.get(id).name + ' (' + devices.get(id).ip + ')', 'info');
  // push live so other browsers see it without Refresh
  try { sseBroadcast(); } catch(e) {}
  return id;
}

function unregisterDevice(id) {
  const device = devices.get(id);
  if (device) {
    addLog('Device disconnected: ' + device.name, 'info');
    devices.delete(id);
    try { sseBroadcast(); } catch(e) {}
  }
}

function updateDeviceHeartbeat(id) {
  const device = devices.get(id);
  if (device) {
    device.lastSeen = Date.now();
  }
}

function getActiveDevices() {
  const now = Date.now();
  const active = [];
  for (const [id, device] of devices) {
    if (now - device.lastSeen < DEVICE_TIMEOUT) {
      active.push({ ...device, online: true });
    } else {
      devices.delete(id);
    }
  }
  return active;
}

function generateId() {
  return 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// --- SSE live push ---
const sseClients = new Set();
function sseBroadcast() {
  const payload = JSON.stringify({ devices: getActiveDevices(), ts: Date.now() });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch(e) {}
  }
}
function sseBroadcastTransfers() {
  // Notify all clients that transfers may have changed — they will re-fetch /incoming
  const payload = JSON.stringify({ transfersTick: Date.now() });
  for (const res of sseClients) {
    try { res.write(`event: transfers\ndata: ${payload}\n\n`); } catch(e) {}
  }
}
setInterval(() => {
  // keep-alive + also push current device list so “No other devices” clears without Refresh
  for (const res of sseClients) {
    try { res.write(`: ping\n\n`); } catch(e) {}
  }
  // prune stale devices and push if any were removed
  const before = devices.size;
  getActiveDevices();
  if (devices.size !== before) sseBroadcast();
}, 15000);

const incomingTransfers = new Map();

function queueIncomingTransfer(targetDeviceId, transfer) {
  if (!incomingTransfers.has(targetDeviceId)) {
    incomingTransfers.set(targetDeviceId, []);
  }
  const id = generateId();
  const t = {
    ...transfer,
    id,
    status: 'accepted', // no manual accept step — receiving is automatic
    uploadedFiles: [],
    receivedBytes: 0,
    createdAt: Date.now(),
    completedAt: 0
  };
  incomingTransfers.get(targetDeviceId).push(t);
  try { sseBroadcastTransfers(); } catch(e) {}
  return t;
}

function getIncomingTransfers(deviceId) {
  const transfers = incomingTransfers.get(deviceId) || [];
  const now = Date.now();
  // Recently completed stay visible so receivers see what landed,
  // even if the whole transfer finished between two polls.
  return transfers.filter(t => t.status === 'pending' || t.status === 'accepted' || t.status === 'ready' ||
    (t.status === 'completed' && now - (t.completedAt || 0) < 10 * 60 * 1000));
}

function markTransferDelivered(deviceId, transferId) {
  const transfers = incomingTransfers.get(deviceId) || [];
  const transfer = transfers.find(t => t.id === transferId);
  if (transfer) {
    transfer.status = 'delivered';
  }
}

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
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #000; color: #fff; min-height: 100vh; padding: 12px; font-size: 14px; line-height: 1.4; }
    .center { max-width: 520px; margin: 0 auto; }
    .card { background: none; padding: 0; width: 100%; }
    .nav { display: flex; justify-content: space-between; align-items: center; padding: 4px 0 8px; border-bottom: 1px solid #222; margin-bottom: 10px; font-size: 13px; }
    .nav b { font-weight: 600; }
    .nav a { color: #fff; font-size: 13px; text-decoration: underline; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 2px; }
    .sub { color: #888; font-size: 12px; margin-bottom: 10px; word-break: break-all; }
    .drop-zone { border: 1px dashed #444; border-radius: 4px; padding: 12px; text-align: center; }
    .drop-zone.dragover { border-color: #fff; }
    .drop-zone input { display: none; }
    .drop-zone p { color: #888; font-size: 12px; }
    .pick-row { display: flex; gap: 8px; margin-top: 8px; }
    .pick-row .btn { flex: 1; background: #000; color: #fff; border: 1px solid #444; font-size: 13px; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: 600; }
    .top-bar { display: flex; gap: 8px; margin-top: 10px; }
    .top-bar .btn { flex: 1; background: #fff; color: #000; border: 1px solid #fff; padding: 9px; border-radius: 4px; font-size: 14px; cursor: pointer; font-weight: 600; }
    .top-bar .btn:disabled { opacity: .3; cursor: not-allowed; }
    .progress-wrap { margin-top: 10px; display: none; }
    .progress-wrap.active { display: block; }
    .bar-bg { background: #222; border-radius: 2px; overflow: hidden; height: 4px; width: 100%; }
    .bar-fill { height: 100%; width: 0%; background: #fff; transition: width .2s; }
    .info-row { display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px; color: #888; }
    .status { margin-top: 6px; font-size: 13px; min-height: 1.2rem; color: #fff; }
    .file-info { margin-top: 8px; font-size: 12px; color: #aaa; }
    .logs-section { margin-top: 12px; border-top: 1px solid #222; padding-top: 8px; }
    .log-tabs { display: flex; gap: 12px; margin-bottom: 6px; }
    .log-tab { padding: 2px 0; font-size: 12px; cursor: pointer; border: none; color: #666; background: none; border-bottom: 1px solid transparent; }
    .log-tab.active { color: #fff; border-bottom-color: #fff; }
    .log-panel { display: none; max-height: 200px; overflow-y: auto; padding: 0; font-family: monospace; font-size: 12px; }
    .log-panel.active { display: block; }
    .log-panel div { padding: 3px 0; border-bottom: 1px solid #111; line-height: 1.4; color: #ccc; }
    .log-panel .time { color: #555; margin-right: .3rem; }
    .log-panel .saved, .log-panel .skip, .log-panel .error, .log-panel .info, .log-panel .folder-skip, .log-panel .indent { color: #ccc; }
    .summary-bar { display: none; padding: 6px 0; margin-bottom: 4px; font-size: 12px; color: #888; border-bottom: 1px solid #222; }
    .summary-bar.active { display: flex; gap: 12px; flex-wrap: wrap; }
    .summary-bar .item { display: flex; align-items: center; gap: 4px; }
    .summary-bar .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: #fff; }
    .failed-wrap { margin-top: 10px; display: none; border-top: 1px solid #222; padding-top: 8px; }
    .failed-wrap.active { display: block; }
    .failed-wrap h3 { color: #fff; font-size: 13px; margin-bottom: 6px; font-weight: 600; }
    .retry-btn { background: #000; color: #fff; border: 1px solid #fff; padding: 8px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 600; margin-top: 6px; }
    .retry-btn:disabled { opacity: .3; cursor: not-allowed; }
    .fb-panel { display: none; margin: 8px 0; border: 1px solid #222; border-radius: 4px; overflow: hidden; }
    .fb-panel.active { display: block; }
    .fb-breadcrumb { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 6px 8px; border-bottom: 1px solid #222; font-size: 12px; color: #888; }
    .fb-crumb { cursor: pointer; color: #fff; padding: 2px 4px; text-decoration: underline; }
    .fb-sep { color: #444; font-size: 11px; }
    .fb-list { max-height: 220px; overflow-y: auto; }
    .fb-folder { padding: 8px; cursor: pointer; font-size: 13px; color: #fff; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #111; }
    .fb-empty { color: #666; font-size: 12px; padding: 8px; }
    .fb-bar { display: flex; gap: 8px; padding: 8px; border-top: 1px solid #222; }
    .fb-use-btn { flex: 1; background: #fff; color: #000; border: 1px solid #fff; padding: 8px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 600; }
    .fb-cancel-btn { background: #000; color: #888; border: 1px solid #333; padding: 8px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; }
    .skip-panel { margin-bottom: 8px; border-bottom: 1px solid #222; padding-bottom: 6px; }
    .skip-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; cursor: pointer; }
    .skip-panel-head span { font-size: 12px; color: #888; }
    .skip-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
    .skip-tag { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #333; color: #fff; padding: 2px 8px; border-radius: 20px; font-size: 12px; }
    .skip-tag .x { cursor: pointer; color: #fff; font-weight: 700; }
    .skip-add { display: flex; gap: 8px; padding: 4px 0; }
    .skip-add input { flex: 1; background: #000; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 13px; }
    .skip-add button { background: #000; color: #fff; border: 1px solid #444; padding: 6px 10px; border-radius: 4px; font-size: 13px; cursor: pointer; }
    .stop-btn, .resend-btn { background: #000; color: #fff; border: 1px solid #fff; padding: 9px; border-radius: 4px; font-size: 14px; cursor: pointer; font-weight: 600; }
    .stop-btn:disabled, .resend-btn:disabled { opacity: .3; cursor: not-allowed; }
    .dest-row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid #222; margin-bottom: 8px; font-size: 13px; }
    .row-label { color: #888; font-size: 12px; white-space: nowrap; }
    .row-val { flex: 1; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .link-btn { background: none; border: none; color: #fff; font-size: 12px; cursor: pointer; text-decoration: underline; white-space: nowrap; }
  </style>
</head>
<body>
<div class="center">
<div class="card">
  <div class="nav">
    <b>Send to PC</b>
    <a href="/devices-ui">Devices &rarr;</a>
  </div>
  <div class="sub" id="saveToLabel">Saves to File Transfer</div>
  <div class="skip-panel" id="skipPanel">
    <div class="skip-panel-head" id="skipPanelHead">
      <span>Skip folders</span>
      <span id="skipCount"></span>
    </div>
    <div id="skipPanelBody" style="display:none">
      <div class="skip-tags" id="skipTags"></div>
      <div class="skip-add">
        <input type="text" id="skipInput" placeholder="folder name (e.g. dist)">
        <button id="skipAddBtn">Add</button>
      </div>
    </div>
  </div>

  <div class="dest-row">
    <span class="row-label">Save to</span>
    <span class="row-val" id="destLabel">File Transfer (root)</span>
    <button class="link-btn" id="destBrowseBtn">Change</button>
  </div>
  <div class="fb-panel" id="destBrowser">
    <div class="fb-breadcrumb" id="dbBreadcrumb"></div>
    <div class="fb-list" id="dbList"><div class="fb-empty">Loading...</div></div>
    <div class="fb-bar">
      <button class="fb-use-btn" id="dbUseBtn">Use this folder</button>
      <button class="fb-cancel-btn" id="dbRootBtn">Set as root</button>
      <button class="fb-cancel-btn" id="dbCancelBtn">Cancel</button>
    </div>
  </div>
  <div class="drop-zone" id="dropZone">
    <p>Drop files / folders here</p>
    <div class="pick-row">
      <button type="button" class="btn" id="selectFolderBtn">Folder</button>
      <button type="button" class="btn" id="selectFilesBtn">Files</button>
    </div>
    <input type="file" id="folderInput" webkitdirectory multiple style="opacity:0;position:absolute;width:0;height:0">
    <input type="file" id="fileInput" multiple style="opacity:0;position:absolute;width:0;height:0">
  </div>
  <div id="subfolderList" style="display:none;margin:8px 0;max-height:200px;overflow-y:auto;border-top:1px solid #222;border-bottom:1px solid #222"></div>
  <div class="top-bar">
    <button class="btn" id="sendBtn" disabled>Send</button>
    <button class="btn" id="stopBtn" style="display:none">Stop</button>
    <button class="btn" id="resendBtn" style="display:none">Send more</button>
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
  body { font-family: monospace; background: #000; color: #fff; padding: 12px; font-size: 13px; }
  h2 { color: #fff; margin-bottom: 4px; font-size: 15px; }
  .summary { color: #fff; font-size: 13px; margin-bottom: 4px; }
  .failed-header { color: #fff; font-size: 12px; margin-bottom: 4px; }
  .log { border-top: 1px solid #222; padding: 8px 0; height: 80vh; overflow-y: auto; }
  .entry { padding: 3px 0; border-bottom: 1px solid #111; color: #ccc; }
  .entry .time { color: #555; }
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

const devicesHtml = `<!DOCTYPE html>
<html>
<head>
  <title>File Share</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#090d16">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.json">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #000; color: #fff; min-height: 100vh; padding: 12px; font-size: 14px; line-height: 1.4; }
    .wrap { max-width: 520px; margin: 0 auto; }
    .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #222; }
    .top a { color: #fff; font-size: 12px; }
    .top button { background: none; border: none; color: #fff; font-size: 12px; text-decoration: underline; cursor: pointer; }
    .dim { color: #888; font-size: 12px; }
    .sec { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 4px; }
    .dev { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #222; }
    .dev .nm { flex: 1; min-width: 0; }
    .dev .nm b { font-size: 14px; }
    .dev .ip { font-size: 12px; color: #888; }
    .btn { background: #fff; color: #000; border: 1px solid #fff; border-radius: 4px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn:disabled { opacity: .3; }
    .ghost { background: #000; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .panel { border: 1px solid #333; border-radius: 4px; padding: 10px; margin-top: 10px; }
    .panel.over { border-color: #fff; }
    .row { display: flex; gap: 8px; }
    .row .btn, .row .ghost { flex: 1; }
    #dropZone { border: none; padding: 0; margin: 0; }
    #saveRow { display: flex; gap: 8px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #222; font-size: 13px; }
    #saveLabel { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .link { background: none; border: none; color: #fff; font-size: 12px; text-decoration: underline; cursor: pointer; white-space: nowrap; }
    #saveBrowser { border: 1px solid #222; border-radius: 4px; margin: 8px 0; }
    #sbCrumb { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 8px; border-bottom: 1px solid #222; font-size: 12px; color: #888; }
    #sbCrumb .c { color: #fff; text-decoration: underline; cursor: pointer; }
    #sbList { max-height: 200px; overflow-y: auto; }
    #sbList .f { padding: 8px; border-bottom: 1px solid #111; font-size: 13px; display: flex; justify-content: space-between; cursor: pointer; }
    #sbBar { display: flex; gap: 8px; padding: 8px; }
    .h { padding: 8px 0; border-bottom: 1px solid #222; }
    .h .l1 { display: flex; gap: 8px; align-items: baseline; }
    .dir { font-size: 22px; font-weight: 900; color: #fff; width: 26px; height: 26px; text-align: center; line-height: 1; background: #222; border: 1px solid #333; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
    .h .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .h .sz { font-size: 12px; color: #888; white-space: nowrap; }
    .h .l2 { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; }
    .h .sp { font-size: 12px; color: #fff; white-space: nowrap; }
    .h .pp { font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .h .peer { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h .st { font-size: 12px; color: #888; white-space: nowrap; }
    .h .meta { font-size: 12px; color: #888; margin-top: 2px; }
    .h .files { font-size: 12px; color: #888; margin-top: 2px; }
    .bar { background: #222; height: 4px; border-radius: 2px; margin-top: 6px; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0%; background: #fff; }
    .h .prog { display: flex; justify-content: space-between; font-size: 12px; color: #888; margin-top: 3px; }
    .h .path { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: #888; margin-top: 4px; }
    .h .path span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h .acts { display: flex; gap: 8px; margin-top: 6px; }
    .h .acts .btn, .h .acts .ghost { flex: 1; }
    .dl { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid #111; font-size: 13px; }
    .dl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .dl a { color: #fff; }
    .empty { color: #666; font-size: 13px; padding: 8px 0; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><b>File Share</b> <span class="dim" id="selfInfo">…</span></div>
    <div><a href="/">Upload</a> &nbsp;<button type="button" id="refreshBtn">Refresh</button></div>
  </div>

  <div class="sec">Devices</div>
  <div id="deviceList"><div class="empty">Looking for devices…</div></div>

  <div class="panel" id="sendPanel" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b id="targetDeviceName">Send</b></div>
    <div id="dropZone">
      <div id="pickerStep" class="row">
        <button type="button" class="ghost" id="selectFolderBtn">Folder</button>
        <button type="button" class="ghost" id="selectFilesBtn">Files</button>
      </div>
      <div id="readyStep" style="display:none">
        <div id="readySummary" class="dim" style="margin-bottom:8px"></div>
        <button type="button" class="btn" id="sendBtn" style="width:100%">Send</button>
      </div>
      <input type="file" id="folderInput" webkitdirectory multiple style="opacity:0;position:absolute;width:0;height:0">
      <input type="file" id="fileInput" multiple style="opacity:0;position:absolute;width:0;height:0">
    </div>
  </div>

  <div class="sec">Transfers</div>
  <div id="saveRow">
    <span class="dim">Save to</span>
    <span id="saveLabel" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px" title="Show in folder">…</span>
    <button type="button" class="link" id="saveChangeBtn">Change</button>
    <button type="button" class="link" id="saveFolderBtn" style="display:none">Folder</button>
  </div>
  <div id="saveBrowser" style="display:none">
    <div id="sbCrumb"></div>
    <div id="sbList"></div>
    <div id="sbBar">
      <button type="button" class="btn" id="sbUseBtn" style="flex:1">Use folder</button>
      <button type="button" class="ghost" id="sbCancelBtn">Cancel</button>
    </div>
  </div>
  <div id="histList"></div>
  <div class="empty" id="noHist">Nothing yet — send or receive to see it here.</div>
</div>

<script>
__DEVICES_CLIENT_JS__
</script>
</body>
</html>`;



let devicesClientJs = '';
try {
  devicesClientJs = fs.readFileSync(path.join(__dirname, 'devices-client.js'), 'utf8');
} catch(e) {
  devicesClientJs = '// embedded client js fallback';
}
const devicesHtmlFinal = devicesHtml.replace('__DEVICES_CLIENT_JS__', devicesClientJs);

const isDevWorkspace = fs.existsSync(path.join(__dirname, '.git'));
let localClientJsMtime = 0;
let localDeviceHtmlCache = null;

// Hot-reloads local devices-client.js IF we are actively developing in a git repository
function getFreshLocalDeviceHtml() {
  if (!isDevWorkspace) return null; // End users with installed app: always sync with cloud!
  const localClientJsPath = path.join(__dirname, 'devices-client.js');
  if (fs.existsSync(localClientJsPath)) {
    try {
      const stat = fs.statSync(localClientJsPath);
      if (!localDeviceHtmlCache || stat.mtimeMs > localClientJsMtime) {
        localClientJsMtime = stat.mtimeMs;
        const freshJs = fs.readFileSync(localClientJsPath, 'utf8');
        devicesClientJs = freshJs;
        localDeviceHtmlCache = devicesHtml.replace('__DEVICES_CLIENT_JS__', freshJs);
        console.log(`[LIVE-CODE] ⚡ Developer Mode: Loaded local devices-client.js (${(freshJs.length / 1024).toFixed(1)} KB)`);
      }
      return localDeviceHtmlCache;
    } catch(e) {}
  }
  return null;
}

let liveDeviceUiHtml = null;
let lastLiveUiFetchTime = 0;
let liveUiVersion = 0;
const LIVE_UI_CACHE_TTL = 15000; // Check cloud every 15s max

async function syncWithLiveCloud(force = false) {
  const now = Date.now();
  if (!force && liveDeviceUiHtml && (now - lastLiveUiFetchTime < LIVE_UI_CACHE_TTL)) {
    return liveDeviceUiHtml;
  }

  const cloudBase = (process.env.LIVE_WRAPPER_URL || 'https://live-site-pi.vercel.app').replace(/\/$/, '');
  
  try {
    const res = await fetch(cloudBase + '/device-ui.html', {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store'
    });
    if (res.ok) {
      const html = await res.text();
      if (html && html.length > 5000 && (html.includes('FileTransferFast Device UI') || html.includes('id="devTitle"') || html.includes('File Share'))) {
        const vMatch = html.match(/FTF_VERSION:\s*(\d+)/);
        const fetchedVersion = vMatch ? parseInt(vMatch[1], 10) : now;
        
        if (fetchedVersion !== liveUiVersion || !liveDeviceUiHtml) {
          liveDeviceUiHtml = html;
          liveUiVersion = fetchedVersion;
          lastLiveUiFetchTime = now;
          console.log(`[LIVE-CODE] 🚀 Connected to Live Cloud. Loaded latest UI (${(html.length / 1024).toFixed(1)} KB) - zero reinstall needed!`);
          try {
            fs.writeFileSync(path.join(saveDir, '.cached-device-ui.html'), html, 'utf8');
            fs.writeFileSync(path.join(saveDir, '.cached-device-ui.ver'), String(fetchedVersion), 'utf8');
          } catch(e) {}
        } else {
          lastLiveUiFetchTime = now;
        }
        return liveDeviceUiHtml;
      }
    }
  } catch (err) {
    // Cloud unreachable or offline
  }

  // 2. If cloud unreachable, check disk cache
  if (!liveDeviceUiHtml) {
    try {
      const diskFile = path.join(saveDir, '.cached-device-ui.html');
      if (fs.existsSync(diskFile)) {
        liveDeviceUiHtml = fs.readFileSync(diskFile, 'utf8');
        return liveDeviceUiHtml;
      }
    } catch(e) {}
  }

  return liveDeviceUiHtml || devicesHtmlFinal;
}

async function getLatestDeviceUiHtml() {
  // 1. If actively working in development repo with git, use local edits
  const localHtml = getFreshLocalDeviceHtml();
  if (localHtml) {
    return localHtml;
  }

  // 2. Otherwise (installed app on any user PC), sync and serve from live cloud!
  return await syncWithLiveCloud(false);
}

const requestHandler = (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET') {
    if (pathname === '/devices-ui' || pathname === '/device-ui.html') {
      getLatestDeviceUiHtml().then(html => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(html);
      }).catch(() => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        });
        res.end(devicesHtmlFinal);
      });
      return;
    }
    if (pathname === '/devices-client.js') {
      getFreshLocalDeviceHtml(); // ensures devicesClientJs is fresh if file exists
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(devicesClientJs);
      return;
    }
    if (pathname === '/manifest.json') {
      const manifest = {
        name: "File Transfer Fast",
        short_name: "FileTransfer",
        description: "High-speed local Wi-Fi file transfer",
        start_url: "/devices-ui",
        display: "standalone",
        background_color: "#090d16",
        theme_color: "#3b82f6",
        icons: [{
          src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>",
          sizes: "192x192 512x512",
          type: "image/svg+xml"
        }]
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }
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
    if (pathname === '/local-info') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        hostIp: HOST_IP,
        allIps: getAllLocalIPs(),
        httpPort: HTTP_PORT,
        httpsPort: HTTPS_PORT,
        pin: activePin,
        liveWrapperUrl: LIVE_WRAPPER_URL || null
      }));
      return;
    }
    if (pathname === '/drives') {
      if (process.platform !== 'win32') {
        const drives = [
          { letter: '/', name: 'Root', free: 0, total: 0 },
          { letter: os.homedir(), name: 'Home', free: 0, total: 0 }
        ];
        if (fs.existsSync('/sdcard')) {
          drives.unshift({ letter: '/sdcard', name: 'Internal Storage', free: 0, total: 0 });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(drives));
        return;
      }
      // wmic is removed on Win 11 24H2 — use PowerShell/CIM, fallback to fs scan
      try {
        const { execSync } = require('child_process');
        let out = '';
        try {
          out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Csv -NoTypeInformation"', { encoding: 'utf8', timeout: 5000, stdio: ['ignore','pipe','ignore'] });
        } catch(e) {
          out = execSync('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object @{N=\\"DeviceID\\";E={$_.Root.TrimEnd(\\"\\\\\\")}},@{N=\\"VolumeName\\";E={""}},@{N=\\"FreeSpace\\";E={$_.Free}},@{N=\\"Size\\";E={$_.Used + $_.Free}} | ConvertTo-Csv -NoTypeInformation"', { encoding: 'utf8', timeout: 5000, stdio: ['ignore','pipe','ignore'] });
        }
        const lines = out.split('\n').filter(l => l.trim() && !l.includes('DeviceID') && !l.startsWith('"Node"'));
        const drives = lines.map(l => {
          // CSV: "C:","","123","456" or C:,Vol,Free,Size
          const parts = l.split(',').map(s => s.replace(/^"|"$/g,'').trim());
          if (parts.length < 4) return null;
          const letter = parts[0].replace(':','') + ':';
          return { letter, name: parts[1] || '', free: parseInt(parts[2]) || 0, total: parseInt(parts[3]) || 0 };
        }).filter(Boolean).filter(d => { try { return fs.existsSync(d.letter + '\\'); } catch(e){ return false; }});
        if (drives.length) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(drives));
          return;
        }
        throw new Error('no drives from CIM');
      } catch(e) {
        // final fallback: scan A-Z, try statfs for free/total when available
        const drives = [];
        for (let code=65; code<=90; code++) {
          const letter = String.fromCharCode(code) + ':';
          try {
            if (!fs.existsSync(letter + '\\')) continue;
            let free=0, total=0;
            try {
              const st = fs.statfsSync(letter + '\\');
              free = Number(st.bfree) * Number(st.bsize);
              total = Number(st.blocks) * Number(st.bsize);
            } catch(e2) {}
            drives.push({ letter, name: '', free, total });
          } catch(e2) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(drives.length?drives:[{letter:'C:',name:'',free:0,total:0}]));
      }
      return;
    }
    if (pathname === '/dest-root') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ root: saveDir })); return;
    }
    if (pathname === '/devices') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getActiveDevices())); return;
    }
    if (pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      // send initial snapshot
      try { res.write(`data: ${JSON.stringify({ devices: getActiveDevices() })}\n\n`); } catch(e) {}
      sseClients.add(res);
      req.on('close', () => { try { sseClients.delete(res); } catch(e) {} });
      return;
    }
    if (pathname === '/incoming') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing deviceId' }));
        return;
      }
      updateDeviceHeartbeat(deviceId);
      const transfers = getIncomingTransfers(deviceId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(transfers));
      return;
    }
    if (pathname === '/transfer-status') {
      const transferId = url.searchParams.get('transferId');
      if (!transferId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing transferId' }));
        return;
      }
      let transfer = null;
      for (const [_, list] of incomingTransfers) {
        const found = list.find(t => t.id === transferId);
        if (found) { transfer = found; break; }
      }
      if (!transfer) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Transfer not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        status: transfer.status,
        files: transfer.files,
        uploadedFiles: transfer.uploadedFiles || [],
        receivedBytes: transfer.receivedBytes || 0,
        totalSize: transfer.totalSize || 0
      }));
      return;
    }
    if (pathname === '/download-transfer-file') {
      const transferId = url.searchParams.get('transferId');
      const filename = url.searchParams.get('name');
      if (!transferId || !filename) {
        res.writeHead(400); res.end('Missing parameters'); return;
      }
      const cleanName = path.basename(decodeURIComponent(filename));
      const filePath = path.join(TRANSFERS_DIR, transferId, cleanName);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404); res.end('File not found'); return;
      }
      try {
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': 'attachment; filename="' + encodeURIComponent(cleanName) + '"'
        });
        fs.createReadStream(filePath).pipe(res);
      } catch(e) {
        res.writeHead(500); res.end('Error reading file');
      }
      return;
    }
    if (pathname === '/dir-tree') {
      const absPath = url.searchParams.get('abs');
      let fullPath;
      if (absPath) {
        fullPath = process.platform === 'win32' ? absPath.split('/').join('\\') : absPath;
        if (process.platform === 'win32' && /^[A-Za-z]:$/.test(fullPath)) fullPath += '\\';
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
        fullPath = process.platform === 'win32' ? absPath.split('/').join('\\') : absPath;
        if (process.platform === 'win32' && /^[A-Za-z]:$/.test(fullPath)) fullPath += '\\';
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
      const fullPath = process.platform === 'win32' ? absPath.split('/').join('\\') : absPath;
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

  if (req.method === 'POST' && pathname === '/register') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const deviceInfo = JSON.parse(body || '{}');
        const devIP = cleanIP(req.socket.remoteAddress);
        const isHost = devIP === '127.0.0.1' || devIP === HOST_IP;
        deviceInfo.ip = devIP;
        deviceInfo.isHost = isHost;
        if (isHost && (!deviceInfo.name || deviceInfo.name === 'My Device' || deviceInfo.name === 'Mobile Device')) {
          deviceInfo.name = 'Host PC';
        }
        const id = registerDevice(deviceInfo);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, isHost, devices: getActiveDevices() }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/unregister') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        if (id) unregisterDevice(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, devices: getActiveDevices() }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/heartbeat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        if (id) updateDeviceHeartbeat(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/send-to-device') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { targetDeviceId, files, senderId } = JSON.parse(body || '{}');
        const targetDevice = devices.get(targetDeviceId);
        if (!targetDevice) {
          addLog('QUEUE FAIL: target ' + targetDeviceId + ' not found', 'error');
          console.log('[QUEUE] FAIL target not found:', targetDeviceId);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target device not found' }));
          return;
        }
        const senderDevice = devices.get(senderId);
        const total = (files || []).reduce((s, f) => s + (f.size || 0), 0);
        const transfer = queueIncomingTransfer(targetDeviceId, {
          senderId,
          senderName: senderDevice ? senderDevice.name : 'Unknown Device',
          targetDeviceId,
          targetDeviceName: targetDevice.name,
          files: files || [],
          totalSize: total
        });
        const logLine = 'Transfer queued: ' + (senderDevice?.name || 'Device') + ' (' + cleanIP(senderDevice?.ip||'') + ') -> ' + targetDevice.name + ' (' + cleanIP(targetDevice.ip) + ') id=' + transfer.id + ' ' + (files?.length||0) + ' files ' + fmtBytes(total) + ' status=' + transfer.status;
        addLog(logLine, 'info');
        console.log('[QUEUE] ' + logLine);
        if (files && files.length) {
          files.slice(0,5).forEach(f=> console.log('  file:', f.name, fmtBytes(f.size)));
          if (files.length>5) console.log('  ... +' + (files.length-5) + ' more');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, transferId: transfer.id, status: transfer.status }));
      } catch(e) {
        addLog('QUEUE ERROR: ' + e.message, 'error');
        console.log('[QUEUE] ERROR', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/ack-transfer') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { deviceId, transferId, action } = JSON.parse(body || '{}');
        const transfers = incomingTransfers.get(deviceId) || [];
        const transfer = transfers.find(t => t.id === transferId);
        if (transfer) {
          transfer.status = action === 'accept' ? 'accepted' : 'rejected';
          addLog('Transfer ' + action + ': ' + transfer.senderName + ' -> ' + (devices.get(deviceId)?.name || deviceId), 'info');
          try { sseBroadcastTransfers(); } catch(e) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: transfer ? transfer.status : 'unknown' }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/client-log') {
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      try{ const j=JSON.parse(body||'{}'); console.log('[CLIENT ' + (j.device||'?') + '] ' + (j.msg||body).slice(0,500)); }catch(e){ console.log('[CLIENT] ' + body.slice(0,500)); }
      res.writeHead(200); res.end('ok');
    }); return;
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
        if (saveDir === resolved) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ root: saveDir }));
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

  if (req.method === 'POST' && pathname === '/reveal') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { transferId, name } = JSON.parse(body || '{}');
        let fullPath = null;
        if (transferId) {
          let tr = null;
          for (const [_, list] of incomingTransfers) {
            const f = list.find(x => x.id === transferId);
            if (f) { tr = f; break; }
          }
          if (tr) {
            const targetDev2 = devices.get(tr.targetDeviceId);
            const toRemote2 = tr && targetDev2 && !targetDev2.isHost;
            if (toRemote2) {
              const base = path.join(TRANSFERS_DIR, transferId);
              fullPath = name ? path.join(base, path.basename(name)) : base;
            } else {
              // saved under saveDir with subfolders preserved
              const rel = name || (tr.files && tr.files[0] && tr.files[0].name) || '';
              fullPath = rel ? path.join(saveDir, rel.replace(/\//g, '\\')) : saveDir;
            }
          }
        }
        if (!fullPath && name) {
          // fallback: treat name as absolute or relative to saveDir
          if (path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) fullPath = name;
          else fullPath = path.join(saveDir, name.replace(/\//g, '\\'));
        }
        if (!fullPath) fullPath = saveDir;
        // security: only allow paths under saveDir or TRANSFERS_DIR
        const norm = path.resolve(fullPath);
        const allowed = [path.resolve(saveDir), path.resolve(TRANSFERS_DIR)].some(a => norm === a || norm.startsWith(a + path.sep));
        if (!allowed) {
          // still allow revealing saveDir itself
          if (norm !== path.resolve(saveDir)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Path not allowed' }));
            return;
          }
        }
        let toOpen = norm;
        // if file exists, highlight it; otherwise open its parent folder
        try {
          if (fs.existsSync(norm)) {
            const st = fs.statSync(norm);
            if (st.isFile()) toOpen = norm;
            else toOpen = norm;
          } else {
            // file may have been moved/deleted — open parent that exists
            let cur = norm;
            while (cur && !fs.existsSync(cur) && cur !== path.dirname(cur)) cur = path.dirname(cur);
            if (cur && fs.existsSync(cur)) toOpen = cur;
            else toOpen = saveDir;
          }
        } catch(e2) { toOpen = saveDir; }
        const { spawn } = require('child_process');
        try {
          if (process.platform === 'win32') {
            const isFile = (() => { try { return fs.statSync(toOpen).isFile(); } catch(e){ return false; } })();
            if (isFile) spawn('explorer', ['/select,', toOpen], { detached: true, stdio: 'ignore' }).unref();
            else spawn('explorer', [toOpen], { detached: true, stdio: 'ignore' }).unref();
          } else if (process.platform === 'darwin') {
            const isFile2 = (() => { try { return fs.statSync(toOpen).isFile(); } catch(e){ return false; } })();
            if (isFile2) spawn('open', ['-R', toOpen], { detached: true, stdio: 'ignore' }).unref();
            else spawn('open', [toOpen], { detached: true, stdio: 'ignore' }).unref();
          } else {
            const dir = (() => { try { return fs.statSync(toOpen).isFile() ? path.dirname(toOpen) : toOpen; } catch(e){ return toOpen; } })();
            spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
          }
          addLog('Reveal: ' + toOpen, 'info');
        } catch(e3) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: toOpen }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/upload') {
    const filename = decodeURIComponent(url.searchParams.get('name') || 'unnamed');
    const fileSize = parseInt(url.searchParams.get('size') || '0', 10);
    const transferId = url.searchParams.get('transferId');

    let foundTransfer = null;
    if (transferId) {
      for (const [_, list] of incomingTransfers) {
        const t = list.find(x => x.id === transferId);
        if (t) { foundTransfer = t; break; }
      }
    }

    const targetDev = foundTransfer ? devices.get(foundTransfer.targetDeviceId) : null;
    const isSendingToRemote = foundTransfer && targetDev && !targetDev.isHost;

    // Safety: limit filename length and reject path traversal
    if (filename.length > 500 || filename.includes('..')) {
      res.writeHead(400); res.end('Invalid name'); return;
    }

    // Count body bytes for live progress (both chunked and single)
    if (foundTransfer) {
      if (typeof foundTransfer.receivedBytes !== 'number') foundTransfer.receivedBytes = 0;
      req.on('data', (chunk) => { foundTransfer.receivedBytes += chunk.length; });
    }

    // --- Single (non-chunked) upload ---
    let savePath;
    if (isSendingToRemote) {
      const transferDir = path.join(TRANSFERS_DIR, transferId);
      if (!fs.existsSync(transferDir)) fs.mkdirSync(transferDir, { recursive: true });
      savePath = path.join(transferDir, path.basename(filename));
    } else {
      savePath = path.join(saveDir, filename.replace(/\//g, '\\'));
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    setImmediate(() => console.log('[UPLOAD] Receiving: ' + filename + ' (' + fmtBytes(fileSize) + ')'));

    // High performance write stream: 512KB buffer, no fsync on every write
    const ws = fs.createWriteStream(savePath, {
      highWaterMark: 512 * 1024,
      flags: 'w'
    });
    let uploadDone = false;
    let uploadFailed = false;
    function failOnce(fsize, reason, code) {
      if (uploadFailed) return;
      uploadFailed = true;
      stats.failed++;
      stats.failedBytes += fsize;
      failedFiles.push({ file: filename, reason });
      addLog('FAILED: ' + filename + ' - ' + reason, 'error', fsize);
      try { ws.destroy(); } catch(e) {}
      try { fs.unlinkSync(savePath); } catch(e) {}
      if (!res.headersSent) { res.writeHead(code || 500); res.end(reason); }
    }
    ws.on('finish', () => {
      uploadDone = true;
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      if (!isSendingToRemote) {
        stats.saved++;
        stats.savedBytes += fsize;
        addLog('SAVED: ' + filename + ' (' + fmtBytes(fsize) + ')', 'saved', fsize);
      }
      if (foundTransfer) {
        if (!foundTransfer.uploadedFiles) foundTransfer.uploadedFiles = [];
        // Dedupe by name so a client retry does not create a duplicate entry
        // and fire the length >= files.length check too early.
        const at = foundTransfer.uploadedFiles.findIndex(x => x.name === filename);
        if (at >= 0) foundTransfer.uploadedFiles[at] = { name: filename, size: fsize };
        else foundTransfer.uploadedFiles.push({ name: filename, size: fsize });
        // Use unique-name count for completion (retry of same file should not advance it)
        const uniq = new Set(foundTransfer.uploadedFiles.map(x => x.name)).size;
        const needed = (foundTransfer.files || []).length;
        if (uniq >= needed) {
          // Ensure 100% on completion even if chunk counting drifted
          foundTransfer.receivedBytes = (foundTransfer.files || []).reduce((s,f)=>s+(f.size||0), 0);
          foundTransfer.status = isSendingToRemote ? 'ready' : 'completed';
          foundTransfer.completedAt = Date.now();
          addLog('Transfer ' + (isSendingToRemote ? 'ready for download' : 'completed') + ': ' + uniq + '/' + needed + ' files', 'info');
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
          try { sseBroadcastTransfers(); } catch(e) {}
        }
      }
      if (!res.headersSent) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Saved: ' + filename); }
    });

    req.on('error', (err) => {
      if (uploadDone || uploadFailed) return;
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      failOnce(fsize, err.message, 500);
    });

    ws.on('error', (err) => {
      if (uploadDone || uploadFailed) return;
      const fsize = parseInt(url.searchParams.get('size') || '0', 10);
      failOnce(fsize, 'WRITE ERROR: ' + err.message, 500);
    });

    // Clean partial file on abort/close — do not send 499 here (would race with normal finish)
    req.on('aborted', () => {
      if (uploadDone || uploadFailed) return;
      try { ws.destroy(); } catch(e) {}
      try { fs.unlinkSync(savePath); } catch(e) {}
    });
    req.on('close', () => {
      if (uploadDone || uploadFailed) return;
      setTimeout(() => {
        if (uploadDone || uploadFailed) return;
        if (res.writableEnded || res.headersSent) return;
        try {
          if (fs.existsSync(savePath)) {
            const st = fs.statSync(savePath);
            const expect = parseInt(url.searchParams.get('size') || '0', 10);
            if (expect > 0 && st.size < expect) {
              try { ws.destroy(); } catch(e) {}
              try { fs.unlinkSync(savePath); } catch(e) {}
            }
          }
        } catch(e) {}
      }, 400);
    });
    req.pipe(ws, { end: true });

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
    { name: 'statusHtml', html: statusHtml },
    { name: 'devicesHtml', html: devicesHtmlFinal }
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
    const dynamicIds = ['pickerHint', 'renameBtn', 'clearSel'];
    const missing = ids.filter(id => !page.html.includes('id="' + id + '"') && !dynamicIds.includes(id));
    if (missing.length > 0) {
      console.error('[VALIDATE] WARNING: ' + page.name + ' has getElementById for missing IDs: ' + missing.join(', '));
    }
  }
}

validateBrowserJS();

(async () => {
  // TCP optimizations for HTTP
  httpServer.keepAliveTimeout = 60000;
  httpServer.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000);
  });

  // Start HTTP engine immediately on port 8001
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('[HTTP] Engine active on http://' + HOST_IP + ':' + HTTP_PORT + '/devices-ui');
    console.log('[HTTP] Local access: http://localhost:' + HTTP_PORT + '/devices-ui');
    addLog('Server started (HTTP:' + HTTP_PORT + ')', 'info');
  });

  const allIPs = getAllLocalIPs();

  try {
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
      console.log('📱 CONNECTED DEVICES (PC & Mobile):');
      console.log('   https://' + HOST_IP + ':' + HTTPS_PORT + '/devices-ui');
      console.log('⚡ QUICK DIRECT UPLOAD:');
      console.log('   https://' + HOST_IP + ':' + HTTPS_PORT + '/');
      console.log('📊 STATUS DASHBOARD:');
      console.log('   https://' + HOST_IP + ':' + HTTPS_PORT + '/status');
      console.log('📂 SAVES TO: ' + saveDir);
      if (allIPs.length > 1) {
        console.log('Available network interfaces:');
        allIPs.forEach(item => {
          if (item.address !== HOST_IP) {
            console.log('   https://' + item.address + ':' + HTTPS_PORT + '/devices-ui (' + item.name + ')');
          }
        });
      }
      console.log('🌐 VERCEL LINK FOR OTHER DEVICES (Phones / Mac):');
      console.log('   https://live-site-pi.vercel.app/?host=' + HOST_IP + '&port=' + HTTP_PORT + '&name=Host+PC');
      console.log('🖥️ VERCEL LINK FOR THIS HOST PC:');
      console.log('   https://live-site-pi.vercel.app/?host=' + HOST_IP + '&port=' + HTTP_PORT + '&name=Host+PC&role=host');
      console.log('='.repeat(55));
      addLog('Secure server started (HTTPS:' + HTTPS_PORT + ')', 'info');

      // For installed apps, immediately sync latest UI from live cloud
      if (!isDevWorkspace) {
        syncWithLiveCloud(true).catch(() => {});
      }
    });
  } catch (tlsErr) {
    console.warn('[HTTPS] Note: HTTPS not active (' + tlsErr.message + '), HTTP active on port ' + HTTP_PORT);
  }

  let announcedOnce = false;
  let cachedPublicIp = null;

  async function getPublicIp() {
    if (cachedPublicIp) return cachedPublicIp;
    const providers = [
      'https://api4.ipify.org?format=json',
      'https://api.ipify.org?format=json',
      'https://ipv4.icanhazip.com',
      'https://v4.ident.me'
    ];
    for (const url of providers) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          let ip = '';
          if (url.includes('json')) {
            const json = await res.json();
            ip = json.ip;
          } else {
            ip = (await res.text()).trim();
          }
          if (ip && ip.includes('.')) {
            cachedPublicIp = ip;
            return cachedPublicIp;
          }
        }
      } catch (e) {}
    }
    return 'default';
  }

  function getNetworkTopics(ip) {
    const topics = ['ftf-hotspot-active'];
    if (!ip || ip === 'default') return topics;
    const clean = ip.replace(/[^a-zA-Z0-9]/g, '_');
    topics.push('ftf-net-' + clean);
    const parts = ip.split('.');
    if (parts.length === 4) {
      topics.push('ftf-sub-' + parts[0] + '_' + parts[1] + '_' + parts[2]);
    }
    return topics;
  }

  const CLOUD_RELAYS = [
    'https://ntfy.sh',
    'https://ntfy.envs.net'
  ];

  async function announceToLiveWrapper(isActive = true) {
    const pubIp = await getPublicIp();
    const topics = getNetworkTopics(pubIp);

    const payload = {
      active: isActive,
      hostIp: HOST_IP,
      allIps: getAllLocalIPs(),
      httpPort: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      deviceName: 'Host PC',
      publicIp: pubIp,
      connectedDevices: devices ? devices.size : 0,
      timestamp: isActive ? Date.now() : 0
    };

    const bodyStr = JSON.stringify(payload);
    let publishedRelay = null;

    // 1. Publish to all topics (exact + subnet + hotspot-active) across redundant relays
    for (const topic of topics) {
      for (const relay of CLOUD_RELAYS) {
        try {
          const res = await fetch(relay + '/' + topic, {
            method: 'POST',
            headers: { 'Title': 'FileTransfer Host Heartbeat' },
            body: bodyStr,
            signal: AbortSignal.timeout(2500)
          });
          if (res.ok) {
            publishedRelay = relay;
            break;
          }
        } catch (e) {}
      }
    }

    // 2. Publish directly to Vercel API endpoint
    if (LIVE_WRAPPER_URL) {
      try {
        await fetch(`${LIVE_WRAPPER_URL.replace(/\/$/, '')}/api/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          signal: AbortSignal.timeout(2500)
        });
      } catch (err) {}
    }

    // 3. Publish to direct cloud registry fallback
    try {
      await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'file-transfer-active-host',
          data: payload
        }),
        signal: AbortSignal.timeout(2500)
      });
    } catch (e) {}

    if (isActive && !announcedOnce) {
      announcedOnce = true;
      console.log(`[CLOUD-LOBBY] Network lobby active on: ${topics.join(', ')} (${publishedRelay || 'relays'})`);
      console.log(`[CLOUD-LOBBY] Live heartbeat: http://${HOST_IP}:${HTTP_PORT}/devices-ui`);
    }
  }

  // Send live heartbeat immediately and every 3 seconds while engine is running
  announceToLiveWrapper(true);
  const heartbeatTimer = setInterval(() => announceToLiveWrapper(true), 3000);

  // Clean shutdown: mark host offline in cloud lobby immediately
  async function markOffline() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      const pubIp = cachedPublicIp || await getPublicIp();
      const topics = getNetworkTopics(pubIp);
      const data = JSON.stringify({ active: false, hostIp: HOST_IP, timestamp: 0 });

      // Mark offline on Vercel
      if (LIVE_WRAPPER_URL) {
        try {
          await fetch(`${LIVE_WRAPPER_URL.replace(/\/$/, '')}/api/announce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: data,
            signal: AbortSignal.timeout(1500)
          });
        } catch (e) {}
      }

      // Mark offline on cloud registry
      try {
        await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'file-transfer-active-host',
            data: { active: false, timestamp: 0 }
          }),
          signal: AbortSignal.timeout(1500)
        });
      } catch (e) {}

      // Mark offline on relays
      for (const topic of topics) {
        for (const relay of CLOUD_RELAYS) {
          try {
            await fetch(relay + '/' + topic, {
              method: 'POST',
              headers: { 'Title': 'FileTransfer Host Offline' },
              body: data,
              signal: AbortSignal.timeout(1500)
            });
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  process.on('SIGINT', async () => { await markOffline(); process.exit(0); });
  process.on('SIGTERM', async () => { await markOffline(); process.exit(0); });
})();


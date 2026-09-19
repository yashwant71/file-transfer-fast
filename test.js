const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_FILE = path.join(__dirname, 'server.js');
const CLIENT_FILE = path.join(__dirname, 'client.js');
const TEST_PORT = 8001;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch (e) { resolve({ status: res.statusCode, body: b }); }
      });
    });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function uploadDummyFile(url, name, size, content) {
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/upload?name=' + encodeURIComponent(name) + '&size=' + size);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(content);
    req.end();
  });
}

// --- Static tests (no server needed) ---
describe('Static validation', () => {
  it('server.js exists', () => {
    assert.ok(fs.existsSync(SERVER_FILE));
  });

  it('server.js compiles', () => {
    const code = fs.readFileSync(SERVER_FILE, 'utf8');
    assert.doesNotThrow(() => new vm.Script(code));
  });

  it('client.js exists and compiles', () => {
    assert.ok(fs.existsSync(CLIENT_FILE));
    const js = fs.readFileSync(CLIENT_FILE, 'utf8');
    assert.doesNotThrow(() => new vm.Script(js));
  });

  it('client.js has no template literal backtick issues', () => {
    const js = fs.readFileSync(CLIENT_FILE, 'utf8');
    // Should not have double-escaped backslashes from template processing
    assert.ok(!js.includes('\\\\\\\\'), 'client.js has over-escaped backslashes');
    assert.ok(!js.includes("split('\\\\\\\\\\\\\\\\')"), 'client.js has broken split patterns');
  });

  it('senderHtml uses __CLIENT_JS__ placeholder', () => {
    const code = fs.readFileSync(SERVER_FILE, 'utf8');
    assert.ok(code.includes('__CLIENT_JS__'), 'Missing __CLIENT_JS__ placeholder');
    assert.ok(code.includes("senderHtml.replace('__CLIENT_JS__', clientJs)"), 'Missing injection code');
  });

  it('senderHtml has all required DOM element IDs', () => {
    const code = fs.readFileSync(SERVER_FILE, 'utf8');
    const htmlStart = code.indexOf('const senderHtml = `') + 20;
    const htmlEnd = code.indexOf('`;', htmlStart);
    const html = code.substring(htmlStart, htmlEnd);

    const clientJs = fs.readFileSync(CLIENT_FILE, 'utf8');
    const ids = [...clientJs.matchAll(/getElementById\(['"](\w+)['"]\)/g)].map(m => m[1]);
    const dynamicIds = ['pickerHint', 'clearSel'];
    const missing = ids.filter(id => !html.includes('id="' + id + '"') && !dynamicIds.includes(id));
    assert.deepEqual(missing, [], `Missing element IDs: ${missing.join(', ')}`);
  });

  it('client.js split patterns are correct (not double-escaped)', () => {
    const js = fs.readFileSync(CLIENT_FILE, 'utf8');
    const splitPatterns = js.match(/split\([^)]+\)/g);
    assert.ok(splitPatterns, 'No split patterns found');
    // The normalizePath function should use split('\\').join('/')
    assert.ok(js.includes("split('\\\\').join('/')"), 'normalizePath should split on single backslash');
  });

  it('server.js has required endpoints', () => {
    const code = fs.readFileSync(SERVER_FILE, 'utf8');
    const endpoints = ['/drives', '/set-dest', '/dest-root', '/dir-tree', '/diff', '/upload', '/check', '/check-folder', '/log-events'];
    for (const ep of endpoints) {
      assert.ok(code.includes("'" + ep + "'") || code.includes('"' + ep + '"'), `Missing endpoint: ${ep}`);
    }
  });
});

// --- E2E tests (need running server) ---
describe('E2E tests', () => {
  let serverProc;

  before(async () => {
    serverProc = spawn(process.execPath, [SERVER_FILE], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(TEST_PORT) }
    });
    // Wait for server to be ready
    for (let i = 0; i < 20; i++) {
      try {
        await fetchPage(SERVER_URL + '/dest-root');
        return;
      } catch(e) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw new Error('Server did not start within 10s');
  });

  after(() => {
    if (serverProc) serverProc.kill();
  });

  it('GET / returns sender page', async () => {
    const res = await fetchPage(SERVER_URL + '/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('sendBtn'), 'Missing sendBtn');
    assert.ok(res.body.includes('stopBtn'), 'Missing stopBtn');
    assert.ok(res.body.includes('resendBtn'), 'Missing resendBtn');
    assert.ok(res.body.includes('skipPanel'), 'Missing skipPanel');
    assert.ok(res.body.includes('destBrowseBtn'), 'Missing destBrowseBtn');
  });

  it('GET /drives returns drive list', async () => {
    const res = await fetchPage(SERVER_URL + '/drives');
    assert.equal(res.status, 200);
    const drives = JSON.parse(res.body);
    assert.ok(Array.isArray(drives), 'Not an array');
    assert.ok(drives.length > 0, 'No drives');
    assert.ok(drives[0].letter, 'Missing letter property');
  });

  it('GET /dest-root returns current root', async () => {
    const res = await fetchPage(SERVER_URL + '/dest-root');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.root, 'Missing root');
  });

  it('POST /set-dest changes root', async () => {
    const origRes = await fetchPage(SERVER_URL + '/dest-root');
    const origRoot = JSON.parse(origRes.body).root;

    const tmpRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ft-test-'));
    const setRes = await postJSON(SERVER_URL + '/set-dest', { root: tmpRoot });
    assert.equal(setRes.status, 200);
    assert.ok(setRes.body.root, 'Missing root in response');

    // Restore
    await postJSON(SERVER_URL + '/set-dest', { root: origRoot });
    try { fs.rmdirSync(tmpRoot); } catch(e) {}
  });

  it('GET /dir-tree returns subdirectories', async () => {
    const res = await fetchPage(SERVER_URL + '/dir-tree');
    assert.equal(res.status, 200);
    const dirs = JSON.parse(res.body);
    assert.ok(Array.isArray(dirs), 'Not an array');
  });

  it('GET /status returns status page', async () => {
    const res = await fetchPage(SERVER_URL + '/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Receiver Status'), 'Missing title');
  });

  it('POST /upload saves file', async () => {
    const filename = 'test_upload_verify.txt';
    const content = 'Hello, test upload verification!';
    const size = Buffer.byteLength(content);

    const uploadRes = await uploadDummyFile(SERVER_URL, filename, size, content);
    assert.equal(uploadRes.status, 200);
    assert.ok(uploadRes.body.includes('Saved:'), 'Expected Saved response, got: ' + uploadRes.body);

    // Clean up if file exists (server saves to its current saveDir)
    const rootRes = await fetchPage(SERVER_URL + '/dest-root');
    const targetPath = path.join(JSON.parse(rootRes.body).root, filename);
    try { fs.unlinkSync(targetPath); } catch(e) {}
  });

  it('POST /check-folder returns folder status', async () => {
    const res = await postJSON(SERVER_URL + '/check-folder', { path: '' });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === 'object', 'Not an object');
  });

  it('GET /devices-ui returns connected devices page', async () => {
    const res = await fetchPage(SERVER_URL + '/devices-ui');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('File Share'), 'Missing File Share title');
    assert.ok(res.body.includes('deviceList'), 'Missing deviceList container');
    assert.ok(res.body.includes('histList'), 'Missing histList container');
  });

  it('Device flow: register, heartbeat, send, ack, unregister', async () => {
    // 1. Register Device A (PC)
    const regA = await postJSON(SERVER_URL + '/register', {
      id: 'test_dev_pc',
      name: 'Test PC',
      userAgent: 'Windows'
    });
    assert.equal(regA.status, 200);
    assert.equal(regA.body.id, 'test_dev_pc');
    assert.ok(Array.isArray(regA.body.devices));

    // 2. Register Device B (Mobile Phone)
    const regB = await postJSON(SERVER_URL + '/register', {
      id: 'test_dev_phone',
      name: 'Test Android Phone',
      userAgent: 'Android'
    });
    assert.equal(regB.status, 200);
    assert.equal(regB.body.id, 'test_dev_phone');

    // 3. GET /devices returns both
    const devListRes = await fetchPage(SERVER_URL + '/devices');
    assert.equal(devListRes.status, 200);
    const devs = JSON.parse(devListRes.body);
    assert.ok(devs.some(d => d.id === 'test_dev_pc'), 'PC missing from device list');
    assert.ok(devs.some(d => d.id === 'test_dev_phone'), 'Phone missing from device list');

    // 4. Heartbeat
    const hbRes = await postJSON(SERVER_URL + '/heartbeat', { id: 'test_dev_phone' });
    assert.equal(hbRes.status, 200);
    assert.equal(hbRes.body.success, true);

    // 5. Send files from PC to Phone
    const sendRes = await postJSON(SERVER_URL + '/send-to-device', {
      senderId: 'test_dev_pc',
      targetDeviceId: 'test_dev_phone',
      files: [{ name: 'sample.txt', size: 100 }]
    });
    assert.equal(sendRes.status, 200);
    assert.equal(sendRes.body.success, true);
    assert.ok(sendRes.body.transferId);
    const transferId = sendRes.body.transferId;

    // 6. Incoming queue on Phone
    const incRes = await fetchPage(SERVER_URL + '/incoming?deviceId=test_dev_phone');
    assert.equal(incRes.status, 200);
    const incTransfers = JSON.parse(incRes.body);
    assert.ok(incTransfers.some(t => t.id === transferId), 'Transfer missing in incoming queue');

    // 7. Accept transfer on Phone
    const ackRes = await postJSON(SERVER_URL + '/ack-transfer', {
      deviceId: 'test_dev_phone',
      transferId: transferId,
      action: 'accept'
    });
    assert.equal(ackRes.status, 200);
    assert.equal(ackRes.body.success, true);

    // 8. Transfer status is accepted
    const statusRes = await fetchPage(SERVER_URL + '/transfer-status?transferId=' + transferId);
    assert.equal(statusRes.status, 200);
    const statusData = JSON.parse(statusRes.body);
    assert.equal(statusData.status, 'accepted');

    // 9. Unregister devices
    await postJSON(SERVER_URL + '/unregister', { id: 'test_dev_pc' });
    await postJSON(SERVER_URL + '/unregister', { id: 'test_dev_phone' });
  });
});

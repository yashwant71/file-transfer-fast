const http = require('http');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_FILE = path.join(__dirname, 'server.js');
const TEST_PORT = 8099;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0, failed = 0;

function ok(name) { passed++; console.log('  OK   ' + name); }
function fail(name, msg) { failed++; console.error('  FAIL  ' + name + ': ' + msg); }

// HTTP client helpers
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
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json)
      }
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
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': size
      }
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

// Static Analysis Helpers
function extractTemplate(serverCode, varName) {
  const marker = `const ${varName} = \``;
  const start = serverCode.indexOf(marker);
  if (start === -1) throw new Error(`Could not find variable "${varName}" in server.js`);
  
  const contentStart = start + marker.length;
  let end = -1;
  let i = contentStart;
  
  while (i < serverCode.length) {
    if (serverCode[i] === '`') {
      let backslashes = 0;
      let j = i - 1;
      while (j >= contentStart && serverCode[j] === '\\') {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        if (serverCode.substring(i + 1, i + 3).trim().startsWith(';')) {
          end = i;
          break;
        }
      }
    }
    i++;
  }
  
  if (end === -1) throw new Error(`Could not find end of template for "${varName}"`);
  return serverCode.substring(contentStart, end);
}

function runStaticChecks() {
  console.log('=== Phase 1: Static Tests (Offline) ===\n');

  if (!fs.existsSync(SERVER_FILE)) {
    fail('Find server.js', 'server.js file does not exist at ' + SERVER_FILE);
    return false;
  }
  ok('server.js exists');

  let serverCode;
  try {
    serverCode = fs.readFileSync(SERVER_FILE, 'utf8');
  } catch(e) {
    fail('Read server.js', e.message);
    return false;
  }

  // Verify server.js Node syntax
  try {
    new vm.Script(serverCode);
    ok('server.js node syntax compiles OK');
  } catch(e) {
    fail('server.js compile', e.message);
  }

  // Extract HTML variables
  let senderHtml, statusHtml;
  try {
    senderHtml = extractTemplate(serverCode, 'senderHtml');
    ok('Extracted senderHtml template');
  } catch(e) {
    fail('Extract senderHtml', e.message);
  }

  try {
    statusHtml = extractTemplate(serverCode, 'statusHtml');
    ok('Extracted statusHtml template');
  } catch(e) {
    fail('Extract statusHtml', e.message);
  }

  const pages = [
    { name: 'senderHtml', html: senderHtml },
    { name: 'statusHtml', html: statusHtml }
  ];

  for (const page of pages) {
    if (!page.html) continue;

    // Check script block exists
    if (page.html.includes('<script>') && page.html.includes('</script>')) {
      ok(`${page.name} has script block`);
    } else {
      fail(`${page.name} script block`, 'Missing script tags');
      continue;
    }

    const s = page.html.indexOf('<script>') + 8;
    const e = page.html.indexOf('</script>');
    const js = page.html.substring(s, e);

    // Syntax Compile
    try {
      new vm.Script(js);
      ok(`${page.name} browser JS syntax OK (${js.split('\n').length} lines)`);
    } catch(err) {
      const lines = js.split('\n');
      const m = err.stack ? err.stack.match(/:(\d+)/) : null;
      if (m) {
        const ln = parseInt(m[1]);
        fail(`${page.name} browser JS syntax`, 'Line ' + ln + ': ' + err.message + '\n    -> ' + (lines[ln-1] || '').trim());
      } else {
        fail(`${page.name} browser JS syntax`, err.message);
      }
    }

    // Apostrophe check (no raw apostrophes inside single-quoted strings)
    const lines = js.split('\n');
    let apostropheIssue = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.match(/'\w+'\w+/)) {
        fail(`${page.name} apostrophe check`, 'Line ' + (i+1) + ': unescaped single quote in single-quoted string: ' + l.trim().substring(0, 80));
        apostropheIssue = true;
      }
    }
    if (!apostropheIssue) ok(`${page.name} has no single-quoted apostrophe bugs`);

    // getElementById checks
    const ids = [...js.matchAll(/getElementById\(['"](\w+)['"]\)/g)].map(m => m[1]);
    const missing = ids.filter(id => !page.html.includes('id="' + id + '"') && !page.html.includes(`id='${id}'`));
    if (missing.length === 0) {
      ok(`All ${ids.length} getElementById IDs exist in ${page.name} HTML`);
    } else {
      fail(`${page.name} getElementById IDs`, 'Missing: ' + missing.join(', '));
    }
  }

  console.log('');
  return failed === 0;
}

// Integration / E2E Tests
async function runIntegrationChecks() {
  console.log('=== Phase 2: Integration Tests (E2E) ===\n');
  console.log(`Starting test server process on port ${TEST_PORT}...`);

  let serverProcess;
  try {
    serverProcess = spawn('node', [SERVER_FILE], {
      env: { ...process.env, PORT: TEST_PORT }
    });
  } catch(e) {
    fail('Start server process', e.message);
    return;
  }

  // Promise that resolves when server logs "Server started" or times out
  const serverReady = new Promise((resolve) => {
    let output = '';
    const timer = setTimeout(() => {
      console.warn('Warning: Server did not print "Server started" within 3s. Proceeding with tests anyway...');
      resolve();
    }, 3000);

    serverProcess.stdout.on('data', data => {
      output += data.toString();
      if (output.includes('Server started') || output.includes('SENDER:')) {
        clearTimeout(timer);
        resolve();
      }
    });

    serverProcess.stderr.on('data', data => {
      console.error('[Server Error Log]:', data.toString().trim());
    });
  });

  await serverReady;
  console.log('Server process is running. Executing E2E tests...\n');

  try {
    // 1. GET /
    try {
      const res = await fetchPage(SERVER_URL + '/');
      if (res.status === 200 && res.body.includes('<!DOCTYPE html>')) {
        ok('GET / responds with HTML');
      } else {
        fail('GET /', `Status ${res.status}, body length ${res.body.length}`);
      }
    } catch(e) { fail('GET /', e.message); }

    // 2. GET /status
    try {
      const res = await fetchPage(SERVER_URL + '/status');
      if (res.status === 200 && res.body.includes('Receiver Status')) {
        ok('GET /status responds with HTML');
      } else {
        fail('GET /status', `Status ${res.status}`);
      }
    } catch(e) { fail('GET /status', e.message); }

    // 3. GET /stats
    try {
      const res = await fetchPage(SERVER_URL + '/stats');
      if (res.status === 200) {
        const stats = JSON.parse(res.body);
        if (typeof stats.saved === 'number') ok('GET /stats returns JSON metrics');
        else fail('GET /stats', 'Missing metrics keys');
      } else {
        fail('GET /stats', `Status ${res.status}`);
      }
    } catch(e) { fail('GET /stats', e.message); }

    // 4. GET /log-events
    try {
      const res = await fetchPage(SERVER_URL + '/log-events?since=0');
      if (res.status === 200) {
        const logs = JSON.parse(res.body);
        if (Array.isArray(logs)) ok('GET /log-events returns array of logs');
        else fail('GET /log-events', 'Not an array');
      } else {
        fail('GET /log-events', `Status ${res.status}`);
      }
    } catch(e) { fail('GET /log-events', e.message); }

    // 5. POST /diff
    try {
      const res = await postJSON(SERVER_URL + '/diff', [{ name: 'test_file_diff.txt', size: 123 }]);
      if (res.status === 200 && Array.isArray(res.body.missing)) {
        ok('POST /diff returns missing file lists');
      } else {
        fail('POST /diff', `Status ${res.status}`);
      }
    } catch(e) { fail('POST /diff', e.message); }

    // 6. POST /check
    try {
      const res = await postJSON(SERVER_URL + '/check', { name: 'test_file_check.txt', size: 123 });
      if (res.status === 200 && typeof res.body.exists === 'boolean') {
        ok('POST /check returns file existence check');
      } else {
        fail('POST /check', `Status ${res.status}`);
      }
    } catch(e) { fail('POST /check', e.message); }

    // 7. POST /check-folder
    try {
      const res = await postJSON(SERVER_URL + '/check-folder', { name: 'x', totalSize: 0, fileCount: 0, children: [] });
      if (res.status === 200 && Array.isArray(res.body.skippedFolders)) {
        ok('POST /check-folder returns skipped folders tree check');
      } else {
        fail('POST /check-folder', `Status ${res.status}`);
      }
    } catch(e) { fail('POST /check-folder', e.message); }

    // 8. POST /upload (Upload and Verify pipeline)
    try {
      const dummyFilename = 'test_upload_verify_file.txt';
      const dummyContent = 'Hello, this is a test upload verification content!';
      const size = Buffer.byteLength(dummyContent);
      
      const uploadRes = await uploadDummyFile(SERVER_URL, dummyFilename, size, dummyContent);
      if (uploadRes.status === 200 && uploadRes.body.includes('Saved:')) {
        ok('POST /upload saves files successfully');
        
        // Verify file is saved in SAVE_DIR
        // In server.js, SAVE_DIR defaults to D:\art. Let's see if the file exists there
        const targetPath = path.join('D:\\art', dummyFilename);
        if (fs.existsSync(targetPath)) {
          const contentOnDisk = fs.readFileSync(targetPath, 'utf8');
          if (contentOnDisk === dummyContent) {
            ok('Uploaded file content verified on disk');
          } else {
            fail('Uploaded file content', 'Content mismatch on disk');
          }
          // Clean up the dummy file from disk
          try { fs.unlinkSync(targetPath); } catch(err) {}
        } else {
          fail('Uploaded file location', `File not found on disk at: ${targetPath}`);
        }
      } else {
        fail('POST /upload', `Status ${uploadRes.status}, Body: ${uploadRes.body}`);
      }
    } catch(e) { fail('POST /upload validation', e.message); }

  } finally {
    console.log('\nTearing down test server process...');
    serverProcess.kill('SIGTERM');
    // Ensure it is completely killed
    await new Promise(resolve => {
      serverProcess.on('exit', () => resolve());
      // fallback in case SIGTERM is not handled nicely on Windows
      setTimeout(() => {
        try { serverProcess.kill('SIGKILL'); } catch(e) {}
        resolve();
      }, 500);
    });
    console.log('Server process terminated.');
  }
}

async function main() {
  const staticPassed = runStaticChecks();
  if (!staticPassed) {
    console.error('Static checks failed. Aborting integration tests.');
    console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
    process.exit(1);
  }

  await runIntegrationChecks();

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

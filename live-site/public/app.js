// live-site/public/app.js — Network-Isolated Instant Host Discovery & 1-Click Connect
(function() {
  const tabFind = document.getElementById('tabFind');
  const tabHost = document.getElementById('tabHost');
  const viewFind = document.getElementById('viewFind');
  const viewHost = document.getElementById('viewHost');

  const stateScanning = document.getElementById('stateScanning');
  const stateHostFound = document.getElementById('stateHostFound');
  const stateNoHost = document.getElementById('stateNoHost');
  const netStatus = document.getElementById('netStatus');

  const hostFoundTitle = document.getElementById('hostFoundTitle');
  const hostFoundSubtitle = document.getElementById('hostFoundSubtitle');
  const foundHostName = document.getElementById('foundHostName');
  const foundHostBadge = document.getElementById('foundHostBadge');
  const foundHostIp = document.getElementById('foundHostIp');
  const connectDirectBtn = document.getElementById('connectDirectBtn');
  const selfHostBtn = document.getElementById('selfHostBtn');
  const hostFooterNote = document.getElementById('hostFooterNote');
  const rescanBtn = document.getElementById('rescanBtn');

  const manualIpInput = document.getElementById('manualIpInput');
  const manualConnectBtn = document.getElementById('manualConnectBtn');

  let publicIp = null;
  let networkTopic = null;

  // Tab switching
  tabFind.addEventListener('click', () => {
    tabFind.classList.add('active');
    tabHost.classList.remove('active');
    viewFind.classList.remove('hidden');
    viewHost.classList.add('hidden');
  });

  tabHost.addEventListener('click', () => {
    tabHost.classList.add('active');
    tabFind.classList.remove('active');
    viewHost.classList.remove('hidden');
    viewFind.classList.add('hidden');
  });

  function showFindState(state) {
    stateScanning.classList.add('hidden');
    stateHostFound.classList.add('hidden');
    stateNoHost.classList.add('hidden');

    if (state === 'scanning') stateScanning.classList.remove('hidden');
    else if (state === 'found') stateHostFound.classList.remove('hidden');
    else if (state === 'no_host') stateNoHost.classList.remove('hidden');
  }

  // Get current device's public IP
  async function resolvePublicIp() {
    if (publicIp) return publicIp;
    try {
      const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = await res.json();
        publicIp = json.ip;
        networkTopic = 'ftf-net-' + publicIp.replace(/[^a-zA-Z0-9]/g, '_');
        return publicIp;
      }
    } catch(e) {}
    try {
      const res = await fetch('https://icanhazip.com', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        publicIp = (await res.text()).trim();
        networkTopic = 'ftf-net-' + publicIp.replace(/[^a-zA-Z0-9]/g, '_');
        return publicIp;
      }
    } catch(e) {}
    networkTopic = 'ftf-net-default';
    return null;
  }

  function displayHostFound(hostIp, port, name, isSelf) {
    showFindState('found');
    netStatus.innerHTML = '<span class="dot" style="background:#10b981"></span> Host Ready';

    if (isSelf) {
      hostFoundTitle.textContent = '🟢 You are Hosting!';
      hostFoundSubtitle.textContent = 'Your transfer engine is active on this device.';
      foundHostName.textContent = 'This Device (Host)';
      foundHostBadge.textContent = 'HOSTING';
      foundHostBadge.style.background = 'rgba(59, 130, 246, 0.2)';
      foundHostBadge.style.color = '#60a5fa';
      foundHostIp.textContent = hostIp + ':' + port;

      connectDirectBtn.textContent = '📂 Open Local Transfer UI →';
      connectDirectBtn.href = 'http://localhost:' + port + '/devices-ui';
      selfHostBtn.classList.add('hidden');
      hostFooterNote.textContent = 'Other phones or PCs on this Wi-Fi can open this website to connect to you!';
    } else {
      hostFoundTitle.textContent = 'Host Device Found!';
      hostFoundSubtitle.textContent = 'Connected on your Wi-Fi & ready to transfer.';
      foundHostName.textContent = name || 'Host PC';
      foundHostBadge.textContent = 'ONLINE';
      foundHostBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      foundHostBadge.style.color = '#10b981';
      foundHostIp.textContent = hostIp + ':' + port;

      connectDirectBtn.textContent = '⚡ Connect to Host & Transfer Files →';
      connectDirectBtn.href = 'http://' + hostIp + ':' + port + '/devices-ui';
      selfHostBtn.classList.remove('hidden');
      selfHostBtn.href = 'http://localhost:' + port + '/devices-ui';
      hostFooterNote.textContent = 'Transfers directly over your local Wi-Fi at max speed. Zero installation required.';
    }
  }

  // Check URL parameters first (e.g. ?host=10.14.0.243&port=8001&name=Host+PC)
  const urlParams = new URLSearchParams(window.location.search);
  const paramHost = urlParams.get('host');
  const paramPort = urlParams.get('port') || '8001';
  const paramName = urlParams.get('name') || 'Host Device';
  const paramRole = urlParams.get('role');

  if (paramHost) {
    const isSelf = paramRole === 'host' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    displayHostFound(paramHost, paramPort, paramName, isSelf);
    return;
  }

  // Network-isolated discovery
  const HEARTBEAT_WINDOW_MS = 15000; // 15 seconds validity window

  async function discoverHost() {
    await resolvePublicIp();
    const topic = networkTopic || 'ftf-net-default';

    try {
      const resp = await fetch('https://ntfy.sh/' + topic + '/json?poll=1&since=1m', { cache: 'no-store' });
      if (resp.ok) {
        const text = await resp.text();
        const lines = text.trim().split('\n').filter(Boolean);
        // Look at the latest message
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const item = JSON.parse(lines[i]);
            if (item.event === 'message' && item.message) {
              const data = JSON.parse(item.message);
              const now = Date.now();
              const age = now - (data.timestamp || 0);

              if (data.active === true && data.hostIp && age >= 0 && age < HEARTBEAT_WINDOW_MS) {
                const isSelf = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || paramRole === 'host';
                displayHostFound(data.hostIp, data.httpPort || 8001, data.deviceName || 'Host PC', isSelf);
                return;
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) {}

    // No active host found on this network
    showFindState('no_host');
    netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> No Host on Wi-Fi';
  }

  // Manual IP connect
  manualConnectBtn.addEventListener('click', () => {
    let val = manualIpInput.value.trim();
    if (!val) return;
    if (!val.startsWith('http://') && !val.startsWith('https://')) {
      val = 'http://' + val;
    }
    if (!val.includes('/devices-ui')) {
      val = val.replace(/\/$/, '') + '/devices-ui';
    }
    window.location.href = val;
  });

  manualIpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') manualConnectBtn.click();
  });

  rescanBtn.addEventListener('click', () => {
    showFindState('scanning');
    netStatus.innerHTML = '<span class="dot pulse"></span> Searching...';
    discoverHost();
  });

  // Initial discovery
  showFindState('scanning');
  discoverHost();

  // Auto-poll every 3.5 seconds
  setInterval(() => {
    discoverHost();
  }, 3500);
})();

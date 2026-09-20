// live-site/public/app.js — Instant Host Discovery & 1-Click Connect
(function() {
  // Elements
  const tabFind = document.getElementById('tabFind');
  const tabHost = document.getElementById('tabHost');
  const viewFind = document.getElementById('viewFind');
  const viewHost = document.getElementById('viewHost');

  const stateScanning = document.getElementById('stateScanning');
  const stateHostFound = document.getElementById('stateHostFound');
  const stateNoHost = document.getElementById('stateNoHost');
  const netStatus = document.getElementById('netStatus');

  const foundHostName = document.getElementById('foundHostName');
  const foundHostIp = document.getElementById('foundHostIp');
  const connectDirectBtn = document.getElementById('connectDirectBtn');
  const rescanBtn = document.getElementById('rescanBtn');

  const manualIpInput = document.getElementById('manualIpInput');
  const manualConnectBtn = document.getElementById('manualConnectBtn');

  // Cloud Relay URL (Shared across all networks)
  const RELAY_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98';

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

  function displayHostFound(hostIp, port, name) {
    showFindState('found');
    netStatus.innerHTML = '<span class="dot" style="background:#10b981"></span> Host Ready';
    foundHostName.textContent = name || 'Host Device';
    foundHostIp.textContent = hostIp + ':' + port;
    connectDirectBtn.href = 'http://' + hostIp + ':' + port + '/devices-ui';
  }

  // 1. Check URL parameters (?host=10.14.0.243&port=8001&name=Host+PC)
  const urlParams = new URLSearchParams(window.location.search);
  const paramHost = urlParams.get('host');
  const paramPort = urlParams.get('port') || '8001';
  const paramName = urlParams.get('name') || 'Host Device';

  if (paramHost) {
    displayHostFound(paramHost, paramPort, paramName);
    return;
  }

  // 2. Discover Active Host
  let isScanning = false;

  async function discoverHost() {
    if (isScanning) return;
    isScanning = true;

    // Check Cloud Relay
    try {
      const resp = await fetch(RELAY_URL, { cache: 'no-store' });
      if (resp.ok) {
        const json = await resp.json();
        const data = json.data;
        if (data && data.hostIp) {
          // Check if announcement is recent (within last 30 minutes)
          const now = Date.now();
          const age = now - (data.timestamp || 0);
          if (age < 30 * 60 * 1000) {
            displayHostFound(data.hostIp, data.httpPort || 8001, data.deviceName || 'Host PC');
            isScanning = false;
            return;
          }
        }
      }
    } catch (e) {
      // Cloud relay check failed, try Vercel local API next
    }

    // Check Vercel local API as secondary
    try {
      const apiResp = await fetch('/api/active-host', { cache: 'no-store' });
      if (apiResp.ok) {
        const apiData = await apiResp.json();
        if (apiData.found && apiData.hostIp) {
          displayHostFound(apiData.hostIp, apiData.httpPort || 8001, apiData.deviceName || 'Host PC');
          isScanning = false;
          return;
        }
      }
    } catch (e) {}

    // If still in scanning state after check
    if (stateHostFound.classList.contains('hidden')) {
      showFindState('no_host');
      netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Waiting for Host';
    }

    isScanning = false;
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

  // Auto poll every 6 seconds if host not yet connected
  setInterval(() => {
    if (stateHostFound.classList.contains('hidden')) {
      discoverHost();
    }
  }, 6000);
})();

// live-site/public/app.js — Instant Real-Time Host Discovery & Direct HTTP Connect
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
  const foundHostNetworks = document.getElementById('foundHostNetworks');
  const connectDirectBtn = document.getElementById('connectDirectBtn');
  const hostFooterNote = document.getElementById('hostFooterNote');
  const rescanBtn = document.getElementById('rescanBtn');

  const manualIpInput = document.getElementById('manualIpInput');
  const manualConnectBtn = document.getElementById('manualConnectBtn');

  let publicIp = null;
  let currentHostData = null;
  let isChecking = false;
  let eventSource = null;

  // Tab switching
  if (tabFind && tabHost) {
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
  }

  function showFindState(state) {
    stateScanning.classList.add('hidden');
    stateHostFound.classList.add('hidden');
    stateNoHost.classList.add('hidden');

    if (state === 'scanning') stateScanning.classList.remove('hidden');
    else if (state === 'found') stateHostFound.classList.remove('hidden');
    else if (state === 'no_host') stateNoHost.classList.remove('hidden');
  }

  // Get current device's public IPv4 address
  async function resolvePublicIp() {
    if (publicIp) return publicIp;
    const providers = [
      'https://api4.ipify.org?format=json',
      'https://api.ipify.org?format=json',
      'https://ipv4.icanhazip.com'
    ];
    for (const url of providers) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          let ip = '';
          if (url.includes('json')) {
            const json = await res.json();
            ip = json.ip;
          } else {
            ip = (await res.text()).trim();
          }
          if (ip && ip.includes('.')) {
            publicIp = ip;
            return publicIp;
          }
        }
      } catch(e) {}
    }
    return null;
  }

  function getNetworkTopics(ip) {
    const topics = [];
    if (ip) {
      const clean = ip.replace(/[^a-zA-Z0-9]/g, '_');
      topics.push('ftf-net-' + clean);
      const parts = ip.split('.');
      if (parts.length === 4) {
        topics.push('ftf-sub-' + parts[0] + '_' + parts[1] + '_' + parts[2]);
      }
    }
    topics.push('ftf-hotspot-active');
    return topics;
  }

  function displayHostFound(hostIp, port, name, allIps) {
    const primaryIp = hostIp || '127.0.0.1';
    const targetPort = port || 8001;
    const hostName = name || 'Host PC';

    currentHostData = {
      hostIp: primaryIp,
      port: targetPort,
      httpPort: targetPort,
      deviceName: hostName,
      allIps: allIps || [{ name: 'Wi-Fi', address: primaryIp }]
    };

    showFindState('found');
    netStatus.innerHTML = '<span class="dot" style="background:#10b981"></span> Host Ready';

    hostFoundTitle.textContent = 'Host Device Found!';
    hostFoundSubtitle.textContent = 'Connected on your Wi-Fi or Hotspot & ready to transfer.';
    foundHostName.textContent = hostName;
    foundHostBadge.textContent = 'ONLINE';
    foundHostBadge.style.background = 'rgba(16, 185, 129, 0.2)';
    foundHostBadge.style.color = '#10b981';
    foundHostIp.textContent = primaryIp + ':' + targetPort;

    // Connect Button takes user directly to HTTP device UI where files are sent/received
    connectDirectBtn.classList.remove('hidden');
    connectDirectBtn.href = 'http://' + primaryIp + ':' + targetPort + '/devices-ui';
    connectDirectBtn.textContent = '⚡ Connect & Send Files →';

    hostFooterNote.textContent = 'Transfers directly over your local Wi-Fi / Hotspot at maximum speed.';

    // Render connected network list if multiple
    if (foundHostNetworks) {
      if (Array.isArray(currentHostData.allIps) && currentHostData.allIps.length > 0) {
        let netHtml = '<div style="font-weight:600;margin-bottom:4px;color:#cbd5e1;">📶 Connected Networks:</div>';
        currentHostData.allIps.forEach(net => {
          const isPrimary = net.address === primaryIp;
          netHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-top:1px solid rgba(255,255,255,0.06);">
            <span>${net.name || 'Wi-Fi'}:</span>
            <span style="font-family:monospace;color:${isPrimary ? '#38bdf8' : '#94a3b8'}">${net.address}:${targetPort} ${isPrimary ? '★' : ''}</span>
          </div>`;
        });
        foundHostNetworks.innerHTML = netHtml;
        foundHostNetworks.style.display = 'block';
      } else {
        foundHostNetworks.style.display = 'none';
      }
    }
  }

  // Check URL parameters first (e.g. ?host=10.14.0.243&port=8001&name=Host+PC)
  const urlParams = new URLSearchParams(window.location.search);
  const paramHost = urlParams.get('host');
  const paramPort = urlParams.get('port') || '8001';
  const paramName = urlParams.get('name') || 'Host PC';

  if (paramHost) {
    displayHostFound(paramHost, paramPort, paramName);
    return;
  }

  // Real-time Discovery Logic (Zero Refresh Needed)
  async function checkActiveHost() {
    if (isChecking) return;
    isChecking = true;

    try {
      // 1. Try Vercel Serverless Function: /api/active-host
      try {
        const res = await fetch('/api/active-host', {
          cache: 'no-store',
          signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
          const ctype = res.headers.get('content-type') || '';
          if (ctype.includes('json')) {
            const data = await res.json();
            if (data && data.found === true && data.hostIp) {
              displayHostFound(data.hostIp, data.httpPort, data.deviceName, data.allIps);
              isChecking = false;
              return;
            }
          }
        }
      } catch(e) {}

      // 2. Try Direct Cloud Object Fallback
      try {
        const directRes = await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98', {
          cache: 'no-store',
          signal: AbortSignal.timeout(2000)
        });
        if (directRes.ok) {
          const directJson = await directRes.json();
          const hostObj = directJson.data;
          const age = Date.now() - (hostObj ? hostObj.timestamp || 0 : 0);
          if (hostObj && hostObj.active === true && hostObj.hostIp && age >= 0 && age < 20000) {
            displayHostFound(hostObj.hostIp, hostObj.httpPort, hostObj.deviceName, hostObj.allIps);
            isChecking = false;
            return;
          }
        }
      } catch(e) {}

      // 3. Multi-Relay Fast Polling (ntfy.envs.net + ntfy.sh)
      try {
        const ip = await resolvePublicIp();
        const topics = getNetworkTopics(ip);
        const CLOUD_RELAYS = ['https://ntfy.envs.net', 'https://ntfy.sh'];

        async function pollRelayTopic(relay, topic) {
          try {
            const res = await fetch(`${relay}/${topic}/json?poll=1`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(2500)
            });
            if (!res.ok) return null;
            const text = await res.text();
            const lines = text.trim().split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const item = JSON.parse(lines[i]);
                if (item.event === 'message' && item.message) {
                  const msgData = JSON.parse(item.message);
                  const age = Date.now() - (msgData.timestamp || 0);
                  if (msgData.active === true && msgData.hostIp && age >= 0 && age < 35000) {
                    return msgData;
                  }
                }
              } catch(e) {}
            }
          } catch(e) {}
          return null;
        }

        for (const topic of topics) {
          for (const relay of CLOUD_RELAYS) {
            const host = await pollRelayTopic(relay, topic);
            if (host) {
              displayHostFound(host.hostIp, host.httpPort || host.port || 8001, host.deviceName || 'Host PC', host.allIps);
              isChecking = false;
              return;
            }
          }
        }
      } catch(e) {}

      // If previously found but now offline, update dynamically without refresh
      if (currentHostData) {
        currentHostData = null;
      }
      showFindState('no_host');
      netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> No Host on Wi-Fi';
    } finally {
      isChecking = false;
    }
  }

  // Setup Real-Time Server-Sent Events (SSE) stream via ntfy.sh for 0ms instant trigger
  function initEventSource() {
    try {
      if (eventSource) {
        eventSource.close();
      }
      eventSource = new EventSource('https://ntfy.sh/ftf-hotspot-active/sse');
      eventSource.onmessage = (event) => {
        try {
          const item = JSON.parse(event.data);
          if (item && item.message) {
            const data = JSON.parse(item.message);
            const age = Date.now() - (data.timestamp || 0);
            if (data.active === true && data.hostIp && age >= 0 && age < 25000) {
              displayHostFound(data.hostIp, data.httpPort || 8001, data.deviceName || 'Host PC', data.allIps);
            } else if (data.active === false) {
              currentHostData = null;
              showFindState('no_host');
              netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> No Host on Wi-Fi';
            }
          }
        } catch(e) {}
      };
      eventSource.onerror = () => {};
    } catch(e) {}
  }

  // Manual IP connect
  if (manualConnectBtn && manualIpInput) {
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
  }

  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      showFindState('scanning');
      netStatus.innerHTML = '<span class="dot pulse"></span> Searching...';
      checkActiveHost();
    });
  }

  // Start real-time stream & fast background polling (every 1.5 seconds)
  initEventSource();
  showFindState('scanning');
  checkActiveHost();
  setInterval(checkActiveHost, 1500);
})();

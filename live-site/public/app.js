// live-site/public/app.js — Client-side discovery, probing & seamless redirect

(function() {
  const stateProbing = document.getElementById('stateProbing');
  const stateRedirecting = document.getElementById('stateRedirecting');
  const stateNotFound = document.getElementById('stateNotFound');
  const netStatus = document.getElementById('netStatus');
  const directLinkBtn = document.getElementById('directLinkBtn');
  const pinInput = document.getElementById('pinInput');
  const pinSubmitBtn = document.getElementById('pinSubmitBtn');
  const pinError = document.getElementById('pinError');
  const knownIpsSection = document.getElementById('knownIpsSection');
  const ipsList = document.getElementById('ipsList');
  const probingProgress = document.getElementById('probingProgress');
  const probingDesc = document.getElementById('probingDesc');

  // Check URL params for PIN (e.g. ?pin=4821)
  const urlParams = new URLSearchParams(window.location.search);
  const initialPin = urlParams.get('pin');

  function showState(state) {
    stateProbing.classList.add('hidden');
    stateRedirecting.classList.add('hidden');
    stateNotFound.classList.add('hidden');

    if (state === 'probing') stateProbing.classList.remove('hidden');
    else if (state === 'redirecting') stateRedirecting.classList.remove('hidden');
    else if (state === 'not_found') stateNotFound.classList.remove('hidden');
  }

  // Fast probe helper: tests if a local IP is reachable within 1800ms
  async function probeHost(ip, port) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const targetUrl = 'http://' + ip + ':' + port + '/devices-ui';

    try {
      // Use mode: 'no-cors' so even cross-origin responses register as reached
      await fetch('http://' + ip + ':' + port + '/dest-root', {
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      return targetUrl;
    } catch (err) {
      clearTimeout(timeout);
      return null;
    }
  }

  // Handle successful connection & redirect
  function triggerRedirect(directUrl, hostName) {
    showState('redirecting');
    netStatus.innerHTML = '<span class="dot" style="background:#10b981"></span> Connected to ' + (hostName || 'PC');
    directLinkBtn.href = directUrl;

    // Smooth countdown before auto navigation
    setTimeout(() => {
      window.location.href = directUrl;
    }, 1200);
  }

  // Render detected IPs in the fallback view
  function renderDetectedIps(ips, port) {
    if (!ips || !ips.length) {
      knownIpsSection.classList.add('hidden');
      return;
    }
    knownIpsSection.classList.remove('hidden');
    ipsList.innerHTML = '';

    ips.forEach(item => {
      const ip = typeof item === 'string' ? item : item.address;
      const name = item.name ? ' (' + item.name + ')' : '';
      const directUrl = 'http://' + ip + ':' + port + '/devices-ui';

      const li = document.createElement('li');
      li.className = 'ip-item';
      li.innerHTML = `<span>${ip}${name}</span><a href="${directUrl}">Try Link &rarr;</a>`;
      ipsList.appendChild(li);
    });
  }

  // Check for host and probe connectivity
  async function checkAndConnect(pinToTry) {
    showState('probing');
    probingProgress.style.width = '30%';
    probingDesc.textContent = 'Contacting discovery lobby...';

    const apiUrl = '/api/active-host' + (pinToTry ? '?pin=' + encodeURIComponent(pinToTry) : '');
    
    try {
      const resp = await fetch(apiUrl);
      const data = await resp.json();

      if (!data.found) {
        showState('not_found');
        netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Not Connected';
        if (pinToTry) {
          pinError.textContent = 'No active host found with PIN ' + pinToTry;
          pinError.classList.remove('hidden');
        }
        return;
      }

      probingProgress.style.width = '60%';
      probingDesc.textContent = 'Found host "' + (data.deviceName || 'Host PC') + '". Testing local Wi-Fi connection...';

      // Candidate IPs to probe
      const candidates = [];
      if (data.hostIp) candidates.push(data.hostIp);
      if (Array.isArray(data.allIps)) {
        data.allIps.forEach(i => {
          const addr = typeof i === 'string' ? i : i.address;
          if (addr && !candidates.includes(addr)) candidates.push(addr);
        });
      }

      let reachableUrl = null;
      for (const ip of candidates) {
        const probed = await probeHost(ip, data.httpPort || 8001);
        if (probed) {
          reachableUrl = probed;
          break;
        }
      }

      probingProgress.style.width = '100%';

      if (reachableUrl) {
        triggerRedirect(reachableUrl, data.deviceName);
      } else {
        // Local probe failed (app might not be installed, phone not on same Wi-Fi, or mixed content blocked)
        showState('not_found');
        netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Local App Unreachable';
        renderDetectedIps(data.allIps || [data.hostIp], data.httpPort || 8001);
      }
    } catch (err) {
      showState('not_found');
      netStatus.innerHTML = '<span class="dot" style="background:#ef4444"></span> Offline';
    }
  }

  // PIN submission
  pinSubmitBtn.addEventListener('click', () => {
    const val = pinInput.value.trim();
    if (!val || val.length !== 4) {
      pinError.textContent = 'Please enter a valid 4-digit PIN';
      pinError.classList.remove('hidden');
      return;
    }
    pinError.classList.add('hidden');
    checkAndConnect(val);
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinSubmitBtn.click();
  });

  // --- Multi-Platform Detection & Switcher ---
  const detectedOsBadge = document.getElementById('detectedOsBadge');
  const platformTitle = document.getElementById('platformTitle');
  const platformDesc = document.getElementById('platformDesc');
  const primaryActionContainer = document.getElementById('primaryActionContainer');
  const osPills = document.querySelectorAll('.os-pill');

  function detectOS() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS/i.test(ua)) return 'mac';
    if (/Linux/i.test(ua)) return 'mac';
    return 'android';
  }

  const PLATFORM_CONFIG = {
    android: {
      badge: '📱 Android',
      title: 'Need the Android APK?',
      desc: 'Install the fast local file transfer APK to send and receive files at maximum Wi-Fi speed.',
      actionHtml: `<a href="/api/download-apk" class="btn btn-primary btn-large" id="downloadApkBtn">
        <span class="btn-icon">📥</span> Download Android APK
      </a>`
    },
    ios: {
      badge: '🍏 iPhone / iPad',
      title: 'Works Directly in Safari',
      desc: 'No app install required on iOS! Open Safari, connect via your PC Wi-Fi IP, and tap Share &rarr; "Add to Home Screen" to use it as a full-screen app.',
      actionHtml: `<button class="btn btn-primary btn-large" onclick="window.scrollTo({top: 400, behavior: 'smooth'})">
        <span class="btn-icon">⚡</span> Enter PIN Below to Connect
      </button>`
    },
    windows: {
      badge: '💻 Windows PC',
      title: 'Desktop Engine for Windows',
      desc: 'Run the desktop engine with start-app.bat to host fast transfers with full access to C:, D:, and external drives.',
      actionHtml: `<a href="/api/download-windows" download class="btn btn-primary btn-large">
        <span class="btn-icon">⚡</span> Download Windows App (.zip)
      </a>`
    },
    mac: {
      badge: '🖥️ Mac / Linux',
      title: 'Run on Mac or Linux',
      desc: 'Start the engine with Node.js in one simple terminal command: node server.js.',
      actionHtml: `<div class="ip-item" style="justify-content:center; padding: 0.8rem; font-family: monospace;">
        <code>node server.js</code>
      </div>`
    }
  };

  function setPlatform(osKey) {
    const conf = PLATFORM_CONFIG[osKey] || PLATFORM_CONFIG.android;
    detectedOsBadge.textContent = conf.badge;
    platformTitle.textContent = conf.title;
    platformDesc.innerHTML = conf.desc;
    primaryActionContainer.innerHTML = conf.actionHtml;

    osPills.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.os === osKey);
    });
  }

  osPills.forEach(btn => {
    btn.addEventListener('click', () => setPlatform(btn.dataset.os));
  });

  // Set initially detected OS
  setPlatform(detectOS());

  // Start initial discovery
  checkAndConnect(initialPin);
})();

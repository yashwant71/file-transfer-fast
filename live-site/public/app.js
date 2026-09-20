// live-site/public/app.js — Instant Host Discovery & 0-Install Connection

(function() {
  const stateScanning = document.getElementById('stateScanning');
  const stateHostFound = document.getElementById('stateHostFound');
  const stateNoHost = document.getElementById('stateNoHost');
  const netStatus = document.getElementById('netStatus');
  const scanningDesc = document.getElementById('scanningDesc');
  const scanningProgress = document.getElementById('scanningProgress');

  const foundHostName = document.getElementById('foundHostName');
  const foundHostIp = document.getElementById('foundHostIp');
  const connectDirectBtn = document.getElementById('connectDirectBtn');

  const pinInput = document.getElementById('pinInput');
  const pinSubmitBtn = document.getElementById('pinSubmitBtn');
  const pinError = document.getElementById('pinError');

  function showState(state) {
    stateScanning.classList.add('hidden');
    stateHostFound.classList.add('hidden');
    stateNoHost.classList.add('hidden');

    if (state === 'scanning') stateScanning.classList.remove('hidden');
    else if (state === 'host_found') stateHostFound.classList.remove('hidden');
    else if (state === 'no_host') stateNoHost.classList.remove('hidden');
  }

  function displayHostFound(hostIp, port, name) {
    showState('host_found');
    netStatus.innerHTML = '<span class="dot" style="background:#10b981"></span> Host Ready';
    foundHostName.textContent = name || 'Host Device';
    foundHostIp.textContent = hostIp + ':' + port;
    connectDirectBtn.href = 'http://' + hostIp + ':' + port + '/devices-ui';
  }

  // Check URL parameters first (e.g. ?host=192.168.1.15&port=8001&name=Pixel+7 or ?pin=4821)
  const urlParams = new URLSearchParams(window.location.search);
  const paramHost = urlParams.get('host');
  const paramPort = urlParams.get('port') || '8001';
  const paramName = urlParams.get('name') || 'Host Device';
  const paramPin = urlParams.get('pin');

  if (paramHost) {
    displayHostFound(paramHost, paramPort, paramName);
    return;
  }

  // Probe API for active hosts
  async function searchForHost(pinToTry) {
    showState('scanning');
    scanningProgress.style.width = '40%';
    scanningDesc.textContent = pinToTry ? 'Verifying PIN...' : 'Looking for active host on your Wi-Fi...';

    const apiUrl = '/api/active-host' + (pinToTry ? '?pin=' + encodeURIComponent(pinToTry) : '');

    try {
      const resp = await fetch(apiUrl);
      const data = await resp.json();

      scanningProgress.style.width = '100%';

      if (data.found && data.hostIp) {
        displayHostFound(data.hostIp, data.httpPort || 8001, data.deviceName);
      } else {
        showState('no_host');
        netStatus.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Waiting for Host';
        if (pinToTry) {
          pinError.textContent = 'No host found with PIN ' + pinToTry + '. Is the host running?';
          pinError.classList.remove('hidden');
        }
      }
    } catch (err) {
      showState('no_host');
      netStatus.innerHTML = '<span class="dot" style="background:#ef4444"></span> Offline';
      if (pinToTry) {
        pinError.textContent = 'Network error connecting to lobby.';
        pinError.classList.remove('hidden');
      }
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
    searchForHost(val);
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinSubmitBtn.click();
  });

  // Start search
  searchForHost(paramPin);
})();

// live-site/api/announce.js — Vercel serverless function to broadcast host
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  }

  const payload = {
    hostIp: body.hostIp || '127.0.0.1',
    httpPort: body.httpPort || 8001,
    httpsPort: body.httpsPort || 8443,
    deviceName: body.deviceName || 'Host PC',
    timestamp: Date.now()
  };

  try {
    await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'file-transfer-active-host',
        data: payload
      })
    });
    return res.status(200).json({ ok: true, host: payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

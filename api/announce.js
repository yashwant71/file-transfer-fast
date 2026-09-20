// api/announce.js — Vercel Serverless Function to receive host announcement
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

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

  const payload = {
    active: body.active !== false,
    hostIp: body.hostIp || '127.0.0.1',
    allIps: Array.isArray(body.allIps) ? body.allIps : [{ name: 'Wi-Fi', address: body.hostIp || '127.0.0.1' }],
    httpPort: body.httpPort || 8001,
    httpsPort: body.httpsPort || 8443,
    deviceName: body.deviceName || 'Host PC',
    publicIp: body.publicIp || clientIp,
    timestamp: Date.now()
  };

  try {
    await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'file-transfer-active-host',
        data: payload
      }),
      signal: AbortSignal.timeout(3500)
    });
    return res.status(200).json({ ok: true, host: payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

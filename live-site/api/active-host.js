// live-site/api/active-host.js — Vercel serverless function to return active host
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const relayRes = await fetch('https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98');
    if (relayRes.ok) {
      const json = await relayRes.json();
      const data = json.data;
      const now = Date.now();
      const age = now - (data ? data.timestamp || 0 : 0);
      if (data && data.active === true && data.hostIp && age >= 0 && age < 7000) {
        return res.status(200).json({
          found: true,
          active: true,
          hostIp: data.hostIp,
          httpPort: data.httpPort || 8001,
          httpsPort: data.httpsPort || 8443,
          deviceName: data.deviceName || 'Host PC',
          timestamp: data.timestamp
        });
      }
    }
  } catch (err) {}

  return res.status(200).json({ found: false, message: 'No host active' });
};

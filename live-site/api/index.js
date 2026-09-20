// live-site/api/index.js — Vercel Serverless Entrypoint
const handler = require('../server.js');

module.exports = (req, res) => {
  return handler(req, res);
};

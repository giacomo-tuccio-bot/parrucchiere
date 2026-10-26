const { publicConfig } = require('./_lib');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ ok: true, ...publicConfig() });
};

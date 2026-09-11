const { ADMIN_API_KEY } = require('../config/env');

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: 'Admin API is not configured' });
  }
  if (req.get('x-admin-key') !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
}

module.exports = { requireAdmin };

const { ADMIN_API_KEY } = require('../config/env');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY || req.get('x-admin-key') !== ADMIN_API_KEY) {
    const bearer = req.get('authorization');
    try {
      const claims = bearer?.startsWith('Bearer ') && jwt.verify(bearer.slice(7), JWT_SECRET);
      if (claims?.role === 'ADMIN') return next();
    } catch {}
    return res.status(ADMIN_API_KEY ? 401 : 401).json({ error: 'Admin authentication required' });
  }
  next();
}

module.exports = { requireAdmin };

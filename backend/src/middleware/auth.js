const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config/env');

async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const claims = jwt.verify(header.slice(7), JWT_SECRET);
    const user = await db.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired authentication token' }); }
}

function requireUser(req, res, next) {
  return requireAuth(req, res, () => req.user.role === 'USER' ? next() : res.status(403).json({ error: 'User access required' }));
}

function requireAdminUser(req, res, next) {
  return requireAuth(req, res, () => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Admin access required' }));
}

module.exports = { requireAuth, requireUser, requireAdminUser };

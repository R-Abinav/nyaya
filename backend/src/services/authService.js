const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD } = require('../config/env');

function token(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

async function register(email, password) {
  if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 8) {
    throw new Error('A valid email and password of at least 8 characters are required');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: { email: email.trim().toLowerCase(), passwordHash, wallet: { create: {} } },
    select: { id: true, email: true, role: true },
  });
  return { user, token: token(user) };
}

async function login(email, password) {
  const user = await db.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new Error('Invalid email or password');
  return { user: { id: user.id, email: user.email, role: user.role }, token: token(user) };
}

async function adminLogin(email, password) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) throw new Error('Invalid admin credentials');
  let user = await db.user.findUnique({ where: { email: ADMIN_EMAIL.toLowerCase() } });
  if (!user) user = await db.user.create({ data: { email: ADMIN_EMAIL.toLowerCase(), passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'ADMIN', wallet: { create: {} } } });
  return { user: { id: user.id, email: user.email, role: user.role }, token: token(user) };
}

module.exports = { register, login, adminLogin };

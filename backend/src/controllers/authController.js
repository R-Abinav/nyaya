const { register, login, adminLogin } = require('../services/authService');
const db = require('../db');

async function signup(req, res) {
  try { res.status(201).json(await register(req.body.email, req.body.password)); }
  catch (error) { res.status(error.code === 'P2002' ? 409 : 400).json({ error: error.code === 'P2002' ? 'Email is already registered' : error.message }); }
}
async function signin(req, res) {
  try { res.json(await login(req.body.email, req.body.password)); } catch (error) { res.status(401).json({ error: error.message }); }
}
async function adminSignin(req, res) {
  try { res.json(await adminLogin(req.body.email, req.body.password)); } catch (error) { res.status(401).json({ error: error.message }); }
}
function logout(req, res) {
  // Access tokens are stateless; the frontend removes its token on logout.
  res.status(204).end();
}
async function me(req, res) { res.json({ user: req.user, wallet: await db.wallet.findUnique({ where: { userId: req.user.id }, select: { balance: true } }) }); }
module.exports = { signup, signin, adminSignin, logout, me };

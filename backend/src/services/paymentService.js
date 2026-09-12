const crypto = require('crypto');
const db = require('../db');
const { getAllJurorIds } = require('../config/jurors');
const logger = require('./logger');
const INITIAL_MODEL_BALANCE_CENTS = 50000;

async function ensureModelAccount(modelId) {
  return db.aiAccount.upsert({
    where: { id: modelId },
    create: { id: modelId, name: modelId, balance: INITIAL_MODEL_BALANCE_CENTS },
    update: {},
  });
}
async function ensureAdminAccount() {
  return db.aiAccount.upsert({ where: { id: 'admin' }, create: { id: 'admin', name: 'admin', balance: 0 }, update: {} });
}
async function getAccount(accountId) {
  const account = await db.aiAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');
  return { accountId: account.id, role: account.id === 'admin' ? 'admin' : 'ai-model', balanceCents: account.balance, createdAt: account.createdAt };
}
async function listAccounts() {
  const accounts = await db.aiAccount.findMany({ orderBy: { createdAt: 'asc' } });
  return accounts.map(account => ({ accountId: account.id, role: account.id === 'admin' ? 'admin' : 'ai-model', balanceCents: account.balance, createdAt: account.createdAt }));
}
async function makePayment({ from, to, amountCents, reason, metadata = {} }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Payment amount must be a positive integer number of cents');
  const transaction = await db.$transaction(async tx => {
    await tx.aiAccount.upsert({ where: { id: from }, create: { id: from, name: from, balance: 0 }, update: {} });
    await tx.aiAccount.upsert({ where: { id: to }, create: { id: to, name: to, balance: 0 }, update: {} });
    const debit = await tx.aiAccount.updateMany({ where: { id: from, balance: { gte: amountCents } }, data: { balance: { decrement: amountCents } } });
    if (!debit.count) throw new Error('Insufficient account balance');
    await tx.aiAccount.update({ where: { id: to }, data: { balance: { increment: amountCents } } });
    const id = `tx_${crypto.randomUUID()}`;
    await tx.aiTransaction.create({ data: { id, accountId: from, type: reason || 'payment', amount: -amountCents, reference: to, metadata } });
    await tx.aiTransaction.create({ data: { accountId: to, type: reason || 'payment', amount: amountCents, reference: from, metadata } });
    return { id, type: 'payment', from, to, amountCents, reason, metadata, createdAt: new Date().toISOString() };
  });
  logger.payment('PAYMENT_SETTLED', transaction);
  return transaction;
}
async function transferFunds(args) { return makePayment({ ...args, reason: 'admin_account_transfer' }); }
async function sendPrize({ to, amountCents, metadata }) {
  if (amountCents < 0) throw new Error('Prize amount must be nonnegative');
  if (!amountCents) return { type: 'prize', to, amountCents: 0, metadata };
  return makePayment({ from: 'admin', to, amountCents, reason: 'prediction_prize', metadata });
}
async function listTransactions() {
  const rows = await db.aiTransaction.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(row => ({ id: row.id, accountId: row.accountId, type: row.type, amountCents: row.amount, reference: row.reference, metadata: row.metadata, createdAt: row.createdAt }));
}
module.exports = { INITIAL_MODEL_BALANCE_CENTS, ensureAdminAccount, ensureModelAccount, getAccount, listAccounts, listTransactions, makePayment, sendPrize, transferFunds };

const crypto = require('crypto');

const accounts = new Map();
const transactions = [];
const INITIAL_MODEL_BALANCE_CENTS = 50000;
const { getAllJurorIds } = require('../config/jurors');

function createTransaction({ type, from, to, amountCents, reason, metadata = {} }) {
  return {
    id: `tx_${crypto.randomUUID()}`,
    type,
    from,
    to,
    amountCents,
    reason,
    metadata,
    createdAt: new Date().toISOString(),
  };
}

function ensureAccount(accountId, { initialBalanceCents = 0, role = 'ai-model' } = {}) {
  if (!accountId || typeof accountId !== 'string') throw new Error('accountId is required');
  if (!accounts.has(accountId)) {
    accounts.set(accountId, {
      accountId,
      role,
      balanceCents: initialBalanceCents,
      createdAt: new Date().toISOString(),
    });
  }
  return accounts.get(accountId);
}

function ensureModelAccount(modelId) {
  return ensureAccount(modelId, {
    initialBalanceCents: INITIAL_MODEL_BALANCE_CENTS,
    role: 'ai-model',
  });
}

getAllJurorIds().forEach(modelId => ensureModelAccount(modelId));

function ensureAdminAccount() {
  return ensureAccount('admin', { role: 'admin' });
}

function getAccount(accountId) {
  const account = accounts.get(accountId);
  if (!account) throw new Error('Account not found');
  return { ...account };
}

function listAccounts() {
  return Array.from(accounts.values()).map(account => ({ ...account }));
}

function makePayment({ from, to, amountCents, reason, metadata }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Payment amount must be a positive integer number of cents');
  }
  const source = accounts.get(from);
  if (!source) throw new Error('Source account not found');
  if (source.balanceCents < amountCents) throw new Error('Insufficient account balance');
  ensureAccount(to, { role: to === 'admin' ? 'admin' : 'ai-model' });
  source.balanceCents -= amountCents;
  accounts.get(to).balanceCents += amountCents;
  const transaction = createTransaction({ type: 'payment', from, to, amountCents, reason, metadata });
  transactions.push(transaction);
  return { ...transaction };
}

function transferFunds({ from, to, amountCents, metadata }) {
  return makePayment({ from, to, amountCents, reason: 'admin_account_transfer', metadata });
}

function sendPrize({ to, amountCents, metadata }) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('Prize amount must be a nonnegative integer number of cents');
  }
  if (amountCents === 0) {
    const transaction = createTransaction({
      type: 'prize',
      from: 'prediction-pool',
      to,
      amountCents,
      reason: 'prediction_prize',
      metadata,
    });
    transactions.push(transaction);
    return transaction;
  }
  return makePayment({
    from: 'prediction-pool',
    to,
    amountCents,
    reason: 'prediction_prize',
    metadata,
  });
}

function listTransactions() {
  return transactions.map(transaction => ({ ...transaction }));
}

module.exports = {
  INITIAL_MODEL_BALANCE_CENTS,
  sendPrize,
  ensureAdminAccount,
  ensureModelAccount,
  getAccount,
  listAccounts,
  listTransactions,
  makePayment,
  transferFunds,
};

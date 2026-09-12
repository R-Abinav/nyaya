const crypto = require('crypto');
const db = require('../db');
const { getAllJurorIds, normalizeJurorId } = require('../config/jurors');

const MIN_OPTIONS = 3;
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
function optionsOf(options) {
  if (!Array.isArray(options) || options.length < MIN_OPTIONS) throw new Error(`A prediction must have at least ${MIN_OPTIONS} options`);
  const result = options.map(option => ({ id: typeof option === 'string' ? id('option') : option.id || id('option'), label: typeof option === 'string' ? option.trim() : String(option.label || '').trim() }));
  if (result.some(o => !o.label) || new Set(result.map(o => o.id)).size !== result.length || new Set(result.map(o => o.label.toLowerCase())).size !== result.length) throw new Error('Prediction options must be nonempty and unique');
  return result;
}
function expiry(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf()) || date <= new Date()) throw new Error('expiresAt must be a valid future ISO-8601 date');
  return date;
}
function serialize(p) {
  const bets = p.bets || [];
  const performanceBets = p.performanceBets || [];
  const performanceByModel = Object.fromEntries(getAllJurorIds().map(modelId => {
    const modelBets = performanceBets.filter(bet => normalizeJurorId(bet.modelId) === modelId);
    return [modelId, {
      stakeCents: modelBets.reduce((total, bet) => total + bet.amount, 0),
      betCount: modelBets.length,
    }];
  }));
  const modelStakes = Object.fromEntries(Object.entries(performanceByModel).map(([modelId, totals]) => [modelId, totals.stakeCents]));
  return { id: p.id, statement: p.statement, options: p.options.map(o => ({ ...o, betCount: bets.filter(b => b.optionId === o.id).length })), expiresAt: p.expiresAt, createdAt: p.createdAt, updatedAt: p.updatedAt, status: p.status.toLowerCase(), winningOptionId: p.winningOptionId, totalBets: bets.length, totalPoolCents: bets.reduce((n, b) => n + b.amount, 0), performancePoolCents: performanceBets.reduce((n, b) => n + b.amount, 0), performanceByModel, modelStakes, settlement: p.settlement || null, expired: p.expiresAt <= new Date() };
}
async function load(predictionId) {
  const p = await db.prediction.findUnique({ where: { id: predictionId }, include: { options: true, bets: true, performanceBets: true, settlement: true } });
  if (!p) throw new Error('Prediction not found');
  return p;
}
async function createPrediction({ statement, options, expiresAt }) {
  if (!statement || !String(statement).trim()) throw new Error('statement is required');
  const data = { id: id('prediction'), statement: String(statement).trim(), expiresAt: expiry(expiresAt), options: { create: optionsOf(options) } };
  return serialize(await db.prediction.create({ data, include: { options: true, bets: true, settlement: true } }));
}
async function getPrediction(predictionId) { return serialize(await load(predictionId)); }
async function listPredictions({ includeExpired = true } = {}) {
  const rows = await db.prediction.findMany({ where: includeExpired ? {} : { expiresAt: { gt: new Date() } }, include: { options: true, bets: true, performanceBets: true, settlement: true }, orderBy: { createdAt: 'desc' } });
  return rows.map(serialize);
}
async function updatePrediction(predictionId, updates) {
  const p = await load(predictionId);
  const data = {};
  if (updates.statement !== undefined) data.statement = String(updates.statement).trim();
  if (updates.expiresAt !== undefined) data.expiresAt = expiry(updates.expiresAt);
  if (updates.options !== undefined) data.options = { deleteMany: {}, create: optionsOf(updates.options) };
  return serialize(await db.prediction.update({ where: { id: predictionId }, data, include: { options: true, bets: true, settlement: true } }));
}
async function deletePrediction(predictionId) {
  const p = await load(predictionId);
  if (p.bets.length) throw new Error('Cannot delete a prediction that has bets');
  await db.prediction.delete({ where: { id: predictionId } });
}
async function placeBet({ predictionId, optionId, bettorId, amountCents, payment, userId, modelId }) {
  const p = await load(predictionId);
  if (p.status !== 'ACTIVE' || p.expiresAt <= new Date()) throw new Error('Prediction has expired');
  if (!p.options.some(o => o.id === optionId)) throw new Error('Option not found for this prediction');
  if (!payment?.approved) throw new Error('Bet payment was not approved');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive integer');
  const aiAccountId = modelId || (bettorId && bettorId.startsWith('juror_') ? bettorId : null);
  const bet = await db.$transaction(async tx => {
    if (aiAccountId) {
      await tx.aiAccount.upsert({ where: { id: aiAccountId }, create: { id: aiAccountId, name: aiAccountId, balance: 50000 }, update: {} });
      const debit = await tx.aiAccount.updateMany({ where: { id: aiAccountId, balance: { gte: amountCents } }, data: { balance: { decrement: amountCents } } });
      if (!debit.count) throw new Error('Insufficient AI account balance');
      await tx.aiTransaction.create({ data: { accountId: aiAccountId, type: 'prediction_bet', amount: -amountCents, reference: predictionId, metadata: { optionId } } });
    }
    return tx.bet.create({ data: { id: id('bet'), predictionId, optionId, amount: amountCents, userId: userId || null, aiAccountId } });
  });
  return { ...bet, amountCents: bet.amount, prediction: serialize(await load(predictionId)), option: p.options.find(o => o.id === optionId) };
}
async function listBets({ predictionId } = {}) {
  const rows = await db.bet.findMany({ where: predictionId ? { predictionId } : {}, include: { prediction: { include: { options: true, bets: true, settlement: true } } }, orderBy: { createdAt: 'asc' } });
  return rows.map(b => ({ ...b, amountCents: b.amount, prediction: serialize(b.prediction) }));
}
async function endPrediction(predictionId, winningOptionId) {
  const p = await load(predictionId);
  if (!p.options.some(o => o.id === winningOptionId)) throw new Error('A valid winning option is required');
  const aiIds = getAllJurorIds();
  return db.$transaction(async tx => {
    const locked = await tx.prediction.updateMany({ where: { id: predictionId, status: 'ACTIVE' }, data: { status: 'ENDED', winningOptionId } });
    if (!locked.count) throw new Error('Prediction has already been settled');
    const bets = await tx.bet.findMany({ where: { predictionId } });
    const aiBets = bets.filter(b => b.aiAccountId && aiIds.includes(b.aiAccountId));
    const performanceBets = await tx.performanceBet.findMany({ where: { predictionId } });
    const pnl = new Map(aiIds.map(ai => [ai, aiBets.filter(b => b.aiAccountId === ai).reduce((n, b) => n + (b.optionId === winningOptionId ? b.amount : -b.amount), 0)]));
    if (!aiBets.length) throw new Error('Cannot settle without AI bets');
    const highest = Math.max(...pnl.values());
    const winners = aiIds.filter(ai => pnl.get(ai) === highest);
    const pool = performanceBets.reduce((n, b) => n + b.amount, 0);
    const adminFee = Math.floor(pool * 0.1);
    const eligible = performanceBets.filter(b => winners.includes(b.modelId));
    if (!eligible.length) throw new Error('No eligible performance bets for settlement');
    const distributable = eligible.length ? pool - adminFee : 0;
    let distributed = 0;
    for (const [index, bet] of eligible.entries()) {
      const payout = index === eligible.length - 1 ? distributable - distributed : Math.floor(distributable * bet.amount / eligible.reduce((n, x) => n + x.amount, 0));
      distributed += payout;
      await tx.performanceBet.update({ where: { id: bet.id }, data: { won: true, payout } });
      await tx.wallet.update({ where: { userId: bet.userId }, data: { balance: { increment: payout } } });
      const wallet = await tx.wallet.findUnique({ where: { userId: bet.userId } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'PRIZE', amount: payout, reference: bet.id, metadata: { predictionId } } });
    }
    for (const bet of performanceBets.filter(b => !eligible.some(e => e.id === b.id))) {
      await tx.performanceBet.update({ where: { id: bet.id }, data: { won: false, payout: 0 } });
    }
    await tx.aiAccount.upsert({ where: { id: 'admin' }, create: { id: 'admin', name: 'admin', balance: adminFee }, update: { balance: { increment: adminFee } } });
    if (adminFee) await tx.aiTransaction.create({ data: { accountId: 'admin', type: 'performance_fee', amount: adminFee, reference: predictionId } });
    await tx.settlement.create({ data: { predictionId, winningOptionId, totalPool: pool } });
    return serialize(await tx.prediction.findUnique({ where: { id: predictionId }, include: { options: true, bets: true, settlement: true } }));
  }, {
    maxWait: 10000,
    timeout: 30000,
  });
}
module.exports = { createPrediction, deletePrediction, endPrediction, getPrediction, listBets, listPredictions, placeBet, updatePrediction };

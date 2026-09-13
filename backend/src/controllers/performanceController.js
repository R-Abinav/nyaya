const db = require('../db');
const { getAllJurorIds, getJuror, normalizeJurorId } = require('../config/jurors');
const { getPrediction } = require('../services/predictionMarketService');

async function performance(req, res) {
  const bets = await db.performanceBet.findMany({ where: { userId: req.user.id }, select: { amount: true, payout: true, won: true } });
  const staked = bets.reduce((n, b) => n + b.amount, 0);
  const payout = bets.reduce((n, b) => n + (b.payout || 0), 0);
  res.json({ performance: { bets: bets.length, wins: bets.filter(b => b.won === true).length, losses: bets.filter(b => b.won === false).length, staked, payout, profit: payout - staked, roi: staked ? (payout - staked) / staked : 0 } });
}

async function models(req, res) {
  const bets = await db.performanceBet.findMany({ select: { modelId: true, amount: true, payout: true, won: true } });
  res.json({
    models: getAllJurorIds().map(id => {
      const modelBets = bets.filter(b => b.modelId === id);
      const staked = modelBets.reduce((n, b) => n + b.amount, 0);
      const payout = modelBets.reduce((n, b) => n + (b.payout || 0), 0);
      return { id, name: getJuror(id).name, bets: modelBets.length, wins: modelBets.filter(b => b.won === true).length, staked, payout, profit: payout - staked, roi: staked ? (payout - staked) / staked : 0 };
    }),
  });
}

async function bets(req, res) {
  if (req.method === 'GET') {
    return res.json({ bets: await db.performanceBet.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, include: { prediction: { select: { id: true, statement: true } } } }) });
  }
  const amount = Number(req.body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amountCents must be a positive integer' });
  const modelId = normalizeJurorId(req.body.modelId);
  if (!modelId || !getAllJurorIds().includes(modelId)) {
    return res.status(400).json({ error: 'modelId must identify a configured AI juror' });
  }
  try {
    const prediction = await getPrediction(req.body.predictionId);
    if (prediction.status !== 'active' || prediction.expired) {
      throw new Error('Performance betting is closed for this prediction');
    }
    const bet = await db.$transaction(async tx => {
      const existingRun = await tx.aiRun.findFirst({
        where: { predictionId: prediction.id, userId: req.user.id, status: 'RUNNING' },
        select: { id: true, status: true },
      });
      if (existingRun) throw new Error('Performance betting is temporarily closed while the AI run is in progress');
      const wallet = await tx.wallet.updateMany({ where: { userId: req.user.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (!wallet.count) throw new Error('Insufficient wallet balance');
      const created = await tx.performanceBet.create({ data: { id: `performance_bet_${require('crypto').randomUUID()}`, predictionId: prediction.id, userId: req.user.id, modelId, amount } });
      await tx.walletTransaction.create({ data: { walletId: (await tx.wallet.findUnique({ where: { userId: req.user.id } })).id, type: 'BET', amount: -amount, reference: created.id, metadata: { predictionId: prediction.id, modelId } } });
      return created;
    });
    res.status(201).json({ bet });
  } catch (error) { res.status(400).json({ error: error.message }); }
}

async function startRun(req, res) {
  try {
    await getPrediction(req.body.predictionId);
    const { startRun } = require('../services/aiBetRunner');
    const run = await startRun(req.body.predictionId, req.user.id, req.body.forceBet === true);
    res.status(202).json({ runId: run.id, predictionId: run.predictionId, forceBet: run.forceBet, status: 'RUNNING' });
  } catch (error) { res.status(400).json({ error: error.message }); }
}

module.exports = { performance, models, bets, startRun };

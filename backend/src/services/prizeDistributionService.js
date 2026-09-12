const { ensureAdminAccount, sendPrize } = require('./paymentService');
const { ADMIN_SHARE_PERCENT } = require('../config/env');

const adminSharePercent = Number(ADMIN_SHARE_PERCENT);
if (!Number.isFinite(adminSharePercent) || adminSharePercent < 0 || adminSharePercent > 100) {
  throw new Error('ADMIN_SHARE_PERCENT must be a number between 0 and 100');
}
const ADMIN_FEE_BPS = Math.round(adminSharePercent * 100);

function distributePrizes({ prediction, bets, winningOptionId }) {
  if (prediction.settlement) throw new Error('Prediction has already been settled');
  if (!winningOptionId || !prediction.options.some(option => option.id === winningOptionId)) {
    throw new Error('A valid winning option is required');
  }

  const totalPoolCents = bets.reduce((sum, bet) => sum + bet.amountCents, 0);
  const adminFeeCents = Math.floor((totalPoolCents * ADMIN_FEE_BPS) / 10000);
  const winnerPoolCents = totalPoolCents - adminFeeCents;
  const winningBets = bets.filter(bet => bet.optionId === winningOptionId);
  const winningContributionCents = winningBets.reduce((sum, bet) => sum + bet.amountCents, 0);
  const payouts = [];
  ensureAdminAccount();
  const winningOptionHasNoBets = winningBets.length === 0;
  // If nobody backed the admin-selected winner, the pool has no eligible
  // winner and is transferred to the admin instead of blocking settlement.
  const adminSettlementCents = winningOptionHasNoBets ? totalPoolCents : adminFeeCents;
  const settledWinnerPoolCents = winningOptionHasNoBets ? 0 : winnerPoolCents;

  if (winningBets.length && winningContributionCents > 0) {
    let distributedCents = 0;
    winningBets.forEach((bet, index) => {
      const payout = index === winningBets.length - 1
        ? settledWinnerPoolCents - distributedCents
        : Math.floor((settledWinnerPoolCents * bet.amountCents) / winningContributionCents);
      distributedCents += payout;
      payouts.push({
        betId: bet.id,
        accountId: bet.bettorId,
        amountCents: payout,
        transaction: sendPrize({
          to: bet.bettorId,
          amountCents: payout,
          metadata: { predictionId: prediction.id, winningOptionId, betId: bet.id },
        }),
      });
    });
  }

  const adminTransaction = sendPrize({
    to: 'admin',
    amountCents: adminSettlementCents,
    metadata: { predictionId: prediction.id, winningOptionId, winningOptionHasNoBets },
  });
  ensureAdminAccount();

  return {
    totalPoolCents,
    adminFeeCents: adminSettlementCents,
    configuredAdminFeeCents: adminFeeCents,
    winnerPoolCents: settledWinnerPoolCents,
    winningOptionHasNoBets,
    winningOptionId,
    payouts,
    adminTransaction,
    distributedCents: adminFeeCents + payouts.reduce((sum, payout) => sum + payout.amountCents, 0),
  };
}

module.exports = {
  ADMIN_FEE_BPS,
  distributePrizes,
};

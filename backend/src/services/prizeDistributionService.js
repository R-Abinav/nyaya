const { ensureAdminAccount, sendPrize } = require('./paymentService');

const ADMIN_FEE_BPS = 1000;

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
  if (totalPoolCents > 0 && winningBets.length === 0) {
    throw new Error('Cannot settle a prediction without a bet on the winning outcome');
  }

  if (winningBets.length && winningContributionCents > 0) {
    let distributedCents = 0;
    winningBets.forEach((bet, index) => {
      const payout = index === winningBets.length - 1
        ? winnerPoolCents - distributedCents
        : Math.floor((winnerPoolCents * bet.amountCents) / winningContributionCents);
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
    amountCents: adminFeeCents,
    metadata: { predictionId: prediction.id, winningOptionId },
  });
  ensureAdminAccount();

  return {
    totalPoolCents,
    adminFeeCents,
    winnerPoolCents,
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

const assert = require('assert');
const {
  createPrediction,
  endPrediction,
  getPrediction,
  placeBet,
} = require('./src/services/predictionMarketService');
const { placeAgentBet, readPrediction } = require('./src/services/aiBettingTools');
const {
  getAccount,
  listTransactions,
  transferFunds,
} = require('./src/services/paymentService');

async function run() {
  const prediction = createPrediction({
    statement: 'Which outcome wins?',
    options: ['Alpha', 'Beta', 'Gamma'],
    expiresAt: '2099-01-01T00:00:00Z',
  });
  const [alpha, beta, gamma] = prediction.options;

  assert.strictEqual(getAccount('skeptic').balanceCents, 50000);
  assert.strictEqual(readPrediction(prediction.id).numberOfBets, 0);

  await placeAgentBet({ predictionId: prediction.id, optionId: alpha.id, modelId: 'skeptic', amountCents: 2000 });
  await placeAgentBet({ predictionId: prediction.id, optionId: beta.id, modelId: 'pragmatist', amountCents: 1000 });
  await placeAgentBet({ predictionId: prediction.id, optionId: alpha.id, modelId: 'maverick', amountCents: 3000 });
  assert.strictEqual(getAccount('skeptic').balanceCents, 48000);

  await assert.rejects(
    () => placeAgentBet({ predictionId: prediction.id, optionId: gamma.id, modelId: 'skeptic', amountCents: 50000 }),
    /Insufficient account balance/
  );

  const ended = endPrediction(prediction.id, alpha.id);
  assert.strictEqual(ended.status, 'ended');
  assert.strictEqual(ended.settlement.totalPoolCents, 6000);
  assert.strictEqual(ended.settlement.adminFeeCents, 600);
  assert.strictEqual(ended.settlement.winnerPoolCents, 5400);
  assert.deepStrictEqual(
    ended.settlement.payouts.map(payout => payout.amountCents),
    [2160, 3240]
  );
  assert.strictEqual(ended.settlement.distributedCents, 6000);
  assert.strictEqual(getAccount('admin').balanceCents, 600);
  assert.strictEqual(getAccount('skeptic').balanceCents, 50160);
  assert.strictEqual(getAccount('maverick').balanceCents, 50240);

  await assert.rejects(
    () => placeAgentBet({ predictionId: prediction.id, optionId: alpha.id, modelId: 'skeptic', amountCents: 1 }),
    /expired/
  );
  assert.throws(() => endPrediction(prediction.id, alpha.id), /already been settled/);

  const transfer = transferFunds({ from: 'admin', to: 'skeptic', amountCents: 100 });
  assert.strictEqual(transfer.reason, 'admin_account_transfer');
  assert.strictEqual(getAccount('admin').balanceCents, 500);
  assert.strictEqual(getAccount('skeptic').balanceCents, 50260);
  assert.ok(listTransactions().some(transaction => transaction.id === transfer.id));

  const losingPrediction = createPrediction({
    statement: 'A losing test',
    options: ['A', 'B', 'C'],
    expiresAt: '2099-01-01T00:00:00Z',
  });
  await placeAgentBet({
    predictionId: losingPrediction.id,
    optionId: losingPrediction.options[0].id,
    modelId: 'skeptic',
    amountCents: 100,
  });
  await placeAgentBet({
    predictionId: losingPrediction.id,
    optionId: losingPrediction.options[1].id,
    modelId: 'maverick',
    amountCents: 300,
  });
  const losingSettlement = endPrediction(losingPrediction.id, losingPrediction.options[1].id);
  assert.strictEqual(losingSettlement.settlement.payouts.length, 1);
  assert.strictEqual(losingSettlement.settlement.payouts[0].accountId, 'maverick');
  console.log('Prediction market tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

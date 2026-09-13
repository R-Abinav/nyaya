const {
  createPrediction,
  deletePrediction,
  endPrediction,
  getPrediction,
  listBets,
  listPredictions,
  updatePrediction,
} = require('../services/predictionMarketService');
const { placeAgentBet, readPrediction } = require('../services/aiBettingTools');
const {
  ensureAdminAccount,
  getAccount,
  listAccounts,
  listTransactions,
  transferFunds,
} = require('../services/paymentService');

function sendError(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  res.status(status).json({ error: error.message });
}

async function list(req, res) {
  res.json({ predictions: await listPredictions({ includeExpired: req.query.includeExpired !== 'false' }) });
}

async function get(req, res) {
  try {
    res.json({ prediction: await getPrediction(req.params.predictionId) });
  } catch (error) {
    sendError(res, error);
  }
}

async function create(req, res) {
  try {
    res.status(201).json({ prediction: await createPrediction(req.body) });
  } catch (error) {
    sendError(res, error);
  }
}

async function update(req, res) {
  try {
    res.json({ prediction: await updatePrediction(req.params.predictionId, req.body) });
  } catch (error) {
    sendError(res, error);
  }
}

async function remove(req, res) {
  try {
    await deletePrediction(req.params.predictionId);
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
}

function aiListing(req, res) {
  try {
    res.json({ prediction: readPrediction(req.params.predictionId) });
  } catch (error) {
    sendError(res, error);
  }
}

async function aiBet(req, res) {
  try {
    const bet = await placeAgentBet({
      predictionId: req.params.predictionId,
      ...req.body,
    });
    res.status(201).json({ bet });
  } catch (error) {
    sendError(res, error);
  }
}

async function end(req, res) {
  try {
    res.json({ prediction: await endPrediction(req.params.predictionId, req.body.winningOptionId) });
  } catch (error) {
    sendError(res, error);
  }
}

async function accounts(req, res) {
  await ensureAdminAccount();
  res.json({ accounts: await listAccounts() });
}

async function account(req, res) {
  try {
    res.json({ account: await getAccount(req.params.accountId) });
  } catch (error) {
    sendError(res, error);
  }
}

async function transfer(req, res) {
  try {
    res.status(201).json({
      transaction: await transferFunds({
        from: 'admin',
        to: req.body.to,
        amountCents: req.body.amountCents,
        metadata: { requestedBy: 'admin' },
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
}

async function transactions(req, res) {
  res.json({ transactions: await listTransactions() });
}

async function history(req, res) {
  res.json({ bets: await listBets({ predictionId: req.params.predictionId }) });
}

async function allHistory(req, res) {
  res.json({ bets: await listBets() });
}

module.exports = {
  allHistory,
  account,
  accounts,
  aiBet,
  aiListing,
  create,
  get,
  history,
  list,
  remove,
  update,
  transfer,
  transactions,
  end,
};

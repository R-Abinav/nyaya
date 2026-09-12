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

function list(req, res) {
  res.json({ predictions: listPredictions({ includeExpired: req.query.includeExpired !== 'false' }) });
}

function get(req, res) {
  try {
    res.json({ prediction: getPrediction(req.params.predictionId) });
  } catch (error) {
    sendError(res, error);
  }
}

function create(req, res) {
  try {
    res.status(201).json({ prediction: createPrediction(req.body) });
  } catch (error) {
    sendError(res, error);
  }
}

function update(req, res) {
  try {
    res.json({ prediction: updatePrediction(req.params.predictionId, req.body) });
  } catch (error) {
    sendError(res, error);
  }
}

function remove(req, res) {
  try {
    deletePrediction(req.params.predictionId);
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

function end(req, res) {
  try {
    res.json({ prediction: endPrediction(req.params.predictionId, req.body.winningOptionId) });
  } catch (error) {
    sendError(res, error);
  }
}

function accounts(req, res) {
  ensureAdminAccount();
  res.json({ accounts: listAccounts() });
}

function account(req, res) {
  try {
    res.json({ account: getAccount(req.params.accountId) });
  } catch (error) {
    sendError(res, error);
  }
}

function transfer(req, res) {
  try {
    res.status(201).json({
      transaction: transferFunds({
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

function transactions(req, res) {
  res.json({ transactions: listTransactions() });
}

function history(req, res) {
  res.json({ bets: listBets({ predictionId: req.params.predictionId }) });
}

function allHistory(req, res) {
  res.json({ bets: listBets() });
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

const {
  createPrediction,
  deletePrediction,
  getPrediction,
  listBets,
  listPredictions,
  placeBet,
  updatePrediction,
} = require('../services/predictionMarketService');
const { approveEvidencePayment } = require('../services/x402Gateway');

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

async function bet(req, res) {
  try {
    const { predictionId } = req.params;
    const { optionId, bettorId } = req.body;
    const payment = await approveEvidencePayment({
      caseId: predictionId,
      jurorId: bettorId,
      toolName: 'prediction_bet',
    });
    if (!payment.approved) throw new Error('Bet payment was not approved');

    res.status(201).json({
      bet: placeBet({ predictionId, optionId, bettorId, payment }),
    });
  } catch (error) {
    sendError(res, error);
  }
}

function history(req, res) {
  res.json({ bets: listBets({ predictionId: req.params.predictionId }) });
}

function allHistory(req, res) {
  res.json({ bets: listBets() });
}

module.exports = {
  allHistory,
  bet,
  create,
  get,
  history,
  list,
  remove,
  update,
};

const crypto = require('crypto');
const { distributePrizes } = require('./prizeDistributionService');
const { makePayment } = require('./paymentService');

const MIN_OPTIONS = 3;
const predictions = new Map();
const bets = [];

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length < MIN_OPTIONS) {
    throw new Error(`A prediction must have at least ${MIN_OPTIONS} options`);
  }

  const normalized = options.map(option => {
    if (typeof option === 'string') return { id: createId('option'), label: option.trim() };
    if (!option || typeof option.label !== 'string') {
      throw new Error('Each option must be a nonempty string or an object with a label');
    }
    return {
      id: typeof option.id === 'string' && option.id.trim() ? option.id.trim() : createId('option'),
      label: option.label.trim(),
    };
  });

  if (normalized.some(option => !option.label)) {
    throw new Error('Prediction options cannot be blank');
  }

  const labels = normalized.map(option => option.label.toLowerCase());
  if (new Set(labels).size !== labels.length || new Set(normalized.map(option => option.id)).size !== normalized.length) {
    throw new Error('Prediction option labels and IDs must be unique');
  }

  return normalized;
}

function parseExpiry(expiresAt) {
  const timestamp = Date.parse(expiresAt);
  if (!expiresAt || !Number.isFinite(timestamp)) {
    throw new Error('expiresAt must be a valid ISO-8601 date');
  }
  if (timestamp <= Date.now()) {
    throw new Error('expiresAt must be in the future');
  }
  return new Date(timestamp).toISOString();
}

function serializePrediction(prediction) {
  const predictionBets = bets.filter(bet => bet.predictionId === prediction.id);
  return {
    ...prediction,
    options: prediction.options.map(option => ({
      ...option,
      betCount: predictionBets.filter(bet => bet.optionId === option.id).length,
    })),
    totalBets: predictionBets.length,
    totalPoolCents: predictionBets.reduce((sum, bet) => sum + bet.amountCents, 0),
    status: prediction.status,
    winningOptionId: prediction.winningOptionId || null,
    settlement: prediction.settlement || null,
    expired: Date.parse(prediction.expiresAt) <= Date.now(),
  };
}

function listPredictions({ includeExpired = true } = {}) {
  return Array.from(predictions.values())
    .filter(prediction => includeExpired || Date.parse(prediction.expiresAt) > Date.now())
    .map(serializePrediction);
}

function getPrediction(predictionId) {
  const prediction = predictions.get(predictionId);
  if (!prediction) throw new Error('Prediction not found');
  return serializePrediction(prediction);
}

function createPrediction({ statement, options, expiresAt }) {
  if (typeof statement !== 'string' || !statement.trim()) {
    throw new Error('statement is required');
  }

  const prediction = {
    id: createId('prediction'),
    statement: statement.trim(),
    options: normalizeOptions(options),
    expiresAt: parseExpiry(expiresAt),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  };
  predictions.set(prediction.id, prediction);
  return serializePrediction(prediction);
}

function updatePrediction(predictionId, updates) {
  const prediction = predictions.get(predictionId);
  if (!prediction) throw new Error('Prediction not found');

  if (updates.statement !== undefined) {
    if (typeof updates.statement !== 'string' || !updates.statement.trim()) {
      throw new Error('statement cannot be blank');
    }
    prediction.statement = updates.statement.trim();
  }
  if (updates.expiresAt !== undefined) {
    prediction.expiresAt = parseExpiry(updates.expiresAt);
  }
  if (updates.options !== undefined) {
    const nextOptions = normalizeOptions(updates.options);
    const selectedOptionIds = new Set(
      bets.filter(bet => bet.predictionId === predictionId).map(bet => bet.optionId)
    );
    const nextOptionIds = new Set(nextOptions.map(option => option.id));
    for (const optionId of selectedOptionIds) {
      if (!nextOptionIds.has(optionId)) {
        throw new Error('Cannot remove an option that already has bets');
      }
    }
    prediction.options = nextOptions;
  }
  prediction.updatedAt = new Date().toISOString();
  return serializePrediction(prediction);
}

function deletePrediction(predictionId) {
  if (!predictions.has(predictionId)) throw new Error('Prediction not found');
  if (bets.some(bet => bet.predictionId === predictionId)) {
    throw new Error('Cannot delete a prediction that has bets');
  }
  predictions.delete(predictionId);
}

function endPrediction(predictionId, winningOptionId) {
  const prediction = predictions.get(predictionId);
  if (!prediction) throw new Error('Prediction not found');
  if (prediction.settlement) throw new Error('Prediction has already been settled');

  const predictionBets = bets.filter(bet => bet.predictionId === predictionId);
  const settlement = distributePrizes({ prediction, bets: predictionBets, winningOptionId });
  prediction.status = 'ended';
  prediction.winningOptionId = winningOptionId;
  prediction.settlement = { ...settlement, settledAt: new Date().toISOString() };
  prediction.updatedAt = new Date().toISOString();
  return serializePrediction(prediction);
}

function placeBet({ predictionId, optionId, bettorId, amountCents, payment }) {
  const prediction = predictions.get(predictionId);
  if (!prediction) throw new Error('Prediction not found');
  if (prediction.status !== 'active' || Date.parse(prediction.expiresAt) <= Date.now()) {
    throw new Error('Prediction has expired');
  }

  const option = prediction.options.find(candidate => candidate.id === optionId);
  if (!option) throw new Error('Option not found for this prediction');
  if (!payment || payment.approved !== true) {
    throw new Error('Bet payment was not approved');
  }
  if (typeof bettorId !== 'string' || !bettorId.trim()) {
    throw new Error('bettorId is required');
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }

  const transaction = makePayment({
    from: bettorId.trim(),
    to: 'prediction-pool',
    amountCents,
    reason: 'prediction_bet',
    metadata: { predictionId, optionId },
  });

  const bet = {
    id: createId('bet'),
    predictionId,
    optionId,
    bettorId: bettorId.trim(),
    amountCents,
    payment,
    transaction,
    placedAt: new Date().toISOString(),
  };
  bets.push(bet);
  return { ...bet, prediction: serializePrediction(prediction), option };
}

function listBets({ predictionId } = {}) {
  return bets
    .filter(bet => !predictionId || bet.predictionId === predictionId)
    .map(bet => ({
      ...bet,
      prediction: predictions.has(bet.predictionId) ? serializePrediction(predictions.get(bet.predictionId)) : null,
    }));
}

module.exports = {
  createPrediction,
  deletePrediction,
  endPrediction,
  getPrediction,
  listBets,
  listPredictions,
  placeBet,
  updatePrediction,
};

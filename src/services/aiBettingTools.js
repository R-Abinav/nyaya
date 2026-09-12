const { getPrediction, placeBet } = require('./predictionMarketService');
const { approveEvidencePayment } = require('./x402Gateway');
const { ensureModelAccount } = require('./paymentService');
const { getJuror } = require('../config/jurors');

function readPrediction(predictionId) {
  const prediction = getPrediction(predictionId);
  return {
    id: prediction.id,
    question: prediction.statement,
    options: prediction.options,
    totalPoolCents: prediction.totalPoolCents,
    numberOfBets: prediction.totalBets,
    expiresAt: prediction.expiresAt,
    status: prediction.status,
    metadata: {
      createdAt: prediction.createdAt,
      updatedAt: prediction.updatedAt,
      expired: prediction.expired,
    },
  };
}

async function placeAgentBet({ predictionId, optionId, modelId, amountCents }) {
  if (!modelId || typeof modelId !== 'string') throw new Error('modelId is required');
  getJuror(modelId);
  ensureModelAccount(modelId);
  const payment = await approveEvidencePayment({
    caseId: predictionId,
    jurorId: modelId,
    toolName: 'prediction_bet',
  });
  if (!payment.approved) throw new Error('Bet payment was not approved');
  return placeBet({ predictionId, optionId, bettorId: modelId, amountCents, payment });
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'read_prediction',
      description: 'Read a prediction listing, outcomes, pool, bet count, expiry, and status.',
      parameters: {
        type: 'object',
        properties: { predictionId: { type: 'string' } },
        required: ['predictionId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_prediction_bet',
      description: 'Place an AI model bet after choosing one outcome. amountCents is integer US cents.',
      parameters: {
        type: 'object',
        properties: {
          predictionId: { type: 'string' },
          optionId: { type: 'string' },
          modelId: { type: 'string' },
          amountCents: { type: 'integer', minimum: 1 },
        },
        required: ['predictionId', 'optionId', 'modelId', 'amountCents'],
        additionalProperties: false,
      },
    },
  },
];

module.exports = { placeAgentBet, readPrediction, tools };

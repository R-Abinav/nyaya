const { getPrediction, placeBet } = require('./predictionMarketService');
const { approveEvidencePayment } = require('./x402Gateway');
const { ensureModelAccount } = require('./paymentService');
const { getJuror } = require('../config/jurors');
const { getEthPrice } = require('./priceService');
const { searchNewsData } = require('./newsService');
const { searchFirecrawl } = require('./firecrawlService');
const logger = require('./logger');

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
    metadata: { createdAt: prediction.createdAt, updatedAt: prediction.updatedAt, expired: prediction.expired },
  };
}

async function placeAgentBet({ predictionId, optionId, modelId, amountCents }) {
  if (!modelId || typeof modelId !== 'string') throw new Error('modelId is required');
  getJuror(modelId);
  ensureModelAccount(modelId);
  const payment = await approveEvidencePayment({ caseId: predictionId, jurorId: modelId, toolName: 'prediction_bet' });
  if (!payment.approved) throw new Error('Bet payment was not approved');
  return placeBet({ predictionId, optionId, bettorId: modelId, amountCents, payment });
}

async function executeAgentTool({ name, args, predictionId, modelId }) {
  if (name === 'read_prediction') return { result: readPrediction(args.predictionId), cost: 0, payment: null };
  if (name === 'search_news' || name === 'get_price') {
    const payment = await approveEvidencePayment({ caseId: predictionId, jurorId: modelId, toolName: name });
    const result = name === 'search_news' ? await searchNewsData(args) : await getEthPrice();
    logger.ai('TOOL_COMPLETED', { modelId, predictionId, tool: name, resultSummary: name === 'search_news' ? `${result.articles?.length || 0} articles` : 'ETH price returned' });
    return { result, cost: Number(payment.amount) || 0, payment };
  }
  if (name === 'firecrawl_web_search') {
    const result = await searchFirecrawl(args);
    if (!result.ok && result.error?.code === 'FIRECRAWL_API_MISSING') return { result, cost: 0, payment: null };
    const payment = await approveEvidencePayment({ caseId: predictionId, jurorId: modelId, toolName: name });
    logger.ai('TOOL_COMPLETED', {
      modelId,
      predictionId,
      tool: name,
      resultSummary: result.ok ? `${result.resultCount} web results` : result.error.code,
    });
    return { result, cost: Number(payment.amount) || 0, payment };
  }
  if (name === 'place_prediction_bet') {
    const bet = await placeAgentBet(args);
    return { result: bet, cost: 0, payment: bet.payment };
  }
  throw new Error(`Unsupported betting tool: ${name}`);
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'read_prediction',
      description: 'Read a prediction listing, outcomes, pool, bet count, expiry, and status.',
      parameters: { type: 'object', properties: { predictionId: { type: 'string' } }, required: ['predictionId'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: 'Search current English news when the prediction needs contextual evidence.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, qInTitle: { type: 'string' }, qInMeta: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_price',
      description: 'Get the current Ethereum price in USD when price evidence is relevant.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'firecrawl_web_search',
      description: 'Search the live web for relevant sources using Firecrawl. Use this when current web evidence would improve the prediction analysis.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A focused web search query.' },
          limit: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['query'],
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

module.exports = { executeAgentTool, placeAgentBet, readPrediction, tools };

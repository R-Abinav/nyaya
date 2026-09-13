const express = require('express');
const routes = require('./routes');
const logger = require('./services/logger');
const { buildEvidenceGatewayRouter } = require('./services/x402HederaGateway');
const { resolveHederaAccountId } = require('./services/x402HederaClient');
const { getResolverContract } = require('./config/contracts');

const app = express();

// Middleware
app.use(express.json());

// Real x402-gated Evidence Gateway route (search_news only — see x402HederaGateway.js for the scope cut).
// Built lazily since payTo needs a mirror-node lookup; app.js itself must stay synchronous to require().
let evidenceGatewayRouterPromise;
app.use((req, res, next) => {
  if (req.path !== '/evidence/search-news') return next();
  if (!evidenceGatewayRouterPromise) {
    evidenceGatewayRouterPromise = getResolverContract()
      .operator()
      .then(operatorAddress => resolveHederaAccountId(operatorAddress))
      .then(payToAccountId => buildEvidenceGatewayRouter({ payToAccountId }));
  }
  evidenceGatewayRouterPromise
    .then(router => router(req, res, next))
    .catch(next);
});

// Routes
app.use('/', routes);
app.use((error, req, res, next) => {
  logger.error('UNHANDLED_REQUEST_ERROR', { method: req.method, path: req.path, message: error.message, stack: error.stack });
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;

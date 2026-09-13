/**
 * Real x402-gated Evidence Gateway route, on Hedera testnet, settled through the Blocky402 facilitator
 * (https://blocky402.com — open source, no API key, hosts a Hedera testnet endpoint).
 *
 * This replaces the dummy payment boundary in x402Gateway.js for exactly ONE evidence call: search_news,
 * since it's the one tool shared across every case type. Every other evidence tool (get_launch_status,
 * get_flight_status, get_weather, get_repo_stars, get_repo_activity) is a deliberate scope cut and stays a
 * direct fetch for now — see jurorAgent.js's executeToolCall for where that split happens.
 *
 * packages/evidence-gateway/ (the package CLAUDE.md's repo map designates for this) does not exist yet.
 * This lives in backend/ instead, mounted on the server that's already running everything else tonight,
 * rather than standing up a second Express process/port under time pressure. That's a real divergence
 * from the documented repo map, not a silent one — flagged here and in TESTNET-EVIDENCE.md.
 *
 * Protocol shape (verified against the installed @x402/* packages' own .d.ts files, not assumed):
 *   - PaymentRequirements.payTo/asset use native Hedera identifiers: a "0.0.x" account id for payTo,
 *     "0.0.0" for native HBAR as the asset (HBAR_ASSET_ID from @x402/hedera). Amount is in tinybars.
 *   - Server-side, @x402/hedera/exact/server's ExactHederaScheme needs no signer at all — it only builds
 *     and validates payment requirements. The facilitator (Blocky402) does the actual verify+settle.
 */
const express = require('express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactHederaScheme } = require('@x402/hedera/exact/server');
const { HBAR_ASSET_ID } = require('@x402/hedera');
const { paymentMiddlewareFromConfig } = require('@x402/express');
const { searchNewsData } = require('./newsService');

const BLOCKY402_TESTNET_URL = 'https://api.testnet.blocky402.com';
const HEDERA_TESTNET_NETWORK = 'hedera:testnet';
/** 0.01 HBAR per call, same nominal price DUMMY_X402_COST_HBAR used — now a real on-chain amount. */
const SEARCH_NEWS_PRICE_TINYBAR = '1000000';

function buildEvidenceGatewayRouter({ payToAccountId }) {
  if (!payToAccountId) throw new Error('buildEvidenceGatewayRouter requires payToAccountId (a real Hedera 0.0.x account id).');

  const facilitatorClient = new HTTPFacilitatorClient({ url: BLOCKY402_TESTNET_URL });
  const routes = {
    'GET /evidence/search-news': {
      accepts: {
        scheme: 'exact',
        network: HEDERA_TESTNET_NETWORK,
        payTo: payToAccountId,
        price: { asset: HBAR_ASSET_ID, amount: SEARCH_NEWS_PRICE_TINYBAR },
      },
      description: 'Real-time news search via NewsData.io, paid per call over x402 on Hedera testnet.',
    },
  };

  const x402Middleware = paymentMiddlewareFromConfig(
    routes,
    facilitatorClient,
    [{ network: HEDERA_TESTNET_NETWORK, server: new ExactHederaScheme() }],
  );

  const router = express.Router();
  router.use(x402Middleware);
  router.get('/evidence/search-news', async (req, res) => {
    try {
      const { q, qInTitle, qInMeta } = req.query;
      const result = await searchNewsData({ q, qInTitle, qInMeta });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });
  return router;
}

module.exports = { buildEvidenceGatewayRouter, BLOCKY402_TESTNET_URL, HEDERA_TESTNET_NETWORK, SEARCH_NEWS_PRICE_TINYBAR };

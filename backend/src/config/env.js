require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  // Base URL the juror agent's real x402 evidence calls hit — the same server process hosts both the
  // agent and the /evidence/search-news gateway route (see x402HederaGateway.js), so this defaults to
  // loopback on PORT rather than a second deployed service.
  EVIDENCE_GATEWAY_BASE_URL: process.env.EVIDENCE_GATEWAY_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  JWT_SECRET: process.env.JWT_SECRET || 'development-only-change-me',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,

  // OpenRouter for LLM (NVIDIA Nemotron)
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',

  // Evidence APIs - all free, live, real data sources

  // Launch Library 2 (thespacedevs.com) - rocket launch data
  // No API key needed for basic use, rate-limited for unauthenticated requests
  LAUNCH_LIBRARY_API_URL: 'https://ll.thespacedevs.com/2.2.0',

  // OpenSky Network - live flight status via ADS-B
  // 4,000 free credits/day
  OPENSKY_API_URL: 'https://opensky-network.org/api',

  // Open-Meteo - weather data
  // Completely free, no API key needed
  OPEN_METEO_API_URL: 'https://api.open-meteo.com/v1',

  // GitHub API - repository data
  // Free public API, rate-limited for unauthenticated requests
  GITHUB_API_URL: 'https://api.github.com',

  // News APIs - contextual evidence (optional)
  // NewsAPI.org: 100 requests/day free tier
  NEWS_API_KEY: process.env.NEWS_API_KEY,
  // NewsData.io: 200 requests/day free tier
  NEWSDATA_API_KEY: process.env.NEWSDATA_API_KEY,
  FIRECRAWL_API: process.env.FIRECRAWL_API,
  ADMIN_SHARE_PERCENT: process.env.ADMIN_SHARE_PERCENT || '10',

  // Temporary x402 payment adapter. Replace with the Hedera gateway later.
  DUMMY_X402_COST_HBAR: process.env.DUMMY_X402_COST_HBAR || '0.01',

  // Real Hedera testnet connection, shared with packages/contracts.
  HEDERA_RPC_URL: process.env.HEDERA_RPC_URL || 'https://testnet.hashio.io/api',

  // Each juror's real, on-chain-registered private keys. Never hardcoded, never committed —
  // these come from backend/.env, which is gitignored the same way the contracts package's is.
  JUROR_SKEPTIC_PK: process.env.JUROR_SKEPTIC_PK,
  JUROR_SKEPTIC_HOT_PK: process.env.JUROR_SKEPTIC_HOT_PK,
  JUROR_PRAGMATIST_PK: process.env.JUROR_PRAGMATIST_PK,
  JUROR_PRAGMATIST_HOT_PK: process.env.JUROR_PRAGMATIST_HOT_PK,
  JUROR_MAVERICK_PK: process.env.JUROR_MAVERICK_PK,
  JUROR_MAVERICK_HOT_PK: process.env.JUROR_MAVERICK_HOT_PK,

  // The agent's own Pinata key, for pinning its reveal-time reasoning trail to IPFS. Deliberately separate
  // from the operator's own key (OPERATOR_PINATA_JWT, in packages/contracts/.env, used by the
  // resolution-checker) — confirmed isolated, neither side can read the other's key.
  AGENT_PINATA_JWT: process.env.AGENT_PINATA_JWT,

  // Legacy APIs (for price checks, etc.)
  COINGECKO_API_URL: 'https://api.coingecko.com/api/v3',
};

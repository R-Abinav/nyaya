require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
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

  // Temporary x402 payment adapter. Replace with the Hedera gateway later.
  DUMMY_X402_COST_HBAR: process.env.DUMMY_X402_COST_HBAR || '0.01',

  // Legacy APIs (for price checks, etc.)
  COINGECKO_API_URL: 'https://api.coingecko.com/api/v3',
};

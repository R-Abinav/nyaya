require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,

  // OpenRouter for LLM (NVIDIA Nemotron)
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',

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

  // Legacy APIs (for price checks, etc.)
  COINGECKO_API_URL: 'https://api.coingecko.com/api/v3',
};

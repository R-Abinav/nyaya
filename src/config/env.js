require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  COINGECKO_API_URL: 'https://api.coingecko.com/api/v3',
  NEWS_API_URL: 'https://cryptocurrency.cv/api',
};

const { COINGECKO_API_URL } = require('../config/env');

/**
 * Fetches the current Ethereum price from CoinGecko
 * @returns {Promise<{price: number, timestamp: string}>}
 */
async function getEthPrice() {
  const response = await fetch(`${COINGECKO_API_URL}/simple/price?ids=ethereum&vs_currencies=usd`);
  const data = await response.json();

  return {
    price: data.ethereum.usd,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getEthPrice,
};

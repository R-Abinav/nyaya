const { getEthPrice } = require('../services/priceService');

/**
 * GET /price/eth — Returns latest ETH price snapshot
 */
async function getPrice(req, res) {
  console.log('[priceController] Fetching ETH price...');
  try {
    const priceData = await getEthPrice();

    res.json({
      token: 'eth',
      price: priceData.price,
      ts: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch ETH price',
      message: error.message,
    });
  }
}

module.exports = {
  getPrice,
};

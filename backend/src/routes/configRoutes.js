const express = require('express');
const router = express.Router();
const { readDeployments } = require('../config/contracts');

/**
 * Real deployed contract addresses for the frontend's wallet-side transactions (buying/selling shares),
 * read fresh from packages/contracts/deployments/hedera.json every call — the same file and same
 * requireContractAddress()-backing data every other real chain read in this backend uses. Never
 * hardcoded/placeholder addresses in frontend source, and never a second, frontend-side copy of this file.
 */
router.get('/chain', (req, res) => {
  try {
    const deployments = readDeployments();
    res.json({
      chainId: 296, // Hedera testnet — where JurorShareMarket, JurorTreasury and NyayaResolver actually live
      rpcUrl: 'https://testnet.hashio.io/api',
      contracts: {
        JurorShareMarket: deployments.contracts?.JurorShareMarket ?? null,
        JurorTreasury: deployments.contracts?.JurorTreasury ?? null,
        NyayaResolver: deployments.contracts?.NyayaResolver ?? null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

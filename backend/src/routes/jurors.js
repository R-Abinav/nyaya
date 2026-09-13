const express = require('express');
const router = express.Router();
const jurorMarketController = require('../controllers/jurorMarketController');

/** GET /jurors — all three jurors as investable assets: real identity, real on-chain stats, real share price. */
router.get('/', jurorMarketController.getJurors);

/** GET /jurors/:jurorId/history — real per-case return checkpoints for one juror. */
router.get('/:jurorId/history', jurorMarketController.getJurorHistory);

/** GET /jurors/:jurorId — one juror's market view. */
router.get('/:jurorId', jurorMarketController.getJurorMarket);

module.exports = router;

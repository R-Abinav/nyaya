const express = require('express');
const router = express.Router();
const demoController = require('../controllers/demoController');
const { requireAdmin } = require('../middleware/adminAuth');

/**
 * The demo-trigger surface. This moves real testnet HBAR through the live resolver (a real bounty, real
 * juror stakes, real settlement) — same seriousness as any other operator action tonight, so it sits
 * behind the same admin auth every other privileged backend action uses, not a lighter check just because
 * it is "only a demo."
 */
router.post('/run-case', requireAdmin, demoController.runCase);
router.get('/run-case/:jobId', requireAdmin, demoController.getCaseJob);

module.exports = router;

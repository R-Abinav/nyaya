const express = require('express');
const controller = require('../controllers/marketController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.get('/predictions', controller.list);
router.get('/bets', controller.allHistory);
router.get('/predictions/:predictionId', controller.get);
router.get('/predictions/:predictionId/bets', controller.history);
router.get('/ai/predictions/:predictionId', controller.aiListing);
router.post('/ai/predictions/:predictionId/bets', controller.aiBet);

router.post('/admin/predictions', requireAdmin, controller.create);
router.patch('/admin/predictions/:predictionId', requireAdmin, controller.update);
router.delete('/admin/predictions/:predictionId', requireAdmin, controller.remove);
router.post('/admin/predictions/:predictionId/end', requireAdmin, controller.end);
router.get('/admin/accounts', requireAdmin, controller.accounts);
router.get('/admin/accounts/:accountId', requireAdmin, controller.account);
router.post('/admin/accounts/transfer', requireAdmin, controller.transfer);
router.get('/admin/transactions', requireAdmin, controller.transactions);

module.exports = router;

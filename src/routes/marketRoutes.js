const express = require('express');
const controller = require('../controllers/marketController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.get('/predictions', controller.list);
router.get('/bets', controller.allHistory);
router.get('/predictions/:predictionId', controller.get);
router.get('/predictions/:predictionId/bets', controller.history);
router.post('/predictions/:predictionId/bets', controller.bet);

router.post('/admin/predictions', requireAdmin, controller.create);
router.patch('/admin/predictions/:predictionId', requireAdmin, controller.update);
router.delete('/admin/predictions/:predictionId', requireAdmin, controller.remove);

module.exports = router;

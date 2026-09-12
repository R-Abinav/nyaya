const express = require('express');
const priceRoutes = require('./priceRoutes');
const predictionRoutes = require('./predictionRoutes');
const jurorRoutes = require('./juror');
const marketRoutes = require('./marketRoutes');
const aiBetRoutes = require('express').Router();
const aiBetController = require('../controllers/aiBetController');
const authRoutes = require('./authRoutes');
const walletRoutes = require('./walletRoutes');
const performanceRoutes = require('./performanceRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/wallet', walletRoutes);
router.use('/performance', performanceRoutes);
router.use('/me/performance', performanceRoutes);
router.use('/price', priceRoutes);
router.use('/predict', predictionRoutes);
router.use('/juror', jurorRoutes);
router.use('/', marketRoutes);
aiBetRoutes.post('/runs', aiBetController.start);
aiBetRoutes.get('/runs/:runId/events', aiBetController.events);
router.use('/ai/bet', aiBetRoutes);

module.exports = router;

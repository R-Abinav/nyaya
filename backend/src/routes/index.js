const express = require('express');
const priceRoutes = require('./priceRoutes');
const predictionRoutes = require('./predictionRoutes');
const jurorRoutes = require('./juror');
const marketRoutes = require('./marketRoutes');
const aiBetRoutes = require('express').Router();
const aiBetController = require('../controllers/aiBetController');

const router = express.Router();

router.use('/price', priceRoutes);
router.use('/predict', predictionRoutes);
router.use('/juror', jurorRoutes);
router.use('/', marketRoutes);
aiBetRoutes.post('/runs', aiBetController.start);
aiBetRoutes.get('/runs/:runId/events', aiBetController.events);
router.use('/ai/bet', aiBetRoutes);

module.exports = router;

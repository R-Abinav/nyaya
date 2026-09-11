const express = require('express');
const priceRoutes = require('./priceRoutes');
const predictionRoutes = require('./predictionRoutes');
const jurorRoutes = require('./juror');
const marketRoutes = require('./marketRoutes');

const router = express.Router();

router.use('/price', priceRoutes);
router.use('/predict', predictionRoutes);
router.use('/juror', jurorRoutes);
router.use('/', marketRoutes);

module.exports = router;

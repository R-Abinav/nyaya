const express = require('express');
const priceRoutes = require('./priceRoutes');
const predictionRoutes = require('./predictionRoutes');

const router = express.Router();

router.use('/price', priceRoutes);
router.use('/predict', predictionRoutes);

module.exports = router;

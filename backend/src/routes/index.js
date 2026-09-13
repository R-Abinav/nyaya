const express = require('express');
const priceRoutes = require('./priceRoutes');
const predictionRoutes = require('./predictionRoutes');
const jurorRoutes = require('./juror');
const jurorsRoutes = require('./jurors');
const marketRoutes = require('./marketRoutes');
const caseRoutes = require('./caseRoutes');
const demoRoutes = require('./demoRoutes');
const configRoutes = require('./configRoutes');
const activityRoutes = require('./activityRoutes');
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
router.use('/jurors', jurorsRoutes);
router.use('/cases', caseRoutes);
router.use('/demo', demoRoutes);
router.use('/config', configRoutes);
router.use('/activity', activityRoutes);
router.use('/', marketRoutes);

module.exports = router;

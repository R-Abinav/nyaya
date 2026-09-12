const express = require('express');
const { predict } = require('../controllers/predictionController');

const router = express.Router();

router.post('/', predict);

module.exports = router;

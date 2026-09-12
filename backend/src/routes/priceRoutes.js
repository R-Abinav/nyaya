const express = require('express');
const { getPrice } = require('../controllers/priceController');

const router = express.Router();

router.get('/eth', getPrice);

module.exports = router;

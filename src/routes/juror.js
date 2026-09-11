const express = require('express');
const router = express.Router();
const jurorController = require('../controllers/jurorController');

/**
 * POST /juror/investigate
 * Run an investigation with all 3 jurors
 *
 * Body:
 *   - question: Any objectively checkable question
 *
 * The case receives an internal identifier; no case type or source-specific ID
 * is required because all jurors use the generic NewsData.io evidence tool.
 */
router.post('/investigate', jurorController.investigateWithAllJurors);

/**
 * GET /juror/info
 * Get information about all jurors
 */
router.get('/info', jurorController.getJurorInfo);

/**
 * GET /juror/:jurorId
 * Get detailed information about a specific juror
 *
 * Params:
 *   - jurorId: One of: 'skeptic', 'pragmatist', 'maverick'
 */
router.get('/:jurorId', jurorController.getJurorDetails);

module.exports = router;

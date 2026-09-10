const express = require('express');
const router = express.Router();
const jurorController = require('../controllers/jurorController');

/**
 * POST /juror/investigate
 * Run an investigation with all 3 jurors
 *
 * Body:
 *   - question: The case question
 *   - caseType: One of: 'rocket-launch', 'flight-delay', 'github-stars'
 *   - caseId: (optional) Case identifier
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

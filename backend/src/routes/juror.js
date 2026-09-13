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
 * GET /juror/reasoning/:caseId
 * Every juror's persisted reasoning trail for a case (structured: tool calls, findings, stop reason,
 * and — for a juror that declined to commit — why confidence stayed low).
 */
router.get('/reasoning/:caseId', jurorController.getCaseReasoning);

/**
 * GET /juror/reasoning/:caseId/:jurorId
 * One juror's persisted reasoning trail for a case.
 */
router.get('/reasoning/:caseId/:jurorId', jurorController.getJurorReasoning);

/**
 * GET /juror/:jurorId
 * Get detailed information about a specific juror
 *
 * Params:
 *   - jurorId: One of: 'skeptic', 'pragmatist', 'maverick'
 */
router.get('/:jurorId', jurorController.getJurorDetails);

module.exports = router;

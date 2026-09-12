const { generatePrediction } = require('../services/llmService');

/**
 * POST /predict — LLM analyzes ETH price prediction
 */
async function predict(req, res) {
  try {
    const question = req.body.question;
    const result = await generatePrediction(question);

    res.json({
      verdict: result.verdict,
      analysis: result.analysis,
      toolCallCount: result.toolCallCount,
      toolsCalled: result.toolsCalled,
      ts: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('[predictionController] ERROR:', error.message);
    console.error('[predictionController] Stack:', error.stack);

    res.status(500).json({
      error: 'Failed to generate prediction',
      message: error.message,
    });
  }
}

module.exports = {
  predict,
};

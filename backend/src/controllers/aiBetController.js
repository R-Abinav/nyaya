const { getRun, startRun } = require('../services/aiBetRunner');
const { getPrediction } = require('../services/predictionMarketService');

async function start(req, res) {
  try {
    await getPrediction(req.body.predictionId);
    const run = await startRun(req.body.predictionId, req.user?.id, req.body.forceBet === true);
    res.status(202).json({ runId: run.id, predictionId: run.predictionId, forceBet: run.forceBet });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

function events(req, res) {
  try {
    const run = getRun(req.params.runId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
    run.events.forEach(send);
    if (run.done) return res.end();
    run.listeners.add(send);
    req.on('close', () => run.listeners.delete(send));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}

module.exports = { start, events };

const { startDemoJob, getJob } = require('../services/demoJobRunner');

function runCase(req, res) {
  const job = startDemoJob();
  res.status(202).json({ jobId: job.id, phase: job.phase });
}

function getCaseJob(req, res) {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: `No demo job ${req.params.jobId}` });
  res.json(job);
}

module.exports = { runCase, getCaseJob };

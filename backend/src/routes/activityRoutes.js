const express = require('express');
const { getResolverContract, getProvider } = require('../config/contracts');
const router = express.Router();

const ACTIVITY_LOOKBACK_BLOCKS = 200_000; // same Hashio-range rationale as every other lookback in this backend
const EVENT_NAMES = ['Committed', 'Revealed', 'OutcomeSubmitted', 'CaseSettled', 'CaseOpened'];

/**
 * GET /activity — real, recent transaction hashes off the live resolver, no new indexing layer: the same
 * queryFilter-with-a-bounded-lookback pattern caseRoutes.js already uses, just across every case instead
 * of one. This is what backs the live activity panel.
 */
router.get('/', async (req, res) => {
  try {
    const resolver = getResolverContract();
    const provider = getProvider();
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - ACTIVITY_LOOKBACK_BLOCKS);

    const logsByEvent = await Promise.all(
      EVENT_NAMES.map(name => resolver.queryFilter(resolver.filters[name](), fromBlock, latestBlock)),
    );

    const events = logsByEvent.flat().map(log => ({
      type: log.fragment.name,
      caseId: log.args.caseId?.toString() ?? null,
      juror: log.args.juror ?? null,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }));

    events.sort((a, b) => b.blockNumber - a.blockNumber);
    const recent = events.slice(0, limit);

    // Timestamps are a second RPC round-trip per unique block, not per event — cheap since many events
    // share a block (e.g. three Revealed in the same settle-adjacent block).
    const uniqueBlocks = [...new Set(recent.map(e => e.blockNumber))];
    const blocks = await Promise.all(uniqueBlocks.map(b => provider.getBlock(b)));
    const timestampByBlock = new Map(blocks.map(b => [b.number, b.timestamp]));
    const withTimestamps = recent.map(e => ({ ...e, timestamp: timestampByBlock.get(e.blockNumber) ?? null }));

    res.json({ events: withTimestamps });
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

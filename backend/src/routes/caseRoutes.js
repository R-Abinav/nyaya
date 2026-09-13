const express = require('express');
const { getResolverContract, getProvider } = require('../config/contracts');
const { getAllJurorIds, getJuror } = require('../config/jurors');
const router = express.Router();

const CASE_LOOKBACK_BLOCKS = 200_000; // same Hashio-range rationale as contracts.js's other lookbacks

/**
 * Real per-juror commit/reveal tx hashes, plus outcome-submission and settlement tx hashes, for one case.
 * All real on-chain reads — never fabricated, and never left silently blank when the events exist. Only
 * the three known jurors are checked (the resolver's own `participants` array is internal, no public
 * getter), which is exactly every juror this project has, so nothing is missed.
 */
async function getCaseTxHashes(resolver, provider, caseId) {
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - CASE_LOOKBACK_BLOCKS);

  const jurors = await Promise.all(
    getAllJurorIds().map(async jurorId => {
      const juror = getJuror(jurorId);
      const [committedLogs, revealedLogs] = await Promise.all([
        resolver.queryFilter(resolver.filters.Committed(caseId, juror.address), fromBlock, latestBlock),
        resolver.queryFilter(resolver.filters.Revealed(caseId, juror.address), fromBlock, latestBlock),
      ]);
      if (committedLogs.length === 0) return null; // never participated in this case
      return {
        jurorId: juror.id,
        jurorName: juror.name,
        address: juror.address,
        commitTx: committedLogs[0].transactionHash,
        revealTx: revealedLogs[0]?.transactionHash ?? null,
        ruling: revealedLogs[0] ? Number(revealedLogs[0].args.ruling) : null,
      };
    }),
  );

  const [outcomeLogs, settledLogs] = await Promise.all([
    resolver.queryFilter(resolver.filters.OutcomeSubmitted(caseId), fromBlock, latestBlock),
    resolver.queryFilter(resolver.filters.CaseSettled(caseId), fromBlock, latestBlock),
  ]);

  return {
    jurors: jurors.filter(Boolean),
    submitOutcomeTx: outcomeLogs[0]?.transactionHash ?? null,
    settleTx: settledLogs[0]?.transactionHash ?? null,
  };
}

/**
 * GET /cases
 * Get all cases from the NyayaResolver.
 * This reads directly from the deployed contract.
 */
router.get('/', async (req, res) => {
  try {
    const resolver = getResolverContract();
    const provider = getProvider();
    
    // Fetch all CaseOpened events to get the questions and types
    // Since Hashio has a limit, we might need to just fetch recent blocks.
    // However, the contract has caseCount.
    const countBN = await resolver.caseCount();
    const count = Number(countBN);
    
    if (count === 0) {
      return res.json([]);
    }

    // We can fetch CaseOpened events for the questions
    const latestBlock = await provider.getBlockNumber();
    // Using a safe lookback window (e.g. 200,000 blocks as in contracts.js)
    const fromBlock = Math.max(0, latestBlock - 200000);
    const openedEvents = await resolver.queryFilter(resolver.filters.CaseOpened(), fromBlock, latestBlock);
    
    const eventMap = new Map();
    for (const event of openedEvents) {
      eventMap.set(Number(event.args.caseId), event.args);
    }

    const cases = [];
    for (let i = 1; i <= count; i++) {
      const caseData = await resolver.cases(i);
      
      const openedEvent = eventMap.get(i);
      const question = openedEvent ? openedEvent.question : `Case #${i}`;
      const caseType = openedEvent ? openedEvent.caseType : 'unknown';

      // Status logic similar to frontend
      const now = Math.floor(Date.now() / 1000);
      let status = 'upcoming'; // Before commitDeadline
      if (caseData.settled || caseData.cancelled) {
        status = 'resolved';
      } else if (now >= Number(caseData.commitDeadline)) {
        status = 'active'; // past commit deadline, active / revealing
      }

      cases.push({
        id: i.toString(),
        title: question,
        caseType,
        status,
        bounty: Number(caseData.bounty) / 1e8, // HBAR has 8 decimals
        startsAt: new Date(Number(caseData.commitDeadline) * 1000).toISOString(),
        resolvesAt: new Date(Number(caseData.resolutionTime) * 1000).toISOString(),
        totalStaked: Number(caseData.bounty) / 1e8, // mapped to bounty for UI
        outcome: Number(caseData.outcome), // 0: None, 1: No, 2: Yes
      });
    }
    
    res.json(cases);
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /cases/:id
 * Get a single case
 */
router.get('/:id', async (req, res) => {
  try {
    const resolver = getResolverContract();
    const provider = getProvider();
    const caseId = Number(req.params.id);
    
    const countBN = await resolver.caseCount();
    if (caseId <= 0 || caseId > Number(countBN)) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const caseData = await resolver.cases(caseId);
    
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 200000);
    const openedEvents = await resolver.queryFilter(resolver.filters.CaseOpened(caseId), fromBlock, latestBlock);
    const openedEvent = openedEvents.length > 0 ? openedEvents[0].args : null;
    
    const question = openedEvent ? openedEvent.question : `Case #${caseId}`;
    const caseType = openedEvent ? openedEvent.caseType : 'unknown';

    const now = Math.floor(Date.now() / 1000);
    let status = 'upcoming';
    if (caseData.settled || caseData.cancelled) {
      status = 'resolved';
    } else if (now >= Number(caseData.commitDeadline)) {
      status = 'active';
    }

    const txHashes = await getCaseTxHashes(resolver, provider, caseId);

    res.json({
      id: caseId.toString(),
      title: question,
      caseType,
      status,
      bounty: Number(caseData.bounty) / 1e8,
      startsAt: new Date(Number(caseData.commitDeadline) * 1000).toISOString(),
      resolvesAt: new Date(Number(caseData.resolutionTime) * 1000).toISOString(),
      totalStaked: Number(caseData.bounty) / 1e8,
      outcome: Number(caseData.outcome),
      jurors: txHashes.jurors,
      submitOutcomeTx: txHashes.submitOutcomeTx,
      settleTx: txHashes.settleTx,
    });
  } catch (error) {
    console.error('Error fetching case:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

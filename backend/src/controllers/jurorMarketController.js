const { getAllJurorIds, getJuror } = require('../config/jurors');
const { getJurorOnChainStats, getJurorReturnHistory, getJurorShareInfo } = require('../config/contracts');

/**
 * Real, on-chain-sourced juror-as-investable-asset data. Reuses config/jurors.js for identity/persona and
 * config/contracts.js for every number (never a frontend-side re-implementation of these reads) — the
 * same read shape packages/contracts/script/ens/jurorStats.ts uses to write ENS text records, so this
 * endpoint and ENS never disagree about a juror's real stats.
 */
async function buildJurorMarketView(jurorId) {
  const juror = getJuror(jurorId);
  const [stats, shareInfo] = await Promise.all([
    getJurorOnChainStats(juror.address),
    getJurorShareInfo(juror.address),
  ]);
  return {
    id: juror.id,
    name: juror.name,
    ensName: juror.ensName,
    address: juror.address,
    hotWallet: juror.hotWallet,
    persona: juror.persona,
    casesJudged: stats.casesJudged,
    lastCaseId: stats.lastCaseId === null ? null : stats.lastCaseId.toString(),
    cumulativeReturnBps: stats.cumulativeReturnBps.toString(),
    sharePrice: shareInfo,
  };
}

async function getJurors(req, res) {
  try {
    const jurorIds = getAllJurorIds();
    const jurors = await Promise.all(jurorIds.map(buildJurorMarketView));
    res.json({ jurors });
  } catch (error) {
    console.error('[jurorMarketController] getJurors error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function getJurorMarket(req, res) {
  try {
    const view = await buildJurorMarketView(req.params.jurorId);
    res.json(view);
  } catch (error) {
    if (error.message.startsWith('Unknown juror')) return res.status(404).json({ error: error.message });
    console.error('[jurorMarketController] getJurorMarket error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Real per-case return-on-capital checkpoints for one juror, chronological by settlement block. Empty
 * array for a juror with no settled cases yet — a real, valid state (see the "juror with zero case
 * history" empty state), never an error.
 */
async function getJurorHistory(req, res) {
  try {
    const juror = getJuror(req.params.jurorId);
    const history = await getJurorReturnHistory(juror.address);
    res.json({ jurorId: juror.id, history });
  } catch (error) {
    if (error.message.startsWith('Unknown juror')) return res.status(404).json({ error: error.message });
    console.error('[jurorMarketController] getJurorHistory error:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getJurors, getJurorMarket, getJurorHistory };

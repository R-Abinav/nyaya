const { investigateCase, generateCommitment, mapVerdictToRuling, generateSalt, calculateStake, CONFIDENCE_THRESHOLD_BPS } = require('../services/jurorAgent');
const { getAllJurorIds, getJuror } = require('../config/jurors');
const { getTreasuryContract, getResolverContract, getCaseType } = require('../config/contracts');
const { recordTrail, getTrail, getTrailsForCase } = require('../services/reasoningTrailStore');

const TINYBAR_PER_HBAR = 100_000_000;

/** Real on-chain balance, converted from tinybars (what the contract reports, per
 *  .claude/rules/contracts.md) to HBAR (what calculateStake and the rest of this pipeline expect). */
async function getJurorTreasuryBalanceHbar(jurorAddress) {
  const treasury = getTreasuryContract();
  const balanceTinybar = await treasury.balanceOf(jurorAddress);
  return Number(balanceTinybar) / TINYBAR_PER_HBAR;
}

/**
 * Run investigation with all 3 jurors
 */
async function investigateWithAllJurors(req, res) {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        error: 'Missing required field: question',
      });
    }

    // commitmentFor() needs a real uint256 caseId, matching an actual on-chain case — a fabricated string
    // id (the old `case_${Date.now()}`) can never produce a valid commitment. This endpoint doesn't open a
    // real case itself yet (that's a separate, larger piece of work), so it accepts a real caseId from the
    // caller and otherwise falls back to the resolver's current caseCount(), which is a real, already-open
    // case id: NyayaResolver._open does `caseId = ++caseCount`, so caseCount() is exactly the most
    // recently opened case, never a fabricated placeholder.
    const resolverForCaseId = getResolverContract();
    const useCaseId = req.body.caseId !== undefined
      ? BigInt(req.body.caseId)
      : await resolverForCaseId.caseCount();
    const commitDeadline = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    // caseType is read live from the case's own CaseOpened event — the resolver has no getter for it, it's
    // event-only (see config/contracts.js's getCaseType) — never left to a default. A caseId with no real
    // CaseOpened event throws here rather than silently falling back to 'general-news'.
    const caseType = await getCaseType(useCaseId);

    const caseData = {
      caseId: useCaseId,
      question: question.trim(),
      commitDeadline,
      caseType,
    };

    console.log('\n='.repeat(80));
    console.log('NYAYA CASE INVESTIGATION');
    console.log('='.repeat(80));
    console.log(`Case ID: ${useCaseId}`);
    console.log(`Case Type: ${caseType}`);
    console.log(`Question: ${question}`);
    console.log(`Commit Deadline: ${commitDeadline}`);
    console.log('='.repeat(80));

    // Run all three jurors in parallel
    const jurorIds = getAllJurorIds();
    const investigations = await Promise.all(
      jurorIds.map(jurorId => investigateCase(jurorId, caseData))
    );

    // Generate commitments for each juror that clears the confidence threshold; a juror below it declines
    // to commit for this case instead (see jurorAgent.js's CONFIDENCE_THRESHOLD_BPS doc comment). Its
    // evidence spend already happened via withdrawForEvidence and stands as a real, accepted loss — no
    // stake ever locks either way, since staking only happens at commit.
    const results = await Promise.all(investigations.map(async investigation => {
      const juror = getJuror(investigation.jurorId);

      // Real, on-chain-registered Hedera address — never fabricated. See config/jurors.js.
      const jurorAddress = juror.address;

      // Ruling is the enum index (0/1/2), never the free-text outcome label; confidenceBps is basis
      // points (0-10000), never a percentage string. See mapVerdictToRuling's own comment for why the
      // mapping from a multi-option "Chosen Outcome" to binary Yes/No is needed at all right now.
      const ruling = mapVerdictToRuling(investigation.selectedOutcome || investigation.verdict);
      const confidenceBps = Math.round(investigation.bettingFraction * 10000);
      const declined = confidenceBps < CONFIDENCE_THRESHOLD_BPS;

      let stake = null;
      let commitment = null;
      let saltStatus = 'not_applicable_declined';

      if (!declined) {
        const treasuryBalance = await getJurorTreasuryBalanceHbar(jurorAddress);
        stake = calculateStake(investigation.bettingFraction, treasuryBalance);
        const salt = generateSalt();
        commitment = generateCommitment(useCaseId, jurorAddress, ruling, confidenceBps, salt);
        saltStatus = 'generated_not_returned';
      }

      const result = {
        jurorId: investigation.jurorId,
        jurorName: investigation.jurorName,
        verdict: investigation.verdict,
        selectedOutcome: investigation.selectedOutcome || investigation.verdict,
        bettingFraction: investigation.bettingFraction,
        confidenceBps,
        declined,
        declineReason: declined
          ? `Confidence ${(confidenceBps / 100).toFixed(1)}% is below the ${(CONFIDENCE_THRESHOLD_BPS / 100).toFixed(1)}% commit threshold. Evidence spend stands as an accepted loss; no stake was locked.`
          : null,
        stake,
        totalSpent: investigation.totalSpent,
        toolCallCount: investigation.evidenceTrail.toolCalls.length,
        commitment,
        saltStatus,
        analysis: investigation.evidenceTrail.finalAnalysis,
        stopReason: investigation.evidenceTrail.stopReason,
        evidenceTrail: investigation.evidenceTrail,
      };

      if (declined) {
        console.log(`[${result.jurorName}] declined to commit for case ${useCaseId}: confidence ${confidenceBps}bps < threshold ${CONFIDENCE_THRESHOLD_BPS}bps. Evidence spend of ${result.totalSpent} HBAR stands as an accepted loss.`);
      }

      recordTrail({
        caseId: String(useCaseId),
        jurorId: result.jurorId,
        jurorName: result.jurorName,
        outcome: declined ? 'declined' : 'committed',
        selectedOutcome: result.selectedOutcome,
        confidenceBps,
        bettingFraction: result.bettingFraction,
        totalSpent: result.totalSpent,
        toolCalls: investigation.evidenceTrail.toolCalls,
        reasoning: investigation.evidenceTrail.reasoning,
        stopReason: investigation.evidenceTrail.stopReason,
        finalAnalysis: investigation.evidenceTrail.finalAnalysis,
        declineReason: result.declineReason,
      });

      return result;
    }));

    console.log('\n' + '='.repeat(80));
    console.log('INVESTIGATION RESULTS');
    console.log('='.repeat(80));

    results.forEach(result => {
      console.log(`\n${result.jurorName}:`);
      console.log(`  Chosen outcome: ${result.selectedOutcome}`);
      console.log(`  Betting fraction: ${(result.bettingFraction * 100).toFixed(1)}% of treasury risked (${result.confidenceBps}bps)`);
      console.log(`  Evidence Spend: ${result.totalSpent.toFixed(2)} HBAR`);
      console.log(`  Tool Calls: ${result.toolCallCount}`);
      if (result.declined) {
        console.log(`  DECLINED TO COMMIT: ${result.declineReason}`);
      } else {
        console.log(`  Stake: ${result.stake.toFixed(2)} HBAR`);
        console.log(`  Commitment: ${result.commitment.slice(0, 16)}...`);
      }
    });

    console.log('\n' + '='.repeat(80) + '\n');

    res.json({
      caseId: useCaseId,
      question: question.trim(),
      commitDeadline,
      jurors: results,
      summary: {
        totalJurors: results.length,
        selectedOutcomes: results.reduce((counts, result) => {
          counts[result.selectedOutcome] = (counts[result.selectedOutcome] || 0) + 1;
          return counts;
        }, {}),
        averageBettingFraction: (results.reduce((sum, r) => sum + r.bettingFraction, 0) / results.length).toFixed(3),
        totalToolCalls: results.reduce((sum, r) => sum + r.toolCallCount, 0),
        totalSpent: results.reduce((sum, r) => sum + r.totalSpent, 0).toFixed(2),
      },
    });
  } catch (error) {
    console.error('[jurorController] Error:', error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * Get information about all jurors
 */
function getJurorInfo(req, res) {
  const jurorIds = getAllJurorIds();
  const jurors = jurorIds.map(id => {
    const juror = getJuror(id);
    return {
      id: juror.id,
      name: juror.name,
      ensName: juror.ensName,
      toolPreferences: juror.toolPreferences,
      bettingFractionThresholds: juror.bettingFractionThresholds,
    };
  });

  res.json({
    jurors,
    description: 'Three NVIDIA Nemotron AI jurors compare available prediction outcomes, choose one outcome each, and select a risk-adjusted betting fraction based on evidence and expected profit.',
  });
}

/**
 * Get detailed info about a specific juror
 */
function getJurorDetails(req, res) {
  try {
    const { jurorId } = req.params;
    const juror = getJuror(jurorId);

    res.json({
      id: juror.id,
      name: juror.name,
      ensName: juror.ensName,
      systemPrompt: juror.systemPrompt,
      toolPreferences: juror.toolPreferences,
      bettingFractionThresholds: juror.bettingFractionThresholds,
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}

/**
 * Get every juror's persisted reasoning trail for a case — every tool call, findings, why it stopped,
 * and (for a declined juror) why confidence stayed low. Structured data, not a log line, so the frontend
 * can render it after the fact.
 */
function getCaseReasoning(req, res) {
  const { caseId } = req.params;
  const trails = getTrailsForCase(caseId);
  res.json({ caseId, jurors: trails });
}

/**
 * Get one juror's persisted reasoning trail for a case.
 */
function getJurorReasoning(req, res) {
  const { caseId, jurorId } = req.params;
  const trail = getTrail(caseId, jurorId);
  if (!trail) {
    return res.status(404).json({ error: `No reasoning trail for juror ${jurorId} on case ${caseId}.` });
  }
  res.json(trail);
}

module.exports = {
  investigateWithAllJurors,
  getJurorInfo,
  getJurorDetails,
  getCaseReasoning,
  getJurorReasoning,
};

const { investigateCase, generateCommitment, generateSalt, calculateStake } = require('../services/jurorAgent');
const { getAllJurorIds, getJuror } = require('../config/jurors');

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

    const useCaseId = `case_${Date.now()}`;
    const commitDeadline = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    const caseData = {
      caseId: useCaseId,
      question: question.trim(),
      commitDeadline,
    };

    console.log('\n='.repeat(80));
    console.log('NYAYA CASE INVESTIGATION');
    console.log('='.repeat(80));
    console.log(`Case ID: ${useCaseId}`);
    console.log(`Question: ${question}`);
    console.log(`Commit Deadline: ${commitDeadline}`);
    console.log('='.repeat(80));

    // Run all three jurors in parallel
    const jurorIds = getAllJurorIds();
    const investigations = await Promise.all(
      jurorIds.map(jurorId => investigateCase(jurorId, caseData))
    );

    // Generate commitments for each juror
    const results = investigations.map(investigation => {
      getJuror(investigation.jurorId);
      const salt = generateSalt();

      // TODO: Get real juror addresses from Hedera
      const jurorAddress = `0x${investigation.jurorId.padEnd(40, '0')}`;

      // Calculate stake based on betting fraction
      const treasuryBalance = 1000; // TODO: Read from contract
      const stake = calculateStake(investigation.bettingFraction, treasuryBalance);

      const commitment = generateCommitment(
        useCaseId,
        jurorAddress,
        investigation.verdict,
        // Convert betting fraction to percentage for commitment (backward compatibility)
        (investigation.bettingFraction * 100).toFixed(1),
        salt
      );

      const result = {
        jurorId: investigation.jurorId,
        jurorName: investigation.jurorName,
        verdict: investigation.verdict,
        selectedOutcome: investigation.selectedOutcome || investigation.verdict,
        bettingFraction: investigation.bettingFraction,
        stake,
        totalSpent: investigation.totalSpent,
        toolCallCount: investigation.evidenceTrail.toolCalls.length,
        commitment,
        saltStatus: 'generated_not_returned',
        analysis: investigation.evidenceTrail.finalAnalysis,
        evidenceTrail: investigation.evidenceTrail,
      };

      if (result.totalSpent > 0 && !result.commitment) {
        console.error(`[ALERT][SpentWithoutCommitting] ${result.jurorId} spent ${result.totalSpent} HBAR for case ${useCaseId} without a commitment`);
        throw new Error(`Invariant violation: ${result.jurorId} spent evidence funds without a commitment`);
      }

      return result;
    });

    console.log('\n' + '='.repeat(80));
    console.log('INVESTIGATION RESULTS');
    console.log('='.repeat(80));

    results.forEach(result => {
      console.log(`\n${result.jurorName}:`);
      console.log(`  Chosen outcome: ${result.selectedOutcome}`);
      console.log(`  Betting fraction: ${(result.bettingFraction * 100).toFixed(1)}% of treasury risked`);
      console.log(`  Stake: ${result.stake.toFixed(2)} HBAR`);
      console.log(`  Evidence Spend: ${result.totalSpent.toFixed(2)} HBAR`);
      console.log(`  Tool Calls: ${result.toolCallCount}`);
      console.log(`  Commitment: ${result.commitment.slice(0, 16)}...`);
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

module.exports = {
  investigateWithAllJurors,
  getJurorInfo,
  getJurorDetails,
};

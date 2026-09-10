const { investigateCase, generateCommitment, generateSalt, calculateStake } = require('../services/jurorAgent');
const { getAllJurorIds, getJuror } = require('../config/jurors');

/**
 * Run investigation with all 3 jurors
 */
async function investigateWithAllJurors(req, res) {
  try {
    const { question, caseType, caseId } = req.body;

    if (!question || !caseType) {
      return res.status(400).json({
        error: 'Missing required fields: question, caseType',
      });
    }

    const useCaseId = caseId || `case_${Date.now()}`;
    const commitDeadline = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    const caseData = {
      caseId: useCaseId,
      question,
      caseType,
      commitDeadline,
    };

    console.log('\n='.repeat(80));
    console.log('NYAYA CASE INVESTIGATION');
    console.log('='.repeat(80));
    console.log(`Case ID: ${useCaseId}`);
    console.log(`Question: ${question}`);
    console.log(`Case Type: ${caseType}`);
    console.log(`Commit Deadline: ${commitDeadline}`);
    console.log('='.repeat(80));

    // Run all three jurors in parallel
    const jurorIds = getAllJurorIds();
    const investigations = await Promise.all(
      jurorIds.map(jurorId => investigateCase(jurorId, caseData))
    );

    // Generate commitments for each juror
    const results = investigations.map(investigation => {
      const juror = getJuror(investigation.jurorId);
      const salt = generateSalt();

      // TODO: Get real juror addresses from Hedera
      const jurorAddress = `0x${investigation.jurorId.padEnd(40, '0')}`;

      // Calculate stake based on confidence
      const treasuryBalance = 1000; // TODO: Read from contract
      const stake = calculateStake(investigation.confidence, treasuryBalance);

      const commitment = generateCommitment(
        useCaseId,
        jurorAddress,
        investigation.verdict,
        investigation.confidence,
        salt
      );

      return {
        jurorId: investigation.jurorId,
        jurorName: investigation.jurorName,
        verdict: investigation.verdict,
        confidence: investigation.confidence,
        stake,
        totalSpent: investigation.totalSpent,
        toolCallCount: investigation.evidenceTrail.toolCalls.length,
        commitment,
        // In production, salt must be persisted durably before committing
        // For demo purposes, we include it in the response
        salt: salt,
        analysis: investigation.evidenceTrail.finalAnalysis,
      };
    });

    console.log('\n' + '='.repeat(80));
    console.log('INVESTIGATION RESULTS');
    console.log('='.repeat(80));

    results.forEach(result => {
      console.log(`\n${result.jurorName}:`);
      console.log(`  Verdict: ${result.verdict}`);
      console.log(`  Confidence: ${result.confidence}%`);
      console.log(`  Stake: ${result.stake.toFixed(2)} HBAR`);
      console.log(`  Evidence Spend: ${result.totalSpent.toFixed(2)} HBAR`);
      console.log(`  Tool Calls: ${result.toolCallCount}`);
      console.log(`  Commitment: ${result.commitment.slice(0, 16)}...`);
    });

    console.log('\n' + '='.repeat(80) + '\n');

    res.json({
      caseId: useCaseId,
      question,
      caseType,
      commitDeadline,
      jurors: results,
      summary: {
        totalJurors: results.length,
        verdicts: {
          yes: results.filter(r => r.verdict === 'yes').length,
          no: results.filter(r => r.verdict === 'no').length,
        },
        averageConfidence: (results.reduce((sum, r) => sum + r.confidence, 0) / results.length).toFixed(1),
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
      confidenceThresholds: juror.confidenceThresholds,
    };
  });

  res.json({
    jurors,
    description: 'All three jurors run NVIDIA Nemotron via OpenRouter. Differentiation comes from system prompts, evidence thresholds, and tool preferences.',
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
      confidenceThresholds: juror.confidenceThresholds,
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

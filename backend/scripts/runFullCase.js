/**
 * Runs one real case end to end: all three jurors investigate for real (real LLM reasoning, real evidence
 * tool calls, each preceded by a real on-chain treasury withdrawal), each either declines (confidence below
 * threshold — its evidence spend stands as a real, accepted loss) or commits with a real, confidence-scaled
 * stake, and — after the case's real on-chain commit deadline passes — each committed juror pins its
 * reasoning trail to IPFS with its own Pinata key and reveals for real.
 *
 * This script only drives the AGENT side (juror keys). Opening the case and, afterward, running the
 * resolution-checker / submitOutcome / settle are separate, operator-keyed steps in packages/contracts —
 * kept there deliberately, the same structural separation as everywhere else tonight.
 *
 * Run: set -a; source .env; set +a && CASE_ID=<id> node scripts/runFullCase.js
 */
const fs = require('fs');
const path = require('path');
const { investigateCase, generateCommitment, mapVerdictToRuling, generateSalt, calculateStake, CONFIDENCE_THRESHOLD_BPS } = require('../src/services/jurorAgent');
const { getAllJurorIds, getJuror } = require('../src/config/jurors');
const { getTreasuryContract, getResolverContract, getResolverAsSigner, getJurorSigner, getCaseType } = require('../src/config/contracts');
const { recordTrail } = require('../src/services/reasoningTrailStore');
const { pinReasoningTrailToIpfs } = require('../src/services/agentPinata');

const TINYBAR_PER_HBAR = 100_000_000;

// A committed salt exists ONLY in this process's memory until it's revealed — losing it before reveal
// makes that commitment permanently unrevealable (the stake then forfeits as Unrevealed at settlement).
// This bit the very first run of this script for real: a crash between commit and reveal (a BigInt
// JSON.stringify bug in the pinning step, since fixed) took three real commits down with it. Every commit
// is now durably written here the instant it confirms, before the long wait-for-commitDeadline phase even
// starts, so a crash after this point is recoverable by hand instead of unrevealable by construction.
const RUN_STATE_DIR = path.resolve(__dirname, '.runs');

function commitStatePath(caseId) {
  return path.join(RUN_STATE_DIR, `case-${caseId}-commits.json`);
}

function persistCommit(caseId, decision) {
  fs.mkdirSync(RUN_STATE_DIR, { recursive: true });
  const filePath = commitStatePath(caseId);
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  existing[decision.jurorId] = {
    ruling: decision.ruling,
    confidenceBps: decision.confidenceBps,
    salt: decision.salt,
    commitment: decision.commitment,
    stakeHbar: decision.stakeHbar,
    commitTxHash: decision.commitTxHash,
  };
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

async function getJurorTreasuryBalanceHbar(jurorAddress) {
  const treasury = getTreasuryContract();
  const balanceTinybar = await treasury.balanceOf(jurorAddress);
  return Number(balanceTinybar) / TINYBAR_PER_HBAR;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const caseIdEnv = process.env.CASE_ID;
  if (!caseIdEnv) throw new Error('CASE_ID is required.');
  const caseId = BigInt(caseIdEnv);

  const resolver = getResolverContract();
  const onChainCase = await resolver.cases(caseId);
  const commitDeadlineSec = Number(onChainCase.commitDeadline);
  const resolutionTimeSec = Number(onChainCase.resolutionTime);
  const caseType = await getCaseType(caseId);

  console.log('='.repeat(80));
  console.log(`RUNNING FULL CASE ${caseId}`);
  console.log('='.repeat(80));
  console.log(`caseType: ${caseType}`);
  console.log(`commitDeadline: ${new Date(commitDeadlineSec * 1000).toISOString()}`);
  console.log(`resolutionTime: ${new Date(resolutionTimeSec * 1000).toISOString()}`);
  console.log(`confidence threshold: ${CONFIDENCE_THRESHOLD_BPS}bps`);

  const question = process.env.CASE_QUESTION;
  if (!question) throw new Error('CASE_QUESTION is required (same text the case was opened with).');

  const caseData = {
    caseId,
    question,
    commitDeadline: new Date(commitDeadlineSec * 1000).toISOString(),
    caseType,
  };

  // --- phase 1: investigate (real LLM, real evidence tool calls, real on-chain withdrawals per call) ---
  // allSettled, not all: a real bug already crashed one juror's investigateCase() tonight after the other
  // two had already made real on-chain withdrawals — Promise.all would have thrown those away along with
  // it. A juror whose investigation genuinely fails is logged and skipped, not allowed to take the other
  // two juror's already-real work down with it.
  const jurorIds = getAllJurorIds();
  const settled = await Promise.allSettled(jurorIds.map(jurorId => investigateCase(jurorId, caseData)));
  const investigations = [];
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled') {
      investigations.push(settled[i].value);
    } else {
      console.error(`\n[${jurorIds[i]}] investigation failed and is excluded from this case: ${settled[i].reason?.message || settled[i].reason}`);
    }
  }
  if (investigations.length === 0) throw new Error('Every juror\'s investigation failed; nothing to commit or reveal.');

  const decisions = [];
  for (const investigation of investigations) {
    const juror = getJuror(investigation.jurorId);
    const jurorAddress = juror.address;
    const ruling = mapVerdictToRuling(investigation.selectedOutcome || investigation.verdict);
    const confidenceBps = Math.round(investigation.bettingFraction * 10000);
    const declined = confidenceBps < CONFIDENCE_THRESHOLD_BPS;

    const decision = {
      jurorId: investigation.jurorId,
      jurorName: investigation.jurorName,
      juror,
      ruling,
      confidenceBps,
      declined,
      totalSpent: investigation.totalSpent,
      evidenceTrail: investigation.evidenceTrail,
      selectedOutcome: investigation.selectedOutcome || investigation.verdict,
    };

    if (declined) {
      console.log(`\n[${decision.jurorName}] DECLINED — confidence ${confidenceBps}bps < threshold ${CONFIDENCE_THRESHOLD_BPS}bps. ` +
        `Evidence spend of ${decision.totalSpent} HBAR (real, on-chain, withdrawn per call) stands as an accepted loss.`);
    } else {
      const treasuryBalance = await getJurorTreasuryBalanceHbar(jurorAddress);
      const stakeHbar = calculateStake(investigation.bettingFraction, treasuryBalance);
      const stakeTinybar = BigInt(Math.round(stakeHbar * TINYBAR_PER_HBAR));
      const salt = generateSalt();
      const commitment = generateCommitment(caseId, jurorAddress, ruling, confidenceBps, salt);

      console.log(`\n[${decision.jurorName}] COMMITTING — confidence ${confidenceBps}bps >= threshold, ` +
        `ruling ${ruling}, stake ${stakeHbar.toFixed(4)} HBAR`);

      const jurorSigner = getJurorSigner(juror);
      const resolverAsJuror = getResolverAsSigner(jurorSigner);
      const commitTx = await resolverAsJuror.commit(caseId, commitment, stakeTinybar);
      console.log(`[${decision.jurorName}] commit tx ${commitTx.hash}`);
      const commitReceipt = await commitTx.wait();
      if (commitReceipt.status !== 1) throw new Error(`commit reverted on-chain in ${commitTx.hash}`);
      console.log(`[${decision.jurorName}] commit confirmed, status 1`);

      decision.salt = salt;
      decision.commitment = commitment;
      decision.stakeHbar = stakeHbar;
      decision.commitTxHash = commitTx.hash;
      persistCommit(caseId.toString(), decision);
      console.log(`[${decision.jurorName}] commit state persisted to ${commitStatePath(caseId.toString())}`);
    }

    decisions.push(decision);

    recordTrail({
      caseId: String(caseId),
      jurorId: decision.jurorId,
      jurorName: decision.jurorName,
      outcome: declined ? 'declined' : 'committed',
      selectedOutcome: decision.selectedOutcome,
      confidenceBps,
      totalSpent: decision.totalSpent,
      toolCalls: investigation.evidenceTrail.toolCalls,
      reasoning: investigation.evidenceTrail.reasoning,
      stopReason: investigation.evidenceTrail.stopReason,
      finalAnalysis: investigation.evidenceTrail.finalAnalysis,
      commitTxHash: decision.commitTxHash || null,
    });
  }

  // --- phase 2: wait for the real on-chain commit deadline to pass ---
  const nowSec = () => Math.floor(Date.now() / 1000);
  const waitSec = commitDeadlineSec - nowSec() + 5; // small margin past the deadline
  if (waitSec > 0) {
    console.log(`\nWaiting ${waitSec}s for the on-chain commit deadline to pass before revealing...`);
    await sleep(waitSec * 1000);
  }

  // --- phase 3: reveal for every juror that committed ---
  const committed = decisions.filter(d => !d.declined);
  for (const decision of committed) {
    const evidenceCid = await pinReasoningTrailToIpfs(
      {
        caseId: caseId.toString(),
        jurorId: decision.jurorId,
        ruling: decision.ruling,
        confidenceBps: decision.confidenceBps,
        evidenceTrail: decision.evidenceTrail,
      },
      `nyaya-case-${caseId}-${decision.jurorId}-reveal`,
    );
    console.log(`\n[${decision.jurorName}] pinned reasoning trail to IPFS: ${evidenceCid}`);

    const jurorSigner = getJurorSigner(decision.juror);
    const resolverAsJuror = getResolverAsSigner(jurorSigner);
    const revealTx = await resolverAsJuror.reveal(caseId, decision.ruling, decision.confidenceBps, decision.salt, evidenceCid);
    console.log(`[${decision.jurorName}] reveal tx ${revealTx.hash}`);
    const revealReceipt = await revealTx.wait();
    if (revealReceipt.status !== 1) throw new Error(`reveal reverted on-chain in ${revealTx.hash}`);
    console.log(`[${decision.jurorName}] reveal confirmed, status 1`);
    decision.evidenceCid = evidenceCid;
    decision.revealTxHash = revealTx.hash;
  }

  // --- summary ---
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  for (const d of decisions) {
    if (d.declined) {
      console.log(`${d.jurorName}: DECLINED (confidence ${d.confidenceBps}bps). Spend ${d.totalSpent} HBAR lost.`);
    } else {
      console.log(`${d.jurorName}: COMMITTED (confidence ${d.confidenceBps}bps, stake ${d.stakeHbar.toFixed(4)} HBAR, ruling ${d.ruling}). ` +
        `commit ${d.commitTxHash} reveal ${d.revealTxHash}`);
    }
  }
  console.log(`\nNext (in packages/contracts, after resolutionTime passes):`);
  console.log(`CASE_ID=${caseId} CASE_TYPE=${caseType} ... npm run resolver:check-outcome`);
  console.log(`CASE_ID=${caseId} npm run resolver:settle`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

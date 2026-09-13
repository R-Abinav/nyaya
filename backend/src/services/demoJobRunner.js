const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

// The spawned scripts (openCase.ts, runResolutionChecker.ts, settleCase.ts) need OPERATOR_PRIVATE_KEY and
// friends from packages/contracts/.env — a real, separate file from backend/.env. Manually running these
// scripts from an interactive shell tonight always had them auto-injected by a shell-level dotenv hook;
// child_process.spawn has no shell hook at all, so without this they fail with "OPERATOR_PRIVATE_KEY is
// not set" (hit for real the first time this ran). dotenv.config() only sets process.env, never prints
// anything, the same mechanism backend/src/config/env.js already uses for backend/.env.
// override: true — dotenv's default is to never override an already-set var, and something in this
// process's ambient environment was shadowing OPERATOR_PRIVATE_KEY with an empty value, which silently
// defeated the plain config() call above. The contracts .env file is the real source of truth here.
require('dotenv').config({ path: path.resolve(__dirname, '../../../packages/contracts/.env'), override: true });

/**
 * Runs the exact real sequence proven live tonight for case 6 — openCase.ts -> runFullCase.js (real agent
 * investigation, real commit/decline, real reveal) -> runResolutionChecker.ts -> settleCase.ts — against a
 * fresh, short-window github-stars case. Every step spawns the SAME real script already used manually
 * tonight; this file only orchestrates and parses their real stdout for job-status polling. Nothing here
 * simulates an outcome — the outcome is whatever the real repo's real star count is when the resolution
 * window opens.
 *
 * Real, pre-verified repos only (facebook/react returned "Moved Permanently" when tried unverified earlier
 * tonight — that mistake is why this list is checked once, here, rather than accepting an arbitrary owner/
 * repo from a request body).
 */
const DEMO_CASE_POOL = [
  { owner: 'torvalds', repo: 'linux', threshold: 200_000 },
  { owner: 'microsoft', repo: 'vscode', threshold: 150_000 },
  { owner: 'vercel', repo: 'next.js', threshold: 100_000 },
];

const CONTRACTS_DIR = path.resolve(__dirname, '../../../packages/contracts');
const BACKEND_DIR = path.resolve(__dirname, '../..');

const COMMIT_WINDOW_SECONDS = 300; // 5 minutes for real investigation + commits
const RESOLUTION_WINDOW_SECONDS = 120; // 2 more minutes before the outcome window opens
const BOUNTY_TINYBAR = 50_000_000; // 0.5 HBAR, matches the small real bounties used tonight

const jobs = new Map();

function newJob() {
  const id = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    phase: 'opening', // opening | investigating | awaiting_reveal_window | revealing | awaiting_resolution_window | resolving | settling | settled | failed
    caseId: null,
    caseType: 'github-stars',
    question: null,
    jurorDecisions: [], // { jurorId, jurorName, outcome: 'committed'|'declined', confidenceBps, stake, ruling }
    txHashes: {}, // openCase, commit: {jurorId: hash}, reveal: {jurorId: hash}, submitOutcome, settle
    ruling: null,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    log: [],
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function appendLog(job, line) {
  job.log.push(line);
  if (job.log.length > 500) job.log.shift(); // bounded; this is a demo aid, not an audit log
}

/**
 * Spawns a real script, streams its stdout line-by-line through onLine, resolves on exit 0.
 *
 * A real race hit here: `child.on('close', ...)` can fire before the readline interfaces wrapping its
 * stdout/stderr have finished delivering their last buffered lines — the process's own exit does not wait
 * for the pipe to fully drain into our readline wrappers first. Resolving on `close` alone meant a case's
 * "opened case N" line (the very last line openCase.ts prints) sometimes hadn't been seen yet by the time
 * the caller checked for it, even though the real transaction had already confirmed on-chain. Fixed by
 * waiting for both readline interfaces' own 'close' events too, not just the child's.
 */
function runScript({ command, args, cwd, env, job, onLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    const stderrLines = [];
    let pending = 3; // child close + stdout readline close + stderr readline close
    let exitCode = null;
    let settled = false;

    function maybeFinish() {
      if (--pending > 0 || settled) return;
      settled = true;
      if (exitCode === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${exitCode}: ${stderrLines.slice(-5).join(' | ')}`));
    }

    const stdoutRl = readline.createInterface({ input: child.stdout });
    stdoutRl.on('line', line => {
      appendLog(job, line);
      onLine?.(line);
    });
    stdoutRl.on('close', maybeFinish);

    const stderrRl = readline.createInterface({ input: child.stderr });
    stderrRl.on('line', line => {
      stderrLines.push(line);
      appendLog(job, `[stderr] ${line}`);
    });
    stderrRl.on('close', maybeFinish);

    child.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', code => {
      exitCode = code;
      maybeFinish();
    });
  });
}

async function runDemoCase(job) {
  const pick = DEMO_CASE_POOL[Math.floor(Math.random() * DEMO_CASE_POOL.length)];
  const nowSec = Math.floor(Date.now() / 1000);
  const commitDeadline = nowSec + COMMIT_WINDOW_SECONDS;
  const resolutionTime = commitDeadline + RESOLUTION_WINDOW_SECONDS;
  const question = `Will ${pick.owner}/${pick.repo} have at least ${pick.threshold} stars by the resolution time?`;
  job.question = question;

  // --- phase: opening ---
  job.phase = 'opening';
  await runScript({
    command: 'npx',
    args: ['tsx', 'script/resolver/openCase.ts'],
    cwd: CONTRACTS_DIR,
    env: {
      CASE_TYPE: 'github-stars',
      CASE_QUESTION: question,
      COMMIT_DEADLINE: String(commitDeadline),
      RESOLUTION_TIME: String(resolutionTime),
      BOUNTY_TINYBAR: String(BOUNTY_TINYBAR),
    },
    job,
    onLine: line => {
      const openedMatch = line.match(/^opened case (\d+)/);
      if (openedMatch) job.caseId = openedMatch[1];
      const txMatch = line.match(/sending openCase\s+tx (0x[0-9a-fA-F]+)/);
      if (txMatch) job.txHashes.openCase = txMatch[1];
    },
  });
  if (!job.caseId) throw new Error('openCase.ts finished without a parseable case id in its output.');

  // --- phase: investigating -> awaiting_reveal_window -> revealing (all inside runFullCase.js) ---
  job.phase = 'investigating';
  await runScript({
    command: 'node',
    args: ['scripts/runFullCase.js'],
    cwd: BACKEND_DIR,
    env: { CASE_ID: job.caseId, CASE_QUESTION: question },
    job,
    onLine: line => {
      if (/^Waiting \d+s for the on-chain commit deadline/.test(line)) job.phase = 'awaiting_reveal_window';
      const commitMatch = line.match(/^\[The (\w+)\] COMMITTING — confidence (\d+)bps.*stake ([\d.]+) HBAR/);
      if (commitMatch) {
        job.phase = 'investigating';
        job.jurorDecisions.push({ jurorName: `The ${commitMatch[1]}`, outcome: 'committed', confidenceBps: Number(commitMatch[2]), stakeHbar: Number(commitMatch[3]) });
      }
      const declineMatch = line.match(/^\[The (\w+)\] DECLINED — confidence (\d+)bps/);
      if (declineMatch) {
        job.jurorDecisions.push({ jurorName: `The ${declineMatch[1]}`, outcome: 'declined', confidenceBps: Number(declineMatch[2]) });
      }
      const revealTxMatch = line.match(/^\[The (\w+)\] reveal tx (0x[0-9a-fA-F]+)/);
      if (revealTxMatch) {
        job.phase = 'revealing';
        job.txHashes.reveal = job.txHashes.reveal || {};
        job.txHashes.reveal[revealTxMatch[1]] = revealTxMatch[2];
      }
    },
  });

  // --- phase: awaiting_resolution_window ---
  job.phase = 'awaiting_resolution_window';
  const waitMs = (resolutionTime - Math.floor(Date.now() / 1000) + 5) * 1000;
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));

  // --- phase: resolving ---
  job.phase = 'resolving';
  await runScript({
    command: 'npx',
    args: ['tsx', 'script/resolver/runResolutionChecker.ts'],
    cwd: CONTRACTS_DIR,
    env: {
      CASE_ID: job.caseId,
      CASE_TYPE: 'github-stars',
      REPO_OWNER: pick.owner,
      REPO_NAME: pick.repo,
      REPO_STAR_THRESHOLD: String(pick.threshold),
    },
    job,
    onLine: line => {
      const rulingMatch = line.match(/^ruling (\d+)/);
      if (rulingMatch) job.ruling = Number(rulingMatch[1]);
      const txMatch = line.match(/^submitOutcome tx (0x[0-9a-fA-F]+)/);
      if (txMatch) job.txHashes.submitOutcome = txMatch[1];
    },
  });

  // --- phase: settling ---
  job.phase = 'settling';
  await runScript({
    command: 'npx',
    args: ['tsx', 'script/resolver/settleCase.ts'],
    cwd: CONTRACTS_DIR,
    env: { CASE_ID: job.caseId },
    job,
    onLine: line => {
      const txMatch = line.match(/^settle tx (0x[0-9a-fA-F]+)/);
      if (txMatch) job.txHashes.settle = txMatch[1];
    },
  });

  job.phase = 'settled';
  job.completedAt = new Date().toISOString();
}

function startDemoJob() {
  const job = newJob();
  runDemoCase(job).catch(error => {
    job.phase = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();
  });
  return job;
}

module.exports = { startDemoJob, getJob, DEMO_CASE_POOL };

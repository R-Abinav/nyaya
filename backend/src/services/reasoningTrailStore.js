const fs = require('fs');
const path = require('path');

/**
 * Reasoning trail store
 *
 * Persists each juror's full investigation trail per case so the frontend can read it back later via a
 * GET endpoint, as structured data — not just a log line. This matters most for a declined case: the
 * agent spent real evidence money via withdrawForEvidence but chose not to commit because confidence
 * stayed below CONFIDENCE_THRESHOLD_BPS, and that decision needs to be auditable (what it found, every
 * tool call, why it stopped, why confidence stayed low), not silently dropped once the HTTP response for
 * the investigation request has been sent.
 *
 * File-backed, not pure in-memory: the demo-trigger job (demoJobRunner.js) runs runFullCase.js as a
 * SEPARATE child process — its own recordTrail() calls happen in a different process's memory, which an
 * in-memory Map in the main server process can never see. Discovered for real while wiring the frontend's
 * juror detail page (its reasoning pipeline would have silently shown nothing for any demo-triggered
 * case). A shared JSON file, re-read fresh on every call the same way deployments/hedera.json already is
 * elsewhere in this project, is what actually lets both processes see the same real data.
 */
const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'reasoning-trails.json');

function readStore() {
  if (!fs.existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {}; // a partial write mid-crash is recoverable by just starting fresh, not worth failing a read over
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // BigInt-safe: caseId can arrive as a BigInt from callers close to ethers — the same class of bug hit
  // twice already tonight in logger.js and agentPinata.js.
  const json = JSON.stringify(store, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
  fs.writeFileSync(STORE_FILE, json);
}

function keyFor(caseId, jurorId) {
  return `${caseId}:${jurorId}`;
}

function recordTrail(entry) {
  const store = readStore();
  const key = keyFor(entry.caseId, entry.jurorId);
  const record = { ...entry, recordedAt: new Date().toISOString() };
  store[key] = record;
  writeStore(store);
  return record;
}

function getTrail(caseId, jurorId) {
  const store = readStore();
  return store[keyFor(caseId, jurorId)] || null;
}

function getTrailsForCase(caseId) {
  const store = readStore();
  const caseIdStr = String(caseId);
  return Object.values(store).filter(trail => String(trail.caseId) === caseIdStr);
}

module.exports = {
  recordTrail,
  getTrail,
  getTrailsForCase,
};

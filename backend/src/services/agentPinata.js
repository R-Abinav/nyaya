const { AGENT_PINATA_JWT } = require('../config/env');

/**
 * Pins the juror agent's own reveal-time reasoning trail to IPFS, using the agent's own Pinata key
 * (AGENT_PINATA_JWT) — deliberately separate from the operator's own key (OPERATOR_PINATA_JWT, in
 * packages/contracts/.env, used by the resolution-checker to pin ground-truth evidence). Confirmed
 * isolated: backend/.env only ever exposes the AGENT_ vars, packages/contracts/.env only ever exposes the
 * OPERATOR_ vars.
 *
 * Uses Pinata's v3 file-upload API, the same one the operator's own pinning helper uses
 * (packages/contracts/script/resolver/pinataOperator.ts) — the legacy pinning/pinJSONToIPFS endpoint is
 * scope-blocked for the operator's key; using v3 here too for the same reason, and for consistency.
 *
 * Per .claude/rules/agent.md: pin only after the commit deadline, never before — a CID pinned during the
 * commit phase could be found by others and would leak the ruling.
 */
async function pinReasoningTrailToIpfs(data, name) {
  if (!AGENT_PINATA_JWT) throw new Error('AGENT_PINATA_JWT is not set in backend/.env.');

  // caseId (and other on-chain values threaded through the evidence trail) are real BigInts — the same
  // class of bug already hit once tonight in logger.js. JSON.stringify throws on a bare BigInt natively.
  const json = JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
  const body = new FormData();
  body.append('file', new Blob([json], { type: 'application/json' }), `${name}.json`);
  body.append('network', 'public');

  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${AGENT_PINATA_JWT}` },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata v3 file upload failed: ${response.status} ${text}`);
  }

  const parsed = await response.json();
  if (!parsed.data?.cid) throw new Error(`Pinata response had no cid: ${JSON.stringify(parsed)}`);
  return parsed.data.cid;
}

module.exports = { pinReasoningTrailToIpfs };

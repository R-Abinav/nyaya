/**
 * Pins the resolution-checker's raw evidence to IPFS using the OPERATOR's own Pinata key
 * (`OPERATOR_PINATA_JWT` in packages/contracts/.env) — deliberately separate from the juror agent's own
 * Pinata key (`AGENT_PINATA_JWT`, in backend/.env, used to pin its reasoning trail). Confirmed isolated:
 * packages/contracts/.env only ever exposes the OPERATOR_ vars, backend/.env only ever exposes the AGENT_
 * vars; neither side can read the other's key.
 */
/**
 * Uses Pinata's newer v3 file-upload API (`uploads.pinata.cloud/v3/files`), not the legacy
 * `pinning/pinJSONToIPFS` endpoint: the operator's real key authenticates fine against both (confirmed via
 * Pinata's own `/data/testAuthentication`) but returns `403 NO_SCOPES_FOUND` specifically on the legacy
 * pinning endpoint — a real scope-configuration gap on Pinata's side for this key, not a bug here. v3
 * works with the same key. Verified the pin is real and durable via Pinata's own `/v3/files/public?cid=`
 * lookup (`expires_at: null`), not just trusted from the upload response.
 */
export async function pinJsonToIpfs(data: unknown, name: string): Promise<string> {
  const jwt = process.env.OPERATOR_PINATA_JWT;
  if (!jwt) throw new Error("OPERATOR_PINATA_JWT is not set in packages/contracts/.env.");

  // Defensive: any BigInt anywhere in `data` (a caseId, a raw on-chain read) would otherwise throw here —
  // the exact bug hit in the agent-side equivalent of this helper (backend/src/services/agentPinata.js).
  const json = JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  const body = new FormData();
  body.append("file", new Blob([json], { type: "application/json" }), `${name}.json`);
  body.append("network", "public");

  const response = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata v3 file upload failed: ${response.status} ${text}`);
  }

  const parsed = (await response.json()) as { data?: { cid?: string } };
  if (!parsed.data?.cid) throw new Error(`Pinata response had no cid: ${JSON.stringify(parsed)}`);
  return parsed.data.cid;
}

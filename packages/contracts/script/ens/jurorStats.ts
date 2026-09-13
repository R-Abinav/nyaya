/**
 * Real, on-chain-sourced juror stats for ENS text records — `casesJudged`, `cumulativeReturnBps`,
 * `lastCaseId`, and the static `persona`. All four are operator-only writes (see roles.ts's
 * OPERATOR_ONLY_TEXT_KEYS): the operator already holds SET_TEXT at ROOT_RESOURCE on the resolver (part 3),
 * which cascades to any resource including these new keys — no new EAC grant needed, and the juror's own
 * key is never granted anything on them, the same boundary 6_configureEac.ts/roles.ts already establish
 * for `score`/`returnRate`.
 *
 * Shared by the one-off populate script (populateJurorEnsStats.ts) and by relaySettlement.ts's ongoing
 * hook, so a future settlement updates these records the same way it already updates the anchor — not a
 * separate step someone has to remember to re-run.
 */
import { Contract, Interface, namehash, type JsonRpcProvider, type Wallet } from "ethers";
import { JUROR_LABELS } from "./ensConfig.js";

export type JurorLabel = (typeof JUROR_LABELS)[number];

/** The juror's real name and actual system-prompt-level identity (backend/src/config/jurors.js) — not a
 *  placeholder. Static; written once, never touched by the ongoing settlement hook. */
export const PERSONA_BY_LABEL: Record<JurorLabel, string> = {
  "juror-a":
    "The Skeptic — demands high-quality, cross-verified evidence before ruling; distrusts single sources; only stakes high when multiple independent articles align.",
  "juror-b":
    "The Pragmatist — seeks the optimal evidence-to-cost ratio; balances thoroughness with efficiency; stops once evidence is good enough rather than exhaustive.",
  "juror-c":
    "The Maverick — trusts pattern recognition and early signals; makes bold, decisive calls even on limited evidence; willing to stake high on strong conviction.",
};

/** Same bound used in backend/src/config/contracts.js's getCaseType: comfortably under Hashio's ~7-day
 *  eth_getLogs range limit, generous for this project's whole real testnet history so far. */
const SETTLEMENT_LOOKBACK_BLOCKS = 200_000;

const JUROR_SETTLED_ABI = [
  "event JurorSettled(uint256 indexed caseId, address indexed juror, uint8 result, uint256 stake, uint256 x402Spend, uint256 reward, int256 net, uint256 capital)",
  "function returnBps(address juror) view returns (int256)",
];

export type JurorOnChainStats = {
  casesJudged: number;
  lastCaseId: bigint | null;
  cumulativeReturnBps: bigint;
};

/** Reads real settlement history for one juror off the live Hedera resolver — never hardcoded. `casesJudged`
 *  is the count of real JurorSettled events for this address; `lastCaseId` is the highest caseId among
 *  them; `cumulativeReturnBps` is exactly what JurorShareMarket's own pricing reads. */
export async function getJurorOnChainStats(hederaProvider: JsonRpcProvider, resolverAddress: string, jurorAddress: string): Promise<JurorOnChainStats> {
  const resolver = new Contract(resolverAddress, JUROR_SETTLED_ABI, hederaProvider);
  const latestBlock = await hederaProvider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - SETTLEMENT_LOOKBACK_BLOCKS);
  const logs = await resolver.queryFilter(resolver.filters.JurorSettled(null, jurorAddress), fromBlock, latestBlock);
  const caseIds = logs.map((log) => (log as unknown as { args: { caseId: bigint } }).args.caseId);
  const cumulativeReturnBps = (await resolver.returnBps(jurorAddress)) as bigint;
  return {
    casesJudged: caseIds.length,
    lastCaseId: caseIds.length > 0 ? caseIds.reduce((a, b) => (b > a ? b : a)) : null,
    cumulativeReturnBps,
  };
}

const PERMISSIONED_RESOLVER_SET_TEXT_ABI = ["function setText(bytes32 node, string key, string value) external"];

/**
 * Writes the three dynamic stats (never `persona`, which is static and written separately) to a juror's
 * Sepolia subname, from real Hedera on-chain history. Returns each write's real tx hash. `namehash`, not
 * `dnsEncode` + a labelhash: EAC checks and setText both key off the full DNS namehash of the whole name
 * (see .claude/rules/contracts.md's ENS section) — same computation verifyEacState.ts already uses.
 */
export async function writeJurorDynamicStats(
  sepoliaProvider: JsonRpcProvider,
  sepoliaOperator: Wallet,
  resolverAddress: string,
  label: JurorLabel,
  stats: JurorOnChainStats,
  send: (label: string, tx: { to: string; data: string }, gasLimit: bigint) => Promise<{ hash: string }>,
): Promise<{ casesJudgedTx: string; cumulativeReturnBpsTx: string; lastCaseIdTx: string }> {
  const fullName = `${label}.nyaya.eth`;
  const node = namehash(fullName);
  const iface = new Interface(PERMISSIONED_RESOLVER_SET_TEXT_ABI);
  const GAS = 150_000n;

  const casesJudgedReceipt = await send(
    `setText(${fullName}, "casesJudged", "${stats.casesJudged}")`,
    { to: resolverAddress, data: iface.encodeFunctionData("setText", [node, "casesJudged", String(stats.casesJudged)]) },
    GAS,
  );
  const cumulativeReturnBpsReceipt = await send(
    `setText(${fullName}, "cumulativeReturnBps", "${stats.cumulativeReturnBps}")`,
    { to: resolverAddress, data: iface.encodeFunctionData("setText", [node, "cumulativeReturnBps", stats.cumulativeReturnBps.toString()]) },
    GAS,
  );
  const lastCaseIdReceipt = await send(
    `setText(${fullName}, "lastCaseId", "${stats.lastCaseId ?? ""}")`,
    { to: resolverAddress, data: iface.encodeFunctionData("setText", [node, "lastCaseId", stats.lastCaseId?.toString() ?? ""]) },
    GAS,
  );

  return {
    casesJudgedTx: casesJudgedReceipt.hash,
    cumulativeReturnBpsTx: cumulativeReturnBpsReceipt.hash,
    lastCaseIdTx: lastCaseIdReceipt.hash,
  };
}

/** `persona` is static and never touched by the ongoing settlement hook — written once (idempotent to
 *  re-run: setText has no "already set" guard, so re-running just rewrites the same value). */
export async function writeJurorPersona(
  resolverAddress: string,
  label: JurorLabel,
  send: (label: string, tx: { to: string; data: string }, gasLimit: bigint) => Promise<{ hash: string }>,
): Promise<string> {
  const fullName = `${label}.nyaya.eth`;
  const node = namehash(fullName);
  const iface = new Interface(PERMISSIONED_RESOLVER_SET_TEXT_ABI);
  // A real failure hit here first: 150_000n (fine for the short numeric fields below) undershot for this
  // much longer string — gasUsed came back at 146,498 against that limit, an out-of-gas revert with no
  // decodable reason (confirmed by replaying the exact call as eth_call, which succeeds with no gas cap).
  const receipt = await send(
    `setText(${fullName}, "persona", ...)`,
    { to: resolverAddress, data: iface.encodeFunctionData("setText", [node, "persona", PERSONA_BY_LABEL[label]]) },
    400_000n,
  );
  return receipt.hash;
}

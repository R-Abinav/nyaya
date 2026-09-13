/**
 * Step 11: relay one already-settled Hedera case's Verdict + ReturnCheckpoint to the Sepolia anchor.
 *
 * Manually invoked, proving the anchor works end to end against real data on both chains — not a watcher.
 * Reuses an existing settled case rather than opening a fresh one: defaults to the step-6 case (case 1,
 * juror A), the one already fully evidenced in docs/TESTNET-EVIDENCE.md. Override with HEDERA_CASE_ID /
 * HEDERA_JUROR / HEDERA_SETTLE_TX to relay a different one.
 *
 * Reads the settle transaction's own receipt rather than a ranged `eth_getLogs` query: Hashio (Hedera's
 * relay) rejects any topic-filtered log query spanning more than 7 days, which this project's whole
 * testnet history already exceeds. A single transaction's receipt has no such limit.
 *
 * `ruling` is read live from `commitments(caseId, juror)`, not inferred from the settle event: JurorSettled
 * doesn't carry the juror's own ruling, only whether it matched the outcome. If the juror never revealed,
 * `revealed` is false and Ruling.None is what gets relayed, regardless of whatever hash or salt-bound value
 * sits in that commitment's storage — an unrevealed commitment's content is never leaked here.
 *
 * `cumulativeNet`/`cumulativeCapital` are read live from the resolver. They are only a correct "checkpoint
 * right after this case" if no later case has also settled for this juror. That's checked here, not
 * assumed: every case after HEDERA_CASE_ID is checked for a commitment from this juror, and the script
 * refuses to relay a checkpoint it can't vouch for.
 */
import { Interface } from "ethers";
import {
  artifactAbi,
  assertFunctionsExist,
  contract,
  decodeLog,
  hederaDeployments,
  hederaProvider,
  send,
  sepoliaAnchorAddress,
  sepoliaSigner,
} from "./anchorConfig.js";

const GAS = { recordVerdict: 150_000n, recordReturnCheckpoint: 120_000n } as const;

// Defaults: the step-6 case, already fully evidenced (docs/TESTNET-EVIDENCE.md).
const DEFAULT_CASE_ID = "1";
const DEFAULT_JUROR = "0xAD93109d571E527aA51Cc56A8E0682862866A69c";
const DEFAULT_SETTLE_TX = "0xd455896bc62dde24b9d9e8592e60f56e9a8fe9a610ccdfb5238d0f2b980843f5";

async function main() {
  const caseId = BigInt(process.env.HEDERA_CASE_ID ?? DEFAULT_CASE_ID);
  const juror = process.env.HEDERA_JUROR ?? DEFAULT_JUROR;
  const settleTx = process.env.HEDERA_SETTLE_TX ?? DEFAULT_SETTLE_TX;

  const hedera = hederaProvider();
  const resolverAddress = hederaDeployments().contracts.NyayaResolver;
  if (!resolverAddress) throw new Error("No NyayaResolver in deployments/hedera.json");
  const resolverAbi = artifactAbi("NyayaResolver");
  assertFunctionsExist(resolverAbi, ["commitments", "cumulativeNet", "cumulativeCapital", "caseCount"], "NyayaResolver");
  const resolverIface = new Interface(resolverAbi as never);
  const resolver = contract(resolverAddress, resolverAbi, hedera);

  console.log(`Reading Hedera settle tx ${settleTx} for case ${caseId}, juror ${juror}...`);
  const receipt = await hedera.getTransactionReceipt(settleTx);
  if (!receipt) throw new Error(`No receipt for ${settleTx} on Hedera`);

  const settled = decodeLog<{
    name: "JurorSettled";
    args: { caseId: bigint; juror: string; result: bigint; stake: bigint; x402Spend: bigint; net: bigint };
  }>(receipt, resolverIface, "JurorSettled");
  if (settled.args.caseId !== caseId || settled.args.juror.toLowerCase() !== juror.toLowerCase()) {
    throw new Error(
      `${settleTx}'s JurorSettled event is for case ${settled.args.caseId}, juror ${settled.args.juror}, not the requested case ${caseId}, juror ${juror}.`,
    );
  }
  const { result, stake, x402Spend, net } = settled.args;
  console.log(`  JurorSettled: result=${result} stake=${stake} x402Spend=${x402Spend} net=${net}`);

  const commitment = (await resolver.commitments(caseId, juror)) as { revealed: boolean; ruling: bigint };
  const ruling = commitment.revealed ? commitment.ruling : 0n; // 0 = Ruling.None
  console.log(`  commitments(${caseId}, juror): revealed=${commitment.revealed} ruling=${ruling}`);

  // Confirm this really is the juror's most recent settlement, so the live cumulative totals are a valid
  // checkpoint for THIS case and not one that happened later. A later case only matters here if it was
  // actually settled or cancelled for this juror — cumulativeNet/cumulativeCapital are only touched by
  // `_record()`, which runs on settlement or cancellation, never on a bare commit. A later case this juror
  // merely committed to (or never even touched) doesn't move the totals at all.
  //
  // This reads `cases(caseId)` with a LEGACY 7-field ABI fragment, not the current-source artifact's ABI:
  // the deployed resolver at this address predates step 9's `bountySource` field on the Case struct (see
  // the defect note in docs/ARCHITECTURE.md), so decoding its return data with the current 8-field ABI
  // corrupts every field after `resolutionTime` — discovered by exactly that failure the first time this
  // ran. Using the artifact ABI for a function whose on-chain shape has since changed is the same class of
  // bug the project's other ABI rules exist to prevent, just one direction newer: forward-incompatible,
  // not just hand-transcribed.
  const legacyCasesAbi = [
    "function cases(uint256) view returns (address opener, uint64 commitDeadline, uint64 resolutionTime, uint8 outcome, bool settled, bool cancelled, uint256 bounty)",
  ];
  const legacyResolver = contract(resolverAddress, legacyCasesAbi, hedera);
  const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000".slice(0, 66);
  const caseCount = (await resolver.caseCount()) as bigint;
  for (let c = caseId + 1n; c <= caseCount; c++) {
    const later = (await resolver.commitments(c, juror)) as { hash: string };
    if (later.hash === ZERO_HASH) continue; // juror never touched this case at all
    const laterCase = (await legacyResolver.cases(c)) as { settled: boolean; cancelled: boolean };
    if (laterCase.settled || laterCase.cancelled) {
      throw new Error(
        `Juror ${juror} also has a commitment on case ${c} (after case ${caseId}), and that case is ${laterCase.settled ? "settled" : "cancelled"}. The live cumulative totals reflect that later case too, so relaying them as "the checkpoint after case ${caseId}" would not be honest. Relay case ${c} instead.`,
      );
    }
    console.log(`  case ${c} has a commitment from this juror but is neither settled nor cancelled yet — doesn't affect the totals.`);
  }
  console.log(`  confirmed: no later settled/cancelled case touched this juror's cumulative totals; live totals are safe to relay.`);

  const cumulativeNet = (await resolver.cumulativeNet(juror)) as bigint;
  const cumulativeCapital = (await resolver.cumulativeCapital(juror)) as bigint;
  console.log(`  cumulativeNet=${cumulativeNet} cumulativeCapital=${cumulativeCapital}`);

  const { provider, operator } = sepoliaSigner();
  const anchorAddress = sepoliaAnchorAddress();
  const anchorAbi = artifactAbi("NyayaAnchor");
  assertFunctionsExist(anchorAbi, ["recordVerdict", "recordReturnCheckpoint"], "NyayaAnchor");
  const anchorIface = new Interface(anchorAbi as never);

  const verdictReceipt = await send(
    provider,
    operator,
    "recordVerdict",
    {
      to: anchorAddress,
      data: anchorIface.encodeFunctionData("recordVerdict", [caseId, juror, result, ruling, stake, x402Spend, net]),
    },
    GAS.recordVerdict,
  );

  const checkpointReceipt = await send(
    provider,
    operator,
    "recordReturnCheckpoint",
    {
      to: anchorAddress,
      data: anchorIface.encodeFunctionData("recordReturnCheckpoint", [caseId, juror, cumulativeNet, cumulativeCapital]),
    },
    GAS.recordReturnCheckpoint,
  );

  console.log(`\nRelayed case ${caseId}, juror ${juror} to the Sepolia anchor at ${anchorAddress}.`);
  console.log(`  Verdict tx:           ${verdictReceipt.hash}`);
  console.log(`  ReturnCheckpoint tx:  ${checkpointReceipt.hash}`);
  console.log(`  Mirrors Hedera settle tx: ${settleTx}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

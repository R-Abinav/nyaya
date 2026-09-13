/**
 * One-off: populates each juror subname's new ENS text records — persona, casesJudged,
 * cumulativeReturnBps, lastCaseId — from real on-chain history (tonight's two real settled cases, 4 and 6),
 * not zeros or placeholders. All operator-only writes; the juror's own key is never touched (see
 * jurorStats.ts's header comment for why no new EAC grant is needed).
 *
 * Going forward, casesJudged/cumulativeReturnBps/lastCaseId update automatically every time
 * relaySettlement.ts relays a real settlement — this script only needs to run once, for the persona field
 * and to backfill tonight's two already-settled cases before the relay hook existed.
 *
 * Run: set -a; source .env; set +a && npx tsx script/ens/populateJurorEnsStats.ts
 */
import { hederaDeployments, hederaProvider } from "../anchor/anchorConfig.js";
import { connect, JUROR_LABELS, readDeployments, send } from "./ensConfig.js";
import { getJurorOnChainStats, writeJurorDynamicStats, writeJurorPersona, type JurorLabel } from "./jurorStats.js";

async function main() {
  const { provider: sepoliaProvider, operator: sepoliaOperator } = connect();
  const d = readDeployments();
  const resolverAddress = d.contracts?.PermissionedResolver;
  if (!resolverAddress) throw new Error("No PermissionedResolver recorded in deployments/sepolia.json");

  const hedera = hederaProvider();
  const hederaResolverAddress = hederaDeployments().contracts.NyayaResolver;
  if (!hederaResolverAddress) throw new Error("No NyayaResolver in deployments/hedera.json");

  const jurors: Record<JurorLabel, string | undefined> = {
    "juror-a": d.jurorA,
    "juror-b": d.jurorB,
    "juror-c": d.jurorC,
  };

  const sendFn = (label: string, tx: { to: string; data: string }, gasLimit: bigint) =>
    send(sepoliaProvider, sepoliaOperator, label, tx, gasLimit);

  for (const label of JUROR_LABELS) {
    const jurorAddress = jurors[label];
    if (!jurorAddress) throw new Error(`No address recorded for ${label} in deployments/sepolia.json`);

    console.log(`\n=== ${label}.nyaya.eth (${jurorAddress}) ===`);

    const stats = await getJurorOnChainStats(hedera, hederaResolverAddress, jurorAddress);
    console.log(`  real on-chain stats: casesJudged=${stats.casesJudged} lastCaseId=${stats.lastCaseId} cumulativeReturnBps=${stats.cumulativeReturnBps}`);

    const personaTx = await writeJurorPersona(resolverAddress, label, sendFn);
    console.log(`  persona tx: ${personaTx}`);

    const { casesJudgedTx, cumulativeReturnBpsTx, lastCaseIdTx } = await writeJurorDynamicStats(
      sepoliaProvider,
      sepoliaOperator,
      resolverAddress,
      label,
      stats,
      sendFn,
    );
    console.log(`  casesJudged tx: ${casesJudgedTx}`);
    console.log(`  cumulativeReturnBps tx: ${cumulativeReturnBpsTx}`);
    console.log(`  lastCaseId tx: ${lastCaseIdTx}`);
  }

  console.log("\nAll three subnames populated with real, on-chain-sourced demo metadata.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

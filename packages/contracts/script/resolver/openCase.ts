/**
 * Open a real case on the live NyayaResolver, on Hedera testnet.
 *
 * This exists because the resolver has no on-chain getter for a case's caseType — it's an event-only
 * field, emitted once in CaseOpened and never written to the Case struct (confirmed by reading
 * NyayaResolver.sol's Case struct directly). Closing backend/'s item-4 gap (the investigate endpoint must
 * read a case's real caseType instead of defaulting) needs at least one real, non-general-news case to
 * read back, and this is also the first building block the resolution-checker will need next: opening
 * cases is not currently wrapped in any reusable script.
 *
 * Run: set -a; source .env; set +a && npx tsx script/resolver/openCase.ts
 * Env:
 *   CASE_TYPE          default "rocket-launch"
 *   CASE_QUESTION      default a real Launch Library 2 launch (see below)
 *   COMMIT_DEADLINE    unix seconds, default now + 3600
 *   RESOLUTION_TIME    unix seconds, default now + 21600 (must be > COMMIT_DEADLINE)
 *   BOUNTY_TINYBAR     default 100_000_000 (1 HBAR), attached as msg.value
 */
import {
  artifactAbi,
  assertFunctionsExist,
  connect,
  hbar,
  readDeployments,
  requireContract,
  tinybarToWeibar,
} from "../ats/atsConfig.js";
import { Contract, type InterfaceAbi } from "ethers";

const OPERATOR_HEADROOM = 5n * 100_000_000n; // gas headroom on top of the bounty, in tinybar

async function main() {
  const { provider, operator } = connect();
  const deployments = readDeployments();
  const resolverAddress = requireContract(deployments, "NyayaResolver");
  const abi = artifactAbi("NyayaResolver");
  assertFunctionsExist(abi as { type: string; name?: string }[], ["openCase", "caseCount"], "NyayaResolver");

  const nowSec = Math.floor(Date.now() / 1000);
  const caseType = process.env.CASE_TYPE ?? "rocket-launch";
  const question =
    process.env.CASE_QUESTION ??
    "Will Launch Library 2 launch ad358a4d-c541-409b-9366-9c2f2da4aeb9 (Falcon 9 Block 5 | O3b mPower 11-13, " +
      "pad 80 Space Launch Complex 40, scheduled window start 2026-09-13T18:49:00Z) scrub before its scheduled window closes?";
  const commitDeadline = BigInt(process.env.COMMIT_DEADLINE ?? nowSec + 3600);
  const resolutionTime = BigInt(process.env.RESOLUTION_TIME ?? nowSec + 21600);
  const bountyTinybar = BigInt(process.env.BOUNTY_TINYBAR ?? 100_000_000);

  if (resolutionTime <= commitDeadline) {
    throw new Error(`resolutionTime (${resolutionTime}) must be after commitDeadline (${commitDeadline}).`);
  }

  const operatorBalance = await provider.getBalance(operator.address);
  const required = tinybarToWeibar(bountyTinybar + OPERATOR_HEADROOM);
  if (operatorBalance < required) {
    throw new Error(
      `Operator ${operator.address} holds ${hbar(operatorBalance / 10_000_000_000n)}, but this run needs about ` +
        `${hbar(bountyTinybar + OPERATOR_HEADROOM)} (${hbar(bountyTinybar)} bounty plus ${hbar(OPERATOR_HEADROOM)} gas headroom). ` +
        `Top up from the Hedera testnet faucet and re-run; nothing has been sent yet.`,
    );
  }

  console.log(`resolver          ${resolverAddress}`);
  console.log(`caseType          ${caseType}`);
  console.log(`question          ${question}`);
  console.log(`commitDeadline    ${commitDeadline} (${new Date(Number(commitDeadline) * 1000).toISOString()})`);
  console.log(`resolutionTime    ${resolutionTime} (${new Date(Number(resolutionTime) * 1000).toISOString()})`);
  console.log(`bounty            ${hbar(bountyTinybar)}`);

  const resolver = new Contract(resolverAddress, abi as InterfaceAbi, operator);
  const tx = await resolver.openCase(caseType, question, commitDeadline, resolutionTime, {
    value: tinybarToWeibar(bountyTinybar),
  });
  console.log(`\nsending openCase  tx ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error(`openCase reverted on-chain in ${tx.hash}. Check HashScan for the real revert reason.`);
  }

  const parsed = receipt.logs
    .map((log: { topics: string[]; data: string }) => {
      try {
        return resolver.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((entry: { name: string } | null) => entry?.name === "CaseOpened");
  const caseId: bigint | undefined = parsed?.args?.caseId;
  if (caseId === undefined) throw new Error(`No CaseOpened event found in tx ${tx.hash}`);

  console.log(`\nopened case ${caseId}  tx ${tx.hash}`);
  console.log(`\nVerify: cast call ${resolverAddress} "cases(uint256)" ${caseId} --rpc-url $HEDERA_RPC_URL`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

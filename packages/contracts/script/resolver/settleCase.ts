/**
 * Calls NyayaResolver.settle(caseId) — permissionless, callable by anyone once an outcome has been
 * submitted (see runResolutionChecker.ts). Reuses the operator wallet already connected by atsConfig.ts's
 * connect() for convenience; any funded signer would work equally well here.
 *
 * Run: set -a; source .env; set +a && CASE_ID=3 npx tsx script/resolver/settleCase.ts
 */
import { Contract, type InterfaceAbi } from "ethers";
import { artifactAbi, assertFunctionsExist, connect, readDeployments, requireContract } from "../ats/atsConfig.js";

async function main() {
  const caseIdEnv = process.env.CASE_ID;
  if (!caseIdEnv) throw new Error("CASE_ID is required.");
  const caseId = BigInt(caseIdEnv);

  const { operator } = connect();
  const deployments = readDeployments();
  const resolverAddress = requireContract(deployments, "NyayaResolver");
  const abi = artifactAbi("NyayaResolver");
  assertFunctionsExist(abi as { type: string; name?: string }[], ["settle", "cases"], "NyayaResolver");
  const resolver = new Contract(resolverAddress, abi as InterfaceAbi, operator);

  console.log(`settling case ${caseId} on resolver ${resolverAddress}...`);
  const tx = await resolver.settle(caseId);
  console.log(`settle tx ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`settle reverted on-chain in ${tx.hash}.`);
  console.log(`settle confirmed, status 1`);

  const parsed = receipt.logs
    .map((log: { topics: string[]; data: string }) => {
      try {
        return resolver.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((entry: { name: string } | null) => entry?.name === "CaseSettled");
  if (parsed) {
    console.log(`CaseSettled: outcome=${parsed.args.outcome} pool=${parsed.args.pool} correctStake=${parsed.args.correctStake} ` +
      `remainderToCaseBountyTreasury=${parsed.args.remainderToCaseBountyTreasury} rolledIn=${parsed.args.rolledIn} rolledOut=${parsed.args.rolledOut}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

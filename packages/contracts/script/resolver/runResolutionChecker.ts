/**
 * Determines a case's real outcome (resolutionChecker.ts, reusing evidenceService.js's existing live
 * calls), pins the raw evidence to IPFS via the operator's own Pinata key (pinataOperator.ts — separate
 * from the agent's own key, used for its reasoning trail), then submits it on-chain via
 * NyayaResolver.submitOutcome using OPERATOR_PRIVATE_KEY — the same operator identity every other
 * privileged action in this project already uses, no new key needed.
 *
 * A case's caseType and its case-type-specific parameters (which launch, which flight, which repo) are not
 * stored on-chain in any structured form — only the free-text `question` is, inside the CaseOpened event.
 * Parsing that back out reliably would need real NLP for no real benefit here, so this script takes them as
 * explicit parameters, the same way openCase.ts took them when the case was opened. A production system
 * would want structured per-case metadata; noted as a real gap, not silently worked around.
 *
 * Run examples (from packages/contracts, after sourcing .env):
 *   CASE_ID=2 CASE_TYPE=rocket-launch LAUNCH_ID=ad358a4d-c541-409b-9366-9c2f2da4aeb9 npx tsx script/resolver/runResolutionChecker.ts
 *   CASE_ID=3 CASE_TYPE=github-stars REPO_OWNER=torvalds REPO_NAME=linux REPO_STAR_THRESHOLD=200000 npx tsx script/resolver/runResolutionChecker.ts
 *   CASE_ID=4 CASE_TYPE=flight-delay ICAO24=<hex> npx tsx script/resolver/runResolutionChecker.ts
 */
import { Contract, type InterfaceAbi } from "ethers";
import { artifactAbi, assertFunctionsExist, connect, readDeployments, requireContract } from "../ats/atsConfig.js";
import { determineOutcome, type CaseTypeParams } from "./resolutionChecker.js";
import { pinJsonToIpfs } from "./pinataOperator.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this case type.`);
  return value;
}

function buildParams(caseType: string): CaseTypeParams[keyof CaseTypeParams] {
  switch (caseType) {
    case "rocket-launch":
      return { launchId: requireEnv("LAUNCH_ID") };
    case "flight-delay":
      return { icao24: requireEnv("ICAO24") };
    case "github-stars":
      return {
        owner: requireEnv("REPO_OWNER"),
        repo: requireEnv("REPO_NAME"),
        threshold: Number(requireEnv("REPO_STAR_THRESHOLD")),
      };
    default:
      throw new Error(`Unknown CASE_TYPE: ${caseType}. Expected rocket-launch, flight-delay, or github-stars.`);
  }
}

async function main() {
  const caseId = BigInt(requireEnv("CASE_ID"));
  const caseType = requireEnv("CASE_TYPE");
  const params = buildParams(caseType);

  console.log(`case ${caseId}  type ${caseType}`);
  console.log(`params ${JSON.stringify(params)}`);

  const outcome = await determineOutcome(caseType as keyof CaseTypeParams, params as never);
  console.log(`\nruling ${outcome.ruling} (0=None, 1=No, 2=Yes)`);
  console.log(`singleSourced ${outcome.singleSourced}`);
  if (outcome.singleSourceNote) console.log(`note: ${outcome.singleSourceNote}`);
  console.log(`rawEvidence ${JSON.stringify(outcome.rawEvidence)}`);

  const cid = await pinJsonToIpfs(
    { caseId: caseId.toString(), caseType, determinedAt: new Date().toISOString(), ...outcome },
    `nyaya-case-${caseId}-outcome`,
  );
  console.log(`\npinned evidence to IPFS: ${cid}`);

  const { operator } = connect();
  const deployments = readDeployments();
  const resolverAddress = requireContract(deployments, "NyayaResolver");
  const abi = artifactAbi("NyayaResolver");
  assertFunctionsExist(abi as { type: string; name?: string }[], ["submitOutcome", "cases"], "NyayaResolver");
  const resolver = new Contract(resolverAddress, abi as InterfaceAbi, operator);

  console.log(`\nsubmitting outcome to resolver ${resolverAddress}...`);
  const tx = await resolver.submitOutcome(caseId, outcome.ruling, cid);
  console.log(`submitOutcome tx ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`submitOutcome reverted on-chain in ${tx.hash}.`);
  console.log(`submitOutcome confirmed, status 1`);
  console.log(`\nNext: CASE_ID=${caseId} npx tsx script/resolver/settleCase.ts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

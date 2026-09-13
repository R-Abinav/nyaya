/**
 * Sanity check, not a repair: confirms the current Sepolia resolver/subregistry from deployments/sepolia.json
 * still has the operator role and per-juror EAC state step 10/12 established, read live on-chain — never
 * inferred from an earlier report. Exits non-zero and prints exactly what's wrong if anything doesn't match.
 */
import { ZeroHash, keccak256, namehash, toUtf8Bytes } from "ethers";
import { abi, assertFunctionsExist, connect, contract, readDeployments } from "./ensConfig.js";
import { JUROR_WRITABLE_TEXT_KEYS, OPERATOR_ONLY_TEXT_KEYS, OPERATOR_RESOLVER_ROOT_BITMAP } from "./roles.js";

const NYAYA_LABEL = "nyaya";
const SET_TEXT = 1n << 4n;

// PermissionedResolverLib.resource(node, part) = keccak256(node ++ part), 64 raw bytes, no ABI padding
// beyond the two words themselves — matches PermissionedResolverLib.sol's inline assembly exactly.
function resourceOf(node: string, part: string): bigint {
  return BigInt(keccak256(node + part.slice(2)));
}

function partHash(key: string): string {
  return keccak256(toUtf8Bytes(key));
}

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${expected}\n        actual   ${actual}`}`);
}

async function main() {
  const { provider, operator } = connect();
  const d = readDeployments();
  const resolverAddress = d.contracts?.PermissionedResolver;
  const subregistryAddress = d.contracts?.UserRegistry;
  if (!resolverAddress || !subregistryAddress) throw new Error("Missing resolver/subregistry in deployments/sepolia.json");

  const ethRegistryAbi = abi("ETHRegistry");
  const resolverAbi = abi("PermissionedResolverImpl");
  const registryAbi = abi("UserRegistryImpl");
  assertFunctionsExist(ethRegistryAbi, ["getSubregistry", "getResolver"], "ETHRegistry");
  assertFunctionsExist(resolverAbi, ["roles", "ROOT_RESOURCE", "hasRoles"], "PermissionedResolverImpl");
  assertFunctionsExist(registryAbi, ["getResolver"], "UserRegistryImpl");

  const ethRegistry = contract("0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2", ethRegistryAbi, provider);
  const resolver = contract(resolverAddress, resolverAbi, provider);
  const subregistry = contract(subregistryAddress, registryAbi, provider);

  console.log(`resolver     ${resolverAddress}`);
  console.log(`subregistry  ${subregistryAddress}`);
  console.log(`operator     ${operator.address}\n`);

  console.log("=== 1. nyaya.eth still points here, and the operator role is still granted ===");
  const liveSubregistry: string = await ethRegistry.getSubregistry(NYAYA_LABEL);
  const liveResolver: string = await ethRegistry.getResolver(NYAYA_LABEL);
  expect("ETHRegistry.getSubregistry(nyaya) == the recorded subregistry", liveSubregistry.toLowerCase(), subregistryAddress.toLowerCase());
  expect("ETHRegistry.getResolver(nyaya) == the recorded resolver", liveResolver.toLowerCase(), resolverAddress.toLowerCase());

  const rootResource: bigint = await resolver.ROOT_RESOURCE();
  const grantedRoles: bigint = await resolver.roles(rootResource, operator.address);
  const hasFullBitmap = (grantedRoles & OPERATOR_RESOLVER_ROOT_BITMAP) === OPERATOR_RESOLVER_ROOT_BITMAP;
  expect(
    `operator's ROOT_RESOURCE roles on the resolver cover the full bitmap (has ${grantedRoles}, needs ${OPERATOR_RESOLVER_ROOT_BITMAP})`,
    hasFullBitmap,
    true,
  );

  const jurors: Record<string, string | undefined> = {
    "juror-a": d.jurorA,
    "juror-b": d.jurorB,
    "juror-c": d.jurorC,
  };

  for (const [label, jurorAddress] of Object.entries(jurors)) {
    console.log(`\n=== 2. ${label}.nyaya.eth ===`);
    if (!jurorAddress) {
      console.log(`  FAIL  no address recorded for ${label} in deployments/sepolia.json`);
      failures++;
      continue;
    }
    const fullName = `${label}.nyaya.eth`;
    const node = namehash(fullName);

    const subnameResolver: string = await subregistry.getResolver(label);
    expect(`subregistry.getResolver("${label}") == the current resolver`, subnameResolver.toLowerCase(), resolverAddress.toLowerCase());

    for (const key of JUROR_WRITABLE_TEXT_KEYS) {
      const resource = resourceOf(node, partHash(key));
      const has: boolean = await resolver.hasRoles(resource, SET_TEXT, jurorAddress);
      expect(`juror's own key still has SET_TEXT on "${key}"`, has, true);
    }
    for (const key of OPERATOR_ONLY_TEXT_KEYS) {
      const resource = resourceOf(node, partHash(key));
      const has: boolean = await resolver.hasRoles(resource, SET_TEXT, jurorAddress);
      expect(`juror's own key still does NOT have SET_TEXT on "${key}"`, has, false);
    }
    const anyPartResource = resourceOf(node, ZeroHash);
    const hasAnyPart: boolean = await resolver.hasRoles(anyPartResource, SET_TEXT, jurorAddress);
    expect(`juror's own key still does NOT have the "any field" grant (resource(node,0))`, hasAnyPart, false);
  }

  console.log(failures === 0 ? "\nall checks passed: nothing here needed fixing." : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

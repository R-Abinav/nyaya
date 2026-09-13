/**
 * Rebinds each juror subname's EAC grant from its old Sepolia-only placeholder key (created for the step
 * 10/12 EAC proof, never tied to any real Hedera identity) to that juror's real, on-chain-registered Hedera
 * treasury address — the address that actually stakes, commits, and reveals. An EOA's address is
 * chain-independent, so the same address is used as both the Hedera juror key and the Sepolia identity that
 * can write its own profile/strategy records.
 *
 * For each subname: revoke `profile`/`strategy` from the old address, grant them to the new one. Reuses
 * the same `authorizeTextRoles` call 6_configureEac.ts already used for the initial grant, just with
 * `grant=false` first.
 */
import { dnsEncode, Interface } from "ethers";
import { JUROR_LABELS, NYAYA_NAME, abi, assertFunctionsExist, connect, contract, readDeployments, revertName, send, writeDeployments } from "./ensConfig.js";
import { JUROR_WRITABLE_TEXT_KEYS } from "./roles.js";

const GAS = { authorize: 150_000n } as const;

// New real Hedera-registered addresses, confirmed via JurorRegistered events on the live JurorTreasury.
const REAL_ADDRESSES: Record<(typeof JUROR_LABELS)[number], string> = {
  "juror-a": "0xAD93109d571E527aA51Cc56A8E0682862866A69c",
  "juror-b": "0x248A7Beb7206f76c078909541fD256529176a6EA",
  "juror-c": "0xc4a8dCe2199BA1cF6eE4f498589D7a509486Ea2E",
};

async function main() {
  const { provider, operator } = connect();
  const resolverAbi = abi("PermissionedResolverImpl");
  assertFunctionsExist(resolverAbi, ["authorizeTextRoles", "roles"], "PermissionedResolverImpl");
  const iface = new Interface(resolverAbi as never);

  const d = readDeployments();
  const resolver = d.contracts?.PermissionedResolver;
  if (!resolver) throw new Error("No resolver recorded in deployments/sepolia.json");

  for (const label of JUROR_LABELS) {
    const field: "jurorA" | "jurorB" | "jurorC" = label === "juror-a" ? "jurorA" : label === "juror-b" ? "jurorB" : "jurorC";
    const oldAddress = d[field];
    const newAddress = REAL_ADDRESSES[label];
    if (!oldAddress) throw new Error(`No old address recorded for ${label}`);

    const fullName = `${label}.${NYAYA_NAME}`;
    const dnsName = dnsEncode(fullName);
    console.log(`\n=== ${fullName}: ${oldAddress} -> ${newAddress} ===`);

    if (oldAddress.toLowerCase() === newAddress.toLowerCase()) {
      console.log("  already the real address, nothing to rebind");
      continue;
    }

    for (const key of JUROR_WRITABLE_TEXT_KEYS) {
      try {
        const receipt = await send(
          provider,
          operator,
          `revoke "${key}" from old ${oldAddress}`,
          { to: resolver, data: iface.encodeFunctionData("authorizeTextRoles", [dnsName, key, oldAddress, false]) },
          GAS.authorize,
        );
        console.log(`  revoked, tx ${receipt.hash}`);
      } catch (error) {
        throw new Error(`revoke "${key}" from ${oldAddress} reverted: ${revertName(error, iface)}`);
      }

      try {
        const receipt = await send(
          provider,
          operator,
          `grant "${key}" to real ${newAddress}`,
          { to: resolver, data: iface.encodeFunctionData("authorizeTextRoles", [dnsName, key, newAddress, true]) },
          GAS.authorize,
        );
        console.log(`  granted, tx ${receipt.hash}`);
      } catch (error) {
        throw new Error(`grant "${key}" to ${newAddress} reverted: ${revertName(error, iface)}`);
      }
    }

    writeDeployments({ [field]: newAddress });
  }

  console.log("\nAll three subnames rebound to real Hedera addresses. deployments/sepolia.json updated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

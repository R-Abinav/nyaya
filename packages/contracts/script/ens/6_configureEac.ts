/**
 * Step 10, part 6: Enhanced Access Control per juror subname.
 *
 * For each juror subname, grants the juror's own key `ROLE_SET_TEXT` scoped to exactly the `profile` and
 * `strategy` text-record parts (`PermissionedResolverLib.resource(node, partHash(key))`), via
 * `authorizeTextRoles(dnsEncodedName, key, jurorAddress, true)`. Never grants anything on the `score` or
 * `returnRate` parts, and never on `resource(node, 0)` (the "any part of this name" grant, which would
 * include score). The operator needs no separate grant for score/returnRate: it holds SET_TEXT at
 * ROOT_RESOURCE from part 3, and ROOT_RESOURCE roles are checked for every resource
 * (`_effectiveRoles` in EnhancedAccessControl.sol ORs it in unconditionally).
 *
 * `toName` for `authorizeTextRoles` is the DNS-wire encoding of the full name (`ethers.dnsEncode`), not a
 * bytes32 node — confirmed by reading `NameCoder.namehash(toName, 0)` inside PermissionedResolver.sol,
 * which decodes the wire format itself.
 *
 * This step grants TO each juror's address, recorded by part 5 — it never needs that juror's private key,
 * only the address it's granting a role to. Only part 7 (the actual proof) needs to sign as the juror.
 */
import { Interface, dnsEncode } from "ethers";
import { JUROR_LABELS, NYAYA_NAME, abi, assertFunctionsExist, connect, readDeployments, revertName, send, writeDeployments } from "./ensConfig.js";
import { JUROR_WRITABLE_TEXT_KEYS } from "./roles.js";

const GAS = { authorize: 150_000n } as const;

async function main() {
  const { provider, operator } = connect();
  const resolverAbi = abi("PermissionedResolverImpl");
  assertFunctionsExist(resolverAbi, ["authorizeTextRoles", "roles"], "PermissionedResolverImpl");
  const iface = new Interface(resolverAbi as never);

  const d = readDeployments();
  const resolver = d.ens?.resolver;
  if (!resolver) throw new Error("No resolver recorded. Run 3_deployResolver.ts first.");

  for (const label of JUROR_LABELS) {
    const existing = d.ens?.jurors?.[label];
    if (!existing?.address) {
      throw new Error(`No address recorded for ${label}. Run 5_createJurorSubnames.ts first.`);
    }
    const jurorAddress = existing.address;
    const fullName = `${label}.${NYAYA_NAME}`;
    const dnsName = dnsEncode(fullName);

    for (const key of JUROR_WRITABLE_TEXT_KEYS) {
      const already = key === "profile" ? existing.profileGrantTx : existing.strategyGrantTx;
      if (already) {
        console.log(`${fullName}: "${key}" already granted to ${jurorAddress} (tx ${already}). Skipping.`);
        continue;
      }
      let receipt;
      try {
        receipt = await send(
          provider,
          operator,
          `authorizeTextRoles(${fullName}, "${key}")`,
          {
            to: resolver,
            data: iface.encodeFunctionData("authorizeTextRoles", [dnsName, key, jurorAddress, true]),
          },
          GAS.authorize,
        );
      } catch (error) {
        throw new Error(`authorizeTextRoles(${fullName}, "${key}") reverted: ${revertName(error, iface)}`);
      }
      const grantTxField = key === "profile" ? "profileGrantTx" : "strategyGrantTx";
      writeDeployments({ ens: { jurors: { [label]: { [grantTxField]: receipt.hash } } } });
      console.log(`${fullName}: granted "${key}" write access to ${jurorAddress}, tx ${receipt.hash}`);
    }
  }

  console.log("\nEAC configured for all three subnames: juror keys can write profile/strategy, never score/returnRate.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

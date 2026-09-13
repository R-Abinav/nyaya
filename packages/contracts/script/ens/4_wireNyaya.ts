/**
 * Step 10, part 4: wire nyaya.eth's subregistry and resolver, now that both exist.
 *
 * `ETHRegistrar.register()` in part 1 granted the operator ROLE_SET_SUBREGISTRY and ROLE_SET_RESOLVER
 * (plus admin variants) on nyaya.eth's own resource (`REGISTRATION_ROLE_BITMAP`, read directly from
 * ETHRegistrar.sol). `setSubregistry`/`setResolver` on `IStandardRegistry` check exactly those roles at
 * that resource (`_checkExpiryAndTokenRoles`, read directly from PermissionedRegistry.sol), so the
 * operator can call both without any extra grant.
 *
 * Reads use `getSubregistry(label)`/`getResolver(label)` from `IRegistry` — confirmed by reading
 * IRegistry.sol directly that these take the LABEL STRING ("nyaya"), not the tokenId/anyId that
 * `setSubregistry`/`setResolver` themselves take. An earlier version of this script queried with the
 * tokenId instead: ethers silently encodes whatever you pass as the declared `string` type, so it happily
 * ABI-encoded the numeric tokenId as literal text, which matches no registered label and reads back zero —
 * a false alarm about the write, not a real one. The writes below always use the correct anyId form.
 */
import { Interface } from "ethers";
import { ENS_ADDRESSES, NYAYA_LABEL, abi, assertFunctionsExist, connect, contract, readDeployments, revertName, send, writeDeployments } from "./ensConfig.js";

const GAS = { setSubregistry: 120_000n, setResolver: 120_000n } as const;

async function main() {
  const { provider, operator } = connect();
  const registryAbi = abi("ETHRegistry");
  assertFunctionsExist(registryAbi, ["setSubregistry", "setResolver", "getSubregistry", "getResolver"], "ETHRegistry");
  const iface = new Interface(registryAbi as never);
  const registry = contract(ENS_ADDRESSES.ETHRegistry, registryAbi, provider);

  const d = readDeployments();
  const tokenId = d.ens?.nyayaTokenId;
  const subregistry = d.ens?.subregistry;
  const resolver = d.ens?.resolver;
  if (!tokenId) throw new Error("No nyayaTokenId recorded. Run 1_registerNyaya.ts first.");
  if (!subregistry) throw new Error("No subregistry recorded. Run 2_deploySubregistry.ts first.");
  if (!resolver) throw new Error("No resolver recorded. Run 3_deployResolver.ts first.");

  const currentSubregistry = (await registry.getSubregistry(NYAYA_LABEL)) as string;
  const currentResolver = (await registry.getResolver(NYAYA_LABEL)) as string;

  let wireSubregistryTx = d.ens?.wireSubregistryTx;
  if (currentSubregistry.toLowerCase() === subregistry.toLowerCase()) {
    console.log(`Subregistry already wired to ${subregistry}. Skipping.`);
  } else {
    try {
      const receipt = await send(
        provider,
        operator,
        "setSubregistry",
        { to: ENS_ADDRESSES.ETHRegistry, data: iface.encodeFunctionData("setSubregistry", [tokenId, subregistry]) },
        GAS.setSubregistry,
      );
      wireSubregistryTx = receipt.hash;
    } catch (error) {
      throw new Error(`setSubregistry reverted: ${revertName(error, iface)}`);
    }
  }

  let wireResolverTx = d.ens?.wireResolverTx;
  if (currentResolver.toLowerCase() === resolver.toLowerCase()) {
    console.log(`Resolver already wired to ${resolver}. Skipping.`);
  } else {
    try {
      const receipt = await send(
        provider,
        operator,
        "setResolver",
        { to: ENS_ADDRESSES.ETHRegistry, data: iface.encodeFunctionData("setResolver", [tokenId, resolver]) },
        GAS.setResolver,
      );
      wireResolverTx = receipt.hash;
    } catch (error) {
      throw new Error(`setResolver reverted: ${revertName(error, iface)}`);
    }
  }

  const confirmedSubregistry = (await registry.getSubregistry(NYAYA_LABEL)) as string;
  const confirmedResolver = (await registry.getResolver(NYAYA_LABEL)) as string;
  if (confirmedSubregistry.toLowerCase() !== subregistry.toLowerCase()) {
    throw new Error(`getSubregistry still returns ${confirmedSubregistry}, not ${subregistry}.`);
  }
  if (confirmedResolver.toLowerCase() !== resolver.toLowerCase()) {
    throw new Error(`getResolver still returns ${confirmedResolver}, not ${resolver}.`);
  }

  writeDeployments({ ens: { wireSubregistryTx, wireResolverTx } });
  console.log(`\nnyaya.eth now points at subregistry ${subregistry} and resolver ${resolver}, confirmed by re-reading both.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

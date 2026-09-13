/**
 * Step 10, part 3: deploy our own PermissionedResolver instance via VerifiableFactory.
 *
 * One resolver instance serves all three juror subnames: PermissionedResolver's records and EAC
 * resources are keyed by `node` (the subname's namehash), so "multiple names" is the intended shape
 * (its own docstring says so), not something we're improvising. `initialize(admin, roleBitmap, setters)`
 * grants `roleBitmap` to `admin` (the operator) at ROOT_RESOURCE and runs `setters` (empty here — every
 * text-record write happens as its own traceable transaction in later parts, not bundled into this one).
 *
 * `roleBitmap` is OPERATOR_RESOLVER_ROOT_BITMAP from ./roles.ts. Holding SET_TEXT_ADMIN at ROOT_RESOURCE
 * is what lets the operator call `authorizeTextRoles` for any subname without a per-subname grant.
 */
import { Interface, keccak256, toUtf8Bytes } from "ethers";
import {
  ENS_ADDRESSES,
  abi,
  assertFunctionsExist,
  connect,
  contract,
  findLog,
  readDeployments,
  revertName,
  send,
  writeDeployments,
} from "./ensConfig.js";
import { OPERATOR_RESOLVER_ROOT_BITMAP } from "./roles.js";

const GAS = { deployProxy: 1_500_000n } as const;
const SALT = BigInt(keccak256(toUtf8Bytes("nyaya.resolver.v1")));

async function main() {
  const { provider, operator } = connect();
  const factoryAbi = abi("VerifiableFactory");
  const resolverAbi = abi("PermissionedResolverImpl");
  assertFunctionsExist(factoryAbi, ["deployProxy"], "VerifiableFactory");
  assertFunctionsExist(resolverAbi, ["initialize", "roles", "ROOT_RESOURCE"], "PermissionedResolverImpl");

  const existing = readDeployments().ens?.resolver;
  if (existing) {
    const code = await provider.getCode(existing);
    if (code !== "0x") {
      console.log(`Resolver already deployed at ${existing} (has code). Nothing to do.`);
      return;
    }
    console.log(`Recorded resolver ${existing} has no code; redeploying.`);
  }

  const factory = contract(ENS_ADDRESSES.VerifiableFactory, factoryAbi, provider);
  const factoryIface = new Interface(factoryAbi as never);
  const resolverIface = new Interface(resolverAbi as never);

  const initData = resolverIface.encodeFunctionData("initialize", [
    operator.address,
    OPERATOR_RESOLVER_ROOT_BITMAP,
    [], // setters: no bundled multicall, every subsequent write is its own recorded transaction
  ]);

  let receipt;
  try {
    receipt = await send(
      provider,
      operator,
      "deployProxy(PermissionedResolverImpl)",
      {
        to: ENS_ADDRESSES.VerifiableFactory,
        data: factoryIface.encodeFunctionData("deployProxy", [ENS_ADDRESSES.PermissionedResolverImpl, SALT, initData]),
      },
      GAS.deployProxy,
    );
  } catch (error) {
    throw new Error(`deployProxy reverted: ${revertName(error, factoryIface)}`);
  }

  const deployed = findLog<{ name: "ProxyDeployed"; args: { proxyAddress: string } }>(
    receipt,
    factoryIface,
    ENS_ADDRESSES.VerifiableFactory,
    "ProxyDeployed",
  );
  const resolver = deployed.args.proxyAddress;

  const deployedResolver = contract(resolver, resolverAbi, provider);
  const rootResource = (await deployedResolver.ROOT_RESOURCE()) as bigint;
  const grantedRoles = (await deployedResolver.roles(rootResource, operator.address)) as bigint;
  if ((grantedRoles & OPERATOR_RESOLVER_ROOT_BITMAP) !== OPERATOR_RESOLVER_ROOT_BITMAP) {
    throw new Error(
      `Deployed resolver at ${resolver}, but the operator's granted roles (${grantedRoles}) don't cover the requested bitmap (${OPERATOR_RESOLVER_ROOT_BITMAP}).`,
    );
  }

  writeDeployments({ ens: { resolver, resolverDeployTx: receipt.hash } });
  console.log(`\nResolver (PermissionedResolver proxy) deployed at ${resolver}`);
  console.log(`Operator roles confirmed on-chain: ${grantedRoles} covers requested ${OPERATOR_RESOLVER_ROOT_BITMAP}`);
  console.log(`tx: ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

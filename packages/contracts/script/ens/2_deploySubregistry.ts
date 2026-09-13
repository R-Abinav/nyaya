/**
 * Step 10, part 2: deploy our own UserRegistry instance via VerifiableFactory.
 *
 * `VerifiableFactory.deployProxy(implementation, salt, data)` CREATE2-clones a UUPS proxy pointed at the
 * existing `UserRegistryImpl` and, in the same transaction, delegatecalls `data` into it — so `data` must
 * be the encoded call to `UserRegistry.initialize(rootAccount, roleBitmap)`, the implementation's own
 * initializer (verified by reading UserRegistry.sol and VerifiableFactory.sol directly: the factory's
 * `deployProxy` calls `IUUPSProxy(proxy).initialize(implementation, data)`, and that generic proxy
 * initializer delegatecalls `data` once the implementation slot is set).
 *
 * `rootAccount` is the operator, `roleBitmap` is OPERATOR_USER_REGISTRY_ROOT_BITMAP from ./roles.ts:
 * broad on purpose, since ROOT_RESOURCE roles cascade to every resource inside this registry instance
 * (confirmed in EnhancedAccessControl.sol's `_effectiveRoles`), which is what lets the operator register
 * the three juror subnames in part 5 without a second grant.
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
import { OPERATOR_USER_REGISTRY_ROOT_BITMAP } from "./roles.js";

const GAS = { deployProxy: 1_200_000n } as const;
// Fixed and derived at runtime (not a hand-copied literal) so the CREATE2 address only ever depends on
// this string, the caller, and the implementation — reproducible without trusting a precomputed constant.
const SALT = BigInt(keccak256(toUtf8Bytes("nyaya.subregistry.v1")));

async function main() {
  const { provider, operator } = connect();
  const factoryAbi = abi("VerifiableFactory");
  const userRegistryAbi = abi("UserRegistryImpl");
  assertFunctionsExist(factoryAbi, ["deployProxy"], "VerifiableFactory");
  assertFunctionsExist(userRegistryAbi, ["initialize", "roles", "ROOT_RESOURCE"], "UserRegistryImpl");

  const existing = readDeployments().ens?.subregistry;
  if (existing) {
    const code = await provider.getCode(existing);
    if (code !== "0x") {
      console.log(`Subregistry already deployed at ${existing} (has code). Nothing to do.`);
      return;
    }
    console.log(`Recorded subregistry ${existing} has no code; redeploying.`);
  }

  const factory = contract(ENS_ADDRESSES.VerifiableFactory, factoryAbi, provider);
  const factoryIface = new Interface(factoryAbi as never);
  const userRegistryIface = new Interface(userRegistryAbi as never);

  const initData = userRegistryIface.encodeFunctionData("initialize", [
    operator.address,
    OPERATOR_USER_REGISTRY_ROOT_BITMAP,
  ]);

  let receipt;
  try {
    receipt = await send(
      provider,
      operator,
      "deployProxy(UserRegistryImpl)",
      {
        to: ENS_ADDRESSES.VerifiableFactory,
        data: factoryIface.encodeFunctionData("deployProxy", [ENS_ADDRESSES.UserRegistryImpl, SALT, initData]),
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
  const subregistry = deployed.args.proxyAddress;

  // Sanity check against the same interface the resolver's role checks will use: confirm the operator's
  // grant actually landed, on the live proxy, not just that the deploy tx succeeded.
  const deployedRegistry = contract(subregistry, userRegistryAbi, provider);
  const rootResource = (await deployedRegistry.ROOT_RESOURCE()) as bigint;
  const grantedRoles = (await deployedRegistry.roles(rootResource, operator.address)) as bigint;
  if ((grantedRoles & OPERATOR_USER_REGISTRY_ROOT_BITMAP) !== OPERATOR_USER_REGISTRY_ROOT_BITMAP) {
    throw new Error(
      `Deployed subregistry at ${subregistry}, but the operator's granted roles (${grantedRoles}) don't cover the requested bitmap (${OPERATOR_USER_REGISTRY_ROOT_BITMAP}).`,
    );
  }

  writeDeployments({ ens: { subregistry, subregistryDeployTx: receipt.hash } });
  console.log(`\nSubregistry (UserRegistry proxy) deployed at ${subregistry}`);
  console.log(`Operator roles confirmed on-chain: ${grantedRoles} covers requested ${OPERATOR_USER_REGISTRY_ROOT_BITMAP}`);
  console.log(`tx: ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

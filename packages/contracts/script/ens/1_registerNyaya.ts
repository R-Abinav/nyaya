/**
 * Step 10, part 1: register nyaya.eth on Sepolia through the real ETHRegistrar commit-reveal flow.
 *
 * Registers with subregistry = address(0) and resolver = address(0). This is deliberate, not a
 * placeholder we forgot to fill in: ETHRegistrar.register()'s commitment binds subregistry and resolver,
 * so using them would force deploying our own subregistry+resolver (part 2/3) BEFORE this commit, but
 * ETHRegistrar.sol's `_register()` (read directly, not assumed) grants the owner ROLE_SET_SUBREGISTRY and
 * ROLE_SET_RESOLVER (with admin variants) on the name's own resource at registration time either way, and
 * accepts a zero registry/resolver without reverting (`entry.subregistry = registry` unconditionally,
 * `SubregistryUpdated` is simply not emitted when the address is zero). So nyaya.eth is registered first,
 * with our own subregistry/resolver wired on in part 4 once they exist. This lets each part fail and retry
 * independently, matching the "confirm each step before assuming the next" instruction.
 *
 * Payment is a free-mint MockUSDC, the only payment tokens the Sepolia rent oracle accepts (confirmed via
 * `getPaymentTokenRatio` on-chain and via 01_StandardRentPriceOracle.ts's `paymentTokens` list at the
 * pinned commit) — there is no native-ETH path in `register()`, which takes a strict IERC20 paymentToken.
 *
 * Re-runnable: if a commitment was already made and is still within MAX_COMMITMENT_AGE, this skips
 * straight to waiting out MIN_COMMITMENT_AGE and registering, rather than re-committing.
 */
import { Interface, randomBytes, hexlify, ZeroAddress, ZeroHash } from "ethers";
import {
  ENS_ADDRESSES,
  JUROR_LABELS,
  NYAYA_LABEL,
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

const GAS = {
  mint: 80_000n,
  approve: 60_000n,
  commit: 80_000n,
  register: 400_000n,
} as const;

const REGISTER_DURATION_SECONDS = 28n * 24n * 60n * 60n; // MIN_REGISTER_DURATION on the live contract

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { provider, operator } = connect();
  const registrarAbi = abi("ETHRegistrar");
  const registryAbi = abi("ETHRegistry");
  const usdcAbi = abi("MockUSDC");
  assertFunctionsExist(
    registrarAbi,
    ["isAvailable", "commit", "commitmentAt", "register", "makeCommitment", "getRegisterPrice", "MIN_COMMITMENT_AGE"],
    "ETHRegistrar",
  );
  assertFunctionsExist(registryAbi, ["getExpiry", "getTokenId", "ownerOf"], "ETHRegistry");
  assertFunctionsExist(usdcAbi, ["mint", "approve", "balanceOf", "allowance"], "MockUSDC");

  const registrar = contract(ENS_ADDRESSES.ETHRegistrar, registrarAbi, provider);
  const registry = contract(ENS_ADDRESSES.ETHRegistry, registryAbi, provider);
  const usdc = contract(ENS_ADDRESSES.MockUSDC, usdcAbi, provider);
  const iface = new Interface(registrarAbi as never);

  const already = readDeployments().ens;
  if (already?.nyayaTokenId) {
    const owner = (await registry.ownerOf(already.nyayaTokenId)) as string;
    if (owner.toLowerCase() === operator.address.toLowerCase()) {
      console.log(`nyaya.eth is already registered to the operator (tokenId ${already.nyayaTokenId}). Nothing to do.`);
      return;
    }
  }

  const available = (await registrar.isAvailable(NYAYA_LABEL)) as boolean;
  if (!available) {
    throw new Error(
      `nyaya.eth is not available on this deployment right now. Stopping rather than picking a fallback name myself.`,
    );
  }
  console.log("isAvailable(nyaya): true");

  const [base, premium] = (await registrar.getRegisterPrice(
    NYAYA_LABEL,
    REGISTER_DURATION_SECONDS,
    ENS_ADDRESSES.MockUSDC,
  )) as [bigint, bigint];
  const totalPrice = base + premium;
  console.log(`getRegisterPrice: base ${base} + premium ${premium} = ${totalPrice} MockUSDC units (6 decimals)`);

  const d = readDeployments();
  let commitTx = d.ens?.commitTx;

  // Reuse the secret already on disk so a re-run doesn't invalidate an already-aging commitment; only
  // mint a fresh one the first time this runs.
  const secretBytes = d.ens?.secret ?? hexlify(randomBytes(32));

  const commitment = (await registrar.makeCommitment(
    NYAYA_LABEL,
    operator.address,
    secretBytes,
    ZeroAddress,
    ZeroAddress,
    REGISTER_DURATION_SECONDS,
    ZeroHash,
  )) as string;

  const existingCommitTime = (await registrar.commitmentAt(commitment)) as bigint;
  const minAge = (await registrar.MIN_COMMITMENT_AGE()) as bigint;

  if (existingCommitTime === 0n) {
    console.log("No live commitment found on-chain, committing now.");
    const receipt = await send(
      provider,
      operator,
      "commit",
      { to: ENS_ADDRESSES.ETHRegistrar, data: iface.encodeFunctionData("commit", [commitment]) },
      GAS.commit,
    );
    commitTx = receipt.hash;
    writeDeployments({ ens: { secret: secretBytes, commitTx } });
  } else {
    console.log(`Reusing existing on-chain commitment made at ${existingCommitTime}.`);
  }

  // Re-read the commit time from chain rather than trusting a wall-clock timestamp captured before the
  // commit tx was even sent: broadcast + confirmation can easily take longer than the safety margin would
  // cover, which previously caused register() to fire a few seconds too early and revert CommitmentTooNew.
  const committedAt = (await registrar.commitmentAt(commitment)) as bigint;
  const readyAt = committedAt + minAge;
  const waitSeconds = Number(readyAt - BigInt(Math.floor(Date.now() / 1000))) + 5; // 5s safety margin
  if (waitSeconds > 0) {
    console.log(`Waiting ${waitSeconds}s for MIN_COMMITMENT_AGE to pass (no vm.warp on a live network)...`);
    await sleep(waitSeconds * 1000);
  }

  const balance = (await usdc.balanceOf(operator.address)) as bigint;
  if (balance < totalPrice) {
    console.log(`Minting ${totalPrice - balance} MockUSDC units to the operator (free-mint testnet token).`);
    await send(
      provider,
      operator,
      "MockUSDC.mint",
      { to: ENS_ADDRESSES.MockUSDC, data: usdc.interface.encodeFunctionData("mint", [operator.address, totalPrice]) },
      GAS.mint,
    );
  }
  const allowance = (await usdc.allowance(operator.address, ENS_ADDRESSES.ETHRegistrar)) as bigint;
  if (allowance < totalPrice) {
    await send(
      provider,
      operator,
      "MockUSDC.approve",
      {
        to: ENS_ADDRESSES.MockUSDC,
        data: usdc.interface.encodeFunctionData("approve", [ENS_ADDRESSES.ETHRegistrar, totalPrice]),
      },
      GAS.approve,
    );
  }

  let registerReceipt;
  try {
    registerReceipt = await send(
      provider,
      operator,
      "register",
      {
        to: ENS_ADDRESSES.ETHRegistrar,
        data: iface.encodeFunctionData("register", [
          NYAYA_LABEL,
          operator.address,
          secretBytes,
          ZeroAddress,
          ZeroAddress,
          REGISTER_DURATION_SECONDS,
          ENS_ADDRESSES.MockUSDC,
          ZeroHash,
        ]),
      },
      GAS.register,
    );
  } catch (error) {
    throw new Error(`register() reverted: ${revertName(error, iface)}`);
  }

  const registered = findLog<{ name: "NameRegistered"; args: { tokenId: bigint } }>(
    registerReceipt,
    iface,
    ENS_ADDRESSES.ETHRegistrar,
    "NameRegistered",
  );
  const tokenId = registered.args.tokenId;
  const expiry = (await registry.getExpiry(tokenId)) as bigint;

  writeDeployments({
    ens: {
      nyayaTokenId: tokenId.toString(),
      nyayaExpiry: expiry.toString(),
      registerTx: registerReceipt.hash,
    },
  });

  console.log(`\nnyaya.eth registered: tokenId ${tokenId}, expiry ${expiry} (${new Date(Number(expiry) * 1000).toISOString()})`);
  console.log(`Paid ${totalPrice} MockUSDC units. Owner: ${operator.address}. Subregistry/resolver: zero, wired in part 4.`);
  console.log(`\nRecorded to deployments/sepolia.json. Juror subnames planned: ${JUROR_LABELS.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

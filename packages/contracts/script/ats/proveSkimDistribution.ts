/**
 * Phase 3: prove the skim path on Hedera testnet, against the live ATS token.
 *
 *   deploy a distributor -> run a real case so the resolver holds a real skim -> release it on-chain ->
 *   declare() so ATS snapshots holders and computes entitlements -> the existing holder claims real HBAR
 *
 * The point is not the hashes, it is whether real ATS's dividend behaviour matches test/mocks/MockAtsToken.sol:
 * whether a record date of "now" is accepted, when recordDateReached flips, how the snapshot resolves, and what
 * getDividendFor returns. The script compares each against the mock and reports differences at the end.
 *
 * All four Hedera footguns from contracts.md are applied up front:
 *   1. gas limits are per call, never one shared value
 *   2. every send is signed and broadcast raw, so the relay cannot refuse it before it lands
 *   3. addresses that get stored or compared come from the mirror node as EVM aliases
 *   4. each sender is checked for gasLimit x gasPrice + value before anything is sent
 *
 * Run: set -a; source .env; set +a && JUROR_ADDRESS=0x.. JUROR_PK=0x.. BUYER_PK=0x.. npm run ats:distribute
 */
import { Contract, ContractFactory, Interface, Wallet, JsonRpcProvider, type TransactionReceipt } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATS_ROLES,
  CONTRACTS_ROOT,
  TINYBAR,
  artifactAbi,
  assertFunctionsExist,
  atsAssetAbi,
  connect,
  hbar,
  hederaIdToAliasAddress,
  readDeployments,
  requireContract,
  tinybarToWeibar,
} from "./atsConfig.js";

// --- footgun 1: a gas limit per call, sized to that call, never shared ---
const GAS = {
  deployDistributor: 3_000_000n,
  grantRole: 300_000n,
  fundTreasury: 300_000n,
  setDistributionAddress: 200_000n,
  openCase: 500_000n,
  commit: 600_000n,
  reveal: 400_000n,
  submitOutcome: 300_000n,
  settle: 1_200_000n,
  releaseDistribution: 500_000n,
  declare: 1_500_000n,
  claim: 800_000n,
  topUp: 100_000n,
} as const;

const BOUNTY = 2n * TINYBAR;
const STAKE = 2n * TINYBAR;
/** Real deadlines: there is no vm.warp on testnet, so the script waits for them to pass. */
const COMMIT_WINDOW_SECONDS = 90;
const REVEAL_WINDOW_SECONDS = 90;
const CONFIDENCE_BPS = 7000;
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

/** Every function this script calls, per contract. The preflight checks each against the real ABI. */
const CALLS = {
  resolver: [
    "openCase",
    "commit",
    "reveal",
    "submitOutcome",
    "settle",
    "releaseDistribution",
    "setDistributionAddress",
    "distributionAddress",
    "pendingDistribution",
    "commitmentFor",
    "caseCount",
  ],
  treasury: ["balanceOf", "fund"],
  token: ["grantRole", "hasRole", "balanceOf", "totalSupply", "decimals", "getDividendFor", "getDividendAmountFor"],
  distributor: ["declare", "claim", "claimableOf", "undeclared", "potOf"],
} as const;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const asHbar = (weibar: bigint) => hbar(weibar / 10_000_000_000n);
const wait = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));

/**
 * Footguns 2 and 4: check the sender can cover gasLimit x gasPrice + value, then sign and broadcast raw so the
 * relay cannot refuse the transaction before it produces a hash.
 */
async function send(
  provider: JsonRpcProvider,
  signer: Wallet,
  label: string,
  tx: { to?: string; data?: string; value?: bigint },
  gasLimit: bigint,
): Promise<TransactionReceipt> {
  const gasPrice = (await provider.getFeeData()).maxFeePerGas ?? 0n;
  const value = tx.value ?? 0n;
  const balance = await provider.getBalance(signer.address);
  const reserved = gasLimit * gasPrice;
  if (balance < reserved + value) {
    throw new Error(
      `${label}: ${signer.address} cannot cover this call.\n` +
        `  holds:        ${asHbar(balance)}\n` +
        `  gas reserved: ${asHbar(reserved)} (${gasLimit} gas, reserved up front whatever it burns)\n` +
        `  value:        ${asHbar(value)}\n` +
        `  short by:     ${asHbar(reserved + value - balance)}`,
    );
  }
  const signed = await signer.signTransaction({
    ...tx,
    value,
    gasLimit,
    nonce: await provider.getTransactionCount(signer.address),
    chainId: (await provider.getNetwork()).chainId,
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: 0n,
  });
  const sent = await provider.broadcastTransaction(signed);
  const receipt = await provider.waitForTransaction(sent.hash);
  if (!receipt) throw new Error(`${label}: no receipt for ${sent.hash}`);
  console.log(`  ${label}: ${receipt.status === 1 ? "ok" : "REVERTED"}  tx ${sent.hash}  gas ${receipt.gasUsed}`);
  if (receipt.status !== 1) throw new Error(`${label} reverted on-chain: ${sent.hash}`);
  return receipt;
}

async function main() {
  const { provider, operator } = connect();
  const deployments = readDeployments();
  const resolverAddress = requireContract(deployments, "NyayaResolver");
  const treasuryAddress = requireContract(deployments, "JurorTreasury");
  const juror = env("JUROR_ADDRESS");
  const jurorWallet = new Wallet(env("JUROR_PK"), provider);
  const buyer = new Wallet(env("BUYER_PK"), provider);
  const tokenAddress = deployments.shareTokens?.[juror];
  if (!tokenAddress) throw new Error(`No share token recorded for ${juror}; run ats:issue first.`);

  // --- interface preflight: every call this script makes must exist on the real ABI, before anything is sent ---
  const resolverAbi = artifactAbi("NyayaResolver");
  const treasuryAbi = artifactAbi("JurorTreasury");
  const distributorAbi = artifactAbi("JurorShareDistributor");
  const tokenAbi = atsAssetAbi();
  assertFunctionsExist(resolverAbi, [...CALLS.resolver], "NyayaResolver");
  assertFunctionsExist(treasuryAbi, [...CALLS.treasury], "JurorTreasury");
  assertFunctionsExist(distributorAbi, [...CALLS.distributor], "JurorShareDistributor");
  assertFunctionsExist(tokenAbi, [...CALLS.token], "the ATS token (IAsset)");
  console.log("interface preflight: every function this script calls exists on its target\n");

  const resolver = new Contract(resolverAddress, resolverAbi as never, provider);
  const resolverIface = new Interface(resolverAbi as never);
  const treasuryIface = new Interface(treasuryAbi as never);
  const token = new Contract(tokenAddress, tokenAbi as never, provider);
  const tokenIface = new Interface(tokenAbi as never);
  const distributorIface = new Interface(distributorAbi as never);

  console.log(`token      ${tokenAddress}`);
  console.log(`holder     ${buyer.address} holds ${await token.balanceOf(buyer.address)} units of ${await token.totalSupply()}`);
  console.log(`operator   ${operator.address} (${asHbar(await provider.getBalance(operator.address))})\n`);

  // --- 1. deploy the distributor ---
  // Footgun 3 again, in a place that would only bite at step 4: the distributor compares msg.sender against the
  // resolver address baked in here. If the deployments file holds a different form from the one the EVM reports,
  // releaseDistribution would revert after the case had already been run and paid for. Resolve it first.
  const resolverAlias = await hederaIdToAliasAddress(resolverAddress).catch(() => resolverAddress);
  if (resolverAlias.toLowerCase() !== resolverAddress.toLowerCase()) {
    console.log(`note: resolver alias ${resolverAlias} differs from deployments.json ${resolverAddress};`);
    console.log(`      using the alias, because the distributor compares it against msg.sender\n`);
  }

  // DISTRIBUTOR_ADDRESS reuses one an earlier run already deployed, so a retry costs nothing here.
  let distributorAddress = process.env.DISTRIBUTOR_ADDRESS ?? "";
  let deployHash = "reused";
  if (distributorAddress) {
    console.log(`1. reusing the distributor at ${distributorAddress}`);
  } else {
    console.log("1. deploying JurorShareDistributor");
    const artifact = JSON.parse(
      readFileSync(resolve(CONTRACTS_ROOT, "out/JurorShareDistributor.sol/JurorShareDistributor.json"), "utf8"),
    ) as { abi: unknown[]; bytecode: { object: string } };
    const deployData = await new ContractFactory(artifact.abi as never, artifact.bytecode.object).getDeployTransaction(
      tokenAddress,
      resolverAlias,
      operator.address,
      juror,
    );
    const deployReceipt = await send(provider, operator, "deploy", { data: deployData.data }, GAS.deployDistributor);
    // Footgun 3: the resolver stores this address, so use the alias the mirror node reports, not a derived form.
    const rawDistributor = deployReceipt.contractAddress;
    if (!rawDistributor) throw new Error("no contractAddress in the deploy receipt");
    distributorAddress = await hederaIdToAliasAddress(rawDistributor).catch(() => rawDistributor);
    deployHash = deployReceipt.hash;
    console.log(`   distributor ${distributorAddress}`);
    console.log(`   reuse it on a retry with DISTRIBUTOR_ADDRESS=${distributorAddress}`);
  }

  // --- 2. wire it up: ATS role, resolver's distribution address ---
  console.log("\n2. wiring");
  if (await token.hasRole(ATS_ROLES.CORPORATE_ACTION, distributorAddress)) {
    console.log("  grantRole(CORPORATE_ACTION): already granted, skipping");
  } else {
    await send(
      provider,
      operator,
      "grantRole(CORPORATE_ACTION) on the ATS token",
      { to: tokenAddress, data: tokenIface.encodeFunctionData("grantRole", [ATS_ROLES.CORPORATE_ACTION, distributorAddress]) },
      GAS.grantRole,
    );
  }
  if ((await resolver.distributionAddress(juror)) === "0x0000000000000000000000000000000000000000") {
    await send(
      provider,
      operator,
      "setDistributionAddress",
      { to: resolverAddress, data: resolverIface.encodeFunctionData("setDistributionAddress", [juror, distributorAddress]) },
      GAS.setDistributionAddress,
    );
  } else {
    const existing: string = await resolver.distributionAddress(juror);
    console.log(`  setDistributionAddress: already ${existing} (the resolver allows it only once), reusing it`);
    if (existing.toLowerCase() !== distributorAddress.toLowerCase()) {
      throw new Error(
        `The resolver already pays juror ${juror} at ${existing}, but this run is using ${distributorAddress}. ` +
          `setDistributionAddress cannot be changed, so re-run with DISTRIBUTOR_ADDRESS=${existing}.`,
      );
    }
  }

  // --- 3. a real case, so the skim is real ---
  console.log("\n3. running a case so the resolver holds a real skim");
  const treasury = new Contract(treasuryAddress, treasuryAbi as never, provider);
  if ((await treasury.balanceOf(juror)) < STAKE) {
    await send(
      provider,
      operator,
      "fund the juror's treasury",
      { to: treasuryAddress, data: treasuryIface.encodeFunctionData("fund", [juror]), value: tinybarToWeibar(STAKE * 2n) },
      GAS.fundTreasury,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const commitDeadline = now + COMMIT_WINDOW_SECONDS;
  const resolutionTime = commitDeadline + REVEAL_WINDOW_SECONDS;
  const openReceipt = await send(
    provider,
    operator,
    "openCase",
    {
      to: resolverAddress,
      data: resolverIface.encodeFunctionData("openCase", ["github-stars", "skim distribution proof", commitDeadline, resolutionTime]),
      value: tinybarToWeibar(BOUNTY),
    },
    GAS.openCase,
  );
  const opened = openReceipt.logs
    .map((log) => {
      try {
        return resolverIface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "CaseOpened");
  const caseId: bigint = opened?.args?.caseId ?? (await resolver.caseCount());
  console.log(`   case ${caseId}, commit closes in ${COMMIT_WINDOW_SECONDS}s`);

  const salt = "0x" + "5a".repeat(32);
  const RULING_YES = 2;
  const commitment = await resolver.commitmentFor(caseId, juror, RULING_YES, CONFIDENCE_BPS, salt);
  await send(
    provider,
    jurorWallet,
    "commit",
    { to: resolverAddress, data: resolverIface.encodeFunctionData("commit", [caseId, commitment, STAKE]) },
    GAS.commit,
  );

  console.log(`   waiting ${COMMIT_WINDOW_SECONDS + 10}s for the commit deadline...`);
  await wait(COMMIT_WINDOW_SECONDS + 10);
  await send(
    provider,
    jurorWallet,
    "reveal",
    { to: resolverAddress, data: resolverIface.encodeFunctionData("reveal", [caseId, RULING_YES, CONFIDENCE_BPS, salt, CID]) },
    GAS.reveal,
  );

  console.log(`   waiting ${REVEAL_WINDOW_SECONDS}s for the resolution time...`);
  await wait(REVEAL_WINDOW_SECONDS);
  await send(
    provider,
    operator,
    "submitOutcome",
    { to: resolverAddress, data: resolverIface.encodeFunctionData("submitOutcome", [caseId, RULING_YES, CID]) },
    GAS.submitOutcome,
  );
  await send(
    provider,
    operator,
    "settle",
    { to: resolverAddress, data: resolverIface.encodeFunctionData("settle", [caseId]) },
    GAS.settle,
  );

  const skim = await resolver.pendingDistribution(juror);
  console.log(`   skim accrued: ${hbar(skim)}`);
  if (skim === 0n) throw new Error("no skim accrued; the juror did not win the case");

  // --- 4. release it into the distributor ---
  console.log("\n4. releasing the skim");
  const releaseReceipt = await send(
    provider,
    operator,
    "releaseDistribution",
    { to: resolverAddress, data: resolverIface.encodeFunctionData("releaseDistribution", [juror]) },
    GAS.releaseDistribution,
  );
  console.log(`   distributor now holds ${asHbar(await provider.getBalance(distributorAddress))}`);

  // --- 5. declare on the live ATS token ---
  console.log("\n5. declare() — real ATS snapshots holders");
  const declareReceipt = await send(
    provider,
    operator,
    "declare",
    { to: distributorAddress, data: distributorIface.encodeFunctionData("declare", []) },
    GAS.declare,
  );
  const declared = declareReceipt.logs
    .map((log) => {
      try {
        return distributorIface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "DividendDeclared");
  const dividendId: bigint = declared?.args?.dividendId ?? 1n;
  const pot: bigint = declared?.args?.pot ?? skim;
  const amountPerUnit: bigint = declared?.args?.amountPerUnit ?? 0n;
  const supply: bigint = declared?.args?.supply ?? 0n;
  console.log(`   dividend ${dividendId}: pot ${hbar(pot)}, amountPerUnit ${amountPerUnit}, supply ${supply}`);

  // --- what real ATS says the holder is owed ---
  const dividendFor = await token.getDividendFor(dividendId, buyer.address);
  const amountFor = await token.getDividendAmountFor(dividendId, buyer.address);
  const owedByAts: bigint =
    BigInt(amountFor.denominator) === 0n ? 0n : BigInt(amountFor.numerator) / BigInt(amountFor.denominator);
  const owedByDistributor = await new Contract(distributorAddress, distributorAbi as never, provider).claimableOf(
    dividendId,
    buyer.address,
  );
  console.log(`   ATS getDividendFor: balanceAtSnapshot=${dividendFor.tokenBalance} amount=${dividendFor.amount} amountDecimals=${dividendFor.amountDecimals} decimals=${dividendFor.decimals} recordDateReached=${dividendFor.recordDateReached}`);
  console.log(`   ATS says owed: ${amountFor.numerator}/${amountFor.denominator} = ${hbar(owedByAts)}`);
  console.log(`   distributor agrees: ${hbar(owedByDistributor)}`);

  // --- 6. the holder claims real HBAR ---
  console.log("\n6. the holder claims");
  const before = await provider.getBalance(buyer.address);
  const claimReceipt = await send(
    provider,
    buyer,
    "claim",
    { to: distributorAddress, data: distributorIface.encodeFunctionData("claim", [dividendId]) },
    GAS.claim,
  );
  const after = await provider.getBalance(buyer.address);
  const gasPaid = claimReceipt.gasUsed * (claimReceipt.gasPrice ?? 0n);
  // Balances come back in weibar (18 decimals); everything the contracts report is in tinybars (8). Compare in
  // tinybars, or a correct payout looks like a 10^10 discrepancy.
  const received = (after - before + gasPaid) / 10_000_000_000n;

  // --- divergence report ---
  console.log("\n=== divergence report: real ATS dividends vs test/mocks/MockAtsToken.sol ===");
  const checks: [string, boolean, string][] = [
    ["record date of now accepted", dividendFor.recordDate > 0n, `ATS stored recordDate ${dividendFor.recordDate}`],
    ["recordDateReached true immediately", dividendFor.recordDateReached === true, "the mock flips it at block.timestamp >= recordDate"],
    ["snapshot caught the existing holder", dividendFor.tokenBalance > 0n, `balanceAtSnapshot ${dividendFor.tokenBalance}`],
    ["entitlement matches the mock's formula", owedByAts === owedByDistributor, `ATS ${owedByAts} vs distributor ${owedByDistributor}`],
    ["holder actually received it", received === owedByAts, `received ${received}, owed ${owedByAts}`],
    ["dividend ids are 1-based", dividendId >= 1n, `id ${dividendId}`],
  ];
  for (const [what, ok, detail] of checks) console.log(`  ${ok ? "same " : "DIFFERS"}  ${what}  (${detail})`);
  const allSame = checks.every(([, ok]) => ok);
  console.log(allSame ? "\nthe mock matches real ATS on every point above" : "\nMOCK AND REAL ATS DISAGREE — update MockAtsToken and re-run forge test");

  console.log("\n=== hashes for docs/TESTNET-EVIDENCE.md ===");
  console.log(`distributor:         ${distributorAddress}`);
  console.log(`deploy:              ${deployHash}`);
  console.log(`releaseDistribution: ${releaseReceipt.hash}`);
  console.log(`declare:             ${declareReceipt.hash}`);
  console.log(`claim:               ${claimReceipt.hash}`);
  console.log(`skim declared:       ${hbar(pot)}`);
  console.log(`ATS said owed:       ${hbar(owedByAts)}`);
  console.log(`holder received:     ${hbar(received)}`);
  if (!allSame) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

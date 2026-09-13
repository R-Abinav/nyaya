/**
 * Fixes the ATS/share-market wiring the step-12 Hedera redeploy orphaned, flagged by that step's own audit:
 *
 *   - JurorShareDistributor binds its resolver as an immutable at construction, so the old distributor can
 *     never accept a skim from the new resolver — a fresh distributor is needed, not a rewiring of the old one.
 *   - The old JurorShareMarket held ROLE_ISSUER/ROLE_CONTROLLER/ROLE_CONTROL_LIST on juror A's ATS token; the
 *     new market holds none of them.
 *
 * Uses the EXISTING ATS token for juror A (NYJA) — nothing is re-issued.
 *
 *   1. deploy a new JurorShareDistributor(token, newResolver, operator, jurorA)
 *   2. grantRole(CORPORATE_ACTION) on the token for the new distributor; setDistributionAddress on the new
 *      resolver, the same two calls the original ats:distribute script made
 *   3. grantRole(ISSUER), grantRole(CONTROLLER), grantRole(CONTROL_LIST) on the token for the new market,
 *      then registerShareToken(jurorA, token) on the new market itself — buy()/sell() read shareToken[juror]
 *      from the market's own storage, set only by this call, and it starts unset on every fresh market
 *   4. write the new distributor's address into deployments/hedera.json, alongside the rest
 *
 * Operator-only: every call here is either a deploy or something only the token's admin/the resolver's
 * operator can do. Proving the fix (a real buy through the new market, a real skim through the new
 * distributor, and the compliance block re-checked) is separate — see ats:prove and ats:distribute, both of
 * which already read the current deployments/hedera.json and so already target the new market/resolver.
 *
 * Run: set -a; source .env; set +a && npm run ats:repair-wiring
 */
import { Contract, ContractFactory, Interface, type TransactionReceipt, type JsonRpcProvider, type Wallet } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATS_ROLES,
  CONTRACTS_ROOT,
  MARKET_ABI,
  artifactAbi,
  assertFunctionsExist,
  atsAssetAbi,
  connect,
  hbar,
  hederaIdToAliasAddress,
  readDeployments,
  requireContract,
  writeDeployments,
} from "./atsConfig.js";

const GAS = {
  deployDistributor: 3_000_000n,
  grantRole: 300_000n,
  setDistributionAddress: 200_000n,
  registerShareToken: 400_000n,
} as const;

const JUROR_A = "0xAD93109d571E527aA51Cc56A8E0682862866A69c";
// From docs/TESTNET-EVIDENCE.md step 7, not re-derived: the same hot wallet juror A has always used.
const JUROR_A_HOT_WALLET = "0x7a900064d35fed347BAc5418Bc5F6C5768622D8c";

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
    throw new Error(`${label}: ${signer.address} cannot cover this call (holds ${hbar(balance / 10_000_000_000n)})`);
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
  console.log(`  ${label}: ${receipt.status === 1 ? "ok" : "REVERTED"}  tx ${sent.hash}`);
  if (receipt.status !== 1) throw new Error(`${label} reverted on-chain: ${sent.hash}`);
  return receipt;
}

async function main() {
  const { provider, operator } = connect();
  const deployments = readDeployments();
  const resolverAddress = requireContract(deployments, "NyayaResolver");
  const marketAddress = requireContract(deployments, "JurorShareMarket");
  const treasuryAddress = requireContract(deployments, "JurorTreasury");
  const tokenAddress = deployments.shareTokens?.[JUROR_A];
  if (!tokenAddress) throw new Error(`No share token recorded for juror A (${JUROR_A}).`);

  const resolverAbi = artifactAbi("NyayaResolver");
  assertFunctionsExist(resolverAbi, ["setDistributionAddress", "distributionAddress"], "NyayaResolver");
  const resolverIface = new Interface(resolverAbi as never);
  const resolver = new Contract(resolverAddress, resolverAbi as never, provider);

  const treasuryAbi = artifactAbi("JurorTreasury");
  assertFunctionsExist(treasuryAbi, ["registerJuror", "hotWalletOf"], "JurorTreasury");
  const treasuryIface = new Interface(treasuryAbi as never);
  const treasury = new Contract(treasuryAddress, treasuryAbi as never, provider);

  const tokenAbi = atsAssetAbi();
  assertFunctionsExist(tokenAbi, ["grantRole", "hasRole"], "the ATS token (IAsset)");
  const tokenIface = new Interface(tokenAbi as never);
  const token = new Contract(tokenAddress, tokenAbi as never, provider);

  console.log(`resolver  ${resolverAddress}`);
  console.log(`market    ${marketAddress}`);
  console.log(`token     ${tokenAddress} (juror A / NYJA)\n`);

  // --- 1. deploy the new distributor, bound to the new resolver ---
  const resolverAlias = await hederaIdToAliasAddress(resolverAddress).catch(() => resolverAddress);
  const distributorAbi = artifactAbi("JurorShareDistributor");
  assertFunctionsExist(distributorAbi, ["resolver"], "JurorShareDistributor");

  // A candidate address from CLI or the deployments file is never trusted on its name alone — this exact
  // mistake (reusing a bookkeeping entry left over from a superseded resolver) pointed a resolver's
  // one-time, unfixable distributionAddress at a distributor that could never receive from it. Verify the
  // candidate's own immutable `resolver()` actually matches the CURRENT live resolver before reusing it.
  const candidate = process.env.DISTRIBUTOR_ADDRESS ?? deployments.distributors?.[JUROR_A] ?? "";
  let distributorAddress = "";
  if (candidate) {
    const candidateContract = new Contract(candidate, distributorAbi as never, provider);
    const boundTo: string = await candidateContract.resolver();
    if (boundTo.toLowerCase() === resolverAddress.toLowerCase()) {
      distributorAddress = candidate;
    } else {
      console.log(
        `Candidate distributor ${candidate} is bound to ${boundTo}, not the current resolver ${resolverAddress}. ` +
          `Ignoring it and deploying fresh — reusing it would silently repeat the exact bug this check exists to catch.`,
      );
    }
  }

  let deployHash = "reused";
  if (distributorAddress) {
    console.log(`1. reusing the distributor at ${distributorAddress} (verified bound to the current resolver)`);
  } else {
    console.log("1. deploying JurorShareDistributor bound to the new resolver");
    const artifact = JSON.parse(
      readFileSync(resolve(CONTRACTS_ROOT, "out/JurorShareDistributor.sol/JurorShareDistributor.json"), "utf8"),
    ) as { abi: unknown[]; bytecode: { object: string } };
    const deployData = await new ContractFactory(artifact.abi as never, artifact.bytecode.object).getDeployTransaction(
      tokenAddress,
      resolverAlias,
      operator.address,
      JUROR_A,
    );
    const deployReceipt = await send(provider, operator, "deploy", { data: deployData.data }, GAS.deployDistributor);
    const rawDistributor = deployReceipt.contractAddress;
    if (!rawDistributor) throw new Error("no contractAddress in the deploy receipt");
    distributorAddress = await hederaIdToAliasAddress(rawDistributor).catch(() => rawDistributor);
    deployHash = deployReceipt.hash;
    console.log(`   distributor ${distributorAddress}`);
  }

  // --- 2. wire it: CORPORATE_ACTION role, setDistributionAddress ---
  console.log("\n2. wiring the distributor");
  let grantCorporateActionHash = "already granted";
  if (await token.hasRole(ATS_ROLES.CORPORATE_ACTION, distributorAddress)) {
    console.log("  grantRole(CORPORATE_ACTION): already granted, skipping");
  } else {
    const receipt = await send(
      provider,
      operator,
      "grantRole(CORPORATE_ACTION) on the token, for the new distributor",
      { to: tokenAddress, data: tokenIface.encodeFunctionData("grantRole", [ATS_ROLES.CORPORATE_ACTION, distributorAddress]) },
      GAS.grantRole,
    );
    grantCorporateActionHash = receipt.hash;
  }

  let setDistributionAddressHash = "already set";
  const existingDistribution: string = await resolver.distributionAddress(JUROR_A);
  if (existingDistribution === "0x0000000000000000000000000000000000000000") {
    const receipt = await send(
      provider,
      operator,
      "setDistributionAddress(jurorA, newDistributor)",
      { to: resolverAddress, data: resolverIface.encodeFunctionData("setDistributionAddress", [JUROR_A, distributorAddress]) },
      GAS.setDistributionAddress,
    );
    setDistributionAddressHash = receipt.hash;
  } else if (existingDistribution.toLowerCase() !== distributorAddress.toLowerCase()) {
    throw new Error(
      `The new resolver already pays juror A at ${existingDistribution}, not ${distributorAddress}. setDistributionAddress cannot be changed.`,
    );
  } else {
    console.log(`  setDistributionAddress: already ${existingDistribution}, matches`);
  }

  // --- 3. grant the new market the three roles the old one held ---
  console.log("\n3. granting the new market ISSUER / CONTROLLER / CONTROL_LIST");
  const marketRoleHashes: Record<string, string> = {};
  for (const [name, role] of Object.entries({
    ISSUER: ATS_ROLES.ISSUER,
    CONTROLLER: ATS_ROLES.CONTROLLER,
    CONTROL_LIST: ATS_ROLES.CONTROL_LIST,
  })) {
    if (await token.hasRole(role, marketAddress)) {
      console.log(`  grantRole(${name}): already granted, skipping`);
      marketRoleHashes[name] = "already granted";
      continue;
    }
    const receipt = await send(
      provider,
      operator,
      `grantRole(${name}) on the token, for the new market`,
      { to: tokenAddress, data: tokenIface.encodeFunctionData("grantRole", [role, marketAddress]) },
      GAS.grantRole,
    );
    marketRoleHashes[name] = receipt.hash;
  }

  // registerShareToken (below) needs the treasury to already know juror A's hot wallet — the fresh
  // treasury from the step-12 redeploy has never had a juror registered on it at all, which is why this
  // reverted ZeroAddress the first time this script ran. Registering is operator-only; it needs no
  // signature from the juror, only her already-public address and hot wallet.
  console.log("\n3a. registering juror A on the new treasury (needed for registerShareToken below)");
  const existingHotWallet: string = await treasury.hotWalletOf(JUROR_A);
  let registerJurorHash = "already registered";
  if (existingHotWallet === "0x0000000000000000000000000000000000000000") {
    const receipt = await send(
      provider,
      operator,
      "registerJuror(jurorA, hotWallet)",
      { to: treasuryAddress, data: treasuryIface.encodeFunctionData("registerJuror", [JUROR_A, JUROR_A_HOT_WALLET]) },
      GAS.registerShareToken,
    );
    registerJurorHash = receipt.hash;
  } else if (existingHotWallet.toLowerCase() !== JUROR_A_HOT_WALLET.toLowerCase()) {
    throw new Error(`Treasury already has a different hot wallet for juror A: ${existingHotWallet}`);
  } else {
    console.log(`  registerJuror: already registered, hot wallet ${existingHotWallet}`);
  }

  const marketIface = new Interface(MARKET_ABI);
  const market = new Contract(marketAddress, MARKET_ABI, provider);
  let registerShareTokenHash = "already registered";
  const currentShareToken: string = await market.shareToken(JUROR_A);
  if (currentShareToken === "0x0000000000000000000000000000000000000000") {
    const receipt = await send(
      provider,
      operator,
      "registerShareToken(jurorA, token) on the new market",
      { to: marketAddress, data: marketIface.encodeFunctionData("registerShareToken", [JUROR_A, tokenAddress]) },
      GAS.registerShareToken,
    );
    registerShareTokenHash = receipt.hash;
  } else if (currentShareToken.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`Market already has a different share token registered for juror A: ${currentShareToken}`);
  } else {
    console.log(`  registerShareToken: already registered to ${currentShareToken}`);
  }

  // --- 4. record the new distributor ---
  writeDeployments({
    ...deployments,
    distributors: { ...deployments.distributors, [JUROR_A]: distributorAddress },
  });
  console.log(`\nWrote distributors["${JUROR_A}"] = ${distributorAddress} to deployments/hedera.json`);

  console.log("\n=== hashes for docs/TESTNET-EVIDENCE.md ===");
  console.log(`distributor deploy:            ${deployHash}`);
  console.log(`grantRole(CORPORATE_ACTION):   ${grantCorporateActionHash}`);
  console.log(`setDistributionAddress:        ${setDistributionAddressHash}`);
  for (const [name, hash] of Object.entries(marketRoleHashes)) console.log(`grantRole(${name}) on market:  ${hash}`);
  console.log(`registerJuror:                  ${registerJurorHash}`);
  console.log(`registerShareToken:            ${registerShareTokenHash}`);
  console.log(`\nnew distributor: ${distributorAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Phase 1: issue a real ATS security token for one juror on Hedera testnet.
 *
 * Steps:
 *   1. create throwaway juror + hot wallet accounts and fund them (they need gas to prove the block later)
 *   2. register the juror in JurorTreasury
 *   3. deploy an ATS equity through ATS's factory, granting JurorShareMarket its roles in the same call
 *   4. register the token with JurorShareMarket, which adds both juror addresses to ATS's control list
 *   5. write the token address into the shared deployments JSON
 *
 * Run: set -a; source .env; set +a && npm run ats:issue
 */
import { Contract, Wallet, ZeroAddress, type InterfaceAbi } from "ethers";
import {
  ATS_ROLES,
  ATS_TOKEN_ABI,
  EQUITY_CONFIG_ID,
  resolveEquityConfigVersion,
  assertMatchesAbi,
  assertValidEquityValues,
  deployEquityInputs,
  factoryAbi,
  MARKET_ABI,
  TINYBAR,
  TREASURY_ABI,
  assertHasCode,
  atsAddresses,
  connect,
  contract,
  hbar,
  readDeployments,
  requireContract,
  tinybarToWeibar,
  writeDeployments,
} from "./atsConfig.js";

/**
 * Testnet HBAR is capped at 100/day from the faucet, so keep every amount small.
 * These accounts only ever attempt one small buy that is meant to revert, so they need the attempt's value
 * plus gas, nothing more.
 */
const JUROR_KEY_FUNDING = 3n * TINYBAR;
const HOT_WALLET_FUNDING = 3n * TINYBAR;
/** deployEquity is a large deployment, so leave the operator room for it after funding. */
const OPERATOR_HEADROOM = 20n * TINYBAR;
/** Hedera caps a transaction at 15M gas. Set explicitly so ethers skips eth_estimateGas entirely. */
const DEPLOY_GAS_LIMIT = 15_000_000n;
/**
 * ATS rejects an uncapped supply at deployment with NewMaxSupplyCannotBeZero(), even though its mint path
 * treats 0 as "no cap". 500 million shares at 2 decimals, far more than a demo needs.
 */
const MAX_SHARE_SUPPLY = 50_000_000_000n;

async function main() {
  const { provider, operator } = connect();
  const deployments = readDeployments();
  const marketAddress = requireContract(deployments, "JurorShareMarket");
  const treasuryAddress = requireContract(deployments, "JurorTreasury");
  const { factory: factoryAddress, resolver: atsResolver } = await atsAddresses();

  // Check up front: part-funding one account and then dying leaves throwaway keys holding testnet HBAR.
  const operatorBalance = await provider.getBalance(operator.address);
  const required = tinybarToWeibar(JUROR_KEY_FUNDING + HOT_WALLET_FUNDING + OPERATOR_HEADROOM);
  if (operatorBalance < required) {
    throw new Error(
      `Operator ${operator.address} holds ${hbar(operatorBalance / 10_000_000_000n)}, but this run needs about ` +
        `${hbar(JUROR_KEY_FUNDING + HOT_WALLET_FUNDING + OPERATOR_HEADROOM)} ` +
        `(${hbar(JUROR_KEY_FUNDING + HOT_WALLET_FUNDING)} funding plus ${hbar(OPERATOR_HEADROOM)} for deployEquity and gas). ` +
        `Top up from the Hedera testnet faucet and re-run; nothing has been sent yet.`,
    );
  }

  console.log(`operator          ${operator.address} (${hbar(operatorBalance / 10_000_000_000n)})`);
  console.log(`ATS factory       ${factoryAddress}`);
  console.log(`ATS resolver      ${atsResolver}`);
  await assertHasCode(provider, factoryAddress, "ATS factory");
  await assertHasCode(provider, atsResolver, "ATS resolver");

  // A separate buyer account is created in the proof script, not here. It has to be a different account from
  // the operator: a buy from the account that runs everything would only show that an unblocked address can
  // buy, which proves nothing about ATS's control list distinguishing between accounts.
  // Retries are cheap: pass JUROR_PK and HOT_PK to reuse accounts a previous run already funded.
  const reusing = Boolean(process.env.JUROR_PK && process.env.HOT_PK);
  const jurorKey = process.env.JUROR_PK ? new Wallet(process.env.JUROR_PK, provider) : Wallet.createRandom().connect(provider);
  const hotWallet = process.env.HOT_PK ? new Wallet(process.env.HOT_PK, provider) : Wallet.createRandom().connect(provider);

  if (reusing) {
    console.log(`\nreusing funded accounts: juror ${jurorKey.address}, hot wallet ${hotWallet.address}\n`);
  } else {
    console.log("\n=== THROWAWAY TESTNET ACCOUNTS (not credentials; do not save or reuse) ===");
    console.log(`juror key   ${jurorKey.address}  pk ${jurorKey.privateKey}`);
    console.log(`hot wallet  ${hotWallet.address}  pk ${hotWallet.privateKey}`);
    console.log("=== they exist only to prove ATS rejects them; discard after this run ===");
    console.log("=== to retry without re-funding: JUROR_PK=<above> HOT_PK=<above> npm run ats:issue ===\n");
  }

  // Top up only what is short, so a retry against funded accounts sends nothing.
  for (const [label, account, target] of [
    ["juror key", jurorKey, JUROR_KEY_FUNDING],
    ["hot wallet", hotWallet, HOT_WALLET_FUNDING],
  ] as const) {
    const balance = (await provider.getBalance(account.address)) / 10_000_000_000n;
    if (balance >= target) {
      console.log(`${label} already holds ${hbar(balance)}, skipping funding`);
      continue;
    }
    const topUp = target - balance;
    const tx = await operator.sendTransaction({ to: account.address, value: tinybarToWeibar(topUp) });
    await tx.wait();
    console.log(`funded ${label} with ${hbar(topUp)}  tx ${tx.hash}`);
  }

  const treasury = contract(treasuryAddress, TREASURY_ABI, operator);
  const registeredHotWallet: string = await treasury.hotWalletOf(jurorKey.address);
  if (registeredHotWallet === ZeroAddress) {
    const registerJuror = await treasury.registerJuror(jurorKey.address, hotWallet.address);
    await registerJuror.wait();
    console.log(`registered juror in JurorTreasury  tx ${registerJuror.hash}`);
  } else if (registeredHotWallet.toLowerCase() !== hotWallet.address.toLowerCase()) {
    throw new Error(
      `${jurorKey.address} is already registered with hot wallet ${registeredHotWallet}, but HOT_PK is ` +
        `${hotWallet.address}. JurorTreasury registration is one-time, so pass the matching HOT_PK.`,
    );
  } else {
    console.log(`juror already registered in JurorTreasury, skipping`);
  }

  const equityConfigVersion = await resolveEquityConfigVersion(provider, atsResolver);
  console.log(`equity configuration version ${equityConfigVersion} (resolved from the resolver)`);

  // Roles are granted inside deployEquity through rbacs, so the market needs no separate grant transactions.
  const rbacs = [
    { role: ATS_ROLES.DEFAULT_ADMIN, members: [operator.address] },
    { role: ATS_ROLES.ISSUER, members: [marketAddress] },
    { role: ATS_ROLES.CONTROLLER, members: [marketAddress] },
    { role: ATS_ROLES.CONTROL_LIST, members: [marketAddress] },
    { role: ATS_ROLES.CORPORATE_ACTION, members: [operator.address] },
  ];

  const equityData = {
    security: {
      resolver: atsResolver,
      maxSupply: MAX_SHARE_SUPPLY,
      resolverProxyConfiguration: { key: EQUITY_CONFIG_ID, version: equityConfigVersion },
      // ATS validates the ISO 6166 check digit: "US00000000" + check digit 2. assertValidEquityValues recomputes it.
      erc20MetadataInfo: { name: "Nyaya Juror A Share", symbol: "NYJA", isin: "US0000000002", decimals: 2 },
      rbacs,
      externalPauses: [],
      externalControlLists: [],
      externalKycLists: [],
      compliance: ZeroAddress,
      identityRegistry: ZeroAddress,
      arePartitionsProtected: false,
      isMultiPartition: false,
      isControllable: true,
      // false = blacklist mode: listed addresses are blocked. Whitelist mode would block everyone else
      // instead, and our blocking test would silently prove nothing.
      isWhiteList: false,
      clearingActive: false,
      // Off, so a judge can buy without an identity flow. The control list stays fully active either way.
      internalKycActivated: false,
      erc20VotesActivated: false,
    },
    equityDetails: {
      votingRight: false,
      informationRight: false,
      liquidationRight: false,
      subscriptionRight: false,
      conversionRight: false,
      redemptionRight: true,
      putRight: false,
      dividendRight: 2, // DividendType.COMMON: pro-rata across holders, which is what the skim is
      currency: "0x555344", // "USD"
      nominalValue: 100n,
      nominalValueDecimals: 2,
    },
  };

  // RegulationType.NONE is rejected: _isValidTypeAndSubType only accepts REG_S with subtype NONE, or REG_D with
  // a 506 subtype. REG_S records a resale hold period, but that value appears nowhere in ATS's transfer
  // enforcement, so it is metadata and does not lock our trades.
  const regulationData = {
    regulationType: 1, // RegulationType.REG_S
    regulationSubType: 0, // RegulationSubType.NONE, the only subtype REG_S allows
    additionalSecurityData: { countriesControlListType: false, listOfCountries: "", info: "Nyaya juror share" },
  };

  const abi = factoryAbi();
  const inputs = deployEquityInputs(abi);
  assertMatchesAbi(inputs[0].components ?? [], equityData, "equityData");
  assertMatchesAbi(inputs[1].components ?? [], regulationData, "factoryRegulationData");
  // Shape is not enough: ATS also rejects bad values, which assertMatchesAbi cannot see.
  assertValidEquityValues(equityData, regulationData);
  console.log("struct shapes match the ATS ABI, and the values pass ATS's own checks");

  // Send an explicit gasLimit so ethers never calls eth_estimateGas. Hedera's relay runs estimation and eth_call
  // through a simulation path that reverts with empty data on calls which themselves deploy contracts, and
  // deployEquity deploys a proxy. Letting the transaction run puts the real failure, if any, in the receipt.
  const factory = new Contract(factoryAddress, abi as InterfaceAbi, operator);
  console.log(`sending deployEquity with an explicit gas limit of ${DEPLOY_GAS_LIMIT} (no gas estimation)`);
  const deployTx = await factory.deployEquity(equityData, regulationData, { gasLimit: DEPLOY_GAS_LIMIT });
  console.log(`  tx ${deployTx.hash} sent; waiting...`);
  const receipt = await deployTx.wait();
  if (receipt.status !== 1) {
    throw new Error(
      `deployEquity reverted on-chain in ${deployTx.hash}. Look it up on HashScan: the contract-level error there ` +
        `is more specific than anything the relay returns for a simulated call.`,
    );
  }
  const deployed = receipt.logs
    .map((log: { topics: string[]; data: string }) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: { name: string } | null) => parsed?.name === "EquityDeployed");
  const tokenAddress: string | undefined = deployed?.args?.equityAddress;
  if (!tokenAddress) throw new Error(`No EquityDeployed event in tx ${deployTx.hash}`);
  console.log(`\ndeployed ATS equity ${tokenAddress}  tx ${deployTx.hash}`);

  // The market holds ROLE_CONTROL_LIST, so this call is what puts both juror addresses on ATS's control list.
  const market = contract(marketAddress, MARKET_ABI, operator);
  const registerToken = await market.registerShareToken(jurorKey.address, tokenAddress);
  await registerToken.wait();
  console.log(`registered token with the market  tx ${registerToken.hash}`);

  const token = contract(tokenAddress, ATS_TOKEN_ABI, provider);
  const jurorBlocked = await token.isInControlList(jurorKey.address);
  const hotBlocked = await token.isInControlList(hotWallet.address);
  console.log(`control list: juror key ${jurorBlocked}, hot wallet ${hotBlocked}`);
  if (!jurorBlocked || !hotBlocked) throw new Error("Both juror addresses must be on the ATS control list");

  deployments.ats = { factory: factoryAddress, resolver: atsResolver };
  deployments.shareTokens = { ...(deployments.shareTokens ?? {}), [jurorKey.address]: tokenAddress };
  writeDeployments(deployments);
  console.log(`\nwrote token address to deployments/hedera.json`);
  console.log(`\nNext: JUROR_ADDRESS=${jurorKey.address} JUROR_PK=${jurorKey.privateKey} HOT_PK=${hotWallet.privateKey} npm run ats:prove`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

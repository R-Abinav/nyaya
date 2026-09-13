/**
 * Step 11: relay one already-declared Hedera dividend, plus every claim against it so far, to the
 * Sepolia anchor. Manually invoked, same posture as relaySettlement.ts.
 *
 * Defaults to juror A's declared-and-claimed dividend from step 6, already fully evidenced in
 * docs/TESTNET-EVIDENCE.md. Override with HEDERA_JUROR / HEDERA_DECLARE_TX / HEDERA_CLAIM_TXS (comma-
 * separated) to relay a different one.
 */
import { Interface } from "ethers";
import {
  artifactAbi,
  assertFunctionsExist,
  decodeLog,
  hederaDeployments,
  hederaProvider,
  send,
  sepoliaAnchorAddress,
  sepoliaSigner,
} from "./anchorConfig.js";

const GAS = { recordDistributionDeclared: 130_000n, recordDistributionClaimed: 130_000n } as const;

const DEFAULT_JUROR = "0xAD93109d571E527aA51Cc56A8E0682862866A69c";
const DEFAULT_DECLARE_TX = "0x12568cc43c822cbbb19f197936e6517f35556ea3881115597fcb25f25d63aeeb";
const DEFAULT_CLAIM_TXS = "0x18008069ff01aab0bc09765812455dd32b42f61c50a4ea3f88c77f35fb8b00bb";

async function main() {
  const juror = process.env.HEDERA_JUROR ?? DEFAULT_JUROR;
  const declareTx = process.env.HEDERA_DECLARE_TX ?? DEFAULT_DECLARE_TX;
  const claimTxs = (process.env.HEDERA_CLAIM_TXS ?? DEFAULT_CLAIM_TXS).split(",").map((s) => s.trim());

  const hedera = hederaProvider();
  const distributorAddress = hederaDeployments().distributors[juror];
  if (!distributorAddress) throw new Error(`No distributor recorded for juror ${juror} in deployments/hedera.json`);
  const distributorAbi = artifactAbi("JurorShareDistributor");
  const distributorIface = new Interface(distributorAbi as never);

  console.log(`Reading Hedera declare tx ${declareTx}...`);
  const declareReceipt = await hedera.getTransactionReceipt(declareTx);
  if (!declareReceipt) throw new Error(`No receipt for ${declareTx} on Hedera`);
  const declared = decodeLog<{
    name: "DividendDeclared";
    args: { dividendId: bigint; pot: bigint; amountPerUnit: bigint; supply: bigint };
  }>(declareReceipt, distributorIface, "DividendDeclared");
  const { dividendId, pot, amountPerUnit } = declared.args;
  console.log(`  DividendDeclared: dividendId=${dividendId} pot=${pot} amountPerUnit=${amountPerUnit}`);

  const claims: { holder: string; amount: bigint }[] = [];
  for (const claimTx of claimTxs) {
    console.log(`Reading Hedera claim tx ${claimTx}...`);
    const claimReceipt = await hedera.getTransactionReceipt(claimTx);
    if (!claimReceipt) throw new Error(`No receipt for ${claimTx} on Hedera`);
    const claimed = decodeLog<{ name: "DividendClaimed"; args: { dividendId: bigint; holder: string; amount: bigint } }>(
      claimReceipt,
      distributorIface,
      "DividendClaimed",
    );
    if (claimed.args.dividendId !== dividendId) {
      throw new Error(`${claimTx}'s DividendClaimed is for dividendId ${claimed.args.dividendId}, not ${dividendId}.`);
    }
    console.log(`  DividendClaimed: holder=${claimed.args.holder} amount=${claimed.args.amount}`);
    claims.push({ holder: claimed.args.holder, amount: claimed.args.amount });
  }

  const { provider, operator } = sepoliaSigner();
  const anchorAddress = sepoliaAnchorAddress();
  const anchorAbi = artifactAbi("NyayaAnchor");
  assertFunctionsExist(anchorAbi, ["recordDistributionDeclared", "recordDistributionClaimed"], "NyayaAnchor");
  const anchorIface = new Interface(anchorAbi as never);

  const declaredReceipt = await send(
    provider,
    operator,
    "recordDistributionDeclared",
    {
      to: anchorAddress,
      data: anchorIface.encodeFunctionData("recordDistributionDeclared", [juror, dividendId, pot, amountPerUnit]),
    },
    GAS.recordDistributionDeclared,
  );
  console.log(`  Distribution (Declared) tx: ${declaredReceipt.hash}`);

  for (const claim of claims) {
    const claimedReceipt = await send(
      provider,
      operator,
      `recordDistributionClaimed(${claim.holder})`,
      {
        to: anchorAddress,
        data: anchorIface.encodeFunctionData("recordDistributionClaimed", [juror, dividendId, claim.holder, claim.amount]),
      },
      GAS.recordDistributionClaimed,
    );
    console.log(`  Distribution (Claimed, ${claim.holder}) tx: ${claimedReceipt.hash}`);
  }

  console.log(`\nRelayed dividend ${dividendId} for juror ${juror} to the Sepolia anchor at ${anchorAddress}.`);
  console.log(`  Mirrors Hedera declare tx: ${declareTx}`);
  console.log(`  Mirrors Hedera claim tx(es): ${claimTxs.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

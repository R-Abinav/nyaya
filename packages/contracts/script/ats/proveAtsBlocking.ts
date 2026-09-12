/**
 * Phase 2: prove on Hedera testnet what the mock only claims.
 *
 *   - a real third-party buy succeeds
 *   - a buy from the juror's own key reverts with ATS's AccountIsBlocked
 *   - a buy from the juror's hot wallet reverts the same way
 *
 * Each blocked attempt is run twice: eth_call first, to read the revert data and decode which error it is,
 * then a real transaction, so there is a hash on HashScan. "It reverted" is not evidence; the selector is.
 * The script ends with a divergence report against test/mocks/MockAtsToken.sol, which is the reason this runs.
 *
 * Run: set -a; source .env; set +a && JUROR_ADDRESS=0x.. JUROR_PK=0x.. HOT_PK=0x.. npm run ats:prove
 */
import { Wallet, Interface, id as keccakId } from "ethers";
import {
  ATS_TOKEN_ABI,
  MARKET_ABI,
  TINYBAR,
  connect,
  contract,
  hbar,
  readDeployments,
  requireContract,
  tinybarToWeibar,
} from "./atsConfig.js";

/**
 * Sizes are deliberately small: testnet HBAR is capped at 100/day from the faucet, and purchase size is
 * irrelevant to what this proves. The exact 100-costs-102 split is already covered by the forge tests; what
 * only testnet can show is that real ATS admits a third party and rejects both juror-owned addresses.
 */
const TRADE_VALUE = 10n * TINYBAR; // buyer pays 10.2: 7 to treasury, 3 to reserve, 0.2 fee
const BUYER_FUNDING = 20n * TINYBAR;
/**
 * The blocked accounts hold ~3 HBAR each, so their attempt must be small enough to be affordable. A 10.2 HBAR
 * attempt from a 3 HBAR account would fail on insufficient funds before it ever reached ATS, which would prove
 * nothing about the control list. The attempt size does not need to match the successful buy.
 */
const BLOCKED_TRADE_VALUE = 1n * TINYBAR; // 1.02 paid, leaving the rest for gas
const OPERATOR_HEADROOM = 5n * TINYBAR;
/**
 * Explicit, so ethers never calls eth_estimateGas for a transaction that is meant to revert.
 *
 * Deliberately its own constant, unrelated to the issuance script's deploy limit: that one is large because
 * deployEquity deploys a proxy, while a blocked buy reverts at ATS's compliance check and never reaches 200k.
 * They must not drift together. Hedera reserves gasLimit x gasPrice + value from the sender's balance up front,
 * whatever the transaction actually burns, so an oversized limit fails a well-funded account for no reason.
 */
const BLOCKED_GAS_LIMIT = 500_000n;
const MIRROR_NODE = process.env.HEDERA_MIRROR_NODE ?? "https://testnet.mirrornode.hedera.com";

/** The mirror node keeps the revert data of a failed transaction, which the relay's receipt does not carry. */
async function mirrorNodeErrorMessage(hash: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(`${MIRROR_NODE}/api/v1/contracts/results/${hash}`);
    if (response.ok) {
      const body = (await response.json()) as { error_message?: string };
      if (body.error_message && body.error_message !== "0x") return body.error_message;
      if (body.error_message === "0x") return "0x";
    }
    await new Promise((resolve) => setTimeout(resolve, 2000)); // the mirror node lags the relay slightly
  }
  return undefined;
}

const fee = (tradeValue: bigint): bigint => (tradeValue * 200n) / 10_000n;

const ACCOUNT_IS_BLOCKED = keccakId("AccountIsBlocked(address)").slice(0, 10);
const ACCOUNT_HAS_NO_ROLES = keccakId("AccountHasNoRoles(address,bytes32[])").slice(0, 10);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (printed by the issuance script).`);
  return value;
}

/** Reads the raw revert data out of whatever shape ethers hands back. */
function revertData(error: unknown): string | undefined {
  const e = error as { data?: unknown; info?: { error?: { data?: unknown } }; error?: { data?: unknown } };
  for (const candidate of [e?.data, e?.info?.error?.data, e?.error?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) return candidate;
  }
  return undefined;
}

function describeRevert(data: string | undefined): string {
  if (!data || data === "0x") return "no revert data returned";
  const selector = data.slice(0, 10);
  if (selector === ACCOUNT_IS_BLOCKED) {
    const [account] = new Interface(ATS_TOKEN_ABI).decodeErrorResult("AccountIsBlocked", data);
    return `ATS AccountIsBlocked(${account})`;
  }
  if (selector === ACCOUNT_HAS_NO_ROLES) return `ATS AccountHasNoRoles — the market is missing a role`;
  return `some other error, selector ${selector}`;
}

async function main() {
  const { provider, operator } = connect();
  const deployments = readDeployments();
  const marketAddress = requireContract(deployments, "JurorShareMarket");
  const juror = env("JUROR_ADDRESS");
  const tokenAddress = deployments.shareTokens?.[juror];
  if (!tokenAddress) throw new Error(`No share token recorded for ${juror}. Run the issuance script first.`);

  const operatorBalance = await provider.getBalance(operator.address);
  if (operatorBalance < tinybarToWeibar(BUYER_FUNDING + OPERATOR_HEADROOM)) {
    throw new Error(
      `Operator ${operator.address} holds ${hbar(operatorBalance / 10_000_000_000n)}, but this run needs about ` +
        `${hbar(BUYER_FUNDING + OPERATOR_HEADROOM)}. Top up from the Hedera testnet faucet; nothing has been sent yet.`,
    );
  }

  const token = contract(tokenAddress, ATS_TOKEN_ABI, provider);
  const marketRead = contract(marketAddress, MARKET_ABI, provider);
  console.log(`token ${tokenAddress} (${await token.name()} / ${await token.symbol()})`);
  console.log(`price ${hbar(await marketRead.priceOf(juror))} per share\n`);

  // --- a real third party buys ---
  // SKIP_BUY=<hash of an earlier successful buy> re-runs only the blocked attempts, so a retry costs no HBAR
  // beyond gas. The buy is the expensive half.
  let buyTxHash = process.env.SKIP_BUY ?? "";
  if (buyTxHash) {
    console.log(`THIRD-PARTY BUY: reusing the earlier successful buy ${buyTxHash}\n`);
  } else {
    const buyer = process.env.BUYER_PK ? new Wallet(process.env.BUYER_PK, provider) : Wallet.createRandom().connect(provider);
    if (!process.env.BUYER_PK) {
      console.log("=== THROWAWAY TESTNET ACCOUNT (not a credential; do not save or reuse) ===");
      console.log(`buyer ${buyer.address}  pk ${buyer.privateKey}`);
      console.log("=== created only for this proof run ===\n");
    }
    const balance = (await provider.getBalance(buyer.address)) / 10_000_000_000n;
    if (balance < BUYER_FUNDING) {
      const funding = await operator.sendTransaction({ to: buyer.address, value: tinybarToWeibar(BUYER_FUNDING - balance) });
      await funding.wait();
    }

    const buyTx = await contract(marketAddress, MARKET_ABI, buyer).buy(juror, TRADE_VALUE, {
      value: tinybarToWeibar(TRADE_VALUE + fee(TRADE_VALUE)),
    });
    const buyReceipt = await buyTx.wait();
    const buyerShares = await token.balanceOf(buyer.address);
    buyTxHash = buyTx.hash;
    console.log(`THIRD-PARTY BUY: status ${buyReceipt.status === 1 ? "success" : "FAILED"}  tx ${buyTx.hash}`);
    console.log(`  buyer now holds ${buyerShares} share units\n`);
    if (buyReceipt.status !== 1 || buyerShares === 0n) throw new Error("the third-party buy did not succeed");
  }

  // --- the two blocked accounts ---
  const blocked = [
    { label: "juror's own key", wallet: new Wallet(env("JUROR_PK"), provider) },
    { label: "juror's hot wallet", wallet: new Wallet(env("HOT_PK"), provider) },
  ];

  const results: { label: string; decoded: string; txHash: string; status: string; onChainError: string }[] = [];
  for (const { label, wallet } of blocked) {
    const asBlocked = contract(marketAddress, MARKET_ABI, wallet);
    const value = tinybarToWeibar(BLOCKED_TRADE_VALUE + fee(BLOCKED_TRADE_VALUE));
    const balance = await provider.getBalance(wallet.address);
    // Hedera reserves the whole gas allowance plus the value up front, so check against that, not just value.
    const gasPrice = (await provider.getFeeData()).maxFeePerGas ?? 0n;
    const reserved = BLOCKED_GAS_LIMIT * gasPrice;
    if (balance < reserved + value) {
      const asHbar = (weibar: bigint) => hbar(weibar / 10_000_000_000n);
      throw new Error(
        `${label} (${wallet.address}) cannot cover this attempt, and it would fail on funds before reaching ATS, ` +
          `proving nothing.\n` +
          `  holds:          ${asHbar(balance)}\n` +
          `  gas reserved:   ${asHbar(reserved)} (${BLOCKED_GAS_LIMIT} gas x ${gasPrice} weibar, reserved up front whatever it burns)\n` +
          `  value sent:     ${asHbar(value)} (${hbar(BLOCKED_TRADE_VALUE)} trade + 2% fee)\n` +
          `  short by:       ${asHbar(reserved + value - balance)}\n` +
          `Either top this account up or lower BLOCKED_GAS_LIMIT; a blocked buy reverts well under 200k gas.`,
      );
    }

    let decoded = "call unexpectedly succeeded";
    try {
      await asBlocked.buy.staticCall(juror, BLOCKED_TRADE_VALUE, { value });
    } catch (error) {
      decoded = describeRevert(revertData(error));
    }

    // Send it for real, so a judge can open the rejection on HashScan rather than trusting a local eth_call.
    // Sign and broadcast the raw transaction: going through the contract helper lets the relay refuse a
    // transaction it predicts will revert, which leaves no hash at all. An explicit gasLimit also keeps ethers
    // away from eth_estimateGas, the same fix deployEquity needed.
    let txHash = "not sent";
    let status = "n/a";
    let onChainError = "not read";
    try {
      const populated = await asBlocked.buy.populateTransaction(juror, BLOCKED_TRADE_VALUE, { value });
      const signed = await wallet.signTransaction({
        ...populated,
        gasLimit: BLOCKED_GAS_LIMIT,
        nonce: await provider.getTransactionCount(wallet.address),
        chainId: (await provider.getNetwork()).chainId,
        maxFeePerGas: (await provider.getFeeData()).maxFeePerGas,
        maxPriorityFeePerGas: 0n,
      });
      const sent = await provider.broadcastTransaction(signed);
      txHash = sent.hash;
      const receipt = await provider.waitForTransaction(sent.hash);
      status = receipt?.status === 1 ? "SUCCEEDED (wrong!)" : "reverted on chain, status 0";
      onChainError = describeRevert(await mirrorNodeErrorMessage(sent.hash));
    } catch (error) {
      const e = error as { transactionHash?: string; receipt?: { hash?: string }; shortMessage?: string };
      txHash = e.transactionHash ?? e.receipt?.hash ?? `not broadcast (${e.shortMessage ?? "unknown"})`;
      status = "not on chain";
    }

    results.push({ label, decoded, txHash, status, onChainError });
    console.log(`BLOCKED BUY from ${label} (${wallet.address})`);
    console.log(`  eth_call error:   ${decoded}`);
    console.log(`  transaction:      ${txHash} (${status})`);
    console.log(`  on-chain error:   ${onChainError}\n`);
  }

  // --- the point of the exercise ---
  const bothBlockedByAts = results.every((r) => r.decoded.startsWith("ATS AccountIsBlocked"));
  const bothOnChain = results.every((r) => r.onChainError.startsWith("ATS AccountIsBlocked"));
  console.log("=== divergence report: real ATS vs test/mocks/MockAtsToken.sol ===");
  console.log(`both blocked buys rejected by ATS's AccountIsBlocked: ${bothBlockedByAts ? "yes" : "NO"}`);
  console.log(`both rejections recorded on-chain with that error:     ${bothOnChain ? "yes" : "NO"}`);
  if (!bothBlockedByAts) {
    console.log("The mock and real ATS disagree. What real ATS returned is above; update the mock to match,");
    console.log("then re-run forge test, because the unit tests are only meaningful if the mock reverts the same way.");
  }
  console.log(`third-party buy tx:  ${buyTxHash}`);
  for (const r of results) console.log(`${r.label} tx: ${r.txHash}`);
  if (!bothBlockedByAts) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

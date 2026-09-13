/**
 * Proves the core mechanics on Hedera testnet, against the already-deployed contracts.
 *
 * Everything proven so far had one juror, one correct verdict and no slashing, so the parimutuel split itself
 * had never run on a real chain. Each phase is separately runnable, because deadlines are real and a failure in
 * one should not force re-running the others:
 *
 *   PHASE=setup       register and fund two more jurors (once; prints their keys for the other phases)
 *   PHASE=parimutuel  the A/B/C worked example: two correct with different stakes, one wrong and slashed
 *   PHASE=rollover    a case nobody wins, then which later case its slashed stakes reach
 *   PHASE=market      a real buy, checking the 70/30 split and the 2% fee from on-chain balances
 *
 * Assertions are findings, not decoration: any failure is printed as FAIL and the script exits non-zero.
 *
 * All five Hedera footguns from contracts.md are applied, including converting weibar to tinybars before any
 * comparison, which is what produced a false divergence in the distribution run.
 */
import { Contract, Interface, Wallet, JsonRpcProvider, type TransactionReceipt, type LogDescription } from "ethers";
import {
  TINYBAR,
  artifactAbi,
  assertFunctionsExist,
  connect,
  hbar,
  readDeployments,
  requireContract,
  tinybarToWeibar,
} from "./atsConfig.js";

// --- footgun 1: a gas limit per call, never one shared value ---
const GAS = {
  registerJuror: 200_000n,
  fund: 200_000n,
  transfer: 100_000n,
  openCase: 500_000n,
  withdrawForEvidence: 500_000n,
  commit: 600_000n,
  reveal: 400_000n,
  submitOutcome: 300_000n,
  settle: 2_000_000n,
  buy: 1_500_000n,
} as const;

const CALLS = {
  resolver: [
    "openCase",
    "commit",
    "reveal",
    "submitOutcome",
    "settle",
    "withdrawForEvidence",
    "commitmentFor",
    "caseBountyTreasury",
    "rolloverPool",
    "rolloverUpdatedAt",
    "returnBps",
    "cumulativeNet",
    "caseCount",
  ],
  treasury: ["registerJuror", "fund", "balanceOf", "lockedStake", "hotWalletOf", "x402Spend"],
  market: ["buy", "priceOf", "reserveOf"],
} as const;

const RULING = { NO: 1, YES: 2 } as const;
const CONFIDENCE_BPS = 7000;
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const SALT = "0x" + "5a".repeat(32);

/** The worked example at one tenth scale, so it fits a testnet faucet. Shape and rounding are identical. */
const BOUNTY = 2n * TINYBAR;
const STAKE_A = 5n * TINYBAR;
const STAKE_B = 1n * TINYBAR;
const STAKE_C = 3n * TINYBAR;
const SPEND_A = TINYBAR / 2n; // 10% of stake, matching B's ratio so returns must come out equal
const SPEND_B = TINYBAR / 10n;
/** Small, because the rollover phase runs three cases off whatever the parimutuel phase left in the treasuries. */
const ROLLOVER_STAKE = TINYBAR / 2n;
const JUROR_GAS_FUNDING = 3n * TINYBAR;

const asTinybar = (weibar: bigint) => weibar / 10_000_000_000n;
const wait = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));

let failures = 0;
function expect(label: string, actual: bigint | boolean | string, expected: bigint | boolean | string): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${expected}\n        actual   ${actual}`}`);
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** Footguns 2 and 4: cover gasLimit x gasPrice + value first, then sign and broadcast raw. */
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
  if (balance < gasLimit * gasPrice + value) {
    throw new Error(
      `${label}: ${signer.address} cannot cover it. holds ${hbar(asTinybar(balance))}, ` +
        `needs ${hbar(asTinybar(gasLimit * gasPrice))} gas + ${hbar(asTinybar(value))} value`,
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
  console.log(`  ${label}: ${receipt.status === 1 ? "ok" : "REVERTED"}  ${sent.hash}`);
  if (receipt.status !== 1) throw new Error(`${label} reverted: ${sent.hash}`);
  return receipt;
}

function parse(iface: Interface, receipt: TransactionReceipt, name: string): LogDescription[] {
  return receipt.logs
    .map((log) => {
      try {
        return iface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((p): p is LogDescription => p?.name === name);
}

async function main() {
  const phase = process.env.PHASE ?? "parimutuel";
  const { provider, operator } = connect();
  const d = readDeployments();
  const resolverAddress = requireContract(d, "NyayaResolver");
  const treasuryAddress = requireContract(d, "JurorTreasury");
  const marketAddress = requireContract(d, "JurorShareMarket");

  const resolverAbi = artifactAbi("NyayaResolver");
  const treasuryAbi = artifactAbi("JurorTreasury");
  const marketAbi = artifactAbi("JurorShareMarket");
  assertFunctionsExist(resolverAbi, [...CALLS.resolver], "NyayaResolver");
  assertFunctionsExist(treasuryAbi, [...CALLS.treasury], "JurorTreasury");
  assertFunctionsExist(marketAbi, [...CALLS.market], "JurorShareMarket");

  const resolver = new Contract(resolverAddress, resolverAbi as never, provider);
  const treasury = new Contract(treasuryAddress, treasuryAbi as never, provider);
  const market = new Contract(marketAddress, marketAbi as never, provider);
  const rIface = new Interface(resolverAbi as never);
  const tIface = new Interface(treasuryAbi as never);
  const mIface = new Interface(marketAbi as never);

  const jurorA = new Wallet(env("JUROR_PK"), provider);
  console.log(`phase ${phase}, operator ${operator.address} (${hbar(asTinybar(await provider.getBalance(operator.address)))})\n`);

  const openCase = async (label: string, commitAt: number, resolveAt: number, bounty = BOUNTY) => {
    const receipt = await send(
      provider,
      operator,
      `openCase ${label}`,
      {
        to: resolverAddress,
        data: rIface.encodeFunctionData("openCase", ["github-stars", label, commitAt, resolveAt]),
        value: tinybarToWeibar(bounty),
      },
      GAS.openCase,
    );
    return parse(rIface, receipt, "CaseOpened")[0].args.caseId as bigint;
  };

  const commit = async (juror: Wallet, caseId: bigint, ruling: number, stake: bigint) => {
    const commitment = await resolver.commitmentFor(caseId, juror.address, ruling, CONFIDENCE_BPS, SALT);
    await send(
      provider,
      juror,
      `commit ${juror.address.slice(0, 8)} to case ${caseId}`,
      { to: resolverAddress, data: rIface.encodeFunctionData("commit", [caseId, commitment, stake]) },
      GAS.commit,
    );
  };

  const reveal = (juror: Wallet, caseId: bigint, ruling: number) =>
    send(
      provider,
      juror,
      `reveal ${juror.address.slice(0, 8)} on case ${caseId}`,
      { to: resolverAddress, data: rIface.encodeFunctionData("reveal", [caseId, ruling, CONFIDENCE_BPS, SALT, CID]) },
      GAS.reveal,
    );

  const resolveAndSettle = async (caseId: bigint, outcome: number) => {
    await send(
      provider,
      operator,
      `submitOutcome case ${caseId}`,
      { to: resolverAddress, data: rIface.encodeFunctionData("submitOutcome", [caseId, outcome, CID]) },
      GAS.submitOutcome,
    );
    return send(
      provider,
      operator,
      `settle case ${caseId}`,
      { to: resolverAddress, data: rIface.encodeFunctionData("settle", [caseId]) },
      GAS.settle,
    );
  };

  // ==================== setup ====================
  if (phase === "setup") {
    const jurorB = Wallet.createRandom().connect(provider);
    const jurorC = Wallet.createRandom().connect(provider);
    console.log("=== THROWAWAY TESTNET ACCOUNTS (not credentials; do not save or reuse) ===");
    console.log(`juror B ${jurorB.address}  pk ${jurorB.privateKey}`);
    console.log(`juror C ${jurorC.address}  pk ${jurorC.privateKey}`);
    console.log("=== pass these as JUROR_B_PK and JUROR_C_PK to the other phases ===\n");

    for (const [label, juror, treasuryTop] of [
      ["B", jurorB, STAKE_B + SPEND_B + TINYBAR],
      ["C", jurorC, STAKE_C + TINYBAR],
    ] as const) {
      await send(provider, operator, `fund juror ${label} for gas`, { to: juror.address, value: tinybarToWeibar(JUROR_GAS_FUNDING) }, GAS.transfer);
      await send(
        provider,
        operator,
        `registerJuror ${label}`,
        { to: treasuryAddress, data: tIface.encodeFunctionData("registerJuror", [juror.address, Wallet.createRandom().address]) },
        GAS.registerJuror,
      );
      await send(
        provider,
        operator,
        `fund juror ${label}'s treasury`,
        { to: treasuryAddress, data: tIface.encodeFunctionData("fund", [juror.address]), value: tinybarToWeibar(treasuryTop) },
        GAS.fund,
      );
    }
    // Top juror A's treasury up for its stake and evidence spend.
    const needA = STAKE_A + SPEND_A + TINYBAR;
    const haveA: bigint = await treasury.balanceOf(jurorA.address);
    if (haveA < needA) {
      await send(
        provider,
        operator,
        "top up juror A's treasury",
        { to: treasuryAddress, data: tIface.encodeFunctionData("fund", [jurorA.address]), value: tinybarToWeibar(needA - haveA) },
        GAS.fund,
      );
    }
    console.log("\nsetup done. Re-run with PHASE=parimutuel and the two keys above.");
    return;
  }

  // ==================== the A/B/C worked example ====================
  if (phase === "parimutuel") {
    const jurorB = new Wallet(env("JUROR_B_PK"), provider);
    const jurorC = new Wallet(env("JUROR_C_PK"), provider);
    const now = Math.floor(Date.now() / 1000);
    const commitDeadline = now + 90;
    const resolutionTime = commitDeadline + 90;

    const caseId = await openCase("parimutuel", commitDeadline, resolutionTime);

    // Evidence spend, so the returns comparison is not the trivial zero-spend case: both jurors spend 10% of
    // their stake, so alpha matches and their returns must come out equal despite a 5x stake difference.
    await send(
      provider,
      jurorA,
      "juror A withdraws for evidence",
      { to: resolverAddress, data: rIface.encodeFunctionData("withdrawForEvidence", [caseId, SPEND_A]) },
      GAS.withdrawForEvidence,
    );
    await send(
      provider,
      jurorB,
      "juror B withdraws for evidence",
      { to: resolverAddress, data: rIface.encodeFunctionData("withdrawForEvidence", [caseId, SPEND_B]) },
      GAS.withdrawForEvidence,
    );

    await commit(jurorA, caseId, RULING.YES, STAKE_A);
    await commit(jurorB, caseId, RULING.YES, STAKE_B);
    await commit(jurorC, caseId, RULING.NO, STAKE_C);

    const treasuryCBefore = (await treasury.balanceOf(jurorC.address)) as bigint;
    const cbtBefore = (await resolver.caseBountyTreasury()) as bigint;

    console.log("  waiting 95s for the commit deadline...");
    await wait(95);
    await reveal(jurorA, caseId, RULING.YES);
    await reveal(jurorB, caseId, RULING.YES);
    await reveal(jurorC, caseId, RULING.NO);

    console.log("  waiting 90s for the resolution time...");
    await wait(90);
    const settleReceipt = await resolveAndSettle(caseId, RULING.YES);

    const settled = parse(rIface, settleReceipt, "JurorSettled");
    const caseSettled = parse(rIface, settleReceipt, "CaseSettled")[0];
    const byJuror = new Map(settled.map((e) => [String(e.args.juror).toLowerCase(), e.args]));
    const a = byJuror.get(jurorA.address.toLowerCase())!;
    const b = byJuror.get(jurorB.address.toLowerCase())!;
    const c = byJuror.get(jurorC.address.toLowerCase())!;
    const pool = caseSettled.args.pool as bigint;
    const correctStake = caseSettled.args.correctStake as bigint;
    const remainder = caseSettled.args.remainderToCaseBountyTreasury as bigint;

    console.log(`\n  pool ${hbar(pool)}, correct stake ${hbar(correctStake)}`);
    console.log("\n--- the parimutuel split, on real state ---");
    expect("pool = bounty + slashed stake", pool, BOUNTY + STAKE_C);
    expect("correct stake = A + B", correctStake, STAKE_A + STAKE_B);
    expect("A's reward = floor(P*s/S)", a.reward as bigint, (pool * STAKE_A) / correctStake);
    expect("B's reward = floor(P*s/S)", b.reward as bigint, (pool * STAKE_B) / correctStake);
    expect("rewards + remainder = pool", (a.reward as bigint) + (b.reward as bigint) + remainder, pool);
    expect(
      "the remainder reached the Case Bounty Treasury",
      ((await resolver.caseBountyTreasury()) as bigint) - cbtBefore,
      remainder,
    );

    console.log("\n--- equal returns despite a 5x stake difference ---");
    expect("A's spend was read from tagged withdrawals", a.x402Spend as bigint, SPEND_A);
    expect("B's spend was read from tagged withdrawals", b.x402Spend as bigint, SPEND_B);
    expect("A and B have equal returns", (await resolver.returnBps(jurorA.address)) as bigint, (await resolver.returnBps(jurorB.address)) as bigint);
    // The identity, cross-multiplied so no rounding enters: (P*sA - xA*S)(sB + xB) == (P*sB - xB*S)(sA + xA)
    const lhs = (pool * STAKE_A - SPEND_A * correctStake) * (STAKE_B + SPEND_B);
    const rhs = (pool * STAKE_B - SPEND_B * correctStake) * (STAKE_A + SPEND_A);
    expect("the cross-multiplication identity holds", lhs, rhs);

    console.log("\n--- slashing ---");
    expect("C was recorded as Incorrect", c.result as bigint, 1n);
    expect("C's net = -(stake + spend)", c.net as bigint, -(STAKE_C + (c.x402Spend as bigint)));
    // The stake was already moved out of `available` at commit; slashing must not hand it back.
    expect("C's stake was never returned to it", (await treasury.balanceOf(jurorC.address)) as bigint, treasuryCBefore);
    expect("C holds no locked stake now", (await treasury.lockedStake(jurorC.address, caseId)) as bigint, 0n);
    expect("C's return is exactly -100%", (await resolver.returnBps(jurorC.address)) as bigint, -10_000n);

    // Settling again must revert, which is what stops a stake being slashed twice.
    let settledTwice = false;
    try {
      await provider.call({ to: resolverAddress, data: rIface.encodeFunctionData("settle", [caseId]) });
      settledTwice = true;
    } catch {
      /* expected */
    }
    expect("settling twice reverts, so a stake cannot be slashed twice", settledTwice, false);
  }

  // ==================== rollover ====================
  if (phase === "rollover") {
    const jurorB = new Wallet(env("JUROR_B_PK"), provider);
    const jurorC = new Wallet(env("JUROR_C_PK"), provider);
    const t0 = Math.floor(Date.now() / 1000);
    const until = async (offset: number, what: string) => {
      const seconds = t0 + offset - Math.floor(Date.now() / 1000);
      if (seconds > 0) {
        console.log(`  waiting ${seconds}s for ${what}...`);
        await wait(seconds);
      }
    };
    // X settles at ~t0+210 and creates the rollover. Y's commits close at t0+130, before that, so it must NOT
    // receive it. Z's commits stay open until t0+280, after it, so it must. Windows are wide enough that real
    // transaction latency cannot push a commit past its deadline.
    const x = await openCase("rollover-X", t0 + 120, t0 + 200);
    const y = await openCase("rollover-Y", t0 + 130, t0 + 300);
    const z = await openCase("rollover-Z", t0 + 280, t0 + 400);

    await commit(jurorA, x, RULING.NO, ROLLOVER_STAKE); // wrong on X
    await commit(jurorB, y, RULING.YES, ROLLOVER_STAKE); // right on Y, committed before the rollover existed

    await until(135, "X's and Y's commit deadlines");
    await reveal(jurorA, x, RULING.NO);
    await reveal(jurorB, y, RULING.YES);

    await until(205, "X's resolution time");
    const rolloverBefore = (await resolver.rolloverPool()) as bigint;
    await resolveAndSettle(x, RULING.YES); // nobody was right
    const rollover = ((await resolver.rolloverPool()) as bigint) - rolloverBefore;
    console.log(`\n  X produced a rollover of ${hbar(rollover)}`);
    expect("X's slashed stake became the rollover", rollover, ROLLOVER_STAKE);

    // Z's commit window is still open now, so its jurors can see the rollover before staking.
    await commit(jurorC, z, RULING.YES, ROLLOVER_STAKE);

    await until(305, "Y's resolution time");
    const ySettle = await resolveAndSettle(y, RULING.YES);
    const yArgs = parse(rIface, ySettle, "CaseSettled")[0].args;
    console.log("\n--- a case whose commit window closed before the rollover existed ---");
    expect("Y received nothing", yArgs.rolledIn as bigint, 0n);
    expect("Y's pool was only its own bounty", yArgs.pool as bigint, BOUNTY);
    expect("the rollover is still waiting", (await resolver.rolloverPool()) as bigint, rolloverBefore + rollover);

    await until(405, "Z's resolution time");
    const zSettle = await resolveAndSettle(z, RULING.YES);
    const zArgs = parse(rIface, zSettle, "CaseSettled")[0].args;
    console.log("\n--- a case whose commit window was open when the rollover appeared ---");
    expect("Z received the rollover", zArgs.rolledIn as bigint, rolloverBefore + rollover);
    expect("Z's pool included it", zArgs.pool as bigint, BOUNTY + rolloverBefore + rollover);
    expect("the rollover pool is now empty", (await resolver.rolloverPool()) as bigint, 0n);
  }

  // ==================== the share market split ====================
  if (phase === "market") {
    const buyer = new Wallet(env("BUYER_PK"), provider);
    const tradeValue = 5n * TINYBAR;
    const fee = (tradeValue * 200n) / 10_000n;

    const treasuryBefore = (await treasury.balanceOf(jurorA.address)) as bigint;
    const reserveBefore = (await market.reserveOf(jurorA.address)) as bigint;
    const cbtBefore = (await resolver.caseBountyTreasury()) as bigint;

    await send(
      provider,
      buyer,
      `buy ${hbar(tradeValue)} of juror A's shares`,
      { to: marketAddress, data: mIface.encodeFunctionData("buy", [jurorA.address, tradeValue]), value: tinybarToWeibar(tradeValue + fee) },
      GAS.buy,
    );

    console.log("\n--- the 70/30 split and the 2% fee, from on-chain balances ---");
    expect("70% went to the juror's treasury", ((await treasury.balanceOf(jurorA.address)) as bigint) - treasuryBefore, (tradeValue * 7_000n) / 10_000n);
    expect("30% went to the redemption reserve", ((await market.reserveOf(jurorA.address)) as bigint) - reserveBefore, tradeValue - (tradeValue * 7_000n) / 10_000n);
    expect("the 2% fee went to the Case Bounty Treasury", ((await resolver.caseBountyTreasury()) as bigint) - cbtBefore, fee);
  }

  console.log(failures === 0 ? "\nall assertions passed" : `\n${failures} ASSERTION(S) FAILED — these are findings, not noise`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

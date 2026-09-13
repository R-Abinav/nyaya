/**
 * Proves the grace boundary on the currently deployed resolver, which has no cancel function.
 *
 *   PHASE=open    opens a case, commits a small stake, and records everything part B needs to a file
 *   PHASE=assert  run after graceEnd: submitOutcome must revert, settle must revert, and the committed
 *                 stake must still be locked with no way to recover it
 *
 * graceEnd is resolutionTime + 24 hours, so part B genuinely has to wait a day; that is the constant's own
 * doing, not a testability choice. No redeploy is needed, which is why this runs against the live contracts now.
 *
 * What part B demonstrates is a real defect, not just a revert: on this deployment a case the operator never
 * resolves locks its jurors' stakes permanently. `cancel` fixes it and ships with the step 12 deploy.
 */
import { Contract, Interface, Wallet, JsonRpcProvider, type TransactionReceipt } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTRACTS_ROOT,
  TINYBAR,
  artifactAbi,
  assertFunctionsExist,
  connect,
  hbar,
  readDeployments,
  requireContract,
  tinybarToWeibar,
} from "./atsConfig.js";

const GAS = { openCase: 500_000n, commit: 600_000n } as const;
const BOUNTY = 1n * TINYBAR;
const STAKE = TINYBAR / 2n;
const CONFIDENCE_BPS = 7000;
const SALT = "0x" + "7c".repeat(32);
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const STATE_FILE = resolve(CONTRACTS_ROOT, "deployments/grace-end-run.json");

type RunState = {
  resolver: string;
  treasury: string;
  caseId: string;
  juror: string;
  stake: string;
  bounty: string;
  bountySource: string;
  opener: string;
  commitDeadline: number;
  resolutionTime: number;
  graceEnd: number;
  graceEndISO: string;
  openTx: string;
  commitTx: string;
};

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${expected}\n        actual   ${actual}`}`);
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const asTinybar = (weibar: bigint) => weibar / 10_000_000_000n;

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
    throw new Error(`${label}: ${signer.address} holds ${hbar(asTinybar(balance))}, not enough for gas plus value`);
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
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed: ${sent.hash}`);
  console.log(`  ${label}: ok  ${sent.hash}`);
  return receipt;
}

/** Decodes a revert so we assert on the specific error, not merely that the call failed. */
function revertName(error: unknown, iface: Interface): string {
  const e = error as { data?: unknown; info?: { error?: { data?: unknown } } };
  const data = [e?.data, e?.info?.error?.data].find((d) => typeof d === "string" && d.startsWith("0x")) as
    | string
    | undefined;
  if (!data || data === "0x") return "reverted with no data";
  const parsed = iface.parseError(data);
  return parsed ? parsed.name : `unknown selector ${data.slice(0, 10)}`;
}

async function main() {
  const phase = process.env.PHASE ?? "open";
  const { provider, operator } = connect();
  const d = readDeployments();
  const resolverAddress = requireContract(d, "NyayaResolver");
  const treasuryAddress = requireContract(d, "JurorTreasury");
  const resolverAbi = artifactAbi("NyayaResolver");
  const treasuryAbi = artifactAbi("JurorTreasury");
  assertFunctionsExist(resolverAbi, ["openCase", "commit", "submitOutcome", "settle", "commitmentFor", "GRACE_PERIOD"], "NyayaResolver");
  assertFunctionsExist(treasuryAbi, ["lockedStake", "balanceOf"], "JurorTreasury");
  const resolver = new Contract(resolverAddress, resolverAbi as never, provider);
  const treasury = new Contract(treasuryAddress, treasuryAbi as never, provider);
  const iface = new Interface(resolverAbi as never);

  if (phase === "open") {
    const juror = new Wallet(env("JUROR_PK"), provider);
    const now = Math.floor(Date.now() / 1000);
    const commitDeadline = now + 120;
    const resolutionTime = commitDeadline + 60;
    const gracePeriod = Number(await resolver.GRACE_PERIOD());
    const graceEnd = resolutionTime + gracePeriod;

    const openReceipt = await send(
      provider,
      operator,
      "openCase",
      {
        to: resolverAddress,
        data: iface.encodeFunctionData("openCase", ["github-stars", "grace boundary proof", commitDeadline, resolutionTime]),
        value: tinybarToWeibar(BOUNTY),
      },
      GAS.openCase,
    );
    const caseId = openReceipt.logs
      .map((log) => {
        try {
          return iface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((p) => p?.name === "CaseOpened")!.args.caseId as bigint;

    const commitment = await resolver.commitmentFor(caseId, juror.address, 2, CONFIDENCE_BPS, SALT);
    const commitReceipt = await send(
      provider,
      juror,
      "commit",
      { to: resolverAddress, data: iface.encodeFunctionData("commit", [caseId, commitment, STAKE]) },
      GAS.commit,
    );

    const state: RunState = {
      resolver: resolverAddress,
      treasury: treasuryAddress,
      caseId: caseId.toString(),
      juror: juror.address,
      stake: STAKE.toString(),
      bounty: BOUNTY.toString(),
      bountySource: "External (the operator opened and funded it)",
      opener: operator.address,
      commitDeadline,
      resolutionTime,
      graceEnd,
      graceEndISO: new Date(graceEnd * 1000).toISOString(),
      openTx: openReceipt.hash,
      commitTx: commitReceipt.hash,
    };
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

    console.log(`\ncase ${caseId} opened on resolver ${resolverAddress}`);
    console.log(`  bounty ${hbar(BOUNTY)} from ${operator.address} (external)`);
    console.log(`  juror ${juror.address} committed ${hbar(STAKE)}`);
    console.log(`  graceEnd ${graceEnd} (${state.graceEndISO})`);
    console.log(`  recorded to ${STATE_FILE}`);
    console.log(`\nNo outcome will be submitted. Run PHASE=assert after ${state.graceEndISO}.`);
    return;
  }

  // ---------- part B ----------
  if (!existsSync(STATE_FILE)) throw new Error(`No ${STATE_FILE}; run PHASE=open first.`);
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
  const nowSeconds = Math.floor(Date.now() / 1000);

  console.log(`asserting against the recorded run, not re-derived values:`);
  console.log(`  case ${state.caseId} on resolver ${state.resolver}`);
  console.log(`  graceEnd ${state.graceEndISO}\n`);
  if (state.resolver.toLowerCase() !== resolverAddress.toLowerCase()) {
    throw new Error(`This run was recorded against resolver ${state.resolver}, but deployments.json now says ${resolverAddress}.`);
  }
  if (nowSeconds < state.graceEnd) {
    throw new Error(`Too early: graceEnd is ${state.graceEndISO}, which is ${state.graceEnd - nowSeconds}s away.`);
  }

  let outcomeError = "did not revert";
  try {
    await provider.call({
      to: resolverAddress,
      from: operator.address,
      data: iface.encodeFunctionData("submitOutcome", [BigInt(state.caseId), 2, CID]),
    });
  } catch (error) {
    outcomeError = revertName(error, iface);
  }
  expect("submitOutcome reverts with OutcomeWindowClosed once graceEnd has passed", outcomeError, "OutcomeWindowClosed");

  let settleError = "did not revert";
  try {
    await provider.call({ to: resolverAddress, data: iface.encodeFunctionData("settle", [BigInt(state.caseId)]) });
  } catch (error) {
    settleError = revertName(error, iface);
  }
  expect("settle reverts too, because no outcome was ever submitted", settleError, "OutcomeNotSubmitted");

  const stillLocked = (await treasury.lockedStake(state.juror, BigInt(state.caseId))) as bigint;
  expect("the juror's stake is still locked", stillLocked, BigInt(state.stake));

  const hasCancel = artifactAbi("NyayaResolver").some((e) => e.type === "function" && e.name === "cancel");
  let cancelExistsOnChain = true;
  try {
    await provider.call({ to: resolverAddress, data: iface.encodeFunctionData("cancel", [BigInt(state.caseId)]) });
  } catch (error) {
    const name = revertName(error, iface);
    // A deployment without the function reverts with no data; one with it reverts for a reason we can name.
    cancelExistsOnChain = name !== "reverted with no data";
    console.log(`  cancel() on this deployment: ${name}`);
  }

  console.log("\n--- what this proves about the deployed resolver ---");
  console.log(`  the local build has cancel(): ${hasCancel}`);
  console.log(`  the deployed resolver answers cancel(): ${cancelExistsOnChain}`);
  if (!cancelExistsOnChain) {
    console.log(`  so ${hbar(BigInt(state.stake))} of juror stake and ${hbar(BigInt(state.bounty))} of bounty are`);
    console.log(`  permanently stuck in ${state.resolver}: no outcome can be submitted, settlement needs one,`);
    console.log(`  and there is no cancel to refund them. This is the defect cancel() fixes.`);
  }

  console.log(failures === 0 ? "\nall assertions passed" : `\n${failures} ASSERTION(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

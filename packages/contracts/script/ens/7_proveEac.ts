/**
 * Step 10, part 7: prove Enhanced Access Control against the real deployed resolver, real transaction
 * hashes, not a mock. For each juror subname:
 *
 *   1. the juror's own key writes its "profile" text record  -> must succeed
 *   2. the juror's own key writes its "score" text record    -> must fail, specifically with
 *      EACUnauthorizedAccountRoles, not merely "reverted"
 *   3. the operator writes the same subname's "score" record -> must succeed
 *   4. `text(node, "score")` is read back and must equal what the operator wrote, not the value the
 *      juror's rejected write would have set
 *
 * (1) is the positive control: without it, (2) failing would be equally true if the juror could write
 * nothing at all, which would prove the wrong thing. Every step is a real broadcast transaction; the
 * rejection's specific error is decoded by replaying the same call as `eth_call` at the confirmed block,
 * the standard way to get a revert reason on an ordinary Ethereum JSON-RPC endpoint (Sepolia here, not
 * Hashio, so this works directly, unlike the Hedera mirror-node detour step 7 needed).
 *
 * Each juror's private key is supplied fresh via JUROR_PK / JUROR_B_PK / JUROR_C_PK at invocation time
 * (not read from `.env`, which has none of these — see part 5's header). This script checks the supplied
 * key's derived address against the one part 5 recorded and granted roles to in part 6; a mismatch means
 * the wrong key was supplied, and it stops rather than silently testing the wrong account. A fresh key has
 * no Sepolia ETH, so this funds it from the operator first.
 */
import { Interface, Wallet, namehash } from "ethers";
import { JUROR_LABELS, NYAYA_NAME, abi, assertFunctionsExist, connect, contract, env, readDeployments, revertName, send, sendAllowingRevert } from "./ensConfig.js";

const GAS = { setText: 150_000n, fund: 21_000n } as const;
const JUROR_GAS_FUNDING = 5_000_000_000_000_000n; // 0.005 ETH, enough for a handful of setText calls

const JUROR_PK_ENV: Record<(typeof JUROR_LABELS)[number], string> = {
  "juror-a": "JUROR_PK",
  "juror-b": "JUROR_B_PK",
  "juror-c": "JUROR_C_PK",
};

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${expected}\n        actual   ${actual}`}`);
}

type EacProof = {
  fullName: string;
  node: string;
  jurorProfileWriteTx: string;
  jurorScoreAttemptTx: string;
  jurorScoreAttemptError: string;
  operatorScoreWriteTx: string;
  finalScoreValue: string;
};

async function main() {
  const { provider, operator } = connect();
  const resolverAbi = abi("PermissionedResolverImpl");
  assertFunctionsExist(resolverAbi, ["setText", "text"], "PermissionedResolverImpl");
  const iface = new Interface(resolverAbi as never);

  const d = readDeployments();
  const resolver = d.ens?.resolver;
  if (!resolver) throw new Error("No resolver recorded. Run 3_deployResolver.ts first.");
  const resolverContract = contract(resolver, resolverAbi, provider);

  const results: EacProof[] = [];

  for (const label of JUROR_LABELS) {
    const recordedAddress = d.ens?.jurors?.[label]?.address;
    if (!recordedAddress) throw new Error(`No address recorded for ${label}. Run 5_createJurorSubnames.ts first.`);
    const jurorWallet = new Wallet(env(JUROR_PK_ENV[label]), provider);
    if (jurorWallet.address.toLowerCase() !== recordedAddress.toLowerCase()) {
      throw new Error(
        `${JUROR_PK_ENV[label]} derives ${jurorWallet.address}, but ${label}'s recorded address is ${recordedAddress}. Wrong key supplied.`,
      );
    }
    const fullName = `${label}.${NYAYA_NAME}`;
    const node = namehash(fullName);
    console.log(`\n=== ${fullName} (${node}) ===`);

    const jurorBalance = await provider.getBalance(jurorWallet.address);
    if (jurorBalance < JUROR_GAS_FUNDING / 2n) {
      await send(
        provider,
        operator,
        `fund ${label} for gas`,
        { to: jurorWallet.address, value: JUROR_GAS_FUNDING },
        GAS.fund,
      );
    }

    // 1. juror writes profile -- positive control, must succeed
    const profileValue = `juror agent for ${label}, nemotron system prompt v1`;
    const profileReceipt = await send(
      provider,
      jurorWallet,
      `${label}: juror sets profile`,
      { to: resolver, data: iface.encodeFunctionData("setText", [node, "profile", profileValue]) },
      GAS.setText,
    );
    const profileReadBack = (await resolverContract.text(node, "profile")) as string;
    expect(`${fullName}: profile round-trips`, profileReadBack, profileValue);

    // 2. juror attempts score -- must fail, specifically
    const attemptedScore = "9999"; // if this ever lands, the negative control failed
    const scoreAttemptReceipt = await sendAllowingRevert(
      provider,
      jurorWallet,
      `${label}: juror attempts score (expected to fail)`,
      { to: resolver, data: iface.encodeFunctionData("setText", [node, "score", attemptedScore]) },
      GAS.setText,
    );
    let scoreAttemptError = "did not revert";
    if (scoreAttemptReceipt.status === 0) {
      try {
        await provider.call({
          to: resolver,
          from: jurorWallet.address,
          data: iface.encodeFunctionData("setText", [node, "score", attemptedScore]),
          blockTag: scoreAttemptReceipt.blockNumber,
        });
      } catch (error) {
        scoreAttemptError = revertName(error, iface);
      }
    }
    expect(`${fullName}: juror's score write reverts with EACUnauthorizedAccountRoles`, scoreAttemptError, "EACUnauthorizedAccountRoles");
    expect(`${fullName}: juror's score write actually failed on-chain (status 0)`, scoreAttemptReceipt.status, 0);

    // 3. operator writes score -- must succeed
    const operatorScoreValue = "0"; // genesis score; a real value is written once the juror has settled cases
    const operatorScoreReceipt = await send(
      provider,
      operator,
      `${label}: operator sets score`,
      { to: resolver, data: iface.encodeFunctionData("setText", [node, "score", operatorScoreValue]) },
      GAS.setText,
    );

    // 4. read back: must be the operator's value, not the juror's rejected attempt
    const finalScore = (await resolverContract.text(node, "score")) as string;
    expect(`${fullName}: score reads back the operator's value, not the juror's rejected attempt`, finalScore, operatorScoreValue);

    results.push({
      fullName,
      node,
      jurorProfileWriteTx: profileReceipt.hash,
      jurorScoreAttemptTx: scoreAttemptReceipt.hash,
      jurorScoreAttemptError: scoreAttemptError,
      operatorScoreWriteTx: operatorScoreReceipt.hash,
      finalScoreValue: finalScore,
    });
  }

  console.log("\n--- summary for TESTNET-EVIDENCE.md ---");
  console.log(JSON.stringify(results, null, 2));
  console.log(failures === 0 ? "\nall assertions passed" : `\n${failures} ASSERTION(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

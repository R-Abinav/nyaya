---
paths:
  - "packages/contracts/**"
---

# Contract rules

## Layout
- `src/jury/JurorTreasury.sol` — juror registry and custody of each juror's HBAR. Only the resolver can move money out.
- `src/jury/` (resolver) — case lifecycle, commit-reveal, settlement, the Case Bounty Treasury, and the only caller of the treasury's drawdown functions.
- `src/shares/` — ATS juror share tokens, the bonding curve that reads recorded return, the 70/30 purchase split, mass payout of the skim.
- `src/anchor/` — Sepolia only. Mirrors finalised results for indexing.
- `test/` for forge tests, `script/` for deploy scripts.

Nothing is vendored. All contract code here is ours.

## Toolchain
- Foundry: `forge build` and `forge test` on both chains. Deploys use a different mechanism per chain; see below. The pnpm scripts in `package.json` wrap these.
- Two RPC endpoints in `foundry.toml`, `hedera` and `sepolia`, both read from env (`${HEDERA_RPC_URL}`, `${SEPOLIA_RPC_URL}`). Never hardcode an RPC URL or a key in a script.
- Foundry only loads `.env` from `packages/contracts/`, not from the repo root. `packages/contracts/.env` is a gitignored symlink to the root `.env`, so there is still one secrets file.
- Inside Hedera's EVM, `msg.value` and balances are in tinybars (8 decimals), while the JSON-RPC relay presents 18-decimal weibars to clients. Keep units explicit everywhere HBAR moves. Verified on testnet with `HederaSmoke`: sending 10¹⁰ weibar arrived as `msg.value == 1`, and the relay reports the contract's balance as 10¹⁰.
- `evm_version = "cancun"` is verified on Hedera testnet: `HederaSmoke.ping` executed MCOPY successfully (tx `0xb87ab4b09a8e487c673ff76b85a7b66c4c80755ee4710c87a9380d4f6b349093`).
- Hedera's relay fills `contractAddress` in the receipt of a plain contract call, not just a deployment. Never infer "a contract was deployed" from `receipt.contractAddress` on Hedera.

## Deploys: two mechanisms, one per chain
- **Sepolia deploys with `forge script`.**
- **Hedera deploys with `forge create` and `cast send`, driven by a small committed script.** `forge script` cannot target Hedera through Hashio, Hedera's public JSON-RPC relay. To simulate, `forge script` forks the chain pinned to a block hash and sends EIP-1898 block parameters such as `eth_getTransactionCount(addr, {"blockHash": …})`. Hashio rejects that object form for every method, and rejects a bare block hash for `eth_getCode`; it accepts only hex block numbers and tags like `"latest"`. `--fork-block-number` does not help, because Foundry converts the number back to a hash. This was tested directly against Hashio with Foundry 1.8.1, not assumed. `forge create` does not fork, and its requests use `"latest"`, which Hashio accepts.
- Both mechanisms write addresses to a committed JSON per network so the other packages read them from one place. Never paste an address into more than one file.
- Every real deploy rewrites that network's JSON entry for every contract it deployed, unconditionally, even if the deploy was unexpected or a repeat. `forge script --broadcast` is pre-approved in `.claude/settings.json`, so this is the guard against a stray deploy leaving another package pointing at a stale address.
- **Sepolia dry-run guard:** a `forge script` run without `--broadcast` must never write the JSON. Its addresses were only simulated and exist on no chain. Use `vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)` to tell a broadcast from a dry run.
- **Hedera write rule:** `forge create` has no separate simulate-then-broadcast phase, so the Hedera script needs no dry-run guard. Instead, it writes an address only after `forge create --broadcast` has returned a real deployed address and transaction hash, parsed from `forge create --json` output (`deployedTo`, `transactionHash`), never from a guess or a precomputed address.

## What the resolver must implement
- **Two ways to open a case.** `openCase()` is permissionless, with the bounty attached as `msg.value`. A separate operator-gated function opens a case funded from the Case Bounty Treasury balance, which the resolver holds. Record each case's bounty source in the `CaseOpened` event.
- **Three jurors, equal genesis treasury.** Every juror rules on every case. No panel selection, no majority vote, no tier-based stake ceilings.
- **Commit-reveal.** A commitment is `keccak256(abi.encode(caseId, juror, ruling, confidence, salt))`. The case id and juror address are bound in so a juror cannot copy another's commitment and then replay its reveal. Commits close at the commit deadline, and reveals open after it. A reveal carries ruling, confidence, salt, and the IPFS CID of the juror's evidence trail, and nothing else. There is no spend field. Only the CID goes on-chain. A juror that commits but does not reveal is slashed as incorrect.
- **`Ruling` enum, fixed:** `enum Ruling { None, No, Yes }` in `NyayaResolver`. `abi.encode` writes it as its index (None = 0, No = 1, Yes = 2), so never reorder it. `None` can never be revealed.
- **Commit signature:** `function commit(uint256 caseId, bytes32 commitment, uint256 stake) external;`. The caller is the juror, and the stake is locked through `JurorTreasury.lockStake`. The contract's `commitmentFor(caseId, juror, ruling, confidenceBps, salt)` is a pure helper that returns the exact hash, so an agent can check its own encoding with an `eth_call`.
- **Reveal window:** from the commit deadline (inclusive) to the resolution time (exclusive). Revealing early would leak a ruling to jurors who haven't committed yet, and closing at the resolution time means every reveal is final before an outcome can be reported.
- **Reveal signature, fixed; the agent calls it exactly as written:**
  ```solidity
  function reveal(uint256 caseId, Ruling ruling, uint16 confidenceBps, bytes32 salt, string calldata evidenceCid) external;
  ```
  - The juror is not a parameter. The contract recomputes the commitment with `msg.sender` as `juror`, which is what makes a copied commitment fail.
  - The `confidence` in the commitment is this `uint16 confidenceBps`. `abi.encode` pads every field by type, so the agent must hash the same five fields in the same order with the same types.
  - `evidenceCid` is a `string` because Pinata's CIDs don't fit cleanly into `bytes32` without an encoding step on both the write side and the read side. A `string` avoids that entirely. Reveal is a low-frequency, write-once call, so the gas saved by `bytes32` isn't worth two codebases having to agree on a byte format.
- **Confidence-scaled stake, locked at commit.** Stake is locked in the juror's `JurorTreasury` balance by the resolver when the juror commits. The contract records stated confidence but does not verify it. Scaling stake to confidence is agent policy.
- **Outcome submission.** Only the operator submits a case outcome, only inside the window defined under "Grace boundary" below, and always with the IPFS CID of the resolution checker's raw evidence. Only the CID goes on-chain, never the evidence itself. This is the only off-chain input to settlement. Never add another.
- **Grace boundary.** `graceEnd = resolutionTime + 24 hours`. `submitOutcome` requires `resolutionTime <= block.timestamp < graceEnd`. From `graceEnd` onward it reverts unconditionally, including for the operator. Cancellation requires `block.timestamp >= graceEnd` and no outcome submitted. Using one boundary for both means there is no overlap, so a late submission and a cancellation can never race, and no gap in which neither path is open.
- **Cancellation.** Anyone can cancel, not just the operator. Cancellation refunds every committed juror's full stake, whether or not it revealed, and returns the bounty to its recorded source. Keep this a separate code path from the non-reveal forfeit. A non-reveal is a juror's choice and forfeits the stake; a missing outcome is a platform failure and refunds it.
- **Cancelled-case spend is still a loss.** For each juror with case-tagged withdrawals on a cancelled case, add that `x402Spend` to cumulative capital and subtract it from cumulative net. The refunded stake adds nothing to either total. Emit it as a cancelled-case loss, distinct from an incorrect-ruling loss, even though the accounting is the same.
- **Settlement math, deterministic given the outcome:**
  - `P = bounty + Σ stake` of incorrect and unrevealed jurors `+ rolloverPool`; `S = Σ stake` of correct jurors.
  - Settlement iterates the case's participants: every juror that committed or withdrew evidence money for it. Each gets a `JurorSettled` event with a `Result`: `Correct`, `Incorrect`, `Unrevealed`, or `NoCommitment` (spent on evidence but never committed; net `−x402Spend` on capital `x402Spend`). Losses share accounting but keep their cause.
  - `NoCommitment` is by definition a bug signal, never a legitimate agent decision, because agents always commit after spending. Alongside the normal accounting, settlement emits `SpentWithoutCommitting(caseId, juror, x402Spend)` so it can trigger an alert. Keep this event additive: it must never change the math.
  - Correct juror: stake returned plus `reward = P · stake / S`. Proportional to stake, never an equal split.
  - Incorrect or unrevealed juror: whole stake slashed into `P`.
  - `x402Spend` is the sum of the juror's withdrawals tagged with this case id. Settlement reads it only from that history, never from anything the juror submits.
  - `net = reward − x402Spend` if correct, `−stake − x402Spend` if not. Never drop the x402 term.
  - `return = net / (stake + x402Spend)`. This is the per-case figure. The bonding curve reads the juror's cumulative return since genesis, `Σ net / Σ (stake + x402Spend)` over all its settled cases, pre-skim. Store it as two per-juror running totals: signed cumulative net and cumulative capital. Never a mean of per-case percentages, and no sliding window.
  - Skim: `skim = floor(net × SKIM_BPS / 10000)`, with `SKIM_BPS = 2000`, on positive net only. No skim on a loss, including a correct juror that spent more than it won.
    - The juror's treasury is credited `reward − skim`. It is never an independently computed 80%, so skim plus what's kept always adds back to the net exactly.
    - The skim is held per juror in `pendingDistribution`. `releaseDistribution(juror)` is permissionless and sends it only to that juror's `distributionAddress`, which the operator sets once. That address is what feeds ATS mass payout to holders, and it is wired up when the shares are issued.
    - `Skimmed(caseId, juror, skim, retainedNet)` is emitted separately from `JurorSettled`.
    - **The track record is pre-skim.** `cumulativeNet`, `returnBps` and `JurorSettled.net` never subtract the skim. There is a test for exactly this.
  - No correct jurors: return the bounty to its source and add the slashed stakes to `rolloverPool` and set `rolloverUpdatedAt`. The rollover joins the pool of the next case that settles with a correct juror and has `commitDeadline > rolloverUpdatedAt`. A case whose commits closed before the rollover existed never receives it. `CaseSettled` reports `rolledIn` and `rolledOut` separately. External openers are credited to `refundOf` and pull the money with `withdrawRefund()`, never pushed, so a reverting opener can't block settlement. Treasury-sourced bounties go back to `caseBountyTreasury`.
  - `returnBps(juror)` = `cumulativeNet × 10000 / cumulativeCapital`, rounded toward zero. This is what the bonding curve reads.
  - Rounding: every payout is rounded down to the tinybar. Whatever is left of the pool after paying correct jurors goes to the Case Bounty Treasury, never to an individual juror. The skim is `floor(net × 20 / 100)` and the treasury credit is `net − skim`, so the skim leaves no remainder.
- **Treasury drawdown paths.** `JurorTreasury` has exactly three ways money leaves a juror's balance, all resolver-only:
  - `lockStake`
  - `slashStake`, which sends the stake to the resolver and never back to the juror
  - `withdrawForX402`

  `unlockStake` returns a locked stake to the juror. Funding (`fund`) is open to anyone. Never add a juror-callable withdrawal. The withdrawal cap and window are constructor values set at deploy.
- **Evidence withdrawals go through the resolver.** A juror calls `withdrawForEvidence(caseId, amount)`, allowed only before the case's commit deadline, and the resolver calls `JurorTreasury.withdrawForX402`.
- **x402 withdrawal path.** A capped, rate-limited withdrawal from a juror's treasury to its hot wallet, tagged with a case id at withdrawal time. The withdrawn amount counts as that case's `x402Spend`, and this is the only source settlement uses for spend. This is a documented trust leak: the contract cannot verify where the money went after it leaves.

## Share rules
- A share purchase splits its trade value 70% to the juror's treasury in the resolver and 30% to the curve reserve. Redemptions pay out only from the reserve.
- A 2% fee on trade value is charged on top of every trade: added to what a buyer pays, subtracted from what a seller receives. It accrues to the Case Bounty Treasury in the resolver. It is never carved out of the 70/30 split, so keep the fee and the split as separate code paths acting on separate amounts.
- A juror's own key and hot wallet must be blocked from holding that juror's shares. This is the anti-wash-trading control and it is a judged feature, not an optional guard.

## Events
Every state change the subgraph or UI needs must emit an event: commit, reveal (with evidence-trail CID), outcome submission (with evidence CID), per-juror settlement (stake, spend, reward, net, return, skim), spent-without-committing alert, pool remainder to the Case Bounty Treasury, cancellation (with each refund and each juror's recorded cancelled-case spend), withdrawal (with case id), share trade, distribution. The subgraph rebuilds state from event deltas and must never need an RPC call per record.

## Testing
- Forge tests are for logic. A test that passes against a mock but has never run against testnet is not evidence. After any resolver or share change, run the real end-to-end script against Hedera testnet and report the transaction hash.
- Keep a test that reproduces the worked example in `docs/ARCHITECTURE.md` (A, B and C, a 20 HBAR bounty). It asserts the rounded-down tinybar payouts exactly: A 4,166,666,666, B 833,333,333, and 1 tinybar to the Case Bounty Treasury. It checks the return identity by cross-multiplication, `(P·s_A − x_A·S)·(s_B + x_B) == (P·s_B − x_B·S)·(s_A + x_A)`, never by comparing rounded percentages.

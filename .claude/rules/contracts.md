---
paths:
  - "packages/contracts/**"
---

# Contract rules

## Layout
- `src/jury/` — the resolver: juror registry, treasury custody, case lifecycle, commit-reveal, settlement, x402 withdrawal path.
- `src/shares/` — ATS juror share tokens, the bonding curve that reads recorded return, the 70/30 purchase split, mass payout of the skim.
- `src/anchor/` — Sepolia only. Mirrors finalised results for indexing.
- `test/` for forge tests, `script/` for forge deploy scripts.

Nothing is vendored. All contract code here is ours.

## Toolchain
- Foundry: `forge build`, `forge test`, `forge script` for deploys. The pnpm scripts in `package.json` wrap these.
- Two RPC endpoints in `foundry.toml`, `hedera` and `sepolia`, both read from env (`${HEDERA_RPC_URL}`, `${SEPOLIA_RPC_URL}`). Never hardcode an RPC URL or a key in a script.
- Inside Hedera's EVM, `msg.value` and balances are in tinybars (8 decimals), while the JSON-RPC relay presents 18-decimal weibars to clients. Keep units explicit everywhere HBAR moves.
- Deploy scripts write addresses to a committed JSON per network so the other packages read them from one place. Never paste an address into more than one file.
- Every broadcast run of a deploy script rewrites that network's JSON entry for every contract it deployed, unconditionally, even if the deploy was unexpected or a repeat. `forge script --broadcast` is pre-approved in `.claude/settings.json`, so this is the guard against a stray deploy leaving another package pointing at a stale address.
- A dry run (no `--broadcast`) must never write the JSON. Its addresses were only simulated and exist on no chain. Use `vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)` to tell a broadcast from a dry run.

## What the resolver must implement
- **Two ways to open a case.** `openCase()` is permissionless, with the bounty attached as `msg.value`. A separate operator-gated function opens a case funded from the Case Bounty Treasury balance, which the resolver holds. Record each case's bounty source in the `CaseOpened` event.
- **Three jurors, equal genesis treasury.** Every juror rules on every case. No panel selection, no majority vote, no tier-based stake ceilings.
- **Commit-reveal.** A commitment is `keccak256(abi.encode(caseId, juror, ruling, confidence, salt))`. The case id and juror address are bound in so a juror cannot copy another's commitment and then replay its reveal. Commits close at the commit deadline; reveals open after it and carry the IPFS CID of the juror's evidence trail. Only the CID goes on-chain. A juror that commits but does not reveal is slashed as incorrect.
- **Confidence-scaled stake, locked at commit.** Stake is taken from the juror's treasury, which the resolver custodies. The contract records stated confidence but does not verify it. Scaling stake to confidence is agent policy.
- **Outcome submission.** Only the operator submits a case outcome, only after the resolution time, and always with the IPFS CID of the resolution checker's raw evidence. Only the CID goes on-chain, never the evidence itself. This is the only off-chain input to settlement. Never add another.
- **Settlement math, deterministic given the outcome:**
  - `P = bounty + Σ stake` of incorrect jurors; `S = Σ stake` of correct jurors.
  - Correct juror: stake returned plus `reward = P · stake / S`. Proportional to stake, never an equal split.
  - Incorrect or unrevealed juror: whole stake slashed into `P`.
  - `net = reward − x402Spend` if correct, `−stake − x402Spend` if not. Never drop the x402 term.
  - `return = net / (stake + x402Spend)`. This is the per-case figure. The bonding curve reads the juror's cumulative return since genesis, `Σ net / Σ (stake + x402Spend)` over all its settled cases, pre-skim. Store it as two per-juror running totals: signed cumulative net and cumulative capital. Never a mean of per-case percentages, and no sliding window.
  - Skim: 20% of positive net goes to the juror's shareholders via ATS mass payout, and 80% is credited to the juror's treasury. No skim on negative net.
  - No correct jurors: return the bounty to its source (the external opener, or the Case Bounty Treasury) and roll slashed stakes into the next case's pool.
  - Round down on every division, and document where rounding dust goes.
- **x402 withdrawal path.** A capped, rate-limited withdrawal from a juror's treasury to its hot wallet, tagged with a case id. The withdrawn amount counts as that case's `x402Spend`. This is a documented trust leak: the contract cannot verify where the money went after it leaves.

## Share rules
- A share purchase splits its trade value 70% to the juror's treasury in the resolver and 30% to the curve reserve. Redemptions pay out only from the reserve.
- A 2% fee on trade value is charged on top of every trade: added to what a buyer pays, subtracted from what a seller receives. It accrues to the Case Bounty Treasury in the resolver. It is never carved out of the 70/30 split, so keep the fee and the split as separate code paths acting on separate amounts.
- A juror's own key and hot wallet must be blocked from holding that juror's shares. This is the anti-wash-trading control and it is a judged feature, not an optional guard.

## Events
Every state change the subgraph or UI needs must emit an event: commit, reveal (with evidence-trail CID), outcome submission (with evidence CID), per-juror settlement (stake, spend, reward, net, return, skim), withdrawal (with case id), share trade, distribution. The subgraph rebuilds state from event deltas and must never need an RPC call per record.

## Testing
- Forge tests are for logic. A test that passes against a mock but has never run against testnet is not evidence. After any resolver or share change, run the real end-to-end script against Hedera testnet and report the transaction hash.
- Keep a test that reproduces the worked example in `docs/ARCHITECTURE.md` (A, B and C, a 20 HBAR bounty) and asserts the exact split and returns.

---
paths:
  - "packages/agent/**"
  - "packages/evidence-gateway/**"
---

# Juror agent and Evidence Gateway rules

## The agent must actually be an agent
The juror runs a reasoning loop, not a fixed script. Give the model the toolbox for the case's type and let it choose which tool to call and whether another call is worth paying for. Two different cases should produce a different number of tool calls. If every case produces an identical call pattern, the loop is not working and that is a correctness bug, not a style issue.

## The toolbox is per case type, and extensible
A case type is defined by its Evidence Gateway endpoints plus a resolution checker. The agent loads the endpoint set registered for the case's type; it never hardcodes a fixed list of tools. Adding a case type means registering new endpoints, with no changes to the loop.

Current case types and the upstreams their gateway endpoints wrap:
- Rocket launch scrub/delay: Launch Library 2 (thespacedevs.com)
- Flight delay: OpenSky Network (flight status), Open-Meteo (weather)
- GitHub star threshold: public GitHub API
- Crypto whale movement (optional): public block explorer data

Never a coin-flip case type. Research must be able to improve the odds.

## Spend is uncapped, and disciplined by net profit
There is no tool-call cap. The agent can spend as much as it wants investigating a case. What disciplines it is the scoring:

```
net    = reward − x402 spend      (if correct)
       = −stake − x402 spend      (if incorrect)
return = net / (stake + x402 spend)
```

Every paid call lowers net profit, even on a winning case, and return is measured on stake plus spend. So each call has to be worth its price. The loop should decide explicitly whether another piece of evidence is likely to change or firm up the ruling enough to pay for itself, and stop when it is not. That decision, and its reason, goes in the evidence trail.

x402 money leaves the juror's treasury through a capped, rate-limited withdrawal to its hot wallet, tagged with the case id. The agent calls `NyayaResolver.withdrawForEvidence(caseId, amount)` with its own juror key. It reverts from the case's commit deadline onward, so all evidence spending happens before committing. Whatever is withdrawn counts as spent on that case, so withdraw only what the next call costs. A rate-limit refusal ends the investigation; record it as the stop reason. That rate limit is also the only backstop against a runaway loop, so do not rely on it as a budget.

## Hard rules
- The agent must never call an upstream public API directly. Every data fetch goes through the Evidence Gateway so the x402 payment path is exercised. A direct fetch bypassing the gateway defeats the entire Hedera track. (The operator's resolution checkers in `packages/resolution-checker/` are not jurors and read sources directly. They are a separate trust boundary: never import checker code into the agent or gateway, or the reverse.)
- **Commit-reveal.** Commit `keccak256(abi.encode(caseId, juror, ruling, confidence, salt))` before the commit deadline, then reveal after it. The reveal carries no spend figure: the resolver reads spend from the juror's case-tagged withdrawals, so always tag each withdrawal with the case it pays for. Persist the ruling, confidence and salt durably before sending the commit. A lost salt means no reveal, and no reveal is slashed as incorrect.
- **Confidence-scaled stake.** Stake scales with the model's own stated confidence, a Kelly-style sizing policy. The contract does not check it; the agent is responsible for applying it consistently.
- The agent records its evidence trail: which tools it called, what each cost, what it learned, and why it stopped. This is what makes the verdict auditable, and it is what the demo shows.
- **Pinning the evidence trail.** Pin the trail to IPFS through Pinata, the same setup the resolution checker uses, and submit only the CID with the reveal. Use the agent's own Pinata key in `.env`, not the operator's, since a Pinata key can also unpin files. Pin only after the commit deadline, never before: a CID pinned during the commit phase can be found by others and would leak the ruling. Until then, store the trail locally and durably alongside the salt.
- Use OpenRouter's native tool calling directly. Do not add LangChain or a heavyweight agent framework.

## Models and differentiation
All three jurors run NVIDIA Nemotron (free tier) via OpenRouter. They differ only in system prompt (evidence-sufficiency threshold, interpretive style) and source/tool preferences. Keep those differences explicit in each juror's config so the demo can show why jurors diverged. Correlated failure is a known tradeoff of using one model; do not add other models without discussing it first.

## Always commit after spending
An agent that has withdrawn evidence money for a case must always commit a ruling on that case before the commit deadline. Abstaining after spending is not a supported behaviour. Low confidence is expressed through a small confidence-scaled stake, never by not ruling.

So a juror that spent but never committed can only be a bug: a crash, a missed deadline, or a failed transaction. The agent must emit a loud, alertable log line whenever it detects that it spent on a case and has not committed as the deadline approaches or passes. On-chain, settlement records the spend as a loss (`Result.NoCommitment`, net `−x` on capital `x`) and also emits `SpentWithoutCommitting(caseId, juror, x402Spend)`, which an alert should watch for.

## Evidence Gateway
- Express, one route per evidence type, grouped by case type. x402 middleware from the published libraries; do not hand-roll the payment protocol.
- Price per call. Every route is metered separately.
- Return HTTP 402 with a valid payment requirement before payment, and the real data after settlement. Both halves must work against Hedera testnet.
- Every response comes from the live upstream. Respect upstream rate limits (unauthenticated Launch Library 2, OpenSky's daily credits, GitHub's unauthenticated limits) and put any upstream keys in `.env`.
- Log every settled payment with its transaction reference and the case id it served. The demo needs to show a real payment landing.
- The gateway is a service other agents could use, not a private helper. Keep the interface clean enough to point a judge at.

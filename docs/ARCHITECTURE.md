# Nyaya architecture

## One market

Nyaya has one market: the juror share market. Each of three AI jurors has an ATS-issued share token, priced on a bonding curve that reads the juror's recorded return on capital. Buying shares is a long position on that juror's future performance. Holders receive 20% of the juror's net profit on every winning case through ATS mass payout.

Cases exist only to generate track records. Nobody bets on how a case resolves. There is no outcome token and no AMM.

## Chain split and why

| What | Chain | Reason |
|---|---|---|
| Resolver: juror treasuries, commit-reveal, stakes, settlement | Hedera testnet | Sub-cent fixed-USD fees make many small per-investigation payments viable; three-second finality suits fast settlement |
| ATS juror shares and their bonding-curve market | Hedera testnet | Asset Tokenization Studio lives on Hedera |
| Evidence Gateway x402 settlement | Hedera testnet | Settled through the Blocky402 facilitator |
| ENSv2 juror subnames, Enhanced Access Control roles, score record | Sepolia | ENSv2 beta only exists on Sepolia |
| Anchor contract and subgraph | Sepolia | Hedera has no hosted Subgraph Studio support |

The operator key that reports case outcomes on Hedera also writes finalised results to the Sepolia anchor and the juror's ENS score record. This publishes already-public data. It moves no value and is not a bridge.

## Cases

### A generic, pluggable framework

A case is a question, a resolution deadline, and a resolution source that is objectively checkable by a public script or contract, never by juror opinion. A case type is defined by exactly two things:

1. **Evidence tools**: which Evidence Gateway endpoints are relevant to it. These are what jurors pay to query.
2. **Resolution checker**: a public script in `packages/resolution-checker/` that reads the live source after the deadline and produces the outcome.

Adding a case type means adding gateway endpoints and a resolution checker. It never touches the resolver, staking, scoring, or share mechanics.

### Confirmed case types

Every source below is live, free, and real. Never substitute a mocked or static source.

| Case type | Question shape | Data sources |
|---|---|---|
| Rocket launch scrub/delay | Will launch L lift off inside its window, or scrub? | Launch Library 2 API (thespacedevs.com): launch schedule, current status, pad history. No key needed for basic use; unauthenticated requests are rate-limited |
| Flight delay | Will flight F arrive within X minutes of its scheduled time? | OpenSky Network (4,000 free credits/day) for live flight status and actual times; Open-Meteo (free, no key) for departure and arrival weather, as evidence only. OpenSky does not publish scheduled times, so the scheduled arrival is written into the case question when the case opens |
| GitHub star threshold | Will repo R reach N stars by date Y? | Public GitHub API |
| Crypto whale movement (optional, if time allows) | Will wallet W move more than $Y out of an exchange within N hours? | Public on-chain block explorer data |

### No coin-flip case types

A supported case type must be one where genuine research provably improves the odds. Short-horizon price moves ("will ETH go up in the next 5 minutes") are never supported and never shown on stage. This is load-bearing: the scoring below charges jurors for evidence, and that only makes sense if evidence can pay for itself.

## Case lifecycle

```
open      question, case type, commit deadline, resolution time, and a bounty, either attached
          by whoever calls openCase() or drawn from the Case Bounty Treasury by the operator
commit    each of the 3 jurors investigates (paying x402 per call), then submits
          keccak256(caseId, juror, ruling, confidence, salt) and locks a stake from its treasury
reveal    between the commit deadline and the resolution time, each juror pins its evidence trail to IPFS
          and reveals ruling, confidence, salt, and the trail's CID (no spend figure; spend comes from
          tagged withdrawals)
resolve   between the resolution time and the end of a 24-hour grace period, the operator runs the case
          type's checker and submits the outcome plus the IPFS CID of the raw evidence the checker used
settle    anyone triggers settlement: score each juror, split the pool, apply the skim, record return
publish   operator writes the result to the Sepolia anchor and updates each juror's ENS score record
cancel    if no outcome has been submitted when the grace period ends, anyone can cancel: every committed
          juror's stake is refunded in full and the bounty returns to its source
```

Every juror rules on every case. There is no panel selection and no majority vote. With three jurors, each one already gets equal at-bats, and each is scored independently against the resolved outcome.

**Commit-reveal is mandatory in v1.** It exists to stop free-riding. With no majority to hide behind, a juror that could read the others' rulings before ruling would copy them and spend nothing on evidence. The commitment includes the case id and the juror's address so one juror cannot copy another's commitment hash and then replay that juror's reveal.

**Evidence trails are pinned after the commit deadline, never before.** IPFS content is not private. A CID announced to the network can be found and fetched without anyone being told it, so a trail pinned during the commit phase could leak its ruling to the other jurors.

**A juror that commits but does not reveal is slashed as incorrect.** Otherwise a juror that sees it is losing could simply withhold its reveal.

**A case with no reported outcome is cancelled, not graded.** The operator can submit an outcome from the resolution time until a 24-hour grace period ends. If nothing has been submitted by then, anyone, not just the operator, can cancel the case. Cancellation refunds every committed juror's full stake, whether or not it revealed, and returns the bounty to its source (the external opener or the Case Bounty Treasury). This is deliberately separate from the non-reveal rule above. Not revealing is a juror's own choice during normal operation and forfeits the stake. A missing outcome is a platform failure: there is nothing to grade, it is not the jurors' fault, and so the consequence is more forgiving.

Once the grace period ends, outcome submission reverts unconditionally, even for the operator, and cancellation is the only remaining path. That closes the race between a late submission and a cancellation landing in the same or an adjacent block.

**Evidence spend on a cancelled case is still recorded as a loss.** The stake comes back, but any x402 money the juror spent investigating is gone from its treasury. That spend is added to the juror's cumulative capital deployed and subtracted from its cumulative net profit. This can penalise a juror for an operator failure rather than a bad ruling. That is a known and accepted cost: excluding the spend would let the tracked return silently drift away from the juror's actual treasury balance over many cases, which is worse.

**Stake is locked at commit.** Because stake scales with confidence, the stake amount reveals roughly how confident a juror is before the reveal. The ruling itself stays hidden, and the ruling is what a free-rider would need.

## Resolution

No Hedera contract can read Launch Library, OpenSky, or GitHub directly, so outcomes are reported by the operator. The trust this requires is kept small and inspectable:

- **Public checker per case type.** The script is in the repo. Anyone can re-run it against the same public data and get the same outcome.
- **Cross-checking.** Where a second independent public source exists for the same fact, the checker reads both and reports only if they agree.
- **Evidence anchoring.** The checker pins the raw evidence it used (the API responses, with timestamps) to IPFS and submits the CID alongside the outcome. A free pinning tier such as Pinata is enough at hackathon scope. Only the CID goes on-chain: it is emitted on Hedera and mirrored to the Sepolia anchor. A CID is a content hash, so anyone can fetch the evidence and check that it matches. The evidence does not live somewhere only we control and could tamper with or lose. Jurors pin their own evidence trails the same way, through the same Pinata setup, and reveal only the CID. So every reported outcome and every juror verdict comes with evidence that can actually be inspected, not just reproduced in theory.
- **What IPFS does and does not guarantee.** Tampering is detectable, because any change to the evidence changes its CID. Availability is not guaranteed: if our pin lapses and nobody else pins the evidence, it can no longer be fetched, although the on-chain CID still commits to exactly what it was.

There is no on-chain dispute window. It would cost contract complexity and demo latency we do not have. The operator remains a trusted reporter; see the limitations below.

## Scoring and payouts

### Definitions, per case

- `bounty`: the case's bounty, whether attached by an external opener or drawn from the Case Bounty Treasury
- `s_i`: juror i's stake
- `x_i`: juror i's total x402 spend on this case, read by the resolver from that juror's withdrawals tagged with this case id. The juror never submits it
- `P = bounty + Σ s_j` over every incorrect or unrevealed juror, plus any stakes rolled over from an earlier case nobody got right (the reward pool)
- `S = Σ s_j` over every correct juror
- `R = P / S`: the pool per unit of correct stake, one number shared by every correct juror in the case
- `α_i = x_i / s_i`: juror i's spend relative to its own stake

### Rules

- A correct juror gets its stake back plus `reward_i = P · s_i / S`. The pool is split in proportion to stake, not equally. A confident-and-right juror earns more than a timid-and-right one.
- An incorrect juror loses its whole stake to the pool.
- `net_i = reward_i − x_i` if correct, or `−s_i − x_i` if incorrect. The x402 term is never dropped: a juror that overspends investigating sees its profit fall even when it wins.
- `return_i = net_i / (s_i + x_i)`, the return on all capital deployed for the case, not on stake alone.
- Money can be lost for two different causes, and they are recorded the same way but described separately:
  - **Lost from an incorrect ruling:** the stake is slashed and the spend is gone, so net is `−s_i − x_i` on capital `s_i + x_i`.
  - **Lost from a cancelled case:** the stake is refunded but the spend is gone, so net is `−x_i` on capital `x_i`.

  Both go into the same cumulative totals. A cancelled case with no spend changes nothing.
- A juror that withdraws evidence money for a case but never commits has that spend recorded the same way, as a third, separately labelled cause: net `−x_i` on capital `x_i`. The money left its treasury, so leaving it out would let the tracked return drift from the real balance. Evidence withdrawals close at the commit deadline.
- If no juror is correct, the bounty returns to its source and the slashed stakes roll into the pool of the next case that settles with at least one correct juror and whose commit window was still open when the rollover appeared. Cases of different types overlap, and jurors who had already locked their stakes never saw that money in the pool, so it must not land in their case. The resolver keeps a single "last added" time for the rollover. That is conservative: a case open for only part of a growing rollover waits for a later case rather than receiving part of it. An external opener claims its refund with `withdrawRefund` rather than having it sent, so an opener whose address rejects HBAR cannot block a settlement. A bounty from the Case Bounty Treasury goes straight back into it.
- Every payout is rounded down to the tinybar. Whatever is left of the pool after the correct jurors are paid goes to the Case Bounty Treasury, never to an individual juror.

### What stake size does and does not buy

This is a stake-weighted parimutuel mechanism, the same family as a racetrack tote board. That suits the product: people are, in effect, backing AI jurors the way they would back horses. Describe it only as a parimutuel in the docs, pitch, and UI. Never claim a stronger scoring or truthfulness property than the derivation below proves.

Every correct juror earns exactly `R` in gross reward per unit of its own stake. Substituting `x_i = α_i · s_i`:

```
return_i = (R·s_i − α_i·s_i) / (s_i + α_i·s_i) = (R − α_i) / (1 + α_i)
```

`R` is the same for every correct juror in the case, so return depends only on `α_i`. Two correct jurors with the same spend-to-stake ratio get identical returns however much each staked. Two with different spending discipline relative to their own stake get different returns, as they should.

**Stake size alone never buys a better return. Spending discipline relative to your own conviction does affect it, and that is the intended incentive, not a flaw.** Every incorrect juror's return is exactly −100%.

**Wealth reaches return only through α.** Both directions, stated plainly, and they are consistent:
- **With spend held proportional to stake, stake size alone does not matter.** Same `α`, same return, whether the juror staked 10 HBAR or 50.
- **With a fixed absolute evidence spend, a larger stake produces a smaller `α`, and therefore a better return.** Evidence costs roughly the same no matter how big a juror's treasury is, so a richer juror that can stake more at the same confidence has a real, if indirect, channel to a better score.

So the mechanism is not wealth-neutral in an absolute sense. It is neutral only in the narrower sense that stake size alone, with spend held proportional, does not matter.

### Worked example

A case with a 20 HBAR bounty. Juror A stakes 50, spends 5 on evidence, and rules correctly. Juror B stakes 10, spends 1, and rules correctly. Juror C stakes 30, rules incorrectly, and is slashed.

```
P = 20 + 30 = 50        S = 50 + 10 = 60        R = P/S = 5/6

A: reward = 50 · 50/60 = 41.67    net = 41.67 − 5 = 36.67    capital = 55    return = 66.67%
B: reward = 50 · 10/60 =  8.33    net =  8.33 − 1 =  7.33    capital = 11    return = 66.67%
C: slashed 30                     net = −30 − x_C                           return = −100%
```

Both correct jurors spent 10% of their stake on evidence (α = 0.1), so the formula gives `(5/6 − 1/10) / 1.1 = 2/3` for both. A staked five times more than B and earned exactly the same return, because both kept the same spend-to-stake ratio.

**On-chain, in tinybars.** Payouts round down: A receives 4,166,666,666 tinybars and B receives 833,333,333. That leaves 1 tinybar of the 5,000,000,000-tinybar pool, which goes to the Case Bounty Treasury. To check the identity without any rounding, tests cross-multiply instead of comparing rounded percentages: `(P·s_A − x_A·S)·(s_B + x_B) = (P·s_B − x_B·S)·(s_A + x_A)`. Here that is (2500 − 300) × 11 = (500 − 60) × 55 = 24,200.

### Shareholder skim

After scoring, 20% of each juror's positive net profit for the case goes to that juror's shareholders through ATS mass payout. The remaining 80% goes to the juror's treasury. There is no skim on a negative net profit. Continuing the example:

```
A: net 36.67 → skim 7.33 to holders, keeps 29.33    29.33 / 55 = 53.33%
B: net  7.33 → skim 1.47 to holders, keeps  5.87     5.87 / 11 = 53.33%
```

A flat-percentage skim scales every winning juror's retained return by the same factor of 0.8, so it leaves the comparison between jurors unchanged.

The skim is a capital-distribution rule layered on top of performance tracking. It must not distort the track record. **The juror's track record is built from pre-skim figures.** Each case contributes its pre-skim net profit and capital deployed (for A here, 36.67 on 55, a 66.67% return), never the post-skim treasury credit.

The tradeoff: the skim slows a juror's own treasury compounding after a win. In exchange, the share token has real distributed cash flow, rather than value that depends entirely on finding a future buyer. That is why the token needs a distribution mechanic at all.

### What the mechanism does not do

- **It does not verify stated confidence.** Scaling stake to confidence is an agent policy, a Kelly-criterion-style sizing choice each agent makes. The contract never checks that stated confidence was honest. It only guarantees that, at a given spend-to-stake ratio, the return is the same whatever stake an agent picks.
- **It is not wealth-neutral in an absolute sense.** Wealth reaches return only through α, as set out above: a larger stake with the same absolute evidence spend means a smaller `α` and a better return. The effect is small when evidence spend is small relative to stake. It grows as spend becomes a larger share of the capital deployed: if B in the example had spent 5 like A, B's return would be 22.2% instead of 66.67%. This is a known limitation, not something the mechanism eliminates.

## Treasury and capital flows

- **Share purchases split 70/30.** 70% of every share purchase goes into the juror's operating treasury and 30% stays in the curve reserve for redemptions. This is deliberately biased toward keeping agents funded to do their job, over perfect exit liquidity for sellers. Redemptions are limited to what the reserve holds.
- **Each juror's treasury is held in `JurorTreasury`, and only the resolver can move money out of it.** Anyone can fund a juror. The juror's own key has no withdraw function. Money leaves in exactly three ways, all triggered by the resolver: locking a stake when the juror commits, slashing that stake when the juror is wrong or doesn't reveal, and the x402 withdrawal. A locked stake can also be returned to the juror (a correct ruling, or a cancelled case). x402 payments leave through a capped, rate-limited withdrawal path to the juror's hot wallet. Every withdrawal is tagged with a case id at withdrawal time, and the withdrawn amount counts as that case's x402 spend. Settlement reads spend only from this tagged history, and the reveal has no spend field. That keeps spend on-chain rather than self-reported, which matters because under-reporting spend would inflate the return the share price tracks. This withdrawal path is a documented trust leak, not a solved problem: see limitations.
- **Genesis is equal.** All three jurors start with the same treasury. Unequal starting capital would make the demo show differentiation by wealth rather than by skill.
- **The share price tracks cumulative return.** The bonding curve reads the juror's return since genesis, computed as total pre-skim net profit across all its settled cases divided by total capital deployed (stake plus x402 spend) across those cases.
  - **Not a plain mean of per-case percentages.** A plain mean would let a large percentage swing on a tiny stake count as much as a case where real capital was at risk. Winning 200% on a 1 HBAR stake and then losing 100% on a 100 HBAR stake averages to +50%. The capital-weighted figure is (2 − 100) / 101 ≈ −97%, which is what actually happened to the money.
  - **Not a rolling window.** At the number of cases a hackathon actually runs, a window would rarely differ from the cumulative figure. Cumulative also needs simpler resolver state: two running totals per juror instead of a maintained sliding window. Revisit this if the platform ever runs at a scale where early cases meaningfully dilute recent performance.

### Case Bounty Treasury

**The 2% trade fee.** Every juror-share trade pays a fee of 2% of the trade's value. The fee is charged on top of the trade, not taken out of it:
- **Buy:** the buyer pays the trade value plus 2%. The trade value is split 70/30 as described above. The fee is not part of that split.
- **Sell:** the reserve pays out the trade value, and the seller receives that value minus 2%.

This fee accrues to the Case Bounty Treasury.

The fee and the 70/30 split are two separate mechanisms acting on different parts of a trade. The 70/30 split divides the trade value between the juror's treasury and the redemption reserve. The fee sits outside the trade value and never enters either pool.

```
buy,  trade value 100:  buyer pays 102   →  70 to juror treasury, 30 to curve reserve, 2 to Case Bounty Treasury
sell, trade value 50:   reserve pays 50  →  49 to seller, 1 to Case Bounty Treasury
```

The resolver holds the Case Bounty Treasury, since that is where cases are opened. The share market forwards each fee to it.

**Two ways to fund a case bounty:**
- `openCase()` is permissionless. Whoever calls it attaches the bounty as `msg.value`.
- An operator-gated function opens a case funded from the accumulated Case Bounty Treasury balance. This is the only path by which that balance can become a bounty.

**In the demo:** with little trading volume in a short demo, the fee treasury will accumulate negligible funds. In practice, every demo case will be funded by the operator calling `openCase()` directly, acting as an external opener. The fee-funded path is meant for a live deployment with real volume. The demo will not meaningfully exercise it.

### Where the money comes from

A judge will ask where juror returns come from. The answer depends on how each case was opened.

- **Fresh capital** enters in three ways: genesis seeding, share purchases, and bounties attached by an external opener calling `openCase()` directly.
- **Recycled capital:** bounties funded from the Case Bounty Treasury. Traders paid the fees that funded them, so juror profit on such a case ultimately comes from traders. The 20% skim on that profit largely returns to the same population, as shareholders. It is a closed loop, not new value.
- Slashed stakes and share trading only move existing capital between participants.

For every case where at least one juror is correct, the jurors' combined net profit equals exactly that case's `bounty − Σ x_i` (in the example: 36.67 + 7.33 − 30 − x_C = 20 − (5 + 1 + x_C)). That identity holds whatever the bounty's source, and it is a real accounting check. On its own it does not tell you whether a case's reward money was fresh or recycled. That depends on how the case was opened.

## Jurors and models

All three jurors run NVIDIA Nemotron (free tier) through OpenRouter. They differ in their system prompts (the evidence-sufficiency threshold before ruling, and interpretive style) and in their source and tool preferences, not in the underlying model.

This is a conscious tradeoff. Three jurors on one model are more likely to fail in the same way on the same case than jurors on different models would be. OpenRouter also exposes other free-tier models (Gemini Flash, Llama, DeepSeek) if this needs revisiting, but nothing beyond Nemotron is committed today.

## Identity

Each juror is an ENSv2 subname on Sepolia. Enhanced Access Control grants two roles on each subname:

- **`OPERATOR_ROLE`**, held by the same operator key that reports resolutions and writes the anchor, is the only role that can write the juror's `score` text record (the mirrored current return figure).
- **The juror's own operating key** may write only descriptive fields, such as a strategy or bio describing how it reasons and what it prioritises. It is explicitly denied write access to `score`.

ENS holds only the current score snapshot, not history. Case-by-case history lives in the subgraph and is not duplicated in ENS.

This stops a juror from inflating its own public reputation record, which would otherwise make an ENS-hosted score worthless as a credential. It does not remove operator trust, since the operator role can write anything to that field. That is the same operator-trust category as resolution reporting and the anchor, extended to one more write path.

## Components

**Juror treasury (`packages/contracts/src/jury/JurorTreasury.sol`, Hedera).** The juror registry (each juror's key and hot wallet) and every juror's HBAR. It has one controller, the resolver, which is wired in once after deployment.

**Resolver (`packages/contracts/src/jury/`, Hedera).** Sole controller of the juror treasury, the Case Bounty Treasury and the operator-gated function that opens cases from it, the case lifecycle, commit-reveal, stake locking, operator outcome submission with evidence CID, settlement math, skim routing, the tagged x402 withdrawal path, and the per-juror return record. Emits an event for every state change the subgraph needs.

**Juror shares (`packages/contracts/src/shares/`, Hedera).** ATS-issued share token per juror, a bonding curve that reads recorded return, the 70/30 purchase split, the 2% trade fee forwarded to the Case Bounty Treasury, the compliance control blocking a juror's own addresses from holding its shares, and mass payout of the skim to holders.

**Anchor (`packages/contracts/src/anchor/`, Sepolia).** Records finalised case results, including per-juror stake, spend, reward, net, return and skim, plus the outcome evidence CID. Deliberately minimal.

**Juror agents (`packages/agent/`).** Three instances. Each reads a case, runs a reasoning loop choosing Evidence Gateway tools for that case type and paying x402 per call, decides when more evidence is not worth its price, sizes stake to its confidence, commits, and after the commit deadline pins its evidence trail to IPFS and reveals with the trail's CID.

**Evidence Gateway (`packages/evidence-gateway/`).** The x402-gated service jurors pay, with endpoints grouped by case type. It is also the artifact that satisfies Hedera's requirement to host a live x402 service.

**Resolution checkers (`packages/resolution-checker/`).** One public script per case type, run by the operator. They cross-check sources where possible, pin their raw evidence to IPFS, and submit the CID with the outcome. This package is operator-controlled ground truth, a different trust boundary from both `packages/agent/` (juror reasoning) and `packages/evidence-gateway/` (the data jurors pay for). It stays a separate package so that boundary is visible in the repo.

**Subgraph (`packages/subgraph/`).** Indexes the anchor. Rebuilds derived state from event deltas without per-record RPC calls.

**MCP server (`packages/mcp-server/`).** Ask Nyaya. Reasons over juror history in natural language.

## End-to-end flow

```
case opens with a bounty
  -> each juror loops: pick a tool for this case type, withdraw and pay x402, read data, decide if more is worth it
  -> each juror commits hash + confidence-scaled stake on Hedera
  -> commit deadline passes; jurors reveal
  -> resolution time: operator runs the checker, pins evidence to IPFS, submits outcome + CID
     (if no outcome arrives within the 24h grace period: anyone cancels, stakes refunded in full, bounty to its source)
  -> settle: wrong jurors slashed, pool split by stake among correct jurors
  -> net profit and return recorded; 20% of positive net skimmed to holders via ATS mass payout
  -> share prices move on the updated return
  -> operator updates each juror's ENS score record
  -> result written to Sepolia anchor; subgraph indexes it
  -> Ask Nyaya can answer "is juror 3 trustworthy" from live indexed data
```

## Known limitations and risks

| Limitation or risk | Status and mitigation |
|---|---|
| Operator trust: the one operator key reports case outcomes, writes the Sepolia anchor, holds `OPERATOR_ROLE` over each juror's ENS score record, and decides which cases draw on the Case Bounty Treasury | One trust category across four paths. Every treasury-funded case is on-chain, so how the operator spends fee money is visible. Public reproducible checkers, cross-checked sources, and IPFS-pinned evidence with on-chain CIDs make outcomes auditable. The anchor and ENS score mirror figures anyone can recompute from Hedera. Not removed, only made inspectable |
| x402 hot-wallet withdrawal path | Capped and rate-limited. The contract cannot verify that withdrawn funds went to the gateway, only that they left the treasury tagged to a case. Gateway settlements are public on Hedera, so this can be audited after the fact but is not enforced |
| Runaway agent loop | x402 spend has no per-case cap, by design. A buggy loop is bounded only by the withdrawal rate limit |
| Wash trading through fresh addresses | The compliance control blocks a juror's known key and hot wallet from holding its shares. It cannot stop funds forwarded to a fresh address while the ATS identity gate stays permissive for the demo |
| Stated confidence is not verified | Confidence-scaled staking is an agent policy. The contract does not enforce it |
| Wealth reaches return only through α | For a fixed evidence spend, a bigger stake means a smaller `α` and a better return. Known and accepted; see "What stake size does and does not buy" above |
| Cancelled-case spend counts as a loss | A juror can be penalised for an operator failure, not a bad ruling. Accepted, because excluding it would let tracked return drift from the real treasury balance |
| Correlated model failure | All three jurors run Nemotron. Differentiation comes from prompts and tool preferences |
| Free-tier model availability | Tool-calling support and rate limits on OpenRouter's free Nemotron endpoint must be confirmed before the agent loop depends on them |
| Exit liquidity | Only 30% of purchases stay in the redemption reserve. A rush of sellers can exceed it |
| ENSv2 write-path libraries are preview-only | Plan on direct contract calls via ethers against documented Sepolia addresses |
| ATS feels heavy for a speculative token | Use what makes it ATS: the compliance control as an anti-wash-trading measure and mass payout as the real distribution mechanism. Keep the identity gate permissive during the demo so judges are not blocked |
| Demo depends on a real clock | Pre-seed a case close to its resolution time. There is no admin override, since the operator reporting an outcome early would be a faked result |

## Deferred to v2

- **Stake ceilings by ENS tier.** A probation tier capping new jurors' stakes makes sense on a live platform with staggered juror onboarding. In this build all three jurors start equal at genesis and none join later, so a ceiling would never bind or be demoed. Deferred deliberately, not overlooked.
- **An on-chain dispute window** for operator-reported outcomes.
- **Model diversity** across jurors, to reduce correlated failure.

## Demo sequence

The full loop on live testnet: a case opens with a bounty (never a coin-flip case), a juror visibly pays x402 for real data, all three commit, then reveal, the checker's outcome is reported with its IPFS evidence CID, the wrong juror is slashed and the pool splits by stake on screen, the skim pays out to holders through ATS mass payout, juror share prices move on the Confidence Ticker, the ENS score record updates, and an Ask Nyaya query reflects the new state seconds later. Then hand the judge the keyboard for one live Ask Nyaya question.

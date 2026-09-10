# Prior art and how Nyaya differs

Read this before proposing any change to the juror, scoring, or share layer. Several projects have already won prizes or placed with concepts adjacent to ours. Converging onto any of them costs us the thing that makes this submission worth judging.

## DIVE — ETHGlobal Cannes 2026
Won World Minikit 2.0 first place, **the Hedera AI and Agentic Payments prize**, 0G second place, and overall Finalist.

An AI swarm oracle for prediction markets. A randomised committee of AI agents resolves each market outcome. Each agent is bound to a verified human via World ID, giving one human one node and native Sybil resistance. It runs an optimistic-to-adversarial pipeline: simple outcomes settle instantly, contested ones trigger a swarm dispute with evidence, reasoning, and a 70 percent consensus threshold reached through commit-reveal voting. Reputation is earned through accuracy rather than capital.

Architecture worth learning from: a deliberate "no-Solidity" design using SDKs and native network services only. Outcome tokens via Hedera Token Service, all voting recorded on Hedera Consensus Service using HCS standards. Their standout trick was a decentralised commit-reveal built with no contracts at all: agents post salted hashes to HCS, revealed and verified only after a deadline, producing a private voting booth out of public messaging.

**Where we overlap:** we also use commit-reveal. They used it first. It is not our novelty and must never be pitched as such. Their commit-reveal protects a consensus vote. Ours protects independent scoring from free-riding.

**What they did not do:** tokenise a juror as a tradeable asset, use Asset Tokenization Studio, or use ENS. Their agents decide outcomes by consensus. Ours decide nothing: each juror is scored independently against an outcome anyone can reproduce, and there is no vote.

## Justify — ETHGlobal Lisbon 2026
Won The Graph, Best AI Use Case (Continuity), second place. A separate Justify entry won World Track C at New York 2026.

A prediction market on Base Sepolia where the AI oracle has to show its work. The trading UI and the audited Gnosis CTF and FPMM stack pre-existed the event; the indexing and verifiability were the hackathon contribution. Their subgraph rebuilt pool state from event deltas with no RPC call per trade, reproducing on-chain price to the last decimal.

**The part closest to us:** they made the track record sellable. A scoring endpoint over the subgraph, covering hit rate, calibration edge against entry price, PnL and breadth, sits behind x402. The wallet signs an EIP-3009 USDC transfer to get the score, and only after a paid read does the server write feedback into an ERC-8004 registry. They also shipped a zero-dependency MCP server whose reputation tool settles its own x402 payment.

They also did something we should copy in spirit: when their TEE signature verification never returned true, they recorded the result as unverified and said plainly "settled on-chain, response unsigned" rather than claiming verification they could not prove. Judges reward that.

**What they did not do:** issue equity in a juror, pay distributions to holders of that equity, or let a third party take a position on an agent's future performance.

## JetLagged — ETHGlobal Buenos Aires (finalist)
A flight-delay prediction market. Flight delay is one of our case types, so a judge may connect the two.

**The difference:** JetLagged was an AMM with an oracle checking flight status. It had no AI jury and no evidence economy. In Nyaya nobody bets on whether a flight is late. The flight case exists to test jurors that pay for evidence, and the thing people buy is a share in the juror, not an outcome position.

## Other adjacent mechanisms
- **Numerai** lets a model's own creator stake on that model. It is self-staking, not a public market.
- **Kleros** slashes human jurors who rule against the majority. Nyaya has no majority: a juror is scored against the reproducible real outcome, not against the other jurors, and a third party can take a position on a specific juror.
- **Parimutuel betting** (racetrack tote boards) is the payout family our scoring belongs to. We use it to score jurors, not to take outside bets on outcomes. Cite it as the family, and never claim a stronger property for the mechanism than the wealth-neutrality derivation in `ARCHITECTURE.md`.

## What is actually ours

The tokenised juror. Not a reputation score, not a leaderboard, not paid access to a rating. An issued share with a price, a secondary market, and a distribution to holders when the juror profits.

- **DIVE** gave agents reputation. It was not tradeable.
- **Justify** sold access to a reputation score. The score itself was not an asset.
- **JetLagged** let people bet on flight outcomes. It had no jurors to invest in.
- **Numerai** is self-staking, not a public market.
- **Kleros** uses human jurors, and no third party can take a position on a specific juror.

Nyaya is the first to make an individual AI judge's future performance a tradeable asset held by people other than the judge. It is issued through Asset Tokenization Studio, with compliance controls preventing the juror from holding its own shares, and distributions routed through ATS mass payout.

## Rules that follow from this

1. Never propose replacing the juror share market with a reputation score, a leaderboard, or paid score access. That is Justify's ground and it is not novel.
2. Never let the pitch become "AI agents resolve prediction markets." That is DIVE's ground, and it already won the exact Hedera prize we are targeting. Our jurors do not resolve anything; they are scored. Our sentence is: an individual AI judge's track record is a tradeable asset.
3. Never reintroduce outcome betting on cases. That is JetLagged's and Justify's ground, and it pulls attention away from the share market.
4. The share market is the whole product. If time gets short, cut UI polish, cut the optional whale-wallet case type, cut extra case types. Never cut the share market.
5. When describing prior work in the README or demo, name these projects honestly and state the difference. Claiming novelty a judge can disprove in one search is worse than being precise about a narrower claim.

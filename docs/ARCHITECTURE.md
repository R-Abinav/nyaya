# Nyaya architecture

## The two layers

**Case market.** A question with a fixed resolution time and a resolution source the contract itself can read. Bettors buy YES or NO outcome tokens through the vendored Gnosis FPMM. Three to five juror agents are assigned based on their ENS authority tier. Each investigates, stakes, and rules. At resolution the case settles against the objective source, correct jurors are paid from a protocol fee plus the slashed stakes of wrong jurors, and every juror's accuracy score moves.

**Juror market.** Each juror has an ATS-issued share token. Price follows a bonding curve that reads the juror's on-chain accuracy score. Buying shares is a long position on that juror's future performance. When a juror is proven right, ATS mass payout distributes a reward skim to current holders. Long-only for v1; there is no borrow-to-short infrastructure. If short exposure is wanted, express it as a binary case market on "will juror N stay above X percent accuracy," reusing the same AMM code rather than building lending.

## Chain split and why

| Layer | Chain | Reason |
|---|---|---|
| Market, resolver, staking, ATS shares, Evidence Gateway settlement | Hedera testnet | Sub-cent fixed-USD fees make many small per-investigation payments viable; three-second finality suits fast settlement |
| ENSv2 juror subnames, Enhanced Access Control tiers, resolver records | Sepolia | ENSv2 beta only exists on Sepolia |
| Anchor contract and subgraph | Sepolia | Hedera has no hosted Subgraph Studio support |

The operator key that settles a case on Hedera also writes the finalised result to the Sepolia anchor. This publishes already-public data for indexing. It moves no value and is not a bridge.

## Components

**Vendored market (`contracts/market/`).** Gnosis Conditional Tokens plus Fixed Product Market Maker, deployed unmodified. Its resolution logic is a pluggable oracle address, which is exactly the seam our jury plugs into. Deploy this first, before anything is built on top; whether these older-pragma contracts deploy cleanly on Hedera is the single biggest assumption in the plan.

**Resolver (`contracts/jury/`).** The oracle the market points at. Holds juror stakes, accepts verdicts, settles against the objective source, distributes and slashes, updates accuracy. Emits an event for every state change the subgraph needs.

**Juror shares (`contracts/shares/`).** ATS-issued tokens, bonding curve reading accuracy, mass payout for distributions, compliance registry blocking a juror's operator address from holding its own shares.

**Anchor (`contracts/anchor/`, Sepolia).** One function recording a finalised result, emitting an event. Deliberately minimal.

**Juror agent (`packages/agent/`).** Reads a case, runs a bounded reasoning loop choosing tools and paying x402 per call, stakes proportional to its own confidence, submits a verdict with its evidence trail.

**Evidence Gateway (`packages/evidence-gateway/`).** The x402-gated service jurors pay. Also the artifact that satisfies Hedera's requirement to host a live x402 service.

**Subgraph (`packages/subgraph/`).** Indexes the anchor. Rebuilds derived state from event deltas without per-record RPC calls.

**MCP server (`packages/mcp-server/`).** Ask Nyaya. Reasoning over juror history in natural language.

## End-to-end flow

```
case opens
  -> jurors assigned by ENS authority tier
  -> each juror loops: pick tool, pay x402, read data, decide if more needed (max 4)
  -> juror submits verdict + confidence-weighted stake on Hedera
  -> resolution time: case settles against the objective source
  -> correct jurors paid, wrong jurors slashed
  -> accuracy scores update; juror share prices move; holders receive distribution
  -> ENS resolver record updated with new accuracy
  -> result written to Sepolia anchor; subgraph indexes it
  -> Ask Nyaya can answer "is juror 3 trustworthy" from live indexed data
```

## Known risks and the chosen mitigation

| Risk | Mitigation |
|---|---|
| "Wrong verdict" undefined for subjective questions | Flagship case must have a contract-readable resolution source. Soft consensus cases are out of scope, not a stretch goal |
| Older-pragma Gnosis contracts may not deploy on Hedera | Deploy unmodified on day one before building anything on top. Pin the compiler version rather than upgrading the pragma |
| ATS feels heavy for a speculative token | Use what makes it ATS: the compliance registry as an anti-wash-trading control and mass payout as the real distribution mechanism. Keep the identity gate permissive during the demo so judges are not blocked |
| ENSv2 write-path libraries are preview-only | Plan on direct contract calls via ethers against documented Sepolia addresses |
| Demo depends on a real clock | Pre-seed a case near resolution, or ship a clearly-labelled admin resolve function used only for the recording |
| Juror collusion | Moot for the objective flagship case. Multi-juror quorum plus stake-weighted slashing for anything softer. Name it as a v2 hardening area rather than claiming it is solved |

## Demo sequence

The full loop in under a minute, all on live testnet: case opens, juror pays x402 for real data, juror posts verdict on Hedera, case resolves against a real checkpoint, stake slashes and pays out on screen, juror share price visibly moves, ENS record updates, and an Ask Nyaya query reflects the new state seconds later. Then hand the judge the keyboard for one live Ask Nyaya question.

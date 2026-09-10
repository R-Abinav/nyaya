# Sponsor qualification requirements

Three partner selections. A partner's sub-tracks all count under its one slot, so Hedera gives us two tracks for one pick. Do not mark a track satisfied until every line below is true against live testnet.

## Hedera

### AI and Agentic Payments
- Host a live x402-gated service on Hedera testnet or mainnet, settled through the Blocky402 facilitator.
- Build a platform or agent that consumes that service and completes at least one real paid request end to end.
- Public repo with a README covering setup, architecture, and the payment flow.
- Demo video of five minutes or less showing the paid request executing.

Bonus signals we can hit: pay-per-call metering rather than a flat charge, on-chain agent identity, agent discovery, verifiable payment audit trails on HCS.

**Our mapping:** the Evidence Gateway is the hosted service. The juror agent is the consumer. The paid request must visibly execute in the video.

### Tokenization of Anything
- Use Asset Tokenization Studio (SDK, contracts, web app, or a combination) to issue or manage a tokenised asset.
- Deploy and demonstrate on Hedera testnet.
- Public repo, contracts verified on HashScan where applicable.
- Demo video showing issuance, configuration, and at least one lifecycle operation such as a transfer, compliance check, or distribution.

Bonus signals explicitly listed by Hedera: **a secondary market for ATS-issued assets, which the Studio does not have today**; compliance controls in use such as freezes and transfer restrictions; dividend or distribution flows.

**Our mapping:** juror shares are the tokenised asset. The secondary market is the bonus Hedera themselves called out. The compliance control is blocking a juror from holding its own shares. The distribution is mass payout on a correct verdict.

## ENS

### Best Use of ENSv2
- Must be built on ENSv2 on Sepolia.
- ENSv2 features must be central to the product, not a cosmetic add-on.
- The demo must be functional, not hardcoded values.
- Submission needs a video or live demo, ideally both, and open-source code.

Bonus explicitly stated: bringing AI agents into the mix, agents as namespaces with their own identity and permissions.

**Our mapping:** each juror is a subname. Enhanced Access Control drives the authority tier that decides which jurors may rule on which case sizes. The accuracy record lives in the juror's resolver record. Note the write-path libraries are preview-only, so expect direct contract calls rather than a polished SDK.

## The Graph

### Best AI Tooling or AI Use Case (Start Fresh pool)
- The Graph must be load-bearing: the agent or app uses Subgraphs, the Subgraph MCP, or Substreams as its source of blockchain data.
- Consume live data from a Graph provider, for example querying Subgraphs with an API key from Subgraph Studio. Mocked, local-only, or static datasets do not qualify.
- Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface, **not just printing a raw query result**.
- Open-source with a clear README or SKILL.md so judges can run it.
- Public repo plus a two to four minute demo video.
- Select the pool matching how we built. We are net-new, so Start Fresh.

**Our mapping:** the subgraph over the Sepolia anchor is the data source. The Ask Nyaya MCP server is the reasoning layer. The raw-query-dump exclusion is the line to watch; every MCP tool must return a judgement, not a table.

## Cross-cutting submission requirements
- Public repository, open source.
- Demo video within each track's stated length. Hedera allows five minutes, The Graph asks for two to four. Produce one video that fits the shortest window.
- Real commit history throughout the event. No single-commit submissions.
- Document clearly which parts are forked or pre-existing, specifically the Gnosis CTF and FPMM stack.

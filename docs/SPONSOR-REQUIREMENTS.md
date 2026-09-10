# Sponsor qualification requirements

Three partner selections. A partner's sub-tracks all count under its one slot, so Hedera gives us two tracks for one pick. Do not mark a track satisfied until every line below is true against live testnet.

## Hedera

### AI and Agentic Payments
- Host a live x402-gated service on Hedera testnet or mainnet, settled through the Blocky402 facilitator.
- Build a platform or agent that consumes that service and completes at least one real paid request end to end.
- Public repo with a README covering setup, architecture, and the payment flow.
- Demo video of five minutes or less showing the paid request executing.

Bonus signals we can hit: pay-per-call metering rather than a flat charge, on-chain agent identity, agent discovery, verifiable payment audit trails on HCS.

**Our mapping:** the Evidence Gateway is the hosted service, with endpoints grouped by case type. The three juror agents are the consumers. The paid request must visibly execute in the video.

Bonus signals this maps to:
- **Pay-per-call metering.** Every evidence call is paid separately, and spend has no cap. Overspending is punished economically through net profit instead.
- **On-chain agent identity.** Each juror is an ENSv2 subname.
- **Verifiable payment audit trail.** Every x402 withdrawal from a juror's treasury is tagged on-chain with a case id, and gateway settlements are logged with their Hedera transaction references.

### Tokenization of Anything
- Use Asset Tokenization Studio (SDK, contracts, web app, or a combination) to issue or manage a tokenised asset.
- Deploy and demonstrate on Hedera testnet.
- Public repo, contracts verified on HashScan where applicable.
- Demo video showing issuance, configuration, and at least one lifecycle operation such as a transfer, compliance check, or distribution.

Bonus signals explicitly listed by Hedera: **a secondary market for ATS-issued assets, which the Studio does not have today**; compliance controls in use such as freezes and transfer restrictions; dividend or distribution flows.

**Our mapping:** this track is the core of the product, not an add-on. The juror share market is Nyaya's only market; there is no outcome-betting layer.
- **Tokenised asset:** one ATS-issued share token per juror.
- **Secondary market:** the bonding-curve share market is the secondary market for ATS-issued assets that Hedera's own prize text says the Studio does not have today.
- **Compliance control:** a juror's own key and hot wallet are blocked from holding that juror's shares, as an anti-wash-trading control.
- **Distribution:** 20% of a juror's positive net profit on each case is paid to holders through ATS mass payout. This is the lifecycle operation the demo must show.

## ENS

### Best Use of ENSv2
- Must be built on ENSv2 on Sepolia.
- ENSv2 features must be central to the product, not a cosmetic add-on.
- The demo must be functional, not hardcoded values.
- Submission needs a video or live demo, ideally both, and open-source code.

Bonus explicitly stated: bringing AI agents into the mix, agents as namespaces with their own identity and permissions.

**Our mapping:** each juror is a subname, which is the "agents as namespaces with their own identity and permissions" bonus. Enhanced Access Control grants two roles per subname:
- `OPERATOR_ROLE` is the only role that can write the juror's `score` text record (the mirrored current return figure).
- The juror's own key can write descriptive fields (strategy, bio) and is denied write access to `score`.

This is what makes the ENS-hosted score worth anything as a credential: a juror cannot inflate its own public record. ENS holds only the current score. History lives in the subgraph. Note the write-path libraries are preview-only, so expect direct contract calls rather than a polished SDK.

## The Graph

### Best AI Tooling or AI Use Case (Start Fresh pool)
- The Graph must be load-bearing: the agent or app uses Subgraphs, the Subgraph MCP, or Substreams as its source of blockchain data.
- Consume live data from a Graph provider, for example querying Subgraphs with an API key from Subgraph Studio. Mocked, local-only, or static datasets do not qualify.
- Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface, **not just printing a raw query result**.
- Open-source with a clear README or SKILL.md so judges can run it.
- Public repo plus a two to four minute demo video.
- Select the pool matching how we built. We are net-new, so Start Fresh.

**Our mapping:** the subgraph over the Sepolia anchor is the data source. The Ask Nyaya MCP server is the reasoning layer, reasoning over each juror's return, spend efficiency, and record per case type. The raw-query-dump exclusion is the line to watch; every MCP tool must return a judgement, not a table.

## Cross-cutting submission requirements
- Public repository, open source.
- Demo video within each track's stated length. Hedera allows five minutes, The Graph asks for two to four. Produce one video that fits the shortest window.
- Real commit history throughout the event. No single-commit submissions.
- Document clearly which parts are forked or pre-existing. Nyaya forks no contracts; list any libraries or templates we build on (for example forge-std or ATS contracts) in the README.

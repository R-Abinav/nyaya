# Nyaya

Hackathon project for ETHOnline 2026 (submission deadline mid-September 2026). Team of two.

## What we are building

A market in AI jurors.

Three AI juror agents investigate real-world questions ("cases"), paying per investigation via x402. Each juror rules independently on every case through commit-reveal, staking an amount scaled to its own confidence. Once the case resolves against an objectively checkable source, each juror is scored independently: correct jurors split the case's reward pool in proportion to stake, and incorrect jurors are slashed.

Each juror has an ATS-issued share token whose price tracks the juror's return on capital. Anyone can buy shares in a juror they think will keep performing, and holders receive 20% of the juror's net profit on every winning case, declared through ATS and paid by our distributor.

Nobody bets on case outcomes. Cases exist only to generate each juror's track record. The juror share market is the entire product surface. See `docs/PRIOR-ART.md` before proposing changes to it.

## Commands

```bash
pnpm install                      # install all workspaces
pnpm -F contracts build           # forge build
pnpm -F contracts test            # forge test
pnpm -F contracts deploy:hedera   # forge create + cast via the Hedera deploy script (forge script can't fork through Hashio)
pnpm -F contracts deploy:sepolia  # forge script against the sepolia RPC endpoint
pnpm -F agent dev                 # run a juror agent against one case
pnpm -F evidence-gateway dev      # run the x402 gateway locally
pnpm -F subgraph codegen && pnpm -F subgraph deploy
pnpm -F mcp-server dev
pnpm -F web dev                   # Vite dev server
```

## Stack

- pnpm workspaces monorepo, TypeScript everywhere except contracts (Solidity) and subgraph mappings (AssemblyScript)
- Contracts: Solidity + Foundry. One `contracts` package with two RPC endpoints, `hedera` and `sepolia`, in `foundry.toml`. The pnpm scripts wrap `forge`
- Agent, gateway, MCP server: Node + TypeScript, ethers v6
- Juror models: all three jurors run NVIDIA Nemotron (free tier) via OpenRouter, differentiated by system prompt and tool preferences, not by model
- Evidence: the resolution checker's raw evidence and every juror's evidence trail are pinned to IPFS (Pinata free tier), with only the CID on-chain
- ATS: call Asset Tokenization Studio's **contracts** directly with ethers, using the ABIs published in `@hashgraph/asset-tokenization-contracts`. Not the SDK: `@hashgraph/asset-tokenization-sdk` v8.0.0 has no headless signer (`SupportedWallets` is MetaMask, WalletConnect, DFNS, Fireblocks, AWS KMS), and `Network.connect` expects a browser wallet, so a Node script holding a private key cannot drive it. Do not use the undocumented `RPCTransactionAdapter.setSignerOrProvider` seam either; it depends on internals their docs do not cover. Hedera's track text allows "SDK, contracts, web app, or a combination", and ATS's compliance registry, roles and dividend snapshots do the same work whichever entry point calls them. Still never run ATS's reference web app or its Postgres-backed Mass Payout app: a script is reproducible by judges, a manual MetaMask flow is not
- Frontend: React + Vite + Tailwind + shadcn/ui. `lightweight-charts` for the ticker
- Wallet: MetaMask + wagmi + ethers over Hedera's EVM JSON-RPC relay. Do not add HashConnect or HashPack

## Repo map

```
packages/contracts/          Solidity, Foundry, Hedera + Sepolia
packages/subgraph/           AssemblyScript mappings over the Sepolia anchor
packages/agent/              juror agent runtime
packages/evidence-gateway/   x402-gated API the jurors pay to query
packages/resolution-checker/ operator's per-case-type outcome scripts (ground truth, separate trust boundary)
packages/mcp-server/         "Ask Nyaya" MCP server over the subgraph
packages/shared/             shared types and contract ABIs
packages/web/                React frontend
```

## Which chain holds what

Hedera testnet holds money and tokens: the resolver (juror treasuries, commit-reveal, stakes, settlement), the ATS-issued juror shares and their return-scaled share market, and the Evidence Gateway's settlement.

Sepolia holds identity and read paths: ENSv2 juror subnames with Enhanced Access Control roles and a permissioned score record, and a small anchor contract that mirrors finalised results so a standard subgraph can index them.

Hedera has no hosted Subgraph Studio support, which is the entire reason for the Sepolia anchor. Do not propose indexing Hedera directly. The link between the two chains is one operator key writing already-public results to the anchor. It is not a bridge and must never be described as one.

## Non-negotiables

These are judged criteria, not preferences. Violating any of them can disqualify a sponsor prize.

1. **Live testnet data only.** Every sponsor track we target explicitly disqualifies mocked, local-only, or static datasets. No stub responses, no hardcoded prices, no fake transaction hashes, not even temporarily. Every case type uses a real live data source. If something cannot be called yet, leave it unimplemented and say so.
2. **Never claim a guarantee we did not verify.** If a signature check, a TEE attestation, or a payment proof does not actually verify, record the failure honestly in the data model and surface it in the UI. The same applies to the mechanism: the operator is a trusted reporter, and the payout rule is a stake-weighted parimutuel and nothing stronger. Say so. Judges reward this and punish the opposite.
3. **Independently reproducible resolution.** A case's outcome must be reproducible by anyone re-running the same public resolution-checker script against the same public data, even though the contract cannot read the source directly. Never introduce a case type whose correctness depends on juror opinion. That collapses the slashing mechanic.
4. **No coin-flip case types.** Never support, or show on stage, a case where research cannot improve the odds (for example "will ETH go up in the next 5 minutes"). The whole economic story depends on evidence paying for itself.
5. **Commit-reveal is mandatory.** Jurors commit before the deadline and reveal after it. Without it, a juror could copy the others and spend nothing on evidence.
6. **Never commit secrets.** Private keys and API keys live in `.env`, which is gitignored. Never paste a key into source, a test, or a commit message.
7. **Real commit history.** Many small commits throughout. Never squash the project into one commit at the end; some sponsors explicitly disqualify that.

## Sponsor tracks we are judged on

Three partner selections. Each partner's sub-tracks all count under its one slot.

- **Hedera**: AI and Agentic Payments (host a live x402-gated service and have an agent complete a real paid request end to end), plus Tokenization of Anything (juror shares issued and managed through Asset Tokenization Studio, and the share market itself is the secondary market for ATS assets that Hedera says it does not have today).
- **ENS**: Best Use of ENSv2 on Sepolia. Juror subnames, Enhanced Access Control roles separating who may write a juror's score from what the juror may write about itself, Permissioned Resolver records. Must be central, not cosmetic.
- **The Graph**: AI Tooling or AI Use Case. Subgraph plus an MCP server that does real reasoning over juror history, not raw query printing.

Read `docs/SPONSOR-REQUIREMENTS.md` before claiming any track is satisfied.

## Where the detail lives

- `docs/ARCHITECTURE.md` — full system design, scoring math with worked example, treasury, case types, limitations
- `docs/PRIOR-ART.md` — what similar projects already won with, and what we must not converge onto
- `docs/SPONSOR-REQUIREMENTS.md` — verbatim qualification requirements per track
- `docs/TESTNET-EVIDENCE.md` — the real Hedera transactions proving each step actually works on testnet
- `.claude/rules/` — conventions that load automatically when you open files in a given package

## Working style for this repo

Prefer the smallest change that makes the loop work end to end. Get an ugly path fully working across both chains before adding polish anywhere. When a testnet call fails, report the actual error rather than routing around it with a mock. Ask before adding a dependency that is not already in the workspace.

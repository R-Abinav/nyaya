# Nyaya

Hackathon project for ETHOnline 2026 (submission deadline mid-September 2026). Team of two.

## What we are building

A two-layer prediction market.

**Layer 1, the case market.** Users bet YES/NO on a real-world question. The outcome is decided by a panel of 3 to 5 staked AI juror agents that investigate before ruling. Jurors pay per investigation via x402 and stake before every verdict. Right verdict returns the stake plus a reward, wrong verdict gets slashed.

**Layer 2, the juror market.** Each juror has a tokenised share whose value tracks that juror's long-run accuracy. Anyone can buy shares in a juror they think will keep performing. When a juror is proven right, shareholders receive a distribution. This layer is the actual novelty; see `docs/PRIOR-ART.md` before proposing changes to it.

## Commands

```bash
pnpm install                      # install all workspaces
pnpm -F contracts build           # compile contracts
pnpm -F contracts deploy:hedera   # deploy to Hedera testnet
pnpm -F contracts deploy:sepolia  # deploy to Sepolia
pnpm -F agent dev                 # run a juror agent against one case
pnpm -F evidence-gateway dev      # run the x402 gateway locally
pnpm -F subgraph codegen && pnpm -F subgraph deploy
pnpm -F mcp-server dev
pnpm -F web dev                   # Vite dev server
```

## Stack

- pnpm workspaces monorepo, TypeScript everywhere except subgraph mappings (AssemblyScript)
- Contracts: Solidity + Hardhat + ethers v6. One `contracts` package with two network profiles
- Agent, gateway, MCP server: Node + TypeScript
- Frontend: React + Vite + Tailwind + shadcn/ui. `lightweight-charts` for the ticker
- Wallet: MetaMask + wagmi + ethers over Hedera's EVM JSON-RPC relay. Do not add HashConnect or HashPack

## Repo map

```
packages/contracts/          Solidity, Hardhat, Hedera + Sepolia
packages/subgraph/           AssemblyScript mappings over the Sepolia anchor
packages/agent/              juror agent runtime
packages/evidence-gateway/   x402-gated API the jurors pay to query
packages/mcp-server/         "Ask Nyaya" MCP server over the subgraph
packages/shared/             shared types and contract ABIs
packages/web/                React frontend
```

## Which chain holds what

Hedera testnet holds money and tokens: the forked market, the resolver that stakes and slashes, the ATS-issued juror shares, and the Evidence Gateway's settlement.

Sepolia holds identity and read paths: ENSv2 juror subnames with tiered permissions, and a small anchor contract that mirrors finalised results so a standard subgraph can index them.

Hedera has no hosted Subgraph Studio support, which is the entire reason for the Sepolia anchor. Do not propose indexing Hedera directly. The link between the two chains is one operator key writing already-public results to the anchor. It is not a bridge and must never be described as one.

## Non-negotiables

These are judged criteria, not preferences. Violating any of them can disqualify a sponsor prize.

1. **Live testnet data only.** Every sponsor track we target explicitly disqualifies mocked, local-only, or static datasets. No stub responses, no hardcoded prices, no fake transaction hashes, not even temporarily. If something cannot be called yet, leave it unimplemented and say so.
2. **Never claim a guarantee we did not verify.** If a signature check, a TEE attestation, or a payment proof does not actually verify, record the failure honestly in the data model and surface it in the UI. Judges reward this and punish the opposite.
3. **Objective resolution only for the flagship case.** A juror is "wrong" only when the contract itself can read the true outcome. Never introduce a case type whose correctness depends on juror opinion. That collapses the slashing mechanic.
4. **Cap agent spend in code.** The juror agent must never loop unbounded while paying x402 fees. A hardcoded constant, currently 4 tool calls per case. Not a config system.
5. **Do not reinvent the market maker.** Layer 1 is a fork of Gnosis Conditional Tokens plus a Fixed Product Market Maker. Our contribution is the jury, the reputation market, and the payment and identity layers. Disclose the fork in the README.
6. **Never commit secrets.** Private keys and API keys live in `.env`, which is gitignored. Never paste a key into source, a test, or a commit message.
7. **Real commit history.** Many small commits throughout. Never squash the project into one commit at the end; some sponsors explicitly disqualify that.

## Sponsor tracks we are judged on

Three partner selections. Each partner's sub-tracks all count under its one slot.

- **Hedera**: AI and Agentic Payments (host a live x402-gated service and have an agent complete a real paid request end to end), plus Tokenization of Anything (issue and manage the juror shares through Asset Tokenization Studio, and give ATS assets the secondary market it does not have today).
- **ENS**: Best Use of ENSv2 on Sepolia. Juror subnames, Enhanced Access Control for tiered authority, Permissioned Resolver records. Must be central, not cosmetic.
- **The Graph**: AI Tooling or AI Use Case. Subgraph plus an MCP server that does real reasoning over juror history, not raw query printing.

Read `docs/SPONSOR-REQUIREMENTS.md` before claiming any track is satisfied.

## Where the detail lives

- `docs/ARCHITECTURE.md` — full system design, data model, contract responsibilities
- `docs/PRIOR-ART.md` — what similar projects already won with, and what we must not converge onto
- `docs/SPONSOR-REQUIREMENTS.md` — verbatim qualification requirements per track
- `.claude/rules/` — conventions that load automatically when you open files in a given package

## Working style for this repo

Prefer the smallest change that makes the loop work end to end. Get an ugly path fully working across both chains before adding polish anywhere. When a testnet call fails, report the actual error rather than routing around it with a mock. Ask before adding a dependency that is not already in the workspace.

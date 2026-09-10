---
paths:
  - "packages/contracts/**"
---

# Contract rules

## Layout
- `contracts/market/` — the Gnosis CTF and FPMM fork. Treat as vendored. Do not refactor, reformat, or "improve" it. Only change it if a Hedera deployment error forces it, and note why in a comment.
- `contracts/jury/` — our code. Resolver, staking, slashing, juror registry.
- `contracts/shares/` — juror share tokens and the bonding curve that reads accuracy.
- `contracts/anchor/` — Sepolia only. Mirrors finalised results for indexing.

## Rules
- ethers v6, not v5. Hardhat with two named networks, `hedera` and `sepolia`. Never hardcode an RPC URL in a script; read from env.
- Pin the Solidity version the vendored Gnosis contracts need in `hardhat.config.ts` rather than upgrading their pragma.
- Every state change that the subgraph or the UI needs must emit an event. The subgraph rebuilds state from event deltas and must never need an RPC call per record.
- The resolver is the market's oracle. It calls into the vendored FPMM through its existing oracle interface. Do not fork the FPMM to add hooks.
- Slashing must be deterministic and checkable on-chain. Never introduce a code path where correctness depends on an off-chain assertion the contract cannot verify.
- A juror's operator address must be blocked from holding that juror's own shares. This is the anti-wash-trading control and it is a judged feature, not an optional guard.
- Deploy scripts write addresses to a committed JSON per network so the other packages read them from one place. Never paste an address into more than one file.

## Testing
- A test that passes against a mock but has never run against testnet is not evidence. After any resolver or share change, run the real end-to-end script against Hedera testnet and report the transaction hash.

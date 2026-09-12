---
paths:
  - "packages/subgraph/**"
  - "packages/mcp-server/**"
---

# Subgraph and MCP rules

## Subgraph
- Mappings are AssemblyScript, not TypeScript. It looks similar and is not. No closures, no `any`, no spread, explicit types everywhere, use the generated types from `graph codegen`.
- Index the Sepolia anchor contract. Never attempt to index Hedera; it is not supported and that is why the anchor exists.
- Rebuild derived state from event deltas inside the mapping. No `eth_call` per record. If a value cannot be derived from events, add an event to the anchor contract rather than reaching for an RPC call.
- Entities the UI and MCP server need: Juror, Case, Verdict (one per juror per case: ruling, confidence, stake, x402 spend, reward, net, return, skim, evidence-trail CID), ReturnCheckpoint (cumulative pre-skim net ÷ cumulative capital deployed since genesis, which the price reads; never a mean of per-case returns), ShareTrade, Distribution. Keep IDs stable and predictable.
- The subgraph holds full case-by-case history. ENS holds only each juror's current score, so never treat ENS as a history source.
- Run `graph codegen` after every schema change before touching mappings.

## MCP server
- The tools must do reasoning over juror history, not print raw query results. "Is juror 3 trustworthy" should return a judgement grounded in indexed numbers, with the numbers shown. A track that rewards AI use cases explicitly excludes raw query dumps.
- When explaining a juror's record, keep the two loss causes separate: lost from an incorrect ruling versus lost from a cancelled case (spend gone, stake refunded, an operator failure). They count the same in the return but must never be described as the same thing.
- Useful reasoning axes: return on capital over time, spend efficiency (x402 spend relative to stake), whether stated confidence matched outcomes, and performance per case type.
- Be precise about the mechanism. It is a stake-weighted parimutuel and nothing stronger, and case outcomes are reported by the operator. Never describe either differently.
- Ship a clear README or SKILL.md so a judge can run it. This is a stated qualification requirement.
- Keep dependencies minimal. The server should be runnable by someone who has never seen the repo.
- Every answer must be traceable to indexed data. Never let the model invent a statistic that is not in the subgraph response.

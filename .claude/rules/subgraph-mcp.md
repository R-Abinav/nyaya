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
- Entities the UI and MCP server need: Juror, Case, Verdict, AccuracyCheckpoint, ShareTrade. Keep IDs stable and predictable.
- Run `graph codegen` after every schema change before touching mappings.

## MCP server
- The tools must do reasoning over juror history, not print raw query results. "Is juror 3 trustworthy" should return a judgement grounded in indexed numbers, with the numbers shown. A track that rewards AI use cases explicitly excludes raw query dumps.
- Ship a clear README or SKILL.md so a judge can run it. This is a stated qualification requirement.
- Keep dependencies minimal. The server should be runnable by someone who has never seen the repo.
- Every answer must be traceable to indexed data. Never let the model invent a statistic that is not in the subgraph response.

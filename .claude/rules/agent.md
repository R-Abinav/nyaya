---
paths:
  - "packages/agent/**"
  - "packages/evidence-gateway/**"
---

# Juror agent and Evidence Gateway rules

## The agent must actually be an agent
The juror runs a reasoning loop, not a fixed script. Give the model a small toolbox and let it choose which tool to call and whether it needs another one. Two different questions should produce a different number of tool calls. If every case produces an identical call pattern, the loop is not working and that is a correctness bug, not a style issue.

## Hard rules
- `MAX_TOOL_CALLS = 4`, a plain constant in the agent source with a comment explaining that the agent spends real money per call. Do not build a config file, an env var, or per-juror tunable limits around it. That is over-engineering for something invisible in the demo.
- The agent must never call an upstream public API directly. Every data fetch goes through the Evidence Gateway so the x402 payment path is exercised. A direct fetch bypassing the gateway defeats the entire Hedera track.
- Stake size scales with the model's own reported confidence. A confident verdict risks more than an uncertain one.
- The agent records its evidence trail: which tools it called, what it paid, and why it stopped. This is what makes the verdict auditable and it is what the demo shows.
- Use native tool calling from the model SDK. Do not add LangChain or a heavyweight agent framework.

## Evidence Gateway
- Express, one route per evidence type. x402 middleware from the published libraries; do not hand-roll the payment protocol.
- Return HTTP 402 with a valid payment requirement before payment, and the real data after settlement. Both halves must work against Hedera testnet.
- Log every settled payment with its transaction reference. The demo needs to show a real payment landing.
- The gateway is a service other agents could use, not a private helper. Keep the interface clean enough to point a judge at.

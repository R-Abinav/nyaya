---
paths:
  - "packages/web/**"
---

# Frontend rules

- React with Vite. No Next.js, no SSR. Tailwind plus shadcn/ui components. Do not introduce a second component library or a CSS-in-JS runtime.
- Reads come from the subgraph. Writes go through wagmi and ethers. Never poll an RPC in a loop for data the subgraph already serves.
- Show real state, including failure. If a payment did not settle or a verification did not pass, the UI says so plainly. Never render an optimistic success that the chain has not confirmed.
- Two screens carry the demo and deserve disproportionate care:
  - **Confidence Ticker** — live juror share prices updating as cases resolve. Use `lightweight-charts`. It should read like a trading terminal.
  - **Ask Nyaya** — a chat panel calling the MCP server, so a judge can type their own question and get a real answer.
- Every transaction-signing screen shows exactly what is being signed and on which chain, since the app spans Hedera and Sepolia. Users and judges must never be confused about which network an action lands on.
- No localStorage-dependent core state. Keep state in React and derive from chain and subgraph.
- Mobile is not a requirement. The demo is recorded on a desktop viewport. Do not spend time on responsive polish.

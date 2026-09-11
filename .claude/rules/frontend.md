---
paths:
  - "packages/web/**"
---

# Frontend rules

- React with Vite. No Next.js, no SSR. Tailwind plus shadcn/ui components. Do not introduce a second component library or a CSS-in-JS runtime.
- Reads come from the subgraph. Writes go through wagmi and ethers. Never poll an RPC in a loop for data the subgraph already serves.
- Show real state, including failure. If a payment did not settle or a verification did not pass, the UI says so plainly. Never render an optimistic success that the chain has not confirmed.
- The only market is the juror share market. There is no outcome betting UI.
- A cancelled case (no outcome reported within the grace period) shows as cancelled, with each juror's full refund. It must look visibly different from a juror slashed for not revealing.
- A committed juror shows as committed and hidden until it reveals. Case outcomes are labelled as operator-reported, with the evidence CID linked to its IPFS content. Each revealed verdict links its evidence-trail CID the same way.
- Each settled case shows every juror's stake, x402 spend, reward or slash, net, return, and skim, so the scoring can be checked by eye.
- The share trade screen shows the 70/30 split of the trade value between the juror's treasury and the redemption reserve, and shows the 2% fee to the Case Bounty Treasury as a separate line on top of the trade value.
- Each case shows whether its bounty came from an external opener or from the Case Bounty Treasury.
- Two screens carry the demo and deserve disproportionate care:
  - **Confidence Ticker** — live juror share prices updating as cases resolve. Use `lightweight-charts`. It should read like a trading terminal.
  - **Ask Nyaya** — a chat panel calling the MCP server, so a judge can type their own question and get a real answer.
- Every transaction-signing screen shows exactly what is being signed and on which chain, since the app spans Hedera and Sepolia. Users and judges must never be confused about which network an action lands on.
- No localStorage-dependent core state. Keep state in React and derive from chain and subgraph.
- Mobile is not a requirement. The demo is recorded on a desktop viewport. Do not spend time on responsive polish.

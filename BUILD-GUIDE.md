# Nyaya — Your Build Guide

This is everything you need to start building without having to read the whole design conversation that got us here. Read this once, fully, before writing code. It's long because the mechanics genuinely matter to get right, not because there's padding.

---

## What Nyaya actually is

Three AI agents ("jurors") independently research and rule on real-world questions ("cases") that resolve against a real, public outcome, not a vote, not an opinion. Each juror stakes real money on its own verdict before finding out if it's right. Get it right, the stake comes back with a profit. Get it wrong, the stake is gone.

The actual product isn't the cases. It's that each juror has a tradeable share token. Anyone can buy shares in a juror they think is good at this, and the share's value tracks that juror's real, provable track record. Cases exist purely to generate that track record. If a juror is genuinely sharp, its shares are worth more over time. If it's sloppy or reckless, its shares bleed out. That's the novel part, nobody else has made an individual AI agent's track record itself a thing a third party can hold a position in, not a score you buy access to, not a self-staked bet, an actual tradeable asset.

There is no betting market on the case outcomes themselves. That was cut early. One market only: juror shares.

## Who owns what

**Abinav**: everything on-chain, both chains, Foundry, the resolver, staking and slashing, the share tokens and bonding curve, ENS identity.

**You**: everything off-chain that produces the data the chain settles against. The resolution checkers, the Evidence Gateway, the juror agents themselves, the subgraph, the MCP server.

The seam between you: Abinav's contracts read what your code produces (a submitted outcome, a revealed verdict, an indexed event). You don't need to know Solidity to do your half well, but you do need to know exactly what shape of data his contracts expect, that's flagged below wherever it matters.

---

## The mechanics you need to know cold

**Every juror rules on every case, independently.** No panel selection, no majority vote. 3 jurors, 3 independent rulings, each graded separately against the real outcome.

**Commit-reveal is mandatory.** A juror commits `keccak256(ruling, confidence, salt, caseId, jurorAddress)` before the case deadline, then reveals the real values after. The address and case id are bound into the hash specifically so a juror can't copy another juror's commitment and then copy its reveal once it's public, that would let it free-ride on research it never paid for. **If your agent loses its salt, it cannot reveal, and forfeits its stake as if it never ruled.** Persist salts somewhere durable, this is a real risk, not a formality.

**Confidence sets the stake, and it's an agent decision, not something the contract verifies.** Your agent decides how confident it is and stakes accordingly, more confidence, bigger stake. The contract doesn't check whether the stated confidence was honest, it just makes the payout math work out fairly regardless of what any juror chooses. So build this like it matters, an agent that stakes big when it's actually unsure is just going to lose money, that's the intended discipline.

**x402 spend is uncapped, and that's deliberate.** Your agent can spend as much as it wants on evidence per case. There is no `MAX_TOOL_CALLS`, we removed that. The discipline against overspending isn't a cap, it's that spend gets subtracted from profit before anything is scored, so an agent that burns money on evidence without improving its accuracy just loses money, expensively. Log every payment, you need the total per case later.

**How a case resolves: not by the contract reading anything.** None of our case types (rocket launches, flights, GitHub stars) have an on-chain oracle. A resolution-checker script (yours) reads the real public source, cross-checks a second independent source where one genuinely exists, hashes and pins the raw evidence to IPFS, and an operator key submits the outcome on-chain. This is a disclosed trust assumption, not a trustless oracle, say so plainly in anything you write about it, don't imply more decentralization than exists.

**Scoring, precisely, because the wording matters:** this is a stake-weighted parimutuel, the same family as a horse-racing tote board, not a proper scoring rule, don't describe it as one anywhere. For a resolved case, correct jurors split a pool (that case's bounty plus the slashed stakes of wrong jurors) proportional to their own stake. A juror's net profit for that case is its share of the pool minus its own logged x402 spend for that case. Divide by capital deployed (stake plus spend) and you get a return rate that comes out identical for a rich juror and a poor juror doing equally well, that's provable algebraically, it's the actual novel-mechanism claim, don't accidentally weaken it in how you build the spend-logging.

**The juror's tracked performance metric is cumulative, not per-case.** It's total net profit since genesis divided by total capital deployed since genesis, not an average of per-case percentages. A plain average would let one lucky small-stake swing count as much as a case where real capital was on the line. If your agent or the subgraph tracks "this juror's record," track the two running totals, not a list of percentages.

**Evidence trails, and this is a specific, deliberate rule: your agent pins its own reasoning trail to IPFS using its own Pinata key, and only after the commit deadline, never before.** Two separate reasons, both real: pinning before commit means the trail is fetchable by CID even without announcing it, which would leak the ruling to the other jurors before reveal. And using your own key rather than a shared one means no juror can unpin (delete) another juror's evidence. Keep the trail local until commit closes, then pin it, then include the CID with your reveal.

---

## Non-negotiables that apply directly to your work

- **Never a coin-flip case type.** Every case type must be one where research genuinely improves the odds of being right. This is checked in review, not just a vibe, if you're ever unsure whether a candidate case type qualifies, ask before building tooling for it.
- **No mocked or static data, ever, not even temporarily.** Every data source your checkers and your Evidence Gateway touch must be a real, live call. If a free tier runs out or an API is flaky, say so and stop, don't quietly substitute a hardcoded value.
- **Never import resolution-checker code into the agent or gateway, or the reverse.** The checker is operator-controlled ground truth. The agent is a juror trying to guess that ground truth before it's known. Mixing them, even for convenience, breaks the separation the whole trust model depends on.
- **Respect upstream rate limits and say so in logs.** OpenSky gives 4,000 credits/day, GitHub's API has its own limits. Log when you're close, don't let the Evidence Gateway silently fail because it got rate-limited mid-case.

---

## Your build order, in detail

### 1. Resolution-checker package
New package, `packages/resolution-checker/`, one script per case type:
- **Rocket launch scrub**: Launch Library 2 API (thespacedevs.com), free, no key needed for basic use, rate-limited for unauthenticated calls. Reads a launch's current status against its window.
- **Flight delay**: OpenSky Network (free, 4,000 credits/day, real ADS-B flight status) plus Open-Meteo (fully free, no key) for departure/arrival weather context.
- **GitHub repo star threshold**: the public GitHub API, free, checks current star count against the case's target and date.

Each script takes an open case's parameters, determines the real outcome, and is runnable standalone. **Output:** running a checker against a real open case prints a real outcome once that case's real-world event has actually happened.

### 2. Cross-checking against a second source
Where a genuine second live source exists for the same fact, check both and flag disagreement rather than silently picking one. Be honest about which case types actually have this, don't invent a fake secondary source just to tick the box. If a case type is genuinely single-sourced, document that plainly instead. **Output:** a test where two sources are made to disagree, and the script surfaces that rather than resolving it silently.

### 3. Evidence pinning for the checker
Every checker run pins the raw evidence it used (API responses, timestamps) to IPFS via Pinata's free tier, using an operator/project key, and returns the CID alongside the outcome. Only the CID goes on-chain. **Output:** a real CID that resolves to the actual evidence, not a placeholder.

### 4. Evidence Gateway
This is the x402-gated service *jurors* pay to query while they're still investigating, before a case resolves, separate in purpose from the resolution-checker even though it may hit similar upstreams. One endpoint per case type, real upstreams, log the case id on every call, respect rate limits. **Output:** an unpaid call returns HTTP 402 with valid payment terms, a paid call returns real data.

### 5. Agent reasoning loop
The core juror logic. Given a case, the model gets a toolbox scoped to that case's type and decides, using native tool-calling (not a fixed script, not a framework like LangChain), which tools to call and when it has enough to rule. Uncapped. **Output:** two structurally different questions should produce visibly different tool-call patterns in the logs, if every case produces the same call sequence regardless of content, the loop isn't actually reasoning and that's a bug.

### 6. Wire real x402 payments
Agent pays the Evidence Gateway per tool call using the real x402 protocol libraries, not a stub. Log every payment against its case id, you'll need the running total per case for net-profit calculation. **Output:** a real settled testnet payment per call, visible in your logs matched to the case it belongs to.

**Open item to settle with Abinav before this is fully wired end to end:** how does the resolver actually learn a juror's total x402 spend for a case, to compute net profit? The cleanest option consistent with how confidence is already handled (an agent policy the contract doesn't independently verify) is that the juror self-reports its cumulative spend alongside its reveal. That's my recommendation, but it means a juror could theoretically under-report to inflate its own apparent return, which would need to be named as a disclosed trust assumption the same way the operator-reporting and ENS-score-writing trust points already are. Confirm this shape with Abinav before you finalize the reveal payload, since it's a shared interface, not something either of you should decide alone.

### 7. Confidence-scaled stake and commit-reveal salts
Your agent decides a confidence level, derives a stake from it (your own sizing policy, think Kelly-criterion-style, bigger stake when genuinely more confident), generates a salt, and **persists that salt somewhere durable before committing**. Commit with `keccak256(ruling, confidence, salt, caseId, jurorAddress)`. **Output:** logs show confidence, chosen stake, and the salt at commit time, and a later reveal using that same salt succeeds.

### 8. Three distinct agent instances
All three run OpenRouter with NVIDIA Nemotron, same model. Differentiation comes entirely from system prompt (how much evidence is "enough," how it weighs conflicting sources) and tool/source preference, not from different models. Each needs its own Hedera keypair and its own ENS identity. **Output:** at least one real case where the three genuinely disagree, that's your proof the differentiation is real, not cosmetic.

### 9. Subgraph over the Sepolia anchor
Hedera has no native Graph Studio support, that's why finalized results get mirrored to a small anchor contract on Sepolia, which is what you actually index. AssemblyScript mappings (not TypeScript, it looks similar and isn't, no closures, no `any`, explicit types). Entities: `Verdict`, `ReturnCheckpoint`, `Distribution`. Build state from event deltas only, never an RPC call per record. **Output:** a real GraphQL query returns a real juror's history after at least one case has actually settled on-chain.

### 10. Ask Nyaya MCP server
Wraps the subgraph with tools that reason over the data, not print it. "Is juror 2 trustworthy" should come back with an actual judgement grounded in the real numbers ("12 cases judged, 8 correct, cumulative return of X%"), not a raw table dump. **Output:** that exact query, run for real, returns a grounded answer citing real indexed numbers.

---

## Where to go for more depth

This guide orients you and gives you your build order. It deliberately doesn't restate everything, the canonical detail lives in the repo and will get more precise over time:

- `docs/ARCHITECTURE.md` — full system design, the worked numeric examples for scoring and skim, the demo sequence
- `docs/SPONSOR-REQUIREMENTS.md` — exact qualification text for Hedera, ENS, and The Graph tracks
- `docs/PRIOR-ART.md` — what's already been built elsewhere and why ours differs, worth reading once so you don't accidentally converge on someone else's already-won idea
- `.claude/rules/agent.md` — the rules Claude Code itself follows when it's working in your packages, read it, it encodes several of the details above at the code level
- `.claude/rules/subgraph-mcp.md` — same, for your subgraph and MCP work

If anything in this guide seems to contradict what's actually in those files, the files win, ping Abinav, the docs get updated more often than this guide will.

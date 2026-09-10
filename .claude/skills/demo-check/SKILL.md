---
description: Walks the full end-to-end Nyaya loop and reports exactly where it breaks, so the demo does not fail live. Use before recording the demo video or when asked whether the whole flow works.
---

Trace the complete demo loop described at the end of `docs/ARCHITECTURE.md`, from case opening through to the Ask Nyaya query reflecting new state.

For each step: identify the code that executes it, confirm it targets live testnet rather than a local fork or mock, and confirm the step's output is actually consumed by the next step rather than being written and dropped.

Flag specifically:
- Any step that would silently no-op if a testnet call failed
- Any UI element that would render a success state the chain has not confirmed
- Any timing dependency that could make the demo hang while recording
- Any step whose output is not visible on screen, since a step the judge cannot see does not count as demonstrated

Report as an ordered list matching the demo sequence, marking each step working, broken, or unverified, with the file that implements it. End with the single highest-risk step for a live recording and how to de-risk it.

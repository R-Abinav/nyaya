---
description: Audits the current state of the repo against the ETHOnline sponsor qualification requirements for Hedera, ENS, and The Graph, and reports what would still fail judging. Use when asked whether a track is satisfied, before submission, or after finishing a major component.
argument-hint: [hedera|ens|graph|all]
---

Audit this repository against the qualification requirements in `docs/SPONSOR-REQUIREMENTS.md` for the track given in $ARGUMENTS, or all three if no argument was given.

For each requirement, do not take the code's word for it. Check for evidence:

1. Read the relevant source and confirm the feature actually exists rather than being stubbed, commented out, or TODO.
2. Search for mocked, hardcoded, or static data anywhere in the path that requirement depends on. Every one of these tracks disqualifies mocked or local-only datasets, so a mock in the critical path is a hard fail, not a warning.
3. Confirm the deployed-address JSON has a real address for every contract the requirement needs, on the right network.
4. For anything claiming a payment, a verification, or a signature check, confirm the success path is actually reached and not assumed.
5. Check the README covers what the track explicitly asks it to cover.

Report as a table: requirement, pass or fail, and the specific file and line that is your evidence. For failures, give the smallest concrete change that would fix it.

Be strict. A generous audit that misses a disqualifying mock is worse than no audit. If you cannot verify something from the repo alone, say it is unverified rather than assuming it passes.

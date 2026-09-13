/**
 * The resolution-checker: determines a case's real, ground-truth outcome.
 *
 * This is a genuinely different trust role from the juror agent (which is guessing at the truth using
 * paid-for evidence) and from the Evidence Gateway (which jurors pay to query while investigating). Kept
 * structurally separate on purpose, the same separation already enforced between the agent and the
 * gateway: this module imports ONLY evidenceService.js's raw, already-proven-live data calls — never
 * anything from backend/src/services/jurorAgent.js, x402Gateway.js, or x402HederaGateway.js — and nothing
 * in those files imports this module either. The operator's privileged on-chain write (submitOutcome)
 * lives in runResolutionChecker.ts, not here; this file only determines the truth, it never touches a
 * chain or a wallet.
 *
 * Reuses evidenceService.js's existing live calls per case type — no new API integrations. Cross-package
 * CommonJS reuse via createRequire, since packages/contracts is ESM and backend/ is CommonJS; the target
 * file's own env lookups still resolve relative to itself, unaffected by which script requires it.
 */
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeEvidenceTool } = require_("../../../../backend/src/services/evidenceService.js") as {
  executeEvidenceTool: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** Mirrors NyayaResolver.Ruling exactly (None=0, No=1, Yes=2) — the checker's own copy, not imported from
 *  jurorAgent.js, which keeps its own copy too. Never reorder. */
export const Ruling = { None: 0, No: 1, Yes: 2 } as const;

export type SourceRecord = { name: string; url: string; data: unknown };

export type OutcomeResult = {
  ruling: number;
  rawEvidence: Record<string, unknown>;
  sources: SourceRecord[];
  /** True today for every case type: evidenceService.js wires exactly one source per fact for each case
   *  type. Kept explicit rather than silently true, so a future second source flips this deliberately. */
  singleSourced: boolean;
  singleSourceNote?: string;
};

/**
 * If more than one source claims to measure the *same* fact, they must agree; disagreement is a real
 * finding to surface, never silently resolved by picking one. Every case type today has exactly one
 * source, so this is currently unexercised in practice — kept real (not a stub) for when a second source
 * is added.
 */
function assertSourcesAgree(sources: SourceRecord[], extractComparable: (data: unknown) => unknown): void {
  if (sources.length < 2) return;
  const [first, ...rest] = sources;
  const firstValue = extractComparable(first.data);
  for (const source of rest) {
    const value = extractComparable(source.data);
    if (JSON.stringify(value) !== JSON.stringify(firstValue)) {
      throw new Error(
        `Sources disagree on the same fact: ${first.name} says ${JSON.stringify(firstValue)}, ` +
          `${source.name} says ${JSON.stringify(value)}. Refusing to silently pick one.`,
      );
    }
  }
}

/**
 * Question template: "Will launch <launchId> scrub — fail to lift off within its scheduled window?"
 * Ground truth: Launch Library 2's own status. LAUNCHED_STATUSES are states that mean it actually left
 * the pad (on-time or not); anything else (Go/TBD/Hold, unchanged after the window) means it never flew,
 * i.e. scrubbed. This is a best-effort, documented heuristic against real API data, not a guarantee LL2
 * always reports promptly — recorded honestly, not oversold.
 *
 * SINGLE-SOURCED: Launch Library 2 (get_launch_status) is the only launch-status source evidenceService.js
 * wires. get_launch_pad_history returns a *different* fact (historical base rate at the pad), not a second
 * measurement of this specific launch's outcome, so it is never treated as cross-verification.
 */
async function resolveRocketLaunch(params: { launchId: string }): Promise<OutcomeResult> {
  const status = await executeEvidenceTool("get_launch_status", { launchId: params.launchId });
  const LAUNCHED_STATUSES = new Set(["Launch Successful", "Success", "Failure", "Partial Failure", "In Flight"]);
  const launched = LAUNCHED_STATUSES.has(String(status.status));
  const scrubbed = !launched;
  const source: SourceRecord = {
    name: "Launch Library 2",
    url: `https://ll.thespacedevs.com/2.2.0/launch/${params.launchId}`,
    data: status,
  };
  return {
    ruling: scrubbed ? Ruling.Yes : Ruling.No,
    rawEvidence: { launchId: params.launchId, status },
    sources: [source],
    singleSourced: true,
    singleSourceNote:
      "Launch Library 2 is the only launch-status source wired in evidenceService.js. get_launch_pad_history " +
      "measures a different fact (historical pad base-rate), not this launch's own outcome, so it is not a " +
      "second source for this fact.",
  };
}

/**
 * Question template: "Will flight <icao24> still be on the ground at resolution time?" — a snapshot check,
 * not a schedule-vs-actual delay computation: evidenceService.js has no flight-schedule source wired
 * (OpenSky's /states/all returns only a live position snapshot, never a scheduled time), so "delayed by N
 * minutes relative to schedule" cannot honestly be computed from what's available. This is a real,
 * documented limitation, not silently worked around.
 *
 * SINGLE-SOURCED: OpenSky Network (get_flight_status) is the only live flight-position source wired.
 * get_weather (Open-Meteo) measures ambient conditions, a different fact used by jurors as investigative
 * context, not a second measurement of flight status, so it is not a second source for this fact.
 */
async function resolveFlightDelay(params: { icao24: string }): Promise<OutcomeResult> {
  const state = await executeEvidenceTool("get_flight_status", { icao24: params.icao24 });
  const stillOnGround = state.found !== true || state.onGround === true;
  const source: SourceRecord = {
    name: "OpenSky Network",
    url: `https://opensky-network.org/api/states/all?icao24=${params.icao24}`,
    data: state,
  };
  return {
    ruling: stillOnGround ? Ruling.Yes : Ruling.No,
    rawEvidence: { icao24: params.icao24, state },
    sources: [source],
    singleSourced: true,
    singleSourceNote:
      "OpenSky's live ADS-B snapshot is the only flight-position source wired in evidenceService.js. " +
      "get_weather (Open-Meteo) measures ambient conditions, a different fact, not a second measurement of " +
      "flight status, so it is not a second source for this fact. No flight-schedule source is wired at all, " +
      "so a schedule-vs-actual delay computation is not possible today — only a ground/airborne snapshot is.",
  };
}

/**
 * Question template: "Will <owner>/<repo> have at least <threshold> stars by resolution time?"
 * Ground truth: GitHub's own REST API star count.
 *
 * SINGLE-SOURCED: GitHub's REST API is the sole authoritative source for its own star count — there is no
 * independent alternative source for "what GitHub itself reports," unlike a fact multiple parties observe.
 * get_repo_activity measures commit participation, a different fact (momentum), not a second measurement
 * of the star count, so it is not a second source for this fact.
 */
async function resolveGithubStars(params: { owner: string; repo: string; threshold: number }): Promise<OutcomeResult> {
  const repoData = await executeEvidenceTool("get_repo_stars", { owner: params.owner, repo: params.repo });
  const stars = Number(repoData.stars);
  const met = stars >= params.threshold;
  const source: SourceRecord = {
    name: "GitHub REST API",
    url: `https://api.github.com/repos/${params.owner}/${params.repo}`,
    data: repoData,
  };
  return {
    ruling: met ? Ruling.Yes : Ruling.No,
    rawEvidence: { owner: params.owner, repo: params.repo, threshold: params.threshold, repoData },
    sources: [source],
    singleSourced: true,
    singleSourceNote:
      "GitHub's REST API is the sole authoritative source for its own star count. get_repo_activity measures " +
      "commit participation, a different fact, not a second measurement of stars, so it is not a second " +
      "source for this fact.",
  };
}

export type CaseTypeParams = {
  "rocket-launch": { launchId: string };
  "flight-delay": { icao24: string };
  "github-stars": { owner: string; repo: string; threshold: number };
};

/** Every case type currently supported, dispatching to the resolver above. Adding a case type means adding
 *  one entry here and one resolver function, reusing whatever evidenceService.js already wires — never a
 *  new API integration inside this file. */
export async function determineOutcome<T extends keyof CaseTypeParams>(
  caseType: T,
  params: CaseTypeParams[T],
): Promise<OutcomeResult> {
  let result: OutcomeResult;
  switch (caseType) {
    case "rocket-launch":
      result = await resolveRocketLaunch(params as CaseTypeParams["rocket-launch"]);
      break;
    case "flight-delay":
      result = await resolveFlightDelay(params as CaseTypeParams["flight-delay"]);
      break;
    case "github-stars":
      result = await resolveGithubStars(params as CaseTypeParams["github-stars"]);
      break;
    default:
      throw new Error(`Unknown case type: ${String(caseType)}`);
  }
  // Real for when a second source exists; a no-op today since every case type is single-sourced above.
  assertSourcesAgree(result.sources, (data) => data);
  return result;
}

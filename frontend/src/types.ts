// ─── Core domain types ────────────────────────────────────────────────────────

export type CaseStatus = 'upcoming' | 'active' | 'resolved';

/** Real, on-chain-sourced per-juror participation in a case — commit/reveal tx hashes and ruling, from
 *  GET /cases/:id. A juror who never committed on this case simply isn't in this array. */
export interface CaseJurorParticipation {
  jurorId: string;
  jurorName: string;
  address: string;
  commitTx: string;
  revealTx: string | null;
  ruling: number | null; // 0: None, 1: No, 2: Yes
}

export interface Case {
  id: string;
  title: string;        // the question
  caseType: string;
  status: CaseStatus;
  startsAt: string;     // commitDeadline
  resolvesAt: string;   // resolutionTime
  bounty: number;       // in HBAR
  totalStaked: number;  // alias for bounty in UI for now
  outcome: number;      // 0: None, 1: No, 2: Yes
  jurors?: CaseJurorParticipation[];
  submitOutcomeTx?: string | null;
  settleTx?: string | null;
}

export interface JurorInfo {
  id: string;
  name: string;
  ensName: string;
  address: string;
}

/** Real share price/supply for one juror, from JurorShareMarket + its ATS token. `registered: false`
 *  means this juror has no share token yet — a real state, not an error. There is one price, never a
 *  separate buy/sell price: the contract has no bid/ask spread, only a flat 2% trade fee. */
export interface JurorShareInfo {
  registered: boolean;
  tokenAddress: string | null;
  priceTinybar: string | null;
  decimals: number | null;
  totalSupply: string | null;
}

/** A juror as an investable asset — GET /jurors and GET /jurors/:id. */
export interface JurorMarket {
  id: string;
  name: string;
  ensName: string;
  address: string;
  hotWallet: string;
  persona: string;
  casesJudged: number;
  lastCaseId: string | null;
  cumulativeReturnBps: string;
  sharePrice: JurorShareInfo;
}

/** One real settlement checkpoint for a juror's return-over-time chart — GET /jurors/:id/history. */
export interface JurorReturnPoint {
  caseId: string;
  blockNumber: number;
  timestamp: number; // unix seconds
  result: number; // 0 Correct, 1 Incorrect, 2 Unrevealed, 3 NoCommitment, 4 Cancelled
  stake: string;
  x402Spend: string;
  reward: string;
  net: string;
  returnBps: string;
}

/** Real chain config the frontend needs for wallet-signed transactions — GET /config/chain. Never
 *  hardcoded frontend-side; always fetched fresh from the same deployments file the backend reads. */
export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  contracts: {
    JurorShareMarket: string | null;
    JurorTreasury: string | null;
    NyayaResolver: string | null;
  };
}

/** The demo-trigger job's real phase, polled from GET /demo/run-case/:jobId. Mirrors runFullCase.js's own
 *  internal phases exactly — never a bare "running" spinner state. */
export type DemoJobPhase =
  | 'opening'
  | 'investigating'
  | 'awaiting_reveal_window'
  | 'revealing'
  | 'awaiting_resolution_window'
  | 'resolving'
  | 'settling'
  | 'settled'
  | 'failed';

export interface DemoJurorDecision {
  jurorName: string;
  outcome: 'committed' | 'declined';
  confidenceBps: number;
  stakeHbar?: number;
}

/** One real on-chain event, from GET /activity — backs the live activity panel. */
export interface ActivityEvent {
  type: 'Committed' | 'Revealed' | 'OutcomeSubmitted' | 'CaseSettled' | 'CaseOpened';
  caseId: string | null;
  juror: string | null;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
}

export interface DemoJob {
  id: string;
  phase: DemoJobPhase;
  caseId: string | null;
  caseType: string;
  question: string | null;
  jurorDecisions: DemoJurorDecision[];
  txHashes: Record<string, string | Record<string, string>>;
  ruling: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  log: string[];
}

export interface ToolCall {
  toolName: string;
  args: any;
  result: any;
  cost: number;
  paymentStatus: string;
}

export interface EvidenceTrail {
  toolCalls: ToolCall[];
  totalSpent: number;
  reasoning?: string;
  stopReason?: string;
  verdict?: number;
  bettingFraction?: number;
  outcome?: 'committed' | 'declined';
  selectedOutcome?: string;
  declineReason?: string;
}

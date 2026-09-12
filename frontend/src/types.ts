export type Option = { id: string; label: string; betCount?: number };
export type Prediction = {
  id: string; statement: string; status?: string; expired?: boolean; expiresAt: string;
  options: Option[]; totalBets: number; totalPoolCents: number; performancePoolCents?: number;
  performanceByModel?: Record<string, { stakeCents: number; betCount: number }>;
  modelStakes?: Record<string, number>;
  winningOptionId?: string;
};
export type Juror = { id: string; name: string; ensName?: string; toolPreferences?: Record<string, unknown>; bettingFractionThresholds?: unknown };
export type Bet = { optionId: string; bettorId: string; predictionId: string; placedAt: string; prediction?: Prediction };
export type ApiError = { error: string };

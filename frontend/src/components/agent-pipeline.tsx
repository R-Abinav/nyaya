import { useState } from 'react';
import type { JurorInfo, ToolCall } from '../types';
import { useJurorReasoning } from '../lib/hooks';

interface JurorPipelineProps {
  juror: JurorInfo;
  caseId: string;
  caseOutcome?: number; // 0: None, 1: No, 2: Yes
}

function mapVerdictToRuling(verdictText: string): number {
  const normalized = String(verdictText || '').trim().toLowerCase();
  if (['yes', 'true', 'succeed', 'succeeded', 'on-time', 'met'].some(w => normalized.includes(w))) return 2;
  if (['no', 'false', 'fail', 'failed', 'delayed', 'not met', 'undetermined'].some(w => normalized.includes(w))) return 1;
  return 0;
}

export function JurorPipeline({ juror, caseId, caseOutcome }: JurorPipelineProps) {
  const { trail, loading } = useJurorReasoning(caseId, juror.id);
  const [selectedCallIdx, setSelectedCallIdx] = useState<number | undefined>();

  const toggleCall = (idx: number) => {
    setSelectedCallIdx((prev) => (prev === idx ? undefined : idx));
  };

  const isResolved = caseOutcome !== undefined && caseOutcome !== 0;
  let isCorrect = false;
  let jurorRulingNum = 0;
  if (isResolved && trail?.selectedOutcome) {
    jurorRulingNum = mapVerdictToRuling(trail.selectedOutcome);
    isCorrect = jurorRulingNum === caseOutcome;
  }

  return (
    <div className="rounded-xl border border-line bg-panel">
      {/* Juror header */}
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <AgentAvatar name={juror.name} />
          <span className="text-sm font-medium text-ink">{juror.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-fg tabular-nums">
            {/* trail.totalSpent is already HBAR-denominated by the time it reaches this endpoint —
                jurorAgent.js's executeToolCall computes cost in HBAR, not tinybars, before it's ever
                recorded. Dividing by 1e8 here (treating it as raw tinybars) rendered every real spend as
                ~0.00 HBAR regardless of the real amount — a genuine unit bug, not a display choice. */}
            {trail ? `${trail.totalSpent.toFixed(2)} HBAR spent` : (loading ? 'Loading...' : 'Investigating...')}
          </span>
          {isResolved && trail?.selectedOutcome && (
            <OutcomeChip outcome={isCorrect ? 'correct' : 'incorrect'} />
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="px-5 py-5 flex flex-col gap-0">
        {loading && !trail && (
          <p className="text-sm text-muted-fg italic text-center py-4">Loading investigation trail...</p>
        )}
        
        {trail?.toolCalls.map((call, index) => (
          <div key={index} className="relative flex items-start gap-4 group/step">
            {(index !== trail.toolCalls.length - 1 || trail.reasoning) && (
              <div className="absolute left-[15.5px] top-8 bottom-[-24px] w-[2px] bg-line group-hover/step:bg-accent/30 transition-colors duration-300" aria-hidden />
            )}
            
            <div className="relative z-10 pt-0.5 shrink-0">
              <StepNode index={index + 1} isSelected={selectedCallIdx === index} onClick={() => toggleCall(index)} />
            </div>

            <div className="flex-1 pb-6">
              <div className="cursor-pointer group" onClick={() => toggleCall(index)}>
                <div className="flex items-center gap-2">
                  <h4 className={`text-sm font-medium transition-colors ${selectedCallIdx === index ? 'text-accent' : 'text-ink'}`}>
                    Called {call.toolName}
                  </h4>
                  <span className="text-[10px] text-muted-fg px-1.5 py-0.5 rounded-full border border-line bg-canvas">
                    Cost: {call.cost.toFixed(2)} HBAR
                  </span>
                </div>
              </div>

              {selectedCallIdx === index && (
                <div className="mt-3 animate-in rounded-lg border border-line bg-canvas p-4 shadow-sm grid gap-4 sm:grid-cols-2">
                  <DetailSection label="Arguments">
                    {JSON.stringify(call.args, null, 2)}
                  </DetailSection>
                  <DetailSection label="Result" className="sm:col-span-2">
                    {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                  </DetailSection>
                </div>
              )}
            </div>
          </div>
        ))}

        {trail && (
          <div className="relative flex items-start gap-4">
            <div className="relative z-10 pt-0.5 shrink-0">
              <StepNode index={99} isSelected={false} isFinal onClick={() => {}} />
            </div>
            <div className="flex-1 pb-2">
              <h4 className="text-sm font-medium text-ink mb-2">Final Verdict</h4>
              <div className="text-sm text-ink whitespace-pre-line bg-canvas border border-line p-4 rounded-md">
                {trail.outcome === 'declined' ? (
                  <p className="text-amber-600 mb-2 font-medium">Declined to commit: {trail.declineReason}</p>
                ) : null}
                <p>{trail.reasoning}</p>
                {trail.stopReason && (
                  <p className="mt-2 text-muted-fg text-xs"><span className="font-medium text-ink">Stop reason:</span> {trail.stopReason}</p>
                )}
              </div>
              {trail.selectedOutcome && (
                <p className="mt-2 text-sm font-medium text-accent">
                  Selected Outcome: {trail.selectedOutcome} (Fraction: {trail.bettingFraction})
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepNode({ index, isSelected, onClick, isFinal }: { index: number; isSelected: boolean; onClick: () => void; isFinal?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isFinal}
      className="flex items-center justify-center focus-visible:outline-none relative group"
    >
      {/* Glow effect on hover/select */}
      <span className={`absolute inset-0 rounded-full blur-md transition-opacity duration-300 ${isSelected || isFinal ? 'opacity-40' : 'opacity-0 group-hover:opacity-20'} ${isFinal ? 'bg-correct' : 'bg-accent'}`} aria-hidden="true" />
      
      <span className={`relative grid h-8 w-8 place-items-center rounded-full border-[1.5px] text-xs font-semibold transition-all duration-300 shadow-sm
        ${isSelected 
          ? 'border-accent bg-accent text-white scale-110 shadow-[0_0_12px_rgba(56,189,248,0.5)]' 
          : isFinal 
          ? 'border-correct bg-correct/10 text-correct shadow-[0_0_10px_rgba(52,211,153,0.3)]' 
          : 'border-line bg-canvas text-muted-fg group-hover:border-accent/50 group-hover:text-accent'}
      `}>
        {isFinal ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : index}
      </span>
    </button>
  );
}

function DetailSection({ label, children, className = '' }: { label: string; children: string; className?: string; }) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium text-muted-fg">{label}</p>
      <pre className="text-xs leading-relaxed text-ink whitespace-pre-wrap font-mono bg-panel p-2 rounded">{children}</pre>
    </div>
  );
}

function AgentAvatar({ name }: { name: string }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
      {name.charAt(0)}
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: 'correct' | 'incorrect' }) {
  const isCorrect = outcome === 'correct';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${isCorrect ? 'bg-correct/10 text-correct' : 'bg-incorrect/10 text-incorrect'}`}>
      {isCorrect ? 'Correct' : 'Incorrect'}
    </span>
  );
}

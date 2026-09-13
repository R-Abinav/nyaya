import { useMarket } from '../lib/hooks';
import { StatusBadge, ErrorState, Spinner } from './ui';
import { useParams, Link } from 'react-router-dom';
import { TxHashLink } from './tx-hash-link';

// ─── Case detail page ───────────────────────────────────────────────────────

export function CaseDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { market: caseData, loading, error, reload } = useMarket(id);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (error || !caseData) {
    return <ErrorState message={error ?? 'Case not found'} onRetry={reload} />;
  }

  const isUpcoming = caseData.status === 'upcoming';
  const isActive = caseData.status === 'active';
  const isResolved = caseData.status === 'resolved';

  return (
    <div className="flex flex-col gap-8 animate-in pb-16">
      <Link
        to="/cases"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-ink transition-colors w-fit group"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="group-hover:-translate-x-0.5 transition-transform">
          <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        All cases
      </Link>

      <div className="border border-line rounded-lg p-6 bg-canvas">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <StatusBadge status={caseData.status} />
          {isResolved && (
            <span className="text-xs font-medium text-muted-fg uppercase tracking-wider">
              Resolved {caseData.resolvesAt ? new Date(caseData.resolvesAt).toLocaleDateString() : ''}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-ink leading-snug sm:text-3xl max-w-3xl mb-2">
          {caseData.title}
        </h1>
        <p className="text-sm font-mono text-muted-fg">
          Type: {caseData.caseType}
        </p>

        <div className="mt-8 flex flex-wrap gap-12 border-t border-line pt-6">
          <StatItem label="Case Bounty" value={`${caseData.totalStaked.toFixed(2)} HBAR`} />
          {isUpcoming && (
            <StatItem
              label="Commit Deadline"
              value={new Date(caseData.startsAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            />
          )}
          {isResolved && (
            <StatItem
              label="Ground Truth Outcome"
              value={caseData.outcome === 2 ? 'Yes' : (caseData.outcome === 1 ? 'No' : 'None')}
            />
          )}
        </div>

        {(caseData.submitOutcomeTx || caseData.settleTx) && (
          <div className="mt-6 flex flex-wrap gap-6 border-t border-line pt-5">
            {caseData.submitOutcomeTx && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-fg mb-1">submitOutcome</p>
                <TxHashLink hash={caseData.submitOutcomeTx} />
              </div>
            )}
            {caseData.settleTx && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-fg mb-1">settle</p>
                <TxHashLink hash={caseData.settleTx} />
              </div>
            )}
          </div>
        )}
      </div>

      {isActive && (
        <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
          <p className="text-sm font-medium text-accent">
            Case is live — agents are investigating
          </p>
          <p className="mt-0.5 text-xs text-muted-fg">
            The commit deadline has passed. Watch the juror pipelines below update as they spend x402 on evidence.
          </p>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-xs font-semibold text-muted-fg uppercase tracking-widest">
          Juror Participation
        </h2>
        {!caseData.jurors || caseData.jurors.length === 0 ? (
          <p className="text-sm text-muted-fg italic">No juror has committed on this case yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {caseData.jurors.map(juror => (
              <div key={juror.jurorId} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/jurors/${juror.jurorId}`} className="font-medium text-ink hover:text-accent transition-colors">
                    {juror.jurorName}
                  </Link>
                  <span className="text-xs text-muted-fg">
                    {juror.ruling === null ? 'Not yet revealed' : juror.ruling === 2 ? 'Ruled Yes' : 'Ruled No'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-fg mb-1">commit</p>
                    <TxHashLink hash={juror.commitTx} />
                  </div>
                  {juror.revealTx && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-fg mb-1">reveal</p>
                      <TxHashLink hash={juror.revealTx} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-fg mb-1">{label}</p>
      <p className="text-lg font-medium text-ink tabular-nums">{value}</p>
    </div>
  );
}

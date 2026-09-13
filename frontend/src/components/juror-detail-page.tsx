import { useParams, Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useJurorMarket, useJurorHistory, useChainConfig, useMarket } from '../lib/hooks';
import { ReturnChart } from './return-chart';
import { BuySharesPanel } from './buy-shares-panel';
import { TickingPrice } from './ticking-price';
import { JurorPipeline } from './agent-pipeline';
import { ErrorState, Spinner, EmptyState } from './ui';

function formatHbar(v: number): string {
  return `${v.toFixed(4)} HBAR`;
}

export function JurorDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { juror, loading, error, reload } = useJurorMarket(id);
  const { history, loading: historyLoading } = useJurorHistory(id);
  const { config: chainConfig } = useChainConfig();
  // Only fetch the case if this juror has actually judged one — a fresh juror's lastCaseId is null, and
  // useMarket('') would otherwise fire a request for a case that doesn't exist.
  const { market: lastCase } = useMarket(juror?.lastCaseId ?? '');
  const prefersReducedMotion = useReducedMotion();

  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        <Spinner size={22} />
        <p className="text-sm text-muted-fg">Reading {id}'s live stats from Hedera…</p>
      </div>
    );
  }

  if (error || !juror) return <ErrorState message={error ?? 'Juror not found'} onRetry={reload} />;

  const priceHbar = juror.sharePrice.priceTinybar ? Number(juror.sharePrice.priceTinybar) / 1e8 : 0;
  const returnPct = Number(juror.cumulativeReturnBps) / 100;
  const isUp = returnPct >= 0;

  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.1 } } }} className="flex flex-col gap-8 pb-32 pt-8">
      <motion.div variants={reveal}>
        <Link to="/jurors" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-ink transition-colors w-fit group">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="group-hover:-translate-x-0.5 transition-transform">
            <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All jurors
        </Link>
      </motion.div>

      <motion.div variants={reveal} className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-serif text-4xl text-ink sm:text-5xl">{juror.name}</h1>
            <p className="mt-1 font-mono text-xs text-muted-fg">{juror.ensName}</p>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-fg">{juror.persona}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 border-y border-line py-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-fg mb-1.5">Price</p>
              <TickingPrice value={priceHbar} format={formatHbar} className="font-serif text-2xl text-ink" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-fg mb-1.5">Cumulative return</p>
              <p className={`font-serif text-2xl tabular-nums ${isUp ? 'text-correct' : 'text-incorrect'}`}>
                {isUp ? '+' : ''}{returnPct.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-fg mb-1.5">Cases judged</p>
              <p className="font-serif text-2xl tabular-nums text-ink">{juror.casesJudged}</p>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-fg">Return on capital over time</p>
            {historyLoading ? (
              <div className="flex h-56 items-center justify-center"><Spinner size={18} /></div>
            ) : (
              <ReturnChart history={history} />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-fg">Buy shares</p>
          <BuySharesPanel juror={juror} chainConfig={chainConfig} />
        </div>
      </motion.div>

      <motion.div variants={reveal}>
        <h2 className="mb-4 text-xs font-semibold text-muted-fg uppercase tracking-widest">
          Most recent investigation
        </h2>
        {!juror.lastCaseId ? (
          <EmptyState
            title="No cases judged yet"
            description="This juror hasn't investigated a case yet. Its reasoning trail will appear here after its first real investigation."
          />
        ) : (
          <JurorPipeline
            juror={{ id: juror.id, name: juror.name, ensName: juror.ensName, address: juror.address }}
            caseId={juror.lastCaseId}
            caseOutcome={lastCase?.outcome}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

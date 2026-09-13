import { Link } from 'react-router-dom';
import { useMarkets } from '../lib/hooks';
import type { Case } from '../types';
import { ErrorState, EmptyState } from './ui';
import { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// ─── Cases feed (renamed from /markets: cases are the evidence trail, jurors are the investable asset) ──

export function CasesPage() {
  const { markets: cases, loading, error, reload } = useMarkets();
  const [mounted, setMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (loading && !mounted) {
    return (
      <div className="flex h-screen items-center justify-center">
        <motion.div
          animate={prefersReducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-2xl font-serif text-ink"
        >
          Nyaya.
        </motion.div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  // Group: resolved last
  const ordered = [
    ...cases.filter((c) => c.status === 'upcoming'),
    ...cases.filter((c) => c.status === 'active'),
    ...cases.filter((c) => c.status === 'resolved'),
  ];

  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, filter: 'blur(20px)', y: 40, scale: 0.98 }, show: { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1, transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] as const } } };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15 } },
  };

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer} className="pb-32 pt-20">
      <motion.div variants={reveal} className="mb-24 max-w-4xl mx-auto">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.4em] text-muted-fg">Dockets</p>
        <h1 className="font-serif text-5xl md:text-7xl font-normal tracking-tight text-ink leading-[1.05]">
          Recent Investigations
        </h1>
        <p className="mt-8 text-xl md:text-2xl text-muted-fg font-light leading-relaxed max-w-2xl">
          Every real case, the real evidence jurors bought, and the real ground truth they were graded against.
        </p>
      </motion.div>

      {ordered.length === 0 ? (
        <motion.div variants={reveal} className="max-w-4xl mx-auto">
          <EmptyState title="No cases yet" description="Cases will appear here once they're opened." />
        </motion.div>
      ) : (
        <div className="max-w-6xl mx-auto flex flex-col gap-8">
          {ordered.map((c) => (
            <motion.div key={c.id} variants={reveal}>
              <CaseRow caseData={c} />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Single case row ──────────────────────────────────────────────────────────

function CaseRow({ caseData }: { caseData: Case }) {
  const timeLabel = getTimeLabel(caseData);

  return (
    <Link
      to={`/cases/${caseData.id}`}
      className="group block relative overflow-hidden py-6 hover:bg-canvas/50 transition-colors"
    >
      <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-6 relative z-10 transition-transform duration-700 md:group-hover:translate-x-6">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <span className={`h-2 w-2 rounded-full ${caseData.status === 'active' ? 'bg-amber-400 animate-pulse' : 'bg-accent'}`} />
            <span className="text-xs uppercase tracking-[0.2em] text-muted-fg">{caseData.status}</span>
            {caseData.status === 'resolved' && (
              <span className={`text-xs uppercase tracking-[0.2em] ${caseData.outcome === 2 ? 'text-correct' : (caseData.outcome === 1 ? 'text-incorrect' : 'text-muted-fg')}`}>
                {caseData.outcome === 2 ? 'Result: Yes' : (caseData.outcome === 1 ? 'Result: No' : 'Result: None')}
              </span>
            )}
          </div>
          <h2 className="font-serif text-3xl md:text-5xl text-ink truncate group-hover:text-accent transition-colors duration-500 leading-[1.1]">
            {caseData.title}
          </h2>
        </div>

        <div className="flex shrink-0 items-end gap-12 text-right mt-4 md:mt-0">
          <div className="hidden sm:block">
            <p className="text-[10px] text-muted-fg uppercase tracking-[0.3em] mb-2">{timeLabel.label}</p>
            <p className="text-xl font-serif text-ink">{timeLabel.value}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-fg uppercase tracking-[0.3em] mb-2">Bounty</p>
            <p className="font-serif text-3xl tabular-nums text-ink">{caseData.totalStaked.toFixed(2)} <span className="text-lg text-muted-fg font-sans">HBAR</span></p>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeLabel(c: Case): { label: string; value: string } {
  const now = Date.now();

  if (c.status === 'upcoming') {
    const diff = new Date(c.startsAt).getTime() - now;
    return { label: 'Commit closes', value: formatCountdown(diff) };
  }
  if (c.status === 'active') {
    const diff = new Date(c.startsAt).getTime() - now;
    return { label: 'Started', value: diff < 0 ? formatAgo(-diff) : 'just now' };
  }
  if (c.resolvesAt) {
    return { label: 'Resolved', value: formatDate(c.resolvesAt) };
  }
  return { label: '', value: '' };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'closing';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatAgo(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

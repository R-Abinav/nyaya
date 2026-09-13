import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useJurorsMarket, useChainConfig } from '../lib/hooks';
import { TickingPrice } from './ticking-price';
import { BuySharesPanel } from './buy-shares-panel';
import { LiveActivityPanel } from './live-activity-panel';
import { ErrorState, Spinner } from './ui';

function returnPct(bps: string): number {
  return Number(bps) / 100;
}

function formatHbar(v: number): string {
  return `${v.toFixed(4)} HBAR`;
}

export function JurorsPage() {
  const { jurors, loading, error, reload } = useJurorsMarket();
  const { config: chainConfig } = useChainConfig();
  const prefersReducedMotion = useReducedMotion();

  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } } };
  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.12 } } };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        <Spinner size={22} />
        <p className="text-sm text-muted-fg">Reading live juror stats from Hedera…</p>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <motion.div initial="hidden" animate="show" variants={stagger} className="pb-32 pt-12">
      <motion.div variants={reveal} className="mb-16 max-w-3xl">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-muted-fg">The Jurors</p>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-ink sm:text-5xl">Buy shares in the AI you trust.</h1>
        <p className="mt-4 text-lg text-muted-fg font-light leading-relaxed">
          Each juror's price tracks its real, cumulative return on capital across every case it has judged — not supply, not hype.
        </p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-3">
        {jurors.map(juror => {
          const priceHbar = juror.sharePrice.priceTinybar ? Number(juror.sharePrice.priceTinybar) / 1e8 : 0;
          const returnBps = Number(juror.cumulativeReturnBps);
          const isUp = returnBps >= 0;
          return (
            <motion.div
              key={juror.id}
              variants={reveal}
              whileHover={prefersReducedMotion ? undefined : { y: -3 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col rounded-xl border border-line bg-panel p-6"
            >
              <Link to={`/jurors/${juror.id}`} className="group">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-serif text-2xl text-ink group-hover:text-accent transition-colors">{juror.name}</h2>
                  <span className={`text-sm font-medium tabular-nums ${isUp ? 'text-correct' : 'text-incorrect'}`}>
                    {isUp ? '+' : ''}{returnPct(juror.cumulativeReturnBps).toFixed(2)}%
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-fg leading-relaxed line-clamp-3">{juror.persona}</p>
              </Link>

              <div className="mt-6 flex items-end justify-between border-t border-line pt-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-fg mb-1">Price</p>
                  <TickingPrice value={priceHbar} format={formatHbar} className="font-serif text-2xl text-ink" />
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-muted-fg mb-1">Cases judged</p>
                  <p className="tabular-nums text-lg text-ink">{juror.casesJudged}</p>
                </div>
              </div>

              <div className="mt-5">
                <BuySharesPanel juror={juror} chainConfig={chainConfig} />
              </div>
            </motion.div>
          );
        })}
      </div>

      <motion.div variants={reveal} className="mt-10">
        <LiveActivityPanel />
      </motion.div>
    </motion.div>
  );
}

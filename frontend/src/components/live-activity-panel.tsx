import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useActivity } from '../lib/hooks';
import { TxHashLink } from './tx-hash-link';
import { Spinner } from './ui';

const EVENT_LABEL: Record<string, string> = {
  Committed: 'committed',
  Revealed: 'revealed',
  OutcomeSubmitted: 'outcome submitted',
  CaseSettled: 'settled',
  CaseOpened: 'case opened',
};

function shortAddress(address: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return '';
  const diffMs = Date.now() - unixSeconds * 1000;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Real recent transaction hashes off the live resolver — proof this is a real chain, not a demo backdrop. */
export function LiveActivityPanel() {
  const { events, loading, error } = useActivity(12);
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-fg">Live activity</p>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-fg">
          <span className={`h-1.5 w-1.5 rounded-full bg-correct ${prefersReducedMotion ? '' : 'animate-pulse'}`} />
          Hedera testnet
        </span>
      </div>

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center py-8"><Spinner size={16} /></div>
      ) : error ? (
        <p className="text-xs text-incorrect">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-fg italic">No on-chain activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {events.map(event => (
              <motion.li
                key={event.txHash}
                initial={prefersReducedMotion ? undefined : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-muted-fg">
                  {event.caseId && <span className="text-ink font-medium">Case {event.caseId}</span>}{' '}
                  {EVENT_LABEL[event.type] ?? event.type}
                  {event.juror && <span className="ml-1 font-mono">{shortAddress(event.juror)}</span>}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-muted-fg">{timeAgo(event.timestamp)}</span>
                  <TxHashLink hash={event.txHash} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDemoJob, getStoredAdminKey, setStoredAdminKey } from '../lib/hooks';
import { Button, Input } from './ui';
import { TxHashLink } from './tx-hash-link';
import type { DemoJobPhase } from '../types';

const PHASE_LABEL: Record<DemoJobPhase, string> = {
  opening: 'Opening a real case on-chain',
  investigating: 'Jurors investigating (real LLM + real evidence spend)',
  awaiting_reveal_window: 'Waiting for the real on-chain commit deadline',
  revealing: 'Jurors revealing (real transactions)',
  awaiting_resolution_window: 'Waiting for the real on-chain resolution window',
  resolving: 'Resolution-checker determining the real outcome',
  settling: 'Settling on-chain',
  settled: 'Settled',
  failed: 'Failed',
};

const PHASE_ORDER: DemoJobPhase[] = [
  'opening', 'investigating', 'awaiting_reveal_window', 'revealing',
  'awaiting_resolution_window', 'resolving', 'settling', 'settled',
];

/**
 * The demo-trigger control. Deliberately built to look and feel like an internal operator tool, not a
 * feature of the product: dashed borders, mono labels, an explicit "ADMIN — NOT PART OF THE APP" banner.
 * Runs the real openCase -> agent investigation -> reveal -> resolution-checker -> settle sequence — the
 * exact same real scripts proven live for case 6, just against a short-window case. Nothing here is
 * simulated; the admin key required to use it is entered here, never bundled into the app.
 */
export function DemoTriggerPage() {
  const { job, error, starting, start } = useDemoJob();
  const [adminKey, setAdminKey] = useState(() => getStoredAdminKey());

  const currentPhaseIndex = job ? PHASE_ORDER.indexOf(job.phase) : -1;

  return (
    <div className="mx-auto max-w-2xl py-12">
      <div className="mb-8 rounded-lg border-2 border-dashed border-amber-400/40 bg-amber-400/5 p-4">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-400">
          Admin — not part of the app
        </p>
        <p className="mt-1 text-xs text-muted-fg">
          Triggers a real sequence of on-chain transactions against a fresh testnet case. This is an
          operator tool, kept structurally separate from the real product surface above.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-line bg-panel/50 p-6 font-mono">
        <label className="block text-[10px] uppercase tracking-widest text-muted-fg mb-2">Admin key</label>
        <div className="flex gap-2">
          <Input
            type="password"
            value={adminKey}
            onChange={e => {
              setAdminKey(e.target.value);
              setStoredAdminKey(e.target.value);
            }}
            placeholder="ADMIN_API_KEY"
            className="font-mono"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-fg">Stored only in this browser tab's session storage, never in app code.</p>

        <Button
          className="mt-5 w-full"
          onClick={() => void start()}
          disabled={starting || !adminKey || (job !== null && job.phase !== 'settled' && job.phase !== 'failed')}
        >
          {starting ? 'Starting…' : 'Run real demo case'}
        </Button>

        {error && <p className="mt-3 text-xs text-incorrect">{error}</p>}

        <AnimatePresence>
          {job && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 border-t border-dashed border-line pt-5">
              <p className="text-xs text-muted-fg">
                Case {job.caseId ?? '…'}{job.question ? ` — ${job.question}` : ''}
              </p>

              <ol className="mt-4 flex flex-col gap-2">
                {PHASE_ORDER.map((phase, index) => {
                  const isDone = job.phase === 'failed' ? index < currentPhaseIndex : index < currentPhaseIndex || job.phase === 'settled';
                  const isCurrent = phase === job.phase;
                  return (
                    <li key={phase} className={`flex items-center gap-2 text-xs ${isCurrent ? 'text-accent' : isDone ? 'text-correct' : 'text-muted-fg'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isCurrent ? 'bg-accent animate-pulse' : isDone ? 'bg-correct' : 'bg-line'}`} />
                      {PHASE_LABEL[phase]}
                    </li>
                  );
                })}
              </ol>

              {job.phase === 'failed' && (
                <p className="mt-4 text-xs text-incorrect">{job.error}</p>
              )}

              {job.jurorDecisions.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-fg">Juror decisions</p>
                  {job.jurorDecisions.map((d, i) => (
                    <p key={i} className="text-xs text-ink">
                      {d.jurorName}: {d.outcome === 'committed' ? `committed (${d.confidenceBps / 100}%)` : `declined (${d.confidenceBps / 100}%)`}
                    </p>
                  ))}
                </div>
              )}

              {Object.keys(job.txHashes).length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-fg">Transactions</p>
                  {Object.entries(job.txHashes).map(([key, value]) =>
                    typeof value === 'string' ? (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-muted-fg">{key}</span>
                        <TxHashLink hash={value} />
                      </div>
                    ) : (
                      Object.entries(value).map(([jurorName, hash]) => (
                        <div key={`${key}-${jurorName}`} className="flex items-center justify-between text-xs">
                          <span className="text-muted-fg">{key} ({jurorName})</span>
                          <TxHashLink hash={hash} />
                        </div>
                      ))
                    ),
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

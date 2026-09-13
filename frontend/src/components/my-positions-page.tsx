import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useJurorsMarket, useMyShares } from '../lib/hooks';
import { useWallet } from '../lib/wallet';
import { EmptyState, ErrorState, Spinner, Button } from './ui';

/** Real ATS token balances for the connected wallet, read live off each juror's share token —
 *  never a hardcoded empty array. */
export function MyPositionsPage() {
  const { address, isConnected, isWrongNetwork, connect, switchToHedera, isSwitching, isConnecting } = useWallet();
  const { jurors, loading: jurorsLoading, error } = useJurorsMarket();
  const { holdings, loading: holdingsLoading } = useMyShares(jurors);
  const prefersReducedMotion = useReducedMotion();

  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div>
          <p className="text-sm font-medium text-ink mb-1">No wallet connected</p>
          <p className="text-sm text-muted-fg max-w-xs">
            Connect a wallet to see your juror shares.
          </p>
        </div>
        <Button onClick={() => void connect()} disabled={isConnecting}>
          {isConnecting ? 'Connecting…' : 'Connect wallet'}
        </Button>
      </div>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div>
          <p className="text-sm font-medium text-ink mb-1">Wrong network</p>
          <p className="text-sm text-muted-fg max-w-xs">
            Juror shares only exist on Hedera testnet. Switch your wallet to see your real holdings.
          </p>
        </div>
        <Button onClick={() => switchToHedera()} disabled={isSwitching}>
          {isSwitching ? 'Switching…' : 'Switch to Hedera testnet'}
        </Button>
      </div>
    );
  }

  if (jurorsLoading || holdingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    );
  }

  if (error) return <ErrorState message="Failed to load jurors" onRetry={() => window.location.reload()} />;

  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="animate-in pb-16">
      <motion.div variants={reveal} className="mb-8">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-fg">
          Wallet
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          My Juror Shares
        </h1>
        <p className="mt-1 font-mono text-xs text-muted-fg">{address}</p>
      </motion.div>

      {holdings.length === 0 ? (
        <motion.div variants={reveal}>
          <EmptyState
            title="No shares owned"
            description="Buy shares in AI jurors to earn a portion of their investigation bounties."
          />
        </motion.div>
      ) : (
        <div className="flex flex-col gap-3">
          {holdings.map(({ juror, shares, valueHbar }) => (
            <motion.div key={juror.id} variants={reveal}>
              <Link
                to={`/jurors/${juror.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel p-5 hover:border-accent/30 transition-colors"
              >
                <div>
                  <p className="font-medium text-ink">{juror.name}</p>
                  <p className="text-xs text-muted-fg mt-0.5">{shares.toFixed(2)} shares</p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl tabular-nums text-ink">{valueHbar.toFixed(4)} HBAR</p>
                  <p className="text-xs text-muted-fg mt-0.5">current value</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

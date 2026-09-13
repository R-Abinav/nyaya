import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { JurorMarket, ChainConfig } from '../types';
import { useBuyShares } from '../lib/hooks';
import { useWallet } from '../lib/wallet';
import { Button, Input } from './ui';
import { TxHashLink } from './tx-hash-link';

/**
 * Buys shares in one juror for real, on Hedera, via the connected wallet. Never routed through the
 * backend — the backend only ever provides read-only price/address data (useChainConfig/useJurorsMarket).
 * Shows the real gap between submit and confirmation, and a specific message for the compliance-block
 * revert, per the four UX requirements this was built against.
 */
export function BuySharesPanel({ juror, chainConfig }: { juror: JurorMarket; chainConfig: ChainConfig | undefined }) {
  const { isConnected, isWrongNetwork, connect, switchToHedera, isSwitching } = useWallet();
  const marketAddress = chainConfig?.contracts.JurorShareMarket ?? undefined;
  const { buy, phase, error, isComplianceBlock, hash, reset } = useBuyShares(marketAddress);
  const [amount, setAmount] = useState('1');

  const priceHbar = juror.sharePrice.priceTinybar ? Number(juror.sharePrice.priceTinybar) / 1e8 : null;
  const tradeValue = Number(amount) || 0;
  const fee = tradeValue * 0.02;
  const estimatedShares = priceHbar && juror.sharePrice.decimals !== null && tradeValue > 0
    ? (tradeValue / priceHbar).toFixed(2)
    : null;

  if (!juror.sharePrice.registered) {
    return <p className="text-sm text-muted-fg">No share token registered for this juror yet.</p>;
  }

  if (!isConnected) {
    return (
      <Button onClick={() => void connect()} className="w-full">
        Connect wallet to buy shares
      </Button>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
        <p className="text-sm font-medium text-ink">Wrong network</p>
        <p className="mt-1 text-xs text-muted-fg">Juror shares only trade on Hedera testnet. Switch your wallet's network to continue.</p>
        <Button className="mt-3 w-full" onClick={() => switchToHedera()} disabled={isSwitching}>
          {isSwitching ? 'Switching…' : 'Switch to Hedera testnet'}
        </Button>
      </div>
    );
  }

  const isBusy = phase === 'awaiting_signature' || phase === 'pending';

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={isBusy}
          aria-label="HBAR amount to spend"
        />
        <span className="flex items-center px-2 text-sm text-muted-fg">HBAR</span>
      </div>
      {estimatedShares && (
        <p className="text-xs text-muted-fg">
          ≈ {estimatedShares} shares at {priceHbar?.toFixed(4)} HBAR/share, plus {fee.toFixed(4)} HBAR fee (2%)
        </p>
      )}

      <Button
        onClick={() => void buy(juror.address, tradeValue)}
        disabled={isBusy || tradeValue <= 0}
        className="w-full"
      >
        {phase === 'awaiting_signature' ? 'Confirm in wallet…' : phase === 'pending' ? 'Confirming on-chain…' : `Buy ${juror.name.replace('The ', '')} shares`}
      </Button>

      <AnimatePresence mode="wait">
        {phase === 'pending' && hash && (
          <motion.div
            key="pending"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Waiting for confirmation — <TxHashLink hash={hash} />
          </motion.div>
        )}
        {phase === 'success' && hash && (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg border border-correct/20 bg-correct/5 px-3 py-2 text-xs text-correct"
          >
            Confirmed — <TxHashLink hash={hash} />
            <button className="ml-2 underline" onClick={reset}>Buy more</button>
          </motion.div>
        )}
        {(phase === 'error' || phase === 'reverted') && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-lg border px-3 py-2 text-xs ${isComplianceBlock ? 'border-amber-400/30 bg-amber-400/5 text-amber-300' : 'border-incorrect/20 bg-incorrect/5 text-incorrect'}`}
          >
            {isComplianceBlock && <p className="mb-1 font-medium">Compliance control triggered</p>}
            {error}
            <button className="ml-2 underline" onClick={reset}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

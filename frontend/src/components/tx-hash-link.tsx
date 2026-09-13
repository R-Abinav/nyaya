/** A real transaction hash, linked to HashScan (Hedera's real testnet explorer) — every tx hash shown
 *  anywhere in this app should go through this, so a judge can verify it independently, not just trust it. */
export function TxHashLink({ hash, network = 'testnet' }: { hash: string; network?: 'testnet' | 'mainnet' }) {
  return (
    <a
      href={`https://hashscan.io/${network}/transaction/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-accent hover:underline transition-colors"
      title={hash}
    >
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </a>
  );
}

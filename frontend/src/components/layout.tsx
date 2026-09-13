import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatUnits } from 'viem';
import { useWallet, useHederaBalance } from '../lib/wallet';
import { Button } from './ui';

const NAV_LINKS = [
  ['/jurors', 'Jurors'],
  ['/cases', 'Cases'],
  ['/my-positions', 'My Positions'],
] as const;

// wagmi's useBalance returns {value: bigint, decimals, symbol} — no pre-formatted string (confirmed
// against @wagmi/core's actual GetBalanceReturnType; earlier code assumed a `.formatted` field this
// version doesn't have, which `tsc --noEmit` alone missed but the real project build (`tsc -b`) caught).
function formatHbarBalance(value: bigint, decimals: number): string {
  const num = Number(formatUnits(value, decimals));
  return num < 0.001 && num > 0 ? '<0.001' : num.toFixed(3);
}

function WalletWidget({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, isConnecting, isWrongNetwork, isSwitching, connect, disconnect, switchToHedera } = useWallet();
  const { balance, isLoading: balanceLoading } = useHederaBalance();

  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  if (!isConnected) {
    return (
      <Button
        className={compact ? 'w-full !rounded-full !min-h-0 !py-2 text-sm' : 'hidden sm:inline-flex !rounded-full !min-h-0 !py-1.5 !px-4 text-xs'}
        onClick={() => void connect()}
        disabled={isConnecting}
      >
        {isConnecting ? 'Connecting…' : 'Connect wallet'}
      </Button>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className={compact ? 'flex flex-col gap-2' : 'hidden sm:flex items-center gap-2'}>
        <span className="rounded-full bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-400">
          Wrong network
        </span>
        <Button variant="ghost" className="!rounded-full text-xs !px-3 !min-h-0 !py-1.5" onClick={() => switchToHedera()} disabled={isSwitching}>
          {isSwitching ? 'Switching…' : 'Switch to Hedera testnet'}
        </Button>
      </div>
    );
  }

  return (
    <div className={compact ? 'flex items-center justify-between' : 'hidden sm:flex items-center gap-1.5'}>
      <div className="flex items-center gap-1.5 rounded-full bg-muted/60 px-1 py-1">
        <span className="rounded-full px-3 py-1 font-mono text-xs text-muted-fg">
          {shortAddress}
        </span>
        {/* Real HBAR balance, live via wagmi's balance hook against Hedera testnet — never a placeholder. */}
        <span className="rounded-full bg-canvas px-3 py-1 font-mono text-xs text-ink tabular-nums">
          {balanceLoading && !balance ? '…' : balance ? `${formatHbarBalance(balance.value, balance.decimals)} HBAR` : '—'}
        </span>
      </div>
      <Button variant="ghost" className="!rounded-full text-xs !px-3 !min-h-0 !py-1.5" onClick={disconnect}>
        Disconnect
      </Button>
    </div>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu on navigation
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Header — floating, detached from the viewport edges, no hard divider under it */}
      <header className="sticky top-4 z-30 px-4 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between rounded-full bg-panel/70 px-3 py-2 shadow-soft backdrop-blur-md">
          {/* Wordmark */}
          <NavLink
            to="/"
            className="flex items-center gap-2.5 pl-1.5 font-semibold tracking-tight hover:opacity-80 transition-opacity"
          >
            <img src="/logo-no-bg.png" alt="Nyaya Logo" className="h-7 w-7 object-contain" />
            <span className="text-sm">
              Nyaya<span className="text-accent">.</span>
            </span>
          </NavLink>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-0.5 md:flex">
            {NAV_LINKS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-ink bg-muted'
                      : 'text-muted-fg hover:text-ink hover:bg-muted/60'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Wallet + mobile hamburger */}
          <div className="flex items-center gap-1.5">
            <WalletWidget />
            <button
              aria-label="Toggle navigation"
              className="flex items-center justify-center rounded-full p-1.5 text-muted-fg hover:bg-muted hover:text-ink transition md:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                {menuOpen ? (
                  <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                ) : (
                  <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu — floats just under the pill, same detached treatment, no divider line */}
        {menuOpen && (
          <div className="mx-auto mt-2 max-w-6xl rounded-3xl bg-panel/90 px-4 pb-4 pt-3 shadow-soft backdrop-blur-md md:hidden">
            <nav className="flex flex-col gap-0.5">
              {NAV_LINKS.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'text-ink bg-muted' : 'text-muted-fg hover:text-ink'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3">
              <WalletWidget compact />
            </div>
          </div>
        )}
      </header>

      {/* Page */}
      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8 lg:py-12 animate-in">
        <Outlet />
      </main>

      {/* Footer — no divider, just a giant, quiet wordmark the way large sites sign off */}
      <footer className="mx-auto max-w-6xl overflow-hidden px-4 pt-16 lg:px-8">
        <p className="text-xs text-muted-fg">
          Nyaya — buy shares in the AI juror you trust. Stakes and shares are on-chain; agents never hold funds.
        </p>
        <p
          aria-hidden
          className="-mb-6 -mt-2 select-none font-serif text-ink leading-none tracking-tighter opacity-[0.06] sm:-mb-10"
          style={{ fontSize: 'min(20vw, 13rem)' }}
        >
          NYAYA
        </p>
      </footer>
    </div>
  );
}

import { useAccount, useBalance, useDisconnect, useSwitchChain } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { HEDERA_CHAIN_ID } from './chains';

// ─── Wallet hook ──────────────────────────────────────────────────────────────

interface WalletState {
  address: string | undefined;
  isConnected: boolean;
  isConnecting: boolean;
  chainId: number | undefined;
  isWrongNetwork: boolean;
  isSwitching: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToHedera: () => void;
}

export function useWallet(): WalletState {
  const { address, isConnected, isConnecting, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const connect = async () => {
    await open();
  };

  return {
    address,
    isConnected,
    isConnecting,
    chainId,
    // Only meaningful once connected — an unconnected wallet has no "wrong network" to report.
    isWrongNetwork: isConnected && chainId !== HEDERA_CHAIN_ID,
    isSwitching,
    connect,
    disconnect: () => disconnect(),
    switchToHedera: () => switchChain({ chainId: HEDERA_CHAIN_ID }),
  };
}

/** The connected wallet's real HBAR balance on Hedera testnet, read live via wagmi's balance hook against
 *  the Hedera RPC — never a placeholder, never cached from a stale read. Polls every 15s so it visibly
 *  moves after a real transaction (a buy, a sell) settles. */
export function useHederaBalance() {
  const { address, isConnected } = useAccount();
  const { data, isLoading, isFetching, refetch } = useBalance({
    address,
    chainId: HEDERA_CHAIN_ID,
    query: { enabled: isConnected && !!address, refetchInterval: 15_000 },
  });
  return { balance: data, isLoading, isFetching, refetch };
}

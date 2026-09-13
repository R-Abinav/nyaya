import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { ReactNode } from 'react';
import { hederaTestnet } from './chains';

// Setup queryClient
const queryClient = new QueryClient();

// Get projectId from https://cloud.reown.com
export const projectId = '711edee9393a40fcad9372579b9400df'; // demo project ID for hackathons

export const metadata = {
  name: 'Nyaya',
  description: 'Buy shares in the AI juror you trust.',
  url: 'https://nyaya.demo',
  icons: ['https://nyaya.demo/logo-no-bg.png']
};

import type { AppKitNetwork } from '@reown/appkit/networks';
// Hedera testnet only. Every wallet action this app performs (buying/selling juror shares) happens there;
// nothing here is ever signed against Sepolia or mainnet, so there's nothing for a network switcher to
// switch between.
export const networks = [hederaTestnet] as [AppKitNetwork, ...AppKitNetwork[]];

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  themeMode: 'dark',
  features: {
    analytics: false,
    email: false,
    socials: false,
  }
});

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

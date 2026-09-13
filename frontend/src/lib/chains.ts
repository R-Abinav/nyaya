import { defineChain } from 'viem';

// Hedera testnet — the only chain any wallet action in this app ever needs. JurorShareMarket,
// JurorTreasury and NyayaResolver all live here (see docs/ARCHITECTURE.md's "Which chain holds what").
// Sepolia (ENS identity) is read-only and served by the backend, never by the connected wallet, so it is
// deliberately not configured here at all — one correct network, no switcher to half-build.
//
// nativeCurrency.decimals is 18, matching what Hashio's JSON-RPC relay actually reports over eth_getBalance
// (HBAR is 8-decimal on Hedera's own ledger, but the EVM-facing relay presents 18-decimal weibars to every
// client — the same convention this whole project's contracts.md documents for msg.value/balances).
export const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
  blockExplorers: { default: { name: 'HashScan', url: 'https://hashscan.io/testnet' } },
  testnet: true,
});

export const HEDERA_CHAIN_ID = 296;

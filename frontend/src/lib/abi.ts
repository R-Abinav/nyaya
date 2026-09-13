// Minimal ABI fragments for the frontend's own wallet-signed calls, matching
// packages/contracts/src/shares/JurorShareMarket.sol and IAtsToken.sol exactly (read in full before writing
// this — never a guess). Every dApp frontend needs a literal ABI to encode a call; this is that, not mock
// data. Buy/sell are the only writes this app performs; priceOf/shareToken/decimals/totalSupply are the
// only reads it needs beyond what the backend already provides.
export const JUROR_SHARE_MARKET_ABI = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [
      { name: 'juror', type: 'address' },
      { name: 'tradeValue', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'juror', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: 'proceeds', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'priceOf',
    stateMutability: 'view',
    inputs: [{ name: 'juror', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'shareToken',
    stateMutability: 'view',
    inputs: [{ name: 'juror', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'NothingToTrade', inputs: [] },
  { type: 'error', name: 'WrongPayment', inputs: [{ name: 'expected', type: 'uint256' }, { name: 'sent', type: 'uint256' }] },
  { type: 'error', name: 'InsufficientReserve', inputs: [{ name: 'reserve', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
] as const;

export const ATS_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  // The compliance-block revert a juror's own key or hot wallet gets for attempting to buy its own
  // shares — ATS's control list rejecting the mint inside JurorShareMarket.buy(). This is core, demoable
  // product behavior (see .claude/rules/contracts.md's share rules), not an edge case to hide.
  { type: 'error', name: 'AccountIsBlocked', inputs: [{ name: 'account', type: 'address' }] },
] as const;

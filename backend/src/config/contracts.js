const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const env = require('./env');

/**
 * Real on-chain access: contract addresses read from packages/contracts/deployments/hedera.json at
 * runtime, ABIs read from packages/contracts/out/ (the real compiled artifacts), never hardcoded and
 * never hand-written fragments. This file is rewritten by every real deploy, so re-reading it on every
 * call (rather than caching at module load) means a redeploy is picked up without restarting the backend.
 */
const CONTRACTS_ROOT = path.resolve(__dirname, '../../../packages/contracts');
const DEPLOYMENTS_FILE = path.join(CONTRACTS_ROOT, 'deployments/hedera.json');

function readDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    throw new Error(`No ${DEPLOYMENTS_FILE}. The contracts package must be deployed to Hedera first.`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'));
}

function requireContractAddress(name) {
  const deployments = readDeployments();
  const address = deployments.contracts && deployments.contracts[name];
  if (!address) throw new Error(`${name} is missing from ${DEPLOYMENTS_FILE}.`);
  return address;
}

function readAbi(contractName) {
  const artifactPath = path.join(CONTRACTS_ROOT, 'out', `${contractName}.sol`, `${contractName}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`No compiled artifact at ${artifactPath}. Run "forge build" in packages/contracts first.`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
}

/** Fails offline, by function name, before any call is sent — same discipline the contracts package's own
 *  scripts use, so a missing function surfaces immediately rather than as "x is not a function" mid-run. */
function assertFunctionsExist(abi, names, label) {
  const present = new Set(abi.filter(entry => entry.type === 'function').map(entry => entry.name));
  const missing = names.filter(name => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`${label} ABI is missing: ${missing.join(', ')}. Re-check packages/contracts/out/ is up to date.`);
  }
}

let cachedProvider;
function getProvider() {
  // batchMaxCount: 1 disables ethers' default JSON-RPC batching. Hashio (Hedera's testnet relay) rejects
  // eth_getLogs specifically when it arrives inside a batch ("Method eth_getLogs is not permitted as part
  // of batch requests") — hit for real by getCaseType()'s queryFilter call below. Batching buys nothing
  // for this codebase's call patterns, so disable it globally rather than special-casing one method.
  if (!cachedProvider) cachedProvider = new ethers.JsonRpcProvider(env.HEDERA_RPC_URL, undefined, { batchMaxCount: 1 });
  return cachedProvider;
}

/** A juror's own signing key, from `juror.privateKeyEnv` — never hardcoded, read from backend/.env. */
function getJurorSigner(juror) {
  const privateKey = env[juror.privateKeyEnv];
  if (!privateKey) throw new Error(`${juror.privateKeyEnv} is not set in backend/.env.`);
  const wallet = new ethers.Wallet(privateKey, getProvider());
  if (wallet.address.toLowerCase() !== juror.address.toLowerCase()) {
    throw new Error(
      `${juror.privateKeyEnv} derives ${wallet.address}, but ${juror.id}'s configured address is ${juror.address}. Wrong key.`,
    );
  }
  return wallet;
}

/** A read-only NyayaResolver instance, address read fresh from deployments/hedera.json every call. */
function getResolverContract() {
  const address = requireContractAddress('NyayaResolver');
  const abi = readAbi('NyayaResolver');
  return new ethers.Contract(address, abi, getProvider());
}

/** A read-only JurorTreasury instance, same freshness guarantee. */
function getTreasuryContract() {
  const address = requireContractAddress('JurorTreasury');
  const abi = readAbi('JurorTreasury');
  return new ethers.Contract(address, abi, getProvider());
}

// A case's caseType is event-only: NyayaResolver.sol's Case struct never stores it (confirmed by reading
// the struct directly), it's only emitted once in CaseOpened. So reading it back means querying that
// event, not calling a getter. Bounded to a lookback window well under Hashio's ~7-day eth_getLogs range
// limit (packages/contracts/.claude/rules/contracts.md) — every case this project opens is short-lived,
// so a case older than this window is not one any caller should still be asking about.
const CASE_TYPE_LOOKBACK_BLOCKS = 200_000;

/** The real caseType a case was opened with, read from its CaseOpened event — never left to a default. */
async function getCaseType(caseId) {
  const resolver = getResolverContract();
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - CASE_TYPE_LOOKBACK_BLOCKS);
  const logs = await resolver.queryFilter(resolver.filters.CaseOpened(caseId), fromBlock, latestBlock);
  if (logs.length === 0) {
    throw new Error(
      `No CaseOpened event found for case ${caseId} in the last ${CASE_TYPE_LOOKBACK_BLOCKS} blocks on ` +
      `NyayaResolver at ${resolver.target}. This endpoint requires a real, already-opened case id — open one ` +
      `with "npm run resolver:open-case" in packages/contracts first.`,
    );
  }
  return logs[0].args.caseType;
}

/** A NyayaResolver instance connected to `signer`, for sending real transactions (commit, reveal,
 *  withdrawForEvidence). */
function getResolverAsSigner(signer) {
  const address = requireContractAddress('NyayaResolver');
  const abi = readAbi('NyayaResolver');
  return new ethers.Contract(address, abi, signer.connect(getProvider()));
}

/** A read-only JurorShareMarket instance, same freshness guarantee as the other getters. */
function getShareMarketContract() {
  const address = requireContractAddress('JurorShareMarket');
  const abi = readAbi('JurorShareMarket');
  return new ethers.Contract(address, abi, getProvider());
}

/** A read-only ATS share-token instance. IAtsToken.sol has a real compiled artifact (it's a Solidity
 *  interface in this same package), so this is the real ABI, never a hand-written fragment. */
function getAtsTokenContract(tokenAddress) {
  const abi = readAbi('IAtsToken');
  return new ethers.Contract(tokenAddress, abi, getProvider());
}

// Same bound and rationale as getCaseType's CASE_TYPE_LOOKBACK_BLOCKS: comfortably under Hashio's ~7-day
// eth_getLogs range limit, generous for this project's whole real testnet history so far.
const SETTLEMENT_LOOKBACK_BLOCKS = 200_000;

/**
 * Real settlement history + cumulative return-on-capital for one juror, read live off the Hedera
 * resolver. This is the exact read shape packages/contracts/script/ens/jurorStats.ts uses to populate
 * ENS text records — ported here, not reimplemented, so the ENS-writing path and this backend endpoint
 * never compute two different numbers for the same juror from two different pieces of code.
 */
async function getJurorOnChainStats(jurorAddress) {
  const resolver = getResolverContract();
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - SETTLEMENT_LOOKBACK_BLOCKS);
  const logs = await resolver.queryFilter(resolver.filters.JurorSettled(null, jurorAddress), fromBlock, latestBlock);
  const caseIds = logs.map(log => log.args.caseId);
  const cumulativeReturnBps = await resolver.returnBps(jurorAddress);
  return {
    casesJudged: caseIds.length,
    lastCaseId: caseIds.length > 0 ? caseIds.reduce((a, b) => (b > a ? b : a)) : null,
    cumulativeReturnBps,
  };
}

/**
 * Real return-on-capital checkpoints over time for one juror, one point per real settled case. Each
 * point's returnBps is read from the resolver's own historical state at that settlement's exact block
 * (confirmed Hashio supports historical `blockTag` reads) — not reconstructed from event math and not
 * dependent on which cases happened to be manually relayed to the Sepolia anchor (only some have been).
 * Returns [] for a juror with no settled cases yet — a real, valid state, not an error.
 */
async function getJurorReturnHistory(jurorAddress) {
  const resolver = getResolverContract();
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - SETTLEMENT_LOOKBACK_BLOCKS);
  const logs = await resolver.queryFilter(resolver.filters.JurorSettled(null, jurorAddress), fromBlock, latestBlock);
  const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber);
  const points = [];
  for (const log of sorted) {
    const block = await provider.getBlock(log.blockNumber);
    const returnBpsAtBlock = await resolver.returnBps(jurorAddress, { blockTag: log.blockNumber });
    points.push({
      caseId: log.args.caseId.toString(),
      blockNumber: log.blockNumber,
      timestamp: block.timestamp,
      result: Number(log.args.result),
      stake: log.args.stake.toString(),
      x402Spend: log.args.x402Spend.toString(),
      reward: log.args.reward.toString(),
      net: log.args.net.toString(),
      returnBps: returnBpsAtBlock.toString(),
    });
  }
  return points;
}

/**
 * Real share price/supply for one juror, read live off JurorShareMarket + the ATS token. There is one
 * price (`priceOf`), never a separate buy/sell price — the contract has no bid/ask spread, only a 2% fee
 * applied on top of trades. Returns `registered: false` (no price/supply) if this juror has no share
 * token registered yet, rather than throwing or fabricating a price for a token that doesn't exist.
 */
async function getJurorShareInfo(jurorAddress) {
  const market = getShareMarketContract();
  const tokenAddress = await market.shareToken(jurorAddress);
  if (!tokenAddress || tokenAddress === ethers.ZeroAddress) {
    return { registered: false, tokenAddress: null, priceTinybar: null, decimals: null, totalSupply: null };
  }
  const token = getAtsTokenContract(tokenAddress);
  const [priceTinybar, decimals, totalSupply] = await Promise.all([
    market.priceOf(jurorAddress),
    token.decimals(),
    token.totalSupply(),
  ]);
  return {
    registered: true,
    tokenAddress,
    priceTinybar: priceTinybar.toString(),
    decimals: Number(decimals),
    totalSupply: totalSupply.toString(),
  };
}

module.exports = {
  CONTRACTS_ROOT,
  DEPLOYMENTS_FILE,
  readDeployments,
  requireContractAddress,
  readAbi,
  assertFunctionsExist,
  getProvider,
  getResolverContract,
  getTreasuryContract,
  getResolverAsSigner,
  getJurorSigner,
  getCaseType,
  getShareMarketContract,
  getAtsTokenContract,
  getJurorOnChainStats,
  getJurorReturnHistory,
  getJurorShareInfo,
};

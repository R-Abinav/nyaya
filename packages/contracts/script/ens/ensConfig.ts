/**
 * Shared config for the Sepolia ENSv2 sequence (step 10) — the one-time registration of nyaya.eth itself.
 *
 * SUPERSEDED for anything past that one-time registration: step 12's `script/DeploySepolia.s.sol` is the
 * only place a subregistry/resolver redeploy (and the subname re-registration and EAC re-grants that go
 * with it) happens now, in one forge-script broadcast. Scripts 2-7 here (deploySubregistry, deployResolver,
 * wireNyaya, createJurorSubnames, configureEac, proveEac) describe the ORIGINAL path and their evidence in
 * docs/TESTNET-EVIDENCE.md stands as history, but re-running them against a post-step-12 deployment would
 * try to re-register nyaya.eth (already registered, will revert) and write a stale nested shape this file
 * no longer matches — `deployments/sepolia.json` is now the flatter shape DeploySepolia.s.sol writes.
 * Script 1 (registerNyaya) never needs to run again at all: nyaya.eth is a name, not a redeployable
 * contract, and step 12 explicitly reuses it rather than re-registering it.
 *
 * Every address below was verified two ways before use, not taken on trust:
 *   1. Matched byte-for-byte against contracts/deployments/sepolia/<Name>.json in
 *      github.com/ensdomains/contracts-v2 at the pinned commit
 *      97a57293f3b4279d94b571e678edb53ce62638f4 (the same commit ETHRegistrar.sol,
 *      UserRegistry.sol, and PermissionedResolver.sol were read from).
 *   2. Confirmed to have code on Sepolia via `cast code` before this script existed.
 *
 * ABIs in ./abi/*.json are the literal compiled `abi` field from those same deployment JSON
 * files, not hand-transcribed fragments: there is no published npm package for contracts-v2
 * (unlike @ensdomains/verifiable-factory, which does exist and whose ABI is used the same way).
 */
import { Contract, Interface, JsonRpcProvider, Wallet, type TransactionReceipt } from "ethers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_ROOT = resolve(HERE, "../..");
const DEPLOYMENTS_FILE = resolve(CONTRACTS_ROOT, "deployments/sepolia.json");

/** Verified defaults, same pattern as ATS_FACTORY_ID/ATS_RESOLVER_ID: an optional env override,
 *  nothing required in .env. */
function envOrDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const ENS_ADDRESSES = {
  VerifiableFactory: envOrDefault("ENS_VERIFIABLE_FACTORY", "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef"),
  ETHRegistrar: envOrDefault("ENS_ETH_REGISTRAR", "0xa88553f454b77203b0d036a05c894d555eaaa2cc"),
  ETHRegistry: envOrDefault("ENS_ETH_REGISTRY", "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2"),
  RootRegistry: envOrDefault("ENS_ROOT_REGISTRY", "0x8115186e8f2e0b0281e86ab91f0f48ba90364354"),
  UserRegistryImpl: envOrDefault("ENS_USER_REGISTRY_IMPL", "0x624a25d67b59d587752ebec8dded8827dae52050"),
  PermissionedResolverImpl: envOrDefault("ENS_PERMISSIONED_RESOLVER_IMPL", "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e"),
  UniversalResolverV2: envOrDefault("ENS_UNIVERSAL_RESOLVER_V2", "0x4a1817d13e9cf196f471725176355c1234b63c70"),
  StandardRentPriceOracle: envOrDefault("ENS_RENT_PRICE_ORACLE", "0x8914b66260eb8c4fff795650c3ae8cd335958987"),
  // Free-mint ERC20 the rent oracle accepts on Sepolia, at the same pinned commit. Not "verified ENSv2
  // protocol addresses" in the same sense as the eight above, but confirmed the same two ways.
  MockUSDC: envOrDefault("ENS_MOCK_USDC", "0x768f42455a2d082e23ceef7d51e5787c82d67a39"),
  MockDAI: envOrDefault("ENS_MOCK_DAI", "0x5472c5725a00b7ba11f0794a79d08ade6f4683bd"),
} as const;

export const NYAYA_LABEL = "nyaya";
export const NYAYA_NAME = "nyaya.eth";
export const JUROR_LABELS = ["juror-a", "juror-b", "juror-c"] as const;

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run: set -a; source .env; set +a`);
  return value;
}

export function connect() {
  const provider = new JsonRpcProvider(env("SEPOLIA_RPC_URL"));
  const operator = new Wallet(env("OPERATOR_PRIVATE_KEY"), provider);
  return { provider, operator };
}

export function abi(name: keyof typeof ENS_ADDRESSES | "MockUSDC" | "MockDAI"): unknown[] {
  const path = resolve(HERE, `abi/${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Same discipline as atsConfig.ts's assertFunctionsExist: fail offline, by name, before spending gas. */
export function assertFunctionsExist(contractAbi: unknown[], names: string[], label: string): void {
  const present = new Set(
    (contractAbi as Array<{ type: string; name?: string }>)
      .filter((e) => e.type === "function")
      .map((e) => e.name),
  );
  const missing = names.filter((n) => !present.has(n));
  if (missing.length > 0) {
    throw new Error(`${label} ABI is missing: ${missing.join(", ")}. Re-check the ABI source before running.`);
  }
}

type Deployments = {
  network: "sepolia";
  ens?: {
    nyayaTokenId?: string;
    nyayaExpiry?: string;
    /** The random secret used in the commitment, not the commitment hash itself (that's re-derived from
     *  it deterministically via makeCommitment()). */
    secret?: string;
    commitTx?: string;
    registerTx?: string;
    subregistry?: string;
    subregistryDeployTx?: string;
    resolver?: string;
    resolverDeployTx?: string;
    wireSubregistryTx?: string;
    wireResolverTx?: string;
    /** Every field but the map key is optional because writeDeployments() patches are applied one field
     *  (or a few) at a time as each script step completes, merged two levels deep (see writeDeployments). */
    jurors?: Record<
      string,
      {
        address?: string;
        tokenId?: string;
        registerTx?: string;
        profileGrantTx?: string;
        strategyGrantTx?: string;
      }
    >;
  };
  contracts?: Record<string, string>;
  // The flatter shape DeploySepolia.s.sol (step 12) actually writes on a real broadcast: nyaya.eth's own
  // tokenId/expiry (unchanged by that script, carried forward) and each juror's address, top-level rather
  // than nested under `ens`. The scripts 1-7 above (the original one-time nyaya.eth registration) never
  // write or read these; anything written after step 12 reads these instead of the nested `ens` shape.
  nyayaTokenId?: string;
  nyayaExpiry?: number;
  jurorA?: string;
  jurorB?: string;
  jurorC?: string;
};

export function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_FILE)) return { network: "sepolia" };
  return JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8")) as Deployments;
}

export function writeDeployments(patch: Partial<Deployments>): Deployments {
  const current = readDeployments();
  const currentJurors = current.ens?.jurors ?? {};
  const patchJurors = patch.ens?.jurors ?? {};
  // Merge two levels deep for `jurors`: a patch touching one field of one juror (e.g. just `tokenId`)
  // must not clobber that same juror's other already-recorded fields (e.g. `address`).
  const mergedJurors = { ...currentJurors };
  for (const [label, fields] of Object.entries(patchJurors)) {
    mergedJurors[label] = { ...currentJurors[label], ...fields };
  }
  const next: Deployments = {
    ...current,
    ...patch,
    ens: { ...current.ens, ...patch.ens, jurors: mergedJurors },
  };
  writeFileSync(DEPLOYMENTS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function send(
  provider: JsonRpcProvider,
  signer: Wallet,
  label: string,
  tx: { to?: string; data?: string; value?: bigint },
  gasLimit: bigint,
): Promise<TransactionReceipt> {
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
  const value = tx.value ?? 0n;
  const balance = await provider.getBalance(signer.address);
  const reserved = gasLimit * maxFeePerGas + value;
  if (balance < reserved) {
    throw new Error(
      `${label}: ${signer.address} holds ${balance} wei, needs ${reserved} wei (gasLimit ${gasLimit} x maxFeePerGas ${maxFeePerGas} + value ${value})`,
    );
  }
  const signed = await signer.signTransaction({
    ...tx,
    value,
    gasLimit,
    nonce: await provider.getTransactionCount(signer.address),
    chainId: (await provider.getNetwork()).chainId,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const sent = await provider.broadcastTransaction(signed);
  const receipt = await provider.waitForTransaction(sent.hash);
  if (!receipt || receipt.status !== 1) {
    // A receipt with status 0 carries no revert reason itself. Replay the exact call at the same block so
    // the thrown error carries real revert data, not just a hash — otherwise every caller's `revertName`
    // sees a plain Error with nothing to decode and wrongly reports "no data" for what may be a perfectly
    // specific on-chain error.
    const revertData = await replayForRevertData(provider, signer.address, tx, receipt?.blockNumber);
    const error = new Error(`${label} failed: ${sent.hash}${revertData ? ` (revert data ${revertData})` : ""}`) as Error & {
      data?: string;
    };
    error.data = revertData;
    throw error;
  }
  console.log(`  ${label}: ok  ${sent.hash}`);
  return receipt;
}

/** Replays a transaction as `eth_call` at the block it actually landed in, purely to recover revert data a
 *  receipt doesn't carry. Standard on an ordinary Ethereum JSON-RPC endpoint; Hedera's Hashio needed the
 *  mirror node instead because it doesn't support this reliably. */
async function replayForRevertData(
  provider: JsonRpcProvider,
  from: string,
  tx: { to?: string; data?: string; value?: bigint },
  blockNumber?: number,
): Promise<string | undefined> {
  try {
    await provider.call({ ...tx, from, blockTag: blockNumber });
    return undefined; // replay didn't revert; unusual, but leave it to the caller to report as such
  } catch (error) {
    const e = error as { data?: unknown; info?: { error?: { data?: unknown } } };
    const data = [e?.data, e?.info?.error?.data].find((d) => typeof d === "string" && d.startsWith("0x")) as
      | string
      | undefined;
    return data;
  }
}

/** Like `send`, but for a call expected to revert on-chain: returns the receipt (status 0 included)
 *  instead of throwing, so the caller gets a real transaction hash to record as evidence of the rejection,
 *  not just a local simulation result. */
export async function sendAllowingRevert(
  provider: JsonRpcProvider,
  signer: Wallet,
  label: string,
  tx: { to?: string; data?: string; value?: bigint },
  gasLimit: bigint,
): Promise<TransactionReceipt> {
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
  const value = tx.value ?? 0n;
  const signed = await signer.signTransaction({
    ...tx,
    value,
    gasLimit,
    nonce: await provider.getTransactionCount(signer.address),
    chainId: (await provider.getNetwork()).chainId,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const sent = await provider.broadcastTransaction(signed);
  const receipt = await provider.waitForTransaction(sent.hash);
  if (!receipt) throw new Error(`${label}: no receipt for ${sent.hash}`);
  console.log(`  ${label}: status ${receipt.status}  ${sent.hash}`);
  return receipt;
}

/** Decodes a revert so scripts can assert on the specific error, matching the ATS scripts' pattern. */
export function revertName(error: unknown, iface: Interface): string {
  const e = error as { data?: unknown; info?: { error?: { data?: unknown } }; shortMessage?: string };
  const data = [e?.data, e?.info?.error?.data].find((d) => typeof d === "string" && d.startsWith("0x")) as
    | string
    | undefined;
  if (!data || data === "0x") return e?.shortMessage ?? "reverted with no data";
  const parsed = iface.parseError(data);
  return parsed ? parsed.name : `unknown selector ${data.slice(0, 10)}`;
}

export function findLog<T extends { name: string; args: Record<string, unknown> }>(
  receipt: TransactionReceipt,
  iface: Interface,
  contractAddress: string,
  eventName: string,
): T {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) return parsed as unknown as T;
    } catch {
      // not this contract's event
    }
  }
  throw new Error(`${eventName} not found in receipt ${receipt.hash} logs from ${contractAddress}`);
}

export function contract(address: string, contractAbi: unknown[], runner: JsonRpcProvider | Wallet): Contract {
  return new Contract(address, contractAbi as never, runner);
}

/**
 * Shared config for the step-11 anchor relay scripts. Hedera is read from only (a settlement already
 * happened there; nothing is written back — this is a mirror, never a bridge). Sepolia is where the
 * anchor lives and the only chain these scripts sign a transaction on.
 */
import { Contract, Interface, JsonRpcProvider, Wallet, type TransactionReceipt } from "ethers";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_ROOT = resolve(HERE, "../..");

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run: set -a; source .env; set +a`);
  return value;
}

export function hederaProvider(): JsonRpcProvider {
  // batchMaxCount: 1 disables ethers' default JSON-RPC batching. Hashio rejects eth_getLogs specifically
  // when it arrives inside a batch ("Method eth_getLogs is not permitted as part of batch requests") — the
  // same real bug already hit and fixed in backend/src/config/contracts.js's getCaseType, now needed here
  // too for jurorStats.ts's queryFilter(JurorSettled) call.
  return new JsonRpcProvider(env("HEDERA_RPC_URL"), undefined, { batchMaxCount: 1 });
}

export function sepoliaSigner(): { provider: JsonRpcProvider; operator: Wallet } {
  const provider = new JsonRpcProvider(env("SEPOLIA_RPC_URL"));
  const operator = new Wallet(env("OPERATOR_PRIVATE_KEY"), provider);
  return { provider, operator };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function hederaDeployments(): { contracts: Record<string, string>; distributors: Record<string, string> } {
  const d = readJson(resolve(CONTRACTS_ROOT, "deployments/hedera.json"));
  return {
    contracts: (d.contracts as Record<string, string>) ?? {},
    distributors: (d.distributors as Record<string, string>) ?? {},
  };
}

export function sepoliaAnchorAddress(): string {
  const d = readJson(resolve(CONTRACTS_ROOT, "deployments/sepolia.json"));
  const address = (d.contracts as Record<string, string> | undefined)?.NyayaAnchor;
  if (!address) throw new Error("No NyayaAnchor address in deployments/sepolia.json. Deploy it first.");
  return address;
}

export function artifactAbi(name: string): unknown[] {
  const candidates = [
    resolve(CONTRACTS_ROOT, `out/${name}.sol/${name}.json`),
    resolve(CONTRACTS_ROOT, `out/${name}.sol/${name}.json`.replace(".t.sol", ".sol")),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return (readJson(path).abi as unknown[]) ?? [];
  }
  throw new Error(`No compiled artifact for ${name}. Run forge build first.`);
}

export function assertFunctionsExist(abi: unknown[], names: string[], label: string): void {
  const present = new Set(
    (abi as Array<{ type: string; name?: string }>).filter((e) => e.type === "function").map((e) => e.name),
  );
  const missing = names.filter((n) => !present.has(n));
  if (missing.length > 0) {
    throw new Error(`${label} ABI is missing: ${missing.join(", ")}. Re-check the ABI source before running.`);
  }
}

export function contract(address: string, abi: unknown[], runner: JsonRpcProvider | Wallet): Contract {
  return new Contract(address, abi as never, runner);
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
    throw new Error(`${label}: ${signer.address} holds ${balance} wei, needs ${reserved} wei`);
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
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed: ${sent.hash}`);
  console.log(`  ${label}: ok  ${sent.hash}`);
  return receipt;
}

/** Decodes a specific log out of an already-fetched Hedera transaction receipt, by event name. Reading
 *  from the receipt of a known transaction hash sidesteps Hashio's 7-day limit on ranged `eth_getLogs`
 *  queries, which a query across this project's whole testnet history would exceed. */
export function decodeLog<T extends { name: string; args: Record<string, unknown> }>(
  receipt: TransactionReceipt,
  iface: Interface,
  eventName: string,
): T {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) return parsed as unknown as T;
    } catch {
      // not decodable with this interface; try the next log
    }
  }
  throw new Error(`${eventName} not found in Hedera tx ${receipt.hash}`);
}

/** Decodes every log of a given event name out of a receipt, for events that can appear more than once
 *  (a dividend can have several claims). */
export function decodeLogs<T extends { name: string; args: Record<string, unknown> }>(
  receipt: TransactionReceipt,
  iface: Interface,
  eventName: string,
): T[] {
  const out: T[] = [];
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) out.push(parsed as unknown as T);
    } catch {
      // not decodable with this interface; try the next log
    }
  }
  return out;
}

/**
 * Shared setup for the ATS scripts.
 *
 * These talk to ATS's contracts directly with ethers rather than through @hashgraph/asset-tokenization-sdk.
 * The SDK has no headless signer: SupportedWallets is METAMASK, HWALLETCONNECT, DFNS, FIREBLOCKS and AWSKMS
 * only, and Network.connect expects a browser wallet, so a Node script holding a private key cannot drive it.
 * Hedera's track text allows "SDK, contracts, web app, or a combination", and ATS's compliance registry, roles
 * and dividend snapshots do the same real work whichever entry point calls them.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, Contract, formatUnits, type ContractRunner } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_ROOT = resolve(here, "../..");
export const DEPLOYMENTS_FILE = resolve(CONTRACTS_ROOT, "deployments/hedera.json");

/** ATS testnet deployment, from apps/ats/web/.env.example on the ATS repo's main branch. */
const DEFAULT_ATS_FACTORY_ID = "0.0.9213391";
const DEFAULT_ATS_RESOLVER_ID = "0.0.9212226";
/**
 * REACT_APP_EQUITY_CONFIG_ID from the same file. The web app leaves the version blank and the SDK resolves it;
 * calling the contracts directly means resolving it ourselves. Version 0 does not exist — on testnet the equity
 * configuration's latest version is 1 — and passing it makes the resolver lookup revert with no data.
 */
export const EQUITY_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";

const RESOLVER_ABI = [
  "function getLatestVersionByConfiguration(bytes32 configurationId) view returns (uint256)",
  "function getConfigurationsLength() view returns (uint256)",
];

/** Ask the resolver which version to use, the way the SDK does, unless ATS_EQUITY_CONFIG_VERSION overrides it. */
export async function resolveEquityConfigVersion(provider: JsonRpcProvider, resolverAddress: string): Promise<bigint> {
  if (process.env.ATS_EQUITY_CONFIG_VERSION) return BigInt(process.env.ATS_EQUITY_CONFIG_VERSION);
  const resolver = new Contract(resolverAddress, RESOLVER_ABI, provider);
  const latest: bigint = await resolver.getLatestVersionByConfiguration(EQUITY_CONFIG_ID);
  if (latest === 0n) {
    throw new Error(
      `Resolver ${resolverAddress} reports no version for the equity configuration. Wrong resolver address?`,
    );
  }
  return latest;
}

/** From ATS contracts/constants/roles.sol v8.0.0. */
export const ATS_ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  CONTROLLER: "0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e",
  CONTROL_LIST: "0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d",
  CORPORATE_ACTION: "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd",
} as const;

export type Deployments = {
  chainId: number;
  contracts: Record<string, string>;
  ats?: { factory?: string; resolver?: string };
  shareTokens?: Record<string, string>;
};

export function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_FILE)) {
    throw new Error(
      `No ${DEPLOYMENTS_FILE}. Deploy JurorTreasury, NyayaResolver and JurorShareMarket to Hedera first.`,
    );
  }
  return JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8")) as Deployments;
}

export function writeDeployments(next: Deployments): void {
  mkdirSync(dirname(DEPLOYMENTS_FILE), { recursive: true });
  writeFileSync(DEPLOYMENTS_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

export function requireContract(d: Deployments, name: string): string {
  const address = d.contracts?.[name];
  if (!address) throw new Error(`${name} missing from ${DEPLOYMENTS_FILE}. Deploy it first.`);
  return address;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run: set -a; source .env; set +a`);
  return value;
}

export function connect() {
  const provider = new JsonRpcProvider(env("HEDERA_RPC_URL"));
  const operator = new Wallet(env("HEDERA_PRIVATE_KEY"), provider);
  return { provider, operator };
}

/** Hedera entity id (0.0.x) to its long-zero EVM address. */
export function hederaIdToEvmAddress(id: string): string {
  const num = BigInt(id.split(".")[2] ?? id);
  return `0x${num.toString(16).padStart(40, "0")}`;
}

const MIRROR_NODE = process.env.HEDERA_MIRROR_NODE ?? "https://testnet.mirrornode.hedera.com";

/**
 * A Hedera contract has two EVM addresses: the long-zero form derived from its entity id, and an alias.
 * They are the same contract and both route calls, but as 20-byte Solidity values they are different, so any
 * equality check or address-keyed lookup against the stored form fails. ATS stores the alias, and passing the
 * long-zero resolver to deployEquity reverts with no data. Always resolve the alias from the mirror node.
 */
export async function hederaIdToAliasAddress(id: string): Promise<string> {
  const response = await fetch(`${MIRROR_NODE}/api/v1/contracts/${id}`);
  if (!response.ok) throw new Error(`Mirror node lookup for ${id} failed: ${response.status}`);
  const body = (await response.json()) as { evm_address?: string };
  if (!body.evm_address) throw new Error(`Mirror node returned no evm_address for ${id}`);
  return body.evm_address;
}

/**
 * The resolver must be the alias form, because ATS compares and stores it as a value. The factory is only a
 * call target, so either form works there.
 */
export async function atsAddresses() {
  const factoryId = process.env.ATS_FACTORY_ID ?? DEFAULT_ATS_FACTORY_ID;
  const resolverId = process.env.ATS_RESOLVER_ID ?? DEFAULT_ATS_RESOLVER_ID;
  const factory = process.env.ATS_FACTORY_EVM ?? hederaIdToEvmAddress(factoryId);
  const resolver = process.env.ATS_RESOLVER_EVM ?? (await hederaIdToAliasAddress(resolverId));
  if (/^0x0{24}/.test(resolver)) {
    throw new Error(
      `Resolver ${resolver} is the long-zero form. ATS stores its alias, and passing long-zero makes ` +
        `deployEquity revert with no data. Set ATS_RESOLVER_EVM to the alias from the mirror node.`,
    );
  }
  return { factory, resolver };
}

/** Never trust a published address: ATS's own docs disagree about which testnet factory is current. */
export async function assertHasCode(provider: JsonRpcProvider, address: string, label: string): Promise<void> {
  const code = await provider.getCode(address);
  if (code === "0x") {
    throw new Error(
      `${label} at ${address} has no contract code on this network. ` +
        `Override with ATS_FACTORY_ID / ATS_RESOLVER_ID (or ..._EVM) after checking ATS's current deployment.`,
    );
  }
}

type AbiComponent = { name: string; type: string; components?: AbiComponent[] };

/**
 * Checks a value against the real ABI's components before any transaction is built, so a missing or misspelled
 * field fails instantly and by name instead of as an encoder error mid-run. A missing `putRight` cost a run once.
 */
export function assertMatchesAbi(components: AbiComponent[], value: unknown, path = ""): void {
  if (!Array.isArray(components) || components.length === 0) return;
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path || "value"} should be an object with: ${components.map((c) => c.name).join(", ")}`);
  }
  const given = new Set(Object.keys(value as Record<string, unknown>));
  const expected = components.map((c) => c.name);
  const missing = expected.filter((name) => !given.has(name));
  const extra = [...given].filter((name) => !expected.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${path || "struct"} does not match the ATS ABI` +
        (missing.length > 0 ? `\n  missing: ${missing.join(", ")}` : "") +
        (extra.length > 0 ? `\n  unexpected: ${extra.join(", ")}` : ""),
    );
  }
  for (const component of components) {
    const child = (value as Record<string, unknown>)[component.name];
    const nested = component.components;
    if (!nested) continue;
    const where = path ? `${path}.${component.name}` : component.name;
    if (component.type.endsWith("[]")) {
      (child as unknown[]).forEach((item, i) => assertMatchesAbi(nested, item, `${where}[${i}]`));
    } else {
      assertMatchesAbi(nested, child, where);
    }
  }
}

/**
 * ISO 6166 check digit: letters map A=10..Z=35, then a Luhn pass over the first 11 characters.
 * ATS's factory runs the same check and reverts with WrongISINChecksum(string), which is only visible on-chain,
 * so we compute it here first.
 */
export function isinCheckDigit(first11: string): number {
  const digits = [...first11.toUpperCase()]
    .map((char) => (/[0-9]/.test(char) ? char : (char.charCodeAt(0) - 55).toString()))
    .join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // The rightmost character is doubled, then every second one moving left.
    const fromRight = digits.length - 1 - i;
    const value = Number(digits[i]) * (fromRight % 2 === 0 ? 2 : 1);
    sum += value > 9 ? value - 9 : value;
  }
  return (10 - (sum % 10)) % 10;
}

export function assertValidIsin(isin: string): void {
  if (isin.length !== 12) throw new Error(`ISIN "${isin}" must be 12 characters; ATS reverts with WrongISIN.`);
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
    throw new Error(`ISIN "${isin}" must be 2 letters, 9 alphanumerics and a check digit.`);
  }
  const expected = isinCheckDigit(isin.slice(0, 11));
  if (Number(isin[11]) !== expected) {
    throw new Error(
      `ISIN "${isin}" has a bad check digit: expected ${expected}, got ${isin[11]}. ` +
        `Use "${isin.slice(0, 11)}${expected}". ATS reverts with WrongISINChecksum(string) (0x342c92db).`,
    );
  }
}

/**
 * Everything ATS's factory validates by value rather than by shape. assertMatchesAbi cannot catch any of these,
 * because the struct is correctly shaped and only the contents are wrong; without this they surface only as an
 * on-chain revert after gas is spent. Taken from Factory.sol v8.0.0: _validateISIN, EmptyResolver,
 * NoInitialAdmins and _checkRegulationTypeAndSubType.
 */
export function assertValidEquityValues(
  equityData: {
    security: {
      resolver: string;
      maxSupply: bigint;
      erc20MetadataInfo: { isin: string };
      rbacs: { role: string; members: string[] }[];
    };
  },
  regulationData: { regulationType: number; regulationSubType: number },
): void {
  assertValidIsin(equityData.security.erc20MetadataInfo.isin);

  if (/^0x0+$/.test(equityData.security.resolver)) {
    throw new Error("security.resolver is the zero address; ATS reverts with EmptyResolver.");
  }

  // Deployment rejects an uncapped supply even though the mint path treats 0 as "no cap".
  if (equityData.security.maxSupply === 0n) {
    throw new Error("security.maxSupply is 0; ATS reverts with NewMaxSupplyCannotBeZero(). Set a real cap.");
  }

  if (/^0x0{24}/.test(equityData.security.resolver)) {
    throw new Error(
      `security.resolver ${equityData.security.resolver} is a long-zero address. ATS stores the alias form, ` +
        `so a long-zero resolver makes deployEquity revert with no data at all.`,
    );
  }

  const admins = equityData.security.rbacs.find((r) => BigInt(r.role) === 0n);
  if (!admins?.members.some((m) => !/^0x0+$/.test(m))) {
    throw new Error("rbacs needs a DEFAULT_ADMIN entry with a non-zero member; ATS reverts with NoInitialAdmins.");
  }

  const { regulationType: type, regulationSubType: sub } = regulationData;
  const validRegS = type === 1 && sub === 0;
  const validRegD = type === 2 && (sub === 1 || sub === 2);
  if (!validRegS && !validRegD) {
    throw new Error(
      `regulationType ${type} with subType ${sub} is rejected; ATS reverts with RegulationTypeAndSubTypeForbidden. ` +
        `Use REG_S (1) with NONE (0), or REG_D (2) with 506_B (1) or 506_C (2).`,
    );
  }
}

/** The deployEquity fragment's inputs, straight from ATS's artifact, for the check above. */
export function deployEquityInputs(abi: unknown[]): AbiComponent[] {
  const fragment = (abi as { name?: string; type?: string; inputs?: AbiComponent[] }[]).find(
    (entry) => entry.name === "deployEquity" && entry.type === "function",
  );
  if (!fragment?.inputs) throw new Error("deployEquity not found in the ATS factory ABI");
  return fragment.inputs;
}

/** Minimal ABIs: only what these scripts call. */
export const FACTORY_ABI = [
  "function deployEquity((((address resolver,uint256 maxSupply,(bytes32 key,uint256 version) resolverProxyConfiguration,(string name,string symbol,string isin,uint8 decimals) erc20MetadataInfo,(bytes32 role,address[] members)[] rbacs,address[] externalPauses,address[] externalControlLists,address[] externalKycLists,address compliance,address identityRegistry,bool arePartitionsProtected,bool isMultiPartition,bool isControllable,bool isWhiteList,bool clearingActive,bool internalKycActivated,bool erc20VotesActivated) security,(bool votingRight,bool informationRight,bool liquidationRight,bool subscriptionRight,bool conversionRight,bool redemptionRight,bool putRight,uint8 dividendRight,bytes3 currency,uint256 nominalValue,uint8 nominalValueDecimals) equityDetails)) equityData,((uint8 regulationType,uint8 regulationSubType,(bool countriesControlListType,string listOfCountries,string info) additionalSecurityData)) factoryRegulationData) returns (address equityAddress_)",
  "event EquityDeployed(address indexed equityAddress, address indexed deployer)",
];

/**
 * Prefer ATS's own published ABI, so the calldata is built from their artifact rather than our transcription.
 * Falls back to the fragments above if the deep import path changes between releases.
 */
export function factoryAbi(): unknown[] {
  try {
    const require = createRequire(import.meta.url);
    const artifact = require("@hashgraph/asset-tokenization-contracts/artifacts/contracts/factory/IFactory.sol/IFactory.json");
    if (Array.isArray(artifact?.abi) && artifact.abi.length > 0) {
      console.log("using ATS's published IFactory ABI");
      return artifact.abi;
    }
  } catch {
    // fall through
  }
  console.log("using transcribed IFactory fragments (ATS artifact not resolvable)");
  return FACTORY_ABI;
}

export const ATS_TOKEN_ABI = [
  "function isInControlList(address account) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "error AccountIsBlocked(address account)",
  "error AccountHasNoRoles(address account, bytes32[] roles)",
];

export const MARKET_ABI = [
  "function registerShareToken(address juror, address token)",
  "function buy(address juror, uint256 tradeValue) payable returns (uint256 shares)",
  "function priceOf(address juror) view returns (uint256)",
  "function shareToken(address juror) view returns (address)",
  "function reserveOf(address juror) view returns (uint256)",
];

export const TREASURY_ABI = [
  "function registerJuror(address juror, address hotWallet)",
  "function hotWalletOf(address juror) view returns (address)",
  "function fund(address juror) payable",
];

export function contract(address: string, abi: string[], runner: ContractRunner): Contract {
  return new Contract(address, abi, runner);
}

export const TINYBAR = 100_000_000n;

export function hbar(tinybars: bigint): string {
  return `${formatUnits(tinybars, 8)} HBAR`;
}

/** The relay speaks 18-decimal weibars; contracts see 8-decimal tinybars. */
export function tinybarToWeibar(tinybars: bigint): bigint {
  return tinybars * 10_000_000_000n;
}

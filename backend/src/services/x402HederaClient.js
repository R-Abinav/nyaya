/**
 * Real x402 client: constructs and signs a genuine Hedera testnet payment against a resource protected by
 * x402HederaGateway.js, using a juror's own hot wallet key (headless — no browser wallet, matching this
 * project's existing "no SDK with a browser-wallet-only signer" rule for the same reason as the ATS SDK).
 */
const { PrivateKey, createClientHederaSigner } = require('@x402/hedera');
const { ExactHederaScheme } = require('@x402/hedera/exact/client');
const { wrapFetchWithPaymentFromConfig } = require('@x402/fetch');

const HEDERA_TESTNET_NETWORK = 'hedera:testnet';

/**
 * @param {string} accountId - Real Hedera "0.0.x" account id of the payer (resolve via the mirror node —
 *   see resolveHederaAccountId below — never assume the EVM address doubles as one).
 * @param {string} privateKeyHex - Raw ECDSA private key, same format used elsewhere in this project for
 *   ethers.Wallet.
 * @returns a fetch function that transparently pays a 402 challenge and retries.
 */
function createHederaPayingFetch(accountId, privateKeyHex) {
  const privateKey = PrivateKey.fromStringECDSA(privateKeyHex);
  const signer = createClientHederaSigner(accountId, privateKey, { network: HEDERA_TESTNET_NETWORK });
  const scheme = new ExactHederaScheme(signer);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: HEDERA_TESTNET_NETWORK, client: scheme }],
    // Native HBAR ("0.0.0") isn't one of the client's built-in "default assets" (those are stablecoins
    // like PYUSD), so the default spend-control allowlist rejects it outright before ever reaching the
    // server. This project's whole HBAR-denominated design makes that the normal case, not a risk to cap
    // — the real spending discipline is the resolver's stake/withdrawal caps, not this client's USD guard.
    spendControls: false,
  });
}

/** Resolves an EVM address to its real Hedera "0.0.x" account id via the public mirror node — the same
 *  account any Hashio-funded address already has, auto-created on first transfer. Never derived locally. */
async function resolveHederaAccountId(evmAddress, mirrorNodeUrl = 'https://testnet.mirrornode.hedera.com') {
  const response = await fetch(`${mirrorNodeUrl}/api/v1/accounts/${evmAddress}`);
  if (!response.ok) throw new Error(`Mirror node lookup for ${evmAddress} failed: ${response.status}`);
  const body = await response.json();
  if (!body.account) throw new Error(`Mirror node returned no account id for ${evmAddress}`);
  return body.account;
}

module.exports = { createHederaPayingFetch, resolveHederaAccountId, HEDERA_TESTNET_NETWORK };

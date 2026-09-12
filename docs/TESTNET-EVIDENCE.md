# Testnet evidence

Every claim here is a real transaction on Hedera testnet. `.claude/rules/contracts.md` says a passing unit test against a mock is not evidence, so this file is what discharges that for each step. Look any hash up on HashScan: `https://hashscan.io/testnet/transaction/<hash>`.

## Step 2: Foundry reaches Hedera

Proves Foundry can deploy and transact through Hedera's JSON-RPC relay, before anything was built on top.

| What | Value |
|---|---|
| Contract | `HederaSmoke` at `0x8633049775ef7952DD6C169865D426D7818Fd505` |
| Deploy | `0x3315103fc029c487c6f1601b7b47533e7a40bc0021fb1e6ced825522f7b1c21f` |
| `ping` call | `0xb87ab4b09a8e487c673ff76b85a7b66c4c80755ee4710c87a9380d4f6b349093` |

Two things came out of this run, both now relied on by later code: contracts see **tinybars** (10¹⁰ weibars sent arrived as `msg.value == 1`), and `evm_version = "cancun"` really is supported, because `ping` executed an MCOPY instruction.

## Step 7: ATS shares, issued and compliance-enforced

The unit tests run against `test/mocks/MockAtsToken.sol`. These transactions are the same behaviour against the real Asset Tokenization Studio deployment on testnet.

| What | Value |
|---|---|
| Juror share token (ATS equity) | `0x5cCdEAdc7859cB6AB9d5a8bB763ce9Ac3dB1D86c`, "Nyaya Juror A Share" / NYJA |
| `deployEquity` | `0xfce22265fadc8c7a91bc835a3678610f22cdfb7d4caf8dea0481da28be95a452` |
| Registering the token with `JurorShareMarket` | `0x0aefae4d8fd5285dba2f733c2885d8d3603f4b9c79117a8ce4e131b59bff6ad1` |
| Third-party buy, succeeded | `0xfb537dbc3a49a0466b290f8fb999d05234a81b6ec49307bba194e88714a26cd1` |
| Blocked buy, juror's own key | `0xa7317029db1977d694aadc976a10b90de57f2c18ef6fbc1cdc8eaace78773d41`, status 0, `AccountIsBlocked(0xAD93109d571E527aA51Cc56A8E0682862866A69c)` |
| Blocked buy, juror's hot wallet | `0x9ef8dd9bb1f51a1ac81d07391ef806b154cdfdadbf28f9eaa8d16a04e672d80c`, status 0, `AccountIsBlocked(0x7a900064d35fed347BAc5418Bc5F6C5768622D8c)` |

Both rejections are on-chain with status 0, and the error was decoded from the mirror node's `error_message`, not only from a local `eth_call`. A judge can open either hash on HashScan.

Addresses involved: ATS factory `0.0.9213391`, ATS resolver `0.0.9212226` (alias `0xba2d5fc2083a0b8f164c50e65d782087fba18e0a`), juror key `0xAD93109d571E527aA51Cc56A8E0682862866A69c`, juror hot wallet `0x7a900064d35fed347BAc5418Bc5F6C5768622D8c`.

What the three trades establish together:

- **A third party can buy.** The buyer received 1,000 share units, minted by ATS at the market's request.
- **ATS's own compliance registry rejects the juror's addresses.** Both rejections come back as `AccountIsBlocked(address)` raised inside ATS, not from a check of ours. `JurorShareMarket` deliberately contains no matching check, so this is the compliance registry doing the work.
### The divergence result, which is why this run existed

`test/mocks/MockAtsToken.sol` reproduces ATS's `mint` as a role check followed by a compliance check. Real ATS runs six further checks before compliance: `onlyOperational`, `onlyActivated`, `onlyUnpaused`, `onlyWithoutMultiPartition`, `onlyUnrecoveredAddress` and `onlyWithinMaxSupply`. Any of those could have fired first and returned a different error, which would have meant the mock was testing a path real ATS never takes.

**None of them fired.** Both blocked buys came back with exactly `AccountIsBlocked(address)`, carrying the blocked address, from the compliance check. So the mock's role-then-compliance ordering is validated against the real contracts rather than assumed, and the fast unit tests exercise the same path production does. If a future ATS version changes that order, re-running `ats:prove` is what would catch it.

Reproduce with `npm run ats:issue` then `npm run ats:prove` in `packages/contracts`.

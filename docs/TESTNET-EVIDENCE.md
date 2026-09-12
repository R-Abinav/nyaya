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

## Step 6: the skim reaches shareholders

The 20% skim leaves the resolver, is declared as a dividend on the live ATS token, and is claimed by a real holder. This is what makes "declared through ATS, paid by our distributor" a description of what happens rather than a plan.

| What | Value |
|---|---|
| `JurorShareDistributor` | `0xd6b852e504c9d3df3a27297ef83236f2987da90e` |
| Deploy | `0x62e39dde8b4b35742f800a275b3f23700a40efb18234e2fed90cd72e7e1bdf5f` |
| `grantRole(ROLE_CORPORATE_ACTION)` on the ATS token | `0x131e04882f4b7cebe16a162d55f1f3d77a2cb42f82ea0c1d868289243b35f9d2` |
| `setDistributionAddress` on the resolver | `0x82366ca86bdea08e9d2149185c7bfbf3cbba42b377fea55eb4000bc927f5e966` |
| The case that earned the skim | open `0x221827ee9fd362d09f0b4d82db8d60e94fdd339c30947154b2f1361c9741ab79`, commit `0x06d25f2a789862fa67622fd1c384b65040485feb99798d58519da1d60674f986`, reveal `0x1116f97e252ce2d5786bab2214af186de0a66903dac0a8af7f60231a924e0641`, outcome `0xab1314fab42a45aa0a5753aec59672dde95eaa7d31dc2585e1b27e8574dbd8a7`, settle `0xd455896bc62dde24b9d9e8592e60f56e9a8fe9a610ccdfb5238d0f2b980843f5` |
| `releaseDistribution` (skim leaves the resolver) | `0xea10ef5b9f2083889d3763f36f631c94c1328b7ad0d1133036487b3c8b947f22` |
| `declare` (ATS snapshots holders) | `0x12568cc43c822cbbb19f197936e6517f35556ea3881115597fcb25f25d63aeeb` |
| `claim` (holder receives HBAR) | `0x18008069ff01aab0bc09765812455dd32b42f61c50a4ea3f88c77f35fb8b00bb` |
| Skim declared / ATS said owed / holder received | 0.4 HBAR / 0.4 HBAR / 0.4 HBAR |

The case was real: a 2 HBAR bounty, the juror staking 2 HBAR, committing, revealing after the commit deadline passed, and the operator reporting the outcome after the resolution time. Settlement produced a 0.4 HBAR skim, which is 20% of the juror's 2 HBAR net profit. Each deadline was waited out in real time, because there is no `vm.warp` on a live network.

### What ATS's dividend actually did

`declare()` handed ATS a per-unit rate of `4000000000000000000000000` at 18 `amountDecimals`. ATS snapshotted the holder at 1,000 units and reported the entitlement as the exact fraction `40000000000000000000000000 / 1000000000000000000`, which is 40,000,000 tinybars, or 0.4 HBAR. The holder claimed and received exactly that.

ATS declared and computed; it moved nothing. This contract paid. That is "declared through ATS, paid by our distributor", as a description of transactions rather than a plan.

### The divergence result

Six behaviours checked against `test/mocks/MockAtsToken.sol`, and the mock matches real ATS on every one:

| Behaviour | Result |
|---|---|
| A record date of "now" is accepted | same, ATS stored `recordDate 1789232939` |
| `recordDateReached` is true immediately | same |
| The snapshot caught the existing holder | same, `balanceAtSnapshot 1000` |
| Entitlement matches the mock's formula | same, both 40,000,000 tinybars |
| The holder received what ATS said | same, 0.4 HBAR |
| Dividend ids are 1-based | same, id 1 |

The run first reported the fifth row as a difference. That was a unit bug in the reporting script, not in any contract: provider balances are weibar (18 decimals) while contract figures are tinybars (8), so an exactly correct payout appeared to differ by 10¹⁰. The script now converts before comparing.

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

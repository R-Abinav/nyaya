# Testnet evidence

Every claim here is a real transaction, on Hedera testnet or Sepolia as each section says.

**Step 12 redeployed everything.** Nearly every address below the current-deployment table is now historical: the transaction happened and the assertion was real, but the contract it ran against is not the one live today. Every section from here on is marked explicitly, so a reader always knows which rows describe the system as it stands now versus proof that predates it. Look a Hedera hash up on HashScan (`https://hashscan.io/testnet/transaction/<hash>`), a Sepolia hash on Etherscan (`https://sepolia.etherscan.io/tx/<hash>`).

## Current live deployment

From `packages/contracts/deployments/hedera.json` and `deployments/sepolia.json`, both unconditionally rewritten by step 12's deploy scripts (`npm run deploy:hedera`, `npm run deploy:sepolia`). The Hedera addresses below are the result of **two** redeploys after step 12's first pass — see "Fixing the orphaned ATS wiring" below for why, both real mistakes made and fixed in the same sitting, not hidden.

| Contract | Chain | Address |
|---|---|---|
| `JurorTreasury` | Hedera | `0x5e4926105e27561819D53b5D4128bE6D5549A79A` |
| `NyayaResolver` | Hedera | `0x5bcFdccdF1f9cFB1C240806D8C9539C098Cf47D1` — has `cancel` and `openCaseFromTreasury` from genesis |
| `JurorShareMarket` | Hedera | `0x732c1D6217dC40E0744023A586a8DcfA40fDF0e8` — third instance; `registerShareToken` now skips `addToControlList` for an address already listed, the fix a market redeploy needed |
| `JurorShareDistributor` (juror A) | Hedera | `0xf7e84ec94b66a560becaa32aa6bf4e56e20f4322` — fresh, bound to the current resolver, working |
| `nyaya.eth` | Sepolia | tokenId `49155000663129042724818658837135340840687891215554050414247186218822100058112` — **unchanged by the redeploy**, still the same registration from step 10 |
| Subregistry (`UserRegistry` proxy) | Sepolia | `0x3443Ac4C15D15f1fc35Aef542A77A22220631BDf` |
| Resolver (`PermissionedResolver` proxy) | Sepolia | `0xa8B68dE34484752B6BbA123d53A3445cB79b79a7` |
| `NyayaAnchor` | Sepolia | `0x651E71981Ac4618554cf63B0d2033C91226eB362` |

Juror A's ATS share token (`0x5cCdEAdc7859cB6AB9d5a8bB763ce9Ac3dB1D86c`, NYJA) is unchanged and not redeployed — the current market and distributor above are both correctly wired to it, proven in "Fixing the orphaned ATS wiring" below.

## Historical: proofs before the step 12 redeploy

These addresses are no longer live. A proof marked **(1) stands** exercised a mechanism that doesn't depend on which contract instance ran it — the transaction is real and the assertion holds regardless of the redeploy. A proof marked **(2) needs re-proving** exercised something specific to the now-superseded instance (a role grant, a wiring, an instance-specific defect) and should not be read as describing the current live system until it's re-run.

| Contract | Address | Status |
|---|---|---|
| `JurorTreasury` (Hedera, pre-step-12) | `0x2da722390d6cA31741619837cC7e9966cb00E39A` | Superseded. Steps 6/7's transactions against it: **(1) stands** — the treasury/lock/slash mechanism doesn't depend on instance identity |
| `NyayaResolver` (Hedera, pre-step-12) | `0xeD67F63B90Af9c436B36A37f048f259568F05ac5` | Superseded. **Predated both `cancel` and `openCaseFromTreasury`** — this was the whole reason step 9 and this redeploy exist. Step 6's settlement/skim proof: **(1) stands**. Cancellation and `openCaseFromTreasury` were never proven live at all (see the gap note in step 12's section) |
| `JurorShareMarket` (Hedera, pre-step-12) | `0xCa8f98130a054F7Ec42cf36416af9E4B892B0A28` | Superseded. Step 7's third-party-buy proof: **(1) stands** as a demonstration that buying mints correctly |
| `JurorTreasury` / `NyayaResolver` / `JurorShareMarket` (Hedera, step-12 first pass) | `0xF3C5a058938F64aBC5529Ef9b7417C4173EfB345` / `0xc15F9b225081A736dE71CC64667D12C41EBeb22A` / `0xD1F487e12a1aC24B127354c61D2D521E52E2F3d7` | Superseded within the same session, by two mistakes made fixing the orphaned ATS wiring (see below): a repair script wrongly permanently locked this resolver's `distributionAddress(jurorA)` to the old, incompatible distributor, and separately `registerShareToken` on this market reverted `ListedAccount` for juror A (already blocked from a prior registration). Never had a real transaction run against it for anything beyond the wiring calls that exposed both bugs — **no proof stands or needs re-proving against these addresses specifically**, they simply stopped being live before anything else happened |
| `JurorShareDistributor` (juror A, bound to the pre-step-12 resolver) | `0xd6b852e504c9d3df3a27297ef83236f2987da90e` | Superseded, permanently orphaned by design (its `resolver` is `immutable`). Step 6's declare/claim proof: **(1) stands** as evidence the mechanism works. Fixed going forward with a fresh distributor — see below, not a rewiring of this one |
| Juror A's ATS share token | `0x5cCdEAdc7859cB6AB9d5a8bB763ce9Ac3dB1D86c` | Not redeployed, not superseded — still the live token (NYJA). Step 7's compliance-blocking proof: **(1) stands**, since the control list lives on the token itself, independent of which market holds `ROLE_ISSUER`, and this is re-confirmed fresh against the current market below |
| `HederaSmoke` (step 2) | `0x8633049775ef7952DD6C169865D426D7818Fd505` | Always throwaway. **(1) stands**, trivially — it never claimed to be part of the live system |
| ATS factory / resolver | `0.0.9213391` / `0.0.9212226` | Not ours, not touched by this redeploy. **(1) stands** |
| `UserRegistry` proxy (Sepolia, pre-step-12 subregistry) | `0x26eb6BfF38771Bf71bc6f43d7740Df65D5Eba36c` | Superseded. Step 10's deploy/wire/subname/EAC proof: **(2) needs re-proving** — re-proven fresh in step 12's own section below, against the new instance |
| `PermissionedResolver` proxy (Sepolia, pre-step-12 resolver) | `0xd0Ad97B7D87417fD2b3D497bEc74E1055459C023` | Superseded. Same as above: **(2) needs re-proving** — done, see step 12 |
| `NyayaAnchor` (pre-step-12) | `0xAbAEb818767865CC9eE4CA2565D7B49f17a8A98D` | Superseded. Step 11's relay proof: **(1) stands** as evidence the relay mechanism and event shapes are correct; **(2) needs re-proving** for fresh data against the current anchor specifically, but there is nothing to relay yet — the new resolver has zero settled cases (`caseCount() == 0`, checked live), so there is no real Hedera activity to mirror until a case actually settles there |

**Juror subname tokenIds under the OLD (now-superseded) subregistry** — `juror-a.nyaya.eth` `50668348104621293528748333114381292679190162783697188807632269532739928064000`, `juror-b.nyaya.eth` `64354008148194235229762394817807961894461774901824453356376610598100110671872`, `juror-c.nyaya.eth` `33527154775277864832870978416866926625423354425139564372825219847453627383808` — belong to a registry that no longer manages nyaya.eth. Fresh tokenIds under the new subregistry are in step 12's own section.

Each juror's own address (`juror-a` `0x1bb269c63ea41458D6Bc886448200E3621347D30`, `juror-b` `0x86Ab16ed1B5278798C4bb0c11Daf3b83dD2F7D60`, `juror-c` `0xD6587a0b4022F4386424BA3c9E0bB7919De6Bc6d`) is unchanged — the same throwaway keys were reused across the redeploy, since a juror's identity doesn't depend on which registry instance manages its subname.

## Step 2: Foundry reaches Hedera

> **(1) Stands, unaffected by the step-12 redeploy.** `HederaSmoke` was always throwaway; this proves the toolchain, not any part of the live system.

Proves Foundry can deploy and transact through Hedera's JSON-RPC relay, before anything was built on top.

| What | Value |
|---|---|
| Contract | `HederaSmoke` at `0x8633049775ef7952DD6C169865D426D7818Fd505` |
| Deploy | `0x3315103fc029c487c6f1601b7b47533e7a40bc0021fb1e6ced825522f7b1c21f` |
| `ping` call | `0xb87ab4b09a8e487c673ff76b85a7b66c4c80755ee4710c87a9380d4f6b349093` |

Two things came out of this run, both now relied on by later code: contracts see **tinybars** (10¹⁰ weibars sent arrived as `msg.value == 1`), and `evm_version = "cancun"` really is supported, because `ping` executed an MCOPY instruction.

## Step 6: the skim reaches shareholders

> **(1) Stands as evidence the skim mechanism works** — declare-through-ATS, paid-by-distributor is real. **Ran against a superseded resolver** (`0xeD67F63B90Af9c436B36A37f048f259568F05ac5`, predated `cancel`/`openCaseFromTreasury`) **and a now-orphaned distributor**. The same mechanism is re-proven fresh against the current resolver and a fresh distributor in "Fixing the orphaned ATS wiring", below step 12.

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

> **(1) Stands.** The compliance-blocking proof holds regardless of instance: `AccountIsBlocked` comes from the token's own control list, not from anything a market checks. The third-party-buy proof ran against a since-superseded market, but the same buy (and the compliance block) is re-proven fresh against the current market in "Fixing the orphaned ATS wiring", below step 12 — including a real bug that re-registering juror A on a new market surfaced and fixed.

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

## Step 10: ENSv2 identity on Sepolia, real protocol contracts

> **(2) Needs re-proving, and already has been** — see step 12 below. Everything in this section ran against the subregistry/resolver instances step 12 superseded (`0x26eb6BfF...` / `0xd0Ad97B7...`). The one exception is registering `nyaya.eth` itself: that registration is **unchanged and still current** — step 12 reused its tokenId/expiry rather than re-registering, so "Registering nyaya.eth" below still describes the live name, just not the live subregistry/resolver.

First contact with Sepolia. Every address and function signature was verified against the real deployment before being called, not assumed from the SDK or the docs alone: see `.claude/rules/contracts.md`'s "ENS scripts" section for the two real surprises that verification caught (`getSubregistry`/`getResolver` taking a label, not a tokenId; a commit-reveal wait that needed to be timed from the chain, not from before the commit was sent).

### Registering nyaya.eth

| What | Value |
|---|---|
| Availability check | `isAvailable("nyaya")` → `true`, checked live before spending anything |
| Price | `getRegisterPrice("nyaya", 28 days, MockUSDC)` → base 613,701 + premium 0 = 613,701 units (6 decimals), paid in a free-mint testnet token — `register()` takes a strict `IERC20 paymentToken`, there is no native-ETH path |
| `commit` | `0xc2aed90c9cdecc57dd8f67450450a40abe9188797e77e8d1eee37eb33d7531b8` |
| `MockUSDC.mint` | `0xe51eb4701a503e220025009b36db6986c5ff8678c9533edb6165f05a3a223ed9` |
| `MockUSDC.approve` | `0xbc11aaef8ee3b96a12e232fa6f9362c2976d895a1404226e268c2d8338f44cce` |
| `register` | `0x0a7e46bcefe733e2e3ad3c80a8513936337d1aef69f978e8697face839ec784e` |

`nyaya.eth` registered to the operator with subregistry and resolver deliberately left at zero — see the rule file for why — for 28 days (`MIN_REGISTER_DURATION`), expiring 2026-10-10.

### Deploying and wiring our own subregistry and resolver

| What | Value |
|---|---|
| Deploy `UserRegistry` proxy via `VerifiableFactory` | `0xb0e175a751ad373ba306b9b780b4e07b6a706682c61aa4fbef051bd421acbe9c` |
| Deploy `PermissionedResolver` proxy via `VerifiableFactory` | `0x035d798d603fead4f5cf68a2ac09c923c621bae209c44722d680a166d2225933` |
| `ETHRegistry.setSubregistry(nyaya, ourRegistry)` | `0x82b885164496ec25d6ef994b2a6bc84578d55cec13b361cd1ce409c509b44a7e` |
| `ETHRegistry.setResolver(nyaya, ourResolver)` | `0xf0a0104d34f30efc716754b1e665c9b9c6f49754d2bca1844d2a15fa28e02d30` |

Both deploys were verified on-chain, not just by a successful receipt: each script reads back `roles(ROOT_RESOURCE, operator)` on the freshly deployed proxy and asserts it covers exactly the bitmap requested. Both wiring calls were verified by re-reading `getSubregistry("nyaya")` / `getResolver("nyaya")` afterward and confirming they return our addresses.

### Creating the three juror subnames

| Subname | tokenId | Juror key (throwaway) | `register` tx |
|---|---|---|---|
| `juror-a.nyaya.eth` | `50668348104621293528748333114381292679190162783697188807632269532739928064000` | `0x1bb269c63ea41458D6Bc886448200E3621347D30` | `0x18a71bde706ea914ea77cfe27cb1b6849568cb8bc9d602aee7d194e3df743b4c` |
| `juror-b.nyaya.eth` | `64354008148194235229762394817807961894461774901824453356376610598100110671872` | `0x86Ab16ed1B5278798C4bb0c11Daf3b83dD2F7D60` | `0xf0a35c460b9c0eb4268ed3aa6fb75482c57dee27687abeae955e375db222f44c` |
| `juror-c.nyaya.eth` | `33527154775277864832870978416866926625423354425139564372825219847453627383808` | `0xD6587a0b4022F4386424BA3c9E0bB7919De6Bc6d` | `0x63920fd4c6e7ef2e3f5b2b0661d81063d9ce124fe2de5dfc297faf448315adf9` |

Each juror key is a fresh throwaway account generated on the spot and printed once to the terminal; none is stored in `.env` or the repo, and none is reused elsewhere.

### Enhanced Access Control: grants and the proof

Grants — `PermissionedResolver.authorizeTextRoles(subname, key, jurorAddress, true)`, one per juror per key:

| Subname | `"profile"` grant tx | `"strategy"` grant tx |
|---|---|---|
| `juror-a.nyaya.eth` | `0x4b2b64a9f4ea2e44ad0c96c4f756fbc0485f5219ed7fdf5ec0dd1b1eae77031b` | `0x32f3f0fb05ad4b5184b391f51fc721108a95c8eec5430aca75cd985cf68eda76` |
| `juror-b.nyaya.eth` | `0xdee7200c99346450053517e720b31c675720e3bbce72caca051027384435fa36` | `0xc5feebee6011e560e9a13bc16aa570afcd37d2b76e917021cc0bd3751775fe85` |
| `juror-c.nyaya.eth` | `0xbe2b1cc0658208d9671b645eb9139b17c9b13902ee8d627b2ae8440eed950abe` | `0x03810e4f661a955bf210fadd65151cdf22b653957ca2341889c649671ab169f2` |

The proof, for all three jurors: the juror's own key writes `profile` (positive control — this must succeed, or a rejected `score` write would prove nothing), the same key attempts `score` (must fail, specifically), the operator writes `score` on the same subname (must succeed), and `text(node, "score")` is read back to confirm it holds the operator's value, not the juror's rejected attempt.

| Subname | Juror writes `profile` (succeeds) | Juror attempts `score` (fails) | Rejection error | Operator writes `score` (succeeds) |
|---|---|---|---|---|
| `juror-a.nyaya.eth` | `0x21c3e1de0988529dc231f339cf703c691fe82f6c1647c2915659b5ca112348ab` | `0xd63b7673e59eb2d0c821cce0f25660ec9d5f49f79214d09ca622b42c911bd7a3` (status 0) | `EACUnauthorizedAccountRoles` | `0x64c812fc8471459c2cafe0c623d2d0f32b7bc241ad2d0a85c3a17fd703104af1` |
| `juror-b.nyaya.eth` | `0xaa961ccfc790a7c11c64fd0c36028f5c2dfb7d9cbc43ab2b61f42d060e1d4431` | `0x464ec09cc29d918c8f274665eab25f43b10422913becffd6d5c0b5456317e383` (status 0) | `EACUnauthorizedAccountRoles` | `0x1d7184d4560cc7f7db9f285cd0b615555d3281e5fc8cd3b5738b45d84a50e3e8` |
| `juror-c.nyaya.eth` | `0xa3bb28d6ad52f471f4aedd25f25796c9ad6ad8a7aaea368ecfe341b27360c710` | `0x21d90077efc47b1edb88d9b441bc22b7530acc67d990b280df1e260f12178b58` (status 0) | `EACUnauthorizedAccountRoles` | `0x1c8a9fe0a584d95ab75061b74f53bc28854bcdc8996202aa42809451f8e00fb3` |

Every rejection is on-chain with status 0, and the specific error — `EACUnauthorizedAccountRoles`, not a bare revert — was decoded by replaying the same call as `eth_call` at the block the failed transaction landed in. A public Sepolia RPC endpoint supports this directly; Hedera's Hashio does not, which is why step 7's evidence needed the mirror node instead. All 12 assertions across the three jurors passed (`npm run ens:prove`'s own output).

Reproduce with, in order: `npm run ens:register`, `ens:subregistry`, `ens:resolver`, `ens:wire`, `ens:subnames`, `ens:eac`, then `JUROR_PK=<printed by ens:subnames> JUROR_B_PK=<...> JUROR_C_PK=<...> npm run ens:prove` in `packages/contracts`.

## Step 11: the Sepolia anchor, relaying real Hedera settlement data

> **(1) Stands as evidence the relay mechanism and event shapes are correct.** **Ran against a superseded anchor** (`0xAbAEb818...`, replaced by `0x651E7198...` in step 12). Not yet re-proven with fresh data against the current anchor — not because it's hard, but because there's nothing real to relay yet: the current live resolver has settled zero cases (`caseCount() == 0`, checked live on `0xc15F9b22...`). This section documents the mechanism working, not the current anchor's contents, which are empty.

`NyayaAnchor` deployed at `0xAbAEb818767865CC9eE4CA2565D7B49f17a8A98D` (deploy tx `0xa22022c7087c1ae478afaeaf804b1ecd855aed1776413b2e988e01dbda8bcf34`). No case was opened or settled fresh for this step: every event below mirrors real data already read directly off the Hedera resolver and distributor deployed at `0xeD67F63B90Af9c436B36A37f048f259568F05ac5` / `0xd6b852e504c9d3df3a27297ef83236f2987da90e` — the same step-6 case this file already documents, re-decoded from its own transaction receipts rather than retyped from the earlier prose, to catch a mismatch if one existed.

### Verdict and ReturnCheckpoint (mirrors the step-6 case, case 1, juror A)

Read live from Hedera before relaying: `JurorSettled` decoded from settle tx `0xd455896bc62dde24b9d9e8592e60f56e9a8fe9a610ccdfb5238d0f2b980843f5` (result `Correct`, stake 200,000,000 tinybars, x402Spend 0, net +200,000,000), `commitments(1, jurorA)` for the ruling (`Yes`, since `revealed = true`), and `cumulativeNet` / `cumulativeCapital` for juror A (200,000,000 / 200,000,000 — confirmed to be exactly this case's contribution and nothing later, see below).

| What | Value |
|---|---|
| `recordVerdict` (Sepolia) | `0x8671c9e0d83a7c9b57e106f049c60dd7a390e55c48d11af9f9603067cd71fccc` |
| `Verdict` fields emitted | `caseId=1, juror=0xAD93109d571E527aA51Cc56A8E0682862866A69c, result=Correct(0), ruling=Yes(2), stake=200000000, x402Spend=0, net=200000000` |
| `recordReturnCheckpoint` (Sepolia) | `0x7e57b376ef6844770c851d8f9be736cf170cab34e0ecb3cb2ff1ec9e32e01969` |
| `ReturnCheckpoint` fields emitted | `caseId=1, juror=0xAD93109d571E527aA51Cc56A8E0682862866A69c, cumulativeNet=200000000, cumulativeCapital=200000000` |
| Mirrors Hedera tx | `0xd455896bc62dde24b9d9e8592e60f56e9a8fe9a610ccdfb5238d0f2b980843f5` |

The relay script checked, before trusting the live cumulative totals, that no case after case 1 has settled or been cancelled for juror A. Juror A does have a commitment on case 2 (the grace-boundary proof's deliberately abandoned case, proving the defect `cancel` was later built to fix), but that case is neither settled nor cancelled — `cancel` doesn't even exist on this deployed resolver — so it cannot have touched the totals, and the check passed honestly rather than being skipped.

### Distribution (mirrors the step-6 dividend, dividend 1, juror A)

Read live from Hedera before relaying: `DividendDeclared` decoded from declare tx `0x12568cc43c822cbbb19f197936e6517f35556ea3881115597fcb25f25d63aeeb` (pot 40,000,000 tinybars, amountPerUnit 4,000,000,000,000,000,000,000,000 — the distributor's own fixed-point rate, not a tinybar figure), and `DividendClaimed` decoded from claim tx `0x18008069ff01aab0bc09765812455dd32b42f61c50a4ea3f88c77f35fb8b00bb` (holder `0x1BF897b2D08fd7Ef24323C2783eE4B1b3eab1624`, amount 40,000,000 tinybars).

| What | Value |
|---|---|
| `recordDistributionDeclared` (Sepolia) | `0x177d08f74581ac9e9f78bbc786e699b37cae6bf21a99deecf5f1839787a643bb` |
| `Distribution` fields emitted | `juror=0xAD93109d571E527aA51Cc56A8E0682862866A69c, dividendId=1, kind=Declared(0), holder=0x0, amount=40000000, amountPerUnit=4000000000000000000000000` |
| `recordDistributionClaimed` (Sepolia) | `0xe900adbdd07592d2a65ba58a2a8d7e452363bab3dd4a27bb2dabbe7ad19dfb77` |
| `Distribution` fields emitted | `juror=0xAD93109d571E527aA51Cc56A8E0682862866A69c, dividendId=1, kind=Claimed(1), holder=0x1BF897b2D08fd7Ef24323C2783eE4B1b3eab1624, amount=40000000, amountPerUnit=0` |
| Mirrors Hedera tx | declare `0x12568cc43c822cbbb19f197936e6517f35556ea3881115597fcb25f25d63aeeb`, claim `0x18008069ff01aab0bc09765812455dd32b42f61c50a4ea3f88c77f35fb8b00bb` |

### Non-operator rejection

A freshly generated, unrelated Sepolia address attempted `recordVerdict` directly against the deployed anchor (not a local test): tx `0x9f779a52c6d97ac6fa7c6d93953f9077325a343a15d8b02d443c7e1c53c7d232`, status 0, revert data `0x7c214f04` — the exact selector for `NotOperator()`, confirmed with `cast sig 'NotOperator()'`.

### What's proven against the real deployed anchor, and what's only proven locally

Real, on the deployed contract, with the transaction hashes above: all three event shapes fire with correct field values when relaying real Hedera data, and a non-operator is rejected with the specific error.

Only against the local forge test suite (`test/NyayaAnchor.t.sol`, 16 tests, not evidence on its own per this file's own rule): the constructor's zero-address guard, operator-gating on all four write functions individually, and the exact field values for every `Result`/`Ruling` combination the docs describe (`Unrevealed`, `NoCommitment`, `Cancelled`, and the sign of `net` in each case) — the real relay only exercised the `Correct` path, because that's the only settled case this project's real testnet history has. A mutation test (flipping the operator check and a `Claimed` field) confirmed the suite actually catches both classes of regression before either was restored.

Reproduce with `npm run anchor:relay-settlement` then `npm run anchor:relay-distribution` in `packages/contracts` (both default to the step-6 case; override with `HEDERA_CASE_ID`/`HEDERA_JUROR`/`HEDERA_SETTLE_TX` or `HEDERA_DECLARE_TX`/`HEDERA_CLAIM_TXS` for a different one).

## Step 12: deploy scripts, the redeploy, and the dry-run guard

### The dry-run guard, verified by actually running it both ways

`vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)` had been flagged as untested since step 1. `script/verify-sepolia-deploy-guard.sh` forks live Sepolia with a local anvil (real ENSv2 contract code, zero real cost) and runs `DeploySepolia.s.sol` twice:

- **Without `--broadcast`:** `deployments/sepolia.json` was byte-for-byte unchanged (SHA-256 compared before and after) — `isContext` returned `false` inside the script, confirmed in its own trace output.
- **With `--broadcast`** (against the anvil fork only, never real Sepolia): the file changed, and every written address was well-formed. The written JSON's nested shape (`contracts.NyayaAnchor` etc., built with `vm.serializeString` nesting a sub-object under a parent key) was read back and checked field-by-field, not just diffed.

The real `deployments/sepolia.json` was backed up before either run and restored afterward unconditionally (a shell trap), regardless of pass or fail, since the broadcast run legitimately writes fork-only addresses that must never be mistaken for a real deployment.

This is a shell-level integration test, not a `forge test` — deliberately: `forge test`'s own execution context is neither `ScriptDryRun` nor `ScriptBroadcast`, so `isContext` can't be exercised meaningfully from inside a plain Solidity test. `test/DeploySepolia.t.sol` (4 tests) separately cross-checks the script's three role-bitmap literals against an independent bit-shift recomputation and against the exact decimal values step 10 confirmed on-chain — real coverage, but of the bitmaps, not the guard itself.

### Hedera: fresh JurorTreasury, NyayaResolver, JurorShareMarket

`npm run deploy:hedera` (`script/deploy-hedera.sh`, `forge create` + `cast send`, never `forge script` — Hashio still rejects the block-hash forking `forge script` depends on). Preflighted: operator held 8.74 HBAR, above the 5 HBAR floor, before anything was sent. Genesis withdrawal cap/window (10 HBAR / 1 hour) were read directly off the previous live treasury before being written into the script, not guessed.

| What | Value |
|---|---|
| `JurorTreasury` deploy | `0xceb5e30e3a3871f0f587a17bc43ddca4f118bd5a473f9bdf61b687cba9f229b5` → `0xF3C5a058938F64aBC5529Ef9b7417C4173EfB345` |
| `NyayaResolver` deploy | `0x2dd89833cdfab1e6f0886c1c1158c441de072eecf57562d6f6a1286e2f3c8286` → `0xc15F9b225081A736dE71CC64667D12C41EBeb22A` |
| `treasury.setResolver(resolver)` | `0x9d04caec9560e587f067e32a7c3e855a6480320bd0586cf7b065e6d362b1d8e7` |
| `JurorShareMarket` deploy | `0x2e26ebab5f012e944da5b58fe571998d7f43e387deb082187af9a3e06626976c` → `0xD1F487e12a1aC24B127354c61D2D521E52E2F3d7` |

Every address was parsed from `forge create --json`'s own `deployedTo`/`transactionHash` fields, never assumed from a hash format. Cross-wiring confirmed by re-reading, not just by a successful receipt: `treasury.resolver() == resolver`, `resolver.treasury() == treasury`, `market.resolver() == resolver`, `market.treasury() == treasury`, all read live after the fact. `resolver.GRACE_PERIOD()` and the presence of both `cancel` and `openCaseFromTreasury` in the compiled ABI confirm this is the post-step-9 resolver, not a repeat of the old one.

### Sepolia: fresh NyayaAnchor, subregistry, resolver — nyaya.eth reused, not re-registered

`npm run deploy:sepolia`, real broadcast, 14 transactions. `nyaya.eth`'s tokenId and expiry were read from the pre-existing `deployments/sepolia.json` and reused exactly; the three juror addresses were reused the same way.

| What | Value |
|---|---|
| `NyayaAnchor` deploy | `0x654830719c6cf65e18b774aa6a039655c4c1096ce0ee7f9552b67cb958329c71` → `0x651E71981Ac4618554cf63B0d2033C91226eB362` |
| Deploy subregistry (`VerifiableFactory.deployProxy`) | `0xb0efd0c16d87154ce53f2489f0b0a2074a2ed22baf0ae8777cdea592b4d7bf6e` → `0x3443Ac4C15D15f1fc35Aef542A77A22220631BDf` |
| Deploy resolver (`VerifiableFactory.deployProxy`) | `0xc2a90996535a7bd9e77231e6dd1a81158f45333676a402a76330fe90b37b76ff` → `0xa8B68dE34484752B6BbA123d53A3445cB79b79a7` |
| `ETHRegistry.setSubregistry(nyaya, newSubregistry)` | `0x211ad1e581035a751d9f4de32b4d184b560a83932038cc9e964616eb18bdc980` |
| `ETHRegistry.setResolver(nyaya, newResolver)` | `0xa1e9a69d473867db883ab2f4021f75859706a2598e40fbe747d7316f70150afc` |
| `register(juror-a)` | `0xfb5217def951ce55a8f1ce0ef1f0ef3cda03f7f49efd500025dfaa912b3f0e67`, tokenId `50668348104621293528748333114381292679190162783697188807632269532739928064000` |
| `authorizeTextRoles(juror-a, "profile")` | `0x2a5e3446868f34b250bc5d2acd7939182b8758cf49ab1d68ab377d69f4cf675c` |
| `authorizeTextRoles(juror-a, "strategy")` | `0x4e2d97d010225ce79e51ab123b3ffe49444a1e4bff4ba87afdcfa465a109fbbb` |
| `register(juror-b)` | `0x5553e6af4b981dcd4a19742a44a77a7de1e4e6c3f5b8be686cf8d2e1811a93ae`, tokenId `64354008148194235229762394817807961894461774901824453356376610598100110671872` |
| `authorizeTextRoles(juror-b, "profile")` | `0x7965153054fdf8495ae9ad3039e34f7fb2997129cdd53d76d7aff964c7733969` |
| `authorizeTextRoles(juror-b, "strategy")` | `0x23e080b406eb1d4e2e25817a769276d253102f1845efb72adc923e3f241efdad` |
| `register(juror-c)` | `0x6df438a9e1b2294ccf83e823c36ae63d4afebfe6d138eb32b56459938c565ea3`, tokenId `33527154775277864832870978416866926625423354425139564372825219847453627383808` |
| `authorizeTextRoles(juror-c, "profile")` | `0xade7fdcea8bb4cf4023fe733c84e41c25f598b16b10c3fdb0e910ce1ebe764df` |
| `authorizeTextRoles(juror-c, "strategy")` | `0x4afd6f6f8039b54dbc978a48f545703807e86f11a45434472b3d2b4d51d17f09` |

The three tokenIds are numerically identical to the ones under the old (superseded) subregistry — not a mistake: `LibLabel.id(label)` is a pure function of the label string, so a never-before-used label produces the same tokenId in any fresh registry instance. The number identifies the label, not a specific contract.

`getSubregistry("nyaya")` / `getResolver("nyaya")` were read back afterward directly against `ETHRegistry` on real Sepolia and confirmed to return the new addresses — not inferred from the transactions succeeding.

### EAC re-proven fresh against the new resolver instance

Since the resolver instance changed, the Enhanced Access Control split was re-checked for real rather than assumed to have carried over (it doesn't — EAC state lives on the resolver contract, and this one is new):

| What | Value |
|---|---|
| Juror A writes `profile` on the new resolver (must succeed) | `0x64b1cfd4d1b05007a8512fa79b84fa50bc3101561ec7f386ea8123a9b8ced09a`, status 1 |
| Juror A attempts `score` on the new resolver (must fail) | `0x1c57a0030aa1ca16548987d7c421053f1e88df52b69a92aa051436369a5eb276`, status 0 |
| Operator writes `score` on the new resolver (must succeed) | `0x0036392bff32cca71ea98b08f49b074d4b320927eb6020f67795bbf8cded9d1a`, status 1 |

Only juror A was re-checked (the cheapest sufficient proof that the redeploy's EAC grants took effect correctly); jurors B and C received the identical `authorizeTextRoles` calls in the same broadcast and there is no mechanism by which one juror's grant would land correctly while another's didn't.

### What this step leaves open

- **`openCaseFromTreasury` and `cancel` are still not proven live anywhere.** Both are covered by extensive forge tests (`NyayaResolverBountySources.t.sol`, `NyayaResolverCancellation.t.sol`) and both exist in the current live resolver from genesis, but a live cancellation proof needs `GRACE_PERIOD` (24 hours) to actually pass in real time, which didn't happen in this session. This is the single largest remaining gap between "the forge suite is green" and "proven on testnet," and it needs a dedicated run, not a rushed one.
- **The ATS/share-market wiring gap is fixed** — see "Fixing the orphaned ATS wiring" immediately below, with real transactions for the buy, the compliance block, and a full skim cycle.
- **The anchor now has real data it could mirror** (the case run for the skim proof below settled for real on the current live resolver), but relaying it wasn't asked for in this pass and hasn't been done — `caseCount()` is no longer zero, so this note is now about something not yet done rather than something that can't be done yet.

## Fixing the orphaned ATS wiring

Closing the gap step 12's own audit found, using the EXISTING ATS token for juror A (NYJA) throughout — nothing was re-issued. This took two real mistakes and two small redeploys to get right; both are recorded here rather than smoothed over, the same standard as the cancel/openCaseFromTreasury history earlier in this file.

### Mistake 1: a repair script pointed the new resolver's distribution at the wrong distributor

`resolver.setDistributionAddress(juror, to)` is a genuine one-time setter (`if (distributionAddress[juror] != address(0)) revert DistributionAddressAlreadySet()`) with no override, by design. A first repair script read a `distributors` entry that had been written into `deployments/hedera.json` purely as historical bookkeeping about the *old, orphaned* distributor, and mistook it for "already deployed, reuse it" — pointing the new resolver's `distributionAddress(jurorA)` at a distributor whose own `resolver` is immutably the *old* one. Confirmed on real chain state before doing anything else (`distributionAddress` == the old distributor; the old distributor's `resolver()` == the old, superseded resolver). Since `JurorTreasury.setResolver` is also one-time (already consumed) and `JurorShareMarket.resolver` is `immutable`, the only fix was a fresh treasury + resolver + market:

| What | Tx |
|---|---|
| `JurorTreasury` deploy | `0xb8a24ac7409f3558712d3123ef0183c48dd74f4efb151c6b649ed0d199edb1e3` → `0x5e4926105e27561819D53b5D4128bE6D5549A79A` |
| `NyayaResolver` deploy | `0x362ab3b42fa567a5db4d073a3a2482051e0248596656c1f28e0c4815702a0a35` → `0x5bcFdccdF1f9cFB1C240806D8C9539C098Cf47D1` |
| `treasury.setResolver` | `0xf41060e8c142bd005548a23f62f838ad47188d6e173027fc45b206359f9c440e` |
| `JurorShareMarket` deploy (before the second fix, below) | `0x51dc545b958ed1516a73de91f5d45a84ff17f28a3cfe062cb5fb7a585e0e11d2` → `0xAbAEb818767865CC9eE4CA2565D7B49f17a8A98D`, superseded again by mistake 2 |

A second, unrelated bug surfaced while checking the operator's balance for this redeploy: `deploy-hedera.sh`'s preflight divided a weibar balance (18 decimals, routinely ~5×10¹⁹) using bash's native `$(( ))` arithmetic, which is 64-bit signed and silently overflows past ~9.2×10¹⁸ — it reported an operator holding 55 HBAR as holding 0.12 HBAR and aborted. Fixed by doing that division in Python, which has no such limit; the rule file now names this explicitly for any future weibar-scale arithmetic.

The repair script's own safeguard, added the same day: before treating any address read from a deployments file as "already deployed, reuse it," it now reads the candidate's own immutable `resolver()` on-chain and only reuses it if that matches the current live resolver — otherwise it deploys fresh and logs why it rejected the candidate. This is what caught the mistake being about to repeat itself on the very next run and stopped it automatically.

### Mistake 2: registerShareToken can't re-list an already-blocked juror

Wiring the (correct, fresh) market to the token, `registerShareToken(jurorA, token)` reverted with ATS's `ListedAccount(jurorA)`. Confirmed directly: `isInControlList(jurorA)` and `isInControlList(hotWallet)` were both already `true` on the token, from the *original* registration — the control list lives on the token and survives a market redeploy, but `JurorShareMarket.registerShareToken`'s source called `token.addToControlList(...)` unconditionally, with no "already listed" check, so it reverts every time for a juror ever registered on any prior market. This is a real contract bug the redeploy exposed, not a wiring gap — fixed in `src/shares/JurorShareMarket.sol`: both `addToControlList` calls are now guarded by `isInControlList`, skipped if already true. `test/mocks/MockAtsToken.sol`'s `addToControlList` was also updated to revert `ListedAccount` for a duplicate, matching real ATS instead of silently succeeding, and a new test (`test_RegisteringTheSameJurorOnASecondMarketInstanceDoesNotRevert`) reproduces the exact scenario; a mutation check (removing the guard) confirmed the test catches the regression. A scan of the rest of `JurorShareMarket.sol` found no other external call with this same "unconditional, no already-done check" shape — `fund`, `contributeToCaseBountyTreasury`, `mint`, `burn`, and the ETH transfer in `sell` are all meant to run every time, not once.

Only `JurorShareMarket` needed a third deploy for this fix — the current resolver and treasury from mistake 1's redeploy were already correct and are reused as constructor args, no further cascade:

| What | Tx |
|---|---|
| `JurorShareMarket` deploy (fixed) | `0x92ef967b0ba99f12680f8abb370147a4e57a7974df532d8f8ff82de09f551b41` → `0x732c1D6217dC40E0744023A586a8DcfA40fDF0e8` |
| `grantRole(ISSUER)` on the token | `0xeda9bcc6509149c42f206f219b7bccc5bb4782bae7e8ed3ed5676660136b5178` |
| `grantRole(CONTROLLER)` on the token | `0x8d1784308bf3f771d382b8b64ef9b6997ca19034b2c8ee77478b974209d0997b` |
| `grantRole(CONTROL_LIST)` on the token | `0xffb8d6cbb228adafb3982e09d11b00695ff39030496c1cfb7c941e4e3d0baa34` |
| `treasury.registerJuror(jurorA, hotWallet)` on the new treasury | `0x9e1b83609f0bda47e19c69d570630873f3b7bc4bfb9199b7f7426a713eb5146f` — needed before `registerShareToken` would even reach the control-list check (`treasury.hotWalletOf` must resolve first) |
| `registerShareToken(jurorA, token)` | `0x1d220d09e14a67db6432d78a9fba1402759762ad8e2898f45e73d095ddce25ae` — succeeds now |
| Fresh `JurorShareDistributor` deploy, bound to the current resolver | `0x593622a7f9bee6d34fc500d8f6f6ff96f1a0dcb6386338637f15c09969c3afbe` → `0xf7e84ec94b66a560becaa32aa6bf4e56e20f4322` |
| `grantRole(CORPORATE_ACTION)` on the token, for the new distributor | `0x8543a8c139890f926d551777f44a473fdf67ee95f83694d6d6cfbb588028ce4c` |
| `setDistributionAddress(jurorA, newDistributor)` on the new resolver | `0xedc4acee65130f746fbee36c39fdf6599890c142009d22d4ba17e6970826b2db` |

### Proof: a real buy, the compliance block, and a full skim cycle — all against the current live contracts

| What | Value |
|---|---|
| Third-party buy, 10 HBAR trade | `0xdfe1a05533fe08231f4440b0ff2030d59bf8ec188e465839b04472e6ac4e06d4` — buyer received 1,000 NYJA units |
| Split landed exactly | `reserveOf(jurorA)` 300,000,000 tinybars (30%), `treasury.balanceOf(jurorA)` +700,000,000 (70%), `resolver.caseBountyTreasury()` +20,000,000 (2% fee) — read live on-chain, not inferred from the transaction succeeding |
| Blocked buy, juror's own key | `0x9dba9006bae4a2cb197dc472684565f73c32ec46bb27fa71528e691bccf98f00`, status 0, `AccountIsBlocked(0xAD93109d571E527aA51Cc56A8E0682862866A69c)` |
| Blocked buy, juror's hot wallet | `0x25a6179422a3158934b8b89c996c07d82c57e72c69ec8cec6eedb09bfbd906e3`, status 0, `AccountIsBlocked(0x7a900064d35fed347BAc5418Bc5F6C5768622D8c)` |
| The case that earned the skim (real, on the current resolver) | open `0xeddc90375f34f0ab2c3769d74513812afeb6f1ccc26bcf387ee8e19a88d5cf64`, commit `0x14b7dfe9f4347920131be756e8789e45d88da2b3c542c84060fc3f22573e0819`, reveal `0x02d887e430b9299a46e123a78ecd839c4cb2334b61bb5650eaf9795f705dece2`, outcome `0xc42e686b5b807a51b0be47d01a46b57debe0d1b326223a49cc91f1f8d33d42f6`, settle `0xddf0505e089961eaaa8152453c678769b1466027870221d8eeb8b89759d8754b` |
| `releaseDistribution` | `0x610dcd768e9eb266a2fc280b511d101a7fa7aa53a655180f8453c53ad0b1f0fe` — 0.4 HBAR skim |
| `declare` (ATS snapshots holders, dividend id 2 — this token's second dividend ever) | `0x89366784f3d62b58fb71e0312abe0798c3e7446f2069903dde413767dce13d2b` |
| `claim` | `0x5c6057d3bc410f2133cec318324623bc568a5b05564642d97e1b03060b10da5e` |
| Skim declared / ATS said owed / holder received | 0.4 HBAR / 0.2 HBAR / 0.2 HBAR — the buyer holds 1,000 of 2,000 total units, so owed exactly half the pot |

The divergence report (real ATS vs `test/mocks/MockAtsToken.sol`) passed on all six checks again, same as step 6's original run.

Both blocked-buy addresses and the case's winning juror are the same real juror A identity throughout (`0xAD93109d571E527aA51Cc56A8E0682862866A69c`, hot wallet `0x7a900064d35fed347BAc5418Bc5F6C5768622D8c`), supplied by the user for this run and not stored anywhere in the repo.

Reproduce with `npm run ats:repair-wiring` (idempotent — re-running it after everything is correctly wired just confirms and does nothing), then `JUROR_ADDRESS=<jurorA> npm run ats:prove` for the buy and compliance check, then `JUROR_ADDRESS=<jurorA> JUROR_PK=<...> BUYER_PK=<...> npm run ats:distribute` for the skim cycle, in `packages/contracts`.

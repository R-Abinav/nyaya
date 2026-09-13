// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Sepolia. Records finalised Hedera settlement history as events, purely for indexing: this is the only
/// source The Graph's subgraph ever reads, since Hedera has no hosted Subgraph Studio support. Deliberately
/// minimal, and deliberately separate in purpose from the Sepolia ENSv2 resolver from step 10: the resolver
/// holds a juror's current score snapshot (one value, overwritten each time); this anchor holds full
/// historical events for indexing (append-only, nothing here is ever overwritten). Anchor writes never
/// route through the resolver's text records, and the resolver never reads from here. Same operator key as
/// every other operator action (Hedera outcome reporting, the ENS score record), writing already-public
/// results that already settled on Hedera. This is not a bridge: no value moves, nothing here can be
/// replayed back onto Hedera, and nothing here is authoritative — the resolver on Hedera is, always.
///
/// **Every numeric amount below is in TINYBARS, Hedera's 8-decimal unit** (`stake`, `x402Spend`, `net`,
/// `cumulativeNet`, `cumulativeCapital`, and `Distribution.amount`), because that is what the Hedera
/// resolver and distributor actually emit and store. None of it is an 18-decimal Sepolia-native value, and
/// this contract holds no ETH and moves none. `Distribution.amountPerUnit` on a Declared row is the one
/// field that is NOT a plain tinybar figure at all — see its own comment. Treating any of these as
/// 18-decimal values is exactly the bug that produced a false "real ATS differs from the mock" divergence
/// report one layer down, in the distributor's own testnet run (step 6); don't let it recur here, one
/// layer up, in whatever eventually reads these events.
contract NyayaAnchor {
    /// Mirrors `NyayaResolver.Result` on Hedera exactly, index for index. Never reorder: a subgraph mapping
    /// reads this enum's index, the same rule the source enum on Hedera already follows.
    enum Result {
        Correct,
        Incorrect,
        Unrevealed,
        NoCommitment,
        Cancelled
    }

    /// Mirrors `NyayaResolver.Ruling` on Hedera exactly. `None` is correct for every `Result` other than
    /// `Correct`/`Incorrect`: a juror that never revealed, or a case that was cancelled, has no ruling.
    enum Ruling {
        None,
        No,
        Yes
    }

    /// Whether a `Distribution` row records the dividend being declared, or one holder's claim against it.
    /// Several `Claimed` rows follow one `Declared` row sharing the same `dividendId`.
    enum DistributionKind {
        Declared,
        Claimed
    }

    address public immutable operator;

    /// Per-juror-per-case verdict, mirroring `NyayaResolver.JurorSettled` plus the juror's own ruling.
    /// `result` alone answers "why did this juror lose", distinguishing a wrong ruling (`Incorrect`) from
    /// a forfeited non-reveal (`Unrevealed`) from a juror that spent on evidence and declined to commit
    /// (`NoCommitment` — a legitimate low-confidence outcome, not by itself a bug signal; see
    /// `NyayaResolver.SpentWithoutCommitting`) from a platform failure that was nobody's fault
    /// (`Cancelled`) — never collapsed to a binary win/lose. `net` is signed and pre-skim, matching what
    /// the resolver's own track record uses.
    event Verdict(
        uint256 indexed caseId,
        address indexed juror,
        Result result,
        Ruling ruling,
        uint256 stake,
        uint256 x402Spend,
        int256 net
    );

    /// A juror's two running totals immediately after settling `caseId` — the figures the return metric is
    /// built from (`cumulativeNet / cumulativeCapital`), never a mean of per-case percentages. `caseId`
    /// correlates this checkpoint to the `Verdict` that produced it; the totals themselves are cumulative
    /// since genesis, not scoped to this case alone.
    event ReturnCheckpoint(
        uint256 indexed caseId, address indexed juror, int256 cumulativeNet, uint256 cumulativeCapital
    );

    /// One juror's dividend history, mirroring `JurorShareDistributor` on Hedera.
    /// On a `Declared` row: `holder` is zero, `amount` is the declared pot in tinybars, `amountPerUnit` is
    /// the distributor's own per-unit rate at its fixed-point scale (the ATS share token's own decimals
    /// combined with the distributor's fixed `AMOUNT_DECIMALS = 18`) — this is NOT a plain tinybar amount,
    /// and must not be treated as one.
    /// On a `Claimed` row: `holder` is the claimant, `amount` is their payout in tinybars, and
    /// `amountPerUnit` is unused and always zero.
    event Distribution(
        address indexed juror,
        uint256 indexed dividendId,
        DistributionKind kind,
        address holder,
        uint256 amount,
        uint256 amountPerUnit
    );

    error NotOperator();
    error ZeroAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    /// Mirrors one juror's settlement outcome for one Hedera case. Callable once per juror per case in the
    /// relay's normal usage, but nothing here enforces that: this contract has no state of its own to
    /// protect, only an append-only event log, and the relay script is what decides what has already been
    /// mirrored.
    function recordVerdict(
        uint256 caseId,
        address juror,
        Result result,
        Ruling ruling,
        uint256 stake,
        uint256 x402Spend,
        int256 net
    ) external onlyOperator {
        emit Verdict(caseId, juror, result, ruling, stake, x402Spend, net);
    }

    /// Mirrors a juror's cumulative totals immediately after the case named by `caseId` settled on Hedera.
    function recordReturnCheckpoint(uint256 caseId, address juror, int256 cumulativeNet, uint256 cumulativeCapital)
        external
        onlyOperator
    {
        emit ReturnCheckpoint(caseId, juror, cumulativeNet, cumulativeCapital);
    }

    /// Mirrors a dividend declaration from `JurorShareDistributor.declare()` on Hedera.
    function recordDistributionDeclared(address juror, uint256 dividendId, uint256 amount, uint256 amountPerUnit)
        external
        onlyOperator
    {
        emit Distribution(juror, dividendId, DistributionKind.Declared, address(0), amount, amountPerUnit);
    }

    /// Mirrors one holder's claim from `JurorShareDistributor.claim()` on Hedera.
    function recordDistributionClaimed(address juror, uint256 dividendId, address holder, uint256 amount)
        external
        onlyOperator
    {
        if (holder == address(0)) revert ZeroAddress();
        emit Distribution(juror, dividendId, DistributionKind.Claimed, holder, amount, 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {JurorTreasury} from "./JurorTreasury.sol";

/// Runs Nyaya cases: jurors commit hidden rulings with stakes, reveal them, and are graded against the
/// operator-submitted outcome in a stake-weighted parimutuel. Amounts are in tinybars on Hedera.
contract NyayaResolver {
    /// `None` is the zero value and can never be revealed. The agent hashes this enum's index, so never reorder it.
    enum Ruling {
        None,
        No,
        Yes
    }

    enum BountySource {
        External,
        CaseBountyTreasury
    }

    /// Why a juror's case result is what it is. Losses share accounting but keep their cause.
    enum Result {
        Correct,
        Incorrect,
        Unrevealed,
        NoCommitment
    }

    struct Case {
        address opener;
        uint64 commitDeadline;
        uint64 resolutionTime;
        BountySource bountySource;
        Ruling outcome;
        bool settled;
        uint256 bounty;
    }

    struct Commitment {
        bytes32 hash;
        uint256 stake;
        bool revealed;
        Ruling ruling;
        uint16 confidenceBps;
    }

    uint16 public constant MAX_CONFIDENCE_BPS = 10_000;
    uint256 public constant GRACE_PERIOD = 24 hours;
    int256 internal constant BPS = 10_000;
    /// Share of a winning juror's positive net profit paid to its shareholders.
    uint256 public constant SKIM_BPS = 2_000;

    JurorTreasury public immutable treasury;
    address public immutable operator;

    uint256 public caseCount;
    /// Rounding remainders and treasury-sourced refunds. Funds operator-opened cases.
    uint256 public caseBountyTreasury;
    /// Slashed stakes from a case nobody got right, added to the pool of the next case that settles with a winner
    /// and whose commit window was still open when the rollover was last added to.
    uint256 public rolloverPool;
    /// When rolloverPool last grew. A case whose commit deadline is at or before this can't receive it: its jurors
    /// had already locked their stakes without being able to see the larger pool.
    uint64 public rolloverUpdatedAt;

    mapping(uint256 caseId => Case) public cases;
    mapping(uint256 caseId => mapping(address juror => Commitment)) public commitments;
    mapping(uint256 caseId => address[]) internal participants;
    mapping(uint256 caseId => mapping(address juror => bool)) public isParticipant;

    /// Pre-skim track record since genesis: return = cumulativeNet / cumulativeCapital.
    mapping(address juror => int256) public cumulativeNet;
    mapping(address juror => uint256) public cumulativeCapital;

    mapping(address account => uint256) public refundOf;

    /// Skim owed to each juror's shareholders, held here until released to that juror's distribution address.
    mapping(address juror => uint256) public pendingDistribution;
    /// Where a juror's skim goes for payout to its share holders. Set once per juror by the operator.
    mapping(address juror => address) public distributionAddress;

    event CaseOpened(
        uint256 indexed caseId,
        address indexed opener,
        BountySource bountySource,
        uint256 bounty,
        uint64 commitDeadline,
        uint64 resolutionTime,
        string caseType,
        string question
    );
    event Committed(uint256 indexed caseId, address indexed juror, bytes32 commitment, uint256 stake);
    event Revealed(
        uint256 indexed caseId, address indexed juror, Ruling ruling, uint16 confidenceBps, string evidenceCid
    );
    event OutcomeSubmitted(uint256 indexed caseId, Ruling outcome, string evidenceCid);
    event JurorSettled(
        uint256 indexed caseId,
        address indexed juror,
        Result result,
        uint256 stake,
        uint256 x402Spend,
        uint256 reward,
        int256 net,
        uint256 capital
    );
    event CaseSettled(
        uint256 indexed caseId,
        Ruling outcome,
        uint256 pool,
        uint256 correctStake,
        uint256 remainderToCaseBountyTreasury,
        uint256 rolledIn,
        uint256 rolledOut
    );
    event RefundCredited(address indexed account, uint256 indexed caseId, uint256 amount);
    event RefundWithdrawn(address indexed account, uint256 amount);
    /// `retainedNet` is net minus skim: what the juror keeps. The recorded track record stays pre-skim.
    /// Alert signal. Agents always commit after spending on a case, so recorded spend with no commitment
    /// can only mean an agent bug: a crash, a missed deadline, or a failed transaction.
    event SpentWithoutCommitting(uint256 indexed caseId, address indexed juror, uint256 x402Spend);
    event Skimmed(uint256 indexed caseId, address indexed juror, uint256 skim, int256 retainedNet);
    event DistributionAddressSet(address indexed juror, address indexed distributionAddress);
    event DistributionReleased(address indexed juror, address indexed distributionAddress, uint256 amount);

    error ZeroAddress();
    error NotOperator();
    error NotTreasury();
    error NoBounty();
    error BadSchedule();
    error UnknownCase();
    error EvidenceWindowClosed();
    error CommitClosed();
    error AlreadyCommitted();
    error EmptyCommitment();
    error RevealNotOpen();
    error RevealClosed();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidRuling();
    error ConfidenceOutOfRange();
    error EmptyEvidenceCid();
    error CommitmentMismatch();
    error OutcomeWindowNotOpen();
    error OutcomeWindowClosed();
    error OutcomeAlreadySubmitted();
    error OutcomeNotSubmitted();
    error AlreadySettled();
    error NothingToWithdraw();
    error TransferFailed();
    error DistributionAddressAlreadySet();
    error NoDistributionAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(JurorTreasury treasury_, address operator_) {
        if (address(treasury_) == address(0) || operator_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        operator = operator_;
    }

    /// Only the treasury sends HBAR here directly, when it hands over a slashed stake.
    receive() external payable {
        if (msg.sender != address(treasury)) revert NotTreasury();
    }

    // --- opening ---

    /// Permissionless: whoever opens the case attaches the bounty as msg.value.
    function openCase(
        string calldata caseType,
        string calldata question,
        uint64 commitDeadline,
        uint64 resolutionTime
    ) external payable returns (uint256 caseId) {
        if (msg.value == 0) revert NoBounty();
        // forge-lint: disable-next-line(block-timestamp)
        if (commitDeadline <= block.timestamp || resolutionTime <= commitDeadline) revert BadSchedule();
        caseId = ++caseCount;
        Case storage c = cases[caseId];
        c.opener = msg.sender;
        c.commitDeadline = commitDeadline;
        c.resolutionTime = resolutionTime;
        c.bountySource = BountySource.External;
        c.bounty = msg.value;
        emit CaseOpened(
            caseId, msg.sender, BountySource.External, msg.value, commitDeadline, resolutionTime, caseType, question
        );
    }

    // --- juror actions ---

    /// Sends x402 money to the caller's hot wallet. The treasury records it as spend on this case at this moment.
    function withdrawForEvidence(uint256 caseId, uint256 amount) external {
        Case storage c = _case(caseId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.commitDeadline) revert EvidenceWindowClosed();
        _join(caseId, msg.sender);
        treasury.withdrawForX402(msg.sender, caseId, amount);
    }

    /// The caller is the juror. The stake is locked in its JurorTreasury balance, so an unregistered caller reverts there.
    function commit(uint256 caseId, bytes32 commitment, uint256 stake) external {
        Case storage c = _case(caseId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.commitDeadline) revert CommitClosed();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        Commitment storage slot = commitments[caseId][msg.sender];
        if (slot.hash != bytes32(0)) revert AlreadyCommitted();
        slot.hash = commitment;
        slot.stake = stake;
        _join(caseId, msg.sender);
        emit Committed(caseId, msg.sender, commitment, stake);
        treasury.lockStake(msg.sender, caseId, stake);
    }

    /// The hash is recomputed with msg.sender as the juror, so a commitment copied from another juror can never match.
    function reveal(uint256 caseId, Ruling ruling, uint16 confidenceBps, bytes32 salt, string calldata evidenceCid)
        external
    {
        Case storage c = _case(caseId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < c.commitDeadline) revert RevealNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.resolutionTime) revert RevealClosed();
        Commitment storage slot = commitments[caseId][msg.sender];
        if (slot.hash == bytes32(0)) revert NotCommitted();
        if (slot.revealed) revert AlreadyRevealed();
        if (ruling == Ruling.None) revert InvalidRuling();
        if (confidenceBps > MAX_CONFIDENCE_BPS) revert ConfidenceOutOfRange();
        if (bytes(evidenceCid).length == 0) revert EmptyEvidenceCid();
        if (commitmentFor(caseId, msg.sender, ruling, confidenceBps, salt) != slot.hash) revert CommitmentMismatch();

        slot.revealed = true;
        slot.ruling = ruling;
        slot.confidenceBps = confidenceBps;
        emit Revealed(caseId, msg.sender, ruling, confidenceBps, evidenceCid);
    }

    // --- resolution and settlement ---

    /// Accepted only in [resolutionTime, resolutionTime + GRACE_PERIOD). After that it always reverts, even for the
    /// operator, so a late outcome can never race a cancellation.
    function submitOutcome(uint256 caseId, Ruling outcome, string calldata evidenceCid) external onlyOperator {
        Case storage c = _case(caseId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < c.resolutionTime) revert OutcomeWindowNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.resolutionTime + GRACE_PERIOD) revert OutcomeWindowClosed();
        if (c.outcome != Ruling.None) revert OutcomeAlreadySubmitted();
        if (outcome == Ruling.None) revert InvalidRuling();
        if (bytes(evidenceCid).length == 0) revert EmptyEvidenceCid();
        c.outcome = outcome;
        emit OutcomeSubmitted(caseId, outcome, evidenceCid);
    }

    /// Anyone can settle once the outcome is in. Reveals are already closed, because the outcome window
    /// opens at the resolution time and reveals end there. Events here follow calls into our own treasury,
    /// which never hands control to outside code, and `settled` is set before any call.
    function settle(uint256 caseId) external {
        Case storage c = _case(caseId);
        if (c.outcome == Ruling.None) revert OutcomeNotSubmitted();
        if (c.settled) revert AlreadySettled();
        c.settled = true;

        (uint256 slashed, uint256 correctStake) = _gradeAndSlash(caseId, c.outcome);

        if (correctStake == 0) {
            if (slashed > 0) {
                rolloverPool += slashed;
                // forge-lint: disable-next-line(unsafe-typecast)
                rolloverUpdatedAt = uint64(block.timestamp);
            }
            _returnBounty(caseId, c);
            // forge-lint: disable-next-line(reentrancy-events)
            emit CaseSettled(caseId, c.outcome, 0, 0, 0, 0, slashed);
            return;
        }

        uint256 rolledIn = c.commitDeadline > rolloverUpdatedAt ? rolloverPool : 0;
        rolloverPool -= rolledIn;
        uint256 pool = c.bounty + slashed + rolledIn;
        uint256 remainder = pool - _payCorrect(caseId, c.outcome, pool, correctStake);
        caseBountyTreasury += remainder;
        // forge-lint: disable-next-line(reentrancy-events)
        emit CaseSettled(caseId, c.outcome, pool, correctStake, remainder, rolledIn, 0);
    }

    function setDistributionAddress(address juror, address to) external onlyOperator {
        if (juror == address(0) || to == address(0)) revert ZeroAddress();
        if (distributionAddress[juror] != address(0)) revert DistributionAddressAlreadySet();
        distributionAddress[juror] = to;
        emit DistributionAddressSet(juror, to);
    }

    /// Permissionless: the money can only go to the juror's fixed distribution address.
    function releaseDistribution(address juror) external {
        address to = distributionAddress[juror];
        if (to == address(0)) revert NoDistributionAddress();
        uint256 amount = pendingDistribution[juror];
        if (amount == 0) revert NothingToWithdraw();
        pendingDistribution[juror] = 0;
        emit DistributionReleased(juror, to, amount);
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawRefund() external {
        uint256 amount = refundOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        refundOf[msg.sender] = 0;
        emit RefundWithdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // --- views ---

    /// The exact preimage jurors must hash off-chain. Exposed so agents can check their encoding with an eth_call.
    function commitmentFor(uint256 caseId, address juror, Ruling ruling, uint16 confidenceBps, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(caseId, juror, ruling, confidenceBps, salt));
    }

    /// Cumulative pre-skim return in basis points, rounded toward zero. What the bonding curve reads.
    function returnBps(address juror) external view returns (int256) {
        uint256 capital = cumulativeCapital[juror];
        if (capital == 0) return 0;
        // forge-lint: disable-next-line(unsafe-typecast)
        return cumulativeNet[juror] * BPS / int256(capital);
    }

    function participantsOf(uint256 caseId) external view returns (address[] memory) {
        return participants[caseId];
    }

    // --- internals ---

    /// Pass 1: slash every committed juror that is wrong or unrevealed, and total the correct stake.
    /// Loops are bounded by the operator-registered jurors, and every call goes to our own treasury.
    function _gradeAndSlash(uint256 caseId, Ruling outcome) private returns (uint256 slashed, uint256 correctStake) {
        address[] storage jurors = participants[caseId];
        for (uint256 i = 0; i < jurors.length; ++i) {
            address juror = jurors[i];
            Commitment storage cm = commitments[caseId][juror];
            if (cm.hash == bytes32(0)) {
                _record(caseId, juror, Result.NoCommitment, 0, 0);
            } else if (cm.revealed && cm.ruling == outcome) {
                correctStake += cm.stake;
            } else {
                // forge-lint: disable-next-line(calls-loop)
                slashed += treasury.slashStake(juror, caseId);
                _record(caseId, juror, cm.revealed ? Result.Incorrect : Result.Unrevealed, cm.stake, 0);
            }
        }
    }

    /// Pass 2: return each correct juror's stake and pay its pro-rata reward, rounded down to the tinybar.
    function _payCorrect(uint256 caseId, Ruling outcome, uint256 pool, uint256 correctStake)
        private
        returns (uint256 paid)
    {
        address[] storage jurors = participants[caseId];
        for (uint256 i = 0; i < jurors.length; ++i) {
            address juror = jurors[i];
            Commitment storage cm = commitments[caseId][juror];
            if (!cm.revealed || cm.ruling != outcome) continue;
            uint256 reward = pool * cm.stake / correctStake;
            paid += reward;
            _payWinner(caseId, juror, cm.stake, reward);
        }
    }

    /// Records the pre-skim result first, then takes the skim from what is paid out. The skim is
    /// floor(net × 20%) on positive net only, and the juror keeps exactly reward − skim, so skim and retained
    /// always add back to the full reward and net.
    function _payWinner(uint256 caseId, address juror, uint256 stake, uint256 reward) private {
        int256 net = _record(caseId, juror, Result.Correct, stake, reward);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 skim = net > 0 ? uint256(net) * SKIM_BPS / 10_000 : 0;
        if (skim > 0) {
            pendingDistribution[juror] += skim;
            // forge-lint: disable-next-line(unsafe-typecast, reentrancy-events)
            emit Skimmed(caseId, juror, skim, net - int256(skim));
        }
        // forge-lint: disable-next-line(calls-loop, unused-return)
        treasury.unlockStake(juror, caseId);
        // forge-lint: disable-next-line(calls-loop)
        if (reward > skim) treasury.fund{value: reward - skim}(juror);
    }

    /// Spend is read from the treasury's case-tagged withdrawals, never from anything the juror submitted.
    /// Returns the pre-skim net, which is what the track record stores.
    function _record(uint256 caseId, address juror, Result result, uint256 stake, uint256 reward)
        private
        returns (int256 net)
    {
        // forge-lint: disable-next-line(calls-loop)
        uint256 spend = treasury.x402Spend(juror, caseId);
        // Amounts are bounded by total HBAR supply (under 2^63 tinybars), so these casts cannot overflow.
        // forge-lint: disable-next-line(unsafe-typecast)
        net = result == Result.Correct ? int256(reward) - int256(spend) : -int256(stake) - int256(spend);
        cumulativeNet[juror] += net;
        cumulativeCapital[juror] += stake + spend;
        // forge-lint: disable-next-line(reentrancy-events)
        emit JurorSettled(caseId, juror, result, stake, spend, reward, net, stake + spend);
        if (result == Result.NoCommitment) {
            // forge-lint: disable-next-line(reentrancy-events)
            emit SpentWithoutCommitting(caseId, juror, spend);
        }
    }

    function _returnBounty(uint256 caseId, Case storage c) private {
        if (c.bountySource == BountySource.CaseBountyTreasury) {
            caseBountyTreasury += c.bounty;
        } else {
            refundOf[c.opener] += c.bounty;
            // forge-lint: disable-next-line(reentrancy-events)
            emit RefundCredited(c.opener, caseId, c.bounty);
        }
    }

    function _join(uint256 caseId, address juror) private {
        if (isParticipant[caseId][juror]) return;
        isParticipant[caseId][juror] = true;
        participants[caseId].push(juror);
    }

    function _case(uint256 caseId) private view returns (Case storage c) {
        c = cases[caseId];
        if (c.opener == address(0)) revert UnknownCase();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {JurorTreasury} from "./JurorTreasury.sol";

/// Runs Nyaya cases: every registered juror commits a hidden ruling with a stake, then reveals it.
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

    struct Case {
        address opener;
        uint64 commitDeadline;
        uint64 resolutionTime;
        BountySource bountySource;
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

    JurorTreasury public immutable treasury;
    uint256 public caseCount;

    mapping(uint256 caseId => Case) public cases;
    mapping(uint256 caseId => mapping(address juror => Commitment)) public commitments;

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

    error ZeroAddress();
    error NoBounty();
    error BadSchedule();
    error UnknownCase();
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

    constructor(JurorTreasury treasury_) {
        if (address(treasury_) == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

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
        cases[caseId] = Case({
            opener: msg.sender,
            commitDeadline: commitDeadline,
            resolutionTime: resolutionTime,
            bountySource: BountySource.External,
            bounty: msg.value
        });
        emit CaseOpened(
            caseId, msg.sender, BountySource.External, msg.value, commitDeadline, resolutionTime, caseType, question
        );
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

    /// The exact preimage jurors must hash off-chain. Exposed so agents can check their encoding with an eth_call.
    function commitmentFor(uint256 caseId, address juror, Ruling ruling, uint16 confidenceBps, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(caseId, juror, ruling, confidenceBps, salt));
    }

    function _case(uint256 caseId) private view returns (Case storage c) {
        c = cases[caseId];
        if (c.opener == address(0)) revert UnknownCase();
    }
}

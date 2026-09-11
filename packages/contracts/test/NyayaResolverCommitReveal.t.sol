// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";

contract NyayaResolverCommitRevealTest is Test {
    JurorTreasury internal treasury;
    NyayaResolver internal resolver;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal jurorA = makeAddr("jurorA");
    address internal jurorB = makeAddr("jurorB");
    address internal jurorC = makeAddr("jurorC");

    uint64 internal commitDeadline;
    uint64 internal resolutionTime;
    uint256 internal caseId;

    bytes32 internal constant SALT_A = keccak256("salt-a");
    string internal constant CID_A = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    event Revealed(
        uint256 indexed caseId,
        address indexed juror,
        NyayaResolver.Ruling ruling,
        uint16 confidenceBps,
        string evidenceCid
    );

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 ether, 1 hours);
        resolver = new NyayaResolver(treasury);

        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, makeAddr("jurorAHot"));
        treasury.registerJuror(jurorB, makeAddr("jurorBHot"));
        treasury.registerJuror(jurorC, makeAddr("jurorCHot"));
        vm.stopPrank();

        address[3] memory all = [jurorA, jurorB, jurorC];
        for (uint256 i; i < all.length; ++i) {
            vm.deal(address(this), 100 ether);
            treasury.fund{value: 100 ether}(all[i]);
        }

        caseId = _openCase();
    }

    function _openCase() internal returns (uint256 id) {
        commitDeadline = uint64(block.timestamp + 1 hours);
        resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, 20 ether);
        vm.prank(opener);
        id = resolver.openCase{value: 20 ether}(
            "github-stars", "Will foundry-rs/foundry reach 10k stars?", commitDeadline, resolutionTime
        );
    }

    /// Computed independently of the contract, the way an agent would.
    function _hash(uint256 id, address juror, NyayaResolver.Ruling ruling, uint16 conf, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(id, juror, ruling, conf, salt));
    }

    function _commit(address juror, bytes32 commitment, uint256 stake) internal {
        vm.prank(juror);
        resolver.commit(caseId, commitment, stake);
    }

    function _toRevealWindow() internal {
        vm.warp(commitDeadline);
    }

    // --- the attack commit-reveal exists to close ---

    function test_CopiedCommitmentCannotBeRevealedByAnotherJuror() public {
        bytes32 hashA = _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A);
        _commit(jurorA, hashA, 50 ether);
        _commit(jurorB, hashA, 10 ether); // B copies A's commitment verbatim

        _toRevealWindow();
        vm.prank(jurorA);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);

        // A's preimage is now public. B replays it exactly and still fails, because the hash is rebuilt with B's address.
        vm.prank(jurorB);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);

        (,, bool bRevealed,,) = resolver.commitments(caseId, jurorB);
        assertFalse(bRevealed, "B stays unrevealed, so settlement will slash it");
        (,, bool aRevealed,,) = resolver.commitments(caseId, jurorA);
        assertTrue(aRevealed);
    }

    function testFuzz_CopiedCommitmentFailsForAnyRevealValues(uint8 rulingRaw, uint16 conf, bytes32 salt) public {
        NyayaResolver.Ruling ruling = NyayaResolver.Ruling(bound(rulingRaw, 1, 2));
        conf = uint16(bound(conf, 0, 10_000));
        bytes32 hashA = _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A);
        _commit(jurorB, hashA, 10 ether);

        _toRevealWindow();
        vm.prank(jurorB);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(caseId, ruling, conf, salt, CID_A);
    }

    function test_CommitmentFromAnotherCaseCannotBeRevealed() public {
        bytes32 hashForCase1 = _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A);
        uint256 case2 = _openCase();
        vm.prank(jurorA);
        resolver.commit(case2, hashForCase1, 5 ether);

        vm.warp(commitDeadline);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(case2, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
    }

    // --- honest path ---

    function test_OwnCommitmentRevealsAndRecordsRulingAndCid() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.No, 6500, SALT_A), 50 ether);
        _toRevealWindow();

        vm.expectEmit(address(resolver));
        emit Revealed(caseId, jurorA, NyayaResolver.Ruling.No, 6500, CID_A);
        vm.prank(jurorA);
        resolver.reveal(caseId, NyayaResolver.Ruling.No, 6500, SALT_A, CID_A);

        (bytes32 hash, uint256 stake, bool revealed, NyayaResolver.Ruling ruling, uint16 conf) =
            resolver.commitments(caseId, jurorA);
        assertEq(hash, _hash(caseId, jurorA, NyayaResolver.Ruling.No, 6500, SALT_A));
        assertEq(stake, 50 ether);
        assertTrue(revealed);
        assertEq(uint8(ruling), uint8(NyayaResolver.Ruling.No));
        assertEq(conf, 6500);
    }

    function test_ContractHashMatchesAgentSideEncoding() public view {
        assertEq(
            resolver.commitmentFor(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A),
            _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A)
        );
    }

    function test_CommitLocksStakeInJurorTreasury() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A), 50 ether);
        assertEq(treasury.lockedStake(jurorA, caseId), 50 ether);
        assertEq(treasury.balanceOf(jurorA), 50 ether);
    }

    // --- reveal must match the commitment exactly ---

    function test_WrongRulingSaltOrConfidenceFailsToReveal() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A), 50 ether);
        _toRevealWindow();
        vm.startPrank(jurorA);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.No, 8000, SALT_A, CID_A);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 7999, SALT_A, CID_A);
        vm.expectRevert(NyayaResolver.CommitmentMismatch.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, keccak256("other"), CID_A);
        vm.stopPrank();
    }

    function test_RevealRejectsNoneRulingOutOfRangeConfidenceAndEmptyCid() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.None, 8000, SALT_A), 50 ether);
        _toRevealWindow();
        vm.startPrank(jurorA);
        vm.expectRevert(NyayaResolver.InvalidRuling.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.None, 8000, SALT_A, CID_A);
        vm.expectRevert(NyayaResolver.ConfidenceOutOfRange.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 10_001, SALT_A, CID_A);
        vm.expectRevert(NyayaResolver.EmptyEvidenceCid.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, "");
        vm.stopPrank();
    }

    function test_CannotRevealTwice() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A), 50 ether);
        _toRevealWindow();
        vm.startPrank(jurorA);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
        vm.expectRevert(NyayaResolver.AlreadyRevealed.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
        vm.stopPrank();
    }

    // --- timing ---

    function test_CommitClosesAtCommitDeadline() public {
        vm.warp(commitDeadline);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.CommitClosed.selector);
        resolver.commit(caseId, keccak256("late"), 1 ether);
    }

    function test_RevealBeforeCommitDeadlineReverts() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A), 50 ether);
        vm.warp(commitDeadline - 1);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.RevealNotOpen.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
    }

    function test_RevealClosesAtResolutionTime() public {
        _commit(jurorA, _hash(caseId, jurorA, NyayaResolver.Ruling.Yes, 8000, SALT_A), 50 ether);
        vm.warp(resolutionTime);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.RevealClosed.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
    }

    // --- commit guards ---

    function test_CannotCommitTwiceToTheSameCase() public {
        _commit(jurorA, keccak256("first"), 10 ether);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.AlreadyCommitted.selector);
        resolver.commit(caseId, keccak256("second"), 10 ether);
    }

    function test_UnregisteredCallerCannotCommit() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(JurorTreasury.UnknownJuror.selector);
        resolver.commit(caseId, keccak256("x"), 1 ether);
    }

    function test_RevealWithoutCommitmentReverts() public {
        _toRevealWindow();
        vm.prank(jurorC);
        vm.expectRevert(NyayaResolver.NotCommitted.selector);
        resolver.reveal(caseId, NyayaResolver.Ruling.Yes, 8000, SALT_A, CID_A);
    }

    function test_CommitToUnknownCaseReverts() public {
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.UnknownCase.selector);
        resolver.commit(999, keccak256("x"), 1 ether);
    }

    // --- case opening basics this step relies on ---

    function test_OpenCaseRequiresBountyAndSaneSchedule() public {
        vm.deal(opener, 1 ether);
        vm.startPrank(opener);
        vm.expectRevert(NyayaResolver.NoBounty.selector);
        resolver.openCase("t", "q", uint64(block.timestamp + 1), uint64(block.timestamp + 2));
        vm.expectRevert(NyayaResolver.BadSchedule.selector);
        resolver.openCase{value: 1 ether}("t", "q", uint64(block.timestamp + 2), uint64(block.timestamp + 2));
        vm.stopPrank();
    }
}

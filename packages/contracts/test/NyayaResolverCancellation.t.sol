// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";

contract NyayaResolverCancellationTest is Test {
    uint256 internal constant HBAR = 1e8;

    JurorTreasury internal treasury;
    NyayaResolver internal resolver;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal stranger = makeAddr("stranger");
    address internal jurorA = makeAddr("jurorA");
    address internal jurorB = makeAddr("jurorB");
    address internal jurorC = makeAddr("jurorC");

    uint64 internal commitDeadline;
    uint64 internal resolutionTime;
    string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 * HBAR, 1 hours);
        resolver = new NyayaResolver(treasury, operator);
        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, makeAddr("hotA"));
        treasury.registerJuror(jurorB, makeAddr("hotB"));
        treasury.registerJuror(jurorC, makeAddr("hotC"));
        vm.stopPrank();

        vm.deal(address(this), 300 * HBAR);
        treasury.fund{value: 100 * HBAR}(jurorA);
        treasury.fund{value: 100 * HBAR}(jurorB);
        treasury.fund{value: 100 * HBAR}(jurorC);
    }

    function _openCase(uint256 bounty) internal returns (uint256 id) {
        commitDeadline = uint64(block.timestamp + 1 hours);
        resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, bounty);
        vm.prank(opener);
        id = resolver.openCase{value: bounty}("github-stars", "q", commitDeadline, resolutionTime);
    }

    function _commit(uint256 id, address juror, NyayaResolver.Ruling ruling, uint256 stake) internal {
        bytes32 h = keccak256(abi.encode(id, juror, ruling, uint16(7000), keccak256(abi.encode(juror))));
        vm.prank(juror);
        resolver.commit(id, h, stake);
    }

    function _reveal(uint256 id, address juror, NyayaResolver.Ruling ruling) internal {
        vm.prank(juror);
        resolver.reveal(id, ruling, 7000, keccak256(abi.encode(juror)), CID);
    }

    function _graceEnd() internal view returns (uint256) {
        return resolutionTime + resolver.GRACE_PERIOD();
    }

    // --- the core of it ---

    /// The distinction cancellation exists for: a juror that never revealed is refunded here, but forfeits its
    /// stake in a normal settlement. Same juror behaviour, opposite consequence, decided by whose failure it was.
    function test_CancellationRefundsEveryCommittedJurorIncludingNonRevealers() public {
        uint256 id = _openCase(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(id, jurorB, NyayaResolver.Ruling.No, 5 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes); // A reveals, B never does

        uint256 aBefore = treasury.balanceOf(jurorA);
        uint256 bBefore = treasury.balanceOf(jurorB);

        vm.warp(_graceEnd());
        vm.prank(stranger); // anyone, not just the operator
        resolver.cancel(id);

        assertEq(treasury.balanceOf(jurorA) - aBefore, 10 * HBAR, "the revealer got its whole stake back");
        assertEq(treasury.balanceOf(jurorB) - bBefore, 5 * HBAR, "so did the juror that never revealed");
        assertEq(treasury.lockedStake(jurorA, id), 0);
        assertEq(treasury.lockedStake(jurorB, id), 0);
        assertEq(resolver.refundOf(opener), 20 * HBAR, "the bounty went back to its source");
    }

    function test_ANonRevealerForfeitsItsStakeWhenTheCaseIsActuallyResolved() public {
        uint256 id = _openCase(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(id, jurorB, NyayaResolver.Ruling.No, 5 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);

        uint256 bBefore = treasury.balanceOf(jurorB);
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);
        resolver.settle(id);

        assertEq(treasury.balanceOf(jurorB), bBefore, "the non-revealer lost its stake, unlike under cancellation");
    }

    function test_CancellationRecordsOnlyTheEvidenceSpendAsALoss() public {
        uint256 id = _openCase(20 * HBAR);
        vm.prank(jurorA);
        resolver.withdrawForEvidence(id, 2 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);

        vm.warp(_graceEnd());
        resolver.cancel(id);

        assertEq(resolver.cumulativeNet(jurorA), -2 * int256(HBAR), "net is minus the spend, not the stake");
        assertEq(resolver.cumulativeCapital(jurorA), 2 * HBAR, "and the stake is not counted as deployed");
        assertEq(resolver.returnBps(jurorA), -10_000);
    }

    /// The mirror case, a cancelled treasury-funded bounty, lives in `NyayaResolverBountySources.t.sol`
    /// alongside the rest of the per-source refund assertions.
    function test_CancellingAnExternalCaseLeavesTheCaseBountyTreasuryAlone() public {
        // Fund the Case Bounty Treasury the way a share-trade fee would.
        vm.deal(address(this), 20 * HBAR);
        resolver.contributeToCaseBountyTreasury{value: 20 * HBAR}();
        uint256 id = _openCase(20 * HBAR); // externally funded, for comparison
        vm.warp(_graceEnd());
        resolver.cancel(id);
        assertEq(resolver.refundOf(opener), 20 * HBAR, "an external bounty returns to the opener, not the treasury");
        assertEq(resolver.caseBountyTreasury(), 20 * HBAR, "the treasury balance is untouched by that refund");
    }

    // --- guards ---

    function test_CannotCancelBeforeTheGracePeriodEnds() public {
        uint256 id = _openCase(20 * HBAR);
        vm.warp(_graceEnd() - 1);
        vm.expectRevert(NyayaResolver.GracePeriodNotOver.selector);
        resolver.cancel(id);
    }

    function test_CannotCancelACaseThatHasAnOutcome() public {
        uint256 id = _openCase(20 * HBAR);
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);

        vm.warp(_graceEnd());
        vm.expectRevert(NyayaResolver.OutcomeAlreadySubmitted.selector);
        resolver.cancel(id);
    }

    function test_CannotCancelTwiceAndCannotSettleAfterwards() public {
        uint256 id = _openCase(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        vm.warp(_graceEnd());
        resolver.cancel(id);

        vm.expectRevert(NyayaResolver.AlreadyCancelled.selector);
        resolver.cancel(id);
        vm.expectRevert(NyayaResolver.OutcomeNotSubmitted.selector);
        resolver.settle(id);
    }

    /// The hard close is what makes cancellation the only remaining path, so it cannot race a late outcome.
    function test_SubmitOutcomeRevertsOnceTheGracePeriodHasPassed() public {
        uint256 id = _openCase(20 * HBAR);
        vm.warp(_graceEnd());
        vm.prank(operator);
        vm.expectRevert(NyayaResolver.OutcomeWindowClosed.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);
    }
}

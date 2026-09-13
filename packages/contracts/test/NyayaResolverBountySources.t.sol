// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";

/// The two ways a case is funded, and where each one's bounty goes back to when the case does not pay out.
/// A refund destination is exactly the kind of branch that works for one source and silently misroutes the
/// other, so every destination assertion here is made per source, never once for "the refund".
contract NyayaResolverBountySourcesTest is Test {
    uint256 internal constant HBAR = 1e8;
    uint16 internal constant CONFIDENCE_BPS = 7000;

    JurorTreasury internal treasury;
    NyayaResolver internal resolver;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal stranger = makeAddr("stranger");
    address internal jurorA = makeAddr("jurorA");
    address internal jurorB = makeAddr("jurorB");
    address internal hotA = makeAddr("jurorAHot");
    address internal hotB = makeAddr("jurorBHot");
    address internal payoutA = makeAddr("jurorAShareholders");

    uint64 internal commitDeadline;
    uint64 internal resolutionTime;

    string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    /// Everything ever paid into the two contracts, tracked by the test so conservation is checked against
    /// what was deposited rather than against a figure the contracts themselves report.
    uint256 internal paidIn;

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 * HBAR, 1 hours);
        resolver = new NyayaResolver(treasury, operator);

        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, hotA);
        treasury.registerJuror(jurorB, hotB);
        resolver.setDistributionAddress(jurorA, payoutA);
        vm.stopPrank();

        _fundJuror(jurorA, 100 * HBAR);
        _fundJuror(jurorB, 100 * HBAR);
    }

    // --- helpers ---

    function _fundJuror(address juror, uint256 amount) internal {
        vm.deal(address(this), amount);
        treasury.fund{value: amount}(juror);
        paidIn += amount;
    }

    /// Share-trade fees arrive this way, and are the reason the Case Bounty Treasury holds anything at all.
    function _contribute(uint256 amount) internal {
        vm.deal(address(this), amount);
        resolver.contributeToCaseBountyTreasury{value: amount}();
        paidIn += amount;
    }

    function _schedule() internal {
        commitDeadline = uint64(block.timestamp + 1 hours);
        resolutionTime = uint64(block.timestamp + 2 hours);
    }

    function _openExternal(uint256 bounty) internal returns (uint256 id) {
        _schedule();
        vm.deal(opener, bounty);
        vm.prank(opener);
        id = resolver.openCase{value: bounty}("github-stars", "q", commitDeadline, resolutionTime);
        paidIn += bounty;
    }

    function _openFromTreasury(uint256 bounty) internal returns (uint256 id) {
        _schedule();
        vm.prank(operator);
        id = resolver.openCaseFromTreasury("github-stars", "q", commitDeadline, resolutionTime, bounty);
    }

    function _salt(address juror) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", juror));
    }

    function _commit(uint256 id, address juror, NyayaResolver.Ruling ruling, uint256 stake) internal {
        bytes32 h = keccak256(abi.encode(id, juror, ruling, CONFIDENCE_BPS, _salt(juror)));
        vm.prank(juror);
        resolver.commit(id, h, stake);
    }

    function _reveal(uint256 id, address juror, NyayaResolver.Ruling ruling) internal {
        vm.prank(juror);
        resolver.reveal(id, ruling, CONFIDENCE_BPS, _salt(juror), CID);
    }

    function _resolve(uint256 id, NyayaResolver.Ruling outcome) internal {
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, outcome, CID);
    }

    function _graceEnd() internal view returns (uint256) {
        return resolutionTime + resolver.GRACE_PERIOD();
    }

    function _sourceOf(uint256 id) internal view returns (NyayaResolver.BountySource source) {
        (,,, source,,,,) = resolver.cases(id);
    }

    function _bountyOf(uint256 id) internal view returns (uint256 bounty) {
        (,,,,,,, bounty) = resolver.cases(id);
    }

    // --- both paths open a case ---

    function test_BothFundingPathsOpenACaseAndTagItsSource() public {
        _contribute(30 * HBAR);

        vm.expectEmit(true, true, false, true, address(resolver));
        emit NyayaResolver.CaseOpened(
            1,
            opener,
            NyayaResolver.BountySource.External,
            20 * HBAR,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            "github-stars",
            "q"
        );
        uint256 external_ = _openExternal(20 * HBAR);

        vm.expectEmit(true, true, false, true, address(resolver));
        emit NyayaResolver.CaseOpened(
            2,
            operator,
            NyayaResolver.BountySource.CaseBountyTreasury,
            12 * HBAR,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            "github-stars",
            "q"
        );
        uint256 funded = _openFromTreasury(12 * HBAR);

        assertTrue(_sourceOf(external_) == NyayaResolver.BountySource.External, "external case tagged External");
        assertTrue(
            _sourceOf(funded) == NyayaResolver.BountySource.CaseBountyTreasury,
            "operator case tagged CaseBountyTreasury"
        );
        assertEq(_bountyOf(external_), 20 * HBAR);
        assertEq(_bountyOf(funded), 12 * HBAR);
        assertEq(resolver.caseBountyTreasury(), 18 * HBAR, "the treasury paid for its own case");

        // End to end: both settle with a correct juror, so a treasury-funded bounty really does reach a juror.
        _commit(external_, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(funded, jurorB, NyayaResolver.Ruling.Yes, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(external_, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(funded, jurorB, NyayaResolver.Ruling.Yes);

        uint256 aBefore = treasury.balanceOf(jurorA);
        uint256 bBefore = treasury.balanceOf(jurorB);
        _resolve(external_, NyayaResolver.Ruling.Yes);
        vm.prank(operator);
        resolver.submitOutcome(funded, NyayaResolver.Ruling.Yes, CID);
        resolver.settle(external_);
        resolver.settle(funded);

        // Sole correct juror on each case: pool is the bounty, reward is the bounty, skim is 20% of it.
        assertEq(treasury.balanceOf(jurorA) - aBefore, 10 * HBAR + 16 * HBAR, "stake back plus reward less skim");
        assertEq(treasury.balanceOf(jurorB) - bBefore, 10 * HBAR + 96 * HBAR / 10, "same, from the treasury-funded pot");
        assertEq(resolver.pendingDistribution(jurorA), 4 * HBAR);
        assertEq(resolver.pendingDistribution(jurorB), 24 * HBAR / 10);
    }

    // --- cancellation, per source ---

    function test_CancellationRefundsAnExternalBountyToTheOpener() public {
        _contribute(30 * HBAR);
        uint256 id = _openExternal(20 * HBAR);
        vm.warp(_graceEnd());

        // The refund's destination is announced, not merely reachable through a view.
        vm.expectEmit(true, true, false, true, address(resolver));
        emit NyayaResolver.RefundCredited(opener, id, 20 * HBAR);
        vm.expectEmit(true, false, false, true, address(resolver));
        emit NyayaResolver.CaseCancelled(id, 0, 20 * HBAR);
        vm.prank(stranger); // not the opener, and not the operator
        resolver.cancel(id);

        assertEq(resolver.refundOf(opener), 20 * HBAR, "credited to the opener");
        assertEq(resolver.refundOf(stranger), 0, "never to whoever called cancel");
        assertEq(resolver.caseBountyTreasury(), 30 * HBAR, "and never into the Case Bounty Treasury");

        uint256 before = opener.balance;
        vm.prank(opener);
        resolver.withdrawRefund();
        assertEq(opener.balance - before, 20 * HBAR, "pulled, not pushed");
    }

    function test_CancellationReturnsATreasuryBountyToTheCaseBountyTreasury() public {
        _contribute(30 * HBAR);
        uint256 id = _openFromTreasury(12 * HBAR);
        assertEq(resolver.caseBountyTreasury(), 18 * HBAR);

        vm.warp(_graceEnd());

        // Same cancellation, and deliberately no RefundCredited: nobody is owed a pull for this one.
        vm.recordLogs();
        vm.expectEmit(true, false, false, true, address(resolver));
        emit NyayaResolver.CaseCancelled(id, 0, 12 * HBAR);
        vm.prank(stranger);
        resolver.cancel(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(
                logs[i].topics[0] != NyayaResolver.RefundCredited.selector,
                "a treasury-funded bounty must never credit anyone a withdrawable refund"
            );
        }

        assertEq(resolver.caseBountyTreasury(), 30 * HBAR, "the whole bounty came back to the treasury");
        assertEq(resolver.refundOf(operator), 0, "the operator opened it but never owned the money");
        assertEq(resolver.refundOf(stranger), 0);
    }

    // --- settlement with no correct juror, per source ---

    function test_NoCorrectJurorReturnsAnExternalBountyToTheOpener() public {
        uint256 id = _openExternal(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.No, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
        resolver.settle(id);

        assertEq(resolver.refundOf(opener), 20 * HBAR, "bounty back to the opener");
        assertEq(resolver.caseBountyTreasury(), 0, "the bounty did not land in the treasury");
        assertEq(resolver.rolloverPool(), 10 * HBAR, "only the slashed stake rolls over");
    }

    function test_NoCorrectJurorReturnsATreasuryBountyToTheCaseBountyTreasury() public {
        _contribute(30 * HBAR);
        uint256 id = _openFromTreasury(12 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.No, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
        resolver.settle(id);

        assertEq(resolver.caseBountyTreasury(), 30 * HBAR, "bounty back where it came from");
        assertEq(resolver.refundOf(operator), 0, "not credited to the caller that opened it");
        assertEq(resolver.rolloverPool(), 10 * HBAR, "the slashed stake still rolls over, as for any source");
    }

    // --- guards on the treasury-funded path ---

    function test_TreasuryFundedCaseRevertsWhenTheTreasuryIsShortAndOpensNothing() public {
        _contribute(5 * HBAR);
        uint256 countBefore = resolver.caseCount();

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(NyayaResolver.InsufficientCaseBountyTreasury.selector, 5 * HBAR, 6 * HBAR)
        );
        resolver.openCaseFromTreasury(
            "github-stars", "q", uint64(block.timestamp + 1 hours), uint64(block.timestamp + 2 hours), 6 * HBAR
        );

        assertEq(resolver.caseCount(), countBefore, "no case id was consumed");
        assertEq(resolver.caseBountyTreasury(), 5 * HBAR, "and nothing was deducted");
    }

    /// The exact balance is spendable, so the guard is a ceiling and not an off-by-one that strands a tinybar.
    function test_TreasuryFundedCaseCanSpendTheTreasuryDownToZero() public {
        _contribute(5 * HBAR);
        uint256 id = _openFromTreasury(5 * HBAR);
        assertEq(resolver.caseBountyTreasury(), 0);
        assertEq(_bountyOf(id), 5 * HBAR);
    }

    function test_OnlyTheOperatorOpensATreasuryFundedCase() public {
        _contribute(30 * HBAR);
        _schedule();

        vm.prank(stranger);
        vm.expectRevert(NyayaResolver.NotOperator.selector);
        resolver.openCaseFromTreasury("github-stars", "q", commitDeadline, resolutionTime, 12 * HBAR);

        // openCase itself stays permissionless, which is what the operator gate must not have changed.
        vm.deal(stranger, 1 * HBAR);
        vm.prank(stranger);
        resolver.openCase{value: 1 * HBAR}("github-stars", "q", commitDeadline, resolutionTime);
        assertEq(resolver.caseCount(), 1);
    }

    // --- conservation across both paths ---

    /// Every tinybar that entered the two contracts is still inside them or has left through a named exit.
    /// The scenario deliberately mixes the sources: a settled external case, a cancelled external case, and a
    /// cancelled treasury-funded case, so a misrouted refund shows up as a mismatch rather than as a wash.
    function test_NoTinybarIsCreatedOrLostAcrossBothPathsIncludingRefunds() public {
        _contribute(30 * HBAR);

        // 1. An external case that settles with one correct and one incorrect juror.
        uint256 settled = _openExternal(20 * HBAR);
        vm.prank(jurorA);
        resolver.withdrawForEvidence(settled, 5 * HBAR);
        _commit(settled, jurorA, NyayaResolver.Ruling.Yes, 50 * HBAR);
        _commit(settled, jurorB, NyayaResolver.Ruling.No, 30 * HBAR);
        vm.warp(commitDeadline);
        _reveal(settled, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(settled, jurorB, NyayaResolver.Ruling.No);
        _resolve(settled, NyayaResolver.Ruling.Yes);
        resolver.settle(settled);

        // 2. A treasury-funded case and 3. an external case, both abandoned and cancelled.
        uint256 fromTreasury = _openFromTreasury(12 * HBAR);
        uint256 abandoned = _openExternal(7 * HBAR);
        vm.warp(_graceEnd());
        resolver.cancel(fromTreasury);
        resolver.cancel(abandoned);

        // The three ways money leaves: the x402 withdrawal, the opener's pull, and the shareholder skim.
        uint256 paidOut = 5 * HBAR;
        vm.prank(opener);
        resolver.withdrawRefund();
        paidOut += 7 * HBAR;
        uint256 skim = resolver.pendingDistribution(jurorA);
        resolver.releaseDistribution(jurorA);
        paidOut += skim;

        assertEq(hotA.balance, 5 * HBAR, "the evidence withdrawal reached the hot wallet");
        assertEq(opener.balance, 7 * HBAR, "the cancelled external bounty reached the opener");
        assertEq(payoutA.balance, skim, "the skim reached the shareholder payout address");

        // Nothing else left, and nothing appeared.
        assertEq(
            address(resolver).balance + address(treasury).balance,
            paidIn - paidOut,
            "system holdings equal deposits minus the three named exits"
        );

        // Every tinybar the resolver holds is claimed by exactly one of its ledgers. No case is live: one
        // settled and two cancelled, so no bounty is outstanding.
        assertEq(resolver.refundOf(opener), 0);
        assertEq(resolver.pendingDistribution(jurorA), 0);
        assertEq(
            address(resolver).balance,
            resolver.caseBountyTreasury() + resolver.rolloverPool(),
            "the resolver holds exactly its treasury plus its rollover"
        );
        assertEq(
            address(treasury).balance,
            treasury.balanceOf(jurorA) + treasury.balanceOf(jurorB),
            "and the treasury holds exactly the jurors' balances, with nothing left locked"
        );
        assertEq(treasury.lockedStake(jurorA, settled), 0);
        assertEq(treasury.lockedStake(jurorB, settled), 0);

        // The treasury-funded bounty specifically came back rather than being credited to anyone.
        assertEq(resolver.caseBountyTreasury(), 30 * HBAR, "18 left after funding the case, plus the 12 returned");
    }
}

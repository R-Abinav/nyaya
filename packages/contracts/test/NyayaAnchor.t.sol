// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {NyayaAnchor} from "../src/anchor/NyayaAnchor.sol";

/// These tests prove the anchor's own logic: operator-gating and exact event field values. They are not
/// evidence that the real deployed anchor on Sepolia works — that requires the real relay script actually
/// mirroring real Hedera data, recorded with transaction hashes in docs/TESTNET-EVIDENCE.md.
contract NyayaAnchorTest is Test {
    NyayaAnchor internal anchor;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal juror = makeAddr("juror");
    address internal holder = makeAddr("holder");

    function setUp() public {
        anchor = new NyayaAnchor(operator);
    }

    // --- construction ---

    function test_ConstructorRejectsTheZeroOperator() public {
        vm.expectRevert(NyayaAnchor.ZeroAddress.selector);
        new NyayaAnchor(address(0));
    }

    function test_OperatorIsSetExactlyOnceAtConstruction() public view {
        assertEq(anchor.operator(), operator);
    }

    // --- access control: every write function, operator-only ---

    function test_OnlyOperatorRecordsAVerdict() public {
        vm.prank(stranger);
        vm.expectRevert(NyayaAnchor.NotOperator.selector);
        anchor.recordVerdict(1, juror, NyayaAnchor.Result.Correct, NyayaAnchor.Ruling.Yes, 10, 1, 5);
    }

    function test_OnlyOperatorRecordsAReturnCheckpoint() public {
        vm.prank(stranger);
        vm.expectRevert(NyayaAnchor.NotOperator.selector);
        anchor.recordReturnCheckpoint(1, juror, 5, 11);
    }

    function test_OnlyOperatorRecordsADeclaredDistribution() public {
        vm.prank(stranger);
        vm.expectRevert(NyayaAnchor.NotOperator.selector);
        anchor.recordDistributionDeclared(juror, 1, 1000, 4_000_000_000_000_000_000_000_000);
    }

    function test_OnlyOperatorRecordsAClaimedDistribution() public {
        vm.prank(stranger);
        vm.expectRevert(NyayaAnchor.NotOperator.selector);
        anchor.recordDistributionClaimed(juror, 1, holder, 1000);
    }

    // --- exact event shapes, the part Anurag's subgraph schema depends on ---

    function test_VerdictCarriesEnoughToDistinguishEveryLossCause() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Verdict(7, juror, NyayaAnchor.Result.Incorrect, NyayaAnchor.Ruling.No, 30, 0, -30);
        vm.prank(operator);
        anchor.recordVerdict(7, juror, NyayaAnchor.Result.Incorrect, NyayaAnchor.Ruling.No, 30, 0, -30);
    }

    /// A non-revealer forfeits, distinct from Incorrect: same shape of loss, different cause, and the
    /// event must still carry Ruling.None since it never revealed one.
    function test_VerdictForAnUnrevealedJurorCarriesRulingNone() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Verdict(7, juror, NyayaAnchor.Result.Unrevealed, NyayaAnchor.Ruling.None, 10, 0, -10);
        vm.prank(operator);
        anchor.recordVerdict(7, juror, NyayaAnchor.Result.Unrevealed, NyayaAnchor.Ruling.None, 10, 0, -10);
    }

    /// The bug-signal state: spent without ever committing. Net is purely negative from the spend, on
    /// zero stake, and this must remain distinguishable from every other loss cause.
    function test_VerdictForNoCommitmentCarriesZeroStakeAndTheSpendAsTheWholeLoss() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Verdict(7, juror, NyayaAnchor.Result.NoCommitment, NyayaAnchor.Ruling.None, 0, 3, -3);
        vm.prank(operator);
        anchor.recordVerdict(7, juror, NyayaAnchor.Result.NoCommitment, NyayaAnchor.Ruling.None, 0, 3, -3);
    }

    /// Cancellation is a platform failure, not a loss: net reflects only the lost evidence spend, exactly
    /// as the resolver's own cancellation accounting records it.
    function test_VerdictForACancelledCaseCarriesOnlyTheEvidenceSpendAsLoss() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Verdict(7, juror, NyayaAnchor.Result.Cancelled, NyayaAnchor.Ruling.None, 10, 2, -2);
        vm.prank(operator);
        anchor.recordVerdict(7, juror, NyayaAnchor.Result.Cancelled, NyayaAnchor.Ruling.None, 10, 2, -2);
    }

    function test_ReturnCheckpointCarriesTheTwoRunningTotalsNotAPercentage() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.ReturnCheckpoint(7, juror, 42, 100);
        vm.prank(operator);
        anchor.recordReturnCheckpoint(7, juror, 42, 100);
    }

    /// Cumulative net is signed and can itself be negative; the event must carry that sign, not clamp it.
    function test_ReturnCheckpointNetCanBeNegative() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.ReturnCheckpoint(7, juror, -15, 100);
        vm.prank(operator);
        anchor.recordReturnCheckpoint(7, juror, -15, 100);
    }

    function test_DistributionDeclaredCarriesZeroHolderAndTheRateAlongsideThePot() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Distribution(
            juror, 1, NyayaAnchor.DistributionKind.Declared, address(0), 40_000_000, 4_000_000_000_000_000_000_000_000
        );
        vm.prank(operator);
        anchor.recordDistributionDeclared(juror, 1, 40_000_000, 4_000_000_000_000_000_000_000_000);
    }

    function test_DistributionClaimedCarriesTheHolderAndZeroesTheRateField() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit NyayaAnchor.Distribution(juror, 1, NyayaAnchor.DistributionKind.Claimed, holder, 40_000_000, 0);
        vm.prank(operator);
        anchor.recordDistributionClaimed(juror, 1, holder, 40_000_000);
    }

    function test_DistributionClaimedRejectsTheZeroHolder() public {
        vm.prank(operator);
        vm.expectRevert(NyayaAnchor.ZeroAddress.selector);
        anchor.recordDistributionClaimed(juror, 1, address(0), 40_000_000);
    }

    /// Several claims can follow one declaration, sharing the same dividendId, each with its own holder.
    function test_MultipleClaimsCanFollowOneDeclarationForTheSameDividendId() public {
        vm.startPrank(operator);
        anchor.recordDistributionDeclared(juror, 5, 100, 1);
        anchor.recordDistributionClaimed(juror, 5, holder, 60);
        anchor.recordDistributionClaimed(juror, 5, makeAddr("secondHolder"), 40);
        vm.stopPrank();
    }
}

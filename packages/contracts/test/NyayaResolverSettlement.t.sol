// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";

/// Amounts use tinybar scale (1 HBAR = 1e8), matching what the contract sees on Hedera.
contract NyayaResolverSettlementTest is Test {
    uint256 internal constant HBAR = 1e8;

    JurorTreasury internal treasury;
    NyayaResolver internal resolver;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal jurorA = makeAddr("jurorA");
    address internal jurorB = makeAddr("jurorB");
    address internal jurorC = makeAddr("jurorC");
    address internal hotA = makeAddr("jurorAHot");
    address internal hotB = makeAddr("jurorBHot");
    address internal hotC = makeAddr("jurorCHot");

    uint64 internal commitDeadline;
    uint64 internal resolutionTime;

    string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    struct Settled {
        NyayaResolver.Result result;
        uint256 stake;
        uint256 spend;
        uint256 reward;
        int256 net;
        uint256 capital;
    }

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 * HBAR, 1 hours);
        resolver = new NyayaResolver(treasury, operator);

        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, hotA);
        treasury.registerJuror(jurorB, hotB);
        treasury.registerJuror(jurorC, hotC);
        vm.stopPrank();

        address[3] memory all = [jurorA, jurorB, jurorC];
        for (uint256 i; i < all.length; ++i) {
            vm.deal(address(this), 100 * HBAR);
            treasury.fund{value: 100 * HBAR}(all[i]);
        }
    }

    // --- helpers ---

    function _openCase(uint256 bounty) internal returns (uint256 id) {
        commitDeadline = uint64(block.timestamp + 1 hours);
        resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, bounty);
        vm.prank(opener);
        id = resolver.openCase{value: bounty}("github-stars", "q", commitDeadline, resolutionTime);
    }

    function _openCaseWith(uint256 bounty, uint256 commitAt, uint256 resolveAt) internal returns (uint256 id) {
        vm.deal(opener, bounty);
        vm.prank(opener);
        id = resolver.openCase{value: bounty}("launch", "q", uint64(commitAt), uint64(resolveAt));
    }

    function _resolveAt(uint256 id, uint256 at, NyayaResolver.Ruling outcome) internal {
        vm.warp(at);
        vm.prank(operator);
        resolver.submitOutcome(id, outcome, CID);
    }

    function _salt(address juror) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", juror));
    }

    function _spend(uint256 id, address juror, uint256 amount) internal {
        vm.prank(juror);
        resolver.withdrawForEvidence(id, amount);
    }

    function _commit(uint256 id, address juror, NyayaResolver.Ruling ruling, uint256 stake) internal {
        bytes32 h = keccak256(abi.encode(id, juror, ruling, uint16(7000), _salt(juror)));
        vm.prank(juror);
        resolver.commit(id, h, stake);
    }

    function _reveal(uint256 id, address juror, NyayaResolver.Ruling ruling) internal {
        vm.prank(juror);
        resolver.reveal(id, ruling, 7000, _salt(juror), CID);
    }

    function _resolve(uint256 id, NyayaResolver.Ruling outcome) internal {
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, outcome, CID);
    }

    /// Runs the ARCHITECTURE.md worked example: bounty 20; A stakes 50, spends 5, correct;
    /// B stakes 10, spends 1, correct; C stakes 30, spends nothing, incorrect.
    function _runWorkedExample() internal returns (uint256 id) {
        id = _openCase(20 * HBAR);
        _spend(id, jurorA, 5 * HBAR);
        _spend(id, jurorB, 1 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 50 * HBAR);
        _commit(id, jurorB, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(id, jurorC, NyayaResolver.Ruling.No, 30 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorB, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorC, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
    }

    /// What settlement emitted, decoded from the logs. Filled by _settleAndRead.
    mapping(address => Settled) internal r;
    uint256 internal pool;
    uint256 internal correctStake;
    uint256 internal remainder;
    uint256 internal rolledIn;

    function _settleAndRead(uint256 id) internal {
        vm.recordLogs();
        resolver.settle(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(resolver)) continue;
            if (logs[i].topics[0] == NyayaResolver.JurorSettled.selector) {
                r[address(uint160(uint256(logs[i].topics[2])))] = abi.decode(logs[i].data, (Settled));
            } else if (logs[i].topics[0] == NyayaResolver.CaseSettled.selector) {
                (, pool, correctStake, remainder, rolledIn,) =
                    abi.decode(logs[i].data, (NyayaResolver.Ruling, uint256, uint256, uint256, uint256, uint256));
            }
        }
    }

    // --- the worked example, exactly ---

    function test_WorkedExampleSettlesExactly() public {
        uint256 id = _runWorkedExample();
        _settleAndRead(id);

        // Inputs as the contract recorded them.
        assertEq(pool, 5_000_000_000, "P = 20 + 30 HBAR");
        assertEq(correctStake, 6_000_000_000, "S = 50 + 10 HBAR");
        assertEq(r[jurorA].stake, 50 * HBAR);
        assertEq(r[jurorA].spend, 5 * HBAR, "spend read from case-tagged withdrawals");
        assertEq(r[jurorB].stake, 10 * HBAR);
        assertEq(r[jurorB].spend, 1 * HBAR);

        // On-chain figures, rounded down to the tinybar.
        assertEq(r[jurorA].reward, 4_166_666_666);
        assertEq(r[jurorB].reward, 833_333_333);
        assertEq(remainder, 1, "pool remainder");
        assertEq(resolver.caseBountyTreasury(), 1, "remainder goes to the Case Bounty Treasury");
        assertEq(r[jurorA].net, 3_666_666_666);
        assertEq(r[jurorB].net, 733_333_333);
        assertEq(r[jurorA].capital, 5_500_000_000);
        assertEq(r[jurorB].capital, 1_100_000_000);
        assertEq(uint8(r[jurorA].result), uint8(NyayaResolver.Result.Correct));
        assertEq(uint8(r[jurorB].result), uint8(NyayaResolver.Result.Correct));

        // C: slashed, no spend, return exactly -100%.
        assertEq(uint8(r[jurorC].result), uint8(NyayaResolver.Result.Incorrect));
        assertEq(r[jurorC].net, -3_000_000_000);
        assertEq(r[jurorC].capital, 3_000_000_000);
        assertEq(resolver.returnBps(jurorC), -10_000);

        // The identity, checked on the contract's own inputs with no rounding anywhere:
        // (P·s_A − x_A·S)·(s_B + x_B) == (P·s_B − x_B·S)·(s_A + x_A)
        uint256 lhs = (pool * r[jurorA].stake - r[jurorA].spend * correctStake) * (r[jurorB].stake + r[jurorB].spend);
        uint256 rhs = (pool * r[jurorB].stake - r[jurorB].spend * correctStake) * (r[jurorA].stake + r[jurorA].spend);
        assertEq(lhs, rhs, "A and B have exactly equal returns before rounding");

        // The same identity in whole HBAR, matching the doc: (2500 - 300) x 11 == (500 - 60) x 55 == 24,200.
        uint256 p = pool / HBAR;
        uint256 s = correctStake / HBAR;
        assertEq((p * 50 - 5 * s) * (10 + 1), 24_200);
        assertEq((p * 10 - 1 * s) * (50 + 5), 24_200);

        // Each return is exactly 2/3 (66.67%): 3·(P·s − x·S) == 2·S·(s + x), again without rounding.
        assertEq(
            3 * (pool * r[jurorA].stake - r[jurorA].spend * correctStake),
            2 * correctStake * (r[jurorA].stake + r[jurorA].spend)
        );
        assertEq(
            3 * (pool * r[jurorB].stake - r[jurorB].spend * correctStake),
            2 * correctStake * (r[jurorB].stake + r[jurorB].spend)
        );

        // The on-chain figure the bonding curve reads, in basis points: identical for A and B.
        assertEq(resolver.returnBps(jurorA), 6666);
        assertEq(resolver.returnBps(jurorB), 6666);
    }

    function test_WorkedExampleMovesMoneyWhereItShould() public {
        uint256 id = _runWorkedExample();
        resolver.settle(id);

        assertEq(treasury.balanceOf(jurorA), 100 * HBAR - 5 * HBAR + 4_166_666_666, "stake back plus reward");
        assertEq(treasury.balanceOf(jurorB), 100 * HBAR - 1 * HBAR + 833_333_333);
        assertEq(treasury.balanceOf(jurorC), 70 * HBAR, "C's stake is gone");
        assertEq(treasury.lockedStake(jurorA, id), 0);
        assertEq(treasury.lockedStake(jurorC, id), 0);
        assertEq(hotA.balance, 5 * HBAR);
        assertEq(hotB.balance, 1 * HBAR);
        assertEq(address(resolver).balance, 1, "only the 1-tinybar remainder is left");

        // Nothing created or lost: 300 funded + 20 bounty in, all accounted for.
        assertEq(address(treasury).balance + address(resolver).balance + hotA.balance + hotB.balance, 320 * HBAR);
    }

    // --- the formula holds beyond the one example ---

    /// Two correct jurors with the same spend-to-stake ratio α = 1/k get exactly equal returns, for any stakes,
    /// bounty and losing stake. Checked by cross-multiplying the contract's own recorded inputs, with no rounding.
    function testFuzz_EqualSpendRatioGivesExactlyEqualReturns(
        uint256 k,
        uint256 sA,
        uint256 sB,
        uint256 sC,
        uint256 bounty
    ) public {
        k = bound(k, 2, 20);
        uint256 maxStake = 60 * HBAR < 10 * HBAR * k ? 60 * HBAR : 10 * HBAR * k;
        sA = bound(sA, k, maxStake) / k * k;
        sB = bound(sB, k, maxStake) / k * k;
        sC = bound(sC, 1, 90 * HBAR);
        bounty = bound(bounty, 1, 1000 * HBAR);

        uint256 id = _openCase(bounty);
        _spend(id, jurorA, sA / k);
        _spend(id, jurorB, sB / k);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, sA);
        _commit(id, jurorB, NyayaResolver.Ruling.Yes, sB);
        _commit(id, jurorC, NyayaResolver.Ruling.No, sC);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorB, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorC, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
        _settleAndRead(id);

        int256 lhs = (int256(pool * r[jurorA].stake) - int256(r[jurorA].spend * correctStake))
            * int256(r[jurorB].stake + r[jurorB].spend);
        int256 rhs = (int256(pool * r[jurorB].stake) - int256(r[jurorB].spend * correctStake))
            * int256(r[jurorA].stake + r[jurorA].spend);
        assertEq(lhs, rhs);
    }

    /// For any stakes and spends: each reward is exactly floor(P·s/S), and rewards plus the remainder sent to the
    /// Case Bounty Treasury add back up to the pool, with less than one tinybar per correct juror left over.
    function testFuzz_PayoutsAreFlooredProRataAndConservePool(
        uint256 sA,
        uint256 sB,
        uint256 sC,
        uint256 xA,
        uint256 xB,
        uint256 bounty
    ) public {
        sA = bound(sA, 1, 80 * HBAR);
        sB = bound(sB, 1, 80 * HBAR);
        sC = bound(sC, 1, 90 * HBAR);
        xA = bound(xA, 1, 10 * HBAR);
        xB = bound(xB, 1, 10 * HBAR);
        bounty = bound(bounty, 1, 1000 * HBAR);

        uint256 id = _openCase(bounty);
        _spend(id, jurorA, xA);
        _spend(id, jurorB, xB);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, sA);
        _commit(id, jurorB, NyayaResolver.Ruling.Yes, sB);
        _commit(id, jurorC, NyayaResolver.Ruling.No, sC);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorB, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorC, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
        _settleAndRead(id);

        assertEq(pool, bounty + sC);
        assertEq(correctStake, sA + sB);
        assertEq(r[jurorA].reward, pool * sA / correctStake);
        assertEq(r[jurorB].reward, pool * sB / correctStake);
        assertEq(r[jurorA].reward + r[jurorB].reward + remainder, pool);
        assertLt(remainder, 2);
        assertEq(resolver.caseBountyTreasury(), remainder);
        assertEq(r[jurorA].net, int256(r[jurorA].reward) - int256(xA));
        assertEq(r[jurorA].capital, sA + xA);
    }

    // --- losses keep their cause ---

    function test_UnrevealedJurorIsSlashedAsUnrevealed() public {
        uint256 id = _openCase(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 50 * HBAR);
        _commit(id, jurorB, NyayaResolver.Ruling.Yes, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _resolve(id, NyayaResolver.Ruling.Yes);

        _settleAndRead(id);
        assertEq(uint8(r[jurorB].result), uint8(NyayaResolver.Result.Unrevealed));
        assertEq(r[jurorB].net, -10 * int256(HBAR));
        assertEq(pool, 30 * HBAR, "B's stake joins the pool even though its hidden ruling was right");
        assertEq(r[jurorA].reward, 30 * HBAR);
    }

    function test_IncorrectJurorLosesStakeAndSpend() public {
        uint256 id = _openCase(20 * HBAR);
        _spend(id, jurorC, 2 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(id, jurorC, NyayaResolver.Ruling.No, 30 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _reveal(id, jurorC, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);

        _settleAndRead(id);
        assertEq(r[jurorC].net, -32 * int256(HBAR), "net = -s - x");
        assertEq(r[jurorC].capital, 32 * HBAR, "capital = s + x");
        assertEq(resolver.returnBps(jurorC), -10_000);
    }

    function test_SpendWithoutCommitmentIsRecordedAsLoss() public {
        uint256 id = _openCase(20 * HBAR);
        _spend(id, jurorC, 3 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.Yes, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.Yes);
        _resolve(id, NyayaResolver.Ruling.Yes);

        _settleAndRead(id);
        assertEq(uint8(r[jurorC].result), uint8(NyayaResolver.Result.NoCommitment));
        assertEq(r[jurorC].net, -3 * int256(HBAR));
        assertEq(r[jurorC].capital, 3 * HBAR);
        assertEq(treasury.balanceOf(jurorC), 97 * HBAR);
    }

    // --- nobody right: bounty back to its source, slashed stakes roll over ---

    function test_NoCorrectJurorRefundsBountyAndRollsStakesIntoNextCase() public {
        uint256 id = _openCase(20 * HBAR);
        _commit(id, jurorA, NyayaResolver.Ruling.No, 10 * HBAR);
        _commit(id, jurorB, NyayaResolver.Ruling.No, 5 * HBAR);
        vm.warp(commitDeadline);
        _reveal(id, jurorA, NyayaResolver.Ruling.No);
        _reveal(id, jurorB, NyayaResolver.Ruling.No);
        _resolve(id, NyayaResolver.Ruling.Yes);
        resolver.settle(id);

        assertEq(resolver.refundOf(opener), 20 * HBAR);
        assertEq(resolver.rolloverPool(), 15 * HBAR);
        vm.prank(opener);
        resolver.withdrawRefund();
        assertEq(opener.balance, 20 * HBAR);

        uint256 next = _openCase(4 * HBAR);
        _commit(next, jurorC, NyayaResolver.Ruling.Yes, 10 * HBAR);
        vm.warp(commitDeadline);
        _reveal(next, jurorC, NyayaResolver.Ruling.Yes);
        _resolve(next, NyayaResolver.Ruling.Yes);
        _settleAndRead(next);

        assertEq(pool, 19 * HBAR, "4 bounty + 15 rolled over");
        assertEq(r[jurorC].reward, 19 * HBAR);
        assertEq(resolver.rolloverPool(), 0);
    }

    /// Cases of different types run on different timelines and overlap. A rollover must only reach a case whose
    /// jurors could still see it before locking their stakes, never one whose commit window had already closed.
    function test_RolloverNeverLandsInACaseWhoseCommitWindowClosedBeforeItExisted() public {
        uint256 t0 = block.timestamp;
        uint256 x = _openCaseWith(20 * HBAR, t0 + 1 hours, t0 + 6 hours); // long case, nobody right
        uint256 y = _openCaseWith(4 * HBAR, t0 + 2 hours, t0 + 8 hours); // commits close long before X settles
        uint256 w = _openCaseWith(3 * HBAR, t0 + 6 hours, t0 + 8 hours); // commits close exactly as X settles
        uint256 z = _openCaseWith(2 * HBAR, t0 + 7 hours, t0 + 9 hours); // commits still open when X settles

        _commit(x, jurorA, NyayaResolver.Ruling.No, 10 * HBAR);
        _commit(x, jurorB, NyayaResolver.Ruling.No, 5 * HBAR);
        _commit(y, jurorC, NyayaResolver.Ruling.Yes, 10 * HBAR);
        _commit(w, jurorB, NyayaResolver.Ruling.Yes, 10 * HBAR);

        vm.warp(t0 + 1 hours);
        _reveal(x, jurorA, NyayaResolver.Ruling.No);
        _reveal(x, jurorB, NyayaResolver.Ruling.No);
        vm.warp(t0 + 2 hours);
        _reveal(y, jurorC, NyayaResolver.Ruling.Yes);

        // X settles with no winner: its 15 HBAR of slashed stakes become the rollover, at t0 + 6h.
        _resolveAt(x, t0 + 6 hours, NyayaResolver.Ruling.Yes);
        resolver.settle(x);
        assertEq(resolver.rolloverPool(), 15 * HBAR);
        assertEq(resolver.rolloverUpdatedAt(), t0 + 6 hours);
        _reveal(w, jurorB, NyayaResolver.Ruling.Yes);
        _commit(z, jurorA, NyayaResolver.Ruling.Yes, 5 * HBAR); // Z's jurors commit knowing the rollover exists

        // Y and W settle after X with winners, but their commit windows had closed before the rollover existed.
        _resolveAt(y, t0 + 8 hours, NyayaResolver.Ruling.Yes);
        _settleAndRead(y);
        assertEq(rolledIn, 0, "Y's commits closed at t0+2h, before the rollover");
        assertEq(pool, 4 * HBAR);
        assertEq(r[jurorC].reward, 4 * HBAR);

        vm.prank(operator);
        resolver.submitOutcome(w, NyayaResolver.Ruling.Yes, CID);
        _settleAndRead(w);
        assertEq(rolledIn, 0, "W's commits closed at the very moment the rollover appeared");
        assertEq(pool, 3 * HBAR);
        assertEq(resolver.rolloverPool(), 15 * HBAR, "still waiting for an eligible case");

        // Z was still open for commits when the rollover appeared, so it receives all of it.
        _reveal(z, jurorA, NyayaResolver.Ruling.Yes);
        _resolveAt(z, t0 + 9 hours, NyayaResolver.Ruling.Yes);
        _settleAndRead(z);
        assertEq(rolledIn, 15 * HBAR);
        assertEq(pool, 2 * HBAR + 15 * HBAR);
        assertEq(r[jurorA].reward, 17 * HBAR);
        assertEq(resolver.rolloverPool(), 0);
    }

    // --- outcome window: hard close at the end of the grace period ---

    function test_SubmitOutcomeWindowAndHardClose() public {
        uint256 id = _openCase(20 * HBAR);
        vm.startPrank(operator);
        vm.warp(resolutionTime - 1);
        vm.expectRevert(NyayaResolver.OutcomeWindowNotOpen.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);

        vm.warp(resolutionTime + resolver.GRACE_PERIOD());
        vm.expectRevert(NyayaResolver.OutcomeWindowClosed.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);

        vm.warp(resolutionTime + resolver.GRACE_PERIOD() - 1);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);
        vm.expectRevert(NyayaResolver.OutcomeAlreadySubmitted.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.No, CID);
        vm.stopPrank();
    }

    function test_OnlyOperatorSubmitsAValidOutcome() public {
        uint256 id = _openCase(20 * HBAR);
        vm.warp(resolutionTime);
        vm.expectRevert(NyayaResolver.NotOperator.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);

        vm.startPrank(operator);
        vm.expectRevert(NyayaResolver.InvalidRuling.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.None, CID);
        vm.expectRevert(NyayaResolver.EmptyEvidenceCid.selector);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, "");
        vm.stopPrank();
    }

    function test_SettleNeedsOutcomeAndRunsOnce() public {
        uint256 id = _runWorkedExample();
        uint256 fresh = _openCase(1 * HBAR);
        vm.expectRevert(NyayaResolver.OutcomeNotSubmitted.selector);
        resolver.settle(fresh);

        resolver.settle(id);
        vm.expectRevert(NyayaResolver.AlreadySettled.selector);
        resolver.settle(id);
    }

    // --- evidence withdrawals through the resolver ---

    function test_EvidenceWithdrawalClosesAtCommitDeadline() public {
        uint256 id = _openCase(20 * HBAR);
        vm.warp(commitDeadline);
        vm.prank(jurorA);
        vm.expectRevert(NyayaResolver.EvidenceWindowClosed.selector);
        resolver.withdrawForEvidence(id, 1 * HBAR);
    }

    function test_ResolverRejectsHbarNotFromTreasury() public {
        vm.deal(address(this), 1 * HBAR);
        (bool ok,) = address(resolver).call{value: 1 * HBAR}("");
        assertFalse(ok);
    }
}

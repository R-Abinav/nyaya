// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";

/// This test contract plays the resolver, so every other address is a non-resolver caller.
contract JurorTreasuryTest is Test {
    JurorTreasury internal treasury;

    address internal operator = makeAddr("operator");
    address internal juror = makeAddr("jurorKey");
    address internal hotWallet = makeAddr("jurorHotWallet");
    address internal shareBuyer = makeAddr("shareBuyer");

    uint256 internal constant CAP = 10 ether;
    uint256 internal constant WINDOW = 1 hours;
    uint256 internal constant CASE_1 = 1;
    uint256 internal constant CASE_2 = 2;

    event Funded(address indexed juror, address indexed from, uint256 amount);
    event X402Withdrawn(address indexed juror, uint256 indexed caseId, address hotWallet, uint256 amount);

    receive() external payable {}

    function setUp() public {
        treasury = new JurorTreasury(operator, CAP, WINDOW);
        vm.startPrank(operator);
        treasury.setResolver(address(this));
        treasury.registerJuror(juror, hotWallet);
        vm.stopPrank();
    }

    function _fund(uint256 amount) internal {
        vm.deal(shareBuyer, amount);
        vm.prank(shareBuyer);
        treasury.fund{value: amount}(juror);
    }

    // --- funding increases the balance ---

    function test_ExternalFundingIncreasesBalance() public {
        vm.deal(shareBuyer, 100 ether);
        vm.expectEmit(address(treasury));
        emit Funded(juror, shareBuyer, 60 ether);
        vm.prank(shareBuyer);
        treasury.fund{value: 60 ether}(juror);

        assertEq(treasury.balanceOf(juror), 60 ether);
        assertEq(address(treasury).balance, 60 ether);
    }

    function test_FundingUnknownJurorReverts() public {
        vm.deal(shareBuyer, 1 ether);
        vm.prank(shareBuyer);
        vm.expectRevert(JurorTreasury.UnknownJuror.selector);
        treasury.fund{value: 1 ether}(makeAddr("stranger"));
    }

    function test_PlainTransferIsRejected() public {
        vm.deal(shareBuyer, 1 ether);
        vm.prank(shareBuyer);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertFalse(ok, "HBAR must enter through fund() so it is attributed to a juror");
    }

    // --- decrease path 1: staking ---

    function test_LockStakeMovesAvailableIntoCaseLock() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 50 ether);

        assertEq(treasury.balanceOf(juror), 50 ether);
        assertEq(treasury.lockedStake(juror, CASE_1), 50 ether);
        assertEq(address(treasury).balance, 100 ether, "locking moves nothing out of the contract");
    }

    function test_LockStakeBeyondAvailableReverts() public {
        _fund(10 ether);
        vm.expectRevert(abi.encodeWithSelector(JurorTreasury.InsufficientBalance.selector, 10 ether, 11 ether));
        treasury.lockStake(juror, CASE_1, 11 ether);
    }

    function test_LockStakeTwiceForSameCaseReverts() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 10 ether);
        vm.expectRevert(JurorTreasury.StakeAlreadyLocked.selector);
        treasury.lockStake(juror, CASE_1, 10 ether);
    }

    function test_UnlockReturnsStakeToAvailable() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 50 ether);
        uint256 returned = treasury.unlockStake(juror, CASE_1);

        assertEq(returned, 50 ether);
        assertEq(treasury.balanceOf(juror), 100 ether);
        assertEq(treasury.lockedStake(juror, CASE_1), 0);
    }

    // --- decrease path 2: slashing takes the stake, it does not unlock it ---

    function test_SlashSendsLockedStakeToResolverNotBackToJuror() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 30 ether);
        uint256 resolverBefore = address(this).balance;

        uint256 slashed = treasury.slashStake(juror, CASE_1);

        assertEq(slashed, 30 ether);
        assertEq(treasury.lockedStake(juror, CASE_1), 0);
        assertEq(treasury.balanceOf(juror), 70 ether, "slashed stake must not return to available");
        assertEq(address(this).balance - resolverBefore, 30 ether);
        assertEq(address(treasury).balance, 70 ether);
    }

    function test_SlashTwiceReverts() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 30 ether);
        treasury.slashStake(juror, CASE_1);
        vm.expectRevert(JurorTreasury.NoLockedStake.selector);
        treasury.slashStake(juror, CASE_1);
    }

    // --- decrease path 3: x402 withdrawal, tagged with the case id when it happens ---

    function test_X402WithdrawalIsTaggedWithCaseIdAtWithdrawalTime() public {
        _fund(100 ether);
        assertEq(treasury.x402Spend(juror, CASE_1), 0);

        vm.expectEmit(address(treasury));
        emit X402Withdrawn(juror, CASE_1, hotWallet, 5 ether);
        treasury.withdrawForX402(juror, CASE_1, 5 ether);

        assertEq(treasury.x402Spend(juror, CASE_1), 5 ether, "spend recorded against the case in the same call");
        assertEq(treasury.x402Spend(juror, CASE_2), 0, "and against no other case");
        assertEq(treasury.balanceOf(juror), 95 ether);
        assertEq(hotWallet.balance, 5 ether);
    }

    function test_X402SpendAccumulatesSeparatelyPerCase() public {
        _fund(100 ether);
        treasury.withdrawForX402(juror, CASE_1, 2 ether);
        treasury.withdrawForX402(juror, CASE_2, 1 ether);
        treasury.withdrawForX402(juror, CASE_1, 3 ether);

        assertEq(treasury.x402Spend(juror, CASE_1), 5 ether);
        assertEq(treasury.x402Spend(juror, CASE_2), 1 ether);
        assertEq(hotWallet.balance, 6 ether);
    }

    function test_X402WithdrawalCapIsEnforcedPerWindow() public {
        _fund(100 ether);
        treasury.withdrawForX402(juror, CASE_1, 8 ether);

        vm.expectRevert(abi.encodeWithSelector(JurorTreasury.WithdrawalCapExceeded.selector, 2 ether, 3 ether));
        treasury.withdrawForX402(juror, CASE_1, 3 ether);

        vm.warp(block.timestamp + WINDOW);
        treasury.withdrawForX402(juror, CASE_1, 3 ether);
        assertEq(treasury.x402Spend(juror, CASE_1), 11 ether);
    }

    // --- only the resolver can draw a treasury down ---

    function test_JurorOwnKeysCannotDrawDown() public {
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 10 ether);
        address[3] memory jurorSide = [juror, hotWallet, operator];

        for (uint256 i; i < jurorSide.length; ++i) {
            _assertCannotDrawDown(jurorSide[i]);
        }
        assertEq(treasury.balanceOf(juror), 90 ether);
        assertEq(treasury.lockedStake(juror, CASE_1), 10 ether);
    }

    function testFuzz_OnlyResolverCanDrawDown(address caller) public {
        vm.assume(caller != address(this));
        _fund(100 ether);
        treasury.lockStake(juror, CASE_1, 10 ether);

        _assertCannotDrawDown(caller);

        assertEq(treasury.balanceOf(juror), 90 ether);
        assertEq(treasury.lockedStake(juror, CASE_1), 10 ether);
        assertEq(treasury.x402Spend(juror, CASE_1), 0);
    }

    function _assertCannotDrawDown(address caller) internal {
        vm.startPrank(caller);
        vm.expectRevert(JurorTreasury.NotResolver.selector);
        treasury.lockStake(juror, CASE_2, 1 ether);
        vm.expectRevert(JurorTreasury.NotResolver.selector);
        treasury.slashStake(juror, CASE_1);
        vm.expectRevert(JurorTreasury.NotResolver.selector);
        treasury.unlockStake(juror, CASE_1);
        vm.expectRevert(JurorTreasury.NotResolver.selector);
        treasury.withdrawForX402(juror, CASE_1, 1 ether);
        vm.stopPrank();
    }

    // --- wiring and registry ---

    function test_NothingCanBeDrawnDownBeforeResolverIsSet() public {
        JurorTreasury fresh = new JurorTreasury(operator, CAP, WINDOW);
        vm.expectRevert(JurorTreasury.NotResolver.selector);
        fresh.withdrawForX402(juror, CASE_1, 1 ether);
    }

    function test_ResolverCanOnlyBeSetOnceAndOnlyByOperator() public {
        JurorTreasury fresh = new JurorTreasury(operator, CAP, WINDOW);
        vm.expectRevert(JurorTreasury.NotOperator.selector);
        fresh.setResolver(address(this));

        vm.startPrank(operator);
        fresh.setResolver(address(this));
        vm.expectRevert(JurorTreasury.ResolverAlreadySet.selector);
        fresh.setResolver(makeAddr("otherResolver"));
        vm.stopPrank();
    }

    function test_OnlyOperatorRegistersJurors() public {
        vm.expectRevert(JurorTreasury.NotOperator.selector);
        treasury.registerJuror(makeAddr("jurorB"), makeAddr("jurorBHot"));

        vm.startPrank(operator);
        vm.expectRevert(JurorTreasury.AlreadyRegistered.selector);
        treasury.registerJuror(juror, makeAddr("anotherHot"));
        vm.expectRevert(JurorTreasury.HotWalletIsJurorKey.selector);
        treasury.registerJuror(makeAddr("jurorC"), makeAddr("jurorC"));
        vm.stopPrank();
    }
}

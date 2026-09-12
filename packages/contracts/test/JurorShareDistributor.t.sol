// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";
import {JurorShareMarket} from "../src/shares/JurorShareMarket.sol";
import {JurorShareDistributor} from "../src/shares/JurorShareDistributor.sol";
import {AtsRoles} from "../src/shares/IAtsToken.sol";
import {MockAtsToken} from "./mocks/MockAtsToken.sol";

contract JurorShareDistributorTest is Test {
    uint256 internal constant HBAR = 1e8;

    JurorTreasury internal treasury;
    NyayaResolver internal resolver;
    JurorShareMarket internal market;
    JurorShareDistributor internal distributor;
    MockAtsToken internal token;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal jurorA = makeAddr("jurorA");
    address internal hotA = makeAddr("jurorAHot");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 * HBAR, 1 hours);
        resolver = new NyayaResolver(treasury, operator);
        market = new JurorShareMarket(resolver, treasury, operator);
        token = new MockAtsToken(2);
        distributor = new JurorShareDistributor(token, address(resolver), operator, jurorA);

        token.grantRole(AtsRoles.ISSUER, address(market));
        token.grantRole(AtsRoles.CONTROLLER, address(market));
        token.grantRole(AtsRoles.CONTROL_LIST, address(market));
        token.grantRole(AtsRoles.CORPORATE_ACTION, address(distributor));

        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, hotA);
        market.registerShareToken(jurorA, token);
        resolver.setDistributionAddress(jurorA, address(distributor));
        vm.stopPrank();

        vm.deal(address(this), 100 * HBAR);
        treasury.fund{value: 100 * HBAR}(jurorA);
    }

    function _buy(address who, uint256 tradeValue) internal {
        uint256 cost = tradeValue + tradeValue * 200 / 10_000;
        vm.deal(who, cost);
        vm.prank(who);
        market.buy{value: cost}(jurorA, tradeValue);
    }

    /// Settles one winning case so the resolver holds a real skim for this juror.
    function _winACaseAndReleaseSkim() internal returns (uint256 skim) {
        uint64 commitDeadline = uint64(block.timestamp + 1 hours);
        uint64 resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, 20 * HBAR);
        vm.prank(opener);
        uint256 id = resolver.openCase{value: 20 * HBAR}("github-stars", "q", commitDeadline, resolutionTime);

        bytes32 salt = keccak256("s");
        vm.prank(jurorA);
        resolver.commit(id, keccak256(abi.encode(id, jurorA, NyayaResolver.Ruling.Yes, uint16(7000), salt)), 10 * HBAR);
        vm.warp(commitDeadline);
        vm.prank(jurorA);
        resolver.reveal(id, NyayaResolver.Ruling.Yes, 7000, salt, CID);
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);
        resolver.settle(id);

        skim = resolver.pendingDistribution(jurorA);
        resolver.releaseDistribution(jurorA);
    }

    // --- the whole path: skim -> ATS dividend -> holders paid ---

    function test_SkimReachesHoldersInProportionToShares() public {
        _buy(alice, 30 * HBAR); // 3000 units
        _buy(bob, 10 * HBAR); // 1000 units
        assertEq(token.balanceOf(alice), 3000);
        assertEq(token.balanceOf(bob), 1000);

        uint256 skim = _winACaseAndReleaseSkim();
        assertEq(address(distributor).balance, skim, "the resolver sent the skim here");
        assertEq(distributor.undeclared(), skim);

        vm.prank(operator);
        uint256 dividendId = distributor.declare();
        assertEq(distributor.potOf(dividendId), skim);
        assertEq(distributor.undeclared(), 0, "the pot is now attached to a dividend");

        // Alice holds 3/4 of the supply, Bob 1/4.
        assertEq(distributor.claimableOf(dividendId, alice), skim * 3 / 4);
        assertEq(distributor.claimableOf(dividendId, bob), skim * 1 / 4);

        vm.prank(alice);
        uint256 alicePaid = distributor.claim(dividendId);
        vm.prank(bob);
        uint256 bobPaid = distributor.claim(dividendId);

        assertEq(alice.balance, alicePaid);
        assertEq(bob.balance, bobPaid);
        assertEq(alicePaid, skim * 3 / 4);
        assertEq(bobPaid, skim * 1 / 4);
        assertEq(alicePaid + bobPaid, skim, "every tinybar of the skim reached holders");
        assertEq(address(distributor).balance, 0);
    }

    function test_ClaimingTwiceReverts() public {
        _buy(alice, 10 * HBAR);
        _winACaseAndReleaseSkim();
        vm.prank(operator);
        uint256 dividendId = distributor.declare();

        vm.startPrank(alice);
        distributor.claim(dividendId);
        vm.expectRevert(JurorShareDistributor.AlreadyClaimed.selector);
        distributor.claim(dividendId);
        vm.stopPrank();
    }

    function test_NonHolderHasNothingToClaim() public {
        _buy(alice, 10 * HBAR);
        _winACaseAndReleaseSkim();
        vm.prank(operator);
        uint256 dividendId = distributor.declare();

        assertEq(distributor.claimableOf(dividendId, bob), 0);
        vm.prank(bob);
        vm.expectRevert(JurorShareDistributor.NothingToClaim.selector);
        distributor.claim(dividendId);
    }

    /// A snapshot is what makes this fair: buying after the declaration earns nothing from it.
    function test_BuyingAfterTheSnapshotEarnsNothingFromThatDividend() public {
        _buy(alice, 10 * HBAR);
        uint256 skim = _winACaseAndReleaseSkim();
        vm.prank(operator);
        uint256 dividendId = distributor.declare();

        _buy(bob, 30 * HBAR); // after the record date

        assertEq(distributor.claimableOf(dividendId, bob), 0, "not a holder at the snapshot");
        assertEq(distributor.claimableOf(dividendId, alice), skim, "alice was the only holder then");
        vm.prank(alice);
        assertEq(distributor.claim(dividendId), skim);
    }

    // --- guards ---

    function test_OnlyTheResolverCanFundIt() public {
        vm.deal(alice, 1 * HBAR);
        vm.prank(alice);
        (bool ok,) = address(distributor).call{value: 1 * HBAR}("");
        assertFalse(ok, "only the resolver's releaseDistribution funds this");
    }

    function test_DeclareIsOperatorOnlyAndNeedsBothMoneyAndHolders() public {
        vm.expectRevert(JurorShareDistributor.NotOperator.selector);
        distributor.declare();

        vm.prank(operator);
        vm.expectRevert(JurorShareDistributor.NothingToDeclare.selector);
        distributor.declare();

        _winACaseAndReleaseSkim(); // money, but nobody holds shares yet
        vm.prank(operator);
        vm.expectRevert(JurorShareDistributor.NoShareholders.selector);
        distributor.declare();
    }

    function test_UnclaimedCanBeReclaimedOnlyAfterTheWindow() public {
        _buy(alice, 10 * HBAR);
        uint256 skim = _winACaseAndReleaseSkim();
        vm.prank(operator);
        uint256 dividendId = distributor.declare();

        vm.prank(operator);
        vm.expectRevert(JurorShareDistributor.TooEarlyToReclaim.selector);
        distributor.reclaimUnclaimed(dividendId);

        vm.warp(block.timestamp + distributor.UNCLAIMED_PERIOD());
        vm.prank(operator);
        assertEq(distributor.reclaimUnclaimed(dividendId), skim);
        assertEq(distributor.undeclared(), skim, "back in the pool for the next distribution");

        vm.prank(alice);
        vm.expectRevert(JurorShareDistributor.NothingToClaim.selector);
        distributor.claim(dividendId);
    }
}

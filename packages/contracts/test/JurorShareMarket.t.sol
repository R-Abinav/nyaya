// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {JurorTreasury} from "../src/jury/JurorTreasury.sol";
import {NyayaResolver} from "../src/jury/NyayaResolver.sol";
import {JurorShareMarket} from "../src/shares/JurorShareMarket.sol";
import {IAtsToken, AtsRoles} from "../src/shares/IAtsToken.sol";
import {MockAtsToken} from "./mocks/MockAtsToken.sol";

contract JurorShareMarketTest is Test {
    uint256 internal constant HBAR = 1e8;

    JurorTreasury internal treasury;
    NyayaResolver internal resolver;
    JurorShareMarket internal market;
    MockAtsToken internal tokenA;

    address internal operator = makeAddr("operator");
    address internal opener = makeAddr("caseOpener");
    address internal jurorA = makeAddr("jurorA");
    address internal jurorB = makeAddr("jurorB");
    address internal hotA = makeAddr("jurorAHot");
    address internal buyer = makeAddr("thirdPartyBuyer");

    string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    function setUp() public {
        treasury = new JurorTreasury(operator, 10 * HBAR, 1 hours);
        resolver = new NyayaResolver(treasury, operator);
        market = new JurorShareMarket(resolver, treasury, operator);
        tokenA = new MockAtsToken(2);

        vm.startPrank(operator);
        treasury.setResolver(address(resolver));
        treasury.registerJuror(jurorA, hotA);
        treasury.registerJuror(jurorB, makeAddr("jurorBHot"));
        vm.stopPrank();

        _grantMarketRoles(tokenA);
        vm.prank(operator);
        market.registerShareToken(jurorA, tokenA);

        vm.deal(address(this), 200 * HBAR);
        treasury.fund{value: 100 * HBAR}(jurorA);
        treasury.fund{value: 100 * HBAR}(jurorB);
    }

    function _grantMarketRoles(MockAtsToken token) internal {
        token.grantRole(AtsRoles.ISSUER, address(market));
        token.grantRole(AtsRoles.CONTROLLER, address(market));
        token.grantRole(AtsRoles.CONTROL_LIST, address(market));
    }

    function _buy(address who, address juror, uint256 tradeValue) internal returns (uint256 shares) {
        uint256 cost = tradeValue + tradeValue * 200 / 10_000;
        vm.deal(who, cost);
        vm.prank(who);
        shares = market.buy{value: cost}(juror, tradeValue);
    }

    /// Settles one case so a juror has a real cumulative return: stake 10, no spend, correct, 5 HBAR bounty.
    function _giveJurorAPositiveReturn() internal {
        uint64 commitDeadline = uint64(block.timestamp + 1 hours);
        uint64 resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, 5 * HBAR);
        vm.prank(opener);
        uint256 id = resolver.openCase{value: 5 * HBAR}("github-stars", "q", commitDeadline, resolutionTime);

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
    }

    // --- the step's required output ---

    function test_ThirdPartyPurchaseSucceeds() public {
        uint256 shares = _buy(buyer, jurorA, 100 * HBAR);

        assertEq(market.priceOf(jurorA), 1 * HBAR, "no settled cases yet, so price is the base");
        assertEq(shares, 10_000, "100 HBAR at 1 HBAR per share, with 2 decimals");
        assertEq(tokenA.balanceOf(buyer), 10_000);
        assertEq(treasury.balanceOf(jurorA), 100 * HBAR + 70 * HBAR, "70% of the trade value");
        assertEq(market.reserveOf(jurorA), 30 * HBAR, "30% held for redemptions");
        assertEq(resolver.caseBountyTreasury(), 2 * HBAR, "the 2% fee, charged on top");
    }

    function test_PurchaseFromJurorsOwnKeyRevertsWithAtsAccountIsBlocked() public {
        vm.deal(jurorA, 102 * HBAR);
        vm.prank(jurorA);
        vm.expectRevert(abi.encodeWithSelector(IAtsToken.AccountIsBlocked.selector, jurorA));
        market.buy{value: 102 * HBAR}(jurorA, 100 * HBAR);
    }

    function test_PurchaseFromJurorsHotWalletRevertsWithAtsAccountIsBlocked() public {
        vm.deal(hotA, 102 * HBAR);
        vm.prank(hotA);
        vm.expectRevert(abi.encodeWithSelector(IAtsToken.AccountIsBlocked.selector, hotA));
        market.buy{value: 102 * HBAR}(jurorA, 100 * HBAR);
    }

    function test_RegisteringBlocksBothJurorOwnedAddressesOnTheAtsToken() public view {
        assertTrue(tokenA.isInControlList(jurorA), "juror's own key");
        assertTrue(tokenA.isInControlList(hotA), "juror's hot wallet");
        assertFalse(tokenA.isInControlList(buyer));
    }

    /// If the market lacks ROLE_ISSUER, ATS's role check fires before any compliance check.
    function test_MarketWithoutIssuerRoleGetsAtsRoleError() public {
        MockAtsToken tokenB = new MockAtsToken(2);
        tokenB.grantRole(AtsRoles.CONTROL_LIST, address(market));
        vm.prank(operator);
        market.registerShareToken(jurorB, tokenB);

        bytes32[] memory roles = new bytes32[](2);
        roles[0] = AtsRoles.ISSUER;
        roles[1] = AtsRoles.AGENT;
        vm.deal(buyer, 102 * HBAR);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IAtsToken.AccountHasNoRoles.selector, address(market), roles));
        market.buy{value: 102 * HBAR}(jurorB, 100 * HBAR);
    }

    // --- return-scaled pricing ---

    function test_PriceScalesWithCumulativeReturnAndIgnoresSupply() public {
        _giveJurorAPositiveReturn();
        assertEq(resolver.returnBps(jurorA), 5000, "net 5 HBAR on 10 HBAR deployed");
        assertEq(market.priceOf(jurorA), 15 * HBAR / 10, "1.5x base");

        uint256 first = _buy(buyer, jurorA, 30 * HBAR);
        uint256 priceAfterFirst = market.priceOf(jurorA);
        uint256 second = _buy(makeAddr("buyer2"), jurorA, 30 * HBAR);

        assertEq(priceAfterFirst, 15 * HBAR / 10, "supply grew, price did not");
        assertEq(market.priceOf(jurorA), 15 * HBAR / 10);
        assertEq(first, second, "same money buys the same shares regardless of supply");
    }

    function test_PriceFloorsWhenAJurorIsDeepInTheRed() public {
        uint64 commitDeadline = uint64(block.timestamp + 1 hours);
        uint64 resolutionTime = uint64(block.timestamp + 2 hours);
        vm.deal(opener, 5 * HBAR);
        vm.prank(opener);
        uint256 id = resolver.openCase{value: 5 * HBAR}("github-stars", "q", commitDeadline, resolutionTime);

        bytes32 salt = keccak256("s");
        vm.prank(jurorA);
        resolver.commit(id, keccak256(abi.encode(id, jurorA, NyayaResolver.Ruling.No, uint16(7000), salt)), 10 * HBAR);
        vm.warp(commitDeadline);
        vm.prank(jurorA);
        resolver.reveal(id, NyayaResolver.Ruling.No, 7000, salt, CID);
        vm.warp(resolutionTime);
        vm.prank(operator);
        resolver.submitOutcome(id, NyayaResolver.Ruling.Yes, CID);
        resolver.settle(id);

        assertEq(resolver.returnBps(jurorA), -10_000, "lost everything it deployed");
        assertEq(market.priceOf(jurorA), market.MIN_PRICE(), "floored, still tradeable");
    }

    // --- fee and reserve on the way out ---

    function test_SellPaysFromReserveAndTakesTheFeeFromProceeds() public {
        _buy(buyer, jurorA, 200 * HBAR); // reserve 60 HBAR
        uint256 sharesWorth50 = 50 * HBAR * 100 / market.priceOf(jurorA);

        vm.prank(buyer);
        uint256 proceeds = market.sell(jurorA, sharesWorth50);

        assertEq(proceeds, 49 * HBAR, "a sell of 50 pays 49");
        assertEq(buyer.balance, 49 * HBAR);
        assertEq(market.reserveOf(jurorA), 10 * HBAR, "60 held back, 50 paid out");
        assertEq(resolver.caseBountyTreasury(), 4 * HBAR + 1 * HBAR, "4 from the buy fee, 1 from the sell fee");
        assertEq(tokenA.balanceOf(buyer), 20_000 - sharesWorth50, "shares burned through ATS");
    }

    function test_SellRevertsWhenTheReserveCannotCoverIt() public {
        _buy(buyer, jurorA, 100 * HBAR); // reserve 30 HBAR
        uint256 sharesWorth50 = 50 * HBAR * 100 / market.priceOf(jurorA);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JurorShareMarket.InsufficientReserve.selector, 30 * HBAR, 50 * HBAR));
        market.sell(jurorA, sharesWorth50);
    }
}

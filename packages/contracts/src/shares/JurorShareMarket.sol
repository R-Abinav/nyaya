// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAtsToken} from "./IAtsToken.sol";
import {JurorTreasury} from "../jury/JurorTreasury.sol";
import {NyayaResolver} from "../jury/NyayaResolver.sol";

/// Buys and sells shares in a juror, issued as ATS security tokens.
///
/// Price is return-scaled, not a bonding curve: it reads the juror's cumulative return and ignores supply,
/// so a share price tracks judgment quality rather than how much the juror has been traded.
///
/// Blocking a juror from holding its own shares is left entirely to the ATS control list. This contract
/// deliberately does not repeat that check; ATS's compliance registry is what rejects the purchase.
contract JurorShareMarket {
    /// Price of one whole share at a cumulative return of zero, in tinybars.
    uint256 public constant BASE_PRICE = 1e8;
    /// Price floor, so a juror deep in the red still has a positive, tradeable price.
    uint256 public constant MIN_PRICE = BASE_PRICE / 10;
    uint256 public constant TREASURY_SHARE_BPS = 7_000;
    uint256 public constant TRADE_FEE_BPS = 200;
    uint256 internal constant BPS = 10_000;

    NyayaResolver public immutable resolver;
    JurorTreasury public immutable treasury;
    address public immutable operator;

    mapping(address juror => IAtsToken) public shareToken;
    mapping(address juror => uint8) public shareDecimals;
    /// Redemption reserve per juror: the 30% of each purchase kept back to buy shares back.
    mapping(address juror => uint256) public reserveOf;

    event ShareTokenRegistered(address indexed juror, address indexed token, address jurorKey, address hotWallet);
    event SharesBought(
        address indexed juror, address indexed buyer, uint256 shares, uint256 tradeValue, uint256 fee, uint256 price
    );
    event SharesSold(
        address indexed juror, address indexed seller, uint256 shares, uint256 tradeValue, uint256 fee, uint256 price
    );

    error NotOperator();
    error ZeroAddress();
    error UnknownShareToken();
    error ShareTokenAlreadyRegistered();
    error ZeroAmount();
    error WrongPayment(uint256 expected, uint256 sent);
    error NothingToTrade();
    error InsufficientReserve(uint256 reserve, uint256 needed);
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(NyayaResolver resolver_, JurorTreasury treasury_, address operator_) {
        if (address(resolver_) == address(0) || address(treasury_) == address(0) || operator_ == address(0)) {
            revert ZeroAddress();
        }
        resolver = resolver_;
        treasury = treasury_;
        operator = operator_;
    }

    /// Registers an ATS token as a juror's shares and immediately blocks that juror's own addresses on it.
    /// Requires this contract to hold ROLE_CONTROL_LIST (and later ROLE_ISSUER and ROLE_CONTROLLER) on the token.
    function registerShareToken(address juror, IAtsToken token) external onlyOperator {
        if (juror == address(0) || address(token) == address(0)) revert ZeroAddress();
        if (address(shareToken[juror]) != address(0)) revert ShareTokenAlreadyRegistered();
        address hotWallet = treasury.hotWalletOf(juror);
        if (hotWallet == address(0)) revert ZeroAddress();

        shareToken[juror] = token;
        shareDecimals[juror] = token.decimals();
        // ATS returns a success flag and reverts on failure, so there is nothing to branch on.
        // forge-lint: disable-next-line(unused-return)
        token.addToControlList(juror);
        // forge-lint: disable-next-line(unused-return)
        token.addToControlList(hotWallet);
        // forge-lint: disable-next-line(reentrancy-events)
        emit ShareTokenRegistered(juror, address(token), juror, hotWallet);
    }

    /// Tinybars per whole share: BASE_PRICE scaled by the juror's cumulative return, floored. No supply term.
    function priceOf(address juror) public view returns (uint256) {
        // The casts are of compile-time constants; returnBps is bounded below by -10000, so `scaled` fits.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 scaled = (int256(BASE_PRICE) * (int256(BPS) + resolver.returnBps(juror))) / int256(BPS);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 price = scaled > 0 ? uint256(scaled) : 0;
        return price < MIN_PRICE ? MIN_PRICE : price;
    }

    /// Buys `tradeValue` worth of shares. The 2% fee is charged on top, so send tradeValue + fee.
    function buy(address juror, uint256 tradeValue) external payable returns (uint256 shares) {
        IAtsToken token = _token(juror);
        if (tradeValue == 0) revert ZeroAmount();
        uint256 fee = tradeValue * TRADE_FEE_BPS / BPS;
        if (msg.value != tradeValue + fee) revert WrongPayment(tradeValue + fee, msg.value);

        uint256 price = priceOf(juror);
        shares = tradeValue * (10 ** shareDecimals[juror]) / price;
        if (shares == 0) revert NothingToTrade();

        uint256 toTreasury = tradeValue * TREASURY_SHARE_BPS / BPS;
        reserveOf[juror] += tradeValue - toTreasury;
        emit SharesBought(juror, msg.sender, shares, tradeValue, fee, price);

        treasury.fund{value: toTreasury}(juror);
        resolver.contributeToCaseBountyTreasury{value: fee}();
        // Reverts with ATS's AccountIsBlocked if the buyer is on this token's control list.
        token.mint(msg.sender, shares);
    }

    /// Sells shares back to the reserve. The 2% fee comes out of the proceeds, so the seller receives
    /// tradeValue minus the fee.
    function sell(address juror, uint256 shares) external returns (uint256 proceeds) {
        IAtsToken token = _token(juror);
        if (shares == 0) revert ZeroAmount();

        uint256 price = priceOf(juror);
        uint256 tradeValue = shares * price / (10 ** shareDecimals[juror]);
        if (tradeValue == 0) revert NothingToTrade();
        uint256 reserve = reserveOf[juror];
        if (reserve < tradeValue) revert InsufficientReserve(reserve, tradeValue);

        // tradeValue is already rounded down to the tinybar; the fee is taken from that figure.
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 fee = tradeValue * TRADE_FEE_BPS / BPS;
        proceeds = tradeValue - fee;
        reserveOf[juror] = reserve - tradeValue;
        emit SharesSold(juror, msg.sender, shares, tradeValue, fee, price);

        token.burn(msg.sender, shares);
        resolver.contributeToCaseBountyTreasury{value: fee}();
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = msg.sender.call{value: proceeds}("");
        if (!ok) revert TransferFailed();
    }

    function _token(address juror) private view returns (IAtsToken token) {
        token = shareToken[juror];
        if (address(token) == address(0)) revert UnknownShareToken();
    }
}

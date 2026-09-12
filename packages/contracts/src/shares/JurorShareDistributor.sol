// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAtsToken, IAtsDividends} from "./IAtsToken.sol";

/// Pays a juror's skim to that juror's shareholders.
///
/// One distributor per juror, set as that juror's `distributionAddress` in the resolver. The resolver sends the
/// skim here, this contract declares it as a dividend on the ATS token, and holders claim against the snapshot
/// ATS took. ATS does the declaring and the entitlement maths; ATS never moves money, because that is its
/// separate Mass Payout application, which we do not run. So: declared through ATS, paid by this contract.
contract JurorShareDistributor {
    /// Precision for the per-unit dividend rate handed to ATS. High enough that rounding stays sub-tinybar.
    uint8 public constant AMOUNT_DECIMALS = 18;
    /// After this, the operator may pull an unclaimed remainder back for the next distribution.
    uint256 public constant UNCLAIMED_PERIOD = 30 days;

    IAtsToken public immutable token;
    address public immutable resolver;
    address public immutable operator;
    address public immutable juror;

    /// Skim received but not yet attached to a dividend.
    uint256 public undeclared;
    mapping(uint256 dividendId => uint256) public potOf;
    mapping(uint256 dividendId => uint256) public paidOf;
    mapping(uint256 dividendId => uint256) public declaredAt;
    mapping(uint256 dividendId => mapping(address holder => bool)) public claimed;

    event SkimReceived(uint256 amount, uint256 undeclared);
    event DividendDeclared(uint256 indexed dividendId, uint256 pot, uint256 amountPerUnit, uint256 supply);
    event DividendClaimed(uint256 indexed dividendId, address indexed holder, uint256 amount);
    event UnclaimedReclaimed(uint256 indexed dividendId, uint256 amount);

    error NotResolver();
    error NotOperator();
    error ZeroAddress();
    error NothingToDeclare();
    error NoShareholders();
    error RecordDateNotReached();
    error AlreadyClaimed();
    error NothingToClaim();
    error TooEarlyToReclaim();
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IAtsToken token_, address resolver_, address operator_, address juror_) {
        if (address(token_) == address(0) || resolver_ == address(0) || operator_ == address(0) || juror_ == address(0))
        {
            revert ZeroAddress();
        }
        token = token_;
        resolver = resolver_;
        operator = operator_;
        juror = juror_;
    }

    /// Only the resolver funds this contract, and only through releaseDistribution.
    receive() external payable {
        if (msg.sender != resolver) revert NotResolver();
        undeclared += msg.value;
        emit SkimReceived(msg.value, undeclared);
    }

    /// Declares everything received so far as one ATS dividend. Needs ROLE_CORPORATE_ACTION on the token.
    /// The record date is now, so ATS snapshots current holders and the dividend is immediately claimable.
    function declare() external onlyOperator returns (uint256 dividendId) {
        uint256 pot = undeclared;
        if (pot == 0) revert NothingToDeclare();
        uint256 supply = token.totalSupply();
        if (supply == 0) revert NoShareholders();

        // Each unit of the token is owed pot/supply. ATS computes balance x amount / 10^decimals / 10^amountDecimals,
        // so amount carries both the token's decimals and our precision factor.
        uint256 amountPerUnit = (pot * (10 ** token.decimals()) * (10 ** AMOUNT_DECIMALS)) / supply;

        undeclared = 0;
        dividendId = IAtsDividends(address(token)).setDividend(
            IAtsDividends.Dividend({
                recordDate: block.timestamp,
                executionDate: block.timestamp,
                amount: amountPerUnit,
                amountDecimals: AMOUNT_DECIMALS
            })
        );
        potOf[dividendId] = pot;
        declaredAt[dividendId] = block.timestamp;
        // `undeclared` is zeroed before the ATS call, so a re-entrant declare finds nothing to declare.
        // forge-lint: disable-next-line(reentrancy-events)
        emit DividendDeclared(dividendId, pot, amountPerUnit, supply);
    }

    /// Holders claim their share, computed by ATS against its own snapshot.
    function claim(uint256 dividendId) external returns (uint256 payout) {
        if (claimed[dividendId][msg.sender]) revert AlreadyClaimed();
        IAtsDividends.DividendAmountFor memory owed =
            IAtsDividends(address(token)).getDividendAmountFor(dividendId, msg.sender);
        if (!owed.recordDateReached) revert RecordDateNotReached();

        payout = owed.denominator == 0 ? 0 : owed.numerator / owed.denominator;
        if (payout == 0) revert NothingToClaim();

        // Rounding, or a supply that grew after the snapshot, must never let claims exceed what was set aside.
        uint256 remaining = potOf[dividendId] - paidOf[dividendId];
        if (payout > remaining) payout = remaining;
        if (payout == 0) revert NothingToClaim();

        claimed[dividendId][msg.sender] = true;
        paidOf[dividendId] += payout;
        emit DividendClaimed(dividendId, msg.sender, payout);

        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();
    }

    /// Rounding dust and the shares of holders who never claim would otherwise sit here forever.
    function reclaimUnclaimed(uint256 dividendId) external onlyOperator returns (uint256 amount) {
        // forge-lint: disable-next-line(block-timestamp)
        if (declaredAt[dividendId] == 0 || block.timestamp < declaredAt[dividendId] + UNCLAIMED_PERIOD) {
            revert TooEarlyToReclaim();
        }
        amount = potOf[dividendId] - paidOf[dividendId];
        if (amount == 0) revert NothingToClaim();
        paidOf[dividendId] = potOf[dividendId];
        undeclared += amount;
        emit UnclaimedReclaimed(dividendId, amount);
    }

    function claimableOf(uint256 dividendId, address holder) external view returns (uint256) {
        if (claimed[dividendId][holder]) return 0;
        IAtsDividends.DividendAmountFor memory owed =
            IAtsDividends(address(token)).getDividendAmountFor(dividendId, holder);
        if (!owed.recordDateReached || owed.denominator == 0) return 0;
        uint256 payout = owed.numerator / owed.denominator;
        uint256 remaining = potOf[dividendId] - paidOf[dividendId];
        return payout > remaining ? remaining : payout;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Custodies each juror's HBAR. Anyone can fund a juror; only the resolver can move a juror's money out,
/// through exactly three paths: locking a stake, slashing a locked stake, and the capped x402 withdrawal.
/// Amounts are in the chain's native unit: tinybars on Hedera.
contract JurorTreasury {
    struct Juror {
        address hotWallet;
        uint256 available;
        uint256 windowStart;
        uint256 withdrawnInWindow;
    }

    address public immutable operator;
    uint256 public immutable withdrawalCap;
    uint256 public immutable withdrawalWindow;
    address public resolver;

    mapping(address juror => Juror) internal jurors;
    mapping(address juror => mapping(uint256 caseId => uint256)) public lockedStake;
    /// What settlement reads as a juror's x402 spend on a case. Only ever written at withdrawal time.
    mapping(address juror => mapping(uint256 caseId => uint256)) public x402Spend;

    event ResolverSet(address indexed resolver);
    event JurorRegistered(address indexed juror, address indexed hotWallet);
    event Funded(address indexed juror, address indexed from, uint256 amount);
    event StakeLocked(address indexed juror, uint256 indexed caseId, uint256 amount);
    event StakeUnlocked(address indexed juror, uint256 indexed caseId, uint256 amount);
    event StakeSlashed(address indexed juror, uint256 indexed caseId, uint256 amount);
    event X402Withdrawn(address indexed juror, uint256 indexed caseId, address hotWallet, uint256 amount);

    error NotOperator();
    error NotResolver();
    error ResolverAlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadyRegistered();
    error UnknownJuror();
    error HotWalletIsJurorKey();
    error InsufficientBalance(uint256 available, uint256 requested);
    error StakeAlreadyLocked();
    error NoLockedStake();
    error WithdrawalCapExceeded(uint256 remainingInWindow, uint256 requested);
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    modifier registered(address juror) {
        if (jurors[juror].hotWallet == address(0)) revert UnknownJuror();
        _;
    }

    constructor(address operator_, uint256 withdrawalCap_, uint256 withdrawalWindow_) {
        if (operator_ == address(0)) revert ZeroAddress();
        if (withdrawalCap_ == 0 || withdrawalWindow_ == 0) revert ZeroAmount();
        operator = operator_;
        withdrawalCap = withdrawalCap_;
        withdrawalWindow = withdrawalWindow_;
    }

    /// One-time wiring: the resolver and the treasury each need the other's address.
    function setResolver(address resolver_) external onlyOperator {
        if (resolver != address(0)) revert ResolverAlreadySet();
        if (resolver_ == address(0)) revert ZeroAddress();
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    function registerJuror(address juror, address hotWallet) external onlyOperator {
        if (juror == address(0) || hotWallet == address(0)) revert ZeroAddress();
        if (juror == hotWallet) revert HotWalletIsJurorKey();
        if (jurors[juror].hotWallet != address(0)) revert AlreadyRegistered();
        jurors[juror].hotWallet = hotWallet;
        emit JurorRegistered(juror, hotWallet);
    }

    function fund(address juror) external payable registered(juror) {
        if (msg.value == 0) revert ZeroAmount();
        jurors[juror].available += msg.value;
        emit Funded(juror, msg.sender, msg.value);
    }

    function lockStake(address juror, uint256 caseId, uint256 amount) external onlyResolver registered(juror) {
        if (amount == 0) revert ZeroAmount();
        if (lockedStake[juror][caseId] != 0) revert StakeAlreadyLocked();
        Juror storage j = jurors[juror];
        if (j.available < amount) revert InsufficientBalance(j.available, amount);
        j.available -= amount;
        lockedStake[juror][caseId] = amount;
        emit StakeLocked(juror, caseId, amount);
    }

    /// Returns a locked stake to the juror's available balance: a correct ruling, or a cancelled case.
    function unlockStake(address juror, uint256 caseId) external onlyResolver returns (uint256 amount) {
        amount = lockedStake[juror][caseId];
        if (amount == 0) revert NoLockedStake();
        lockedStake[juror][caseId] = 0;
        jurors[juror].available += amount;
        emit StakeUnlocked(juror, caseId, amount);
    }

    /// Takes a locked stake out of the juror's treasury and sends it to the resolver for the case's pool.
    function slashStake(address juror, uint256 caseId) external onlyResolver returns (uint256 amount) {
        amount = lockedStake[juror][caseId];
        if (amount == 0) revert NoLockedStake();
        lockedStake[juror][caseId] = 0;
        emit StakeSlashed(juror, caseId, amount);
        _send(msg.sender, amount);
    }

    /// Pays x402 evidence money to the juror's hot wallet. The case id is recorded here, at withdrawal time,
    /// and the withdrawn amount counts as spent on that case whether or not the hot wallet uses all of it.
    function withdrawForX402(address juror, uint256 caseId, uint256 amount) external onlyResolver registered(juror) {
        if (amount == 0) revert ZeroAmount();
        Juror storage j = jurors[juror];
        if (j.available < amount) revert InsufficientBalance(j.available, amount);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= j.windowStart + withdrawalWindow) {
            j.windowStart = block.timestamp;
            j.withdrawnInWindow = 0;
        }
        if (j.withdrawnInWindow + amount > withdrawalCap) {
            revert WithdrawalCapExceeded(withdrawalCap - j.withdrawnInWindow, amount);
        }
        j.withdrawnInWindow += amount;
        j.available -= amount;
        x402Spend[juror][caseId] += amount;
        emit X402Withdrawn(juror, caseId, j.hotWallet, amount);
        _send(j.hotWallet, amount);
    }

    function balanceOf(address juror) external view returns (uint256) {
        return jurors[juror].available;
    }

    function hotWalletOf(address juror) external view returns (address) {
        return jurors[juror].hotWallet;
    }

    /// Only reachable from resolver-gated functions, and only to the resolver or a registered hot wallet.
    function _send(address to, uint256 amount) private {
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

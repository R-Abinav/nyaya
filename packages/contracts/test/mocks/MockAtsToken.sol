// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAtsToken, IAtsDividends, AtsRoles} from "../../src/shares/IAtsToken.sol";

/// Test-only stand-in for an ATS security token, mirroring asset-tokenization-contracts version 8.0.0.
///
/// It reproduces the parts Nyaya depends on, in ATS's own order:
///   mint  -> onlyAnyRole(ROLE_ISSUER, ROLE_AGENT)    then onlyCompliant -> control list check on the recipient
///   burn  -> onlyAnyRole(ROLE_CONTROLLER, ROLE_AGENT)
/// The role check runs first, so a caller with no role and a blocked recipient gets AccountHasNoRoles,
/// exactly as real ATS would. Control list is in blacklist mode: listed addresses are blocked.
///
/// This mock exists for iteration speed only. The evidence that the integration works is a real ATS token
/// on Hedera testnet; forge cannot fork Hedera, because Hashio rejects the EIP-1898 block-hash parameters
/// forking depends on.
contract MockAtsToken is IAtsToken, IAtsDividends {
    uint8 internal immutable _decimals;
    uint256 public totalSupply;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => bool) public isInControlList;
    mapping(bytes32 role => mapping(address account => bool)) public hasRole;

    /// Dividends: ATS records a snapshot at declaration and only computes entitlements; it moves no money.
    Dividend[] internal dividends;
    address[] internal holders;
    mapping(address holder => bool) internal knownHolder;
    mapping(uint256 dividendId => mapping(address holder => uint256)) internal snapshotBalance;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    function grantRole(bytes32 role, address account) external {
        hasRole[role][account] = true;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _checkAnyRole(AtsRoles.ISSUER, AtsRoles.AGENT);
        _checkCompliant(to);
        balanceOf[to] += amount;
        totalSupply += amount;
        if (!knownHolder[to]) {
            knownHolder[to] = true;
            holders.push(to);
        }
    }

    /// ROLE_CORPORATE_ACTION, recordDate != 0, executionDate >= recordDate. Takes the snapshot, as ATS does.
    function setDividend(Dividend calldata newDividend) external returns (uint256 dividendId_) {
        _checkAnyRole(AtsRoles.CORPORATE_ACTION, AtsRoles.CORPORATE_ACTION);
        require(newDividend.recordDate != 0, "InvalidTimestamp");
        require(newDividend.executionDate >= newDividend.recordDate, "WrongDates");
        dividends.push(newDividend);
        dividendId_ = dividends.length;
        for (uint256 i = 0; i < holders.length; ++i) {
            snapshotBalance[dividendId_][holders[i]] = balanceOf[holders[i]];
        }
    }

    function getDividendAmountFor(uint256 dividendId, address account)
        external
        view
        returns (DividendAmountFor memory owed)
    {
        Dividend memory d = dividends[dividendId - 1];
        if (block.timestamp < d.recordDate) return owed;
        owed.recordDateReached = true;
        owed.numerator = snapshotBalance[dividendId][account] * d.amount / (10 ** _decimals);
        owed.denominator = 10 ** d.amountDecimals;
    }

    function burn(address userAddress, uint256 amount) external {
        _checkAnyRole(AtsRoles.CONTROLLER, AtsRoles.AGENT);
        balanceOf[userAddress] -= amount;
        totalSupply -= amount;
    }

    function addToControlList(address account) external returns (bool) {
        _checkAnyRole(AtsRoles.CONTROL_LIST, AtsRoles.CONTROL_LIST);
        isInControlList[account] = true;
        return true;
    }

    function _checkAnyRole(bytes32 roleA, bytes32 roleB) private view {
        if (hasRole[roleA][msg.sender] || hasRole[roleB][msg.sender]) return;
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = roleA;
        roles[1] = roleB;
        revert AccountHasNoRoles(msg.sender, roles);
    }

    /// ATS validates the recipient through _isCompliant -> _validateAccountForTransfer -> isAbleToAccess.
    function _checkCompliant(address to) private view {
        if (isInControlList[to]) revert AccountIsBlocked(to);
    }
}

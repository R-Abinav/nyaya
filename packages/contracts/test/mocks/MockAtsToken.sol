// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAtsToken, AtsRoles} from "../../src/shares/IAtsToken.sol";

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
contract MockAtsToken is IAtsToken {
    uint8 internal immutable _decimals;
    uint256 public totalSupply;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => bool) public isInControlList;
    mapping(bytes32 role => mapping(address account => bool)) public hasRole;

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

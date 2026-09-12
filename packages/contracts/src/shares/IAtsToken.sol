// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// The slice of an Asset Tokenization Studio security token that Nyaya calls.
/// Signatures, role hashes and error shapes are taken from the published asset-tokenization-contracts
/// package, version 8.0.0.
interface IAtsToken {
    /// Thrown when the control list denies an address. Minting to a listed address reverts with this,
    /// because ATS's `mint` runs `onlyCompliant`, which validates the recipient against the control list.
    error AccountIsBlocked(address account);
    /// Thrown by `onlyAnyRole` before any compliance check, when the caller holds none of the accepted roles.
    error AccountHasNoRoles(address account, bytes32[] roles);

    /// ROLE_ISSUER or ROLE_AGENT. Reverts if the recipient is blocked by the control list.
    function mint(address to, uint256 amount) external;
    /// ROLE_CONTROLLER or ROLE_AGENT.
    function burn(address userAddress, uint256 amount) external;
    /// ROLE_CONTROL_LIST. In blacklist mode, a listed address can neither receive nor transfer.
    function addToControlList(address account) external returns (bool success_);
    function isInControlList(address account) external view returns (bool);

    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// Role identifiers from ATS `contracts/constants/roles.sol` v8.0.0.
library AtsRoles {
    bytes32 internal constant ISSUER = 0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f;
    bytes32 internal constant CONTROLLER = 0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e;
    bytes32 internal constant CONTROL_LIST = 0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d;
    bytes32 internal constant AGENT = 0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b;
    bytes32 internal constant CORPORATE_ACTION = 0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd;
}

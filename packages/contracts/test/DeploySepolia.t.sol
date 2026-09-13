// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeploySepoliaScript} from "../script/DeploySepolia.s.sol";

/// The deploy script's constant role bitmaps are decimal literals, chosen so they can be cross-checked
/// against step 10's real on-chain confirmation (`roles(ROOT_RESOURCE, operator)` read back after deploy)
/// without re-deriving the bit shifts by eye every time. This test recomputes all three from the same
/// per-bit definitions in script/ens/roles.ts (RegistryRolesLib.sol / PermissionedResolverLib.sol at the
/// pinned commit) and asserts they match exactly — the goal is to catch a transcription error here, in a
/// free local test, rather than after a real Sepolia broadcast.
///
/// The exposer contract exists only because the constants on DeploySepoliaScript are `internal`: exposing
/// them as public getters costs nothing at runtime (they're still constants) and avoids duplicating the
/// literals a second time in this file, which would defeat the point of cross-checking them.
contract DeploySepoliaScriptExposer is DeploySepoliaScript {
    function operatorUserRegistryRootBitmap() external pure returns (uint256) {
        return OPERATOR_USER_REGISTRY_ROOT_BITMAP;
    }

    function operatorResolverRootBitmap() external pure returns (uint256) {
        return OPERATOR_RESOLVER_ROOT_BITMAP;
    }

    function subnameOwnerBitmap() external pure returns (uint256) {
        return SUBNAME_OWNER_BITMAP;
    }
}

contract DeploySepoliaTest is Test {
    DeploySepoliaScriptExposer internal exposer;

    function setUp() public {
        exposer = new DeploySepoliaScriptExposer();
    }

    function _adminOf(uint256 roleBit) internal pure returns (uint256) {
        return roleBit << 128;
    }

    /// RegistryRolesLib.sol bits, recomputed independently of the deploy script's literal: REGISTRAR,
    /// SET_SUBREGISTRY, SET_RESOLVER, RENEW, UNREGISTER, UPGRADE (each with its admin counterpart), plus
    /// CAN_TRANSFER_ADMIN (admin-only, no non-admin counterpart).
    function test_OperatorUserRegistryRootBitmapMatchesTheBitDerivation() public view {
        uint256 expected = (1 << 0) | _adminOf(1 << 0) // REGISTRAR
            | (1 << 20) | _adminOf(1 << 20) // SET_SUBREGISTRY
            | (1 << 24) | _adminOf(1 << 24) // SET_RESOLVER
            | (1 << 16) | _adminOf(1 << 16) // RENEW
            | (1 << 12) | _adminOf(1 << 12) // UNREGISTER
            | (1 << 124) | _adminOf(1 << 124) // UPGRADE
            | _adminOf(1 << 28); // CAN_TRANSFER_ADMIN

        assertEq(exposer.operatorUserRegistryRootBitmap(), expected);
    }

    /// PermissionedResolverLib.sol bits, recomputed independently of the deploy script's literal: SET_TEXT,
    /// SET_ADDR, CLEAR, UPGRADE (each with its admin counterpart), plus SET_ALIAS (root-only, no admin
    /// counterpart of its own in this bitmap).
    function test_OperatorResolverRootBitmapMatchesTheBitDerivation() public view {
        uint256 expected = (1 << 4) | _adminOf(1 << 4) // SET_TEXT
            | (1 << 0) | _adminOf(1 << 0) // SET_ADDR
            | (1 << 32) | _adminOf(1 << 32) // CLEAR
            | (1 << 28) // SET_ALIAS
            | (1 << 124) | _adminOf(1 << 124); // UPGRADE

        assertEq(exposer.operatorResolverRootBitmap(), expected);
    }

    /// RegistryRolesLib.sol bits again, this time the bitmap `ETHRegistrar.register()` itself grants a
    /// name's owner (REGISTRATION_ROLE_BITMAP) — reused here for the subname owner grant.
    function test_SubnameOwnerBitmapMatchesEthRegistrarsOwnGrant() public view {
        uint256 expected = (1 << 20) | _adminOf(1 << 20) // SET_SUBREGISTRY
            | (1 << 24) | _adminOf(1 << 24) // SET_RESOLVER
            | _adminOf(1 << 28); // CAN_TRANSFER_ADMIN

        assertEq(exposer.subnameOwnerBitmap(), expected);
    }

    /// The two ROOT bitmaps are additionally pinned to the exact decimal values step 10's real deploy
    /// confirmed on-chain (`Operator roles confirmed on-chain: ...` in that step's script output), so a
    /// change to either literal is caught even if the bit derivation above were also changed to match it.
    function test_RootBitmapsMatchWhatStep10ActuallyConfirmedOnChain() public view {
        assertEq(
            exposer.operatorUserRegistryRootBitmap(),
            7_237_005_577_332_262_213_973_186_563_140_427_590_759_879_257_125_348_269_011_527_252_833_064_783_873
        );
        assertEq(
            exposer.operatorResolverRootBitmap(),
            7_237_005_577_332_262_213_973_186_564_504_495_883_966_344_845_394_732_618_026_211_259_459_611_656_209
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, VmSafe, console} from "forge-std/Script.sol";
import {NyayaAnchor} from "../src/anchor/NyayaAnchor.sol";

/// Minimal interfaces onto ENSv2 protocol contracts we don't own and don't vendor — only what this script
/// calls. ABI-compatible with the real interfaces (an interface-typed Solidity parameter and a plain
/// `address` encode identically), confirmed against contracts-v2 at the pinned commit used in step 10.
interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address proxy);
}

interface IUserRegistryLike {
    function initialize(address rootAccount, uint256 roleBitmap) external;
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
}

interface IPermissionedResolverLike {
    function initialize(address admin, uint256 roleBitmap, bytes[] calldata setters) external;
    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool);
}

interface IEthRegistryLike {
    function setSubregistry(uint256 anyId, address registry) external;
    function setResolver(uint256 anyId, address resolver) external;
}

/// Sepolia only. Deploys NyayaAnchor and fresh ENSv2 UserRegistry/PermissionedResolver instances, wires
/// nyaya.eth to point at them, and re-registers the three juror subnames with Enhanced Access Control —
/// all in one broadcast, so nothing here is a manual follow-up step.
///
/// nyaya.eth itself and the three juror identities are NOT redeployed: the name's tokenId/expiry and each
/// juror's address are read from the CURRENT deployments/sepolia.json before this script overwrites it.
/// Only the contract instances that manage them (the subregistry, the resolver) are fresh — registering a
/// name inside our own subregistry needs no commit-reveal wait, unlike registering nyaya.eth itself did.
///
/// The dry-run guard: `deployments/sepolia.json` is written only when `vm.isContext(ScriptBroadcast)` is
/// true. Verified, not assumed — see test/DeploySepolia.t.sol and script/verify-sepolia-deploy-guard.sh,
/// which run this script both ways against a local anvil and assert the file's actual behavior each time.
contract DeploySepoliaScript is Script {
    // Verified ENSv2 Sepolia protocol addresses, the same ones in script/ens/ensConfig.ts: matched
    // byte-for-byte against contracts-v2's own pinned-commit deployment manifest in step 10.
    address internal constant VERIFIABLE_FACTORY = 0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef;
    address internal constant USER_REGISTRY_IMPL = 0x624a25d67B59D587752EbEc8DdeD8827dAe52050;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e;
    address internal constant ETH_REGISTRY = 0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2;

    // Role bitmaps. Bit-by-bit derivation lives in script/ens/roles.ts (RegistryRolesLib.sol /
    // PermissionedResolverLib.sol at the same pinned commit); the two ROOT bitmaps here are the exact
    // decimal values step 10 already confirmed on-chain via `roles(ROOT_RESOURCE, operator)`, and
    // test/DeploySepolia.t.sol recomputes all three from the same bit shifts to cross-check the literals.
    uint256 internal constant OPERATOR_USER_REGISTRY_ROOT_BITMAP =
        7_237_005_577_332_262_213_973_186_563_140_427_590_759_879_257_125_348_269_011_527_252_833_064_783_873;
    uint256 internal constant OPERATOR_RESOLVER_ROOT_BITMAP =
        7_237_005_577_332_262_213_973_186_564_504_495_883_966_344_845_394_732_618_026_211_259_459_611_656_209;
    /// Granted to the subname owner at registration: SET_SUBREGISTRY(+admin), SET_RESOLVER(+admin),
    /// CAN_TRANSFER_ADMIN. Mirrors ETHRegistrar's own REGISTRATION_ROLE_BITMAP, read from its source.
    uint256 internal constant SUBNAME_OWNER_BITMAP = 97_409_655_027_181_761_882_228_017_414_928_043_058_140_282_880;

    string internal constant DEPLOYMENTS_PATH = "deployments/sepolia.json";

    /// Everything read from the existing address file before this script overwrites it, and everything
    /// freshly deployed — bundled into one struct so `run()` itself stays under the local-variable count
    /// that triggers solc's stack-too-deep in this function.
    struct DeployState {
        uint256 nyayaTokenId;
        uint64 nyayaExpiry;
        address jurorA;
        address jurorB;
        address jurorC;
        address anchor;
        address subregistry;
        address resolver;
    }

    function run() external {
        uint256 operatorKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address operator = vm.addr(operatorKey);
        // forge-lint: disable-next-line(unsafe-typecast)
        bool isBroadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);

        DeployState memory s = _readExisting();

        vm.startBroadcast(operatorKey);
        s = _deployAndWire(s, operator);
        vm.stopBroadcast();

        console.log("NyayaAnchor:", s.anchor);
        console.log("Subregistry (UserRegistry):", s.subregistry);
        console.log("Resolver (PermissionedResolver):", s.resolver);

        if (isBroadcast) {
            _writeAddressFile(s);
            console.log("Wrote", DEPLOYMENTS_PATH);
        } else {
            console.log("Dry run: did NOT write", DEPLOYMENTS_PATH);
        }
    }

    function _readExisting() internal returns (DeployState memory s) {
        string memory existing = vm.readFile(DEPLOYMENTS_PATH);
        s.nyayaTokenId = vm.parseJsonUint(existing, ".ens.nyayaTokenId");
        s.nyayaExpiry = uint64(vm.parseJsonUint(existing, ".ens.nyayaExpiry"));
        s.jurorA = vm.parseJsonAddress(existing, ".ens.jurors.juror-a.address");
        s.jurorB = vm.parseJsonAddress(existing, ".ens.jurors.juror-b.address");
        s.jurorC = vm.parseJsonAddress(existing, ".ens.jurors.juror-c.address");
    }

    function _deployAndWire(DeployState memory s, address operator) internal returns (DeployState memory) {
        s.anchor = address(new NyayaAnchor(operator));

        s.subregistry = IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(
            USER_REGISTRY_IMPL,
            uint256(keccak256(bytes("nyaya.subregistry.v2"))),
            abi.encodeCall(IUserRegistryLike.initialize, (operator, OPERATOR_USER_REGISTRY_ROOT_BITMAP))
        );

        s.resolver = IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(
            PERMISSIONED_RESOLVER_IMPL,
            uint256(keccak256(bytes("nyaya.resolver.v2"))),
            abi.encodeCall(
                IPermissionedResolverLike.initialize, (operator, OPERATOR_RESOLVER_ROOT_BITMAP, new bytes[](0))
            )
        );

        IEthRegistryLike(ETH_REGISTRY).setSubregistry(s.nyayaTokenId, s.subregistry);
        IEthRegistryLike(ETH_REGISTRY).setResolver(s.nyayaTokenId, s.resolver);

        _registerAndAuthorize(s.subregistry, s.resolver, "juror-a", s.jurorA, s.nyayaExpiry, operator);
        _registerAndAuthorize(s.subregistry, s.resolver, "juror-b", s.jurorB, s.nyayaExpiry, operator);
        _registerAndAuthorize(s.subregistry, s.resolver, "juror-c", s.jurorC, s.nyayaExpiry, operator);

        return s;
    }

    /// Registers `label.nyaya.eth` inside the fresh subregistry (owner = operator, resolver = the fresh
    /// resolver, no sub-subregistry, expiry capped at nyaya.eth's own) and grants that juror's own key
    /// write access to exactly `profile`/`strategy` on the new resolver — never `score`/`returnRate`, and
    /// never `resource(node, 0)`. Mirrors script/ens/5_createJurorSubnames.ts and 6_configureEac.ts.
    function _registerAndAuthorize(
        address subregistry,
        address resolver,
        string memory label,
        address juror,
        uint64 expiry,
        address operator
    ) internal {
        IUserRegistryLike(subregistry).register(label, operator, address(0), resolver, SUBNAME_OWNER_BITMAP, expiry);
        bytes memory dnsName = _dnsName(label);
        IPermissionedResolverLike(resolver).authorizeTextRoles(dnsName, "profile", juror, true);
        IPermissionedResolverLike(resolver).authorizeTextRoles(dnsName, "strategy", juror, true);
    }

    /// DNS-wire encodes "`label`.nyaya.eth", matching `NameCoder.encode`'s documented algorithm exactly
    /// (`encode("aaa.bb.c") = "\x03aaa\x02bb\x01c\x00"`): each label length-prefixed, a trailing zero byte.
    function _dnsName(string memory label) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(label).length), label, uint8(5), "nyaya", uint8(3), "eth", uint8(0));
    }

    /// Unconditionally overwrites deployments/sepolia.json with exactly what this run deployed — never a
    /// partial update layered onto the old file.
    function _writeAddressFile(DeployState memory s) internal {
        string memory contractsKey = "contracts";
        vm.serializeAddress(contractsKey, "NyayaAnchor", s.anchor);
        vm.serializeAddress(contractsKey, "UserRegistry", s.subregistry);
        string memory contractsJson = vm.serializeAddress(contractsKey, "PermissionedResolver", s.resolver);

        string memory rootKey = "root";
        vm.serializeString(rootKey, "network", "sepolia");
        vm.serializeString(rootKey, "contracts", contractsJson);
        vm.serializeUint(rootKey, "nyayaTokenId", s.nyayaTokenId);
        vm.serializeUint(rootKey, "nyayaExpiry", s.nyayaExpiry);
        vm.serializeAddress(rootKey, "jurorA", s.jurorA);
        vm.serializeAddress(rootKey, "jurorB", s.jurorB);
        string memory finalJson = vm.serializeAddress(rootKey, "jurorC", s.jurorC);

        vm.writeJson(finalJson, DEPLOYMENTS_PATH);
    }
}

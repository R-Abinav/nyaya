// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";

/// Throwaway contract proving Foundry deploys to and transacts on Hedera through the JSON-RPC relay.
// forge-lint: disable-next-line(locked-ether, multi-contract-file)
contract HederaSmoke {
    uint256 public pings;

    event Pinged(address indexed from, uint256 value, bytes echoed);

    function ping(bytes calldata note) external payable {
        // Memory-to-memory copy so the cancun MCOPY opcode actually executes on-chain.
        bytes memory copy = note;
        pings += 1;
        emit Pinged(msg.sender, msg.value, abi.encode(copy));
    }
}

// forge-lint: disable-next-line(multi-contract-file)
contract HederaSmokeScript is Script {
    // 1 tinybar expressed in the relay's 18-decimal weibars; the Pinged event shows what the EVM sees.
    uint256 internal constant ONE_TINYBAR_IN_WEIBAR = 1e10;

    function run() external {
        vm.startBroadcast(vm.envUint("HEDERA_PRIVATE_KEY"));
        HederaSmoke smoke = new HederaSmoke();
        // forge-lint: disable-next-line(arbitrary-send-eth)
        smoke.ping{value: ONE_TINYBAR_IN_WEIBAR}("nyaya hedera smoke");
        vm.stopBroadcast();
        console.log("HederaSmoke deployed at", address(smoke));
    }
}

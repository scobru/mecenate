// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Mecenate} from "../src/Mecenate.sol";

/// forge script script/Deploy.s.sol --rpc-url <rpc> --account <keystore> --broadcast
/// then put the address in ui/src/config.ts under that chain's `mecenate`.
contract Deploy is Script {
    function run() external returns (Mecenate m) {
        vm.startBroadcast();
        m = new Mecenate();
        vm.stopBroadcast();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";

/// Usage: G_TOKEN=0x.. VOUCHER_SIGNER=0x.. VAULT_OWNER=0x.. MAX_PER_VOUCHER=1000000000000000000000 \
///        DAILY_CAP=5000000000000000000000 forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
contract Deploy is Script {
    function run() external returns (MoonshardVault vault) {
        address token = vm.envAddress("G_TOKEN");
        address signer = vm.envAddress("VOUCHER_SIGNER");
        address owner = vm.envAddress("VAULT_OWNER");
        uint256 maxPerVoucher = vm.envUint("MAX_PER_VOUCHER");
        uint256 dailyCap = vm.envUint("DAILY_CAP");
        vm.startBroadcast();
        vault = new MoonshardVault(IERC20(token), signer, owner, maxPerVoucher, dailyCap);
        vm.stopBroadcast();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// What the deploy scripts share: their settings come from contracts/.env (Foundry reads it by itself; copy
/// contracts/.env.example to start), and a missing setting is named before anything is sent.
abstract contract MoonshardScript is Script {
    /// A private key as it was pasted: with 0x in front (as Foundry prints it) or without (as wallet apps export it).
    function parseKey(string memory raw) public pure returns (uint256) {
        bytes memory b = bytes(raw);
        bool prefixed = b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X");
        return vm.parseUint(prefixed ? raw : string.concat("0x", raw));
    }

    /// Starts sending transactions as the deployer: the key in DEPLOYER_PRIVATE_KEY, or, when that is empty, the wallet
    /// given on the command line (--account with --sender, --ledger, ...). Returns the deployer's address.
    function startBroadcastAsDeployer() internal returns (address deployer) {
        string memory raw = vm.envOr("DEPLOYER_PRIVATE_KEY", string(""));
        if (bytes(raw).length == 0) {
            vm.startBroadcast();
            (, deployer,) = vm.readCallers();
            return deployer;
        }
        uint256 key = parseKey(raw);
        vm.startBroadcast(key);
        return vm.addr(key);
    }

    /// An address setting that must be filled in.
    function requiredAddress(string memory name, string memory what) internal view returns (address) {
        string memory raw = vm.envOr(name, string(""));
        require(bytes(raw).length > 0, string.concat("Set ", name, " in contracts/.env: ", what));
        return vm.parseAddress(raw);
    }

    /// An address setting that may be left empty.
    function optionalAddress(string memory name, address fallbackValue) internal view returns (address) {
        string memory raw = vm.envOr(name, string(""));
        return bytes(raw).length == 0 ? fallbackValue : vm.parseAddress(raw);
    }

    /// An amount in whole G$, returned in wei (18 decimals).
    function amountG(string memory name, uint256 fallbackG) internal view returns (uint256) {
        string memory raw = vm.envOr(name, string(""));
        return (bytes(raw).length == 0 ? fallbackG : vm.parseUint(raw)) * 1e18;
    }
}

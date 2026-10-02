// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";
import {MoonshardScript} from "./MoonshardScript.sol";

/// Deploys MoonshardVault, the prize vault, and (with FUND_G) puts the prize pool in it. Settings: contracts/.env.
///
///   cp .env.example .env       # then fill it in (never the template itself: it is pushed with the code)
///   forge script script/Deploy.s.sol --rpc-url https://forno.celo.org --broadcast --verify
///
/// --verify publishes the vault's source code on Celoscan, with ETHERSCAN_API_KEY from contracts/.env.
contract Deploy is MoonshardScript {
    address constant G_DOLLAR = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    function run() external returns (MoonshardVault vault) {
        address signer = requiredAddress("VOUCHER_SIGNER", "the address (not the key) of the server's voucher signer");
        address token = optionalAddress("G_TOKEN", G_DOLLAR);
        uint256 maxPerVoucher = amountG("MAX_PER_VOUCHER_G", 1000);
        uint256 dailyCap = amountG("DAILY_CAP_G", 5000);
        uint256 fund = amountG("FUND_G", 0);

        address deployer = startBroadcastAsDeployer();
        address owner = optionalAddress("VAULT_OWNER", deployer);
        vault = new MoonshardVault(IERC20(token), signer, owner, maxPerVoucher, dailyCap);
        if (fund > 0) require(IERC20(token).transfer(address(vault), fund), "the G$ transfer into the vault failed");
        vm.stopBroadcast();

        console.log("MoonshardVault:  ", address(vault));
        console.log("Owner:           ", owner);
        console.log("Voucher signer:  ", signer);
        console.log("Per voucher, G$: ", maxPerVoucher / 1e18);
        console.log("Per day, G$:     ", dailyCap / 1e18);
        console.log("Prize pool, G$:  ", fund / 1e18);
        console.log("");
        console.log("Server settings (server/.env, and the API's variables when deployed): VAULT_ADDRESS=", address(vault));
        console.log("Website settings (Vercel): VITE_VAULT_ADDRESS=", address(vault));
        console.log("");
        console.log("To publish its code on Celoscan, if --verify was not used or did not go through (the vault is deployed");
        console.log("either way), run this in contracts/ with ETHERSCAN_API_KEY in contracts/.env:");
        console.log(
            string.concat(
                "forge verify-contract ",
                vm.toString(address(vault)),
                " src/MoonshardVault.sol:MoonshardVault --chain-id 42220 --constructor-args ",
                vm.toString(abi.encode(token, signer, owner, maxPerVoucher, dailyCap)),
                " --watch"
            )
        );
    }
}

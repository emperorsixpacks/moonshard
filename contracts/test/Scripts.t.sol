// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {RegisterApp} from "../script/RegisterApp.s.sol";

contract ScriptG is ERC20 {
    constructor() ERC20("Test G$", "G$") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Stands in for GoodDollar's EngagementRewards at its real address and remembers the one call it gets.
contract RecordingEngagement {
    address public app;
    address public rewardReceiver;
    uint8 public userAndInviterPercentage;
    uint8 public userPercentage;
    string public description;
    string public url;
    string public email;

    function applyApp(address app_, address receiver_, uint8 both_, uint8 user_, string calldata d_, string calldata u_, string calldata e_)
        external
    {
        (app, rewardReceiver, userAndInviterPercentage, userPercentage, description, url, email) =
            (app_, receiver_, both_, user_, d_, u_, e_);
    }
}

/// The deploy scripts read contracts/.env, the way most Foundry projects do: the owner pastes the deployer's private key
/// and the settings there and runs one command. Environment variables are shared by every test in the process, and forge
/// runs test contracts and functions in parallel, so everything that sets them is in ONE test function, step by step.
contract ScriptsTest is Test {
    uint256 constant KEY = 0xA11CE;
    address constant SIGNER = address(0x5161);
    address constant G_DOLLAR = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address constant APP = address(0xA99);
    address constant ENGAGEMENT_REWARDS = 0x25db74CF4E7BA120526fd87e159CF656d94bAE43;

    function settings(string memory key, string memory owner, string memory fund, address token) internal {
        vm.setEnv("DEPLOYER_PRIVATE_KEY", key);
        vm.setEnv("VOUCHER_SIGNER", vm.toString(SIGNER));
        vm.setEnv("VAULT_OWNER", owner);
        vm.setEnv("MAX_PER_VOUCHER_G", "1000");
        vm.setEnv("DAILY_CAP_G", "5000");
        vm.setEnv("FUND_G", fund);
        vm.setEnv("G_TOKEN", token == address(0) ? "" : vm.toString(token));
    }

    function test_scriptsReadContractsEnv() public {
        checkDeploy();
        checkRegisterApp();
    }

    function checkDeploy() internal {
        address deployer = vm.addr(KEY);
        Deploy script = new Deploy();

        // the key as Foundry prints it (0x...), the vault owned by the deployer, the limits in whole G$
        settings(vm.toString(bytes32(KEY)), "", "0", address(0));
        MoonshardVault vault = script.run();
        assertEq(vault.owner(), deployer, "the deployer owns the vault");
        assertEq(vault.signer(), SIGNER, "the voucher signer");
        assertEq(address(vault.token()), G_DOLLAR, "G$ on Celo unless told otherwise");
        assertEq(vault.maxPerVoucher(), 1000e18, "1,000 G$ per voucher");
        assertEq(vault.dailyCap(), 5000e18, "5,000 G$ a day");

        // the key as a wallet app exports it: no 0x in front
        string memory bare = vm.replace(vm.toString(bytes32(KEY)), "0x", "");
        settings(bare, "", "0", address(0));
        assertEq(script.run().owner(), deployer, "a key without 0x is the same key");

        // another owner, for example a Safe
        settings(vm.toString(bytes32(KEY)), vm.toString(address(0x5AFE)), "0", address(0));
        assertEq(script.run().owner(), address(0x5AFE), "VAULT_OWNER takes over ownership");

        // funded straight away from the deployer's G$
        ScriptG token = new ScriptG();
        token.mint(deployer, 25_000e18);
        settings(vm.toString(bytes32(KEY)), "", "10000", address(token));
        vault = script.run();
        assertEq(token.balanceOf(address(vault)), 10_000e18, "the vault holds the prize pool");
        assertEq(token.balanceOf(deployer), 15_000e18, "taken from the deployer");

        // a setting left empty is named, before anything is sent
        settings(vm.toString(bytes32(KEY)), "", "0", address(0));
        vm.setEnv("VOUCHER_SIGNER", "");
        vm.expectRevert(bytes("Set VOUCHER_SIGNER in contracts/.env: the address (not the key) of the server's voucher signer"));
        script.run();
    }

    function checkRegisterApp() internal {
        vm.etch(ENGAGEMENT_REWARDS, address(new RecordingEngagement()).code);
        RecordingEngagement engagement = RecordingEngagement(ENGAGEMENT_REWARDS);
        RegisterApp script = new RegisterApp();

        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(KEY)));
        vm.setEnv("APP_SIGNER", vm.toString(APP));
        vm.setEnv("APP_URL", "https://moonshard.example");
        vm.setEnv("APP_EMAIL", "ops@moonshard.example");
        script.run();
        assertEq(engagement.app(), APP, "the app is the server's app signer");
        assertEq(engagement.rewardReceiver(), vm.addr(KEY), "the app's share goes to the deployer");
        assertEq(engagement.userAndInviterPercentage(), 80);
        assertEq(engagement.userPercentage(), 60, "so a player receives 2,400 of a 5,000 G$ claim");
        assertEq(engagement.url(), "https://moonshard.example");
        assertEq(engagement.email(), "ops@moonshard.example");
        assertEq(
            engagement.description(),
            "Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day."
        );

        vm.setEnv("APP_URL", "https://");
        vm.expectRevert(bytes("Set APP_URL in contracts/.env: the game's web address, https://..."));
        script.run();

        vm.setEnv("APP_URL", "https://moonshard.example");
        vm.setEnv("APP_SIGNER", "");
        vm.expectRevert(bytes("Set APP_SIGNER in contracts/.env: the address (not the key) of the server's app signer"));
        script.run();
    }
}

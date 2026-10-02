// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {MoonshardScript} from "./MoonshardScript.sol";

interface IEngagementRewards {
    function applyApp(
        address app,
        address rewardReceiver,
        uint8 userAndInviterPercentage,
        uint8 userPercentage,
        string calldata description,
        string calldata url,
        string calldata email
    ) external;
}

/// Registers Moonshard as an app with GoodDollar's Engagement Rewards (the first-boss bounty). Settings: contracts/.env.
/// GoodDollar must then approve the app before bounty claims work.
///
///   forge script script/RegisterApp.s.sol --rpc-url https://forno.celo.org --broadcast
///
/// 80 / 60: 80% of each reward goes to the player and their inviter, and 60% of that to the player, so of a 5,000 G$ claim
/// the player receives 2,400 G$. Nobody is named as inviter, so the rest (2,600 G$) goes to the deployer, the app's
/// reward receiver. The URL and the email are stored publicly on-chain.
contract RegisterApp is MoonshardScript {
    address constant ENGAGEMENT_REWARDS = 0x25db74CF4E7BA120526fd87e159CF656d94bAE43;
    string constant DESCRIPTION = "Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day.";

    function run() external {
        address app = requiredAddress("APP_SIGNER", "the address (not the key) of the server's app signer");
        string memory url = vm.envOr("APP_URL", string(""));
        string memory email = vm.envOr("APP_EMAIL", string(""));
        require(bytes(url).length > bytes("https://").length, "Set APP_URL in contracts/.env: the game's web address, https://...");
        require(bytes(email).length > 0, "Set APP_EMAIL in contracts/.env: an email GoodDollar can reach you at (public)");

        address receiver = startBroadcastAsDeployer();
        IEngagementRewards(ENGAGEMENT_REWARDS).applyApp(app, receiver, 80, 60, DESCRIPTION, url, email);
        vm.stopBroadcast();

        console.log("Registered app:  ", app);
        console.log("Reward receiver: ", receiver);
        console.log("Next: ask GoodDollar to approve the app (Discord ubi.gd/GoodBuildersDiscord or Telegram t.me/gooddollarbounties).");
    }
}

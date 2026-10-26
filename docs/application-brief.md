# Moonshard — GoodBuilders application brief (draft)

> Draft written against the Season 4 programme page (applications closed 2026-06-30). The next season's form had not been published when this was written, so re-check the criteria when it is.

## One-liner

A pixel action-platformer for verified humans where G$ is how you play: prove you are a real person with GoodDollar, claim your daily G$ inside the game, buy your blade with it, forge and dress it up with more, and (once prizes are switched on) win G$ back on a one-human-one-slot leaderboard. Every G$ a player pays goes into the prize vault.

## Which GoodBuilders integrations it uses (all in this repo)

1. **Face-verification flow with a claim button.** The wallet panel's "Verify" button uses the Identity SDK (`generateFVLink`); "Claim daily G$" uses the Claim SDK (`claim()`). The server then confirms the transaction on-chain and grants the day's Citizen's Blessing.
2. **Identity SDK used meaningfully: one human, one slot.** Every reward, cap and leaderboard entry is keyed to the whitelisted root. Linked wallets share one slot, and bots cannot farm prizes with fresh addresses.
3. **Rewards paid in G$.** Daily top-3 prizes and the Shard Harvest are paid from `MoonshardVault`, a small contract with on-chain per-voucher and per-day caps (deployed on Celo mainnet, source verified). Players redeem their own vouchers. Built and tested end to end; switched off at launch until the game has players (one server setting), so no prize money sits idle in the vault.
4. **Engagement Rewards.** A one-time first-boss bounty, funded by the protocol (the pool pays 5,000 G$ per claim at the time of writing; with this app's registered 80 / 60 split the player receives 2,400 G$, and the game shows the amount it reads from the contract), gated by a server attestation of a ticketed boss run.
5. **G$ spent in the game, and back to the players.** The hero's first blade is bought with G$ (20 G$), the last step before play; stronger blades and armour (a helm and a shield, five tiers each) need forest materials earned in play plus a G$ forge fee (30 and 60 G$, then 100, 160, 200 and 240 G$ for the four legendary blades, and 15 to 120 G$ a piece of armour; the deeper tiers also ask for the depth the player has reached in Endless: level 8, 15, 20 and 25), so G$ never buys power on a leaderboard that pays G$ (there are no potions or bombs for sale for the same reason); the Moon Shop sells looks only (skins, Celestial blades, a pet). Each payment is a G$ transfer into the prize vault that names its item in its own calldata, and the server unlocks an item only once the token's Transfer event proves it. A G$ guide on the menu (and on the first visit) shows the whole loop: claim, spend, win back, and where the G$ goes.

Planned next increment: G$ streaming (Streaming SDK) as daily-prize sponsorship, and a GoodCollective pool for community rewards.

## What is new

- Server-issued **run tickets** with checkpointed telemetry. The server clock wins over a claimed duration, derives its score and kill ceilings from the game's own tables, paces run starts, and counts a run (for the leaderboard and for Shards) only after 30 s of play. Telemetry is still reported by the client, so this raises the cost of cheating rather than ending it; the prizes are limited to verified humans, one slot each, and by the vault's on-chain caps.
- **Identity-keyed rewards** instead of device identifiers.
- **Non-custodial payouts**: no server key can move vault funds beyond the on-chain caps, and the Engagement signer holds no funds.
- **Endless levels**: a ladder with no end (hand-built waves first, then levels built from their own number, so every player meets the same one), four realms of five levels each that come round again, sixteen beasts, a boss at the end of every realm, and a difficulty that rises by small steps with a cap. Every level is a scene of its own (a sky, a colour over the world and a weather, from a realm's morning to its boss's night, darker each time round) and each blade from the Glaive up hits the beasts of the realm it was forged for 30% harder. The deepest level a verified player's ranked runs reached is what opens the legendary blades and the better armour, so those are earned in the arena as well as paid for.
- An in-game **UBI claim loop** with a daily perk, and a **public adoption dashboard** (`/stats.html`).
- A **closed G$ loop**: claimed G$ pays for the blade, forge fees and looks; all of it flows into the vault that pays the daily prizes and Shard Harvests.

## Growth plan and the metrics we will report

`/stats.html` separates what the chain confirms (verified humans ever, verified players today, in-game UBI claims, bounties claimed, Spoils paid, G$ spent in the Moon Shop, verified friends brought by invites) from what the game only reports (runs, wallets, players who started a run, wallets that joined through an invite: a free wallet counts there). The game works with any EIP-1193 browser wallet and offers WalletConnect on phones without an injected wallet.

- Season targets: **OWNER TO SET** (for example verified humans reached and daily claims made through the game).
- Distribution: **OWNER TO SET** (GoodDollar community channels, community challenge days, shareable run results).
- Invite links: every signed-in player has a personal link (`https://playmoonshard.xyz/?ref=CODE`) to copy or share. A friend who is new to Moonshard and passes GoodDollar's face scan counts once for the inviter (one human, one slot, so extra wallets add nothing), and the public stats report the verified friends brought this way. Tracking only: no payout is promised for invites.

## Security

Open source. Contract: Foundry tests including fuzzing, capped vouchers, two-step ownership, pause. Server: tests for nonce replay, forged runs and the plausibility ceilings, start pacing, rate limits, identity expiry and cache behaviour, attestation signatures, verified TLS to the database, and a start-up check that the vault's caps cover the prizes. An independent security review of the server and vault was done and its findings fixed with tests that fail without the fix (`docs/EXECUTION_NOTES.md`). Verified end to end on a Celo mainnet fork against the real Identity, UBI and Engagement Rewards contracts and the real GoodDollar SDKs.

## Team

**OWNER TO FILL**: names, links, KYC readiness.

## Links

- Repository: **OWNER TO FILL** after publishing (see the release gate in `docs/ATTRIBUTIONS.md`).
- Live demo: **OWNER TO FILL** after deploying (`docs/DEPLOY.md`).
- Screenshots: `docs/screenshots/`.

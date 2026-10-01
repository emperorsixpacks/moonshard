# Moonshard — GoodBuilders application brief (draft)

> Derived from Luna Blade by ScriptedBro (MIT). Moonshard replaces its Nimiq layer with GoodDollar on Celo and adds identity-gated rewards, ticketed runs and public metrics. Credit is carried in `LICENSE`, `README.md` and `docs/ATTRIBUTIONS.md`.
>
> Draft written against the Season 4 programme page (applications closed 2026-06-30). The next season's form had not been published when this was written, so re-check the criteria when it is.

## One-liner

A pixel action-platformer for verified humans: prove you are a real person with GoodDollar before you play, claim your daily G$ inside the game, and earn Spoils on a one-human-one-slot leaderboard.

## Which GoodBuilders integrations it uses (all in this repo)

1. **Face-verification flow with a claim button.** The wallet panel's "Verify" button uses the Identity SDK (`generateFVLink`); "Claim daily G$" uses the Claim SDK (`claim()`). The server then confirms the transaction on-chain and grants the day's Citizen's Blessing.
2. **Identity SDK used meaningfully: one human, one slot.** Every reward, cap and leaderboard entry is keyed to the whitelisted root. Linked wallets share one slot, and bots cannot farm prizes with fresh addresses.
3. **Rewards paid in G$.** Daily top-3 prizes and the Shard Harvest are paid from `MoonshardVault`, a small contract with on-chain per-voucher and per-day caps. Players redeem their own vouchers.
4. **Engagement Rewards.** A one-time first-boss bounty, funded by the protocol (5,000 G$ per verified user per app per 180 days at the time of writing), gated by a server attestation of a ticketed boss run.

Planned next increment: G$ streaming (Streaming SDK) as daily-prize sponsorship, and a GoodCollective pool for community rewards.

## What is new

- Server-issued **run tickets** with checkpointed telemetry; the server clock wins, so scores cannot be forged by claiming impossible durations.
- **Identity-keyed rewards** instead of device identifiers.
- **Non-custodial payouts**: no server key can move vault funds beyond the on-chain caps, and the Engagement signer holds no funds.
- An in-game **UBI claim loop** with a daily perk, and a **public adoption dashboard** (`/stats.html`).

## Growth plan and the metrics we will report

`/stats.html` shows verified humans, in-game UBI claims (transaction-verified), bounties claimed, Spoils issued and paid, and daily active players. The game works with any EIP-1193 browser wallet and offers WalletConnect on phones without an injected wallet.

- Season targets: **OWNER TO SET** (for example verified humans reached and daily claims made through the game).
- Distribution: **OWNER TO SET** (GoodDollar community channels, community challenge days, shareable run results).

## Security

Open source. Contract: Foundry tests including fuzzing, capped vouchers, two-step ownership, pause. Server: tests for nonce replay, forged runs, rate limits, identity expiry and cache behaviour, and attestation signatures. Verified end to end on a Celo mainnet fork against the real Identity, UBI and Engagement Rewards contracts and the real GoodDollar SDKs.

## Team

**OWNER TO FILL**: names, links, KYC readiness.

## Links

- Repository: **OWNER TO FILL** after publishing (see the release gate in `docs/ATTRIBUTIONS.md`).
- Live demo: **OWNER TO FILL** after deploying (`docs/DEPLOY.md`).
- Screenshots: `docs/screenshots/`.

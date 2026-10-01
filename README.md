# Moonshard: The High Forest

A pixel action-platformer built with **Phaser 4**, where **GoodDollar (G$) on Celo** powers identity, daily income and rewards. Play free in any browser; connect a wallet (MiniPay, any EIP-1193 wallet, or WalletConnect) to prove you are a real person, claim your daily G$ without leaving the game, and earn G$ Spoils on a one-human-one-slot leaderboard.

> **Derived from [Luna Blade](https://github.com/ScriptedBro/Luna-Blade) by ScriptedBro (MIT).** The gameplay and look are carried over; the Nimiq layer was replaced by GoodDollar, and the flow, reward logic and anti-cheat were rebuilt. See [`LICENSE`](LICENSE) and [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md). **Art provenance is not fully cleared yet: do not publish this repository until the release gate in the attributions file is resolved.**

## What G$ does in the game

| Feature | How it works | GoodDollar piece |
|---|---|---|
| Verified human | Wallet panel shows your identity state; "Verify" opens GoodDollar's face scan | Identity SDK (`getWhitelistedRoot`, `generateFVLink`) |
| Daily claim | "Claim daily G$" in the panel; the server confirms the tx on-chain and grants the day's *Citizen's Blessing* (+25% Forge materials) | Claim SDK (`claim()`) |
| First-boss bounty | Defeat a Story boss, then claim a one-time protocol-funded reward | Engagement Rewards (`nonContractAppClaim`) |
| Spoils | Top-3 verified daily runs and the Shard Harvest are paid in G$ from a capped vault; you redeem your own voucher | `MoonshardVault` (this repo) |
| One human, one slot | Rewards, caps and boards key on the whitelisted root, so linked wallets share one slot | Identity contract |
| Anti-cheat | Server-issued run tickets, checkpoints, server clock, rate limits | n/a |
| Public metrics | `/stats.html`: verified humans, in-game UBI claims, bounties, Spoils, daily players | n/a |

You can play everything without a wallet. Rewards need a connected, verified wallet.

## Run it

```bash
npm install
cd server && npm install && cp .env.example .env     # then set JWT_SECRET (openssl rand -base64 32)
cd .. && npm run dev:all                              # API on :3001 (in-memory DB), game on :5173
```

Contracts (Foundry):

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
forge build && forge test -vv
```

Tests:

| Command | What it runs |
|---|---|
| `npm test` | client unit tests + server tests (in-memory Postgres) |
| `npm run test:contracts` | Foundry tests for `MoonshardVault` |
| `npm run test:fork` | end to end on a Celo mainnet fork: real Identity, UBI, Engagement Rewards, vault, SDKs (needs network) |
| `npm run test:browser` | Playwright against that fork, writes screenshots to `docs/screenshots/` |

## Configuration

Web (`.env.example`): `VITE_API_URL`, `VITE_CELO_RPC_URL`, `VITE_GD_ENV`, `VITE_REOWN_PROJECT_ID` (optional, enables WalletConnect).

Server (`server/.env.example`): `PORT`, `JWT_SECRET`, `CORS_ORIGINS`, `DATABASE_URL` (empty = in-memory), `CELO_RPC_URL`, `CHAIN_ID`, `VAULT_ADDRESS`, `VOUCHER_SIGNER_KEY`, `APP_SIGNER_KEY`. Prize sizes, caps and anti-cheat limits live in `server/config.js` (`GAME`).

## Layout

```
src/            Phaser client (scenes, entities, engine, ui) + src/gd/ (GoodDollar layer)
server/         Express API: auth, run tickets, leaderboard, Spoils, Engagement attestation, stats
contracts/      Foundry project: MoonshardVault
scripts/        asset audit, Engagement app registration, Celo-fork end-to-end and browser runs
docs/           design spec, implementation plan, attributions, deploy notes, application brief
```

Deployment is described in [`docs/DEPLOY.md`](docs/DEPLOY.md) (not executed by the build agent).

## License

MIT. Original copyright © 2026 ScriptedBro; additions © 2026 Moonshard contributors. Third-party art and audio are listed in [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md).

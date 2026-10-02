# Moonshard: The High Forest

A pixel action-platformer built with **Phaser 4**, where **GoodDollar (G$) on Celo** powers identity, daily income and rewards. It is for **verified humans**: connect a wallet (any EIP-1193 browser wallet, or WalletConnect) and pass GoodDollar's face verification before you play, then claim your daily G$ without leaving the game and earn G$ Spoils on a one-human-one-slot leaderboard.

> **Derived from [Luna Blade](https://github.com/ScriptedBro/Luna-Blade) by ScriptedBro (MIT).** The gameplay and look are carried over; the Nimiq layer was replaced by GoodDollar, and the flow, reward logic and anti-cheat were rebuilt. See [`LICENSE`](LICENSE) and [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md). **Art provenance is not fully cleared yet: do not publish this repository until the release gate in the attributions file is resolved.**

## What G$ does in the game

| Feature | How it works | GoodDollar piece |
|---|---|---|
| Verified human | Wallet panel shows your identity state; "Verify" opens GoodDollar's face scan | Identity SDK (`getWhitelistedRoot`, `generateFVLink`) |
| Daily claim | "Claim daily G$" in the panel; the server confirms the tx on-chain and grants the day's *Citizen's Blessing* (+25% Forge materials) | Claim SDK (`claim()`) |
| First-boss bounty | Defeat a Story boss, then claim a one-time protocol-funded reward | Engagement Rewards (`nonContractAppClaim`) |
| Spoils | Top-3 verified daily runs and the Shard Harvest are paid in G$ from a capped vault; you redeem your own voucher | `MoonshardVault` (this repo) |
| One human, one slot | Rewards, caps and boards key on the whitelisted root, so linked wallets share one slot | Identity contract |
| Anti-cheat | Server-issued run tickets, checkpoints, the server's clock, score ceilings derived from the game's own tables, a 30 s minimum before a run counts, paced run starts, rate limits | n/a |
| Public metrics | `/stats.html`: what the chain confirms (verified humans, in-game UBI claims, bounties, Spoils paid) kept apart from what the game only reports (runs, wallets) | n/a |

**Verified humans only.** Before any game mode starts (story, tutorial, endless), the player must connect a wallet and be a verified human; the game shows a three-step gate (connect, prove you are human, play) and starts the mode they asked for once they pass. The menu, forge, leaderboard and public stats are open to everyone. The gate is the experience of the rule; the server independently only ranks and pays verified humans.

Wallets: any EIP-1193 browser wallet (it signs a login message), plus WalletConnect when `VITE_REOWN_PROJECT_ID` is set. **MiniPay is not supported**: it cannot sign messages, and the boss bounty needs a signature.

## Run it

```bash
npm install
cd server && npm install && cp .env.example .env     # then set JWT_SECRET (openssl rand -base64 32; the API refuses a short or placeholder secret)
cd .. && npm run dev:all                              # API on :3001 (in-memory DB), game on :5173
```

### Try it by hand: real G$ flows, no wallet, no face scan

```bash
npm run dev:local      # needs internet (it copies Celo mainnet) and Foundry; Ctrl-C stops it and throws everything away
```

This starts a local copy ("fork") of Celo mainnet with GoodDollar's real Identity, UBI and Engagement Rewards contracts, the vault deployed and funded, the API, and the game, and opens the game in your browser. The page gets a built-in test wallet (a throwaway key held by the launcher, used even if a wallet extension is installed), and the **Verify (face scan)** step leads to a stand-in page where one click marks the test player as a verified human on the fork. A second page (`http://127.0.0.1:5180/dev`) shows the test player's G$ in and out and a guide to where G$ appears in the game, with shortcuts to skip a day (so the day's prizes become Spoils to redeem), to record a chapter-1 boss clear, and to remove the verification again.

The game's source is untouched: the launcher swaps the one module that builds GoodDollar's face-scan link (`src/gd/identity.js`) and the one line that picks the wallet, inside its own dev server only. A normal `npm run dev` or build has none of it, and `npm run test:build` fails if any of it, or the development-only gate bypass, reaches a production build.

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
| `npm run test:build` | builds for production and checks the shipped JavaScript: no test wallet, no stand-in face scan, no gate bypass, and GoodDollar's real face-verification code present |
| `npm run test:smoke` | first-visit browser check: no wallet, API down; a first visitor is stopped at the verified-human gate, every scene boots (started around the gate, as test tooling does), the panel opens, no console errors (needs no server or chain) |
| `node test/client/browser/<name>.mjs` | real-browser checks that need no server or chain (the API is stubbed): `gate` (deep link, return from the face scan, a verification that lapses mid-session), `menu` (the rows against the gate with real clicks, turning the phone with a dialog open, the forge and leaderboard keeping their tab), `stats` (what the public stats page labels as on-chain or self-reported), `labels` (in-world labels stay readable on an upright phone), `local-dev` (the `npm run dev:local` session driven end to end: gate, stand-in face scan, claim, bounty, Spoils, with a wallet extension present; about 5 minutes, needs internet), `active-time` (paused time does not score), `survival-results`, `story-results` (what result screens say), `integration/runs-vs-real-server` (the run tracker against the real server app, including a restart inside the server's pace) |
| `npm run test:contracts` | Foundry tests for `MoonshardVault` |
| `npm run test:fork` | end to end on a Celo mainnet fork: real Identity, UBI, Engagement Rewards, vault, SDKs (needs network) |
| `npm run test:browser` | Playwright against that fork, writes screenshots to `docs/screenshots/` |

## Configuration

Web (`.env.example`): `VITE_API_URL`, `VITE_CELO_RPC_URL`, `VITE_GD_ENV`, `VITE_VAULT_ADDRESS` (pins the vault the app will redeem against), `VITE_REOWN_PROJECT_ID` (WalletConnect: needed for phones without a browser wallet, since a wallet is required to play).

Server (`server/.env.example`): `PORT`, `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY` (number of proxies in front of the API, default 1), `DATABASE_URL` (empty = in-memory), `CELO_RPC_URL`, `CHAIN_ID`, `VAULT_ADDRESS`, `VOUCHER_SIGNER_KEY`, `APP_SIGNER_KEY`. Prize sizes, caps and anti-cheat limits live in `server/config.js` (`GAME`).

## Layout

```
src/            Phaser client (scenes, entities, engine, ui) + src/gd/ (GoodDollar layer)
server/         Express API: auth, run tickets, leaderboard, Spoils, Engagement attestation, stats
contracts/      Foundry project: MoonshardVault
scripts/        asset audit, Engagement app registration, Celo-fork end-to-end and browser runs
docs/           design spec, implementation plan, execution notes (deviations, evidence, limitations), attributions, deploy notes, application brief, screenshots
```

Deployment is described in [`docs/DEPLOY.md`](docs/DEPLOY.md) (not executed by the build agent).

## License

MIT. Original copyright © 2026 ScriptedBro; additions © 2026 Moonshard contributors. Third-party art and audio are listed in [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md).

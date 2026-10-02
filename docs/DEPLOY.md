# Deploying Moonshard

> **None of the steps below were executed by the coding agent on the real chain.** They need your keys, funds and accounts. Steps 1 and 2 were rehearsed with throwaway keys on a local fork of Celo mainnet, exactly as written here (and the keystore alternative), and the API was booted in production mode against the result (`vault caps ok`). Check provider UIs against their current docs.
>
> **Where secrets go.** The deploying wallet's private key: `contracts/.env`, on your computer only (git ignores it), removed once you have deployed. The server's two keys and its session secret: `server/.env` on your computer (git ignores it too) and the API host's variables. Never in a chat, an issue, any variable starting with `VITE_` (those are built into the public website), or any file git tracks.

## 0. Prerequisites

- Node 22, Foundry (`forge`, `cast`), and the contract libraries: `cd contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git`.
- A Celo wallet with about 1 CELO for gas (in the rehearsal, starting from exactly 1 CELO, the deploy and the funding used 0.23 CELO at a high gas price), and the G$ for the prize pool.
- Optional: a free API key from etherscan.io (one Etherscan key covers Celoscan), to publish the vault's source code on Celoscan.

The server has two keys of its own, made for you in step 1 and never holding funds: the **voucher signer** (`VOUCHER_SIGNER_KEY`) signs Spoil vouchers, and a leaked one can only mint vouchers within the vault's on-chain caps; the **app signer** (`APP_SIGNER_KEY`) is the Engagement Rewards "app" and only signs bounty attestations.

## 1. Deploy and fund `MoonshardVault`

```bash
npm run setup:deploy      # makes contracts/.env and server/.env.production (both ignored by git)
```

This makes the server's two keys and its session secret, writes them into `server/.env.production` (the deployed API's settings, used in step 3), and writes the two signers' addresses into `contracts/.env`. It prints only the addresses, and running it again never replaces anything. Then open `contracts/.env`, paste your wallet's private key after `DEPLOYER_PRIVATE_KEY=` and, optionally, your Etherscan key after `ETHERSCAN_API_KEY=`, and deploy:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://forno.celo.org --broadcast --verify
```

`--verify` publishes the vault's source code on Celoscan right after the deploy. If that part fails (a wrong or missing Etherscan key, a busy explorer), the command ends with an error, but **the vault is deployed**: its address is printed above the error, along with a `forge verify-contract ...` command that publishes the code later. Without an Etherscan key, Foundry publishes the code on Sourcify instead of Celoscan.

What is in `contracts/.env`:

| Setting | What it is |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | the deploying wallet's private key, with or without `0x`: **the one thing you fill in**. It pays the gas and owns the vault |
| `VOUCHER_SIGNER`, `APP_SIGNER` | the server's two signers' **addresses**, filled in by `npm run setup:deploy` (their keys are in `server/.env.production`) |
| `ETHERSCAN_API_KEY` | optional: publishes the vault's code on Celoscan (`--verify`) |
| `MAX_PER_VOUCHER_G`, `DAILY_CAP_G` | the vault's limits in whole G$ (see "Sizing the caps"; 1000 and 5000 by default) |
| `FUND_G` | G$ moved from the deploying wallet into the vault right after it is deployed (the prize pool); 0 to fund it later by sending G$ to the vault's address. While prizes are off (the default) the vault pays nothing out, so it needs no G$ |
| `APP_URL`, `APP_EMAIL` | for step 2; both are stored publicly on-chain |
| `VAULT_OWNER` | optional: another owner, such as a Safe multisig. Empty: the deploying wallet owns the vault |

The script prints the vault's address and where it goes: `VAULT_ADDRESS` on the server, `VITE_VAULT_ADDRESS` on the website. Its record is in `contracts/broadcast/` (git ignores it). Check the vault:

```bash
for f in 'owner()(address)' 'signer()(address)' 'token()(address)' 'maxPerVoucher()(uint256)' 'dailyCap()(uint256)'; do
  cast call <VAULT_ADDRESS> "$f" --rpc-url https://forno.celo.org; done
```

*Rather not keep the key in a file?* Leave `DEPLOYER_PRIVATE_KEY` empty, import the key into Foundry's encrypted keystore once (`cast wallet import moonshard-deployer --interactive`), and add `--account moonshard-deployer --sender <its address>` to each `forge script` command.

Put real values only in `contracts/.env`, never in `contracts/.env.example`: the example is the template, and it is pushed to GitHub with the code.

The vault also receives every G$ players pay in the game (their blade, forge fees and Moon Shop looks, see below), so what players spend tops up the prizes. The owner can later `setCaps`, `setSigner`, `pause` or `withdraw`. `renounceOwnership` is disabled (it would leave the vault with no owner and no way to do any of those): hand the vault over with `transferOwnership`, then the new owner calls `acceptOwnership`.

### Sizing the caps

These matter once prizes are on (see "Turning prizes on" below); while they are off, the vault pays nothing out.

The vault enforces both caps on every redemption. A voucher above the per-voucher limit (`MAX_PER_VOUCHER_G`), or one that would take a UTC day's redemptions above the daily limit (`DAILY_CAP_G`), **reverts on-chain**, so the winner is holding a voucher they can never redeem. The server signs whatever the game has earned, so the caps have to be big enough for it:

- `MAX_PER_VOUCHER_G` must be at least **1000**: the rank-1 daily prize. (A player's shard harvest is at most 100 G$.)
- `DAILY_CAP_G` must be at least **1900 + 100 x the verified players you expect to redeem on one UTC day**. 1,900 G$ is the three daily prizes (1,000 + 600 + 300) and 100 G$ is one player's full shard harvest (50 shards x 2 G$, the daily cap per player). For example, 50 players need 6,900 G$ and 200 players need 21,900 G$.
- The default 5,000 G$ covers the prizes and 31 harvesting players a day. It is a launch size: raise it as the player base grows, with `cast send <VAULT_ADDRESS> "setCaps(uint256,uint256)" <per voucher> <per day> --private-key <the owner's key> --rpc-url https://forno.celo.org` (here the amounts are in wei: G$ followed by 18 zeros, so 1000 G$ is `1000000000000000000000`).
- Do not size it far above what you need. The caps are also the most a leaked `VOUCHER_SIGNER_KEY` can drain: up to the daily limit in each UTC day (and up to twice that across a UTC midnight), until you notice and call `setSigner` or `pause`. Likewise fund the vault for a few days of expected payouts, not more.

When the API starts it reads `maxPerVoucher()` and `dailyCap()` from the vault and compares them with the prizes it signs. If they are too small it logs a `WARNING` with both numbers (it never refuses to start, and it only says so when the RPC answers). After every deploy or `setCaps`, restart the API and look for `vault caps ok` in its log.

### The Moon Shop

With `VAULT_ADDRESS` set, the API opens the Moon Shop: a player buys their first blade with G$ before they can play, pays a G$ fee to forge a stronger one, and can buy looks. Each payment is a plain G$ `transfer` from the player's wallet into the vault, with the item named after the transfer's arguments (`moonshard:<item>`); the API unlocks the item once the token's Transfer event shows the vault was paid. The API refuses to start a run for a player without a paid blade. With no `VAULT_ADDRESS` there is no shop: the first blade is free and blades are forged from materials alone.

Items and prices are in `server/config.js` (`GAME.SHOP`); the game reads them from `GET /api/shop`, so a change needs only an API redeploy. Raising a price refuses a payment made at the old price by a player who had the page open at the time (`underpaid`, and the G$ stay in the vault): change prices in a quiet moment, and lower ones never cause this.

### Turning prizes on

The daily prizes (the top 3 verified runs of each UTC day: 1,000 / 600 / 300 G$) and the Shard Harvest (2 G$ a Shard, up to 100 G$ a player a day) are paid from the vault, and they are **off** until you turn them on: no Shards drop in the game, nothing mentions prizes, and the API signs no vouchers. Days played while prizes are off are closed with nothing owed, so turning them on never pays them. To turn them on:

1. Put G$ in the vault: a few days of prizes (10,000 G$ covers about five days of the three prizes and some harvests).
2. Check its caps against "Sizing the caps".
3. Set `PRIZES_ENABLED=true` on the API (and `VOUCHER_SIGNER_KEY`, already in `server/.env.production`), restart it, and look for `vault caps ok` in its log.

## 2. Register the Engagement Rewards app

```bash
forge script script/RegisterApp.s.sol --rpc-url https://forno.celo.org --broadcast
```

It reads the same `contracts/.env` (`APP_SIGNER`, `APP_URL`, `APP_EMAIL`). The deploying wallet becomes the app's reward receiver: it gets the app's share of every bounty claim (2,600 G$ of each 5,000 G$ claim at the time of writing, as the player's inviter is not named). Once this has gone through, remove `DEPLOYER_PRIVATE_KEY` from `contracts/.env`.

GoodDollar must then approve the app (Discord `ubi.gd/GoodBuildersDiscord`, Telegram `t.me/gooddollarbounties`). Until it is approved, `/api/engagement/attest` answers `not_claimable` and the panel shows the reason; everything else keeps working.

## 3. API (Railway)

1. New project, deploy the `server/` directory (root directory `server`, start command `node index.js`, Node 22).
2. Add a Postgres database and set `DATABASE_URL` to its connection string **with `?sslmode=require` appended**. The server then connects over TLS and always verifies the certificate and the host name; verification cannot be turned off (`sslmode=no-verify` makes the server refuse to start).
   - Host with a public CA (most managed Postgres): nothing more to set.
   - Host with a private CA: also set `DATABASE_CA` to the CA certificate as PEM text (`-----BEGIN CERTIFICATE-----` ... with real line breaks; the server checks it at start-up and refuses a value that lost them). It works together with `?sslmode=require`. `DATABASE_CA` on its own also turns TLS on.
   - **No `sslmode` in the URL and no `DATABASE_CA` means no TLS at all**: the password and every query cross the network in clear text. The server still starts, but prints a `WARNING ... NOT encrypted` line at boot unless the host is localhost. Accept that only on a private network you trust. `sslmode=disable` does the same on purpose and warns the same way (with `DATABASE_CA` set it is refused as contradictory).
   - The server creates and updates its own tables when it starts (`server/migrations/*.sql`, each file in its own transaction, safe if two instances start together). `002_indexes.sql` builds indexes with a plain `CREATE INDEX`, which blocks writes to that table while it runs: on a database that already holds a lot of runs or scores, deploy it in a quiet moment. `003_shop.sql` adds the `purchases` table of the Moon Shop.
3. Variables: open the service's Variables tab, choose "Raw Editor", and paste the lines of `server/.env.production` (made in step 1: `NODE_ENV=production`, the session secret and the two signer keys). Then fill in `VAULT_ADDRESS` (printed by step 1), `DATABASE_URL` and `CORS_ORIGINS` there. For reference, everything the API reads is described in `server/.env.example`. What they do: `NODE_ENV=production` (without a `CORS_ORIGINS` the API then sends no CORS headers at all, rather than allowing every origin as it does in development; it also makes the API refuse to start with no `DATABASE_URL`, since everything would vanish on a restart, or with a `VAULT_ADDRESS` but no `VOUCHER_SIGNER_KEY`, since prizes could never be signed; `ALLOW_IN_MEMORY_DB=1` overrides the first for a throwaway demo); `JWT_SECRET` signs sessions (32+ random characters, already made); `CORS_ORIGINS` = your site's origin; `VAULT_ADDRESS` = the vault; `VOUCHER_SIGNER_KEY` and `APP_SIGNER_KEY` = the server's two keys (already made). Optional: `LOG_LEVEL=debug` to see the requests the API refused as the client's mistake; `RATE_LIMIT_PER_MIN` (default 300) if many players will share one public IP address, since they share that budget (a player who is refused waits the time the server names and sends their run again).
4. Check: `GET /health`, then `GET /api/config` shows your vault address and the engagement app address.

## 4. Web (Vercel)

1. Import the repo; framework Vite; build command `npm run build`; output directory `dist`.
2. Environment variables from `.env.example`: `VITE_API_URL` = the Railway URL; `VITE_VAULT_ADDRESS` = the deployed `MoonshardVault` (the app then refuses to redeem from, or pay Moon Shop prices into, any other address: set it, since players pay into the address the API names); `VITE_REOWN_PROJECT_ID` to enable WalletConnect. Because a player must be a verified human with a connected wallet before any game mode starts, WalletConnect is how people without a browser wallet (most phones outside a wallet app) get in: treat the Reown project id as required for a public launch.
3. The build produces two pages: the game (`/`) and the public stats page (`/stats.html`).

## 5. Post-deploy checks

- Open the site in a browser with a Celo-compatible wallet and try to start a game mode: the verified-human gate should appear; connect, and confirm the panel shows your identity state and, for a verified account, offers PLAY.
- As a verified account: claim the daily G$, buy the blade the gate asks for (20 G$, check it arrives in the vault on Celoscan), play a Daily Shard Trial, and look at `/stats.html` (G$ spent in the Moon Shop).
- With prizes on: after the next UTC day plus 45 minutes, check that Spoils appear and can be redeemed.
- Do not make the repository public before the release gate in `docs/ATTRIBUTIONS.md` is cleared.

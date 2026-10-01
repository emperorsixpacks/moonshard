# Deploying Moonshard

> **None of the steps below were executed by the coding agent.** They need your keys, funds and accounts. Commands are written from the code in this repo; check provider UIs against their current docs.

## 0. Prerequisites

- Node 22, Foundry (`forge`, `cast`).
- A Celo wallet with a little CELO for gas, and the G$ you want to pay out as Spoils.
- Two **new** private keys (use `cast wallet new`):
  - `VOUCHER_SIGNER_KEY`: signs Spoil vouchers. A leaked key can only mint vouchers within the vault's on-chain caps.
  - `APP_SIGNER_KEY`: its address is the Engagement Rewards "app". It only signs attestations and must hold no funds.

## 1. Deploy `MoonshardVault`

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
cast wallet import moonshard-deployer --interactive      # stores the key in an encrypted keystore

G_TOKEN=0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A \
VOUCHER_SIGNER=<address of VOUCHER_SIGNER_KEY> \
VAULT_OWNER=<your owner address (use a multisig if you have one)> \
MAX_PER_VOUCHER=1000000000000000000000 \
DAILY_CAP=5000000000000000000000 \
forge script script/Deploy.s.sol --rpc-url https://forno.celo.org --account moonshard-deployer --broadcast
```

`MAX_PER_VOUCHER` and `DAILY_CAP` are wei of G$ (18 decimals): the values above are 1,000 G$ per voucher and 5,000 G$ per UTC day. Then fund the vault and set `VAULT_ADDRESS` on the server:

```bash
cast send 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A "transfer(address,uint256)" <VAULT_ADDRESS> 10000000000000000000000 \
  --account moonshard-deployer --rpc-url https://forno.celo.org
```

The owner can later `setCaps`, `setSigner`, `pause` or `withdraw`. `renounceOwnership` is disabled (it would leave the vault with no owner and no way to do any of those): hand the vault over with `transferOwnership`, then the new owner calls `acceptOwnership`.

### Sizing the caps

The vault enforces both caps on every redemption. A voucher above `MAX_PER_VOUCHER`, or one that would take a UTC day's redemptions above `DAILY_CAP`, **reverts on-chain**, so the winner is holding a voucher they can never redeem. The server signs whatever the game has earned, so the caps have to be big enough for it:

- `MAX_PER_VOUCHER` must be at least **1,000 G$**: the rank-1 daily prize. (A player's shard harvest is at most 100 G$.)
- `DAILY_CAP` must be at least **1,900 + 100 x the verified players you expect to redeem on one UTC day**. 1,900 G$ is the three daily prizes (1,000 + 600 + 300) and 100 G$ is one player's full shard harvest (50 shards x 2 G$, the daily cap per player). For example, 50 players need 6,900 G$ and 200 players need 21,900 G$.
- The 5,000 G$ in the command above covers the prizes and 31 harvesting players a day. It is a launch size: raise it as the player base grows, with `cast send <VAULT_ADDRESS> "setCaps(uint256,uint256)" <maxPerVoucher> <dailyCap> --account <owner account> --rpc-url https://forno.celo.org`.
- Do not size it far above what you need. The caps are also the most a leaked `VOUCHER_SIGNER_KEY` can drain: up to `DAILY_CAP` in each UTC day (and up to twice that across a UTC midnight), until you notice and call `setSigner` or `pause`. Likewise fund the vault for a few days of expected payouts, not more.

When the API starts it reads `maxPerVoucher()` and `dailyCap()` from the vault and compares them with the prizes it signs. If they are too small it logs a `WARNING` with both numbers (it never refuses to start, and it only says so when the RPC answers). After every deploy or `setCaps`, restart the API and look for `vault caps ok` in its log.

## 2. Register the Engagement Rewards app

```bash
OWNER_KEY=0x.. APP_ADDRESS=<address of APP_SIGNER_KEY> APP_URL=https://<your-site> APP_EMAIL=<you@example.com> \
node scripts/register-engagement-app.mjs
```

GoodDollar must then approve the app (Discord `ubi.gd/GoodBuildersDiscord`, Telegram `t.me/gooddollarbounties`). Until it is approved, `/api/engagement/attest` answers `not_claimable` and the panel shows the reason; everything else keeps working.

## 3. API (Railway)

1. New project, deploy the `server/` directory (root directory `server`, start command `node index.js`, Node 22).
2. Add a Postgres database; set `DATABASE_URL` to its connection string with `?sslmode=require` appended. TLS is always verified; set `DATABASE_CA` (PEM text) only if the host uses a private CA.
3. Variables: everything in `server/.env.example`. `JWT_SECRET` from `openssl rand -base64 32`; `CORS_ORIGINS` = your site origin; `VAULT_ADDRESS`; `VOUCHER_SIGNER_KEY`; `APP_SIGNER_KEY`.
4. Check: `GET /health`, then `GET /api/config` shows your vault address and the engagement app address.

## 4. Web (Vercel)

1. Import the repo; framework Vite; build command `npm run build`; output directory `dist`.
2. Environment variables from `.env.example`: `VITE_API_URL` = the Railway URL; optional `VITE_REOWN_PROJECT_ID` to enable WalletConnect.
3. The build produces two pages: the game (`/`) and the public stats page (`/stats.html`).

## 5. Post-deploy checks

- Open the site in a browser with a Celo-compatible wallet, connect, and confirm the panel shows your identity state.
- As a verified account: claim the daily G$, play a Daily Shard Trial, and look at `/stats.html`.
- After the next UTC day plus 45 minutes, check that Spoils appear and can be redeemed.
- Do not make the repository public before the release gate in `docs/ATTRIBUTIONS.md` is cleared.

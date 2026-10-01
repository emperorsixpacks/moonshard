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

`MAX_PER_VOUCHER` and `DAILY_CAP` are wei of G$ (18 decimals): the values above are 1,000 G$ per voucher and 5,000 G$ per UTC day. Size them to what you fund. Then fund the vault and set `VAULT_ADDRESS` on the server:

```bash
cast send 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A "transfer(address,uint256)" <VAULT_ADDRESS> 10000000000000000000000 \
  --account moonshard-deployer --rpc-url https://forno.celo.org
```

The owner can later `setCaps`, `setSigner`, `pause` or `withdraw`.

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
2. Environment variables from `.env.example`: `VITE_API_URL` = the Railway URL; `VITE_VAULT_ADDRESS` = the deployed `MoonshardVault` (the app then refuses to redeem against any other address); `VITE_REOWN_PROJECT_ID` to enable WalletConnect. Because a player must be a verified human with a connected wallet before any game mode starts, WalletConnect is how people without a browser wallet (most phones outside a wallet app) get in: treat the Reown project id as required for a public launch.
3. The build produces two pages: the game (`/`) and the public stats page (`/stats.html`).

## 5. Post-deploy checks

- Open the site in a browser with a Celo-compatible wallet and try to start a game mode: the verified-human gate should appear; connect, and confirm the panel shows your identity state and, for a verified account, offers PLAY.
- As a verified account: claim the daily G$, play a Daily Shard Trial, and look at `/stats.html`.
- After the next UTC day plus 45 minutes, check that Spoils appear and can be redeemed.
- Do not make the repository public before the release gate in `docs/ATTRIBUTIONS.md` is cleared.

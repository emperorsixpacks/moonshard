# Moonshard: The High Forest

A pixel action-platformer built with **Phaser 4**, where **GoodDollar (G$) on Celo** is how the game is played. It is for **verified humans**: connect a wallet (any EIP-1193 browser wallet, or WalletConnect) and pass GoodDollar's face verification, claim your daily G$ without leaving the game, **buy your blade with G$**, then play Endless (a ladder of levels with no end: new beasts, a new realm every five levels, a boss at the end of each), forge stronger blades and armour (forest materials plus a G$ fee; the deeper ones also ask for the depth you have reached), and buy looks in the **Moon Shop**. Every G$ a player pays goes into the prize vault on Celo. The prizes it can pay (a daily top 3 and a Shard Harvest, one human one slot) are built and tested, and switched off until the game has players (`PRIZES_ENABLED`).

## What G$ does in the game

| Feature | How it works | GoodDollar piece |
|---|---|---|
| Verified human | Wallet panel shows your identity state; "Verify" opens GoodDollar's face scan | Identity SDK (`getWhitelistedRoot`, `generateFVLink`) |
| Daily claim | "Claim daily G$" in the panel; the server confirms the tx on-chain and grants the day's *Citizen's Blessing* (+25% forest materials) | Claim SDK (`claim()`) |
| First-boss bounty | Defeat a Story boss, then claim a one-time protocol-funded reward | Engagement Rewards (`nonContractAppClaim`) |
| Your blade | No hero fights without a blade: the first one is bought with G$ (the Rusted Shortsword, 20 G$), the last step before play. Stronger blades are forged from materials earned in play plus a G$ fee (30 and 60 G$ for the Broadsword and the Glaive; 100, 160, 200 and 240 G$ for the Moonsteel Blade, the Starforged Edge, the Cinderbrand and the Voidglass Reaver, which also ask for Endless level 8, 15, 20 and 25), so G$ alone never buys power. From the Glaive up each blade is forged for one realm and hits that realm's beasts 30% harder | G$ token (`transfer` into the vault) |
| Armour | A helm and a shield, five tiers each, forged like a blade: forest materials earned in play plus a G$ fee (15 to 120 G$ a piece; the better tiers also ask for Endless level 8, 15, 20 and 25). A helm turns aside blows from foes, a shield what they throw (spit, spores, stingers, magma, bombs); neither stops a hit (the best take 32% and 52% off). G$ alone buys none | G$ token (`transfer` into the vault) |
| Moon Shop | Looks only, paid in G$, in the Shop's Looks tab: sword skins (100 G$), Celestial blades (150 G$: the Glaive's power in a new look, after the Glaive), the Moon Sprite pet (80 G$) | G$ token |
| Where G$ goes | Every payment goes into the prize vault, which pays the prizes once they are switched on. A payment names its item in its own calldata (`moonshard:<item>`, readable on any explorer); the server unlocks an item only once the token's Transfer event shows the vault was paid | `MoonshardVault` (this repo) |
| Prizes (off for now) | Top-3 verified daily runs and the Shard Harvest, paid in G$ from the capped vault as vouchers each player redeems. Built and tested; off until the game has players: `PRIZES_ENABLED=true` turns them on, with G$ in the vault. While off, no Shards drop and nothing in the game mentions prizes | `MoonshardVault` |
| How G$ works | A card at the bottom of the wallet, closed until the player opens it (nothing opens it by itself): what G$ is, claim, spend, win back, where it goes, with the server's amounts. The wallet chip on the menu shows your balance, with a dot when today's claim is waiting | n/a |
| Invite friends | A personal link (`https://playmoonshard.xyz/?ref=CODE`) in the wallet and in Settings, to copy or share. A friend who signs in through it, and is new to Moonshard, is recorded once; the inviter sees how far each friend got: joined, verified, playing (they own the blade). Each real person counts once, and an inviter's own second wallet is not a friend. Tracking only: nothing is paid for invites yet | Identity contract (a friend is verified once it vouches for them) |
| One human, one slot | Rewards, caps and boards key on the whitelisted root, so linked wallets share one slot | Identity contract |
| Anti-cheat | Server-issued run tickets, checkpoints, the server's clock, score ceilings derived from the game's own tables, a 30 s minimum before a run counts, paced run starts, rate limits | n/a |
| Public metrics | `/stats.html`: what the chain confirms (verified humans, in-game UBI claims, bounties, Spoils paid, G$ spent in the Moon Shop, verified friends brought by invites) kept apart from what the game only reports (runs, wallets, wallets that joined through an invite) | n/a |

**The way in.** Before the story or Endless mode starts, the player connects a wallet, proves they are a verified human, and buys their blade with G$; the game shows these steps as a gate, one step at a time (with today's free claim offered first when the wallet is short of the price), and starts the mode they asked for once they are through. The tutorial needs none of it, so a new player can try the game first: the menu's big button leads there until it has been done. The menu, shop, leaderboard and public stats are open to everyone. The gate is the experience of the rule; the server independently only ranks and pays verified humans, and starts no run for a player without a paid blade. A server with no vault configured has no shop: the first blade is free there and blades are forged from materials alone.

**Endless levels.** Endless is a ladder of levels with no end (`src/engine/levels.js`, one pure module the scene, the Shop and the tests share). Levels 1 to 5 are the hand-built waves; from level 6 each level is built from its own number, so every player meets the same level n. A realm lasts five levels and has its own look and its own beasts: the Hive Canopy (6 to 10), the Sunken Ruins (11 to 15), the Obsidian Caldera (16 to 20), the Lunar Spire (21 to 25), and then round again as "II", with more of the deeper realms' tough beasts among the foes. Each realm ends on a boss, Gorgok in another coat (the Hive Tyrant, the Bone Warden, the Cinder Lord, Moonborn), who calls his own help when he is enraged. Sixteen beasts in all, each with its own habits (shielded flyers that dive, shooters, floaters that cast, a stalker that pounces); a level has 20 foes at the sixth, up to 34, never more than four in the arena at once; their health grows by a tenth of the base a level (up to six times) and walkers move five percent faster a level (up to 1.4 times). Clearing a level pays a bonus, more for a fast clear, and forest materials. **The depth reached opens the last four blades and the better armour**: the deepest level of a player's ranked runs (verified, unflagged, played long enough) is what the Moonsteel Blade, the Starforged Edge, the Cinderbrand and the Voidglass Reaver wait on (and the armour tiers of the same realms), so they are earned in the arena as well as paid for. The server bounds the level a run reports by the kills the run claims (`server/src/levels.js`), and its score ceilings copy the numbers they need from the client's tables, with a test that fails if the client's grow past them.

**Every level is a scene of its own** (`src/engine/scenery.js`, pure data that the arena puts on, and `src/engine/EndlessWeather.js`): a look, a colour laid over the world, and a weather. A realm's five levels run from its morning to its boss's night (the woods go Morning, Drifting Mist, Storm, Dusk, Midnight; the hive a golden afternoon to the Tyrant's glow; and so on for the ruins, the caldera and the spire), and coming round to a realm again it is a little darker and the weather heavier. The new scene goes on behind a curtain that falls over the last moments of a level and lifts as the next begins; a boss's scene breathes. **Realm blades and armour** (`src/engine/gear.js`): a blade from the Forest Glaive up hits the beasts of the realm it was forged for 30% harder (the arena says so), and the Celestial blades carry the Glaive's full power, so a look never trades power for style. A helm turns aside the blows of foes and a shield what they throw; both work in Endless and in the Story. There are no potions or bombs for sale: Endless is the ranked daily trial, so anything G$ could buy there would be power, and the Shop's G$ for power always comes with forest materials and depth. The fees, the material costs, the cuts and the 30% are placeholders that nobody has play-tested.

Wallets: any EIP-1193 browser wallet (it signs a login message), plus WalletConnect when `VITE_REOWN_PROJECT_ID` is set, plus **Continue with email** when `VITE_MAGIC_PUBLISHABLE_KEY` is set: [Magic](https://magic.link) makes a wallet for a player who types an email and a six-digit code (`src/gd/magic.js`, `src/ui/emailSheet.js`; the SDK is loaded only when a player chooses it, and Moonshard never sees the email address). With several wallet extensions installed (MetaMask and Rabby, say), the game finds each one through EIP-6963 and offers a button for each, rather than relying on `window.ethereum`, which only one of them can hold (or none, when they fight over it); the one picked is remembered. **MiniPay is not supported**: it cannot sign messages, and the boss bounty needs a signature.

## Run it

```bash
npm install
cd server && npm install && cp .env.example .env     # then set JWT_SECRET (openssl rand -base64 32; the API refuses a short or placeholder secret)
cd .. && npm run dev:all                              # API on :3001 (in-memory DB), game on :5173
```

### Try it by hand: real G$ flows, no wallet, no face scan

```bash
npm run dev:local      # needs internet (it copies Celo mainnet) and Foundry; Ctrl-C stops it and throws everything away
npm run dev:local -- --vault 0x...   # the same, playing against your deployed MoonshardVault (as it is on Celo) instead of a fresh one
```

Options: `--vault <address>` uses a vault that is already deployed (payments go to it on the copy, never on the real chain; prizes stay off with it, since a voucher signed for a real vault would be valid on Celo itself); `--prizes` turns the daily prizes and the Shard Harvest on (with a fresh vault); `--port <n>` picks the game's port (5317 by default, so it does not share an address, and the browser's saved data, with other projects on Vite's 5173); `--no-open` does not open the browser.

This starts a local copy ("fork") of Celo mainnet with GoodDollar's real Identity, UBI and Engagement Rewards contracts, the vault deployed and funded, the API, and the game, and opens the game in your browser. The page gets a built-in test wallet (a throwaway key held by the launcher, used even if a wallet extension is installed), and the **Verify (face scan)** step leads to a stand-in page where one click marks the test player as a verified human on the fork. A second page (`http://127.0.0.1:5180/dev`) shows the test player's G$ in and out and a guide to where G$ appears in the game, with shortcuts to skip a day (so the day's prizes become Spoils to redeem), to record a chapter-1 boss clear, and to remove the verification again.

The game's source is untouched: the launcher swaps the one module that builds GoodDollar's face-scan link (`src/gd/identity.js`) and the one line that picks the wallet, inside its own dev server only. A normal `npm run dev` or build has none of it, and `npm run test:build` fails if any of it, or the development-only gate bypass, reaches a production build.

### Play on the real Celo network, on your computer

```bash
npm run dev:celo       # the game and its API on your computer, on Celo itself, against your deployed vault (server/.env.production)
```

Nothing is stood in: **Connect** uses your wallet extension (MetaMask, Rabby, ...), **Verify (face scan)** is GoodDollar's real face verification, the daily claim pays real G$, and buying the blade sends a real 20 G$ to your vault (which you own and can withdraw from). The API runs locally in development mode (in-memory database, prizes off, a fresh session secret) and holds no production key. `--vault 0x...` picks another vault, `--port <n>` the game's port (5318 by default), `--no-open` keeps the browser closed.

Contracts (Foundry):

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
forge build && forge test -vv
```

Deploying them (the settings, including the deploying wallet's key, go in `contracts/.env`, which git ignores): [`docs/DEPLOY.md`](docs/DEPLOY.md).

Tests:

| Command | What it runs |
|---|---|
| `npm test` | client unit tests + server tests (in-memory Postgres) |
| `npm run test:build` | builds for production and checks the shipped JavaScript: no test wallet, no stand-in face scan, no gate bypass, and GoodDollar's real face-verification code present |
| `npm run test:smoke` | first-visit browser check: no wallet, API down; a first visitor can start the tutorial but is stopped at the verified-human gate before the story and Endless, every scene boots (started around the gate, as test tooling does), the wallet opens, no console errors (needs no server or chain) |
| `node test/client/browser/<name>.mjs` | real-browser checks that need no server or chain (the API is stubbed): `gate` (deep link, return from the face scan, a verification that lapses mid-session), `menu` (the big button and the tiles against the gate with real clicks, the chapter list, turning the phone with a sheet open, the shop and leaderboard keeping their tab), `stats` (what the public stats page labels as on-chain or self-reported), `referral` (an invite link's code is claimed once and taken off the address bar, the invite sheet from the wallet and from Settings on a 364 px phone and on its side, Copy and Share, a failed load and its retry), `levels` (Endless: clearing a level starts the next, a boss falls and the next realm opens, a jump through the ladder dresses the arena and names the boss, every beast runs and falls to a blade, the shots fly, diving flyers come back up, each of 33 levels puts on its own sky, tints, platforms, grade and weather behind a curtain, a realm blade's bane and a helm's and a shield's cut land in the live arena, the run's level is submitted; about 2 minutes), `labels` (in-world labels stay readable on an upright phone), `hires` (the sharp picture steps down only when that helps, and a remembered size expires), `shop` (the gate's blade step, nothing opening by itself on a first visit, "How G$ works" in the wallet, the Shop's tabs, prices and locks, equipping a blade and a helm, a phone turned on the Shop, crafting with no shop, too few materials), `prizes` (prizes off: no Shards, no Spoils, "How G$ works" and the leaderboard promise none), `wallets` (several wallet extensions at once, with window.ethereum broken by their fight: one button each, and the one picked is the one used), `gate-restart` (a restart the gate refuses leaves the screen working), `pause-exit` (leaving a run from the pause menu settles it), `scene-teardown` (a scene torn down at an awkward moment does not throw), `story-intro-card` (the chapter card starts the dialogue once), `local-dev` (the `npm run dev:local` session driven end to end: nothing opening by itself, the gate, the stand-in face scan, the claim, buying the blade, bounty, prizes off, with a wallet extension present; about 5 minutes, needs internet), `active-time` (paused time does not score), `survival-results`, `story-results` (what result screens say), `integration/runs-vs-real-server` (the run tracker against the real server app, including a restart inside the server's pace) |
| `npm run test:contracts` | Foundry tests for `MoonshardVault` |
| `npm run test:fork` | end to end on a Celo mainnet fork: real Identity, UBI, Engagement Rewards, vault, SDKs, and Moon Shop purchases paid on the real G$ token (needs network) |
| `npm run test:browser` | Playwright against that fork (claim and buy the blade in the gate, a skin and a forge fee in the Shop), writes screenshots to `docs/screenshots/` |

## Configuration

Web (`.env.example`): `VITE_API_URL`, `VITE_CELO_RPC_URL`, `VITE_GD_ENV`, `VITE_VAULT_ADDRESS` (pins the vault the app will redeem against), `VITE_REOWN_PROJECT_ID` (WalletConnect: needed for phones without a browser wallet, since a wallet is required to play), `VITE_MAGIC_PUBLISHABLE_KEY` (email sign-in; allow the site's origin in the Magic dashboard), `VITE_PUBLIC_URL` (the address invite links point at, `https://playmoonshard.xyz`; unset, a link uses the page the player is on).

Server (`server/.env.example`): `PORT`, `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY` (number of proxies in front of the API, default 1), `DATABASE_URL` (empty = in-memory), `CELO_RPC_URL`, `CHAIN_ID`, `VAULT_ADDRESS`, `VOUCHER_SIGNER_KEY`, `APP_SIGNER_KEY`. Prize sizes, caps, anti-cheat limits and the Moon Shop's items and prices live in `server/config.js` (`GAME`); the shop is open only when `VAULT_ADDRESS` is set, since that is where every payment goes. `PRIZES_ENABLED` (off unless `true`) switches the daily prizes and the Shard Harvest on.

## Layout

```
src/            Phaser client (scenes, entities, engine, ui) + src/gd/ (GoodDollar layer)
server/         Express API: auth, run tickets, leaderboard, Spoils, Moon Shop, referrals, Engagement attestation, stats
contracts/      Foundry project: MoonshardVault, and the scripts that deploy it and register the Engagement app (settings in contracts/.env)
scripts/        asset audit, Celo-fork end-to-end and browser runs, the local test launcher
docs/           design spec, implementation plan, execution notes (deviations, evidence, limitations), attributions, deploy notes, application brief, screenshots
```

Deployment is described in [`docs/DEPLOY.md`](docs/DEPLOY.md) (not executed by the build agent).

## License

MIT, see [`LICENSE`](LICENSE). Third-party art and audio are listed in [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md); some of the art's licences are still being cleared there, so keep this repository private until they are.

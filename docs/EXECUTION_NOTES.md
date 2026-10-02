# Execution notes

How Moonshard was actually built, where it deviated from `docs/superpowers/plans/2026-10-01-moonshard.md`, what was verified (and how), and what is still open. Written for the owner and for GoodBuilders reviewers.

## How it was built

Spec → plan → three independent tracks in separate git worktrees (vault contract; API server; client core), merged, then the UI and scene wiring, a Celo-mainnet-fork end-to-end test and a real-browser run, a server hardening pass, and an independent review. A second pass followed (see "After the first build"): two independent reviews, the owner's own use of the game, and a display overhaul. A third pass fixed what the server and vault review found and what only showed when the parallel fixes were merged together. Everything is committed locally; nothing was pushed or deployed.

## Deviations from the plan

**Contracts**
- Plan code compiled and passed unchanged (16 tests). Four tests were added after a mutation check found gaps: non-owner `setCaps`, non-owner `pause`/`unpause`, the zero-recipient revert, and a malicious token that re-enters `claim` mid-transfer. Each new test was shown to fail when the matching guard is removed.

**Server**
- *Ticket double-spend.* The plan's submit read `status` outside the transaction and updated without a guard. On real Postgres, 12 parallel submits of one ticket succeeded more than once in 24 of 25 rounds and credited 8,640 shards instead of an honest 750. Fixed with `UPDATE ... WHERE status='open' RETURNING`.
- *Checkpoint `shards` bound,* so a huge value is rejected (422) instead of overflowing the integer column (500).
- *Hardening pass (eight items):* shards credited only for clean, checkpoint-covered runs; per-IP rate limiting and bounded in-memory state; `/ubi/confirm` requires the real `UBIClaimed` event (verified against live mainnet logs); leaderboard ranking by subject, not wallet; multi-claim transactions recorded; one open run per player and mode even under concurrency (unique index plus a per-slot advisory lock, because retry-once alone still returned 500s on real Postgres); the server refuses to boot with a weak or placeholder `JWT_SECRET`; checkpoint posts are idempotent and serialised per run.

**Client**
- Session fallback now reads the in-memory copy when `localStorage` rejects writes; `RunTracker` ignores a late `start()` response after `stop()`; a failed checkpoint batch is **not** re-sent (the server flags non-increasing times, which would cost ranking and the bounty); the identity fetch retries after an offline start.
- Added a persistent **pending-confirmation queue**: if an on-chain action succeeds (the player is paid) but the server confirmation fails, the action is still reported as a success and the confirmation is retried until the server records it.
- Fixed a click-through bug: Phaser also listens for pointer events on `window`, so a click on the wallet panel hit the game button underneath. The offline smoke test now asserts it.
- The survival time bonus is included in the live score sent with checkpoints (otherwise a very long run's closing checkpoint would carry the whole bonus and trip the server's rate check).
- Leaderboard column headers are placed over their columns (upstream centred one long string and clipped it). "On-chain" wording that was only true of the original Nimiq build was corrected.

**Plan corrections found while executing**
- `@goodsdks/engagement-contracts` is not published on npm and is not needed (the SDK bundles the Celo addresses); the SDK imports `react`/`wagmi` as peer dependencies.
- `@goodsdks/citizen-sdk`'s ESM build cannot be imported under plain Node (named import from CommonJS `lz-string`); the fork test loads its CJS build. The SDKs hand viem the account as a plain address, so the fork tests use a key-backed EIP-1193 stand-in for the wallet.
- Test servers use free ports: a fixed port was already taken by an unrelated app, and the first browser run silently drove that app until the readiness check was made to verify it was serving Moonshard.

**Scope**
- MiniPay support was added during execution on my own initiative, then **removed at the owner's request** (it was never required, and MiniPay cannot sign messages). It is not supported. The tested implementation exists in git history (`2a2269d`, reverted by `7bcae3d`).

## After the first build

Two independent reviews (client money paths; server and vault) and the owner's own use of the game drove a second pass. Each finding was reproduced before it was fixed, and each fix has a test that fails without it.

**Owner decisions**
- *Verification before play.* A player must connect a wallet and be a verified human (GoodDollar face verification, one human per slot) before any game mode starts. Every way into play (story, intro, tutorial, endless) goes through a wrapper on the scene plugin's `start` and `restart` ("play again", the next chapter and the pause menu's restart restart the scene without calling `start`, which a mid-session lapse of the verification could slip through); the menu's play rows ask the gate before they fade out, and its badge says where the player stands. A blocked start opens the wallet panel as a three-step gate (connect, prove you are human, play) and ends in a "PLAY" button for the mode that was asked for. The request survives the trip to GoodDollar's face scan and back, and a deep link (`?scene=survival`) lands on the menu with the gate open. The menu, forge, leaderboard and stats stay open to everyone. The gate is the experience of the rule, not its enforcement: the server independently ranks and pays only verified humans. A development-only bypass for test tooling is compiled out of production builds. This replaced the original "play first, wallet optional" design.
- *Spending G$.* The build is earn-only (daily UBI claim with its Citizen's Blessing, first-boss bounty, daily prizes, Shard Harvest). There is no way for a player to spend G$ in the game. Options were put to the owner (a G$ cosmetic shop is recommended; a Superfluid stream pass; paid tournaments carry legal risk). **No decision yet; nothing was built.**

**Display** (the owner found the game blurry and unreadable)
- *Every text was 10px sans-serif.* All 156 text styles named `Press Start 2P` without quoting it, and a canvas silently ignores a font whose family name has spaces and a digit when it is unquoted. `src/engine/typography.js` now turns what a scene asks for into a font the canvas accepts: headings keep the pixel font; captions too small for it use VT323 at a proportionally larger size.
- *The picture was a 480×270 canvas stretched by the browser.* `src/engine/HiRes.js` renders the drawing buffer N× larger (N from the on-screen size and display density, inside a pixel budget on phones) by scaling only the canvas's GL viewport and scissor: game coordinates, cameras, input and physics are untouched. Text is rasterised at N×.
- Fonts are bundled (`@fontsource`, OFL) instead of fetched from Google, and the game waits for them before it builds any text.
- In landscape the canvas was forced to fill the window (`object-fit: fill`), stretching the pixel art about 21% on a long phone screen: it keeps its aspect ratio now. After a rotation Phaser kept fitting the picture to the old shape (`resize` instead of `setGameSize`), squashing it. The view manager now only tells each screen the new size and each re-lays itself out in its own way: the menu closes and reopens its dialog, the forge and the leaderboard keep their tab (the leaderboard without asking the server again), levels adapt in place and are never restarted.
- Layouts that the wrong font had hidden were fixed for the real fonts and for phones: the Story and Endless HUD bars (one tested layout, `src/ui/hudLayout.js`), the dialogue box, Forge, story intro and ending, Menu, Leaderboard and Tutorial. The page's wallet / timer / pause buttons sit below the HUD bar instead of on the counters. Type sizes follow the on-screen scale (`src/engine/uiScale.js`: about 2 CSS px per game unit on a desktop, 1.4 on a phone held sideways, 0.8 held upright).
- The wallet panel is a tested pure view of every state a player meets: session ended, server unreachable, data that could not be refreshed, a payment sent but not recorded yet, the bounty claim window.

**Client review** (0 critical, 3 high, 9 medium, 8 low)
- *H1* the Endless clock counted paused and hidden time (39 minutes parked on the pause screen were worth about 23,000 points, enough for the daily prizes): scoring and run duration now use an active-time clock. *H2* a dead or expired session was never noticed and paid UBI claims queued forever: every path now detects it, says "reconnect", and keeps the hash queued for the account that was paid. *H3* a transaction that was sent but whose receipt wait failed was reported as a failure and its hash lost: the hash is queued the moment the wallet sends it, the action is reported as "submitted", and it cannot be repeated until the server has recorded it.
- *M1/M2* refreshes are numbered (an older answer never overwrites a newer one, a failure keeps the last good data and marks it stale, a late 401 for an old token cannot end a newer sign-in). *M3/M4/M5/M6/L7* the run tracker settles each run once, the next run waits for the previous one's settlement (capped at 4 s), result screens open at once with "Submitting run..." and say why a run was not recorded, and times are measured from the `/runs/start` response. *M7/M8* reward copy shows an amount only when the server gave one, and says "pending" only for a verified, unflagged, recorded run. *M9* a wallet account switch hides the other account's UBI and the claim SDK is built for the signed-in account on every claim.
- Low items: non-JSON 2xx answers are errors, session writes are ordered, error text never shows machine codes, the pending queue validates hashes and is scoped per account and retried in parallel, a hung wallet prompt frees the panel (`wallet_timeout`), "check again" says what happened, a UBI claim re-checks verification first (so a lapsed verification never sends the player to the face scan mid-claim), the vault address can be pinned by the build (`VITE_VAULT_ADDRESS`), key presses on the panel no longer reach the game.

**Server and vault review** (one independent review; each finding reproduced with a script first, then fixed with tests that fail without the fix)
- *Run telemetry and the economy.* The strongest finding: a run's score, kills and Shards are reported by the client, and the first limits (a blanket 1,500 points a second, a 5 s clock tolerance, a 5 s minimum run) were loose enough that one verified wallet banked the whole 50-Shard cap and a ranked entry with no waiting, and a scripted 39-minute run took rank 1 over an honest ten-minute one. The server now derives its ceilings from the game's own tables (`server/config.js`: at most 2 kills a second at 500 points a kill at the top combo, so 1,010 points a second sustained, plus the one-off wave and boss bonuses; a test reads the client's tables and fails if one grows past the figure copied there). Checkpoints are checked against the time since the previous one and since the start, and the closing totals against the last checkpoint; they must be 2 s apart (one shorter gap per run, for the closing one); the clock tolerance is 2 s; a run is ranked, and its Shards credited, only after 30 s of play on the server's clock **and** in the duration the client claims; a boss clear needs 30 s of server time as well; and `/runs/start` is paced per player and mode (10 s for Endless, 3 s for Story). A flag is stored once, not on every bad post, and a run id that is not a UUID is a 400, not a 500.
- *Database growth.* A free wallet could grow `runs` and `run_checkpoints` without limit. Checkpoint spacing caps the rows a run can hold at about elapsed / 2 s; an hourly janitor deletes void and expired-ticket runs a day after they started and a submitted run's checkpoints two days after it was submitted (run rows, scores, claims and Spoils stay). Ten indexes (`002_indexes.sql`) turn the daily board, the pending-boss lookup, `/spoils`, the stats counts and nonce cleanup from sequential scans into index scans (measured at 150k scores / 300k runs, with sequential scans enabled: daily board 11 ms to 0.09 ms, pending boss run 48 ms to 0.04 ms, stats runs-today 41 ms to 0.04 ms).
- *Leaderboard.* The all-time board loaded every row and sorted in JavaScript. It now ranks in SQL and returns only the page, cached for 30 s with concurrent misses sharing one query. At 100k rows one request went from 163 ms to 34 ms cold and about 1 ms cached, and eight parallel cold requests from 1.3 s to 37 ms.
- *Spoils and the vault.* Spoil ids are bound to the vault address, so a redeployed vault can never pay a Spoil the old one already paid; `GET /spoils` remembers redeemed Spoils and reads the rest five at a time (it made up to 30 sequential chain calls a request, and one timeout per Spoil while the RPC was down); at start-up the API compares the vault's caps with the prizes it signs and logs a `WARNING` (it never refuses to start) when a voucher could not be redeemed; `renounceOwnership` reverts, so one mistaken call cannot strand pause, withdraw, `setSigner` and `setCaps`.
- *The bounty amount.* The screens promised the pool's headline 5,000 G$; the player receives 2,400 (this app's registered 80 / 60 split). The server now reads the reward amount and the app's own percentages from the contract (cached 5 minutes, served stale for up to an hour if the RPC fails) and every screen shows that number, or none. The fork test asserts the promise equals the real payout, which also checks the hand-written ABI against the deployed contract.
- *Infrastructure.* An idle database connection reset no longer crashes the process (pool `error` handler, and `tx()` survives a dropped client); TLS to Postgres is always verified and cannot be switched off (`sslmode=no-verify` makes the server refuse to start, `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot undo it, a missing `sslmode` is a loud boot warning); a stale identity is served for at most 30 minutes after the last successful chain read; body-parser and framework 4xx answers are 4xx, not 500; `X-Powered-By` is off; with `NODE_ENV=production` an unset `CORS_ORIGINS` sends no CORS headers instead of allowing every origin; each migration runs in one transaction under an advisory lock; sessions are pinned to HS256. The public stats page now separates what the chain confirms from what the game only reports.

**Found while merging the parallel fixes** (none of these showed in any single helper's tests)
- Two people had fixed the menu's rotation bug in different places; together they left an open dialog dead after a turn (the STORY MODE row then did nothing) and made the forge and leaderboard lose their tab. The view manager no longer restarts screens; the real-browser `menu` check covers a turn with a dialog open.
- The gate did not cover `restart`, so "play again" after a mid-session lapse of the verification skipped it.
- With every player verified and a 30 s minimum on the server, an honest player who died early was told "run flagged". The server now says `tooShort` / `shardsCredited` / `minPlayMs`, and the end screens say "too short (under 30 s)".
- A restart inside the server's new start pace played a whole run without a ticket. The 429 now carries `retryAfterMs` and the run tracker waits it out once, in the background.
- Small ones: the wallet panel told a player whose verification could not be checked that they "can still play"; the leaderboard's Spoils panel and rewards pill stated prize and cap figures from fixed text; four 7-unit floating labels were about 6 CSS px on an upright phone; a story-results check could be failed by an idle hero being killed.

## What was verified, and how

| Claim | Evidence |
|---|---|
| Vault contract | `forge test`: 23 pass (incl. fuzz); mutation-checked; the cap selectors are pinned literally |
| API | `cd server && npm test`: 234 pass, also with `NODE_ENV=production`; the first hardening suite was run against real Postgres 16, this pass's pool, TLS and index tests against PGlite, a fake Postgres wire-protocol server and a private CA minted with `openssl` |
| Client | `node --test "test/client/**/*.test.js"`: 360 pass |
| Real contracts + SDKs | `npm run test:fork`: Celo mainnet fork, real Identity/UBI/Engagement contracts and SDKs; the server's `/engagement/status` promised 2,400 G$ read from the real contract and the real `nonContractAppClaim` paid exactly that; a next-day settlement paid 1,100 G$ through the vault |
| Real browser, whole stack | `npm run test:browser`: gate, connect, verify, claim, a 35 s ranked trial, tutorial, story, bounty, Spoils redemption, mobile layout, stats; no console errors |
| Real browser, no server | `node test/client/browser/<name>.mjs` for `gate`, `menu`, `stats`, `labels`, `active-time`, `survival-results`, `story-results`, `integration/runs-vs-real-server` (the run tracker against the real server app); see the README |
| First visit | `npm run test:smoke`: no wallet, API down; a first visitor is stopped by the gate; every scene boots; the panel does not leak clicks |
| Production build | `vite build` succeeds, and the development-only gate bypass is not in the shipped JavaScript (it appears only in the source map) |

## Not verified

- WalletConnect (`VITE_REOWN_PROJECT_ID`) has unit tests with a stub provider only.
- Deployment (Railway/Vercel), a real G$-funded vault on mainnet, and GoodDollar's approval of the Engagement app: need your keys and accounts.
- UTC-midnight settlement runs on a fake clock in tests (and a virtual clock in the fork test), not across a real midnight.
- Contract-wallet (ERC-1271) logins were not exercised; only EOAs were.
- A real GoodWallet/GoodDapp host; the `goodwallet` host label is a user-agent guess and only a label.
- **A real phone.** Every phone check ran in headless Chromium with an emulated viewport, pixel density and touch (390x844 upright, 844x390 sideways). Nothing ran on iOS Safari or an Android device, so the render-scale budget and its frame-rate step-down, safe-area insets, wallet in-app browsers, and the behaviour of a tab that is really hidden are unconfirmed.
- **Real Postgres for this pass's SQL.** The new leaderboard query and indexes ran on PGlite (which starts with sequential scans disabled, so the index tests switch them on), and the pool and TLS paths against a fake Postgres wire-protocol server with a private CA. The first pass's concurrency fixes did run against real Postgres 16. `002_indexes.sql` uses plain `CREATE INDEX`, which blocks writes while it builds.
- The Engagement Rewards behaviours listed under "Known limitations" were observed on a fork only.

## Known limitations

- **Run telemetry is still client-reported.** Without deterministic replay verification (out of scope) a verified human can forge a run that stays inside the server's ceilings (1,010 points a second sustained, kill and checkpoint limits, 30 s minimum). The ceilings make that cost real time and keep it inside what a perfect player could score, but they do not make it impossible: one such human can take the first daily prize (1,000 G$) and a full Shard Harvest (100 G$) a day, and several colluding verified humans can take all three prizes. The cost is bounded by one human one slot, the vault's on-chain daily cap and the rule that only verified humans are paid.
- **Two Engagement Rewards behaviours belong to the GoodDollar contract, not to this code** (observed on the fork): a stored attestation paid the bounty a second time on the fork 181 days of fork time after the first, with no server call (an attestation carries a `validUntilBlock`, but fork time travel does not advance block numbers, so whether that stops the replay on mainnet is unconfirmed, and the contract is upgradeable: test it before launch); and the inviter is not covered by the app's signature, so a player can name themselves, receiving 4,000 G$ instead of 2,400 and cutting the app's share from 2,600 to 1,000 G$. The server itself attests once per human.
- **Spoils never expire, but only the newest 30 are offered.** Every `GET /api/spoils` signs a fresh 7-day voucher for each unredeemed Spoil among the player's 30 newest. One that falls out of that window (about two weeks of unclaimed daily wins at two a day) is no longer offered and its G$ stays in the vault.
- The login message has no domain binding; a stolen session has no financial impact because every voucher and claim pays the on-chain address of the session wallet.
- `TRUST_PROXY` defaults to `1` (one proxy in front). Behind two proxies set `2`; exposed directly set `0`. express-rate-limit v7 keys IPv6 on the full address.
- **A phone held upright** gets a fixed 480x440 game, so the lower part of a tall screen below the touch controls is empty (see `docs/screenshots/menu-mobile.png`).
- The story has no ending screen: `StoryEndingScene` is registered but nothing starts it. The tutorial's ground, platforms and hero are not rebuilt when the phone is turned (only its lesson card is); the other screens are.
- The floating "+2 G$" when a Shard is picked up is the nominal amount: the Shards are credited only if the server accepts the run (verified, unflagged, 30 s of play, checkpoint coverage), and the end screen says what happened. The Endless game-over screen's LEADERBOARD button can open before the run's submit has landed.
- **Art and audio provenance:** 148 of 170 asset files cannot be traced to a licence (see `docs/ATTRIBUTIONS.md`). Keep the repository private until that is resolved.
- One low `npm audit` advisory in the web package (an `esbuild` dev-server issue that only matters on Windows, via the GoodDollar SDKs' build tooling); none in the server.

## Still needs you

1. **Decide how G$ is spent in the game.** It is earn-only today. A cosmetic G$ shop is recommended; nothing is built until you choose (see "Owner decisions").
2. Where and when to push (the JemIIahh fork or a new repo; credit ScriptedBro/Luna Blade).
3. Fund `MoonshardVault` with G$ and choose prize sizes and caps (`docs/DEPLOY.md`: `MAX_PER_VOUCHER` at least 1,000 G$, `DAILY_CAP` at least 1,900 + 100 x the verified players you expect to redeem on one day).
4. Register the Engagement Rewards app (`scripts/register-engagement-app.mjs`) and get GoodDollar's approval; re-test the two Engagement behaviours above on the live contract.
5. Deploy the API and the web app (`docs/DEPLOY.md`), with `NODE_ENV=production` and a Reown project id (`VITE_REOWN_PROJECT_ID`): without WalletConnect a phone with no wallet app cannot get past the gate.
6. Try it once on a real phone and inside the real GoodWallet before announcing it.
7. KYC and the GoodBuilders form once published; fill the `OWNER TO SET/FILL` lines in `docs/application-brief.md`.
8. Clear or replace the pending-provenance assets before making the repository public.

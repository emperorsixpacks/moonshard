# Execution notes

How Moonshard was actually built, where it deviated from `docs/superpowers/plans/2026-10-01-moonshard.md`, what was verified (and how), and what is still open. Written for the owner and for GoodBuilders reviewers.

## How it was built

Spec → plan → three independent tracks in separate git worktrees (vault contract; API server; client core), merged, then the UI and scene wiring, a Celo-mainnet-fork end-to-end test and a real-browser run, a server hardening pass, and an independent review. A second pass followed (see "After the first build"): two independent reviews, the owner's own use of the game, and a display overhaul. Everything is committed locally; nothing was pushed or deployed.

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
- *Verification before play.* A player must connect a wallet and be a verified human (GoodDollar face verification, one human per slot) before any game mode starts. Every way into play (story, intro, tutorial, endless) goes through one wrapper on the scene plugin's `start`; a blocked start opens the wallet panel as a three-step gate (connect, prove you are human, play) and ends in a "PLAY" button for the mode that was asked for. The request survives the trip to GoodDollar's face scan and back, and a deep link (`?scene=survival`) lands on the menu with the gate open. The menu, forge, leaderboard and stats stay open to everyone. The gate is the experience of the rule, not its enforcement: the server independently ranks and pays only verified humans. A development-only bypass for test tooling is compiled out of production builds. This replaced the original "play first, wallet optional" design.
- *Spending G$.* The build is earn-only (daily UBI claim with its Citizen's Blessing, first-boss bounty, daily prizes, Shard Harvest). There is no way for a player to spend G$ in the game. Options were put to the owner (a G$ cosmetic shop is recommended; a Superfluid stream pass; paid tournaments carry legal risk). **No decision yet; nothing was built.**

**Display** (the owner found the game blurry and unreadable)
- *Every text was 10px sans-serif.* All 156 text styles named `Press Start 2P` without quoting it, and a canvas silently ignores a font whose family name has spaces and a digit when it is unquoted. `src/engine/typography.js` now turns what a scene asks for into a font the canvas accepts: headings keep the pixel font; captions too small for it use VT323 at a proportionally larger size.
- *The picture was a 480×270 canvas stretched by the browser.* `src/engine/HiRes.js` renders the drawing buffer N× larger (N from the on-screen size and display density, inside a pixel budget on phones) by scaling only the canvas's GL viewport and scissor: game coordinates, cameras, input and physics are untouched. Text is rasterised at N×.
- Fonts are bundled (`@fontsource`, OFL) instead of fetched from Google, and the game waits for them before it builds any text.
- In landscape the canvas was forced to fill the window (`object-fit: fill`), stretching the pixel art about 21% on a long phone screen: it keeps its aspect ratio now. After a rotation Phaser kept fitting the picture to the old shape (`resize` instead of `setGameSize`), squashing it; menu-type screens now rebuild for the new shape and levels are never restarted by a rotation.
- Layouts that the wrong font had hidden were fixed for the real fonts and for phones: the Story and Endless HUD bars (one tested layout, `src/ui/hudLayout.js`), the dialogue box, Forge, story intro and ending, Menu, Leaderboard and Tutorial. The page's wallet / timer / pause buttons sit below the HUD bar instead of on the counters. Type sizes follow the on-screen scale (`src/engine/uiScale.js`: about 2 CSS px per game unit on a desktop, 1.4 on a phone held sideways, 0.8 held upright).
- The wallet panel is a tested pure view of every state a player meets: session ended, server unreachable, data that could not be refreshed, a payment sent but not recorded yet, the bounty claim window.

**Client review** (0 critical, 3 high, 9 medium, 8 low)
- *H1* the Endless clock counted paused and hidden time (39 minutes parked on the pause screen were worth about 23,000 points, enough for the daily prizes): scoring and run duration now use an active-time clock. *H2* a dead or expired session was never noticed and paid UBI claims queued forever: every path now detects it, says "reconnect", and keeps the hash queued for the account that was paid. *H3* a transaction that was sent but whose receipt wait failed was reported as a failure and its hash lost: the hash is queued the moment the wallet sends it, the action is reported as "submitted", and it cannot be repeated until the server has recorded it.
- *M1/M2* refreshes are numbered (an older answer never overwrites a newer one, a failure keeps the last good data and marks it stale, a late 401 for an old token cannot end a newer sign-in). *M3/M4/M5/M6/L7* the run tracker settles each run once, the next run waits for the previous one's settlement (capped at 4 s), result screens open at once with "Submitting run..." and say why a run was not recorded, and times are measured from the `/runs/start` response. *M7/M8* reward copy shows an amount only when the server gave one, and says "pending" only for a verified, unflagged, recorded run. *M9* a wallet account switch hides the other account's UBI and the claim SDK is built for the signed-in account on every claim.
- Low items: non-JSON 2xx answers are errors, session writes are ordered, error text never shows machine codes, the pending queue validates hashes and is scoped per account and retried in parallel, a hung wallet prompt frees the panel (`wallet_timeout`), "check again" says what happened, a UBI claim re-checks verification first (so a lapsed verification never sends the player to the face scan mid-claim), the vault address can be pinned by the build (`VITE_VAULT_ADDRESS`), key presses on the panel no longer reach the game.

<!-- SERVER_REVIEW -->

## What was verified, and how

| Claim | Evidence |
|---|---|
| Vault contract | `forge test`: 20 pass (incl. fuzz); mutation-checked |
| API | `cd server && npm test`: 83 pass; the hardening suite was also run against real Postgres 16 |
| Client | `node --test test/client`: 73 pass |
| Real contracts + SDKs | `npm run test:fork`: Celo mainnet fork, real Identity/UBI/Engagement contracts and SDKs; the Engagement bounty paid 2,400 G$ (80% × 60% of 5,000); a next-day settlement paid 1,100 G$ through the vault |
| Real browser | `npm run test:browser`: connect, verify, claim, trial, tutorial, story, bounty, Spoils redemption, mobile layout, stats; no console errors |
| First visit | `npm run test:smoke`: no wallet, API down; every scene boots; the panel does not leak clicks |

## Not verified

- WalletConnect (`VITE_REOWN_PROJECT_ID`) has unit tests with a stub provider only.
- Deployment (Railway/Vercel), a real G$-funded vault on mainnet, and GoodDollar's approval of the Engagement app: need your keys and accounts.
- UTC-midnight settlement runs on a fake clock in tests (and a virtual clock in the fork test), not across a real midnight.
- Contract-wallet (ERC-1271) logins were not exercised; only EOAs were.
- A real GoodWallet/GoodDapp host; the `goodwallet` host label is a user-agent guess and only a label.

## Known limitations

- **Run telemetry is client-reported.** Without deterministic replay verification (out of scope), a forged run that stays inside the rate envelope can still bank up to 50 shards a day (100 G$) for one verified human. The cost is bounded by one-human-one-slot, the daily cap and the vault's on-chain caps.
- The login message has no domain binding; a stolen session has no financial impact because every voucher and claim pays the on-chain address of the session wallet.
- `TRUST_PROXY` defaults to `1` (one proxy in front). Behind two proxies set `2`; exposed directly set `0`. express-rate-limit v7 keys IPv6 on the full address.
- `GET /api/spoils` lists the 30 most recent Spoils; vouchers expire after 7 days anyway.
- **Art and audio provenance:** 148 of 170 asset files cannot be traced to a licence (see `docs/ATTRIBUTIONS.md`). Keep the repository private until that is resolved.
- One low `npm audit` advisory in the web package (an `esbuild` dev-server issue that only matters on Windows, via the GoodDollar SDKs' build tooling); none in the server.

## Still needs you

1. Where and when to push (the JemIIahh fork or a new repo; credit ScriptedBro/Luna Blade).
2. Fund `MoonshardVault` with G$ and choose prize sizes and caps (`docs/DEPLOY.md`).
3. Register the Engagement Rewards app (`scripts/register-engagement-app.mjs`) and get GoodDollar's approval.
4. Deploy the API and the web app (`docs/DEPLOY.md`).
5. KYC and the GoodBuilders form once published; fill the `OWNER TO SET/FILL` lines in `docs/application-brief.md`.
6. Clear or replace the pending-provenance assets before making the repository public.

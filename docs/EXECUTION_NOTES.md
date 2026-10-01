# Execution notes

How Moonshard was actually built, where it deviated from `docs/superpowers/plans/2026-10-01-moonshard.md`, what was verified (and how), and what is still open. Written for the owner and for GoodBuilders reviewers.

## How it was built

Spec → plan → three independent tracks in separate git worktrees (vault contract; API server; client core), merged, then the UI and scene wiring, a Celo-mainnet-fork end-to-end test and a real-browser run, a server hardening pass, and an independent review. Everything is committed locally; nothing was pushed or deployed.

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

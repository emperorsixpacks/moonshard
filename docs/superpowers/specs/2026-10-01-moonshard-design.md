# Moonshard: The High Forest — GoodDollar Edition

Design spec · 2026-10-01 · status: approved by the owner ("go"), written under delegated authority

## 1. Purpose and success criteria

Moonshard is a port of **Luna Blade** (MIT, © ScriptedBro; fork JemIIahh/Luna-Blade) with the Nimiq layer replaced by **GoodDollar (G$) on Celo**. Gameplay, scenes, art direction and mechanics stay the same ("same game, same look"). The work is the G$ integration, a better flow, and stronger anti-cheat.

It is built to be positioned for the next **GoodBuilders** season (application form not yet published; Season 4 rules used as the template). Season 4 scoring: 25% verified-citizen votes, 50% mentor votes, 25% growth metrics. Hard rules: non-trivial G$ integration, open source, security review, "new and innovative".

**Done means:**
1. A player can open the game, play the tutorial, Story Chapter 1 and the Daily Shard Trial **without a wallet**.
2. Connecting a wallet (MiniPay, GoodWallet or any EIP-1193 browser wallet) shows verified-human status from the GoodDollar Identity contract, with a face-verification path when not verified.
3. A verified player can claim daily G$ UBI from inside the game and receive the Citizen's Blessing buff (server-confirmed from the on-chain claim tx).
4. Defeating the first Story boss lets a verified player claim the protocol-funded Engagement Rewards bounty (server attests, user submits `nonContractAppClaim`).
5. Daily top-3 verified humans and the Shard Harvest earn G$ **Spoils** paid from a `MoonshardVault` contract through server-signed, capped vouchers that players redeem themselves.
6. Every run is ticketed by the server; submissions are validated against the ticket and server clock.
7. A public stats page shows verified players, in-game UBI claims, engagement claims, Spoils paid, daily active players.
8. Verified end to end against a local Anvil fork of Celo mainnet, with unit tests for server and contract, and Playwright screenshots of the new screens.

## 2. Decisions made (owner delegated technical calls)

| Topic | Decision | Why |
|---|---|---|
| Name | **Moonshard**; sword = "the Moonshard"; Luna Crystals → **Shards**; Daily Luna Trial → **Daily Shard Trial** | User asked for a new name; keeps the shattered-moon story |
| Gameplay code | Port Luna Blade as-is (JS, Phaser 4.2.1, Vite), rename strings, keep scenes | "Same game"; 12.6k lines of working gameplay |
| New code language | JavaScript (ESM) + JSDoc, server in Node 22 | Matches surrounding code; avoids a 12k-line TS migration |
| Chain | Celo mainnet (chain 42220), G$ `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` (18 decimals, verified on-chain) | G$ + GoodDollar contracts live here; MiniPay is Celo-native |
| SDKs | `@goodsdks/citizen-sdk` (Identity, Claim), `@goodsdks/engagement-sdk` + `engagement-contracts`, `viem` | Official SDKs, headless/viem. No wagmi/React |
| Wallet | Thin `wallet.js` over EIP-1193 (`window.ethereum`; detects MiniPay via `isMiniPay`); optional Reown/WalletConnect when `VITE_REOWN_PROJECT_ID` set | Works in-wallet today; WalletConnect is opt-in config |
| Server | Express (as Luna), Postgres via `pg`; PGlite for dev/tests (same SQL) | Replaces Luna's JSON files; real transactions for vouchers/tickets |
| Contracts | Foundry; one contract `MoonshardVault` | Foundry installed; single small audit surface |
| Hosting (later) | Web on Vercel, API + Postgres on Railway | Already connected tooling; deploys need owner approval |
| Commits | No AI attribution lines (owner rule) | |

Prize amounts are config (`server/config.js`), not constants in code, because they depend on how much G$ the owner funds the vault with.

## 3. Architecture

```
moonshard/
├── index.html, vite.config.js, package.json      # web client (ported)
├── src/
│   ├── scenes/ entities/ engine/ ui/              # ported gameplay (renamed)
│   ├── gd/                                        # NEW: GoodDollar layer (replaces src/nimiq/*)
│   │   ├── host.js        # MiniPay / GoodWallet / browser detection, language, viewport
│   │   ├── wallet.js      # connect, chain switch to Celo, walletClient/publicClient
│   │   ├── auth.js        # nonce → personal_sign → JWT
│   │   ├── identity.js    # IdentitySDK wrapper: status, expiry, face-verify link
│   │   ├── ubi.js         # ClaimSDK wrapper: entitlement, nextClaimTime, claim
│   │   ├── engagement.js  # EngagementRewardsSDK wrapper: status, claim
│   │   ├── spoils.js      # list vouchers, redeem on MoonshardVault
│   │   ├── runs.js        # run tickets, checkpoints, submit
│   │   ├── session.js, api.js
│   └── ui/  HomeHub.js, WalletPill.js, SpoilsPanel.js, ConnectSheet.js   # NEW
├── server/
│   ├── index.js, config.js
│   ├── src/ auth.js identity.js runs.js leaderboard.js spoils.js engagement.js
│   │        stats.js chain.js db.js cron.js
│   ├── migrations/*.sql
│   └── test/
├── contracts/            # Foundry: src/MoonshardVault.sol, test/, script/Deploy.s.sol
├── docs/                 # specs, plans, application-brief.md, ATTRIBUTIONS.md
└── LICENSE               # MIT, original ScriptedBro notice retained + ours
```

Removed from the port: `@nimiq/*` deps, `src/nimiq/*`, `engine/NimiqService.js`, `server/src/verifyNimiq.js`, `payout.js` (hot-key payouts), `claims.js` (device caps), `ConnectGate` (hard wallet gate), `extracted_assets/`, `extracted_debug/`, `server/data/*`.

## 4. Identity model: one human, one slot

All rewards, boards and caps are keyed by the **whitelisted root** returned by `IdentitySDK.getWhitelistedRoot(address)`, not the wallet address. Linked wallets (IdentityV4) therefore share one slot, which is far stronger than Luna's per-device cap. Server re-checks the root at login and every 5 minutes (cached), and checks `getIdentityExpiryData` to reject expired identities for prize eligibility.

States: `anonymous` (no wallet) → `connected` (wallet, not whitelisted) → `verified` (whitelisted) → `expired` (needs re-verify). Only `verified` is prize/bounty eligible. Everyone can play and appear on the open board.

## 5. Player flow

1. **Boot → Menu** with no gate. Wallet pill top-right (Connect / address + status chip).
2. **First visit:** Menu highlights Tutorial → Story Chapter 1 (unchanged content).
3. **Home hub** (new panel on Menu): `Claim G$` · `Daily Shard Trial` · `Spoils (n)`, plus a stats chip.
4. **Connect sheet** (non-blocking): choose injected / WalletConnect; sign a login message once (12h session).
5. **Not verified →** "Verify you're human" opens the face-verification link (`generateFVLink`, redirect on mobile, popup on desktop), with local save state preserved and a return URL back to the game. On return the identity is re-checked.
6. **Claim G$** calls `ClaimSDK.claim()`. On success the client posts the tx hash; the server confirms the receipt on-chain (success, `to` = UBI scheme, `from` = a wallet of that root) and issues the day's **Citizen's Blessing** (+25% Forge material drops, one free revive in Story). It does not apply to the Daily Shard Trial score, to keep ranked play fair.
7. **Runs:** every Story chapter and Daily Shard Trial start calls `/api/runs/start`. Gameplay is unchanged. The client sends checkpoints every 10s and submits at the end.
8. **First Story boss:** end screen offers "Claim your bounty". Server verifies the ticketed run, returns an app signature, the client submits `nonContractAppClaim`.
9. **Next UTC day:** the cron settles the previous day; **Spoils** appear in the hub with a Redeem button.

## 6. Server design

### 6.1 Auth
`GET /api/auth/nonce` → `{nonce}`. `POST /api/auth/verify {address, message, signature}`; message is `Moonshard login\nNonce: <nonce>\nIssued: <iso>` and must match. Signature verified with viem `verifyMessage` through a public client (supports ERC-1271). JWT (12h) carries `sub=address`, `root`, `host`. Nonces are single-use, 5-minute TTL, stored in Postgres.

### 6.2 Run tickets (anti-cheat core)
- `POST /api/runs/start {mode: "TRIAL"|"STORY", chapter?}` → `{runId, seed, startedAt, ticket}`. `seed` is the UTC date for TRIAL (as Luna's PRNG). The ticket is an HMAC over `runId|root|mode|seed|startedAt`. A root may have one open run per mode; starting a new one voids the old.
- `POST /api/runs/checkpoint {runId, t, score, kills, shards}` (every ~10s, batched at end is also accepted). Server stores the series.
- `POST /api/runs/submit {runId, score, kills, shards, durationMs, bossCleared?, encounters?}`:
  1. Ticket belongs to the session root, unsubmitted, not expired (max 40 min).
  2. `durationMs` ≤ server elapsed + 3s tolerance and ≥ 5s; the server clock wins.
  3. Checkpoints: monotonic non-decreasing; score delta per checkpoint window ≤ cap; kills/sec ≤ 12; overall pts/sec ≤ 1500 (Luna's ceilings, kept).
  4. Shards ≤ `2*kills + 20` (Luna's rule) and ≤ per-run cap.
  5. STORY `bossCleared` requires duration ≥ chapter minimum (config), kills ≥ chapter minimum, and checkpoints covering ≥ 80% of the run.
- Replay verification (deterministic seed + input log) is **out of scope for v1**; the ticket model keeps the door open.

### 6.3 Leaderboard
Best score per root per UTC day (and all-time). Two views: **Ranked** (verified, prize-eligible) and **Open** (everyone). Rows expose short address + identicon, not the root.

### 6.4 Spoils and `MoonshardVault`
Kinds: `TRIAL_PRIZE` (rank 1–3 verified humans for the closed day) and `SHARD_HARVEST` (shards banked that day × rate, per-root daily cap).
At UTC rollover the cron settles the previous day, writes `spoils` rows (idempotent by `(kind, day, root)`), and signs an EIP-712 voucher `Spoil(address to, uint256 id, uint256 amount, uint64 deadline)` where `id = keccak(kind, day, root)`. `to` is the wallet the root last connected with. Players fetch vouchers from `GET /api/spoils` and redeem on-chain.

`MoonshardVault` (Solidity 0.8.x, OpenZeppelin: `Ownable2Step`, `Pausable`, `ReentrancyGuard`, `EIP712`, `SafeERC20`):
- `claim(Spoil s, bytes sig)`: checks signer, `block.timestamp ≤ deadline`, `!claimed[id]`, `amount ≤ maxPerVoucher`, `claimedOnDay[day] + amount ≤ dailyCap`; pays `s.to` in G$. Anyone may submit (relayable), funds always go to `s.to`.
- Owner: `setSigner`, `setCaps`, `pause/unpause`, `withdraw`. A leaked signer key can only mint vouchers within the on-chain caps.
- Events: `Claimed(id, to, amount)`.

### 6.5 Engagement Rewards (first-boss bounty)
The app address is a dedicated **attestation signer**; the owner registers it with `applyApp` and GoodDollar approves it (external dependency). `GET /api/engagement/status` pre-checks `canClaim(app, user)` and the 180-day cooldown on-chain. `POST /api/engagement/attest {runId}` verifies a ticketed STORY run with `bossCleared`, then returns `{validUntilBlock, appSignature}` (EIP-712 `AppClaim(app, user, validUntilBlock)`, block window ≤ 600). The user signs the registration message and sends `nonContractAppClaim`. On-chain reward today: 5,000 G$ per user per app per 180 days; pool balance ≈ 47M G$ (read from Celo 2026-10-01).

### 6.6 Stats (growth metrics)
`GET /api/stats` (cached 60s): verified players, wallets connected, in-game UBI claims (server-confirmed tx), engagement claims, Spoils paid (G$), runs and daily active roots, last-7-day series. A `stats` view in the client and a standalone `/stats.html`.

### 6.7 Data (Postgres)
`users(root, first_seen, last_seen)`, `wallets(address, root, host, last_seen)`, `nonces`, `runs`, `run_checkpoints`, `scores`, `spoils`, `ubi_claims(tx_hash, root, day)`, `blessings(root, day)`, `engagement_claims(tx_hash, root)`. Migrations are plain SQL files applied at boot.

## 7. Client changes to the ported game

- Replace `nimiq/*` imports with `gd/*`; `Storage` key becomes `MOONSHARD_SAVE_V1`.
- Delete `ConnectGate`; `main.js` always starts the game.
- `StoryScene`/`SurvivalScene`: wrap run start/checkpoint/submit in `gd/runs.js`; replace `claimFirstStoryBossReward`/`bankCrystalHarvest` calls with ticket submit + end-screen CTAs. Do **not** restructure these scenes beyond that (StoryScene is 3.6k lines; refactor is explicitly out of scope).
- String rename sweep: Luna Blade → Moonshard, Luna Crystal → Shard, Luna Trial → Shard Trial, NIM → G$, Nimiq Pay → wallet. Asset file names may keep their names.
- New UI follows the existing retro-arcade style (`style.css`, pixel font), not a new design language. Verified by screenshot before presenting.
- Mobile: touch HUD unchanged; wallet sheet respects safe areas; works inside MiniPay's webview.

## 8. Assets and attribution

Same look is preserved. Provenance of every asset in `public/assets` is recorded in `docs/ATTRIBUTIONS.md`.
- Known: boar, bee, snail, tiles and environment art are from Anokolisa's *Legacy Fantasy – High Forest* (free, custom terms permit use "freely" in commercial projects; the redistribution wording sits in an off-repo Google Doc and has not been read).
- Unknown (no credits in the Luna Blade repo): other mobs, the 5 music tracks, portraits, swords, companion. These are marked **provenance pending**.
- **Release gate:** the repo can be built and demoed locally with everything. Before the repository is made public, every pending asset must be cleared or replaced with a lookalike under a clear licence. The owner is told this at the end; it does not block development.
- LICENSE keeps the original MIT notice; README and the application credit Luna Blade / ScriptedBro as the upstream.

## 9. Testing and verification

- **Server:** `node --test` with PGlite. Cover auth replay/nonce reuse, ticket rules (late submit, duplicate submit, impossible rates, mismatched root), settlement idempotency, voucher signing, engagement attestation window, stats.
- **Contract:** Foundry tests for valid claim, replay, expired, wrong signer, caps, pause, relayed claim pays `to`, owner withdraw.
- **Integration:** Anvil fork of Celo mainnet. Impersonate a whitelisted account to run `ClaimSDK.claim()`, `getWhitelistedRoot`, `nonContractAppClaim` (impersonate the admin to approve the test app), and `MoonshardVault.claim` with a funded vault. Report what ran and what did not.
- **Client:** Playwright scripts load the game with an injected mock EIP-1193 provider pointed at the fork; screenshots of Menu/Home hub, Connect sheet, verified/unverified states, Spoils, stats page, desktop and portrait mobile.
- Gameplay regression: the tutorial and Chapter 1 boot and run to the boss in headless Chromium without console errors.

## 10. Out of scope (v1)

Streaming sponsorship (Streaming SDK), GoodCollective pools, replay-based verification, new chapters or mechanics, refactoring `StoryScene`, React/wagmi, mainnet deployment, funding the vault, Engagement Rewards approval, publishing the repo. The first two are the planned next increment for the application narrative.

## 11. Needs the owner (does not block building)

1. Where the code is pushed (repo and account) and when.
2. G$ funding for `MoonshardVault` and a decision on prize sizes.
3. Registering and getting the app approved in Engagement Rewards (needs a small CELO balance for gas).
4. Optional Reown project ID for WalletConnect.
5. Accounts to deploy on Vercel and Railway.
6. KYC and the GoodBuilders form once published.
7. Clearing or replacing the pending-provenance assets before the repo goes public.

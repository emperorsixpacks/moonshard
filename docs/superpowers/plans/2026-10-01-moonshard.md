# Moonshard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Moonshard — a port of the Luna Blade action-platformer with Nimiq replaced by GoodDollar (G$) on Celo: wallet + verified-human identity, in-game UBI claim, Engagement Rewards first-boss bounty, vault-paid daily Spoils, ticketed runs, public stats.

**Architecture:** Ported Phaser 4 client (`src/`) keeps all gameplay; a new `src/gd/` layer talks to GoodDollar SDKs (viem) and to a new Express + Postgres API (`server/`) that issues run tickets, resolves one-human-one-slot identity, settles daily Spoils into EIP-712 vouchers, attests Engagement Rewards claims and confirms on-chain txs. A small Foundry contract (`contracts/`) holds G$ and pays vouchers the server signed.

**Tech Stack:** Node 22 ESM + JSDoc (no TypeScript), Phaser 4.2.1, Vite 8, viem 2.57, `@goodsdks/citizen-sdk` 1.2.7, `@goodsdks/engagement-sdk` 1.0.4, Express 4, `pg` + PGlite, Foundry (Solidity 0.8.24, OpenZeppelin v5.1.0), `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-moonshard-design.md` (read it first; amendments in Task 0 below).

> **Amendment after execution (2026-10-01).** This plan mentions MiniPay as a supported wallet host (Tasks 3, 8, 9, 13). During execution that support was built (signing-free sessions, legacy transactions, auto-connect), then **removed at the owner's request** because it was never required and MiniPay cannot sign messages. Treat every MiniPay reference below as superseded. The execution record, with all deviations from this plan, is `docs/EXECUTION_NOTES.md`.

## Global Constraints

- Project dir: `/Users/ram/Desktop/moonshard`. **Do not push, create remote repos, deploy, or spend funds.** Commits stay local.
- **No AI attribution** in commit messages: never add `Co-Authored-By` trailers or "Generated with" lines. Tell every subagent this explicitly.
- Product name **Moonshard**; sword = "the Moonshard"; Luna Crystals → **Shards**; Daily Luna Trial → **Daily Shard Trial**; hero's player-visible name **Selene** (internal speaker key `LUNA` and file `portrait_luna.png` may stay). No player-visible "Luna Blade", "Luna Crystal", "NIM", "Nimiq" strings remain at the end.
- Language: JavaScript ESM + JSDoc. Match surrounding code style (single quotes in `src/`, double quotes in `server/` as in Luna's server files, 2-space indent).
- Chain: Celo mainnet, chain id `42220`. G$ token `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` (18 decimals). Identity `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42`. UBI scheme `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`. Engagement Rewards proxy `0x25db74CF4E7BA120526fd87e159CF656d94bAE43` (EIP-712 domain name `EngagementRewards`, version `1.0`; `AppClaim(address app,address user,uint256 validUntilBlock)`; `validUntilBlock` must be ≤ current block + 600).
- `claim()` selector on the UBI scheme is `0x4e71d92d`.
- Package versions: phaser `^4.2.1`, vite `^8.3.0`, viem `^2.57.2`, `@goodsdks/citizen-sdk` `^1.2.7`, `@goodsdks/engagement-sdk` `^1.0.4`.
- Identity key: all rewards, boards, caps key on `subject` = whitelisted root (lowercase) when verified, else the wallet address (lowercase).
- Server limits (in `server/config.js` `GAME`): ticket max age 40 min, min duration 5 s, clock tolerance **5 s**, ≤ 1500 pts/s, ≤ 12 kills/s, shards ≤ `min(2*kills+20, 60)` per run, 50 shards/day cap paid at 2 G$ each, daily prizes `[1000, 600, 300]` G$, voucher TTL 7 days.
- Do **not** refactor `StoryScene.js` / `SurvivalScene.js` beyond the exact edits named in Task 11.
- Never commit `.env`, private keys, `node_modules`, `dist`, `contracts/out|cache|lib`, `server/data`.
- Asset provenance is tracked in `docs/ATTRIBUTIONS.md`; repo must not be made public until pending items are cleared (Task 15 reports this).

## Review Focus

Failure modes the spec implies but a happy-path build would miss, most likely first. Each has a test in the task named.

1. **No wallet / wrong wallet host:** Safari or Firefox with no `window.ethereum` clicks Connect → readable "no wallet found" message, game stays playable (Task 8 `wallet.test.js`).
2. **Wrong chain:** wallet is on Ethereum/other chain → app asks to switch to Celo; if the player refuses, state stays `connected` with `wrongChain: true` and claim/redeem buttons disabled, not a crash (Task 8).
3. **Server unreachable or slow when a run starts:** game starts anyway as an unticketed offline run, `finish()` is a no-op, no unhandled rejection (Task 9 `runs.test.js`).
4. **Two linked wallets, one human:** both wallets resolve to the same root → one score row per day, one prize slot, shared shard cap (Task 5 `runs.test.js`, Task 6 `spoils.test.js`).
5. **UTC midnight boundary:** a run started 23:55 and submitted 00:03 counts for the start day; settlement of a day waits until the ticket window has passed (Task 5, Task 6).

---

### Task 0: Spec amendments (docs only)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-moonshard-design.md`

**Why:** Reading the port showed (a) there is no revive mechanic, (b) hero is named Luna, (c) ranked eligibility needs checkpoint coverage.

- [ ] **Step 1: Apply three edits**

In §5 step 6 replace `(+25% Forge material drops, one free revive in Story)` with `(+25% Forge material drops in Story and Shard Trial, applied centrally in \`Storage.addMaterials\`)`.

In §2 table, change the Name row to: `**Moonshard**; sword = "the Moonshard"; hero's player-visible name **Selene**; Luna Crystals → **Shards**; Daily Luna Trial → **Daily Shard Trial**`.

In §6.2 after step 5 add: `6. A TRIAL run is *ranked-eligible* only if the account is verified, no flags were raised, and checkpoint coverage (last checkpoint t ÷ durationMs) ≥ 0.5. Otherwise the score is stored for the Open board only.`

In §3 replace the UI line `ui/  HomeHub.js, WalletPill.js, SpoilsPanel.js, ConnectSheet.js   # NEW` with `ui/  GdPanel.js   # NEW: one DOM panel (connect, verify, daily claim, bounty, Spoils)` and add `src/gd/` entries `rewards.js, leaderboard.js, blessing.js, format.js, identicon.js, config.js`.

In §2 replace the Wallet row's text with: `Thin \`wallet.js\` over EIP-1193 (\`window.ethereum\`; detects MiniPay via \`isMiniPay\`); optional WalletConnect through \`@walletconnect/ethereum-provider\` when \`VITE_REOWN_PROJECT_ID\` is set`.

In §9 replace the last bullet (gameplay regression) with: `Gameplay smoke: the Tutorial, Story Chapter 1 and the Daily Shard Trial boot and run in headless Chromium with no page errors, and the ticketed-run requests are observed. The boss-clear and bounty path is verified through the API/SDK flow on a Celo fork (a scripted idle player cannot beat a boss), plus the UI claim path in Playwright.`

- [ ] **Step 2: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add docs && git commit -m "docs: spec amendments (blessing effect, hero name, ranked coverage rule)"
```

---

### Task 1: Port the game, rename, and get a green build

**Files:**
- Create: everything copied from Luna Blade (see Step 2), `scripts/rename-sweep.mjs`, `.gitignore`, `package.json`, `LICENSE`, `docs/ATTRIBUTIONS.md` (skeleton)
- Modify: ported `src/**`, `index.html`

**Interfaces:**
- Produces: a building Vite app at repo root with Moonshard naming; `src/entities/ShardDrop.js` (was `LunaCrystalDrop.js`); Nimiq code still present (removed in Tasks 10–11) so `@nimiq/*` deps stay for now.

- [ ] **Step 1: Fetch upstream into a temp dir**

```bash
cd /Users/ram/Desktop/moonshard
export LUNA_SRC="$(mktemp -d)/luna"
git clone --depth 1 https://github.com/JemIIahh/Luna-Blade.git "$LUNA_SRC"
git -C "$LUNA_SRC" log -1 --format='%H' > docs/UPSTREAM_COMMIT.txt
```

- [ ] **Step 2: Copy only what ships**

```bash
rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude 'extracted_assets' --exclude 'extracted_debug' \
  --exclude 'screenshots' --exclude 'server' --exclude 'render.yaml' --exclude 'README.md' \
  --exclude 'package.json' --exclude 'package-lock.json' --exclude '.gitignore' \
  "$LUNA_SRC"/ ./
ls            # expect: LICENSE index.html public src vite.config.js (plus our docs/)
```

- [ ] **Step 3: Write `package.json` and `.gitignore`**

`package.json`:

```json
{
  "name": "moonshard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Moonshard: The High Forest — a pixel action-platformer powered by GoodDollar (G$) on Celo",
  "scripts": {
    "dev": "vite",
    "dev:all": "concurrently -k -n api,web -c green,cyan \"npm run dev --prefix server\" \"vite\"",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test \"test/client/**/*.test.js\" && npm test --prefix server",
    "test:contracts": "cd contracts && forge test -vv",
    "start:server": "npm start --prefix server"
  },
  "license": "MIT",
  "dependencies": {
    "@goodsdks/citizen-sdk": "^1.2.7",
    "@goodsdks/engagement-sdk": "^1.0.4",
    "@nimiq/hub-api": "^1.15.0",
    "@nimiq/identicons": "^1.6.2",
    "@nimiq/mini-app-sdk": "^0.1.0",
    "@walletconnect/ethereum-provider": "^2.25.0",
    "canvas-confetti": "^1.9.4",
    "phaser": "^4.2.1",
    "viem": "^2.57.2"
  },
  "devDependencies": {
    "concurrently": "^10.0.5",
    "vite": "^8.3.0"
  }
}
```

(The three `@nimiq/*` entries are temporary; Task 10 removes them.)

`.gitignore`:

```
node_modules
dist
.env
.env.*
!.env.example
server/data
contracts/out
contracts/cache
contracts/lib
contracts/broadcast
playwright-report
test-results
.DS_Store
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: install succeeds. Notes (verified 2026-10-01): `@goodsdks/engagement-contracts` is **not** published on npm and is not needed, because `@goodsdks/engagement-sdk` bundles the Celo addresses (prod `0x25db…AE43`, dev `0xb44f…0465`). The SDK imports `react` and `wagmi` at module top level; npm installs them as peers automatically. They are only needed for the SDK's unused `useEngagementRewards` hook, and Vite tree-shakes `wagmi` (side-effect-free); do not import that hook.

- [ ] **Step 5: Write the rename sweep script**

Create `scripts/rename-sweep.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

// Ordered: longer / more specific phrases first so shorter ones do not clobber them.
const PAIRS = [
  ["LUNA_BLADE_SAVE_V1", "MOONSHARD_SAVE_V1"],
  ["LUNA BLADE", "MOONSHARD"],
  ["Luna Blade", "Moonshard"],
  ["luna-blade", "moonshard"],
  ["luna_blade", "moonshard"],
  ["LUNA HARVEST", "SHARD HARVEST"],
  ["Luna Harvest", "Shard Harvest"],
  ["LUNA CRYSTALS", "SHARDS"],
  ["Luna Crystals", "Shards"],
  ["Luna Crystal", "Shard"],
  ["LUNA CRYSTAL", "SHARD"],
  ["LUNA_CRYSTAL", "SHARD"],
  ["luna_crystal", "shard"],
  ["LunaCrystalCollected", "ShardCollected"],
  ["LunaCrystalDrop", "ShardDrop"],
  ["lunaCrystalRewardNim", "shardRewardGd"],
  ["lunaCrystalDailyCapNim", "dailyShardCapGd"],
  ["lunaCrystals", "shardDrops"],
  ["Daily Luna Trial", "Daily Shard Trial"],
  ["DAILY LUNA TRIAL", "DAILY SHARD TRIAL"],
  ["Luna Trial", "Shard Trial"],
  ["LUNA TRIAL", "SHARD TRIAL"],
  ["luna-inset", "ms-inset"],
  ["luna-toast", "ms-toast"],
  ["luna-safe", "ms-safe"],
];

const ROOTS = ["src", "index.html"];
const EXT = new Set([".js", ".css", ".html"]);
let changedFiles = 0;

function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).flatMap((f) => walk(path.join(p, f)));
  return EXT.has(path.extname(p)) ? [p] : [];
}

for (const file of ROOTS.flatMap(walk)) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of PAIRS) after = after.split(from).join(to);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles++;
  }
}
console.log(`rename-sweep: updated ${changedFiles} files`);
```

- [ ] **Step 6: Run the sweep, rename the file, set hero display name**

```bash
node scripts/rename-sweep.mjs
git mv src/entities/LunaCrystalDrop.js src/entities/ShardDrop.js 2>/dev/null || mv src/entities/LunaCrystalDrop.js src/entities/ShardDrop.js
# Hero: replace the bare title-case word "Luna" (person) in dialogue/story scenes only.
# Speaker KEYS are upper-case 'LUNA' and are intentionally left alone.
grep -n "\bLuna\b" src/scenes/*.js src/ui/*.js src/entities/*.js src/engine/*.js | cut -c1-140
```

Review that output: every remaining hit should be the hero speaking or being addressed. Then:

```bash
sed -E -i '' 's/\bLuna\b/Selene/g' src/scenes/StoryScene.js src/scenes/StoryIntroScene.js src/scenes/StoryEndingScene.js src/scenes/TutorialScene.js src/ui/StoryDialogueBox.js
```

Find where the dialogue box prints the speaker name and add a display map. Run `grep -n "speaker" src/ui/StoryDialogueBox.js`, then at the place the speaker label text is set, wrap it:

```js
const SPEAKER_LABELS = { LUNA: 'SELENE' };
// when rendering the name tag:
//   label = SPEAKER_LABELS[speaker] ?? speaker;
```

- [ ] **Step 7: Verify nothing player-facing still says Luna Blade/Crystal**

```bash
grep -rniE "luna" src index.html | grep -viE "lunar|portrait_luna|'LUNA'|\"LUNA\"|LUNA:|speaker" || echo "clean"
```

Expected: `clean`, or only items you can justify (asset file names, internal keys). Fix any others.

- [ ] **Step 8: Keep the original license and add ours**

Edit `LICENSE`: keep the existing `Copyright (c) 2026 ScriptedBro` line and add a second line directly below it: `Copyright (c) 2026 Moonshard contributors`. Do not change the MIT text.

- [ ] **Step 9: ATTRIBUTIONS skeleton**

Create `docs/ATTRIBUTIONS.md`:

```markdown
# Attributions

Moonshard is derived from **Luna Blade** by ScriptedBro (MIT, https://github.com/ScriptedBro/Luna-Blade).
Upstream commit used: see `docs/UPSTREAM_COMMIT.txt`.

## Art and audio
Filled in by Task 15 (`scripts/audit-assets.mjs`). Status legend: **cleared** (source and licence confirmed), **pending** (provenance unknown, must be resolved before the repository is made public).
```

- [ ] **Step 10: Build**

```bash
npm run build
```

Expected: `vite build` completes with `dist/` output and no errors (chunk-size warnings are fine).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: port Luna Blade gameplay as Moonshard (rename sweep, MIT notice retained)"
```

---

### Task 2: `MoonshardVault` contract (Foundry)

**Files:**
- Create: `contracts/foundry.toml`, `contracts/src/MoonshardVault.sol`, `contracts/test/MoonshardVault.t.sol`, `contracts/script/Deploy.s.sol`

**Interfaces:**
- Produces: contract with `claim(address to,uint256 id,uint256 amount,uint64 deadline,bytes signature)`, `claimed(uint256) → bool`, `SPOIL_TYPEHASH`, `DOMAIN_SEPARATOR()`, EIP-712 domain `{name:"MoonshardVault", version:"1", chainId, verifyingContract}`, typed data `Spoil(address to,uint256 id,uint256 amount,uint64 deadline)`. Server (Task 6) and client (Task 9) sign/redeem against exactly this.

- [ ] **Step 1: Scaffold and install libs**

```bash
cd /Users/ram/Desktop/moonshard/contracts
cat > foundry.toml <<'EOF'
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/",
]
EOF
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
ls lib
```

Expected: `forge-std  openzeppelin-contracts`.

- [ ] **Step 2: Write the failing tests**

Create `contracts/test/MoonshardVault.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";

contract TestG is ERC20 {
    constructor() ERC20("Test G$", "G$") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract MoonshardVaultTest is Test {
    MoonshardVault vault;
    TestG token;

    uint256 signerPk = 0xA11CE;
    address signer;
    address owner = address(0xB0B);
    address alice = address(0xA11);
    address relayer = address(0xDEAD);

    uint256 constant MAX_VOUCHER = 1_000 ether;
    uint256 constant DAILY_CAP = 2_500 ether;

    function setUp() public {
        vm.warp(1_800_000_000);
        signer = vm.addr(signerPk);
        token = new TestG();
        vault = new MoonshardVault(IERC20(address(token)), signer, owner, MAX_VOUCHER, DAILY_CAP);
        token.transfer(address(vault), 100_000 ether);
    }

    function _sign(uint256 pk, address to, uint256 id, uint256 amount, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(vault.SPOIL_TYPEHASH(), to, id, amount, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function test_claim_pays_recipient() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 1, 500 ether, dl);
        vault.claim(alice, 1, 500 ether, dl, sig);
        assertEq(token.balanceOf(alice), 500 ether);
        assertTrue(vault.claimed(1));
    }

    function test_relayed_claim_pays_to_not_sender() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 2, 100 ether, dl);
        vm.prank(relayer);
        vault.claim(alice, 2, 100 ether, dl, sig);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_replay_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 3, 100 ether, dl);
        vault.claim(alice, 3, 100 ether, dl, sig);
        vm.expectRevert(MoonshardVault.AlreadyClaimed.selector);
        vault.claim(alice, 3, 100 ether, dl, sig);
    }

    function test_expired_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 4, 100 ether, dl);
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(MoonshardVault.Expired.selector);
        vault.claim(alice, 4, 100 ether, dl, sig);
    }

    function test_wrong_signer_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(0xBAD, alice, 5, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 5, 100 ether, dl, sig);
    }

    function test_tampered_amount_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 6, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 6, 200 ether, dl, sig);
    }

    function test_tampered_recipient_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 7, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(relayer, 7, 100 ether, dl, sig);
    }

    function test_over_voucher_cap_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 8, MAX_VOUCHER + 1, dl);
        vm.expectRevert(MoonshardVault.OverVoucherCap.selector);
        vault.claim(alice, 8, MAX_VOUCHER + 1, dl, sig);
    }

    function test_daily_cap_blocks_then_resets_next_day() public {
        uint64 dl = _deadline();
        vault.claim(alice, 10, 1_000 ether, dl, _sign(signerPk, alice, 10, 1_000 ether, dl));
        vault.claim(alice, 11, 1_000 ether, dl, _sign(signerPk, alice, 11, 1_000 ether, dl));
        bytes memory sig3 = _sign(signerPk, alice, 12, 1_000 ether, dl);
        vm.expectRevert(MoonshardVault.OverDailyCap.selector);
        vault.claim(alice, 12, 1_000 ether, dl, sig3);
        vm.warp(block.timestamp + 1 days);
        vault.claim(alice, 12, 1_000 ether, dl, sig3);
        assertEq(token.balanceOf(alice), 3_000 ether);
    }

    function test_pause_blocks_claims() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 20, 100 ether, dl);
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.claim(alice, 20, 100 ether, dl, sig);
        vm.prank(owner);
        vault.unpause();
        vault.claim(alice, 20, 100 ether, dl, sig);
    }

    function test_only_owner_withdraws() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.withdraw(alice, 1 ether);

        vm.prank(owner);
        vault.withdraw(owner, 500 ether);
        assertEq(token.balanceOf(owner), 500 ether);
    }

    function test_only_owner_sets_signer_and_caps() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.setSigner(alice);

        vm.startPrank(owner);
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        vault.setSigner(address(0));
        vault.setSigner(alice);
        vault.setCaps(5 ether, 10 ether);
        vm.stopPrank();
        assertEq(vault.signer(), alice);
        assertEq(vault.maxPerVoucher(), 5 ether);
        assertEq(vault.dailyCap(), 10 ether);
    }

    function test_rotated_signer_invalidates_old_vouchers() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 30, 100 ether, dl);
        vm.prank(owner);
        vault.setSigner(address(0xCAFE));
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 30, 100 ether, dl, sig);
    }

    function test_two_step_ownership() public {
        vm.prank(owner);
        vault.transferOwnership(alice);
        assertEq(vault.owner(), owner);
        vm.prank(alice);
        vault.acceptOwnership();
        assertEq(vault.owner(), alice);
    }

    function test_constructor_rejects_zero_token_or_signer() public {
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        new MoonshardVault(IERC20(address(0)), signer, owner, 1, 1);
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        new MoonshardVault(IERC20(address(token)), address(0), owner, 1, 1);
    }

    function testFuzz_amount_over_voucher_cap_always_reverts(uint256 amount) public {
        amount = bound(amount, MAX_VOUCHER + 1, type(uint128).max);
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 99, amount, dl);
        vm.expectRevert(MoonshardVault.OverVoucherCap.selector);
        vault.claim(alice, 99, amount, dl, sig);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
forge test
```

Expected: compile error `Source "../src/MoonshardVault.sol" not found` (or similar).

- [ ] **Step 4: Implement the contract**

Create `contracts/src/MoonshardVault.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MoonshardVault
/// @notice Holds G$ and pays "Spoils" (daily prizes / shard harvest) against EIP-712 vouchers signed by
///         the game server. A leaked signer key can only mint vouchers within the on-chain caps below.
contract MoonshardVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SPOIL_TYPEHASH =
        keccak256("Spoil(address to,uint256 id,uint256 amount,uint64 deadline)");

    IERC20 public immutable token;
    address public signer;
    uint256 public maxPerVoucher;
    uint256 public dailyCap;

    mapping(uint256 id => bool) public claimed;
    mapping(uint256 day => uint256 amount) public claimedOnDay;

    event Claimed(uint256 indexed id, address indexed to, uint256 amount);
    event SignerChanged(address indexed signer);
    event CapsChanged(uint256 maxPerVoucher, uint256 dailyCap);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error Expired();
    error AlreadyClaimed();
    error BadSignature();
    error OverVoucherCap();
    error OverDailyCap();

    constructor(IERC20 token_, address signer_, address owner_, uint256 maxPerVoucher_, uint256 dailyCap_)
        Ownable(owner_)
        EIP712("MoonshardVault", "1")
    {
        if (address(token_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
        maxPerVoucher = maxPerVoucher_;
        dailyCap = dailyCap_;
    }

    /// @notice Redeem a voucher. Anyone may submit it; funds always go to `to`.
    function claim(address to, uint256 id, uint256 amount, uint64 deadline, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();
        if (claimed[id]) revert AlreadyClaimed();
        if (amount > maxPerVoucher) revert OverVoucherCap();

        uint256 day = block.timestamp / 1 days;
        if (claimedOnDay[day] + amount > dailyCap) revert OverDailyCap();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SPOIL_TYPEHASH, to, id, amount, deadline)));
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert BadSignature();

        claimed[id] = true;
        claimedOnDay[day] += amount;
        token.safeTransfer(to, amount);
        emit Claimed(id, to, amount);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        signer = newSigner;
        emit SignerChanged(newSigner);
    }

    function setCaps(uint256 newMaxPerVoucher, uint256 newDailyCap) external onlyOwner {
        maxPerVoucher = newMaxPerVoucher;
        dailyCap = newDailyCap;
        emit CapsChanged(newMaxPerVoucher, newDailyCap);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
forge test -vv
```

Expected: all tests PASS (16 tests incl. the fuzz test).

- [ ] **Step 6: Deployment script**

Create `contracts/script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";

/// Usage: G_TOKEN=0x.. VOUCHER_SIGNER=0x.. VAULT_OWNER=0x.. MAX_PER_VOUCHER=1000000000000000000000 \
///        DAILY_CAP=5000000000000000000000 forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
contract Deploy is Script {
    function run() external returns (MoonshardVault vault) {
        address token = vm.envAddress("G_TOKEN");
        address signer = vm.envAddress("VOUCHER_SIGNER");
        address owner = vm.envAddress("VAULT_OWNER");
        uint256 maxPerVoucher = vm.envUint("MAX_PER_VOUCHER");
        uint256 dailyCap = vm.envUint("DAILY_CAP");
        vm.startBroadcast();
        vault = new MoonshardVault(IERC20(token), signer, owner, maxPerVoucher, dailyCap);
        vm.stopBroadcast();
    }
}
```

Run `forge build` — expected: compiles.

- [ ] **Step 7: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add contracts docs
git commit -m "feat(contracts): MoonshardVault with capped EIP-712 vouchers and tests"
```

---

### Task 3: Server foundation (config, DB, chain adapter, app factory, test harness)

**Files:**
- Create: `server/package.json`, `server/config.js`, `server/.env.example`, `server/index.js`
- Create: `server/migrations/001_init.sql`
- Create: `server/src/db.js`, `server/src/time.js`, `server/src/http.js`, `server/src/chain.js`, `server/src/identity.js`, `server/src/app.js`
- Test: `server/test/helpers.js`, `server/test/db.test.js`, `server/test/config.test.js`

**Interfaces:**
- Produces:
  - `createDb(databaseUrl: string): Promise<{query(sql, params?): Promise<{rows}>, exec(sql), tx(fn), close()}>` — empty URL ⇒ in-memory PGlite; migrations in `server/migrations/*.sql` run automatically.
  - `dayKey(ms: number): string` → `"YYYY-MM-DD"` (UTC); `startOfDayMs(day: string): number`.
  - `HttpError(status, code, extra?)`, `ah(fn)` async-handler wrapper, `errorHandler`.
  - `createChain(config): Chain` where `Chain` = `{identity(address) → {isWhitelisted, root|null, expiresAt|null, expired}, verifySignature(address, message, signature) → Promise<boolean>, getTx(hash) → {tx, receipt, timestamp}|null, blockNumber() → Promise<bigint>, canClaimEngagement(app, user) → {ok, reason}, voucherClaimed(id) → Promise<boolean>}`.
  - `createIdentityResolver({chain, db, now, ttlMs?}).resolve(wallet, host?) → {wallet, subject, verified, root|null, status: 'verified'|'unverified'|'expired', expiresAt|null}`, `.invalidate(wallet)`.
  - `createApp({db, chain, config, now?}) → {app, ctx}`; `ctx = {db, chain, config, now, identity, voucherAccount|null, appAccount|null, requireAuth}`.
  - Test helpers: `makeHarness(opts) → {api, ctx, chain, clock, db, config, newPlayer({verified?, root?}), close()}`, `fakeChain()`, `fakeClock(start?)`, `T0`.

- [ ] **Step 1: Package and env files**

`server/package.json`:

```json
{
  "name": "moonshard-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Moonshard API: wallet auth, run tickets, leaderboard, G$ Spoils vouchers, Engagement Rewards attestation, stats",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "test": "node --test"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.3.0",
    "cors": "^2.8.5",
    "dotenv": "^17.4.2",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.0",
    "viem": "^2.57.2"
  }
}
```

`server/.env.example`:

```
# Moonshard API
PORT=3001
JWT_SECRET=CHANGE_ME_openssl_rand_base64_32
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
# Empty DATABASE_URL = in-memory PGlite (dev only; data is lost on restart).
# For hosted Postgres use e.g. postgres://user:pass@host:5432/db?sslmode=require
# (TLS is always verified; set DATABASE_CA to the PEM text only if the host uses a private CA).
DATABASE_URL=
CELO_RPC_URL=https://forno.celo.org
CHAIN_ID=42220
# MoonshardVault address after deployment (leave empty to disable Spoils vouchers)
VAULT_ADDRESS=
# Key that signs Spoil vouchers. Can only mint vouchers within the vault's on-chain caps.
VOUCHER_SIGNER_KEY=
# Key whose address is registered as the Engagement Rewards "app". Signs attestations only; holds no funds.
APP_SIGNER_KEY=
```

Run `cd server && npm install`.

- [ ] **Step 2: Config**

`server/config.js`:

```js
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });

const env = process.env;
const num = (v, d) => (v == null || v === "" ? d : Number(v));
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const G = (n) => BigInt(n) * 10n ** 18n;

export const JWT_TTL_SEC = 12 * 60 * 60;
export const NONCE_TTL_MS = 5 * 60_000;
export const IDENTITY_TTL_MS = 5 * 60_000;

/** Game-design tunables. Amounts are wei of G$ (18 decimals). */
export const GAME = {
  TICKET_MAX_AGE_MS: 40 * 60_000,
  MIN_DURATION_MS: 5_000,
  CLOCK_TOLERANCE_MS: 5_000,
  MAX_PTS_PER_SEC: 1_500,
  MAX_KILLS_PER_SEC: 12,
  MAX_SCORE: 100_000_000,
  MAX_CHECKPOINTS: 400,
  CHECKPOINT_SLACK_PTS: 300,
  MIN_COVERAGE_RANKED: 0.5,
  MIN_COVERAGE_BOSS: 0.8,
  SHARDS_PER_KILL: 2,
  SHARDS_BASE_ALLOWANCE: 20,
  MAX_SHARDS_PER_RUN: 60,
  DAILY_SHARD_CAP: 50,
  SHARD_RATE: G(2),
  PRIZES: [G(1000), G(600), G(300)],
  VOUCHER_TTL_SEC: 7 * 24 * 3600,
  BOSS_MIN: { durationMs: 30_000, kills: 3 },
  ENGAGEMENT_BLOCK_WINDOW: 300n,
  ATTEST_MAX_AGE_MS: 24 * 3600_000,
  ENGAGEMENT_REWARD_G: "5000", // informational: what the protocol pool pays today (read on-chain 2026-10-01)
};

export const config = {
  port: num(env.PORT, 3001),
  jwtSecret: env.JWT_SECRET || "",
  corsOrigins: list(env.CORS_ORIGINS) || "*",
  databaseUrl: env.DATABASE_URL || "",
  rpcUrl: env.CELO_RPC_URL || "https://forno.celo.org",
  chainId: num(env.CHAIN_ID, 42220),
  contracts: {
    identity: env.IDENTITY_ADDRESS || "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    ubi: env.UBI_ADDRESS || "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",
    token: env.GD_TOKEN_ADDRESS || "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    engagement: env.ENGAGEMENT_ADDRESS || "0x25db74CF4E7BA120526fd87e159CF656d94bAE43",
    vault: env.VAULT_ADDRESS || "",
  },
  voucherSignerKey: env.VOUCHER_SIGNER_KEY || "",
  appSignerKey: env.APP_SIGNER_KEY || "",
};
```

- [ ] **Step 3: Migration**

`server/migrations/001_init.sql`:

```sql
CREATE TABLE nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE TABLE users (
  subject text PRIMARY KEY,
  root text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  address text PRIMARY KEY,
  subject text NOT NULL,
  host text NOT NULL DEFAULT 'browser',
  verified boolean NOT NULL DEFAULT false,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallets_subject ON wallets(subject);

CREATE TABLE runs (
  run_id text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  verified boolean NOT NULL,
  mode text NOT NULL CHECK (mode IN ('TRIAL','STORY')),
  chapter integer,
  seed text NOT NULL,
  day text NOT NULL,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','void')),
  submitted_at timestamptz,
  score integer,
  kills integer,
  shards integer,
  duration_ms integer,
  boss_cleared boolean NOT NULL DEFAULT false,
  ranked_ok boolean NOT NULL DEFAULT false,
  flags text NOT NULL DEFAULT ''
);
CREATE INDEX runs_open ON runs(subject, mode) WHERE status = 'open';

CREATE TABLE run_checkpoints (
  run_id text NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq integer NOT NULL,
  t_ms integer NOT NULL,
  score integer NOT NULL,
  kills integer NOT NULL,
  shards integer NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE scores (
  day text NOT NULL,
  subject text NOT NULL,
  wallet text NOT NULL,
  verified boolean NOT NULL,
  ranked_ok boolean NOT NULL,
  score integer NOT NULL,
  kills integer NOT NULL,
  duration_ms integer NOT NULL,
  run_id text NOT NULL,
  PRIMARY KEY (day, subject)
);

CREATE TABLE shard_days (
  day text NOT NULL,
  subject text NOT NULL,
  shards integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject)
);

CREATE TABLE settled_days (
  day text PRIMARY KEY,
  settled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spoils (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('TRIAL_PRIZE','SHARD_HARVEST')),
  day text NOT NULL,
  subject text NOT NULL,
  amount text NOT NULL,
  rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, day, subject)
);

CREATE TABLE spoil_claims (
  tx_hash text PRIMARY KEY,
  spoil_id text NOT NULL,
  subject text NOT NULL,
  amount text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ubi_claims (
  tx_hash text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  day text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blessings (
  subject text NOT NULL,
  day text NOT NULL,
  PRIMARY KEY (subject, day)
);

CREATE TABLE engagement_claims (
  tx_hash text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Write the failing DB test**

`server/test/db.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";

const TABLES = [
  "nonces", "users", "wallets", "runs", "run_checkpoints", "scores", "shard_days",
  "settled_days", "spoils", "spoil_claims", "ubi_claims", "blessings", "engagement_claims",
];

test("migrations create every table", async () => {
  const db = await createDb("");
  for (const t of TABLES) {
    const r = await db.query("SELECT to_regclass($1::text) AS t", [t]);
    assert.ok(r.rows[0].t, `missing table ${t}`);
  }
  const m = await db.query("SELECT count(*)::int AS n FROM _migrations");
  assert.equal(m.rows[0].n, 1);
  await db.close();
});

test("tx commits on success and rolls back on error", async () => {
  const db = await createDb("");
  await db.tx(async (t) => {
    await t.query("INSERT INTO users(subject) VALUES ($1)", ["0xaa"]);
  });
  await assert.rejects(
    db.tx(async (t) => {
      await t.query("INSERT INTO users(subject) VALUES ($1)", ["0xbb"]);
      throw new Error("boom");
    }),
    /boom/,
  );
  const r = await db.query("SELECT subject FROM users ORDER BY subject");
  assert.deepEqual(r.rows.map((x) => x.subject), ["0xaa"]);
  await db.close();
});
```

- [ ] **Step 5: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard/server && npm test
```

Expected: FAIL — cannot find `../src/db.js`.

- [ ] **Step 6: Implement db, time, http**

`server/src/db.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Postgres in production (DATABASE_URL), in-memory PGlite when the URL is empty.
 * Both speak the same SQL; results expose `{ rows }`.
 */
export async function createDb(databaseUrl) {
  let db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    // TLS stays verified. Use `?sslmode=require` in DATABASE_URL, and set DATABASE_CA (PEM text) only
    // when the host uses a private CA. Never disable certificate verification.
    const ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : undefined;
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl });
    db = {
      query: (sql, params = []) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn({ query: (s, p = []) => client.query(s, p) });
          await client.query("COMMIT");
          return out;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite();
    db = {
      query: (sql, params = []) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: (s, p = []) => t.query(s, p) })),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const { rows } = await db.query("SELECT name FROM _migrations");
  const done = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    await db.query("INSERT INTO _migrations(name) VALUES ($1)", [f]);
  }
}
```

`server/src/time.js`:

```js
/** UTC day key "YYYY-MM-DD" for a millisecond timestamp. */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const startOfDayMs = (day) => Date.parse(`${day}T00:00:00.000Z`);
export const DAY_MS = 86_400_000;
```

`server/src/http.js`:

```js
export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Express 4 does not catch async rejections; wrap every async handler. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json" });
  if (err?.code === "CHAIN_UNAVAILABLE") return res.status(503).json({ error: "chain_unavailable" });
  console.error("[moonshard]", err);
  return res.status(500).json({ error: "internal_error" });
}
```

- [ ] **Step 7: Run to verify DB tests pass**

```bash
npm test
```

Expected: 2 tests PASS.

- [ ] **Step 8: Chain adapter**

`server/src/chain.js`:

```js
import { createPublicClient, http, parseAbi, zeroAddress } from "viem";

export const identityAbi = parseAbi([
  "function getWhitelistedRoot(address) view returns (address)",
  "function lastAuthenticated(address) view returns (uint256)",
  "function authenticationPeriod() view returns (uint256)",
]);

export const engagementAbi = parseAbi([
  "function canClaim(address app, address user) view returns (bool)",
  "event RewardClaimed(address indexed app, address indexed user, address indexed inviter, uint256 appReward, uint256 userAmount, uint256 inviterAmount)",
]);

export const vaultAbi = parseAbi([
  "function claimed(uint256) view returns (bool)",
  "event Claimed(uint256 indexed id, address indexed to, uint256 amount)",
]);

const NOT_FOUND = /NotFound/;

/** @param {import("../config.js").config} config */
export function createChain(config) {
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  const { identity: identityAddr, engagement: engagementAddr, vault: vaultAddr } = config.contracts;

  return {
    async identity(address) {
      const read = (functionName, args) =>
        client.readContract({ address: identityAddr, abi: identityAbi, functionName, args });
      const root = await read("getWhitelistedRoot", [address]);
      if (root === zeroAddress) {
        const last = await read("lastAuthenticated", [address]);
        return { isWhitelisted: false, root: null, expiresAt: null, expired: last > 0n };
      }
      const [last, periodDays] = await Promise.all([read("lastAuthenticated", [root]), read("authenticationPeriod", [])]);
      const expiresAt = last > 0n ? Number((last + periodDays * 86_400n) * 1000n) : null;
      return { isWhitelisted: true, root: root.toLowerCase(), expiresAt, expired: false };
    },

    verifySignature: (address, message, signature) => client.verifyMessage({ address, message, signature }),

    async getTx(hash) {
      try {
        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash }),
          client.getTransactionReceipt({ hash }),
        ]);
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        return { tx, receipt, timestamp: Number(block.timestamp) };
      } catch (err) {
        if (NOT_FOUND.test(err?.name || "")) return null;
        throw err;
      }
    },

    blockNumber: () => client.getBlockNumber(),

    async canClaimEngagement(app, user) {
      try {
        const ok = await client.readContract({
          address: engagementAddr, abi: engagementAbi, functionName: "canClaim", args: [app, user],
        });
        return { ok, reason: ok ? null : "not_claimable" };
      } catch (err) {
        return { ok: false, reason: err?.cause?.reason || err?.shortMessage || err?.message || "not_claimable" };
      }
    },

    async voucherClaimed(id) {
      if (!vaultAddr) return false;
      return client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "claimed", args: [BigInt(id)] });
    },
  };
}
```

- [ ] **Step 9: Identity resolver**

`server/src/identity.js`:

```js
import { IDENTITY_TTL_MS } from "../config.js";

/**
 * Maps a wallet to its "subject": the whitelisted root when verified (one human, one slot even
 * across linked wallets), else the wallet itself. Results are cached for `ttlMs`.
 */
export function createIdentityResolver({ chain, db, now, ttlMs = IDENTITY_TTL_MS }) {
  const cache = new Map();

  async function lookup(key) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.info;
    try {
      const info = await chain.identity(key);
      cache.set(key, { at: now(), info });
      return info;
    } catch (cause) {
      if (hit) return hit.info; // serve stale rather than lock players out during an RPC blip
      const err = new Error("chain unavailable", { cause });
      err.code = "CHAIN_UNAVAILABLE";
      throw err;
    }
  }

  return {
    async resolve(wallet, host) {
      const key = String(wallet).toLowerCase();
      const info = await lookup(key);
      const live = info.isWhitelisted && (info.expiresAt == null || info.expiresAt > now());
      const verified = Boolean(live && info.root);
      const subject = verified ? info.root : key;
      const status = verified ? "verified" : info.expired || (info.isWhitelisted && !live) ? "expired" : "unverified";
      await db.query(
        `INSERT INTO users(subject, root) VALUES ($1, $2)
         ON CONFLICT (subject) DO UPDATE SET last_seen = now(), root = COALESCE(EXCLUDED.root, users.root)`,
        [subject, verified ? subject : null],
      );
      await db.query(
        `INSERT INTO wallets(address, subject, host, verified) VALUES ($1, $2, COALESCE($3::text, 'browser'), $4)
         ON CONFLICT (address) DO UPDATE SET subject = $2, host = COALESCE($3::text, wallets.host), verified = $4, last_seen = now()`,
        [key, subject, host ?? null, verified],
      );
      return { wallet: key, subject, verified, root: verified ? subject : null, status, expiresAt: info.expiresAt ?? null };
    },
    invalidate(wallet) {
      cache.delete(String(wallet).toLowerCase());
    },
  };
}
```

- [ ] **Step 10: App factory with health and config routes**

`server/src/app.js`:

```js
import express from "express";
import cors from "cors";
import { formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAME } from "../config.js";
import { errorHandler } from "./http.js";
import { createIdentityResolver } from "./identity.js";

/**
 * @param {{db: any, chain: any, config: any, now?: () => number}} deps
 */
export function createApp({ db, chain, config, now = Date.now }) {
  const app = express();
  app.use(cors({ origin: config.corsOrigins === "*" ? true : config.corsOrigins }));
  app.use(express.json({ limit: "64kb" }));

  const ctx = {
    db,
    chain,
    config,
    now,
    identity: createIdentityResolver({ chain, db, now }),
    voucherAccount: config.voucherSignerKey ? privateKeyToAccount(config.voucherSignerKey) : null,
    appAccount: config.appSignerKey ? privateKeyToAccount(config.appSignerKey) : null,
    requireAuth: null, // set by auth routes (Task 4)
  };

  app.get("/health", (_req, res) => res.json({ ok: true, app: "Moonshard", chainId: config.chainId }));

  const api = express.Router();
  api.get("/config", (_req, res) => {
    res.json({
      appName: "Moonshard",
      chainId: config.chainId,
      token: config.contracts.token,
      ubi: config.contracts.ubi,
      vault: config.contracts.vault || null,
      engagement: { address: config.contracts.engagement, app: ctx.appAccount?.address ?? null },
      prizesG: GAME.PRIZES.map((p) => formatUnits(p, 18)),
      shardRateG: formatUnits(GAME.SHARD_RATE, 18),
      dailyShardCap: GAME.DAILY_SHARD_CAP,
    });
  });
  // ROUTES: later tasks mount their routers here.
  app.use("/api", api);

  app.use(errorHandler);
  return { app, ctx, api };
}
```

- [ ] **Step 11: Boot file**

`server/index.js`:

```js
import { config } from "./config.js";
import { createDb } from "./src/db.js";
import { createChain } from "./src/chain.js";
import { createApp } from "./src/app.js";

if (!config.jwtSecret) {
  console.error("[moonshard] JWT_SECRET is required");
  process.exit(1);
}

const db = await createDb(config.databaseUrl);
const chain = createChain(config);
const { app } = createApp({ db, chain, config });

app.listen(config.port, "0.0.0.0", () => {
  console.log(`[moonshard] API on :${config.port} (chain ${config.chainId}, db ${config.databaseUrl ? "postgres" : "in-memory"})`);
});
```

- [ ] **Step 12: Test harness and config test**

`server/test/helpers.js`:

```js
import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

export const T0 = Date.parse("2026-10-05T12:00:00.000Z");
export const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
export const ENGAGEMENT = "0x25db74CF4E7BA120526fd87e159CF656d94bAE43";
export const VAULT = "0x" + "0".repeat(35) + "ba5e1"; // lowercase: mixed case would trigger checksum validation

export function fakeClock(start = T0) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; return t; };
  fn.set = (ms) => { t = ms; };
  return fn;
}

export function fakeChain() {
  const state = {
    roots: new Map(),
    txs: new Map(),
    claimedIds: new Set(),
    engagement: { ok: true, reason: null },
    block: 1_000n,
    calls: { identity: 0 },
  };
  const chain = {
    state,
    whitelist(address, root = address, expiresAt = null) {
      state.roots.set(address.toLowerCase(), { root: root.toLowerCase(), expiresAt });
    },
    async identity(address) {
      state.calls.identity++;
      const hit = state.roots.get(address.toLowerCase());
      if (!hit) return { isWhitelisted: false, root: null, expiresAt: null, expired: false };
      return { isWhitelisted: true, root: hit.root, expiresAt: hit.expiresAt, expired: false };
    },
    verifySignature: (address, message, signature) => verifyMessage({ address, message, signature }),
    async getTx(hash) { return state.txs.get(hash) ?? null; },
    async blockNumber() { return state.block; },
    async canClaimEngagement() { return { ...state.engagement }; },
    async voucherClaimed(id) { return state.claimedIds.has(String(id)); },
  };
  return chain;
}

export async function makeHarness(opts = {}) {
  const clock = opts.clock ?? fakeClock();
  const chain = opts.chain ?? fakeChain();
  const db = await createDb("");
  const config = {
    port: 0,
    jwtSecret: "test-secret",
    corsOrigins: "*",
    databaseUrl: "",
    rpcUrl: "http://unused",
    chainId: 42220,
    contracts: {
      identity: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
      ubi: UBI,
      token: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
      engagement: ENGAGEMENT,
      vault: VAULT,
    },
    voucherSignerKey: generatePrivateKey(),
    appSignerKey: generatePrivateKey(),
    ...opts.config,
  };
  const { app, ctx } = createApp({ db, chain, config, now: clock });
  const server = await new Promise((resolve) => {
    const s = createServer(app).listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }
  const api = {
    get: (p, o) => call("GET", p, o),
    post: (p, body, o = {}) => call("POST", p, { ...o, body }),
  };

  /** Log in a fresh wallet. Requires the auth routes from Task 4. */
  async function newPlayer({ verified = false, root, host = "browser" } = {}) {
    const { loginMessage } = await import("../src/auth.js");
    const account = privateKeyToAccount(generatePrivateKey());
    if (verified) chain.whitelist(account.address, root ?? account.address);
    const n = await api.get("/auth/nonce");
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const r = await api.post("/auth/verify", { address: account.address, message, signature, host });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    return { account, token: r.body.token, address: account.address.toLowerCase(), login: r.body };
  }

  return {
    api, ctx, chain, clock, db, config, newPlayer,
    base,
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
```

`server/test/config.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness } from "./helpers.js";

test("health and public config", async () => {
  const h = await makeHarness();
  try {
    const health = await fetch(`${h.base}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const cfg = await h.api.get("/config");
    assert.equal(cfg.status, 200);
    assert.deepEqual(cfg.body.prizesG, ["1000", "600", "300"]);
    assert.equal(cfg.body.shardRateG, "2");
    assert.equal(cfg.body.dailyShardCap, 50);
    assert.equal(cfg.body.chainId, 42220);
    assert.match(cfg.body.engagement.app, /^0x[0-9a-fA-F]{40}$/);
  } finally {
    await h.close();
  }
});

test("unknown JSON body returns 400, not a stack trace", async () => {
  const h = await makeHarness();
  try {
    const res = await fetch(`${h.base}/api/config`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_json" });
  } finally {
    await h.close();
  }
});
```

- [ ] **Step 13: Run all server tests**

```bash
npm test
```

Expected: db (2) + config (2) PASS.

- [ ] **Step 14: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add server && git commit -m "feat(server): foundation — config, Postgres/PGlite db, chain adapter, identity resolver, test harness"
```

---

### Task 4: Wallet auth (nonce → signature → JWT) and identity status

**Files:**
- Create: `server/src/auth.js`
- Modify: `server/src/app.js` (mount auth routes; set `ctx.requireAuth`)
- Test: `server/test/auth.test.js`

**Interfaces:**
- Consumes: `createApp`, `ctx.identity.resolve`, `HttpError`, `ah` (Task 3).
- Produces:
  - `loginMessage(nonce: string, issuedAt: string): string` → `"Moonshard login\nNonce: <nonce>\nIssued: <iso>"` (client builds the identical string).
  - `GET /api/auth/nonce` → `{nonce, issuedAt, expiresAt}`.
  - `POST /api/auth/verify {address, message, signature, host?}` → `{token, address, verified, status, expiresAt}`; errors `invalid_nonce | message_mismatch | stale_message | invalid_signature | bad_address`.
  - `GET /api/me` (auth) → `{address, subject, verified, status, expiresAt}`.
  - `POST /api/me/refresh` (auth) → same shape as `/api/me` but drops the 5-minute identity cache first (used right after face verification). Max once per 5 s per wallet, else 429 `slow_down`.
  - `ctx.requireAuth` middleware sets `req.player = {wallet, subject, verified, root, status, expiresAt}`; 401 `unauthorized | invalid_session`.

- [ ] **Step 1: Write the failing tests**

`server/test/auth.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { makeHarness } from "./helpers.js";
import { loginMessage } from "../src/auth.js";

async function signLogin(h, account, mutate = (m) => m) {
  const n = await h.api.get("/auth/nonce");
  const message = mutate(loginMessage(n.body.nonce, n.body.issuedAt), n.body);
  const signature = await account.signMessage({ message });
  return { n: n.body, message, signature };
}

test("login succeeds and returns a usable session", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal(p.login.verified, false);
    assert.equal(p.login.status, "unverified");
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.address, p.address);
    assert.equal(me.body.subject, p.address);
  } finally { await h.close(); }
});

test("whitelisted wallet is verified and subject is its root", async () => {
  const h = await makeHarness();
  try {
    const root = privateKeyToAccount(generatePrivateKey()).address;
    const p = await h.newPlayer({ verified: true, root });
    assert.equal(p.login.verified, true);
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.body.subject, root.toLowerCase());
    assert.equal(me.body.status, "verified");
  } finally { await h.close(); }
});

test("a nonce cannot be replayed", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLogin(h, account);
    const body = { address: account.address, message, signature };
    assert.equal((await h.api.post("/auth/verify", body)).status, 200);
    const again = await h.api.post("/auth/verify", body);
    assert.equal(again.status, 401);
    assert.equal(again.body.error, "invalid_nonce");
  } finally { await h.close(); }
});

test("unknown nonce, tampered message and bad signature are rejected", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());

    const fake = loginMessage("a".repeat(64), new Date(h.clock()).toISOString());
    const sigFake = await account.signMessage({ message: fake });
    const r1 = await h.api.post("/auth/verify", { address: account.address, message: fake, signature: sigFake });
    assert.equal(r1.body.error, "invalid_nonce");

    const bad = await signLogin(h, account, (m) => m + "\nExtra: 1");
    const r2 = await h.api.post("/auth/verify", { address: account.address, message: bad.message, signature: bad.signature });
    assert.equal(r2.body.error, "message_mismatch");

    const other = privateKeyToAccount(generatePrivateKey());
    const good = await signLogin(h, account);
    const wrongSig = await other.signMessage({ message: good.message });
    const r3 = await h.api.post("/auth/verify", { address: account.address, message: good.message, signature: wrongSig });
    assert.equal(r3.status, 401);
    assert.equal(r3.body.error, "invalid_signature");

    const r4 = await h.api.post("/auth/verify", { address: "not-an-address", message: good.message, signature: good.signature });
    assert.equal(r4.body.error, "bad_address");
  } finally { await h.close(); }
});

test("a stale issuedAt is rejected even with a valid nonce", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    const n = await h.api.get("/auth/nonce");
    const old = new Date(h.clock() - 10 * 60_000).toISOString();
    const message = loginMessage(n.body.nonce, old);
    const signature = await account.signMessage({ message });
    const r = await h.api.post("/auth/verify", { address: account.address, message, signature });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "stale_message");
  } finally { await h.close(); }
});

test("protected routes need a valid bearer token", async () => {
  const h = await makeHarness();
  try {
    assert.equal((await h.api.get("/me")).body.error, "unauthorized");
    assert.equal((await h.api.get("/me", { token: "garbage" })).body.error, "invalid_session");
  } finally { await h.close(); }
});

test("identity lookups are cached for 5 minutes then refreshed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const afterLogin = h.chain.state.calls.identity;
    await h.api.get("/me", { token: p.token });
    await h.api.get("/me", { token: p.token });
    assert.equal(h.chain.state.calls.identity, afterLogin);
    h.clock.advance(5 * 60_000 + 1);
    await h.api.get("/me", { token: p.token });
    assert.equal(h.chain.state.calls.identity, afterLogin + 1);
  } finally { await h.close(); }
});

test("/me/refresh sees a fresh verification immediately, but is rate limited", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    h.chain.whitelist(p.account.address); // verified on-chain after login (e.g. just finished face scan)
    const stale = await h.api.get("/me", { token: p.token });
    assert.equal(stale.body.verified, false); // still inside the 5-minute cache
    h.clock.advance(6_000);
    const fresh = await h.api.post("/me/refresh", {}, { token: p.token });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.verified, true);
    assert.equal(fresh.body.status, "verified");
    const again = await h.api.post("/me/refresh", {}, { token: p.token });
    assert.equal(again.status, 429);
    assert.equal(again.body.error, "slow_down");
  } finally { await h.close(); }
});

test("an identity that expires mid-session stops being verified", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    h.chain.whitelist(account.address, account.address, h.clock() + 60 * 60_000);
    const p = await h.newPlayer({ verified: false });
    // log the whitelisted account in directly
    const n = await h.api.get("/auth/nonce");
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const login = await h.api.post("/auth/verify", { address: account.address, message, signature });
    assert.equal(login.body.verified, true);
    h.clock.advance(2 * 60 * 60_000);
    const me = await h.api.get("/me", { token: login.body.token });
    assert.equal(me.body.verified, false);
    assert.equal(me.body.status, "expired");
    assert.ok(p.token);
  } finally { await h.close(); }
});

test("RPC outage at login is a 503, and stale cache keeps an existing session alive", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    h.chain.identity = async () => { throw new Error("rpc down"); };
    h.clock.advance(10 * 60_000);
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.verified, true);

    const fresh = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLogin(h, fresh);
    const r = await h.api.post("/auth/verify", { address: fresh.address, message, signature });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "chain_unavailable");
  } finally { await h.close(); }
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard/server && npm test
```

Expected: auth tests FAIL (`../src/auth.js` missing).

- [ ] **Step 3: Implement auth**

`server/src/auth.js`:

```js
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { isAddress } from "viem";
import { JWT_TTL_SEC, NONCE_TTL_MS } from "../config.js";
import { HttpError, ah } from "./http.js";

export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

const MESSAGE_RE = /^Moonshard login\nNonce: ([0-9a-f]{64})\nIssued: (\S+)$/;
const HOSTS = new Set(["minipay", "goodwallet", "browser"]);

export function makeRequireAuth(ctx) {
  return ah(async (req, _res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new HttpError(401, "unauthorized");
    let claims;
    try {
      claims = jwt.verify(token, ctx.config.jwtSecret);
    } catch {
      throw new HttpError(401, "invalid_session");
    }
    req.player = await ctx.identity.resolve(claims.sub, claims.host);
    next();
  });
}

export function authRoutes(ctx) {
  const r = express.Router();

  r.get("/auth/nonce", ah(async (_req, res) => {
    const nonce = crypto.randomBytes(32).toString("hex");
    const now = ctx.now();
    await ctx.db.query("DELETE FROM nonces WHERE expires_at < $1", [new Date(now)]);
    await ctx.db.query("INSERT INTO nonces(nonce, expires_at) VALUES ($1, $2)", [nonce, new Date(now + NONCE_TTL_MS)]);
    res.json({ nonce, issuedAt: new Date(now).toISOString(), expiresAt: now + NONCE_TTL_MS });
  }));

  r.post("/auth/verify", ah(async (req, res) => {
    const { address, message, signature } = req.body || {};
    const host = HOSTS.has(req.body?.host) ? req.body.host : "browser";
    if (typeof address !== "string" || !isAddress(address)) throw new HttpError(400, "bad_address");

    const m = MESSAGE_RE.exec(String(message || ""));
    if (!m) throw new HttpError(401, "message_mismatch");
    const [, nonce, issuedAt] = m;

    const used = await ctx.db.query(
      "DELETE FROM nonces WHERE nonce = $1 AND expires_at > $2 RETURNING nonce",
      [nonce, new Date(ctx.now())],
    );
    if (used.rows.length === 0) throw new HttpError(401, "invalid_nonce");

    const issued = Date.parse(issuedAt);
    const age = ctx.now() - issued;
    if (!Number.isFinite(issued) || age > NONCE_TTL_MS || age < -60_000) throw new HttpError(401, "stale_message");

    let ok = false;
    try {
      ok = await ctx.chain.verifySignature(address, message, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(401, "invalid_signature");

    const player = await ctx.identity.resolve(address, host);
    const token = jwt.sign({ sub: player.wallet, host }, ctx.config.jwtSecret, { expiresIn: JWT_TTL_SEC });
    res.json({
      token,
      address: player.wallet,
      verified: player.verified,
      status: player.status,
      expiresAt: player.expiresAt,
    });
  }));

  const meShape = (p) => ({ address: p.wallet, subject: p.subject, verified: p.verified, status: p.status, expiresAt: p.expiresAt });

  r.get("/me", ctx.requireAuth, (req, res) => res.json(meShape(req.player)));

  // Drops the identity cache so a player who just finished face verification is recognised at once.
  const lastRefresh = new Map();
  r.post("/me/refresh", ctx.requireAuth, ah(async (req, res) => {
    const wallet = req.player.wallet;
    if (ctx.now() - (lastRefresh.get(wallet) ?? -Infinity) < 5_000) throw new HttpError(429, "slow_down");
    lastRefresh.set(wallet, ctx.now());
    ctx.identity.invalidate(wallet);
    res.json(meShape(await ctx.identity.resolve(wallet)));
  }));

  return r;
}
```

- [ ] **Step 4: Mount auth in the app**

In `server/src/app.js` add the import `import { authRoutes, makeRequireAuth } from "./auth.js";` and replace the `// ROUTES:` comment line with:

```js
  ctx.requireAuth = makeRequireAuth(ctx);
  api.use(authRoutes(ctx));
  // ROUTES: later tasks mount their routers here.
```

(`ctx.requireAuth` must be assigned before `authRoutes(ctx)` is called, because routes capture it at construction.)

- [ ] **Step 5: Run to verify pass**

```bash
npm test
```

Expected: all auth tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add server && git commit -m "feat(server): wallet auth with single-use nonces, identity-aware sessions"
```

---

### Task 5: Run tickets, checkpoints, submit validation, leaderboard

**Files:**
- Create: `server/src/runs.js`, `server/src/leaderboard.js`
- Modify: `server/src/app.js` (mount routes), `server/test/helpers.js` (add `playTrial`)
- Test: `server/test/runs.test.js`

**Interfaces:**
- Consumes: `ctx.requireAuth`, `req.player` (`{wallet, subject, verified}`), `GAME` (Task 3), `dayKey` (Task 3).
- Produces:
  - `POST /api/runs/start {mode:"TRIAL"|"STORY", chapter?}` → `{runId, seed, mode, chapter, startedAt, ticket}`. TRIAL seed = UTC day key. Starting a run voids that subject's other open run of the same mode.
  - `POST /api/runs/:id/checkpoints {points:[{t,score,kills,shards}]}` (≤50 per call) → `{ok, accepted}` or 422 `{error:"bad_checkpoint", reason:[...], accepted}`; a violation flags the run (`runs.flags`).
  - `POST /api/runs/:id/submit {ticket, score, kills, shards, durationMs, bossCleared?}` → `{ok, isNewBest, rankedOk, bossCleared, flags:[...], rank:{open, ranked}}`. Errors: `bad_ticket 401`, `ticket_expired 410`, `already_submitted 409`, `run_void 409`, `run_not_found 404`, and 400s `invalid_numbers | invalid_score | invalid_duration | duration_exceeds_elapsed | invalid_score_rate | invalid_kill_rate | shard_count_anomaly | boss_requires_story | boss_telemetry_insufficient`.
  - `GET /api/leaderboard/daily?view=ranked|open` → `{day, view, entries:[{rank, wallet, verified, rankedOk, score, kills, durationMs}], prizesG:[...]}`; `GET /api/leaderboard/alltime?view=...` → `{view, entries:[... + day]}`. Default view = `ranked`.
  - Test helper `playTrial(h, player, {score?, kills?, shards?, durationMs?})` → submit response (advances the fake clock).
  - `runs.shards` are added to `shard_days` **only when the run's player was verified**; shards are credited to the run's start day.

- [ ] **Step 1: Add the `playTrial` helper**

Append to `server/test/helpers.js`:

```js
/**
 * Plays one honest-looking Daily Shard Trial: start, post checkpoints covering ~70% of the run,
 * then submit. Advances the fake clock. Returns the submit response ({status, body}).
 */
export async function playTrial(h, p, { score = 1000, kills = 20, shards = 0, durationMs = 60_000 } = {}) {
  const run = (await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token })).body;
  const first = Math.round(durationMs * 0.7);
  h.clock.advance(first);
  const points = [];
  for (let t = 10_000; t <= first; t += 10_000) {
    const f = t / durationMs;
    points.push({ t, score: Math.floor(score * f), kills: Math.floor(kills * f), shards: Math.floor(shards * f) });
  }
  if (points.length) await h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
  h.clock.advance(durationMs - first + 500);
  return h.api.post(
    `/runs/${run.runId}/submit`,
    { ticket: run.ticket, score, kills, shards, durationMs },
    { token: p.token },
  );
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/runs.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, T0 } from "./helpers.js";

const start = async (h, p, mode = "TRIAL", chapter) => {
  const r = await h.api.post("/runs/start", { mode, chapter }, { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const submit = (h, p, run, over = {}) =>
  h.api.post(
    `/runs/${run.runId}/submit`,
    { ticket: run.ticket, score: 1000, kills: 20, shards: 5, durationMs: 60_000, ...over },
    { token: p.token },
  );

test("start returns a ticket, seed = UTC day, and voids the previous open run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const a = await start(h, p);
    assert.equal(a.seed, "2026-10-05");
    assert.match(a.ticket, /^[0-9a-f]{64}$/);
    const b = await start(h, p);
    h.clock.advance(60_000);
    const stale = await submit(h, p, a);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "run_void");
    assert.equal((await submit(h, p, b)).status, 200);
  } finally { await h.close(); }
});

test("bad mode / chapter are rejected; STORY needs a chapter 1-5", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await h.api.post("/runs/start", { mode: "NOPE" }, { token: p.token })).body.error, "bad_mode");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY" }, { token: p.token })).body.error, "bad_chapter");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY", chapter: 6 }, { token: p.token })).body.error, "bad_chapter");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY", chapter: 3 }, { token: p.token })).status, 200);
  } finally { await h.close(); }
});

test("valid submit succeeds once; second submit is 409", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    const ok = await submit(h, p, run);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.isNewBest, true);
    assert.equal(ok.body.rankedOk, false); // unverified
    assert.equal(ok.body.rank.open, 1);
    const again = await submit(h, p, run);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_submitted");
  } finally { await h.close(); }
});

test("ticket tampering and other players' runs are refused", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const q = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, { ...run, ticket: "0".repeat(64) })).body.error, "bad_ticket");
    assert.equal((await submit(h, p, { ...run, ticket: "zz" })).body.error, "bad_ticket");
    assert.equal((await submit(h, q, run)).status, 404);
  } finally { await h.close(); }
});

test("server clock wins: duration cannot exceed elapsed time; tickets expire", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    const early = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(early.body.error, "duration_exceeds_elapsed");
    h.clock.advance(41 * 60_000);
    const late = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(late.status, 410);
    assert.equal(late.body.error, "ticket_expired");
  } finally { await h.close(); }
});

test("impossible rates and malformed numbers are rejected", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, run, { score: 10_000_000 })).body.error, "invalid_score_rate");
    assert.equal((await submit(h, p, run, { kills: 2_000 })).body.error, "invalid_kill_rate");
    assert.equal((await submit(h, p, run, { kills: 20, shards: 61 })).body.error, "shard_count_anomaly");
    assert.equal((await submit(h, p, run, { kills: 0, shards: 21 })).body.error, "shard_count_anomaly");
    assert.equal((await submit(h, p, run, { score: -1 })).body.error, "invalid_numbers");
    assert.equal((await submit(h, p, run, { score: "abc" })).body.error, "invalid_numbers");
    assert.equal((await submit(h, p, run, { durationMs: 1_000 })).body.error, "invalid_duration");
    assert.equal((await submit(h, p, run, { score: 200_000_000 })).body.error, "invalid_score");
  } finally { await h.close(); }
});

test("honest verified run with checkpoints is ranked-eligible; no checkpoints is open-board only", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const ranked = await playTrial(h, a, { score: 3000 });
    assert.equal(ranked.status, 200);
    assert.equal(ranked.body.rankedOk, true);
    assert.equal(ranked.body.rank.ranked, 1);

    const run = await start(h, b);
    h.clock.advance(61_000);
    const bare = await submit(h, b, run, { score: 9000 });
    assert.equal(bare.body.rankedOk, false);
    const open = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(open.body.entries[0].score, 9000);
    const rk = await h.api.get("/leaderboard/daily?view=ranked");
    assert.deepEqual(rk.body.entries.map((e) => e.score), [3000]);
  } finally { await h.close(); }
});

test("a bad checkpoint flags the run: score still counts on the open board, never ranked", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(40_000);
    const good = await h.api.post(`/runs/${run.runId}/checkpoints`, { points: [{ t: 10_000, score: 100, kills: 2, shards: 0 }] }, { token: p.token });
    assert.equal(good.status, 200);
    const bad = await h.api.post(`/runs/${run.runId}/checkpoints`, { points: [{ t: 20_000, score: 50, kills: 2, shards: 0 }] }, { token: p.token });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error, "bad_checkpoint");
    assert.ok(bad.body.reason.includes("cp_regress"));
    h.clock.advance(21_000);
    const res = await submit(h, p, run, { score: 500, kills: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.rankedOk, false);
    assert.ok(res.body.flags.includes("cp_regress"));
  } finally { await h.close(); }
});

test("checkpoint rules: time must increase, cannot be in the future, score rate capped", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(20_000);
    const post = (points) => h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
    assert.ok((await post([{ t: 10_000, score: 100, kills: 1, shards: 0 }])).body.ok);
    assert.ok((await post([{ t: 10_000, score: 120, kills: 1, shards: 0 }])).body.reason.includes("cp_time"));
    assert.ok((await post([{ t: 600_000, score: 200, kills: 1, shards: 0 }])).body.reason.includes("cp_future"));
    assert.ok((await post([{ t: 15_000, score: 900_000, kills: 1, shards: 0 }])).body.reason.includes("cp_score_rate"));
    assert.equal((await post([])).body.error, "bad_points");
  } finally { await h.close(); }
});

test("two wallets of one human share one daily slot", async () => {
  const h = await makeHarness();
  try {
    const first = await h.newPlayer({ verified: true });
    const second = await h.newPlayer({ verified: true, root: first.address });
    await playTrial(h, first, { score: 2000 });
    const r2 = await playTrial(h, second, { score: 2500 });
    assert.equal(r2.body.isNewBest, true);
    const rows = await h.db.query("SELECT count(*)::int AS n FROM scores");
    assert.equal(rows.rows[0].n, 1);
    const board = await h.api.get("/leaderboard/daily?view=ranked");
    assert.equal(board.body.entries.length, 1);
    assert.equal(board.body.entries[0].score, 2500);
  } finally { await h.close(); }
});

test("best-of-day: a lower later score does not replace; ranked beats unranked", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 4000 });
    const lower = await playTrial(h, p, { score: 1000 });
    assert.equal(lower.body.isNewBest, false);
    const run = await start(h, p);
    h.clock.advance(61_000);
    const unrankedHigh = await submit(h, p, run, { score: 9000 }); // no checkpoints => unranked
    assert.equal(unrankedHigh.body.isNewBest, false);
    const board = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(board.body.entries[0].score, 4000);
  } finally { await h.close(); }
});

test("UTC midnight: a run started 23:55 and submitted 00:03 counts for the start day", async () => {
  const h = await makeHarness();
  try {
    h.clock.set(Date.parse("2026-10-05T23:55:00.000Z"));
    const p = await h.newPlayer();
    const run = await start(h, p);
    assert.equal(run.seed, "2026-10-05");
    h.clock.set(Date.parse("2026-10-06T00:03:00.000Z"));
    const res = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(res.status, 200);
    const d5 = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(d5.body.day, "2026-10-06");
    assert.equal(d5.body.entries.length, 0);
    const row = await h.db.query("SELECT day FROM scores");
    assert.equal(row.rows[0].day, "2026-10-05");
  } finally { await h.close(); }
});

test("STORY boss clear needs telemetry and checkpoint coverage; TRIAL cannot claim a boss", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });

    const trial = await start(h, p, "TRIAL");
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, trial, { bossCleared: true })).body.error, "boss_requires_story");

    const short = await start(h, p, "STORY", 1);
    h.clock.advance(10_000);
    assert.equal((await submit(h, p, short, { durationMs: 8_000, kills: 5, bossCleared: true })).body.error, "boss_telemetry_insufficient");

    const lowCov = await start(h, p, "STORY", 1);
    h.clock.advance(60_000);
    const lc = await submit(h, p, lowCov, { score: 0, kills: 10, durationMs: 60_000, bossCleared: true });
    assert.equal(lc.status, 200);
    assert.equal(lc.body.bossCleared, false);
    assert.ok(lc.body.flags.includes("boss_low_coverage"));

    const good = await start(h, p, "STORY", 1);
    h.clock.advance(50_000);
    const pts = [10_000, 20_000, 30_000, 40_000, 50_000].map((t) => ({ t, score: 0, kills: t / 10_000 * 2, shards: 0 }));
    assert.equal((await h.api.post(`/runs/${good.runId}/checkpoints`, { points: pts }, { token: p.token })).status, 200);
    h.clock.advance(10_500);
    const ok = await submit(h, p, good, { score: 0, kills: 12, durationMs: 60_000, bossCleared: true });
    assert.equal(ok.body.bossCleared, true);
  } finally { await h.close(); }
});

test("shards only accrue for verified players", async () => {
  const h = await makeHarness();
  try {
    const v = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, v, { kills: 20, shards: 10 });
    await playTrial(h, u, { kills: 20, shards: 10 });
    const rows = await h.db.query("SELECT subject, shards FROM shard_days");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].subject, v.address);
    assert.equal(rows.rows[0].shards, 10);
  } finally { await h.close(); }
});

test("all-time board keeps each human's best day", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 2000 });
    h.clock.set(T0 + 24 * 3600_000);
    await playTrial(h, p, { score: 3500 });
    h.clock.set(T0 + 48 * 3600_000);
    await playTrial(h, p, { score: 500 });
    const all = await h.api.get("/leaderboard/alltime?view=ranked");
    assert.equal(all.body.entries.length, 1);
    assert.equal(all.body.entries[0].score, 3500);
    assert.equal(all.body.entries[0].day, "2026-10-06");
  } finally { await h.close(); }
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard/server && npm test
```

Expected: runs tests FAIL (routes return 404).

- [ ] **Step 4: Implement the leaderboard module**

`server/src/leaderboard.js`:

```js
import express from "express";
import { formatUnits } from "viem";
import { GAME } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";

const ORDER = "score DESC, duration_ms ASC, kills DESC, run_id ASC";
const toEntry = (r, i) => ({
  rank: i + 1,
  wallet: r.wallet,
  verified: r.verified,
  rankedOk: r.ranked_ok,
  score: r.score,
  kills: r.kills,
  durationMs: r.duration_ms,
  ...(r.day ? { day: r.day } : {}),
});

export async function dailyBoard(ctx, day, view = "ranked", limit = 50) {
  const filter = view === "ranked" ? "AND ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id
       FROM scores WHERE day = $1 ${filter} ORDER BY ${ORDER} LIMIT $2`,
    [day, limit],
  );
  return rows.map(toEntry);
}

export async function allTimeBoard(ctx, view = "ranked", limit = 50) {
  const filter = view === "ranked" ? "WHERE ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT DISTINCT ON (subject) subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id, day
       FROM scores ${filter} ORDER BY subject, ${ORDER}`,
  );
  rows.sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms || b.kills - a.kills || (a.run_id < b.run_id ? -1 : 1));
  return rows.slice(0, limit).map(toEntry);
}

export async function rankOf(ctx, day, subject, view) {
  const board = await dailyBoard(ctx, day, view, 1000);
  const { rows } = await ctx.db.query("SELECT wallet FROM scores WHERE day = $1 AND subject = $2", [day, subject]);
  if (!rows[0]) return null;
  const idx = board.findIndex((e) => e.wallet === rows[0].wallet);
  return idx === -1 ? null : idx + 1;
}

export function leaderboardRoutes(ctx) {
  const r = express.Router();
  const viewOf = (req) => (req.query.view === "open" ? "open" : "ranked");

  r.get("/leaderboard/daily", ah(async (req, res) => {
    const day = dayKey(ctx.now());
    const view = viewOf(req);
    res.json({
      day,
      view,
      entries: await dailyBoard(ctx, day, view),
      prizesG: GAME.PRIZES.map((p) => formatUnits(p, 18)),
    });
  }));

  r.get("/leaderboard/alltime", ah(async (req, res) => {
    const view = viewOf(req);
    res.json({ view, entries: await allTimeBoard(ctx, view) });
  }));

  return r;
}
```

- [ ] **Step 5: Implement runs**

`server/src/runs.js`:

```js
import crypto from "node:crypto";
import express from "express";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { rankOf } from "./leaderboard.js";

const ticketKey = (ctx) => crypto.createHash("sha256").update(`moonshard-ticket|${ctx.config.jwtSecret}`).digest();

function ticketFor(ctx, run) {
  const started = new Date(run.started_at).getTime();
  return crypto
    .createHmac("sha256", ticketKey(ctx))
    .update(`${run.run_id}|${run.subject}|${run.mode}|${run.seed}|${started}`)
    .digest("hex");
}

function sameTicket(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function loadOwnedRun(ctx, req) {
  const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [req.params.id]);
  const run = rows[0];
  if (!run || run.subject !== req.player.subject) throw new HttpError(404, "run_not_found");
  return run;
}

function assertOpen(ctx, run) {
  if (run.status === "submitted") throw new HttpError(409, "already_submitted");
  if (run.status === "void") throw new HttpError(409, "run_void");
  if (ctx.now() - new Date(run.started_at).getTime() > GAME.TICKET_MAX_AGE_MS) throw new HttpError(410, "ticket_expired");
}

const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" && typeof v !== "boolean" ? Math.trunc(Number(v)) : NaN);
const addFlag = (ctx, runId, flags) =>
  ctx.db.query(
    "UPDATE runs SET flags = CASE WHEN flags = '' THEN $2 ELSE flags || ',' || $2 END WHERE run_id = $1",
    [runId, flags.join(",")],
  );

export function runRoutes(ctx) {
  const r = express.Router();

  r.post("/runs/start", ctx.requireAuth, ah(async (req, res) => {
    const { mode, chapter } = req.body || {};
    if (mode !== "TRIAL" && mode !== "STORY") throw new HttpError(400, "bad_mode");
    let ch = null;
    if (mode === "STORY") {
      ch = Number(chapter);
      if (!Number.isInteger(ch) || ch < 1 || ch > 5) throw new HttpError(400, "bad_chapter");
    }
    const now = ctx.now();
    const day = dayKey(now);
    const seed = mode === "TRIAL" ? day : `story-${ch}`;
    const runId = crypto.randomUUID();
    const p = req.player;
    await ctx.db.tx(async (t) => {
      await t.query("UPDATE runs SET status = 'void' WHERE subject = $1 AND mode = $2 AND status = 'open'", [p.subject, mode]);
      await t.query(
        `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [runId, p.subject, p.wallet, p.verified, mode, ch, seed, day, new Date(now)],
      );
    });
    const ticket = ticketFor(ctx, { run_id: runId, subject: p.subject, mode, seed, started_at: new Date(now) });
    res.json({ runId, seed, mode, chapter: ch, startedAt: new Date(now).toISOString(), ticket });
  }));

  r.post("/runs/:id/checkpoints", ctx.requireAuth, ah(async (req, res) => {
    const run = await loadOwnedRun(ctx, req);
    assertOpen(ctx, run);
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0 || points.length > 50) throw new HttpError(400, "bad_points");

    const elapsed = ctx.now() - new Date(run.started_at).getTime();
    const lastRow = (
      await ctx.db.query(
        "SELECT seq, t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq DESC LIMIT 1",
        [run.run_id],
      )
    ).rows[0];
    let seq = lastRow ? lastRow.seq : 0;
    let prev = lastRow || { t_ms: 0, score: 0, kills: 0, shards: 0 };
    const accepted = [];
    const reason = new Set();

    for (const pt of points) {
      const t = int(pt?.t), score = int(pt?.score), kills = int(pt?.kills), shards = int(pt?.shards ?? 0);
      if ([t, score, kills, shards].some((x) => !Number.isInteger(x) || x < 0)) { reason.add("cp_malformed"); break; }
      if (t <= prev.t_ms) { reason.add("cp_time"); break; }
      if (t > elapsed + GAME.CLOCK_TOLERANCE_MS) { reason.add("cp_future"); break; }
      if (score < prev.score || kills < prev.kills || shards < prev.shards) { reason.add("cp_regress"); break; }
      const dt = (t - prev.t_ms) / 1000;
      if (score - prev.score > GAME.MAX_PTS_PER_SEC * dt + GAME.CHECKPOINT_SLACK_PTS) { reason.add("cp_score_rate"); break; }
      if (kills - prev.kills > GAME.MAX_KILLS_PER_SEC * dt + 5) { reason.add("cp_kill_rate"); break; }
      if (seq + 1 > GAME.MAX_CHECKPOINTS) { reason.add("cp_limit"); break; }
      seq += 1;
      accepted.push([run.run_id, seq, t, score, kills, shards]);
      prev = { t_ms: t, score, kills, shards };
    }

    for (const row of accepted) {
      await ctx.db.query(
        "INSERT INTO run_checkpoints(run_id, seq, t_ms, score, kills, shards) VALUES ($1,$2,$3,$4,$5,$6)",
        row,
      );
    }
    if (reason.size) {
      await addFlag(ctx, run.run_id, [...reason]);
      return res.status(422).json({ error: "bad_checkpoint", reason: [...reason], accepted: accepted.length });
    }
    res.json({ ok: true, accepted: accepted.length });
  }));

  r.post("/runs/:id/submit", ctx.requireAuth, ah(async (req, res) => {
    const run = await loadOwnedRun(ctx, req);
    if (run.status === "submitted") throw new HttpError(409, "already_submitted");
    if (run.status === "void") throw new HttpError(409, "run_void");
    const b = req.body || {};
    if (!sameTicket(b.ticket, ticketFor(ctx, run))) throw new HttpError(401, "bad_ticket");

    const startedMs = new Date(run.started_at).getTime();
    const elapsed = ctx.now() - startedMs;
    if (elapsed > GAME.TICKET_MAX_AGE_MS) throw new HttpError(410, "ticket_expired");

    const score = int(b.score), kills = int(b.kills), shards = int(b.shards ?? 0), durationMs = int(b.durationMs);
    if ([score, kills, shards, durationMs].some((x) => !Number.isInteger(x) || x < 0)) throw new HttpError(400, "invalid_numbers");
    if (score > GAME.MAX_SCORE) throw new HttpError(400, "invalid_score");
    if (durationMs < GAME.MIN_DURATION_MS) throw new HttpError(400, "invalid_duration");
    if (durationMs > elapsed + GAME.CLOCK_TOLERANCE_MS) throw new HttpError(400, "duration_exceeds_elapsed");
    const seconds = durationMs / 1000;
    if (score / seconds > GAME.MAX_PTS_PER_SEC) throw new HttpError(400, "invalid_score_rate");
    if (kills / seconds > GAME.MAX_KILLS_PER_SEC) throw new HttpError(400, "invalid_kill_rate");
    const shardCeil = Math.min(GAME.SHARDS_PER_KILL * kills + GAME.SHARDS_BASE_ALLOWANCE, GAME.MAX_SHARDS_PER_RUN);
    if (shards > shardCeil) throw new HttpError(400, "shard_count_anomaly");

    const wantsBoss = b.bossCleared === true;
    if (wantsBoss && run.mode !== "STORY") throw new HttpError(400, "boss_requires_story");
    if (wantsBoss && (durationMs < GAME.BOSS_MIN.durationMs || kills < GAME.BOSS_MIN.kills)) {
      throw new HttpError(400, "boss_telemetry_insufficient");
    }

    const last = (
      await ctx.db.query(
        "SELECT t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq DESC LIMIT 1",
        [run.run_id],
      )
    ).rows[0];
    const coverage = last ? last.t_ms / durationMs : 0;
    const flags = run.flags ? run.flags.split(",") : [];
    if (last && (score < last.score || kills < last.kills || shards < last.shards)) flags.push("totals_below_checkpoint");
    if (wantsBoss && coverage < GAME.MIN_COVERAGE_BOSS) flags.push("boss_low_coverage");

    const bossCleared = wantsBoss && flags.length === 0;
    const rankedOk = Boolean(run.verified) && flags.length === 0 && (run.mode === "STORY" || coverage >= GAME.MIN_COVERAGE_RANKED);

    let isNewBest = false;
    await ctx.db.tx(async (t) => {
      await t.query(
        `UPDATE runs SET status='submitted', submitted_at=$2, score=$3, kills=$4, shards=$5, duration_ms=$6,
                boss_cleared=$7, ranked_ok=$8, flags=$9 WHERE run_id=$1`,
        [run.run_id, new Date(ctx.now()), score, kills, shards, durationMs, bossCleared, rankedOk, flags.join(",")],
      );
      if (run.mode === "TRIAL") {
        const up = await t.query(
          `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (day, subject) DO UPDATE SET wallet=EXCLUDED.wallet, verified=EXCLUDED.verified,
             ranked_ok=EXCLUDED.ranked_ok, score=EXCLUDED.score, kills=EXCLUDED.kills,
             duration_ms=EXCLUDED.duration_ms, run_id=EXCLUDED.run_id
           WHERE (EXCLUDED.ranked_ok AND NOT scores.ranked_ok)
              OR (EXCLUDED.ranked_ok = scores.ranked_ok AND EXCLUDED.score > scores.score)
           RETURNING run_id`,
          [run.day, run.subject, run.wallet, run.verified, rankedOk, score, kills, durationMs, run.run_id],
        );
        isNewBest = up.rows.length > 0;
      }
      if (shards > 0 && run.verified) {
        await t.query(
          `INSERT INTO shard_days(day, subject, shards) VALUES ($1,$2,$3)
           ON CONFLICT (day, subject) DO UPDATE SET shards = shard_days.shards + EXCLUDED.shards`,
          [run.day, run.subject, shards],
        );
      }
    });

    const rank = run.mode === "TRIAL"
      ? { open: await rankOf(ctx, run.day, run.subject, "open"), ranked: await rankOf(ctx, run.day, run.subject, "ranked") }
      : null;
    res.json({ ok: true, isNewBest, rankedOk, bossCleared, flags, rank });
  }));

  return r;
}
```

- [ ] **Step 6: Mount routes**

In `server/src/app.js` add imports `import { runRoutes } from "./runs.js";` and `import { leaderboardRoutes } from "./leaderboard.js";`, and after `api.use(authRoutes(ctx));` add:

```js
  api.use(runRoutes(ctx));
  api.use(leaderboardRoutes(ctx));
```

- [ ] **Step 7: Run to verify pass**

```bash
npm test
```

Expected: all runs tests PASS. If the midnight test fails on `d5.body.day`, confirm the leaderboard route uses `dayKey(ctx.now())` (the *current* day, 2026-10-06 at that moment).

- [ ] **Step 8: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add server && git commit -m "feat(server): ticketed runs with checkpoint validation, best-of-day scores, ranked/open boards"
```

---

### Task 6: Spoils — settlement, vouchers, redemption tracking

**Files:**
- Create: `server/src/spoils.js`, `server/src/cron.js`
- Modify: `server/src/app.js` (mount), `server/index.js` (start cron)
- Test: `server/test/spoils.test.js`

**Interfaces:**
- Consumes: `playTrial`, `ctx.voucherAccount`, `ctx.chain.voucherClaimed`, `GAME.PRIZES|SHARD_RATE|DAILY_SHARD_CAP|VOUCHER_TTL_SEC` (Tasks 3, 5); vault ABI `vaultAbi` from `chain.js`.
- Produces:
  - `spoilId(kind, day, subject): bigint` = `uint256(keccak256(abi.encodePacked(string kind, string day, address subject)))`.
  - `settleDay(ctx, day) → {day, settled: boolean, prizes?, harvests?}` — idempotent.
  - `settleDue(ctx) → Array<settleDay result>` — settles every day older than `dayKey(now − TICKET_MAX_AGE − 60s)`.
  - `startSettlementCron(ctx, intervalMs?) → stop()`.
  - `GET /api/spoils` (auth) → `{vault:{address, chainId}|null, spoils:[{id, kind, day, rank, amount, amountG, claimed: boolean|null, voucher: {to, id, amount, deadline, signature}|null}]}` (amounts as decimal strings; `id` decimal string).
  - `POST /api/spoils/confirm {txHash}` (auth) → `{ok, recorded:[ids]}`.
  - Typed-data contract with the vault (Task 2): domain `{name:"MoonshardVault", version:"1", chainId: config.chainId, verifyingContract: config.contracts.vault}`, `Spoil(address to,uint256 id,uint256 amount,uint64 deadline)`.

- [ ] **Step 1: Write the failing tests**

`server/test/spoils.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, formatUnits, verifyTypedData } from "viem";
import { makeHarness, playTrial, VAULT } from "./helpers.js";
import { settleDay, settleDue, spoilId, spoilTypes } from "../src/spoils.js";
import { vaultAbi } from "../src/chain.js";

const G = (n) => BigInt(n) * 10n ** 18n;
const NEXT_DAY_SETTLEABLE = Date.parse("2026-10-06T00:42:00.000Z");

async function spoilRows(h) {
  return (await h.db.query("SELECT kind, subject, amount, rank FROM spoils ORDER BY kind, rank NULLS LAST, subject")).rows;
}

test("top-3 verified, ranked players win 1000/600/300 G$; unverified never do", async () => {
  const h = await makeHarness();
  try {
    const v = [];
    for (let i = 0; i < 4; i++) v.push(await h.newPlayer({ verified: true }));
    const cheater = await h.newPlayer();
    await playTrial(h, v[0], { score: 500 });
    await playTrial(h, v[1], { score: 400 });
    await playTrial(h, v[2], { score: 300 });
    await playTrial(h, v[3], { score: 200 });
    await playTrial(h, cheater, { score: 9000 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    const out = await settleDue(h.ctx);
    assert.equal(out.length, 1);
    assert.equal(out[0].prizes, 3);
    const prizes = (await spoilRows(h)).filter((r) => r.kind === "TRIAL_PRIZE");
    assert.deepEqual(prizes.map((r) => r.subject), [v[0].address, v[1].address, v[2].address]);
    assert.deepEqual(prizes.map((r) => r.amount), [G(1000), G(600), G(300)].map(String));
    assert.ok(!prizes.some((r) => r.subject === cheater.address));
  } finally { await h.close(); }
});

test("settlement is idempotent", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    assert.equal((await settleDue(h.ctx)).length, 1);
    assert.equal((await settleDue(h.ctx)).length, 0);
    const again = await settleDay(h.ctx, "2026-10-05");
    assert.equal(again.settled, false);
    assert.equal((await spoilRows(h)).length, 1);
  } finally { await h.close(); }
});

test("a day is not settled until the ticket window has passed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(Date.parse("2026-10-06T00:10:00.000Z"));
    assert.equal((await settleDue(h.ctx)).length, 0);
    h.clock.set(Date.parse("2026-10-06T00:42:00.000Z"));
    assert.equal((await settleDue(h.ctx)).length, 1);
  } finally { await h.close(); }
});

test("shard harvest pays 2 G$ per shard, capped at 50 shards/day, verified only", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, p, { kills: 40, shards: 30, score: 100 });
    await playTrial(h, p, { kills: 40, shards: 30, score: 100 });
    await playTrial(h, u, { kills: 40, shards: 30, score: 100 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const harvest = (await spoilRows(h)).filter((r) => r.kind === "SHARD_HARVEST");
    assert.equal(harvest.length, 1);
    assert.equal(harvest[0].subject, p.address);
    assert.equal(harvest[0].amount, String(G(100))); // min(60, 50) * 2 G$
  } finally { await h.close(); }
});

test("two wallets of one human get one prize and share one shard cap", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true, root: a.address });
    await playTrial(h, a, { score: 800, kills: 40, shards: 30 });
    await playTrial(h, b, { score: 900, kills: 40, shards: 30 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const rows = await spoilRows(h);
    assert.equal(rows.filter((r) => r.kind === "TRIAL_PRIZE").length, 1);
    const harvest = rows.find((r) => r.kind === "SHARD_HARVEST");
    assert.equal(harvest.amount, String(G(100)));
  } finally { await h.close(); }
});

test("GET /spoils returns a voucher the vault would accept, to the session wallet", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const res = await h.api.get("/spoils", { token: p.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.vault.address, VAULT);
    const s = res.body.spoils[0];
    assert.equal(s.kind, "TRIAL_PRIZE");
    assert.equal(s.amountG, "1000");
    assert.equal(s.claimed, false);
    assert.equal(s.voucher.to.toLowerCase(), p.address);
    assert.equal(BigInt(s.voucher.id), spoilId("TRIAL_PRIZE", "2026-10-05", p.address));
    const ok = await verifyTypedData({
      address: h.ctx.voucherAccount.address,
      domain: { name: "MoonshardVault", version: "1", chainId: 42220, verifyingContract: VAULT },
      types: spoilTypes,
      primaryType: "Spoil",
      message: {
        to: s.voucher.to,
        id: BigInt(s.voucher.id),
        amount: BigInt(s.voucher.amount),
        deadline: BigInt(s.voucher.deadline),
      },
      signature: s.voucher.signature,
    });
    assert.equal(ok, true);
    assert.equal(BigInt(s.voucher.deadline), BigInt(Math.floor(h.clock() / 1000) + 7 * 24 * 3600));
  } finally { await h.close(); }
});

test("already-redeemed spoils get no voucher; an RPC failure reports claimed:null and no voucher", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const id = spoilId("TRIAL_PRIZE", "2026-10-05", p.address).toString();
    h.chain.state.claimedIds.add(id);
    const done = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(done.claimed, true);
    assert.equal(done.voucher, null);

    h.chain.voucherClaimed = async () => { throw new Error("rpc down"); };
    const down = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(down.claimed, null);
    assert.equal(down.voucher, null);
  } finally { await h.close(); }
});

test("players only ever see their own spoils; unverified see none", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, a, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    assert.equal((await h.api.get("/spoils", { token: a.token })).body.spoils.length, 1);
    assert.equal((await h.api.get("/spoils", { token: b.token })).body.spoils.length, 0);
    assert.equal((await h.api.get("/spoils", { token: u.token })).body.spoils.length, 0);
  } finally { await h.close(); }
});

test("/spoils/confirm records redemptions of the caller's own vouchers only", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    await playTrial(h, a, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const id = spoilId("TRIAL_PRIZE", "2026-10-05", a.address);
    const topics = encodeEventTopics({ abi: vaultAbi, eventName: "Claimed", args: { id, to: a.account.address } });
    const data = encodeAbiParameters([{ type: "uint256" }], [G(1000)]);
    const hash = "0x" + "ab".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: a.account.address, to: VAULT, input: "0x" },
      receipt: { status: "success", logs: [{ address: VAULT, topics, data, logIndex: 0, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false }] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    const theirs = await h.api.post("/spoils/confirm", { txHash: hash }, { token: b.token });
    assert.deepEqual(theirs.body.recorded, []);
    const mine = await h.api.post("/spoils/confirm", { txHash: hash }, { token: a.token });
    assert.deepEqual(mine.body.recorded, [id.toString()]);
    const again = await h.api.post("/spoils/confirm", { txHash: hash }, { token: a.token });
    assert.deepEqual(again.body.recorded, []);
    assert.equal((await h.api.post("/spoils/confirm", { txHash: "nope" }, { token: a.token })).body.error, "bad_tx");
    assert.equal((await h.api.post("/spoils/confirm", { txHash: "0x" + "cd".repeat(32) }, { token: a.token })).status, 404);
    assert.equal(formatUnits(G(1000), 18), "1000");
  } finally { await h.close(); }
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard/server && npm test
```

Expected: spoils tests FAIL (`../src/spoils.js` missing).

- [ ] **Step 3: Implement spoils and cron**

`server/src/spoils.js`:

```js
import express from "express";
import { encodePacked, formatUnits, keccak256, parseEventLogs } from "viem";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { vaultAbi } from "./chain.js";

export const spoilTypes = {
  Spoil: [
    { name: "to", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

export const spoilId = (kind, day, subject) =>
  BigInt(keccak256(encodePacked(["string", "string", "address"], [kind, day, subject])));

/** Settle one UTC day into `spoils` rows. Safe to call repeatedly. */
export async function settleDay(ctx, day) {
  return ctx.db.tx(async (t) => {
    const marker = await t.query("INSERT INTO settled_days(day) VALUES ($1) ON CONFLICT DO NOTHING RETURNING day", [day]);
    if (marker.rows.length === 0) return { day, settled: false };

    const top = await t.query(
      `SELECT subject FROM scores WHERE day = $1 AND ranked_ok AND verified
         ORDER BY score DESC, duration_ms ASC, kills DESC, run_id ASC LIMIT $2`,
      [day, GAME.PRIZES.length],
    );
    for (let i = 0; i < top.rows.length; i++) {
      const subject = top.rows[i].subject;
      await t.query(
        `INSERT INTO spoils(id, kind, day, subject, amount, rank) VALUES ($1,'TRIAL_PRIZE',$2,$3,$4,$5)
         ON CONFLICT (kind, day, subject) DO NOTHING`,
        [spoilId("TRIAL_PRIZE", day, subject).toString(), day, subject, GAME.PRIZES[i].toString(), i + 1],
      );
    }

    const harvest = await t.query("SELECT subject, shards FROM shard_days WHERE day = $1 AND shards > 0", [day]);
    for (const row of harvest.rows) {
      const amount = BigInt(Math.min(row.shards, GAME.DAILY_SHARD_CAP)) * GAME.SHARD_RATE;
      await t.query(
        `INSERT INTO spoils(id, kind, day, subject, amount) VALUES ($1,'SHARD_HARVEST',$2,$3,$4)
         ON CONFLICT (kind, day, subject) DO NOTHING`,
        [spoilId("SHARD_HARVEST", day, row.subject).toString(), day, row.subject, amount.toString()],
      );
    }
    return { day, settled: true, prizes: top.rows.length, harvests: harvest.rows.length };
  });
}

/** Settle every day that can no longer receive submissions (ticket window + 1 min passed). */
export async function settleDue(ctx) {
  const cutoff = dayKey(ctx.now() - GAME.TICKET_MAX_AGE_MS - 60_000);
  const { rows } = await ctx.db.query(
    `SELECT day FROM (SELECT day FROM scores UNION SELECT day FROM shard_days) d
      WHERE day < $1 AND day NOT IN (SELECT day FROM settled_days) ORDER BY day`,
    [cutoff],
  );
  const out = [];
  for (const r of rows) out.push(await settleDay(ctx, r.day));
  return out;
}

export function spoilsRoutes(ctx) {
  const r = express.Router();

  r.get("/spoils", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const { rows } = await ctx.db.query(
      "SELECT id, kind, day, amount, rank FROM spoils WHERE subject = $1 ORDER BY day DESC, kind",
      [p.subject],
    );
    const vault = ctx.config.contracts.vault;
    const deadline = BigInt(Math.floor(ctx.now() / 1000) + GAME.VOUCHER_TTL_SEC);
    const spoils = [];
    for (const s of rows) {
      let claimed = null;
      try {
        claimed = await ctx.chain.voucherClaimed(s.id);
      } catch {
        claimed = null;
      }
      let voucher = null;
      if (claimed === false && p.verified && vault && ctx.voucherAccount) {
        const message = { to: p.wallet, id: BigInt(s.id), amount: BigInt(s.amount), deadline };
        const signature = await ctx.voucherAccount.signTypedData({
          domain: { name: "MoonshardVault", version: "1", chainId: ctx.config.chainId, verifyingContract: vault },
          types: spoilTypes,
          primaryType: "Spoil",
          message,
        });
        voucher = { to: p.wallet, id: s.id, amount: s.amount, deadline: deadline.toString(), signature };
      }
      spoils.push({
        id: s.id, kind: s.kind, day: s.day, rank: s.rank,
        amount: s.amount, amountG: formatUnits(BigInt(s.amount), 18),
        claimed, voucher,
      });
    }
    res.json({ vault: vault ? { address: vault, chainId: ctx.config.chainId } : null, spoils });
  }));

  r.post("/spoils/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");
    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    if (found.receipt.status !== "success") throw new HttpError(422, "tx_failed");

    const vault = String(ctx.config.contracts.vault || "").toLowerCase();
    const logs = parseEventLogs({ abi: vaultAbi, eventName: "Claimed", logs: found.receipt.logs })
      .filter((l) => l.address.toLowerCase() === vault);
    const recorded = [];
    for (const log of logs) {
      const id = log.args.id.toString();
      const mine = await ctx.db.query("SELECT amount FROM spoils WHERE id = $1 AND subject = $2", [id, p.subject]);
      if (mine.rows.length === 0) continue;
      const ins = await ctx.db.query(
        `INSERT INTO spoil_claims(tx_hash, spoil_id, subject, amount) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tx_hash) DO NOTHING RETURNING spoil_id`,
        [hash, id, p.subject, mine.rows[0].amount],
      );
      if (ins.rows.length) recorded.push(id);
    }
    res.json({ ok: true, recorded });
  }));

  return r;
}
```

`server/src/cron.js`:

```js
import { settleDue } from "./spoils.js";

/** Settles closed days every `intervalMs`. Returns a stop function. */
export function startSettlementCron(ctx, intervalMs = 60_000) {
  const run = () => settleDue(ctx).catch((err) => console.error("[moonshard] settlement failed", err));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Mount and start**

In `server/src/app.js`: `import { spoilsRoutes } from "./spoils.js";` and `api.use(spoilsRoutes(ctx));` after the leaderboard line.

In `server/index.js`: `import { startSettlementCron } from "./src/cron.js";` and call `startSettlementCron(ctx);` after `app.listen(...)` (change `const { app } = createApp(...)` to `const { app, ctx } = createApp(...)`).

- [ ] **Step 5: Run to verify pass**

```bash
npm test
```

Expected: all spoils tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add server && git commit -m "feat(server): daily Spoils settlement, EIP-712 vouchers, redemption tracking"
```

---

### Task 7: UBI confirmation + blessing, Engagement Rewards attestation, rewards status, stats

**Files:**
- Create: `server/src/ubi.js`, `server/src/engagement.js`, `server/src/rewards.js`, `server/src/stats.js`
- Modify: `server/src/app.js` (mount)
- Test: `server/test/ubi.test.js`, `server/test/engagement.test.js`, `server/test/stats.test.js`

**Interfaces:**
- Consumes: Tasks 3–6 (`ctx`, `req.player`, `spoilId` not needed).
- Produces:
  - `POST /api/ubi/confirm {txHash}` (auth, verified) → `{ok, blessing:true, day, recorded}`; 403 `verification_required | not_your_tx`; 404 `tx_not_found`; 422 `tx_failed | wrong_contract | wrong_method | tx_not_today`.
  - `GET /api/rewards/status` (auth) → `{wallet, dateSeed, verified, status, firstBossClaimed, firstBossPrizeG, crystalStatus:{gdEarned, dailyCapGd, isCapped, shards, rateGd}, blessing, pendingBossRunId}`; numbers are JS numbers in G$.
  - `GET /api/engagement/status` (auth) → `{configured, app, claimedHere, canClaim, reason, pendingRunId, rewardG}`.
  - `POST /api/engagement/attest {runId}` (auth, verified) → `{app, user, inviter, validUntilBlock, appSignature}`; 403 `boss_not_cleared | verification_required`, 409 `already_claimed | not_claimable`, 410 `run_too_old`, 503 `engagement_not_configured`.
  - `POST /api/engagement/confirm {txHash}` (auth) → `{ok, recorded}`.
  - `GET /api/stats` (public, cached 60 s) → `{verifiedPlayers, walletsConnected, runsToday, activeToday, ubiClaimsTotal, ubiClaimsToday, engagementClaims, spoilsIssuedG, spoilsPaidG, series:[{day, runs, active, ubiClaims}], updatedAt}`.
  - EIP-712 for attestation: domain `{name:"EngagementRewards", version:"1.0", chainId, verifyingContract: engagement}`, `AppClaim(address app,address user,uint256 validUntilBlock)`.

- [ ] **Step 1: Write the failing tests**

`server/test/ubi.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, UBI } from "./helpers.js";

const HASH = "0x" + "11".repeat(32);

function setClaimTx(h, p, over = {}) {
  h.chain.state.txs.set(HASH, {
    tx: { from: p.account.address, to: UBI, input: "0x4e71d92d" },
    receipt: { status: "success", logs: [] },
    timestamp: Math.floor(h.clock() / 1000),
    ...over,
  });
}

test("confirming a real claim() tx grants today's blessing and is idempotent", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setClaimTx(h, p);
    const r = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.blessing, true);
    assert.equal(r.body.recorded, true);
    const again = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });
    assert.equal(again.body.recorded, false);
    const st = await h.api.get("/rewards/status", { token: p.token });
    assert.equal(st.body.blessing, true);
  } finally { await h.close(); }
});

test("rejects wrong contract, wrong method, failed tx, someone else's tx, stale tx, unverified caller", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const other = await h.newPlayer({ verified: true });
    const call = () => h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });

    setClaimTx(h, p, { tx: { from: p.account.address, to: "0x0000000000000000000000000000000000000001", input: "0x4e71d92d" } });
    assert.equal((await call()).body.error, "wrong_contract");
    setClaimTx(h, p, { tx: { from: p.account.address, to: UBI, input: "0xa9059cbb" } });
    assert.equal((await call()).body.error, "wrong_method");
    setClaimTx(h, p, { receipt: { status: "reverted", logs: [] } });
    assert.equal((await call()).body.error, "tx_failed");
    setClaimTx(h, other);
    const theirs = await call();
    assert.equal(theirs.status, 403);
    assert.equal(theirs.body.error, "not_your_tx");
    setClaimTx(h, p, { timestamp: Math.floor(h.clock() / 1000) - 2 * 86400 });
    assert.equal((await call()).body.error, "tx_not_today");

    const u = await h.newPlayer();
    setClaimTx(h, u);
    const nv = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: u.token });
    assert.equal(nv.status, 403);
    assert.equal(nv.body.error, "verification_required");
    assert.equal((await h.api.post("/ubi/confirm", { txHash: "bad" }, { token: p.token })).body.error, "bad_tx");
    assert.equal((await h.api.post("/ubi/confirm", { txHash: "0x" + "22".repeat(32) }, { token: p.token })).status, 404);
  } finally { await h.close(); }
});

test("a linked second wallet of the same human may confirm the claim", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true, root: a.address });
    setClaimTx(h, a);
    const r = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: b.token });
    assert.equal(r.status, 200);
  } finally { await h.close(); }
});

test("rewards status reports pending harvest and the cap in G$", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { kills: 40, shards: 30 });
    const st = (await h.api.get("/rewards/status", { token: p.token })).body;
    assert.equal(st.verified, true);
    assert.equal(st.crystalStatus.shards, 30);
    assert.equal(st.crystalStatus.gdEarned, 60);
    assert.equal(st.crystalStatus.dailyCapGd, 100);
    assert.equal(st.crystalStatus.isCapped, false);
    assert.equal(st.crystalStatus.rateGd, 2);
    await playTrial(h, p, { kills: 40, shards: 30 });
    const capped = (await h.api.get("/rewards/status", { token: p.token })).body;
    assert.equal(capped.crystalStatus.isCapped, true);
    assert.equal(capped.crystalStatus.gdEarned, 100);
    assert.equal(capped.firstBossClaimed, false);
  } finally { await h.close(); }
});
```

`server/test/engagement.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, verifyTypedData, zeroAddress } from "viem";
import { makeHarness, ENGAGEMENT } from "./helpers.js";
import { engagementAbi } from "../src/chain.js";

async function clearBoss(h, p) {
  const run = (await h.api.post("/runs/start", { mode: "STORY", chapter: 1 }, { token: p.token })).body;
  h.clock.advance(50_000);
  const pts = [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 }));
  await h.api.post(`/runs/${run.runId}/checkpoints`, { points: pts }, { token: p.token });
  h.clock.advance(10_500);
  const sub = await h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, { token: p.token });
  assert.equal(sub.body.bossCleared, true);
  return run.runId;
}

test("attestation is signed for the right app/user/block and verifies against the contract's domain", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    const r = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.inviter, zeroAddress);
    assert.equal(r.body.app, h.ctx.appAccount.address);
    assert.equal(BigInt(r.body.validUntilBlock), 1_000n + 300n);
    assert.ok(BigInt(r.body.validUntilBlock) - 1_000n <= 600n);
    const ok = await verifyTypedData({
      address: h.ctx.appAccount.address,
      domain: { name: "EngagementRewards", version: "1.0", chainId: 42220, verifyingContract: ENGAGEMENT },
      types: { AppClaim: [{ name: "app", type: "address" }, { name: "user", type: "address" }, { name: "validUntilBlock", type: "uint256" }] },
      primaryType: "AppClaim",
      message: { app: r.body.app, user: p.account.address, validUntilBlock: BigInt(r.body.validUntilBlock) },
      signature: r.body.appSignature,
    });
    assert.equal(ok, true);
  } finally { await h.close(); }
});

test("no attestation without a cleared boss run, for other players' runs, unverified players, or stale runs", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const q = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    const noRun = await h.api.post("/engagement/attest", { runId: "nope" }, { token: p.token });
    assert.equal(noRun.status, 403);
    assert.equal(noRun.body.error, "boss_not_cleared");

    const runId = await clearBoss(h, p);
    assert.equal((await h.api.post("/engagement/attest", { runId }, { token: q.token })).body.error, "boss_not_cleared");
    assert.equal((await h.api.post("/engagement/attest", { runId }, { token: u.token })).body.error, "verification_required");

    h.clock.advance(25 * 3600_000);
    const stale = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(stale.status, 410);
    assert.equal(stale.body.error, "run_too_old");
  } finally { await h.close(); }
});

test("contract says not claimable (cooldown / unapproved app) -> 409 with the reason, no signature", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    h.chain.state.engagement = { ok: false, reason: "Claim cooldown not reached" };
    const r = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "not_claimable");
    assert.equal(r.body.reason, "Claim cooldown not reached");
    assert.equal(r.body.appSignature, undefined);
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.canClaim, false);
    assert.equal(st.body.pendingRunId, runId);
  } finally { await h.close(); }
});

test("confirm records a real RewardClaimed event once; a later attest says already_claimed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    const hash = "0x" + "33".repeat(32);
    const topics = encodeEventTopics({ abi: engagementAbi, eventName: "RewardClaimed", args: { app: h.ctx.appAccount.address, user: p.account.address, inviter: zeroAddress } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [1000n, 4000n, 0n]);
    h.chain.state.txs.set(hash, {
      tx: { from: p.account.address, to: ENGAGEMENT, input: "0x" },
      receipt: { status: "success", logs: [{ address: ENGAGEMENT, topics, data, logIndex: 0, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false }] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    const r = await h.api.post("/engagement/confirm", { txHash: hash }, { token: p.token });
    assert.equal(r.body.recorded, true);
    assert.equal((await h.api.post("/engagement/confirm", { txHash: hash }, { token: p.token })).body.recorded, false);
    const again = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_claimed");
    const st = await h.api.get("/rewards/status", { token: p.token });
    assert.equal(st.body.firstBossClaimed, true);
  } finally { await h.close(); }
});

test("engagement endpoints degrade cleanly when the app signer is not configured", async () => {
  const h = await makeHarness({ config: { appSignerKey: "" } });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.configured, false);
    const r = await h.api.post("/engagement/attest", { runId: "x" }, { token: p.token });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "engagement_not_configured");
  } finally { await h.close(); }
});
```

`server/test/stats.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, UBI } from "./helpers.js";

test("stats count verified players, runs, claims and cache for 60s", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    await h.newPlayer();
    await playTrial(h, a, { score: 500 });
    const hash = "0x" + "44".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: a.account.address, to: UBI, input: "0x4e71d92d" },
      receipt: { status: "success", logs: [] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    await h.api.post("/ubi/confirm", { txHash: hash }, { token: a.token });

    const s = (await h.api.get("/stats")).body;
    assert.equal(s.verifiedPlayers, 1);
    assert.equal(s.walletsConnected, 2);
    assert.equal(s.runsToday, 1);
    assert.equal(s.activeToday, 1);
    assert.equal(s.ubiClaimsTotal, 1);
    assert.equal(s.ubiClaimsToday, 1);
    assert.equal(s.engagementClaims, 0);
    assert.equal(s.series.length, 7);
    assert.equal(s.series[6].day, "2026-10-05");
    assert.equal(s.series[6].runs, 1);

    await h.newPlayer({ verified: true });
    assert.equal((await h.api.get("/stats")).body.verifiedPlayers, 1); // cached
    h.clock.advance(61_000);
    assert.equal((await h.api.get("/stats")).body.verifiedPlayers, 2);
  } finally { await h.close(); }
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard/server && npm test
```

Expected: ubi/engagement/stats tests FAIL.

- [ ] **Step 3: Implement `ubi.js`**

`server/src/ubi.js`:

```js
import express from "express";
import { toFunctionSelector } from "viem";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";

const CLAIM_SELECTOR = toFunctionSelector("claim()"); // 0x4e71d92d

export function ubiRoutes(ctx) {
  const r = express.Router();

  r.post("/ubi/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!p.verified) throw new HttpError(403, "verification_required");
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");

    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    const { tx, receipt, timestamp } = found;
    if (receipt.status !== "success") throw new HttpError(422, "tx_failed");
    if (String(tx.to || "").toLowerCase() !== ctx.config.contracts.ubi.toLowerCase()) throw new HttpError(422, "wrong_contract");
    if (String(tx.input || "").toLowerCase().slice(0, 10) !== CLAIM_SELECTOR) throw new HttpError(422, "wrong_method");

    const from = String(tx.from).toLowerCase();
    const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [from, p.subject]);
    if (own.rows.length === 0) throw new HttpError(403, "not_your_tx");

    const day = dayKey(timestamp * 1000);
    if (day !== dayKey(ctx.now())) throw new HttpError(422, "tx_not_today");

    const ins = await ctx.db.query(
      "INSERT INTO ubi_claims(tx_hash, subject, wallet, day) VALUES ($1,$2,$3,$4) ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash",
      [hash, p.subject, from, day],
    );
    await ctx.db.query("INSERT INTO blessings(subject, day) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.subject, day]);
    res.json({ ok: true, blessing: true, day, recorded: ins.rows.length > 0 });
  }));

  return r;
}
```

- [ ] **Step 4: Implement `engagement.js`**

`server/src/engagement.js`:

```js
import express from "express";
import { parseEventLogs, zeroAddress } from "viem";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { engagementAbi } from "./chain.js";

const appClaimTypes = {
  AppClaim: [
    { name: "app", type: "address" },
    { name: "user", type: "address" },
    { name: "validUntilBlock", type: "uint256" },
  ],
};

export async function pendingBossRun(ctx, subject) {
  const since = new Date(ctx.now() - GAME.ATTEST_MAX_AGE_MS);
  const { rows } = await ctx.db.query(
    `SELECT run_id FROM runs WHERE subject = $1 AND mode = 'STORY' AND status = 'submitted'
        AND boss_cleared AND submitted_at > $2 ORDER BY submitted_at DESC LIMIT 1`,
    [subject, since],
  );
  return rows[0]?.run_id ?? null;
}

export async function hasEngagementClaim(ctx, subject) {
  const { rows } = await ctx.db.query("SELECT 1 FROM engagement_claims WHERE subject = $1 LIMIT 1", [subject]);
  return rows.length > 0;
}

export function engagementRoutes(ctx) {
  const r = express.Router();

  r.get("/engagement/status", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const claimedHere = await hasEngagementClaim(ctx, p.subject);
    let can = null;
    if (ctx.appAccount && p.verified && !claimedHere) can = await ctx.chain.canClaimEngagement(ctx.appAccount.address, p.root);
    res.json({
      configured: Boolean(ctx.appAccount),
      app: ctx.appAccount?.address ?? null,
      claimedHere,
      canClaim: can ? can.ok : null,
      reason: can?.reason ?? null,
      pendingRunId: await pendingBossRun(ctx, p.subject),
      rewardG: GAME.ENGAGEMENT_REWARD_G,
    });
  }));

  r.post("/engagement/attest", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!ctx.appAccount) throw new HttpError(503, "engagement_not_configured");
    if (!p.verified) throw new HttpError(403, "verification_required");

    const runId = String(req.body?.runId || "");
    const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
    const run = rows[0];
    if (!run || run.subject !== p.subject || run.mode !== "STORY" || run.status !== "submitted" || !run.boss_cleared) {
      throw new HttpError(403, "boss_not_cleared");
    }
    if (ctx.now() - new Date(run.submitted_at).getTime() > GAME.ATTEST_MAX_AGE_MS) throw new HttpError(410, "run_too_old");
    if (await hasEngagementClaim(ctx, p.subject)) throw new HttpError(409, "already_claimed");

    const can = await ctx.chain.canClaimEngagement(ctx.appAccount.address, p.root);
    if (!can.ok) throw new HttpError(409, "not_claimable", { reason: can.reason });

    const validUntilBlock = (await ctx.chain.blockNumber()) + GAME.ENGAGEMENT_BLOCK_WINDOW;
    const appSignature = await ctx.appAccount.signTypedData({
      domain: {
        name: "EngagementRewards",
        version: "1.0",
        chainId: ctx.config.chainId,
        verifyingContract: ctx.config.contracts.engagement,
      },
      types: appClaimTypes,
      primaryType: "AppClaim",
      message: { app: ctx.appAccount.address, user: p.wallet, validUntilBlock },
    });
    res.json({
      app: ctx.appAccount.address,
      user: p.wallet,
      inviter: zeroAddress,
      validUntilBlock: validUntilBlock.toString(),
      appSignature,
    });
  }));

  r.post("/engagement/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!ctx.appAccount) throw new HttpError(503, "engagement_not_configured");
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");
    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    if (found.receipt.status !== "success") throw new HttpError(422, "tx_failed");

    const engagement = ctx.config.contracts.engagement.toLowerCase();
    const logs = parseEventLogs({ abi: engagementAbi, eventName: "RewardClaimed", logs: found.receipt.logs })
      .filter((l) => l.address.toLowerCase() === engagement && l.args.app.toLowerCase() === ctx.appAccount.address.toLowerCase());
    let recorded = false;
    for (const log of logs) {
      const user = log.args.user.toLowerCase();
      const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [user, p.subject]);
      if (own.rows.length === 0) continue;
      const ins = await ctx.db.query(
        "INSERT INTO engagement_claims(tx_hash, subject, wallet) VALUES ($1,$2,$3) ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash",
        [hash, p.subject, user],
      );
      recorded = recorded || ins.rows.length > 0;
    }
    res.json({ ok: true, recorded });
  }));

  return r;
}
```

- [ ] **Step 5: Implement `rewards.js` (HUD status)**

`server/src/rewards.js`:

```js
import express from "express";
import { formatUnits } from "viem";
import { GAME } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";
import { hasEngagementClaim, pendingBossRun } from "./engagement.js";

export function rewardsRoutes(ctx) {
  const r = express.Router();

  r.get("/rewards/status", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const day = dayKey(ctx.now());
    const rateGd = Number(formatUnits(GAME.SHARD_RATE, 18));
    const shardRow = await ctx.db.query("SELECT shards FROM shard_days WHERE day = $1 AND subject = $2", [day, p.subject]);
    const shards = shardRow.rows[0]?.shards ?? 0;
    const blessing = await ctx.db.query("SELECT 1 FROM blessings WHERE subject = $1 AND day = $2", [p.subject, day]);
    res.json({
      wallet: p.wallet,
      dateSeed: day,
      verified: p.verified,
      status: p.status,
      firstBossClaimed: await hasEngagementClaim(ctx, p.subject),
      firstBossPrizeG: Number(GAME.ENGAGEMENT_REWARD_G),
      crystalStatus: {
        gdEarned: Math.min(shards, GAME.DAILY_SHARD_CAP) * rateGd,
        dailyCapGd: GAME.DAILY_SHARD_CAP * rateGd,
        isCapped: shards >= GAME.DAILY_SHARD_CAP,
        shards,
        rateGd,
      },
      blessing: blessing.rows.length > 0,
      pendingBossRunId: await pendingBossRun(ctx, p.subject),
    });
  }));

  return r;
}
```

- [ ] **Step 6: Implement `stats.js`**

`server/src/stats.js`:

```js
import express from "express";
import { formatUnits } from "viem";
import { ah } from "./http.js";
import { DAY_MS, dayKey } from "./time.js";

const CACHE_MS = 60_000;

async function compute(ctx) {
  const now = ctx.now();
  const today = dayKey(now);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(now - (6 - i) * DAY_MS));
  const q = async (sql, params = []) => (await ctx.db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0];

  const verified = await one("SELECT count(*)::int AS n FROM users WHERE root IS NOT NULL");
  const wallets = await one("SELECT count(*)::int AS n FROM wallets");
  const runsToday = await one("SELECT count(*)::int AS n FROM runs WHERE day = $1 AND status = 'submitted'", [today]);
  const activeToday = await one("SELECT count(DISTINCT subject)::int AS n FROM runs WHERE day = $1", [today]);
  const ubiTotal = await one("SELECT count(*)::int AS n FROM ubi_claims");
  const ubiToday = await one("SELECT count(*)::int AS n FROM ubi_claims WHERE day = $1", [today]);
  const engagement = await one("SELECT count(*)::int AS n FROM engagement_claims");
  const issued = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoils");
  const paid = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoil_claims");
  const runRows = await q(
    "SELECT day, count(*)::int AS runs, count(DISTINCT subject)::int AS active FROM runs WHERE day >= $1 AND status = 'submitted' GROUP BY day",
    [days[0]],
  );
  const ubiRows = await q("SELECT day, count(*)::int AS n FROM ubi_claims WHERE day >= $1 GROUP BY day", [days[0]]);

  return {
    verifiedPlayers: verified.n,
    walletsConnected: wallets.n,
    runsToday: runsToday.n,
    activeToday: activeToday.n,
    ubiClaimsTotal: ubiTotal.n,
    ubiClaimsToday: ubiToday.n,
    engagementClaims: engagement.n,
    spoilsIssuedG: formatUnits(BigInt(issued.t.split(".")[0]), 18),
    spoilsPaidG: formatUnits(BigInt(paid.t.split(".")[0]), 18),
    series: days.map((day) => ({
      day,
      runs: runRows.find((r) => r.day === day)?.runs ?? 0,
      active: runRows.find((r) => r.day === day)?.active ?? 0,
      ubiClaims: ubiRows.find((r) => r.day === day)?.n ?? 0,
    })),
    updatedAt: new Date(now).toISOString(),
  };
}

export function statsRoutes(ctx) {
  const r = express.Router();
  let cache = null;
  r.get("/stats", ah(async (_req, res) => {
    if (!cache || ctx.now() - cache.at > CACHE_MS) cache = { at: ctx.now(), data: await compute(ctx) };
    res.json(cache.data);
  }));
  return r;
}
```

- [ ] **Step 7: Mount routes**

In `server/src/app.js` add imports for `ubiRoutes`, `engagementRoutes`, `rewardsRoutes`, `statsRoutes` and mount after `spoilsRoutes`:

```js
  api.use(ubiRoutes(ctx));
  api.use(engagementRoutes(ctx));
  api.use(rewardsRoutes(ctx));
  api.use(statsRoutes(ctx));
```

- [ ] **Step 8: Run to verify pass**

```bash
npm test
```

Expected: every server test PASSES (db, config, auth, runs, spoils, ubi, engagement, stats).

- [ ] **Step 9: Commit**

```bash
cd /Users/ram/Desktop/moonshard
git add server && git commit -m "feat(server): UBI confirm + blessing, Engagement Rewards attestation, rewards status, public stats"
```

---

### Task 8: Client GoodDollar core (config, api, session, host, wallet, auth, format, identicon)

**Files:**
- Create: `src/gd/config.js`, `src/gd/format.js`, `src/gd/identicon.js`, `src/gd/api.js`, `src/gd/session.js`, `src/gd/host.js`, `src/gd/wallet.js`, `src/gd/auth.js`
- Test: `test/client/format.test.js`, `test/client/identicon.test.js`, `test/client/api.test.js`, `test/client/wallet.test.js`, `test/client/auth.test.js`

**Interfaces:**
- Produces (all ESM, importable under plain Node — no DOM access at import time):
  - `GD = {apiUrl, chainId: 42220, rpcUrl, env, reownProjectId}`, `SHARD_RATE_GD = 2`, `DAILY_SHARD_CAP_GD = 100`, `explorerTx(hash)`.
  - `shortAddress(addr)`, `formatG(value, maxDecimals?)`, `formatCountdown(ms)`, `explainError(errOrCode) → string`.
  - `identiconDataUrl(address): Promise<string>`, `identiconSvg(address): string`, `identiconGrid(address): boolean[5][5]`.
  - `apiFetch(path, {method?, token?, body?, base?, fetchImpl?, timeoutMs?}) → Promise<json>`; errors are `Error(code)` with `.status` (0 = network/timeout) and `.body`.
  - `saveSession({token,address,host})`, `loadSession()`, `getToken()`, `getAddress()`, `clearSession()` (12 h expiry; in-memory fallback when `localStorage` is unavailable).
  - `detectHost(win?) → 'minipay'|'goodwallet'|'browser'`, `hostLanguage(win?)`.
  - `createWalletManager({getProvider?, getFallbackProvider?, chainId?, rpcUrl?}) → {connect(), restore(address), disconnect(), getState(), subscribe(fn), clients(), signMessage(msg), switchToCelo()}`; `connect()` resolves `{ok:true,address,wrongChain}` or `{ok:false,reason:'no_wallet'|'rejected'|'no_account'|'wallet_error'}`; state `{connected,address,chainId,wrongChain}`; `clients()` throws `Error('no_wallet'|'wrong_chain')`; `normalizeError(err) → Error` (rejections become `Error('rejected')`).
  - `loginMessage(nonce, issuedAt)` (identical to `server/src/auth.js`), `signIn({wallet, host, api?}) → server verify response`.

- [ ] **Step 1: Write the failing tests**

`test/client/format.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAddress, formatG, formatCountdown, explainError } from '../../src/gd/format.js';

test('shortAddress keeps both ends and leaves short input alone', () => {
  assert.equal(shortAddress('0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678');
  assert.equal(shortAddress('0x12'), '0x12');
  assert.equal(shortAddress(null), '');
});

test('formatG groups thousands and respects decimals', () => {
  assert.equal(formatG(5000), '5,000');
  assert.equal(formatG('1234.5678', 2), '1,234.57');
  assert.equal(formatG('nope'), '0');
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-5), 'now');
  assert.equal(formatCountdown(30 * 60_000), '30m');
  assert.equal(formatCountdown(3 * 3600_000 + 12 * 60_000), '3h 12m');
});

test('explainError maps known codes and never leaks a stack', () => {
  assert.match(explainError('no_wallet'), /No wallet found/);
  assert.match(explainError(Object.assign(new Error('rejected'), { status: 400 })), /cancelled/i);
  assert.match(explainError({ message: 'x', status: 0 }), /slow/i);
  assert.equal(explainError({ message: 'not_claimable', body: { reason: 'Claim cooldown not reached' } }), 'Claim cooldown not reached');
  assert.equal(explainError(new Error('x'.repeat(200))), 'Something went wrong. Please try again.');
});
```

`test/client/identicon.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { identiconGrid, identiconSvg, identiconDataUrl } from '../../src/gd/identicon.js';

const A = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const B = '0x2222222222222222222222222222222222222222';

test('grid is deterministic, case-insensitive and horizontally symmetric', () => {
  assert.deepEqual(identiconGrid(A), identiconGrid(A.toUpperCase().replace('0X', '0x')));
  for (const row of identiconGrid(A)) assert.deepEqual(row, [...row].reverse());
});

test('different addresses give different images', () => {
  assert.notEqual(identiconSvg(A), identiconSvg(B));
});

test('data url is a decodable svg', async () => {
  const url = await identiconDataUrl(A);
  assert.match(url, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(url.split(',')[1]), /^<svg /);
});
```

`test/client/api.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../../src/gd/api.js';

const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('builds the URL, sends bearer token and JSON body', async () => {
  let seen;
  const out = await apiFetch('/runs/start', {
    method: 'POST', token: 'tok', body: { a: 1 }, base: 'https://x.test',
    fetchImpl: async (url, init) => { seen = { url, init }; return resp(200, { ok: true }); },
  });
  assert.equal(seen.url, 'https://x.test/api/runs/start');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.body, '{"a":1}');
  assert.deepEqual(out, { ok: true });
});

test('HTTP errors become Error(code) with status and body', async () => {
  await assert.rejects(
    apiFetch('/x', { fetchImpl: async () => resp(409, { error: 'already_claimed', reason: 'r' }) }),
    (err) => err.message === 'already_claimed' && err.status === 409 && err.body.reason === 'r',
  );
});

test('network failure is status 0', async () => {
  await assert.rejects(
    apiFetch('/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (err) => err.status === 0,
  );
});

test('slow server is aborted and reported as timeout, status 0', async () => {
  const fetchImpl = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    apiFetch('/x', { fetchImpl, timeoutMs: 20 }),
    (err) => err.message === 'timeout' && err.status === 0,
  );
});
```

`test/client/wallet.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletManager, normalizeError } from '../../src/gd/wallet.js';

const CELO = '0xa4ec'; // 42220
const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

function stub({ chainId = CELO, accounts = [ADDR], rejectConnect = false, switchOk = true, switch4902 = false } = {}) {
  const listeners = {};
  const p = {
    chainId, calls: [], addCalled: false,
    on: (e, fn) => { (listeners[e] ||= []).push(fn); },
    emit: (e, ...a) => (listeners[e] || []).forEach((fn) => fn(...a)),
    async request({ method, params }) {
      p.calls.push(method);
      if (method === 'eth_requestAccounts') {
        if (rejectConnect) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        return accounts;
      }
      if (method === 'eth_accounts') return accounts;
      if (method === 'eth_chainId') return p.chainId;
      if (method === 'wallet_switchEthereumChain') {
        if (switch4902 && !p.addCalled) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        if (!switchOk) throw Object.assign(new Error('User rejected'), { code: 4001 });
        p.chainId = params[0].chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') { p.addCalled = true; return null; }
      if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
      throw new Error(`unexpected ${method}`);
    },
  };
  return p;
}

test('no wallet installed: connect reports no_wallet instead of throwing (Safari/Firefox)', async () => {
  const w = createWalletManager({ getProvider: () => undefined });
  assert.deepEqual(await w.connect(), { ok: false, reason: 'no_wallet' });
  assert.equal(w.getState().connected, false);
  assert.throws(() => w.clients(), /no_wallet/);
});

test('no injected wallet but a WalletConnect-style fallback provider -> connects through it', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => undefined, getFallbackProvider: async () => p });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('fallback provider that fails or is dismissed does not crash connect', async () => {
  const closed = createWalletManager({
    getProvider: () => undefined,
    getFallbackProvider: async () => { throw Object.assign(new Error('Connection request reset'), { code: 4001 }); },
  });
  assert.equal((await closed.connect()).reason, 'rejected');
  const none = createWalletManager({ getProvider: () => undefined, getFallbackProvider: async () => null });
  assert.equal((await none.connect()).reason, 'no_wallet');
});

test('user rejects the connect prompt', async () => {
  const w = createWalletManager({ getProvider: () => stub({ rejectConnect: true }) });
  assert.equal((await w.connect()).reason, 'rejected');
});

test('wallet with no accounts', async () => {
  const w = createWalletManager({ getProvider: () => stub({ accounts: [] }) });
  assert.equal((await w.connect()).reason, 'no_account');
});

test('already on Celo: connected, lowercase address, not wrong chain', async () => {
  const w = createWalletManager({ getProvider: () => stub() });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(r.wrongChain, false);
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('wrong chain + switch accepted -> ends on Celo', async () => {
  const p = stub({ chainId: '0x1' });
  const w = createWalletManager({ getProvider: () => p });
  const r = await w.connect();
  assert.equal(r.wrongChain, false);
  assert.ok(p.calls.includes('wallet_switchEthereumChain'));
});

test('wrong chain + switch refused -> stays connected, wrongChain flagged, clients() blocked (no crash)', async () => {
  const p = stub({ chainId: '0x1', switchOk: false });
  const w = createWalletManager({ getProvider: () => p });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(r.wrongChain, true);
  assert.equal(w.getState().wrongChain, true);
  assert.throws(() => w.clients(), /wrong_chain/);
});

test('unknown chain (4902) falls back to wallet_addEthereumChain', async () => {
  const p = stub({ chainId: '0x1', switch4902: true });
  const w = createWalletManager({ getProvider: () => p });
  await w.connect();
  assert.equal(p.addCalled, true);
});

test('accountsChanged to empty disconnects; chainChanged updates wrongChain', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  const seen = [];
  w.subscribe((s) => seen.push(s));
  await w.connect();
  p.emit('chainChanged', '0x1');
  assert.equal(w.getState().wrongChain, true);
  p.emit('chainChanged', CELO);
  assert.equal(w.getState().wrongChain, false);
  p.emit('accountsChanged', []);
  assert.equal(w.getState().connected, false);
  assert.ok(seen.length >= 3);
});

test('restore() reconnects silently only when the same account is still exposed', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  assert.equal(await w.restore('0x0000000000000000000000000000000000000001'), false);
  assert.equal(await w.restore(ADDR.toLowerCase()), true);
  assert.equal(w.getState().connected, true);
  assert.ok(!p.calls.includes('eth_requestAccounts'));
});

test('signMessage uses personal_sign and maps rejection to Error(rejected)', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  await w.connect();
  assert.match(await w.signMessage('hello'), /^0x/);
  p.request = async () => { throw Object.assign(new Error('User denied message signature'), { code: 4001 }); };
  await assert.rejects(w.signMessage('hello'), /rejected/);
});

test('normalizeError turns wallet rejections into a stable code', () => {
  assert.equal(normalizeError(Object.assign(new Error('x'), { code: 4001 })).message, 'rejected');
  assert.equal(normalizeError(new Error('boom')).message, 'boom');
});
```

`test/client/auth.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginMessage, signIn } from '../../src/gd/auth.js';
import { clearSession, getToken, getAddress } from '../../src/gd/session.js';

test('login message is exactly what the server parses', () => {
  assert.equal(
    loginMessage('ab'.repeat(32), '2026-10-05T12:00:00.000Z'),
    `Moonshard login\nNonce: ${'ab'.repeat(32)}\nIssued: 2026-10-05T12:00:00.000Z`,
  );
});

test('signIn fetches a nonce, signs the message, verifies and stores the session', async () => {
  clearSession();
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push([path, opts.body]);
    if (path === '/auth/nonce') return { nonce: 'cd'.repeat(32), issuedAt: '2026-10-05T12:00:00.000Z' };
    return { token: 'jwt', address: '0xabc', verified: true, status: 'verified' };
  };
  const wallet = {
    getState: () => ({ address: '0xabc' }),
    signMessage: async (m) => `sig(${m.length})`,
  };
  const res = await signIn({ wallet, host: 'minipay', api });
  assert.equal(res.verified, true);
  assert.equal(calls[1][1].host, 'minipay');
  assert.equal(calls[1][1].address, '0xabc');
  assert.equal(calls[1][1].message, loginMessage('cd'.repeat(32), '2026-10-05T12:00:00.000Z'));
  assert.equal(getToken(), 'jwt');
  assert.equal(getAddress(), '0xabc');
  clearSession();
  assert.equal(getToken(), null);
});

test('a rejected signature surfaces and stores nothing', async () => {
  clearSession();
  const api = async () => ({ nonce: 'ef'.repeat(32), issuedAt: 'x' });
  const wallet = { getState: () => ({ address: '0xabc' }), signMessage: async () => { throw new Error('rejected'); } };
  await assert.rejects(signIn({ wallet, host: 'browser', api }), /rejected/);
  assert.equal(getToken(), null);
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/ram/Desktop/moonshard && node --test "test/client/**/*.test.js"
```

Expected: FAIL (modules not found).

- [ ] **Step 3: Implement config, format, identicon**

`src/gd/config.js`:

```js
const env = import.meta.env ?? {};

export const GD = {
  apiUrl: env.VITE_API_URL || '',
  chainId: 42220,
  rpcUrl: env.VITE_CELO_RPC_URL || 'https://forno.celo.org',
  env: env.VITE_GD_ENV || 'production',
  reownProjectId: env.VITE_REOWN_PROJECT_ID || '',
};

/** Mirror server GAME.SHARD_RATE / daily cap in G$; `/api/config` is authoritative at runtime. */
export const SHARD_RATE_GD = 2;
export const DAILY_SHARD_CAP_GD = 100;

export const explorerTx = (hash) => `https://celoscan.io/tx/${hash}`;
```

`src/gd/format.js`:

```js
const MESSAGES = {
  no_wallet: 'No wallet found. Open Moonshard inside MiniPay or use a Celo-compatible wallet browser.',
  rejected: 'Request cancelled in your wallet.',
  wrong_chain: 'Switch your wallet to the Celo network to continue.',
  no_account: 'Your wallet has no account available.',
  wallet_mismatch: 'The connected wallet differs from the signed-in one. Switch accounts or reconnect.',
  unauthorized: 'Please connect your wallet first.',
  invalid_session: 'Your session expired. Reconnect your wallet.',
  verification_required: 'Verify you are human first (quick face scan).',
  already_claimed: 'You have already claimed this.',
  not_claimable: 'This reward is not claimable right now.',
  boss_not_cleared: 'Defeat a chapter boss first.',
  run_too_old: 'That boss run is too old. Defeat a boss again.',
  tx_failed: 'The transaction failed. Nothing was paid out.',
  chain_unavailable: 'The Celo network is busy. Try again in a moment.',
  timeout: 'The server is slow right now. Try again.',
  slow_down: 'Easy. Try again in a few seconds.',
  engagement_not_configured: 'Bounty claims are not enabled on this server yet.',
};

export function shortAddress(addr) {
  const a = String(addr || '').trim();
  return a.length < 10 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatG(value, maxDecimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}

export function formatCountdown(ms) {
  if (!(ms > 0)) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Human message for an Error / server code / wallet code. Never exposes stacks or long raw text. */
export function explainError(err) {
  const reason = typeof err === 'string' ? '' : err?.body?.reason || err?.reason || '';
  if (reason && reason !== 'not_claimable') return String(reason).slice(0, 120);
  const code = typeof err === 'string' ? err : err?.message || '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (err?.status === 0) return MESSAGES.timeout;
  return code && code.length < 90 ? code : 'Something went wrong. Please try again.';
}
```

`src/gd/identicon.js`:

```js
/** Small deterministic pixel avatar (5x5, mirrored) derived from an address. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function identiconGrid(address) {
  const seed = String(address || '').toLowerCase();
  let state = hash32(seed) || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  const grid = [];
  for (let y = 0; y < 5; y++) {
    const half = [next() % 100 < 55, next() % 100 < 55, next() % 100 < 55];
    grid.push([half[0], half[1], half[2], half[1], half[0]]);
  }
  return grid;
}

export function identiconSvg(address) {
  const hue = hash32(String(address || '').toLowerCase()) % 360;
  const fg = `hsl(${hue} 70% 58%)`;
  const bg = `hsl(${hue} 35% 14%)`;
  const cells = identiconGrid(address)
    .flatMap((row, y) => row.map((on, x) => (on ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fg}"/>` : '')))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges"><rect width="5" height="5" fill="${bg}"/>${cells}</svg>`;
}

export async function identiconDataUrl(address) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(identiconSvg(address))}`;
}
```

- [ ] **Step 4: Implement api, session, host**

`src/gd/api.js`:

```js
import { GD } from './config.js';

/**
 * Fetch JSON from the Moonshard API. Errors are `Error(code)` with `.status` (0 for network/timeout)
 * and `.body` (parsed JSON, when present).
 */
export async function apiFetch(path, {
  method = 'GET', token, body, base = GD.apiUrl, fetchImpl = globalThis.fetch, timeoutMs = 9000,
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(String(json.error || 'api_error'));
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } catch (err) {
    if (err?.status !== undefined) throw err;
    const wrapped = new Error(err?.name === 'AbortError' ? 'timeout' : 'network_error');
    wrapped.status = 0;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}
```

`src/gd/session.js`:

```js
const KEY = 'moonshard.session.v1';
const TTL_MS = 12 * 60 * 60 * 1000;
const memory = new Map();

function store() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked storage (private mode / webview) */ }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

export function saveSession({ token, address, host }) {
  const session = { token, address: String(address).toLowerCase(), host, expiresAt: Date.now() + TTL_MS };
  try { store().setItem(KEY, JSON.stringify(session)); } catch { memory.set(KEY, JSON.stringify(session)); }
  return session;
}

export function loadSession() {
  try {
    const raw = store().getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.token || !s.address || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession() {
  memory.delete(KEY);
  try { store().removeItem(KEY); } catch { /* ignore */ }
}

export const getToken = () => loadSession()?.token || null;
export const getAddress = () => loadSession()?.address || null;
```

`src/gd/host.js`:

```js
/** Best-effort host detection. 'minipay' is reliable (window.ethereum.isMiniPay); 'goodwallet' is a UA heuristic. */
export function detectHost(win = globalThis.window) {
  if (win?.ethereum?.isMiniPay) return 'minipay';
  if (/GoodWallet|GoodDapp/i.test(win?.navigator?.userAgent || '')) return 'goodwallet';
  return 'browser';
}

export const isEmbeddedHost = (win) => detectHost(win) !== 'browser';

export function hostLanguage(win = globalThis.window) {
  return String(win?.navigator?.language || 'en').split('-')[0] || 'en';
}
```

- [ ] **Step 5: Implement wallet manager**

`src/gd/wallet.js`:

```js
import { createPublicClient, createWalletClient, custom, http, toHex } from 'viem';
import { celo } from 'viem/chains';
import { GD } from './config.js';

const isRejection = (err) =>
  err?.code === 4001 || err?.code === 'ACTION_REJECTED' || /reject|denied|cancel/i.test(err?.message || '');

/** Wallet rejections become Error('rejected'); everything else is passed through. */
export function normalizeError(err) {
  if (isRejection(err)) return new Error('rejected');
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * `getProvider` returns the injected EIP-1193 provider (MiniPay, browser wallets).
 * `getFallbackProvider` (optional, async) supplies one when nothing is injected, e.g. WalletConnect.
 */
export function createWalletManager({
  getProvider: getInjected = () => globalThis.window?.ethereum,
  getFallbackProvider = null,
  chainId = GD.chainId,
  rpcUrl = GD.rpcUrl,
} = {}) {
  let state = { connected: false, address: null, chainId: null, wrongChain: false };
  const listeners = new Set();
  let bound = null;
  let fallback = null;
  const getProvider = () => getInjected() || fallback;

  const notify = () => listeners.forEach((fn) => { try { fn({ ...state }); } catch (e) { console.error(e); } });
  const set = (patch) => { state = { ...state, ...patch }; notify(); };

  const readChainId = async (provider) => Number(await provider.request({ method: 'eth_chainId' }));

  function bind(provider) {
    if (bound === provider || typeof provider.on !== 'function') return;
    bound = provider;
    provider.on('accountsChanged', (accounts) => {
      if (!accounts?.length) set({ connected: false, address: null });
      else set({ address: String(accounts[0]).toLowerCase() });
    });
    provider.on('chainChanged', (hex) => {
      const id = Number(hex);
      set({ chainId: id, wrongChain: id !== chainId });
    });
  }

  async function switchToCelo() {
    const provider = getProvider();
    if (!provider) return false;
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(chainId) }] });
    } catch (err) {
      if (err?.code !== 4902) return false;
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: toHex(chainId),
            chainName: 'Celo',
            nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
            rpcUrls: [rpcUrl],
            blockExplorerUrls: ['https://celoscan.io'],
          }],
        });
        // most wallets switch on add; switching again is harmless and covers the ones that do not
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(chainId) }] });
      } catch {
        return false;
      }
    }
    const now = await readChainId(provider);
    set({ chainId: now, wrongChain: now !== chainId });
    return now === chainId;
  }

  async function connect() {
    if (!getInjected() && !fallback && getFallbackProvider) {
      try {
        fallback = await getFallbackProvider();
      } catch (err) {
        return { ok: false, reason: isRejection(err) ? 'rejected' : 'wallet_error', message: err?.message };
      }
    }
    const provider = getProvider();
    if (!provider) return { ok: false, reason: 'no_wallet' };
    let accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch (err) {
      return { ok: false, reason: isRejection(err) ? 'rejected' : 'wallet_error', message: err?.message };
    }
    if (!accounts?.length) return { ok: false, reason: 'no_account' };
    bind(provider);
    const current = await readChainId(provider);
    set({ connected: true, address: String(accounts[0]).toLowerCase(), chainId: current, wrongChain: current !== chainId });
    if (current !== chainId) await switchToCelo();
    return { ok: true, address: state.address, wrongChain: state.wrongChain };
  }

  /** Reconnect without a prompt, only if the wallet still exposes `expectedAddress`. */
  async function restore(expectedAddress) {
    const provider = getProvider();
    if (!provider) return false;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      const match = (accounts || []).find((a) => String(a).toLowerCase() === String(expectedAddress).toLowerCase());
      if (!match) return false;
      bind(provider);
      const current = await readChainId(provider);
      set({ connected: true, address: String(match).toLowerCase(), chainId: current, wrongChain: current !== chainId });
      return true;
    } catch {
      return false;
    }
  }

  function disconnect() {
    set({ connected: false, address: null, wrongChain: false });
  }

  function rawWalletClient() {
    const provider = getProvider();
    if (!provider || !state.address) throw new Error('no_wallet');
    return createWalletClient({ account: state.address, chain: celo, transport: custom(provider) });
  }

  /** viem clients for on-chain actions. Blocks when the wallet is on the wrong chain. */
  function clients() {
    const walletClient = rawWalletClient();
    if (state.wrongChain) throw new Error('wrong_chain');
    return { walletClient, publicClient: createPublicClient({ chain: celo, transport: http(rpcUrl) }) };
  }

  async function signMessage(message) {
    try {
      return await rawWalletClient().signMessage({ message });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  return {
    connect, restore, disconnect, switchToCelo, clients, signMessage,
    getState: () => ({ ...state }),
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
```

- [ ] **Step 6: Implement client auth**

`src/gd/auth.js`:

```js
import { apiFetch } from './api.js';
import { saveSession } from './session.js';

/** Must stay byte-identical to `loginMessage` in server/src/auth.js. */
export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

export async function signIn({ wallet, host, api = apiFetch }) {
  const { nonce, issuedAt } = await api('/auth/nonce');
  const message = loginMessage(nonce, issuedAt);
  const signature = await wallet.signMessage(message);
  const res = await api('/auth/verify', {
    method: 'POST',
    body: { address: wallet.getState().address, message, signature, host },
  });
  saveSession({ token: res.token, address: res.address, host });
  return res;
}
```

- [ ] **Step 7: Run to verify pass**

```bash
node --test "test/client/**/*.test.js"
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/gd test && git commit -m "feat(client): GoodDollar core — wallet manager (Celo switch, restore), api, session, auth, format, identicon"
```

---

### Task 9: Run tracker, SDK wrappers and `GdService`

**Files:**
- Create: `src/gd/runs.js`, `src/gd/rewards.js`, `src/gd/leaderboard.js`, `src/gd/blessing.js`, `src/gd/identity.js`, `src/gd/ubi.js`, `src/gd/engagement.js`, `src/gd/spoils.js`, `src/engine/GdService.js`
- Modify: `src/engine/Storage.js` (blessing multiplier, rename Nimiq account accessors)
- Test: `test/client/runs.test.js`, `test/client/storage.test.js`

**Interfaces:**
- Consumes: Task 8 modules; server routes from Tasks 4–7.
- Produces:
  - `class RunTracker({api?, getToken?, now?, intervalMs?, timers?})` and singleton `runs`: `start({mode, chapter?}) → Promise<run|null>` (null = anonymous/offline/unticketed), `update({score?,kills?,shards?})`, `finish({score,kills,shards,durationMs,bossCleared?}) → Promise<{ticketed:false}|{ticketed:true,error?,status?,...serverResponse}>`, `stop()`. Never throws, never leaves a timer running.
  - `fetchRewardsStatus() → Promise<object|null>`; `fetchDailyBoard()`, `fetchAllTimeBoard()`, `fetchConfig()`, `getBoardView()`, `setBoardView('ranked'|'open')`, `todaySeedString()`.
  - `setBlessed(bool)`, `isBlessed()`.
  - `gdService` (singleton): `getStatus()`, `subscribe(fn)`, `connect()`, `disconnect()`, `refreshAll({force?})`, `verifyHuman()`, `claimUbi()`, `claimBounty()`, `redeem(spoilId)`, `switchToCelo()`. Action methods resolve `{ok:true,...}` or `{ok:false,error,message}` — they never throw.
  - `getStatus()` shape: `{connected, address, shortAddress, status:'anonymous'|'unverified'|'verified'|'expired', verified, wrongChain, hasWallet, needsReconnect, offline, busy:string|null, host, language, rewards, ubi:{entitlementG, canClaim, nextClaimAt}|null, bounty:{pendingRunId, claimedHere, canClaim, reason, rewardG}|null, spoils:[...], vault, blessing}`.
  - `Storage.addMaterials` multiplies by 1.25 (with fractional carry) while blessed; `storage.getWalletAccount()/setWalletAccount()` replace the Nimiq accessors.

- [ ] **Step 1: Write the failing tests**

`test/client/runs.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';

function harness({ token = 'tok', failStart = false, failCheckpoint = false } = {}) {
  let t = 1_000_000;
  const calls = [];
  const timers = { fns: [], setInterval(fn) { this.fns.push(fn); return this.fns.length; }, clearInterval(id) { this.fns[id - 1] = null; } };
  const api = async (path, opts = {}) => {
    calls.push({ path, body: opts.body });
    if (path === '/runs/start') {
      if (failStart) throw Object.assign(new Error('network_error'), { status: 0 });
      return { runId: 'r1', ticket: 'tk', seed: '2026-10-05' };
    }
    if (path.endsWith('/checkpoints') && failCheckpoint) throw Object.assign(new Error('network_error'), { status: 0 });
    if (path.endsWith('/submit')) return { ok: true, rankedOk: true, rank: { open: 1, ranked: 1 } };
    return { ok: true };
  };
  const tracker = new RunTracker({ api, getToken: () => token, now: () => t, intervalMs: 10_000, timers });
  return { tracker, calls, timers, advance: (ms) => { t += ms; }, tick: async () => { for (const fn of timers.fns) if (fn) await fn(); } };
}

test('anonymous players get no ticket and every call is a safe no-op', async () => {
  const h = harness({ token: null });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  h.tracker.update({ score: 5 });
  assert.deepEqual(await h.tracker.finish({ score: 5, kills: 1, shards: 0, durationMs: 9000 }), { ticketed: false });
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('server unreachable at start: unticketed offline run, no throw, no timer', async () => {
  const h = harness({ failStart: true });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  h.tracker.update({ score: 5 });
  assert.deepEqual(await h.tracker.finish({ score: 5, kills: 1, shards: 0, durationMs: 9000 }), { ticketed: false });
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('ticketed run: checkpoints carry elapsed time + latest counters, finish submits with the ticket', async () => {
  const h = harness();
  const run = await h.tracker.start({ mode: 'STORY', chapter: 2 });
  assert.equal(run.runId, 'r1');
  assert.deepEqual(h.calls[0].body, { mode: 'STORY', chapter: 2 });

  h.advance(10_000);
  h.tracker.update({ score: 120, kills: 4, shards: 1 });
  await h.tick();
  const cp = h.calls.find((c) => c.path === '/runs/r1/checkpoints');
  assert.deepEqual(cp.body.points, [{ t: 10_000, score: 120, kills: 4, shards: 1 }]);

  h.advance(7_000);
  const res = await h.tracker.finish({ score: 200, kills: 6, shards: 2, durationMs: 17_000, bossCleared: true });
  assert.equal(res.ticketed, true);
  assert.equal(res.rankedOk, true);
  const final = h.calls.filter((c) => c.path === '/runs/r1/checkpoints').pop();
  assert.equal(final.body.points.at(-1).t, 17_000); // closing checkpoint so coverage ~100%
  assert.equal(final.body.points.at(-1).score, 200);
  const submit = h.calls.find((c) => c.path === '/runs/r1/submit');
  assert.deepEqual(submit.body, { ticket: 'tk', score: 200, kills: 6, shards: 2, durationMs: 17_000, bossCleared: true });
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('failed checkpoint posts are retried, and finish still submits', async () => {
  const h = harness({ failCheckpoint: true });
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(10_000);
  await h.tick();
  h.advance(10_000);
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 20_000 });
  assert.equal(res.ticketed, true);
  assert.ok(h.calls.some((c) => c.path === '/runs/r1/submit'));
});

test('starting a new run stops the previous timer', async () => {
  const h = harness();
  await h.tracker.start({ mode: 'TRIAL' });
  await h.tracker.start({ mode: 'TRIAL' });
  assert.equal(h.timers.fns.filter(Boolean).length, 1);
  h.tracker.stop();
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});
```

`test/client/storage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../../src/engine/Storage.js';
import { setBlessed } from '../../src/gd/blessing.js';

test('without a blessing materials are added 1:1', () => {
  setBlessed(false);
  const before = { ...storage.getMaterials() };
  storage.addMaterials({ bark: 3, amber: 1, iron: 2 });
  const after = storage.getMaterials();
  assert.equal(after.bark - before.bark, 3);
  assert.equal(after.amber - before.amber, 1);
  assert.equal(after.iron - before.iron, 2);
});

test('with the Citizen\'s Blessing drops are +25% with fractional carry (4 single drops -> 5)', () => {
  setBlessed(true);
  const before = storage.getMaterials().bark;
  for (let i = 0; i < 4; i++) storage.addMaterials({ bark: 1 });
  assert.equal(storage.getMaterials().bark - before, 5);
  setBlessed(false);
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --test "test/client/**/*.test.js"
```

Expected: runs/storage tests FAIL (modules missing).

- [ ] **Step 3: Implement run tracker**

`src/gd/runs.js`:

```js
import { apiFetch } from './api.js';
import { getToken } from './session.js';

/**
 * Tracks one server-ticketed run. Anonymous / offline runs are simply unticketed: every method is
 * a safe no-op, so gameplay never depends on the API being reachable.
 */
export class RunTracker {
  constructor({
    api = apiFetch,
    getToken: tokenFn = getToken,
    now = () => Date.now(),
    intervalMs = 10_000,
    timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
  } = {}) {
    this.api = api;
    this.getToken = tokenFn;
    this.now = now;
    this.intervalMs = intervalMs;
    this.timers = timers;
    this.run = null;
    this.timer = null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    this.pending = [];
    this.inflight = null;
  }

  async start({ mode, chapter }) {
    this.stop();
    const token = this.getToken();
    if (!token) return null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    this.pending = [];
    const sentAt = this.now(); // measured from request time so server-side `t <= elapsed + tolerance` holds
    try {
      const run = await this.api('/runs/start', { method: 'POST', token, body: { mode, ...(chapter ? { chapter } : {}) } });
      this.run = { ...run, token, startedLocal: sentAt };
      this.timer = this.timers.setInterval(() => this.flush(), this.intervalMs);
      return run;
    } catch {
      this.run = null;
      return null;
    }
  }

  update(patch) {
    if (patch) Object.assign(this.counters, patch);
  }

  sample() {
    if (!this.run) return;
    this.pending.push({ t: this.now() - this.run.startedLocal, ...this.counters });
  }

  async flush() {
    if (!this.run) return;
    if (this.inflight) return this.inflight;
    this.sample();
    const run = this.run;
    const points = this.pending.splice(0, 50);
    if (!points.length) return;
    this.inflight = this.api(`/runs/${run.runId}/checkpoints`, { method: 'POST', token: run.token, body: { points } })
      .catch(() => {
        // keep them for the next tick (bounded) so a brief outage does not cost ranking coverage
        this.pending = [...points, ...this.pending].slice(-100);
      })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async finish({ score, kills, shards, durationMs, bossCleared = false }) {
    if (!this.run) return { ticketed: false };
    const run = this.run;
    this.update({ score, kills, shards });
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    if (this.inflight) await this.inflight;
    await this.flush(); // closing checkpoint
    this.run = null;
    try {
      const res = await this.api(`/runs/${run.runId}/submit`, {
        method: 'POST',
        token: run.token,
        body: { ticket: run.ticket, score, kills, shards, durationMs: Math.round(durationMs), bossCleared },
      });
      return { ticketed: true, ...res };
    } catch (err) {
      return { ticketed: true, error: err?.message || 'submit_failed', status: err?.status };
    }
  }

  stop() {
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.run = null;
    this.pending = [];
  }
}

export const runs = new RunTracker();
```

- [ ] **Step 4: Implement the thin API modules and blessing flag**

`src/gd/rewards.js`:

```js
import { apiFetch } from './api.js';
import { getToken } from './session.js';

/** HUD status for the connected player: pending shard G$, daily cap, first-boss bounty state, blessing. */
export async function fetchRewardsStatus() {
  const token = getToken();
  if (!token) return null;
  try {
    return await apiFetch('/rewards/status', { token });
  } catch (err) {
    console.warn('[rewards] status failed', err?.message);
    return null;
  }
}
```

`src/gd/leaderboard.js`:

```js
import { apiFetch } from './api.js';

let view = 'ranked';
export const getBoardView = () => view;
export const setBoardView = (v) => { view = v === 'open' ? 'open' : 'ranked'; };

export function todaySeedString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export const fetchDailyBoard = () => apiFetch(`/leaderboard/daily?view=${view}`);
export const fetchAllTimeBoard = () => apiFetch(`/leaderboard/alltime?view=${view}`);
export const fetchConfig = () => apiFetch('/config');
```

`src/gd/blessing.js`:

```js
let blessed = false;
export const setBlessed = (value) => { blessed = Boolean(value); };
export const isBlessed = () => blessed;
```

- [ ] **Step 5: Implement SDK wrappers**

`src/gd/identity.js`:

```js
import { IdentitySDK } from '@goodsdks/citizen-sdk';
import { GD } from './config.js';

/** Face-verification URL; the player returns to this page with ?gdfv=1 and we re-check identity. */
export async function faceVerificationLink(wallet) {
  const { publicClient, walletClient } = wallet.clients();
  const identitySDK = await IdentitySDK.init({ publicClient, walletClient, env: GD.env });
  const callback = `${window.location.origin}${window.location.pathname}?gdfv=1`;
  return identitySDK.generateFVLink(false, callback, GD.chainId);
}
```

`src/gd/ubi.js`:

```js
import { ClaimSDK, IdentitySDK } from '@goodsdks/citizen-sdk';
import { formatUnits } from 'viem';
import { GD } from './config.js';

export async function prepareUbi(wallet) {
  const { publicClient, walletClient } = wallet.clients();
  const identitySDK = await IdentitySDK.init({ publicClient, walletClient, env: GD.env });
  const claimSDK = new ClaimSDK({
    account: walletClient.account.address,
    publicClient,
    walletClient,
    identitySDK,
    rdu: window.location.href,
    env: GD.env,
  });
  return claimSDK;
}

export async function ubiStatus(claimSDK) {
  const ent = await claimSDK.checkEntitlement();
  const canClaim = ent.amount > 0n;
  const nextClaimAt = canClaim ? null : (await claimSDK.nextClaimTime()).getTime();
  return { entitlementG: formatUnits(ent.amount, 18), canClaim, nextClaimAt };
}

/** Claims on-chain, then asks the server to confirm the tx (grants today's Citizen's Blessing). */
export async function claimUbi({ claimSDK, api, token }) {
  const receipt = await claimSDK.claim();
  const hash = receipt.transactionHash;
  const confirm = await api('/ubi/confirm', { method: 'POST', token, body: { txHash: hash } });
  return { hash, confirm };
}
```

`src/gd/engagement.js`:

```js
import { DEV_REWARDS_CONTRACT, EngagementRewardsSDK, REWARDS_CONTRACT } from '@goodsdks/engagement-sdk';
import { GD } from './config.js';

/**
 * First-boss bounty: server attests the cleared boss run, the player signs the app registration
 * message and submits `nonContractAppClaim` (the third argument is `validUntilBlock`).
 */
export async function claimBounty({ wallet, api, token, runId }) {
  const att = await api('/engagement/attest', { method: 'POST', token, body: { runId } });
  const { walletClient, publicClient } = wallet.clients();
  const contract = GD.env === 'development' ? DEV_REWARDS_CONTRACT : REWARDS_CONTRACT;
  const sdk = new EngagementRewardsSDK(publicClient, walletClient, contract);
  const validUntilBlock = BigInt(att.validUntilBlock);
  const userSignature = await sdk.signClaim(att.app, att.inviter, validUntilBlock);
  let hash;
  const receipt = await sdk.nonContractAppClaim(att.app, att.inviter, validUntilBlock, userSignature, att.appSignature, (h) => { hash = h; });
  hash = hash ?? receipt.transactionHash;
  if (receipt.status !== 'success') throw new Error('tx_failed');
  await api('/engagement/confirm', { method: 'POST', token, body: { txHash: hash } }).catch(() => {});
  return { hash };
}
```

`src/gd/spoils.js`:

```js
import { parseAbi } from 'viem';

const vaultAbi = parseAbi([
  'function claim(address to, uint256 id, uint256 amount, uint64 deadline, bytes signature)',
]);

/** Redeem a server-signed voucher on MoonshardVault (the voucher pays `voucher.to`). */
export async function redeemSpoil({ wallet, api, token, vault, voucher }) {
  const { walletClient, publicClient } = wallet.clients();
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: vault,
    abi: vaultAbi,
    functionName: 'claim',
    args: [voucher.to, BigInt(voucher.id), BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('tx_failed');
  await api('/spoils/confirm', { method: 'POST', token, body: { txHash: hash } }).catch(() => {});
  return { hash };
}
```

- [ ] **Step 6: Implement `GdService`**

`src/engine/GdService.js`:

```js
import { apiFetch } from '../gd/api.js';
import { signIn } from '../gd/auth.js';
import { clearSession, getToken, loadSession } from '../gd/session.js';
import { createWalletManager, normalizeError } from '../gd/wallet.js';
import { GD } from '../gd/config.js';
import { detectHost, hostLanguage } from '../gd/host.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { setBlessed } from '../gd/blessing.js';
import { explainError, shortAddress } from '../gd/format.js';
import { storage } from './Storage.js';

async function loadWalletConnect() {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId: GD.reownProjectId,
    chains: [GD.chainId],
    showQrModal: true,
    metadata: { name: 'Moonshard', description: 'Moonshard: The High Forest', url: window.location.origin, icons: [] },
  });
  await provider.connect(); // opens the QR modal; resolves once paired
  return provider;
}

const wallet = createWalletManager({ getFallbackProvider: GD.reownProjectId ? loadWalletConnect : null });

class GdServiceManager {
  constructor() {
    this.listeners = new Set();
    this.host = detectHost();
    this.language = hostLanguage();
    this.claimSDK = null;
    this.s = {
      sessionAddress: null, status: 'anonymous', verified: false, offline: false, needsReconnect: false,
      busy: null, rewards: null, ubi: null, bounty: null, spoils: [], vault: null,
    };
    wallet.subscribe(() => this.notify());
    this.ready = this.init();
  }

  async init() {
    const session = loadSession();
    if (session) {
      this.s.sessionAddress = session.address;
      this.s.needsReconnect = !(await wallet.restore(session.address));
      try {
        await this.fetchIdentity(true);
        await this.refreshAll();
      } catch (err) {
        if (err?.status === 401) this.dropSession();
        else this.s.offline = true;
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gdfv')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('gdfv');
      window.history.replaceState({}, '', url);
    }
    this.notify();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.getStatus());
    return () => this.listeners.delete(fn);
  }

  notify() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } });
  }

  setBusy(label) {
    this.s.busy = label;
    this.notify();
  }

  getStatus() {
    const w = wallet.getState();
    const address = this.s.sessionAddress || w.address;
    const connected = Boolean(this.s.sessionAddress);
    return {
      connected,
      address,
      shortAddress: address ? shortAddress(address) : '',
      status: this.s.status,
      verified: this.s.verified,
      wrongChain: w.wrongChain,
      hasWallet: (typeof window !== 'undefined' && Boolean(window.ethereum)) || Boolean(GD.reownProjectId),
      needsReconnect: connected && this.s.needsReconnect,
      offline: this.s.offline,
      busy: this.s.busy,
      host: this.host,
      language: this.language,
      rewards: this.s.rewards,
      ubi: this.s.ubi,
      bounty: this.s.bounty,
      spoils: this.s.spoils,
      vault: this.s.vault,
      blessing: Boolean(this.s.rewards?.blessing),
    };
  }

  applyIdentity(me) {
    this.s.sessionAddress = me.address;
    this.s.status = me.status || (me.verified ? 'verified' : 'unverified');
    this.s.verified = Boolean(me.verified);
    this.s.offline = false;
    storage.setWalletAccount(me.address);
  }

  async fetchIdentity(force) {
    const token = getToken();
    let me;
    try {
      me = await apiFetch(force ? '/me/refresh' : '/me', { method: force ? 'POST' : 'GET', token, body: force ? {} : undefined });
    } catch (err) {
      if (err?.status !== 429) throw err;
      me = await apiFetch('/me', { token });
    }
    this.applyIdentity(me);
    return me;
  }

  dropSession() {
    clearSession();
    this.claimSDK = null;
    this.s = { ...this.s, sessionAddress: null, status: 'anonymous', verified: false, rewards: null, ubi: null, bounty: null, spoils: [], vault: null };
    setBlessed(false);
    storage.setWalletAccount(null);
  }

  async refreshAll({ force = false } = {}) {
    const token = getToken();
    if (!token) return;
    if (force) await this.fetchIdentity(true).catch(() => {});
    const rewards = await fetchRewardsStatus();
    this.s.rewards = rewards;
    setBlessed(rewards?.blessing);
    if (this.s.verified) {
      const [eng, spoils] = await Promise.all([
        apiFetch('/engagement/status', { token }).catch(() => null),
        apiFetch('/spoils', { token }).catch(() => null),
      ]);
      this.s.bounty = eng;
      this.s.spoils = spoils?.spoils ?? [];
      this.s.vault = spoils?.vault ?? null;
      await this.refreshUbi();
    } else {
      this.s.bounty = null;
      this.s.spoils = [];
      this.s.ubi = null;
    }
    this.notify();
  }

  async refreshUbi() {
    if (!wallet.getState().connected || wallet.getState().wrongChain) {
      this.s.ubi = null;
      return;
    }
    try {
      const { prepareUbi, ubiStatus } = await import('../gd/ubi.js');
      this.claimSDK = await prepareUbi(wallet);
      this.s.ubi = await ubiStatus(this.claimSDK);
    } catch (err) {
      console.warn('[gd] ubi status failed', err?.message);
      this.s.ubi = null;
    }
  }

  async run(label, fn) {
    this.setBusy(label);
    try {
      return { ok: true, ...(await fn()) };
    } catch (raw) {
      const err = normalizeError(raw);
      if (raw?.status === 401) this.dropSession();
      return { ok: false, error: err.message, message: explainError(raw?.status !== undefined ? raw : err) };
    } finally {
      this.setBusy(null);
    }
  }

  async ensureWallet() {
    const w = wallet.getState();
    if (!w.connected) {
      const c = await wallet.connect();
      if (!c.ok) throw new Error(c.reason);
    }
    if (wallet.getState().address !== this.s.sessionAddress) throw new Error('wallet_mismatch');
    this.s.needsReconnect = false;
  }

  connect() {
    return this.run('connect', async () => {
      const c = await wallet.connect();
      if (!c.ok) throw new Error(c.reason);
      const res = await signIn({ wallet, host: this.host });
      this.applyIdentity(res);
      this.s.needsReconnect = false;
      await this.refreshAll();
      return { address: res.address };
    });
  }

  disconnect() {
    wallet.disconnect();
    this.dropSession();
    this.notify();
  }

  switchToCelo() {
    return this.run('switch', async () => {
      const ok = await wallet.switchToCelo();
      if (!ok) throw new Error('wrong_chain');
      await this.refreshAll();
      return {};
    });
  }

  verifyHuman() {
    return this.run('verify', async () => {
      await this.ensureWallet();
      const { faceVerificationLink } = await import('../gd/identity.js');
      window.location.href = await faceVerificationLink(wallet);
      return {};
    });
  }

  claimUbi() {
    return this.run('ubi', async () => {
      await this.ensureWallet();
      const { claimUbi, prepareUbi } = await import('../gd/ubi.js');
      this.claimSDK = this.claimSDK || (await prepareUbi(wallet));
      const r = await claimUbi({ claimSDK: this.claimSDK, api: apiFetch, token: getToken() });
      await this.refreshAll();
      return r;
    });
  }

  claimBounty() {
    return this.run('bounty', async () => {
      const runId = this.s.bounty?.pendingRunId;
      if (!runId) throw new Error('boss_not_cleared');
      await this.ensureWallet();
      const { claimBounty } = await import('../gd/engagement.js');
      const r = await claimBounty({ wallet, api: apiFetch, token: getToken(), runId });
      await this.refreshAll();
      return r;
    });
  }

  redeem(spoilId) {
    return this.run('redeem', async () => {
      const spoil = this.s.spoils.find((x) => x.id === spoilId);
      if (!spoil?.voucher || !this.s.vault) throw new Error('not_claimable');
      await this.ensureWallet();
      const { redeemSpoil } = await import('../gd/spoils.js');
      const r = await redeemSpoil({ wallet, api: apiFetch, token: getToken(), vault: this.s.vault.address, voucher: spoil.voucher });
      await this.refreshAll();
      return r;
    });
  }
}

export const gdService = new GdServiceManager();
```

- [ ] **Step 7: Storage changes (blessing multiplier, rename Nimiq accessors)**

In `src/engine/Storage.js`:

1. Add `import { isBlessed } from '../gd/blessing.js';` under the existing import.
2. In `DEFAULT_STATE` rename `nimiqAccount: null,` → `walletAccount: null,`.
3. Replace `getNimiqAccount`/`setNimiqAccount` with:

```js
  getWalletAccount() {
    return this.data.walletAccount || null;
  }

  setWalletAccount(account) {
    this.data.walletAccount = account;
    this.save();
  }
```

4. Replace `addMaterials` with:

```js
  addMaterials({ bark = 0, amber = 0, iron = 0 }) {
    // Citizen's Blessing: +25% drops, with the fractional part carried so four single drops yield five.
    const mult = isBlessed() ? 1.25 : 1;
    const carry = (this.blessCarry ||= { bark: 0, amber: 0, iron: 0 });
    for (const [key, base] of Object.entries({ bark, amber, iron })) {
      const exact = base * mult + carry[key];
      const whole = Math.floor(exact + 1e-9);
      carry[key] = exact - whole;
      this.data.inventory[key] += whole;
    }
    this.save();
    return this.data.inventory;
  }
```

- [ ] **Step 8: Run to verify pass**

```bash
node --test "test/client/**/*.test.js"
```

Expected: all client tests PASS (format, identicon, api, wallet, auth, runs, storage).

- [ ] **Step 9: Commit**

```bash
git add src test && git commit -m "feat(client): run tracker, SDK wrappers (identity, UBI claim, engagement, vault), GdService, blessing multiplier"
```

---

### Task 10: G$ wallet panel, header button, play-first boot

**Files:**
- Create: `src/ui/GdPanel.js`
- Modify: `index.html`, `src/style.css`, `src/main.js`, `src/ui/TouchControls.js`, `src/scenes/MenuScene.js`

**Interfaces:**
- Consumes: `gdService` (Task 9), `identiconSvg`, `formatG`, `formatCountdown`, `explorerTx` (Task 8), `showToast` (`src/ui/toast.js`, ported).
- Produces: `window.__gdPanel` with `open()`, `close()`; header buttons `#btn-wallet` / `#btn-wallet-landscape` open it; Menu badge opens it; the game **always** boots without a wallet gate.

This task leaves `src/nimiq/*` and `NimiqService` in place (the other scenes still import them until Task 11); only entry points are switched.

- [ ] **Step 1: Rename the header markup (ids, classes, copy)**

```bash
cd /Users/ram/Desktop/moonshard
for f in index.html src/style.css src/ui/TouchControls.js; do
  sed -i '' \
    -e 's/landscape-nimiq-btn/landscape-wallet-btn/g' \
    -e 's/btn-nimiq-landscape/btn-wallet-landscape/g' \
    -e 's/btn-nimiq/btn-wallet/g' \
    -e 's/nimiq-btn-text-landscape/wallet-btn-text-landscape/g' \
    -e 's/nimiq-btn-text/wallet-btn-text/g' \
    -e 's/nimiq-dot-landscape/wallet-dot-landscape/g' \
    -e 's/nimiq-dot/wallet-dot/g' \
    -e 's/nimiq-bolt/wallet-bolt/g' \
    -e "s/#nimiq-modal-body/#gd-panel/g" \
    "$f"
done
```

In `index.html` also: set `<title>` to `Moonshard: The High Forest | G$ on Celo`; change the two `NIMIQ` button labels (`<span id="wallet-btn-text">` and `...-landscape`) to `G$`; change both `title="Nimiq Wallet"` to `title="G$ Wallet"` and `aria-label="Nimiq Wallet"` to `aria-label="G$ Wallet"`; change loader tip `NIMIQ RETRO ARCADE • PREPARING REALM` to `G$ ARCADE • PREPARING REALM`; change `⚡ Syncing Nimiq cryptographic signatures...` to `⚡ Syncing with the Celo network...`.

- [ ] **Step 2: Write `GdPanel`**

`src/ui/GdPanel.js`:

```js
import { gdService } from '../engine/GdService.js';
import { explorerTx } from '../gd/config.js';
import { formatCountdown, formatG } from '../gd/format.js';
import { identiconSvg } from '../gd/identicon.js';
import { showToast } from './toast.js';

const LABELS = {
  anonymous: 'NOT CONNECTED',
  unverified: 'NOT VERIFIED',
  verified: 'VERIFIED HUMAN',
  expired: 'VERIFICATION EXPIRED',
};

const DONE = {
  connect: '⚡ Wallet connected',
  reconnect: '⚡ Wallet reconnected',
  ubi: "💚 G$ claimed — Citizen's Blessing active!",
  bounty: '🌟 Bounty claimed!',
  redeem: '🏆 Spoils redeemed!',
};

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const button = (act, label, { disabled = false, id = '', cls = '' } = {}) =>
  `<button type="button" class="pixel-modal-btn gd-btn ${cls}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;

const section = (title, inner) => `<section class="gd-sec"><h4>${title}</h4>${inner}</section>`;

export class GdPanel {
  constructor() {
    this.el = null;
  }

  mount() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.id = 'gd-panel';
    this.el.className = 'modal-overlay hidden';
    this.el.innerHTML = `
      <div class="modal-card gd-card" role="dialog" aria-modal="true" aria-label="G$ wallet">
        <div class="modal-header">
          <h3>G$ WALLET</h3>
          <button id="gd-close" class="pixel-close-btn" type="button" aria-label="Close">✖</button>
        </div>
        <div id="gd-body" class="modal-body gd-body"></div>
      </div>`;
    document.body.appendChild(this.el);
    this.el.querySelector('#gd-close').addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('click', (e) => this.onClick(e));
    gdService.subscribe(() => this.render());
  }

  open() {
    this.mount();
    this.el.classList.remove('hidden');
    this.render();
    gdService.refreshAll().catch(() => {});
  }

  close() {
    this.el?.classList.add('hidden');
  }

  render() {
    if (!this.el) return;
    const s = gdService.getStatus();
    const busy = Boolean(s.busy);
    const txDisabled = busy || s.wrongChain || s.needsReconnect;
    const out = [];

    out.push(`<div class="gd-status gd-st-${s.status}">
      ${s.connected ? `<span class="gd-avatar">${identiconSvg(s.address)}</span>` : '<span class="gd-dot"></span>'}
      <div class="gd-status-text"><b>${LABELS[s.status] || LABELS.anonymous}</b>${
        s.connected ? `<small>${esc(s.shortAddress)}${s.host !== 'browser' ? ` • ${esc(s.host.toUpperCase())}` : ''}</small>` : ''
      }</div></div>`);

    if (busy) out.push(`<p class="gd-muted">Working… confirm in your wallet if asked.</p>`);

    if (!s.connected) {
      out.push(`<p class="gd-muted">You can play everything without a wallet. Connect a Celo wallet to join the ranked board, claim your daily G$ and earn Spoils.</p>`);
      out.push(button('connect', 'CONNECT WALLET', { disabled: busy }));
      if (!s.hasWallet) {
        out.push(`<p class="gd-warn">No wallet detected. Open Moonshard inside <b>MiniPay</b> or a Celo-compatible wallet browser.</p>`);
      }
    } else {
      if (s.offline) out.push(`<p class="gd-warn">Server unreachable. You can still play; rewards resume when it is back.</p>`);
      if (s.needsReconnect) {
        out.push(`<p class="gd-warn">Reconnect your wallet to claim rewards.</p>`);
        out.push(button('reconnect', 'RECONNECT WALLET', { disabled: busy }));
      }
      if (s.wrongChain) {
        out.push(`<p class="gd-warn">Your wallet is not on the Celo network.</p>`);
        out.push(button('switch', 'SWITCH TO CELO', { disabled: busy }));
      }

      if (s.status !== 'verified') {
        const copy = s.status === 'expired'
          ? 'Your GoodDollar verification has expired. Re-verify to keep earning.'
          : 'Moonshard rewards one human, one slot. GoodDollar\'s quick face scan proves you are a real person. Moonshard never sees your face.';
        out.push(section('PROVE YOU\'RE HUMAN', `<p>${copy}</p>${button('verify', 'VERIFY (FACE SCAN)', { disabled: txDisabled })}${button('recheck', 'I\'M DONE — CHECK AGAIN', { disabled: busy, cls: 'gd-ghost' })}`));
      } else {
        out.push(section('DAILY G$', this.dailyHtml(s, txDisabled)));
        out.push(section('FIRST-BOSS BOUNTY', this.bountyHtml(s, txDisabled)));
        out.push(section('SPOILS', this.spoilsHtml(s, txDisabled)));
      }
      out.push(button('disconnect', 'DISCONNECT', { disabled: busy, cls: 'gd-ghost' }));
    }

    out.push('<a class="gd-link" href="/stats.html" target="_blank" rel="noopener">PUBLIC STATS ▸</a>');
    this.el.querySelector('#gd-body').innerHTML = out.join('');
  }

  dailyHtml(s, txDisabled) {
    const ubi = s.ubi;
    let html;
    if (!ubi) html = '<p class="gd-muted">UBI status unavailable right now.</p>';
    else if (ubi.canClaim) html = `<p>Your daily G$ is ready: <b>${formatG(ubi.entitlementG, 2)} G$</b></p>${button('ubi', 'CLAIM DAILY G$', { disabled: txDisabled })}`;
    else html = `<p>Claimed today. Next claim in <b>${formatCountdown((ubi.nextClaimAt || 0) - Date.now())}</b></p>`;
    html += s.blessing
      ? '<p class="gd-blessing">✨ CITIZEN\'S BLESSING ACTIVE — +25% Forge materials today</p>'
      : '<p class="gd-muted">Claim your daily G$ to receive the Citizen\'s Blessing (+25% Forge materials).</p>';
    const c = s.rewards?.crystalStatus;
    if (c) html += `<p class="gd-muted">Shards today: ${formatG(c.gdEarned)} / ${formatG(c.dailyCapGd)} G$ (paid after UTC midnight)</p>`;
    return html;
  }

  bountyHtml(s, txDisabled) {
    const b = s.bounty;
    if (!b || !b.configured) return '<p class="gd-muted">Boss bounty is coming soon.</p>';
    if (b.claimedHere) return '<p class="gd-blessing">✔ First-boss bounty claimed.</p>';
    if (b.pendingRunId) {
      if (b.canClaim === false) return `<p class="gd-warn">${esc(b.reason || 'Not claimable right now.')}</p>`;
      return `<p>Boss defeated! Claim your one-time reward.</p>${button('bounty', `CLAIM ${formatG(b.rewardG)} G$ BOUNTY`, { disabled: txDisabled })}`;
    }
    return `<p class="gd-muted">Defeat a chapter boss in Story Mode to unlock a one-time bounty of ${formatG(b.rewardG)} G$.</p>`;
  }

  spoilsHtml(s, txDisabled) {
    if (!s.spoils.length) {
      return '<p class="gd-muted">No Spoils yet. Reach the top 3 of the verified daily board or collect Shards. Settled after UTC midnight.</p>';
    }
    return s.spoils.map((sp) => {
      const label = sp.kind === 'TRIAL_PRIZE' ? `DAILY PRIZE #${sp.rank}` : 'SHARD HARVEST';
      let action = '';
      if (sp.claimed) action = '<span class="gd-blessing">✔ CLAIMED</span>';
      else if (sp.voucher) action = button('redeem', 'REDEEM', { id: sp.id, disabled: txDisabled });
      else action = '<span class="gd-muted">unavailable</span>';
      return `<div class="gd-spoil"><span>${label}<small>${esc(sp.day)} • ${formatG(sp.amountG)} G$</small></span>${action}</div>`;
    }).join('');
  }

  async onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    const actions = {
      connect: () => gdService.connect(),
      reconnect: () => gdService.connect(),
      disconnect: async () => { gdService.disconnect(); return { ok: true }; },
      switch: () => gdService.switchToCelo(),
      verify: () => gdService.verifyHuman(),
      recheck: async () => { await gdService.refreshAll({ force: true }); return { ok: true }; },
      ubi: () => gdService.claimUbi(),
      bounty: () => gdService.claimBounty(),
      redeem: () => gdService.redeem(el.dataset.id),
    };
    const res = await actions[act]?.();
    if (!res) return;
    if (!res.ok) {
      showToast(res.message || 'Something went wrong.', { type: 'error' });
      return;
    }
    if (DONE[act]) showToast(res.hash ? `${DONE[act]}  ${explorerTx(res.hash).replace('https://', '')}` : DONE[act]);
  }
}
```

- [ ] **Step 3: Panel styles**

Append to `src/style.css` (then open the panel in a browser and tune spacing against the existing `.modal-card` look; the palette below matches the rest of the game):

```css
/* ---- G$ wallet panel ---- */
.gd-card { width: calc(100% - 24px); max-width: 430px; max-height: calc(100% - 24px); display: flex; flex-direction: column; }
.gd-body { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; font-family: 'Press Start 2P', monospace; font-size: 8px; line-height: 1.7; color: #cfe8cf; padding-bottom: env(safe-area-inset-bottom, 0); }
.gd-body p { margin: 0; }
.gd-status { display: flex; align-items: center; gap: 10px; padding: 8px; border: 2px solid #2e4e2e; background: #0e170e; }
.gd-st-verified { border-color: #98ff20; }
.gd-st-unverified, .gd-st-expired { border-color: #e9b213; }
.gd-avatar { width: 28px; height: 28px; flex: none; image-rendering: pixelated; }
.gd-avatar svg { width: 100%; height: 100%; display: block; }
.gd-dot { width: 10px; height: 10px; flex: none; background: #6b7b6b; }
.gd-status-text { display: flex; flex-direction: column; gap: 3px; }
.gd-status-text small { color: #8cb38c; font-size: 7px; }
.gd-sec { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid #2e4e2e; background: #111e11; }
.gd-sec h4 { margin: 0; color: #ffd166; font-size: 8px; letter-spacing: 1px; }
.gd-muted { color: #8cb38c; }
.gd-warn { color: #f59e0b; }
.gd-blessing { color: #98ff20; }
.gd-btn { width: 100%; }
.gd-btn[disabled] { opacity: .45; pointer-events: none; }
.gd-ghost { opacity: .75; }
.gd-spoil { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gd-spoil small { display: block; color: #8cb38c; font-size: 7px; }
.gd-spoil .gd-btn { width: auto; }
.gd-link { color: #38e1ff; text-align: center; text-decoration: none; padding: 4px 0; }
```

- [ ] **Step 4: Switch `main.js` to the play-first boot**

In `src/main.js`: remove the three imports `nimiqService`, `ConnectGate`, `getAddress`, and `setupImmersiveLayout`'s old path; add:

```js
import { gdService } from './engine/GdService.js';
import { GdPanel } from './ui/GdPanel.js';
import { setupImmersiveLayout } from './nimiq/immersive.js'; // moved in Task 11
```

(keep the immersive import pointing at the current path for now). In `startGame()` replace `window.nimiqService = nimiqService;` with `window.gdService = gdService;`, and replace the log line with `console.log('🌲 Moonshard: The High Forest initialized successfully!');`. Replace everything from the comment `// Nimiq Pay host language` to the end of the file with:

```js
// Host language, applied to the document for correct copy/layout.
document.documentElement.lang = gdService.getStatus().language || 'en';

// Keep the canvas inside the visible area of embedded webviews (wallet header + system bars).
setupImmersiveLayout();

// The wallet panel is available from the first frame; connecting is always optional.
window.__gdPanel = new GdPanel();
window.__gdPanel.mount();

startGame();
```

- [ ] **Step 5: TouchControls header buttons**

In `src/ui/TouchControls.js`: change the import on line 3 to `import { gdService } from '../engine/GdService.js';`, change the call `this.initNimiqIntegration();` to `this.initWalletButton();`, and replace the whole `initNimiqIntegration()` method with:

```js
  initWalletButton() {
    const btn = document.getElementById('btn-wallet');
    const txt = document.getElementById('wallet-btn-text');
    const dot = document.getElementById('wallet-dot');
    const btnLand = document.getElementById('btn-wallet-landscape');
    const txtLand = document.getElementById('wallet-btn-text-landscape');
    const dotLand = document.getElementById('wallet-dot-landscape');

    const open = () => window.__gdPanel?.open();
    if (btn) btn.addEventListener('click', open);
    if (btnLand) btnLand.addEventListener('click', open);

    gdService.subscribe((status) => {
      const paint = (label, indicator) => {
        if (!label || !indicator) return;
        indicator.classList.toggle('online', status.verified);
        indicator.classList.toggle('offline', !status.verified);
        label.textContent = status.connected ? (status.verified ? 'G$ ✔' : status.shortAddress || 'G$') : 'G$';
      };
      paint(txt, dot);
      paint(txtLand, dotLand);
    });
  }
```

- [ ] **Step 6: Menu badge opens the panel and reflects state**

In `src/scenes/MenuScene.js`: change line 5 to `import { gdService } from '../engine/GdService.js';` and replace the block from `// Connection status badge` through the `badge.on('pointerdown', ...)` handler with:

```js
    // Wallet status badge: tap to open the G$ wallet panel
    const badgeText = (st) => {
      if (!st.connected) return '⚡ TAP TO CONNECT • EARN G$';
      if (st.status === 'verified') return st.ubi?.canClaim ? '💚 DAILY G$ READY — TAP TO CLAIM' : `✔ VERIFIED • ${st.shortAddress}`;
      if (st.status === 'expired') return '🛡 RE-VERIFY TO KEEP EARNING G$';
      return `🛡 ${st.shortAddress} • VERIFY TO EARN G$`;
    };
    const badge = this.add.text(w / 2, titleY + (isTall ? 14 : 12), badgeText(gdService.getStatus()), {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '5.5px' : '4.5px',
      color: '#a0c4a0',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(11);
    badge.setInteractive({ useHandCursor: true });
    badge.on('pointerdown', () => window.__gdPanel?.open());
    const stopWatching = gdService.subscribe((st) => { if (badge.active) badge.setText(badgeText(st)); });
    this.events.once('shutdown', stopWatching);
```

- [ ] **Step 7: Build and look at it**

```bash
npm run build
npm run dev:all    # API on :3001 (in-memory db; set JWT_SECRET in server/.env), web on :5173
```

Open `http://localhost:5173/`. Expected: the game boots straight to the menu (no wallet gate); the header shows a `G$` button; tapping it or the menu badge opens the panel in the "NOT CONNECTED" state; without a wallet extension the "No wallet detected" hint appears. Take a screenshot of the Menu and of the open panel (desktop and a 390×844 portrait viewport) and fix any layout problems before committing.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(ui): G$ wallet panel, header wallet button, play-first boot (no connect gate)"
```

---

### Task 11: Wire the scenes to runs/rewards, then remove Nimiq entirely

**Files:**
- Modify: `src/scenes/SurvivalScene.js`, `src/scenes/StoryScene.js`, `src/scenes/LeaderboardScene.js`, `src/entities/ShardDrop.js`, `src/engine/ViewportManager.js`, `src/main.js`
- Move: `src/nimiq/immersive.js` → `src/engine/ImmersiveLayout.js`
- Delete: `src/nimiq/`, `src/engine/NimiqService.js`, `src/ui/ConnectGate.js`, `.connect-gate` / `.gate-*` CSS, `@nimiq/*` dependencies

**Interfaces:**
- Consumes: `runs`, `fetchRewardsStatus`, `SHARD_RATE_GD`, `DAILY_SHARD_CAP_GD`, `gdService`, `fetchDailyBoard|fetchAllTimeBoard|fetchConfig|getBoardView|setBoardView`, `identiconDataUrl`, `getAddress` (Tasks 8–9).
- These are the **only** edits allowed in the large scene files. Names below are the post-rename-sweep names (`shardDrops`, `onShardCollected`, `ShardDrop`); match by content if a line number drifted.

Anchors use the Luna Blade source: SurvivalScene lines ~24-29, 83-88, 863-900, 1028, 1076-1100, 1270-1360; StoryScene lines ~38-39, 175-181, 2243-2290, 2522-2570, 2928-2967, 3055-3072, 3247-3292.

- [ ] **Step 1: SurvivalScene — imports and run lifecycle**

Replace the three Nimiq imports (`nimiqService`, `bankCrystalHarvest, fetchRewardsStatus`, `getAddress`) with:

```js
import { gdService } from '../engine/GdService.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { runs } from '../gd/runs.js';
import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';
```

In `create()`, directly after `this.rewardsStatus = null;` add:

```js
    runs.start({ mode: 'TRIAL' });
    this.events.once('shutdown', () => runs.stop());
```

At the top of `update()`, directly after `if (this.isGameOver) return;` add:

```js
    runs.update({ score: this.totalScore, kills: this.killCount.total, shards: this.sessionCrystalsCollected || 0 });
```

- [ ] **Step 2: SurvivalScene — harvest HUD in G$**

Replace the initial HUD text `'💎 +0.000 NIM'` with `'💎 +0 G$'`. Replace `checkDailyHarvestCap()` and `updateCrystalHarvestHud()` with:

```js
  checkDailyHarvestCap() {
    const st = this.rewardsStatus?.crystalStatus;
    const earned = Number(st?.gdEarned || 0);
    const cap = Number(st?.dailyCapGd ?? DAILY_SHARD_CAP_GD);
    const sessionEarned = (this.sessionCrystalsCollected || 0) * SHARD_RATE_GD;
    this.isDailyHarvestCapped = earned + sessionEarned >= cap || Boolean(st?.isCapped);
    this.updateCrystalHarvestHud();
  }

  updateCrystalHarvestHud() {
    if (!this.txtHarvest) return;
    const st = this.rewardsStatus?.crystalStatus;
    const cap = Number(st?.dailyCapGd ?? DAILY_SHARD_CAP_GD);
    const sessionEarned = (this.sessionCrystalsCollected || 0) * SHARD_RATE_GD;
    if (Number(st?.gdEarned || 0) + sessionEarned >= cap || st?.isCapped) {
      this.txtHarvest.setText(`💎 ${cap} G$ (MAX 🔒)`);
      this.txtHarvest.setColor('#f59e0b');
    } else {
      this.txtHarvest.setText(`💎 +${sessionEarned} G$`);
      this.txtHarvest.setColor('#ffd700');
    }
  }
```

In `onShardCollected` replace the floating text `'DAILY NIM CAP REACHED (0.1 MAX)! 🔒'` with `` `DAILY SHARD CAP REACHED (${DAILY_SHARD_CAP_GD} G$)! 🔒` ``. Change the comment `Luna Crystal Drop (0.001 NIM each)` to `Shard drop (2 G$ each, paid after UTC midnight)`.

- [ ] **Step 3: SurvivalScene — submit the run**

Replace `submitRunProof(runData)` entirely with:

```js
  async submitRunProof(runData) {
    const proof = {
      verified: false,
      signature: `RUN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 8999 + 1000)}`,
      offline: false,
      notConnected: false,
    };

    const status = gdService.getStatus();
    if (!status.connected) {
      proof.notConnected = true;
      proof.label = 'Not Ranked — Connect Wallet to Compete';
      runs.stop();
    } else {
      try {
        const res = await Promise.race([
          runs.finish({
            score: runData.score,
            kills: runData.kills,
            shards: this.sessionCrystalsCollected || 0,
            durationMs: runData.duration * 1000,
          }),
          new Promise((resolve) => setTimeout(() => resolve({ ticketed: true, error: 'timeout', status: 0 }), 9000)),
        ]);
        if (!res.ticketed) {
          proof.offline = true;
          proof.label = 'Run Not Recorded (Offline)';
        } else if (res.error) {
          proof.offline = res.status === 0;
          proof.label = proof.offline ? 'Run Not Recorded (Offline)' : `Run Not Recorded — ${res.error}`;
        } else if (res.rankedOk) {
          proof.verified = true;
          proof.rank = res.rank?.ranked;
          proof.isNewBest = res.isNewBest;
          proof.label = `Ranked — #${res.rank?.ranked}${res.isNewBest ? ' (New Best)' : ''}`;
        } else {
          proof.rank = res.rank?.open;
          proof.label = status.verified
            ? `Open Board #${res.rank?.open ?? '-'} — run not ranked`
            : `Open Board #${res.rank?.open ?? '-'} — verify to compete for G$`;
        }
      } catch (err) {
        proof.offline = true;
        proof.label = 'Run Not Recorded (Offline)';
      }
    }

    // Save locally either way; keep the server result for review.
    storage.recordDailyTrial(this.dayKey, runData.score, {
      ...runData,
      proofId: proof.signature,
      verified: proof.verified,
      rank: proof.rank || null,
      status: proof.label,
    });

    return proof;
  }
```

(`storage.recordDailyTrial(...)` keeps the exact arguments of the original; open the original block and copy its call if it differs.) In `showGameOverModal`, replace the `crystalLine` block with:

```js
    const st = gdService.getStatus();
    let crystalLine = '';
    if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
      crystalLine = `🔒 Daily Shard Cap Reached (${DAILY_SHARD_CAP_GD} G$ Max) • Resets 00:00 UTC`;
    } else if (this.sessionCrystalsCollected > 0 && st.verified) {
      crystalLine = `💎 Shard Harvest: +${this.sessionCrystalsCollected * SHARD_RATE_GD} G$ pending (${this.sessionCrystalsCollected} Shards)`;
    } else if (this.sessionCrystalsCollected > 0) {
      crystalLine = '🛡 Verify you are human to bank your Shards as G$';
    } else if (st.verified) {
      crystalLine = '💎 Shard Harvest: 0 Shards';
    } else {
      crystalLine = '⚡ Connect & verify to bank Shards as G$';
    }
```

- [ ] **Step 4: StoryScene — imports, lifecycle, HUD**

Replace the two Nimiq imports (`claimFirstStoryBossReward, bankCrystalHarvest, fetchRewardsStatus` and `getAddress`) with:

```js
import { gdService } from '../engine/GdService.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { runs } from '../gd/runs.js';
import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';
```

In `create()`, replace `this.firstBossClaimResult = null;` with `this.runResult = null;` and directly after the `fetchRewardsStatus().then(...)` block add:

```js
    runs.start({ mode: 'STORY', chapter: this.chapterId });
    this.events.once('shutdown', () => runs.stop());
```

At the very top of `update()` (before the `inDialogue` guard) add:

```js
    runs.update({ score: 0, kills: this.killsCount, shards: this.sessionCrystalsCollected || 0 });
```

Replace the initial HUD text `'💎 +0.000 NIM'` with `'💎 +0 G$'` and its comment with `// Shard Harvest Counter (2 G$ per shard)`. Replace `checkDailyHarvestCap()` and `updateHudHarvest()` with the same logic as Survival Step 2, but keeping the method names `checkDailyHarvestCap` / `updateHudHarvest` (the second calls `this.txtHarvest.setText(...)` identically). Replace the floating text `'DAILY NIM CAP REACHED (0.1 MAX)! 🔒'` as in Step 2. Fix the two drop comments the same way.

- [ ] **Step 5: StoryScene — settle the boss clear**

Replace the whole block starting at `// Settle NIM rewards (First Boss Bounty + Daily Luna Crystals)` through the closing brace of `if (getAddress()) { ... }` with:

```js
    // Settle the run with the server. The first-boss bounty itself is claimed from the G$ wallet panel.
    const runDurationMs = performance.now() - (this.levelStartTime || performance.now());
    this.runResultPromise = runs.finish({
      score: 0,
      kills: this.killsCount,
      shards: this.sessionCrystalsCollected || 0,
      durationMs: runDurationMs,
      bossCleared: true,
    }).then((res) => {
      this.runResult = res;
      gdService.refreshAll().catch(() => {});
      return res;
    });
```

Add this method to the class (next to `showVictoryBanner`):

```js
  bountyBadge() {
    const st = gdService.getStatus();
    const bountyG = this.rewardsStatus?.firstBossPrizeG ?? 5000;
    if (!st.connected) return { text: `⚡ CONNECT A WALLET TO CLAIM THE ${bountyG} G$ BOSS BOUNTY`, color: '#8cb38c' };
    if (!st.verified) return { text: '🛡 VERIFY YOU ARE HUMAN TO CLAIM THE BOSS BOUNTY', color: '#f59e0b' };
    if (this.rewardsStatus?.firstBossClaimed) return { text: '✔ FIRST-BOSS BOUNTY ALREADY CLAIMED', color: '#a0c4a0' };
    if (this.runResult?.bossCleared) return { text: `🌟 BOSS SLAIN! CLAIM ${bountyG} G$ IN THE G$ WALLET (HEADER)`, color: '#ffd700' };
    if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
      return { text: `🔒 DAILY SHARD CAP REACHED (${DAILY_SHARD_CAP_GD} G$) • RESETS 00:00 UTC`, color: '#f59e0b' };
    }
    if (this.sessionCrystalsCollected > 0) return { text: `💎 SHARD HARVEST: +${this.sessionCrystalsCollected * SHARD_RATE_GD} G$ PENDING`, color: '#38e1ff' };
    return { text: '💎 SHARD HARVEST BANKED', color: '#a0c4a0' };
  }
```

In `showVictoryBanner`, replace the `// NIM Rewards Status Pill` block (from `let rewardText = ''` through the `rewardBadge` creation) with:

```js
    const initial = this.bountyBadge();
    const rewardBadge = this.add.text(0, -boxHeight / 2 + 54, initial.text, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: initial.color,
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);
    banner.add(rewardBadge);
    this.runResultPromise?.then(() => {
      if (!rewardBadge.active) return;
      const next = this.bountyBadge();
      rewardBadge.setText(next.text);
      rewardBadge.setColor(next.color);
    });
```

- [ ] **Step 6: StoryScene — game over**

In `handlePlayerGameOver`, replace the `if (this.sessionCrystalsCollected > 0 && getAddress()) { ... bankCrystalHarvest(...) ... }` block with:

```js
    const runDurationMs = performance.now() - (this.levelStartTime || performance.now());
    runs.finish({
      score: 0,
      kills: this.killsCount,
      shards: this.sessionCrystalsCollected || 0,
      durationMs: runDurationMs,
      bossCleared: false,
    }).then(() => gdService.refreshAll().catch(() => {}));
```

Replace the `crystalBonus` block with:

```js
    let crystalBonus = '';
    if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
      crystalBonus = ` • 🔒 Daily Shard Cap (${DAILY_SHARD_CAP_GD} G$)`;
    } else if (this.sessionCrystalsCollected > 0) {
      crystalBonus = ` • 💎 +${this.sessionCrystalsCollected * SHARD_RATE_GD} G$ Pending`;
    }
```

- [ ] **Step 7: ShardDrop label**

In `src/entities/ShardDrop.js` add `import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';` and replace the float label lines with:

```js
    const floatLabel = isCapped ? `DAILY CAP (${DAILY_SHARD_CAP_GD} G$) 🔒` : `+${SHARD_RATE_GD} G$ 💎`;
```

- [ ] **Step 8: LeaderboardScene**

Replace the five imports at lines ~4-9 with:

```js
import { gdService } from '../engine/GdService.js';
import { fetchDailyBoard, fetchAllTimeBoard, fetchConfig, getBoardView, setBoardView } from '../gd/leaderboard.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { identiconDataUrl } from '../gd/identicon.js';
import { getAddress } from '../gd/session.js';
```

In `create()`'s `Promise.all`, remove `fetchPayoutStatus()` (and the `payout` variable and `this.payout = payout;`). Then edit:
- The prize banner: replace the `prizes`/`pool`/text lines with
  ```js
      const prizes = Array.isArray(this.cfg.prizesG) ? this.cfg.prizesG : ['1000', '600', '300'];
      this.addToLayer(w / 2, 48, `🏆 DAILY PRIZES: 1st ${prizes[0]} | 2nd ${prizes[1]} | 3rd ${prizes[2]} G$ • verified humans only`, '4.8px', '#ffd166', 2);
  ```
- `prize: prizeLabel(i, isDaily ? board.prizeNim?.[i] : null)` → `prize: prizeLabel(i, isDaily && getBoardView() === 'ranked' ? board.prizesG?.[i] : null)`.
- `prizeLabel`: `` `${medal} ${nim} NIM` `` → `` `${medal} ${nim} G$` ``.
- Comment `// Nimiq Identicon avatar thumbnail` → `// Identicon avatar thumbnail`.
- `renderPlayerStatus`: replace the body's `status`/`line` logic with
  ```js
    const status = gdService.getStatus();
    let line;
    if (!myWallet) {
      line = '⚡ Not connected — tap to connect a wallet and join the board.';
    } else if (!status.verified) {
      line = `🛡 ${status.shortAddress} — verify you are human to compete for G$ prizes (tap).`;
    } else {
      const myRow = (isDaily ? this.daily : this.alltime)?.entries?.find((e) => e.wallet === myWallet);
      line = myRow
        ? `✔ ${status.shortAddress} — you're rank #${myRow.rank}${myRow.rank <= 3 ? ' 🏆' : ''}`
        : `✔ ${status.shortAddress} — verified. Play a Trial to claim a spot.`;
    }
  ```
  and the pointerdown handler → `lineObj.on('pointerdown', () => window.__gdPanel?.open());`. In the rewards pill replace the texts with:
  ```js
      const bossText = this.rewardsStatus.firstBossClaimed ? `CLAIMED (+${this.rewardsStatus.firstBossPrizeG} G$)` : `UNCLAIMED (${this.rewardsStatus.firstBossPrizeG} G$)`;
      const cap = Number(this.rewardsStatus.crystalStatus?.dailyCapGd ?? 100);
      const earned = Number(this.rewardsStatus.crystalStatus?.gdEarned || 0).toFixed(0);
      const isCapped = Boolean(this.rewardsStatus.crystalStatus?.isCapped);
      const harvestText = isCapped ? `${earned} / ${cap.toFixed(0)} G$ (MAX 🔒)` : `${earned} / ${cap.toFixed(0)} G$`;
  ```
- `renderSpoilsStatus`/`toggleSpoilsPanel`: delete uses of `this.payout`; replace the panel `detail` string with
  ```js
    const detail = 'Top-3 verified daily runs win 1000/600/300 G$ at UTC midnight.\n'
      + 'Shards you collect are paid as G$ too (up to 100 G$/day).\n'
      + 'Open the G$ wallet in the header to redeem your Spoils.';
  ```
  and the title text `'DAILY SPOILS SETTLEMENT'` stays. Remove any code that read `counts`/`signerConfigured`.
- Add the view toggle at the end of `buildTabs()`:
  ```js
    const toggle = this.add.text(GAME_CONFIG.WIDTH - 14, 26, getBoardView() === 'ranked' ? 'VIEW: VERIFIED ▸' : 'VIEW: OPEN ▸', {
      fontFamily: 'Press Start 2P', fontSize: '4.5px', color: '#38e1ff',
    }).setOrigin(1, 0.5).setDepth(30).setInteractive({ useHandCursor: true });
    toggle.on('pointerdown', () => {
      setBoardView(getBoardView() === 'ranked' ? 'open' : 'ranked');
      this.scene.restart();
    });
  ```

- [ ] **Step 9: Move the immersive helper, delete Nimiq, drop deps**

```bash
git mv src/nimiq/immersive.js src/engine/ImmersiveLayout.js
sed -i '' "s#'./nimiq/immersive.js'#'./engine/ImmersiveLayout.js'#" src/main.js
sed -i '' 's/Nimiq Pay mini app/wallet mini apps (MiniPay and similar)/; s/Nimiq app header/wallet app header/' src/engine/ImmersiveLayout.js
sed -i '' 's/Nimiq Pay mini-app/wallet mini-app/' src/engine/ViewportManager.js
git rm -r -q src/nimiq src/engine/NimiqService.js src/ui/ConnectGate.js
npm uninstall @nimiq/hub-api @nimiq/identicons @nimiq/mini-app-sdk
```

In `src/style.css` delete every rule block whose selector starts with `.connect-gate` or `.gate-` (search `gate-`; keep everything else). Check `src/engine/ImmersiveLayout.js` for imports from `./host.js`/Nimiq files: `grep -n "import" src/engine/ImmersiveLayout.js` — if it imported anything from the deleted folder, replace with `detectHost` from `../gd/host.js`.

- [ ] **Step 10: Verify nothing Nimiq-flavoured is left, then build and test**

```bash
grep -rnE "Nimiq|nimiq|\bNIM\b|__lunaGate|dailyCapNim|nimEarned|firstBossClaimResult|valueNim" src index.html && echo "LEFTOVERS ABOVE" || echo "clean"
npm run build
npm test
```

Expected: `clean`; build succeeds; all client and server tests pass. (The Forge scene's internal tab key `'nim'`/`tabNim` is a lowercase identifier and is fine. `0.001` is deliberately not in the pattern: `Audio.js` uses it as a gain floor.)

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: wire Survival/Story/Leaderboard to ticketed runs and G$ rewards; remove Nimiq code and deps"
```

---

### Task 12: Public stats page

**Files:**
- Create: `stats.html`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: `GET /api/stats` (Task 7).
- Produces: `/stats.html` — standalone page (own CSS/JS, no Phaser) listing verified players, UBI claims through the game, bounties claimed, Spoils issued/paid, runs and active players, with a 7-day chart. Linked from the wallet panel.

- [ ] **Step 1: Multi-page build**

In `vite.config.js` add inside `build`:

```js
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        stats: new URL('./stats.html', import.meta.url).pathname,
      },
    },
```

- [ ] **Step 2: Write the page**

Create `stats.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="api-base" content="%VITE_API_URL%" />
  <title>Moonshard — Live Stats</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b130b; --panel: #111e11; --line: #2e4e2e; --ink: #cfe8cf; --muted: #8cb38c;
      --gold: #ffd166; --lime: #98ff20; --cyan: #38e1ff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'Press Start 2P', monospace; font-size: 10px; line-height: 1.8; }
    main { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 16px; color: var(--gold); margin: 0 0 4px; }
    .sub { color: var(--muted); margin: 0 0 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .tile { background: var(--panel); border: 2px solid var(--line); padding: 12px; }
    .tile b { display: block; font-size: 20px; color: var(--lime); margin-top: 6px; word-break: break-all; }
    .tile span { color: var(--muted); font-size: 8px; }
    .chart { margin-top: 20px; background: var(--panel); border: 2px solid var(--line); padding: 12px; }
    .chart h2 { font-size: 10px; margin: 0 0 8px; color: var(--gold); }
    .legend { display: flex; gap: 14px; font-size: 8px; color: var(--muted); margin-bottom: 8px; }
    .legend i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; }
    svg { width: 100%; height: auto; display: block; }
    footer { margin-top: 20px; color: var(--muted); font-size: 8px; }
    a { color: var(--cyan); }
    #err { color: #f59e0b; }
  </style>
</head>
<body>
  <main>
    <h1>MOONSHARD LIVE STATS</h1>
    <p class="sub">G$ adoption through the game. Refreshes every 60 s.</p>
    <p id="err" hidden>Stats are unavailable right now.</p>
    <div class="grid" id="tiles"></div>
    <section class="chart">
      <h2>LAST 7 DAYS</h2>
      <div class="legend"><span><i style="background:var(--lime)"></i>Runs</span><span><i style="background:var(--cyan)"></i>Active players</span><span><i style="background:var(--gold)"></i>UBI claims</span></div>
      <svg id="chart" viewBox="0 0 700 220" role="img" aria-label="Runs, active players and UBI claims for the last 7 days"></svg>
    </section>
    <footer>Source: Moonshard API <code>/api/stats</code>. <a href="/">Play Moonshard</a></footer>
  </main>
  <script type="module">
    const meta = document.querySelector('meta[name="api-base"]')?.content || '';
    const base = meta.startsWith('%') ? '' : meta;
    const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const TILES = [
      ['verifiedPlayers', 'VERIFIED HUMANS'],
      ['ubiClaimsTotal', 'G$ UBI CLAIMS VIA MOONSHARD'],
      ['ubiClaimsToday', 'UBI CLAIMS TODAY'],
      ['engagementClaims', 'BOSS BOUNTIES CLAIMED'],
      ['runsToday', 'RUNS TODAY'],
      ['activeToday', 'ACTIVE PLAYERS TODAY'],
      ['spoilsIssuedG', 'SPOILS ISSUED (G$)'],
      ['spoilsPaidG', 'SPOILS PAID OUT (G$)'],
      ['walletsConnected', 'WALLETS CONNECTED'],
    ];
    function bars(series) {
      const W = 700, H = 220, pad = 28, groupW = (W - pad * 2) / series.length;
      const max = Math.max(1, ...series.flatMap((d) => [d.runs, d.active, d.ubiClaims]));
      const keys = [['runs', '#98ff20'], ['active', '#38e1ff'], ['ubiClaims', '#ffd166']];
      let out = `<line x1="${pad}" y1="${H - 24}" x2="${W - pad}" y2="${H - 24}" stroke="#2e4e2e"/>`;
      series.forEach((d, i) => {
        const gx = pad + i * groupW + 6;
        keys.forEach(([k, color], j) => {
          const h = Math.round((d[k] / max) * (H - 60));
          const x = gx + j * ((groupW - 12) / 3);
          out += `<rect x="${x}" y="${H - 24 - h}" width="${(groupW - 12) / 3 - 3}" height="${h}" fill="${color}"/>`;
        });
        out += `<text x="${pad + i * groupW + groupW / 2}" y="${H - 8}" fill="#8cb38c" font-size="9" text-anchor="middle">${d.day.slice(5)}</text>`;
      });
      return out;
    }
    async function load() {
      try {
        const res = await fetch(`${base}/api/stats`);
        if (!res.ok) throw new Error(String(res.status));
        const s = await res.json();
        document.getElementById('err').hidden = true;
        document.getElementById('tiles').innerHTML = TILES.map(([k, label]) => `<div class="tile"><span>${label}</span><b>${fmt(s[k])}</b></div>`).join('');
        document.getElementById('chart').innerHTML = bars(s.series);
      } catch {
        document.getElementById('err').hidden = false;
      }
    }
    load();
    setInterval(load, 60_000);
  </script>
</body>
</html>
```

- [ ] **Step 3: Build and eyeball**

```bash
npm run build && ls dist/*.html
```

Expected: `dist/index.html dist/stats.html`. Run `npm run dev:all`, open `http://localhost:5173/stats.html`, confirm tiles show zeros (empty DB) with no console errors, and the chart renders 7 groups. Screenshot at desktop and 390 px width.

- [ ] **Step 4: Commit**

```bash
git add stats.html vite.config.js && git commit -m "feat: public stats page for G$ adoption metrics"
```

---

### Task 13: Celo-fork end-to-end (real contracts, real SDKs)

**Files:**
- Create: `scripts/fork/lib.mjs`, `scripts/fork/e2e.mjs`
- Modify: `package.json` (script `test:fork`)

**Interfaces:**
- Produces: `bootFork({ upstream?, port? }) → { rpc, pub, as(address), accounts:{player,owner,appSigner,voucherSigner}, contracts:{identity,ubi,token,engagement,vault}, api:{url, ctx, call(method,path,body?,token?), advance(ms)}, login(account), grantEngagementAdmin(address), fundG(to, amountWei), shutdown() }`. `advance(ms)` moves the API's virtual clock (the server is created with `now = () => Date.now() + offset`).
- Consumes: built contract artifact `contracts/out/MoonshardVault.sol/MoonshardVault.json` (run `forge build` first), server modules (Tasks 3–7), `@goodsdks/citizen-sdk` and `@goodsdks/engagement-sdk` from the root install.

Facts verified on a live Celo fork on 2026-10-01: impersonating the DAO avatar `0x495d133B938596C9984d462F007B676bDc57eCEC` and calling `addWhitelisted(address)` on Identity succeeds; a freshly whitelisted account can call `claim()` on the UBI scheme (≈114 G$); the Engagement Rewards `ADMIN_ROLE` can be granted by writing the ERC-7201 storage slot below; the Engagement proxy (a contract) can be impersonated to move G$ for funding the vault.

- [ ] **Step 1: Write the shared fork bootstrap**

`scripts/fork/lib.mjs`:

```js
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, parseUnits, toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { createDb } from '../../server/src/db.js';
import { createChain } from '../../server/src/chain.js';
import { createApp } from '../../server/src/app.js';
import { loginMessage } from '../../server/src/auth.js';

export const ADDR = {
  identity: '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42',
  ubi: '0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1',
  token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
  engagement: '0x25db74CF4E7BA120526fd87e159CF656d94bAE43',
  avatar: '0x495d133B938596C9984d462F007B676bDc57eCEC',
};

const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const identityAbi = parseAbi(['function addWhitelisted(address)']);
const engagementAbi = parseAbi([
  'function applyApp(address app,address rewardReceiver,uint8 userAndInviterPercentage,uint8 userPercentage,string description,string url,string email)',
  'function approve(address app)',
]);

// ERC-7201 storage location of AccessControlUpgradeable (OpenZeppelin upgradeable v5)
const ACCESS_CONTROL_LOCATION = '0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bootFork({ upstream = process.env.CELO_UPSTREAM_RPC || 'https://forno.celo.org', port = 8545, apiPort = 0 } = {}) {
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--fork-url', upstream, '--port', String(port), '--chain-id', '42220', '--silent'], { stdio: 'ignore' });
  const pub = createPublicClient({ chain: celo, transport: http(rpc) });
  for (let i = 0; i < 60; i++) {
    try { if ((await pub.getBlockNumber()) > 0n) break; } catch { /* anvil still starting */ }
    await sleep(500);
  }
  const rawRpc = (method, params = []) => pub.request({ method, params });
  const as = (address) => createWalletClient({ account: address, chain: celo, transport: http(rpc) });
  const local = (account) => createWalletClient({ account, chain: celo, transport: http(rpc) });
  const fundCelo = (address, amount = '100') => rawRpc('anvil_setBalance', [address, toHex(parseUnits(amount, 18))]);

  const pk = {
    player: generatePrivateKey(),
    owner: generatePrivateKey(),
    appSigner: generatePrivateKey(),
    voucherSigner: generatePrivateKey(),
  };
  const accounts = Object.fromEntries(Object.entries(pk).map(([name, key]) => [name, privateKeyToAccount(key)]));
  for (const a of Object.values(accounts)) await fundCelo(a.address);

  async function impersonate(address) {
    await fundCelo(address);
    await rawRpc('anvil_impersonateAccount', [address]);
    return as(address);
  }

  async function fundG(to, amountWei) {
    const pool = await impersonate(ADDR.engagement); // the Engagement pool holds ~47M G$
    const hash = await pool.writeContract({ address: ADDR.token, abi: erc20, functionName: 'transfer', args: [to, amountWei] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function whitelist(address) {
    const avatar = await impersonate(ADDR.avatar);
    const hash = await avatar.writeContract({ address: ADDR.identity, abi: identityAbi, functionName: 'addWhitelisted', args: [address] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function grantEngagementAdmin(address) {
    const role = keccak256(toHex('ADMIN_ROLE'));
    const roleData = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [role, ACCESS_CONTROL_LOCATION]));
    const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [address, roleData]));
    await rawRpc('anvil_setStorageAt', [ADDR.engagement, slot, `0x${'00'.repeat(31)}01`]);
  }

  async function registerApp() {
    const owner = local(accounts.owner);
    let hash = await owner.writeContract({
      address: ADDR.engagement, abi: engagementAbi, functionName: 'applyApp',
      args: [accounts.appSigner.address, accounts.owner.address, 80, 60,
        'Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day.',
        'https://moonshard.example', 'ops@moonshard.example'],
    });
    await pub.waitForTransactionReceipt({ hash });
    await grantEngagementAdmin(accounts.owner.address);
    hash = await owner.writeContract({ address: ADDR.engagement, abi: engagementAbi, functionName: 'approve', args: [accounts.appSigner.address] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function deployVault() {
    let artifact;
    try {
      artifact = JSON.parse(await readFile(new URL('../../contracts/out/MoonshardVault.sol/MoonshardVault.json', import.meta.url), 'utf8'));
    } catch {
      throw new Error('Missing contract artifact. Run: (cd contracts && forge build)');
    }
    const hash = await local(accounts.owner).deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [ADDR.token, accounts.voucherSigner.address, accounts.owner.address, parseUnits('1000', 18), parseUnits('5000', 18)],
    });
    const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
    return contractAddress;
  }

  await whitelist(accounts.player.address);
  await registerApp();
  const vault = await deployVault();
  await fundG(vault, parseUnits('20000', 18));

  // API in-process, on a virtual clock the scripts can advance (settlement waits for UTC midnight).
  let offset = 0;
  const now = () => Date.now() + offset;
  const config = {
    port: apiPort, jwtSecret: 'fork-e2e-secret', corsOrigins: '*', databaseUrl: '', rpcUrl: rpc, chainId: 42220,
    contracts: { identity: ADDR.identity, ubi: ADDR.ubi, token: ADDR.token, engagement: ADDR.engagement, vault },
    voucherSignerKey: pk.voucherSigner,
    appSignerKey: pk.appSigner,
  };
  const db = await createDb('');
  const chain = createChain(config);
  const { app, ctx } = createApp({ db, chain, config, now });
  const server = await new Promise((resolve) => { const s = createServer(app).listen(apiPort, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, token) {
    const res = await fetch(`${url}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  async function login(account, host = 'browser') {
    const n = await call('GET', '/auth/nonce');
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const r = await call('POST', '/auth/verify', { address: account.address, message, signature, host });
    if (r.status !== 200) throw new Error(`login failed ${JSON.stringify(r.body)}`);
    return r.body;
  }

  return {
    rpc, pub, as, local, accounts, rawRpc, fundCelo, fundG, whitelist,
    contracts: { ...ADDR, vault },
    api: { url, ctx, call, advance: (ms) => { offset += ms; } },
    login, grantEngagementAdmin,
    async shutdown() {
      await new Promise((r) => server.close(r));
      await db.close();
      anvil.kill();
    },
  };
}
```

- [ ] **Step 2: Write the end-to-end script**

`scripts/fork/e2e.mjs`:

```js
import assert from 'node:assert/strict';
import { createWalletClient, formatUnits, http, parseAbi } from 'viem';
import { celo } from 'viem/chains';
import { ClaimSDK, IdentitySDK } from '@goodsdks/citizen-sdk';
import { EngagementRewardsSDK } from '@goodsdks/engagement-sdk';
import { settleDue } from '../../server/src/spoils.js';
import { bootFork } from './lib.mjs';

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const vaultAbi = parseAbi([
  'function claim(address to,uint256 id,uint256 amount,uint64 deadline,bytes signature)',
  'function claimed(uint256) view returns (bool)',
]);
const G = (v) => Number(formatUnits(v, 18));
const results = [];
const step = (name) => { console.log(`\n▶ ${name}`); results.push(name); };

const f = await bootFork();
const { api, accounts, contracts, pub } = f;
const player = accounts.player;
const wallet = createWalletClient({ account: player, chain: celo, transport: http(f.rpc) });
const balance = (addr) => pub.readContract({ address: contracts.token, abi: erc20, functionName: 'balanceOf', args: [addr] });

try {
  step('login: real on-chain identity -> verified human');
  const session = await f.login(player);
  assert.equal(session.verified, true);
  const token = session.token;

  step('UBI: claim with the real ClaimSDK, then server confirms the tx and grants the blessing');
  const identitySDK = await IdentitySDK.init({ publicClient: pub, walletClient: wallet, env: 'production' });
  const claimSDK = new ClaimSDK({ account: player.address, publicClient: pub, walletClient: wallet, identitySDK, env: 'production' });
  const entitlement = await claimSDK.checkEntitlement();
  assert.ok(entitlement.amount > 0n, 'whitelisted player should have UBI to claim');
  const before = await balance(player.address);
  const receipt = await claimSDK.claim();
  assert.ok((await balance(player.address)) > before);
  const confirm = await api.call('POST', '/ubi/confirm', { txHash: receipt.transactionHash }, token);
  assert.equal(confirm.body.blessing, true, JSON.stringify(confirm.body));
  assert.equal((await api.call('GET', '/rewards/status', undefined, token)).body.blessing, true);

  step('Daily Shard Trial: honest ticketed run with shards is ranked');
  async function trial({ score, kills, shards, durationMs }) {
    const run = (await api.call('POST', '/runs/start', { mode: 'TRIAL' }, token)).body;
    const first = Math.round(durationMs * 0.7);
    api.advance(first);
    const points = [];
    for (let t = 10_000; t <= first; t += 10_000) {
      const frac = t / durationMs;
      points.push({ t, score: Math.floor(score * frac), kills: Math.floor(kills * frac), shards: Math.floor(shards * frac) });
    }
    await api.call('POST', `/runs/${run.runId}/checkpoints`, { points }, token);
    api.advance(durationMs - first + 500);
    return api.call('POST', `/runs/${run.runId}/submit`, { ticket: run.ticket, score, kills, shards, durationMs }, token);
  }
  const t1 = await trial({ score: 4200, kills: 40, shards: 30, durationMs: 90_000 });
  assert.equal(t1.body.rankedOk, true, JSON.stringify(t1.body));
  await trial({ score: 3000, kills: 40, shards: 30, durationMs: 90_000 });

  step('forged run is rejected by the server');
  const forged = (await api.call('POST', '/runs/start', { mode: 'TRIAL' }, token)).body;
  api.advance(20_000);
  const bad = await api.call('POST', `/runs/${forged.runId}/submit`, { ticket: forged.ticket, score: 9_999_999, kills: 20, shards: 0, durationMs: 20_000 }, token);
  assert.equal(bad.body.error, 'invalid_score_rate');

  step('First Story boss: attest, sign registration, real nonContractAppClaim pays the user');
  const story = (await api.call('POST', '/runs/start', { mode: 'STORY', chapter: 1 }, token)).body;
  api.advance(50_000);
  await api.call('POST', `/runs/${story.runId}/checkpoints`, {
    points: [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 })),
  }, token);
  api.advance(10_500);
  const clear = await api.call('POST', `/runs/${story.runId}/submit`, { ticket: story.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, token);
  assert.equal(clear.body.bossCleared, true);
  const att = (await api.call('POST', '/engagement/attest', { runId: story.runId }, token));
  assert.equal(att.status, 200, JSON.stringify(att.body));
  const sdk = new EngagementRewardsSDK(pub, wallet, contracts.engagement);
  const validUntil = BigInt(att.body.validUntilBlock);
  const userSig = await sdk.signClaim(att.body.app, att.body.inviter, validUntil);
  const g0 = await balance(player.address);
  const claimReceipt = await sdk.nonContractAppClaim(att.body.app, att.body.inviter, validUntil, userSig, att.body.appSignature);
  assert.equal(claimReceipt.status, 'success');
  const gained = (await balance(player.address)) - g0;
  console.log(`   bounty paid to player: ${G(gained)} G$`);
  assert.ok(gained > 0n);
  const conf = await api.call('POST', '/engagement/confirm', { txHash: claimReceipt.transactionHash }, token);
  assert.equal(conf.body.recorded, true, JSON.stringify(conf.body));
  assert.equal((await api.call('GET', '/engagement/status', undefined, token)).body.claimedHere, true);
  assert.equal((await api.call('POST', '/engagement/attest', { runId: story.runId }, token)).body.error, 'already_claimed');

  step('settlement + vault: next UTC day, voucher redeemed on-chain by the player');
  api.advance(27 * 3600_000);
  const settled = await settleDue(api.ctx);
  assert.ok(settled.length >= 1, 'a day should have settled');
  const spoils = (await api.call('GET', '/spoils', undefined, token)).body;
  assert.ok(spoils.spoils.length >= 2, 'expect a daily prize and a shard harvest');
  let paid = 0n;
  for (const s of spoils.spoils) {
    assert.ok(s.voucher, `voucher for ${s.kind}`);
    const b0 = await balance(player.address);
    const hash = await wallet.writeContract({
      address: spoils.vault.address, abi: vaultAbi, functionName: 'claim',
      args: [s.voucher.to, BigInt(s.voucher.id), BigInt(s.voucher.amount), BigInt(s.voucher.deadline), s.voucher.signature],
    });
    const rc = await pub.waitForTransactionReceipt({ hash });
    assert.equal(rc.status, 'success');
    paid += (await balance(player.address)) - b0;
    assert.equal((await api.call('POST', '/spoils/confirm', { txHash: hash }, token)).body.recorded.length, 1);
    assert.equal(await pub.readContract({ address: spoils.vault.address, abi: vaultAbi, functionName: 'claimed', args: [BigInt(s.voucher.id)] }), true);
  }
  console.log(`   spoils paid to player: ${G(paid)} G$`);
  const again = (await api.call('GET', '/spoils', undefined, token)).body.spoils;
  assert.ok(again.every((s) => s.claimed === true && s.voucher === null));

  step('public stats reflect the session');
  const stats = (await api.call('GET', '/stats')).body;
  assert.equal(stats.verifiedPlayers, 1);
  assert.equal(stats.ubiClaimsTotal, 1);
  assert.equal(stats.engagementClaims, 1);
  assert.ok(Number(stats.spoilsPaidG) > 0);

  console.log(`\n✅ fork e2e passed (${results.length} steps)`);
} catch (err) {
  console.error('\n❌ fork e2e failed at step:', results.at(-1));
  console.error(err);
  process.exitCode = 1;
} finally {
  await f.shutdown();
}
```

- [ ] **Step 3: Add the script and run it**

In root `package.json` scripts add `"test:fork": "node scripts/fork/e2e.mjs"`. Then:

```bash
(cd contracts && forge build)
(cd server && npm install)
npm run test:fork
```

Expected: six `▶` steps then `✅ fork e2e passed`. Needs network access to `https://forno.celo.org` (the fork reads live state). If a step fails, fix the cause in the code under test (not by weakening the assertion), unless the cause is the environment — e.g. the upstream RPC rate-limits the fork; then set `CELO_UPSTREAM_RPC` to another Celo RPC and rerun.

Known adaptation points (do not paper over; resolve and keep the assertion):
- `IdentitySDK`/`ClaimSDK` may touch `window` in Node. If import or `claim()` throws a `window`-related error, define `globalThis.window = { location: { href: 'http://localhost/' } }` at the top of the script (the SDK only reads it for the face-verification redirect URL) and note that in a comment.
- `claimSDK.claim()` may try to top up gas via the faucet if the balance is below its threshold; `bootFork` funds every account with 100 CELO so this should not trigger.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json && git commit -m "test: Celo-fork end-to-end (real Identity, UBI, Engagement Rewards, MoonshardVault, SDKs)"
```

---

### Task 14: Browser verification (Playwright against the fork) and screenshots

**Files:**
- Create: `scripts/fork/browser.mjs`
- Modify: `package.json` (devDependency `playwright`, script `test:browser`)
- Output: `docs/screenshots/*.png`

**Interfaces:**
- Consumes: `bootFork` (Task 13), the Vite dev server with `VITE_API_URL`, `VITE_CELO_RPC_URL` pointing at the fork + local API.
- Produces: screenshots of Menu (desktop + 390×844 mobile), disconnected panel, verified panel, claimed panel, game-over (ranked label), leaderboard, Story chapter, bounty panel, spoils panel, stats page; and a pass/fail console report. No uncaught page errors allowed.

The page gets a mock `window.ethereum` whose signing/sending is delegated to Node (a local viem account) and whose reads go to the fork, so the **real** client code (wallet manager, GdService, GoodDollar SDKs, panel) runs end to end.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D playwright
npx playwright install chromium
```

- [ ] **Step 2: Write the browser script**

`scripts/fork/browser.mjs`:

```js
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { bootFork } from './lib.mjs';
import { settleDue } from '../../server/src/spoils.js';

const SHOTS = new URL('../../docs/screenshots/', import.meta.url).pathname;
const WEB_PORT = 5199;
await mkdir(SHOTS, { recursive: true });

const f = await bootFork({ apiPort: 0 });
const { accounts, api } = f;
const player = accounts.player;
const playerWallet = f.local(player);

const vite = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
  env: { ...process.env, VITE_API_URL: api.url, VITE_CELO_RPC_URL: f.rpc, VITE_GD_ENV: 'production' },
  stdio: 'ignore',
});
const web = `http://127.0.0.1:${WEB_PORT}`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(web)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}

const errors = [];
const requests = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });

// Wallet bridge: signing and sending happen in Node with a real key; reads go to the fork.
await page.exposeFunction('__gdSign', async (kind, params) => {
  if (kind === 'personal') {
    return player.signMessage({ message: { raw: params[0] } });
  }
  const typed = JSON.parse(params[1]);
  delete typed.types.EIP712Domain;
  return player.signTypedData({ domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message });
});
await page.exposeFunction('__gdSend', async (tx) => playerWallet.sendTransaction({
  to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined,
}));
await page.exposeFunction('__gdRpc', async (method, params) => f.rawRpc(method, params));
await context.addInitScript(({ address }) => {
  const handlers = {};
  window.ethereum = {
    on(e, fn) { (handlers[e] ||= []).push(fn); },
    removeListener() {},
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts': return [address];
        case 'eth_chainId': return '0xa4ec';
        case 'wallet_switchEthereumChain': return null;
        case 'personal_sign': return window.__gdSign('personal', params);
        case 'eth_signTypedData_v4': return window.__gdSign('typed', params);
        case 'eth_sendTransaction': return window.__gdSend(params[0]);
        default: return window.__gdRpc(method, params);
      }
    },
  };
}, { address: player.address });

const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const gameReady = () => page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
const panelHas = (text) => page.waitForFunction((t) => document.querySelector('#gd-panel')?.innerText.includes(t), text, { timeout: 60_000 });

try {
  await page.goto(web);
  await gameReady();
  await page.waitForTimeout(800);
  await shot('menu-desktop');

  console.log('▶ panel, disconnected');
  await page.click('#btn-wallet');
  await panelHas('NOT CONNECTED');
  await shot('panel-disconnected');

  console.log('▶ connect -> verified human, claim button present');
  await page.click('[data-act="connect"]');
  await panelHas('VERIFIED HUMAN');
  await panelHas('CLAIM DAILY G$');
  await shot('panel-verified');

  console.log('▶ claim daily G$ through the real ClaimSDK');
  await page.click('[data-act="ubi"]');
  await panelHas('BLESSING ACTIVE');
  await shot('panel-claimed');
  await page.click('#gd-close');

  console.log('▶ Daily Shard Trial in the real game (ticketed run, 25 s)');
  await page.evaluate(() => window.game.scene.start('SurvivalScene'));
  await page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'));
  await page.waitForTimeout(25_000);
  await page.evaluate(() => window.game.scene.getScene('SurvivalScene').handleGameOver());
  await page.waitForTimeout(2500);
  await shot('gameover-trial');
  assert.ok(requests.includes('POST /api/runs/start'), 'run ticket requested');
  assert.ok(requests.some((r) => /POST \/api\/runs\/.+\/submit/.test(r)), 'run submitted');
  assert.ok(requests.some((r) => /POST \/api\/runs\/.+\/checkpoints/.test(r)), 'checkpoints sent');

  console.log('▶ leaderboard');
  await page.evaluate(() => window.game.scene.start('LeaderboardScene'));
  await page.waitForTimeout(2500);
  await shot('leaderboard');

  console.log('▶ Tutorial boots and runs');
  await page.evaluate(() => window.game.scene.start('TutorialScene'));
  await page.waitForTimeout(8_000);
  await shot('tutorial');

  console.log('▶ Story chapter 1 boots and runs');
  await page.evaluate(() => window.game.scene.start('StoryScene', { chapter: 1 }));
  await page.waitForTimeout(12_000);
  await shot('story-chapter1');

  console.log('▶ bounty + spoils appear in the panel after server-side progress');
  const token = (await f.login(player)).token;
  const story = (await api.call('POST', '/runs/start', { mode: 'STORY', chapter: 1 }, token)).body;
  api.advance(50_000);
  await api.call('POST', `/runs/${story.runId}/checkpoints`, { points: [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 })) }, token);
  api.advance(10_500);
  await api.call('POST', `/runs/${story.runId}/submit`, { ticket: story.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, token);
  api.advance(27 * 3600_000);
  await settleDue(api.ctx);

  await page.evaluate(() => window.game.scene.start('MenuScene'));
  await page.click('#btn-wallet');
  await panelHas('CLAIM 5,000 G$ BOUNTY');
  await panelHas('REDEEM');
  await shot('panel-bounty-spoils');
  await page.click('[data-act="bounty"]');
  await panelHas('First-boss bounty claimed');
  await page.click('[data-act="redeem"]');
  await panelHas('CLAIMED');
  await shot('panel-after-claims');
  await page.click('#gd-close');

  console.log('▶ mobile portrait');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await shot('menu-mobile');
  await page.click('#btn-wallet');
  await page.waitForTimeout(400);
  await shot('panel-mobile');

  console.log('▶ stats page');
  const stats = await context.newPage();
  await stats.goto(`${web}/stats.html`);
  await stats.waitForSelector('.tile b');
  await stats.screenshot({ path: `${SHOTS}stats.png`, fullPage: true });

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log(`\n✅ browser run passed. Screenshots in docs/screenshots/ (${requests.length} API calls observed)`);
} catch (err) {
  console.error('\n❌ browser run failed');
  console.error(err);
  console.error('browser errors so far:', errors);
  await page.screenshot({ path: `${SHOTS}FAILURE.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  vite.kill();
  await f.shutdown();
}
```

- [ ] **Step 3: Run it, look at every screenshot**

```bash
(cd contracts && forge build) && npm run test:browser
```

Add `"test:browser": "node scripts/fork/browser.mjs"` to `package.json` scripts first. Expected: `✅ browser run passed`. Then **open each PNG in `docs/screenshots/` and look at it** (this project's UI is judged by eye): panel spacing and text fit at 390 px width, the header `G$` button, the menu badge, the game-over label ("Ranked — #1" or an Open-board message), leaderboard prize line in G$, stats page. Fix visual problems in `src/style.css`/`GdPanel.js` and rerun until clean.

Known adaptation points (fix the cause; do not delete the assertion):
- Selectors: if `[data-act="redeem"]` or text such as `CLAIM 5,000 G$ BOUNTY` differs after your styling, update the script to the real rendered text, not the other way around.
- The `eth_sendTransaction` bridge forwards only `to/data/value/gas`; if the SDK sets `maxFeePerGas` etc., viem in Node re-estimates them, which is fine.
- If Story chapter 1's idle player dies within 12 s, that is fine for the smoke test (it exercises the game-over path, which calls `runs.finish`); assert only on `errors`.
- Spec §9 asked for the Story boss to be played through in a headless browser. A scripted idle player cannot beat a boss, so the boss-clear path is verified through the API/SDK flow (Task 13) and the UI claim path above; say so in the final report instead of claiming more.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json docs/screenshots && git commit -m "test: Playwright run against the Celo fork with screenshots (wallet panel, claims, trial, leaderboard, stats)"
```

---

### Task 15: Docs, asset audit, application brief, deploy notes, final verification

**Files:**
- Create: `README.md`, `docs/application-brief.md`, `docs/DEPLOY.md`, `.env.example`, `scripts/audit-assets.mjs`, `scripts/register-engagement-app.mjs`
- Modify: `docs/ATTRIBUTIONS.md`

**Interfaces:** none new. This task produces the handoff the owner needs.

- [ ] **Step 1: Asset audit script**

`scripts/audit-assets.mjs` hashes every file under `public/assets` and compares against the files in the upstream "Legacy Fantasy – High Forest" pack (`extracted_assets/` in the Luna Blade clone). Matches are attributed to that pack; everything else is `pending`.

```js
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const upstream = process.argv[2] || (() => {
  const dir = mkdtempSync(join(tmpdir(), 'luna-'));
  execSync(`git clone --depth 1 https://github.com/JemIIahh/Luna-Blade.git ${dir}`, { stdio: 'ignore' });
  return dir;
})();

const packHashes = new Map();
for (const f of walk(join(upstream, 'extracted_assets'))) packHashes.set(sha(f), relative(upstream, f));

const rows = [];
for (const f of walk('public/assets')) {
  const rel = relative('.', f);
  const match = packHashes.get(sha(f));
  rows.push(match
    ? [rel, 'Anokolisa — Legacy Fantasy: High Forest 2.3', 'free; creator terms allow use in commercial projects (redistribution wording not verified)', 'cleared-for-use / verify redistribution']
    : [rel, 'unknown (no credit in upstream repo)', 'unknown', 'PENDING']);
}

const pending = rows.filter((r) => r[3] === 'PENDING').length;
const table = ['| File | Source | Licence | Status |', '|---|---|---|---|', ...rows.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} |`)].join('\n');
const block = `<!-- audit:start -->\n${rows.length} files audited, **${pending} pending**.\n\n${table}\n<!-- audit:end -->`;

let doc = readFileSync('docs/ATTRIBUTIONS.md', 'utf8');
doc = /<!-- audit:start -->[\s\S]*<!-- audit:end -->/.test(doc)
  ? doc.replace(/<!-- audit:start -->[\s\S]*<!-- audit:end -->/, block)
  : `${doc.trim()}\n\n${block}\n`;
writeFileSync('docs/ATTRIBUTIONS.md', doc);
console.log(`audited ${rows.length} files; ${pending} pending`);
```

Run `node scripts/audit-assets.mjs` and open `docs/ATTRIBUTIONS.md`.

- [ ] **Step 2: Engagement registration helper (owner runs this, not us)**

`scripts/register-engagement-app.mjs`:

```js
// Usage (owner, funded with a little CELO):
//   OWNER_KEY=0x.. APP_ADDRESS=0x.. APP_URL=https://.. APP_EMAIL=you@.. node scripts/register-engagement-app.mjs
// APP_ADDRESS is the address of APP_SIGNER_KEY on the server. After this, GoodDollar must approve the app.
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { EngagementRewardsSDK, REWARDS_CONTRACT } from '@goodsdks/engagement-sdk';

const { OWNER_KEY, APP_ADDRESS, APP_URL, APP_EMAIL } = process.env;
if (!OWNER_KEY || !APP_ADDRESS || !APP_URL || !APP_EMAIL) throw new Error('Set OWNER_KEY, APP_ADDRESS, APP_URL, APP_EMAIL');

const account = privateKeyToAccount(OWNER_KEY);
const transport = http(process.env.CELO_RPC_URL || 'https://forno.celo.org');
const sdk = new EngagementRewardsSDK(
  createPublicClient({ chain: celo, transport }),
  createWalletClient({ account, chain: celo, transport }),
  REWARDS_CONTRACT,
);

const receipt = await sdk.applyApp(APP_ADDRESS, {
  rewardReceiver: account.address,
  userAndInviterPercentage: 80,
  userPercentage: 60,
  description: 'Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day.',
  url: APP_URL,
  email: APP_EMAIL,
});
console.log('applied', receipt?.transactionHash ?? receipt);
```

Before relying on it, read `applyApp` in `node_modules/@goodsdks/engagement-sdk/src` (or `dist/*.d.ts`) and make the options object match the real signature; the Task 13 harness calls the contract's `applyApp` directly and is the verified reference for the argument meaning (80/60 = 80% of the 5,000 G$ reward goes to user+inviter, 60% of that to the user).

- [ ] **Step 3: README**

`README.md` must contain, in this order: one-paragraph description (Moonshard: The High Forest — GoodDollar edition of Luna Blade, credit "derived from Luna Blade by ScriptedBro, MIT"); a "What G$ does in the game" table (wallet+identity, daily UBI claim and Citizen's Blessing, first-boss bounty via Engagement Rewards, vault-paid Spoils, run tickets/anti-cheat, public stats) mapped to the GoodBuilders integration categories; "Run it" (`npm install`, `cd server && npm install && cp .env.example .env` then set `JWT_SECRET`, `npm run dev:all`, `forge` setup commands from Task 2, `npm test`, `npm run test:contracts`, `npm run test:fork`, `npm run test:browser`); an environment-variable table for web (`VITE_API_URL`, `VITE_CELO_RPC_URL`, `VITE_GD_ENV`, `VITE_REOWN_PROJECT_ID`) and server (every key in `server/.env.example`); project layout; license and attribution links (`LICENSE`, `docs/ATTRIBUTIONS.md`). Write it from the facts in this plan, no marketing filler.

- [ ] **Step 4: Root `.env.example`**

```
# Web client (Vite)
VITE_API_URL=http://localhost:3001
VITE_CELO_RPC_URL=https://forno.celo.org
VITE_GD_ENV=production
# Optional: enables WalletConnect for phones without an injected wallet (get one free at reown.com)
VITE_REOWN_PROJECT_ID=
```

- [ ] **Step 5: Deploy notes**

`docs/DEPLOY.md` must give exact commands for: (1) deploy `MoonshardVault` with `forge script script/Deploy.s.sol --rpc-url https://forno.celo.org --account <keystore> --broadcast` and the env vars the script reads, then fund it with G$ and set caps with `setCaps`; (2) generate keys (`cast wallet new`) for `VOUCHER_SIGNER_KEY` and `APP_SIGNER_KEY`, and register the app with `scripts/register-engagement-app.mjs`, then ask GoodDollar (Discord `ubi.gd/GoodBuildersDiscord` / Telegram `t.me/gooddollarbounties`) to approve it; (3) API on Railway: service from `server/`, Postgres plugin → `DATABASE_URL` with `?sslmode=require`, all variables from `server/.env.example`, `JWT_SECRET` from `openssl rand -base64 32`; (4) web on Vercel: build `npm run build`, output `dist`, env vars from `.env.example`; (5) post-deploy checks (`/health`, `/api/config` shows the vault, one real login). Mark clearly that none of this was executed by the agent.

- [ ] **Step 6: Application brief (draft for the GoodBuilders form)**

`docs/application-brief.md` — a ready-to-adapt draft, structured to the program's criteria. Use these exact sections and facts:

```markdown
# Moonshard — GoodBuilders application brief (draft)

> Derived from Luna Blade by ScriptedBro (MIT). Moonshard replaces its Nimiq layer with GoodDollar on Celo and adds identity-gated rewards, ticketed runs and public metrics. Credit is carried in LICENSE, README and docs/ATTRIBUTIONS.md.

## One-liner
A pixel action-platformer where every G$ reward is tied to a verified human: play free, verify once, claim your daily G$ inside the game, earn Spoils on a one-human-one-slot leaderboard.

## Which GoodBuilders integrations it uses (all live in this repo)
1. Face-verification flow with a claim button — wallet panel "VERIFY" → Identity SDK `generateFVLink`; "CLAIM DAILY G$" → Claim SDK `claim()`; server confirms the tx and grants the Citizen's Blessing.
2. Use the G$ Identity SDK meaningfully — one human, one slot: every reward, cap and leaderboard entry is keyed to the whitelisted root, so linked wallets share one slot and bots cannot farm prizes.
3. Rewards using the G$ token — daily top-3 prizes and Shard Harvest paid from `MoonshardVault`, a small audited-surface contract with on-chain per-voucher and per-day caps.
4. Engagement Rewards — one-time first-boss bounty (protocol-funded, 5,000 G$ per verified user per 180 days at the time of writing), gated by a server attestation of a ticketed boss run.
Planned next: G$ streaming (Streaming SDK) as daily-prize sponsorship, and a GoodCollective pool for community rewards.

## What is new
Run tickets and checkpointed telemetry (server clock wins), identity-keyed rewards instead of device ids, non-custodial payouts via capped vouchers, in-game UBI claim loop, public adoption dashboard.

## Growth plan and metrics we will report
Public `/stats.html`: verified humans, in-game UBI claims (tx-verified), bounties claimed, Spoils issued/paid, daily active players. Targets for the season: OWNER TO SET (e.g. verified humans, daily claims through the game).
Distribution: MiniPay and GoodWallet mini-app entry, shareable run results, community challenge days.

## Security
Open source. Contract: Foundry tests incl. fuzz; capped vouchers; two-step ownership; pause. Server: tests for replay, forgery, rate limits, identity. Hot-key risk removed: no server key can move vault funds beyond the on-chain caps; the Engagement signer holds no funds.

## Team
OWNER TO FILL: names, links, KYC readiness.

## Links
Repo: OWNER TO FILL after publishing. Demo: OWNER TO FILL after deploying. Screenshots: docs/screenshots/.
```

(Three fields are intentionally for the owner: targets, team, links.)

- [ ] **Step 7: Final verification (evidence before claims)**

Run each and record the actual output in the final report:

```bash
npm test                         # client + server tests
npm run test:contracts           # forge tests
npm run build                    # production build, 2 pages
npm run test:fork                # real contracts + SDKs on a Celo fork
npm run test:browser             # Playwright run + screenshots
node scripts/audit-assets.mjs    # attribution table
grep -rnE "Nimiq|nimiq|\bNIM\b|Luna Blade|Luna Crystal" src index.html README.md || echo "no leftover names"
git status --short               # must be clean after the final commit
git log --oneline | head -20
```

Report honestly: which commands passed, which could not run (e.g., offline), the number of pending-provenance assets, and what remains for the owner (the list in spec §11).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "docs: README, deploy notes, attribution audit, application brief, Engagement registration helper"
```

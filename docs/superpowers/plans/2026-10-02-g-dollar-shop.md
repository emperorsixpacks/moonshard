# G$ in plain sight: the blade you pay for, the Moon Shop, and a G$ guide

Owner decision (2026-10-02): "the use of G$ should be very clear in the game, else the judges won't validate it", and "the sword
the character attacks with has to be paid for with G$", with G$ claimable before the game starts. Approved design: buy your
first blade with G$ before playing; stronger blades still need forest materials plus a G$ forge fee (no buying power, the
leaderboard pays G$ prizes); a Moon Shop sells looks for G$; every payment goes on-chain into the prize vault.

## Design

- **Catalog** (`server/config.js` `GAME.SHOP`, whole G$, owner-tunable): Rusted Shortsword 20 (the entry blade); Iron
  Broadsword forge fee 30 and Forest Glaive forge fee 60 (plus their materials, counted on the device); Golden Solar Blade
  and Corrupted Void Edge 150 each (same power as the Glaive, which they require); Crimson Flame Katana, Frostmoon Crystal
  Saber, Verdant Jade Rapier 100 each (looks only); Moon Sprite pet 80.
- **Payment**: a plain G$ `transfer(vault, price)` from the player's wallet with `moonshard:<itemId>` appended to the calldata
  (Solidity ignores trailing calldata), so the transaction itself says what was bought. The server confirms it like the UBI
  claim: receipt success, sent to the G$ token, sender is one of the player's wallets, the token's Transfer event shows the
  vault received at least the price, the item exists, its requirement is owned, it is not owned yet. One purchase per tx.
- **Ownership** is per human (subject), on the server (`purchases` table), shown to the client by `GET /shop`.
- **Gate**: connect, prove you are human, get your blade, play. The blade step offers the daily claim when the balance is
  short. With no vault configured the shop is off and the starter blade is free (a deployment without Spoils still plays).
- **Visibility**: a G$ guide (menu row and once on the first visit): what G$ is, claim, buy your blade, earn (Shards, prizes,
  bounty), spend (Moon Shop), where it goes (the prize vault, linked on Celoscan); the balance on the G$ button; prices on
  every Forge item; "G$ spent in the Moon Shop" on the public stats page; the local launcher's ledger names shop purchases.

## Steps (each test first)

1. Server: catalog, migration `003_shop.sql`, `GET /shop`, `POST /shop/confirm`, stats `shopSpentG`.
2. Client `src/gd/shop.js` (tagged transfer, balance reads); GdService: `shop`, `gBalance`, `vaultBalance` in the status,
   `buy(itemId)` through the pending-confirmation queue (kind `shop`).
3. Gate rules and the gate view: the blade step.
4. Forge: G$ prices, BUY, forge fees; ownership from the server.
5. G$ guide (pure view + panel), menu row, first-visit opening, balance on the G$ button.
6. Browser checks (stub), fork e2e (real G$ transfer with the tag, confirmed), fork browser run, local launcher.
7. Docs: README, DEPLOY (the vault also receives shop payments), application brief, execution notes.

## Outcome (2026-10-02)

Built as planned, steps 1 to 7, each test first; see the "Fourth pass" section of `docs/EXECUTION_NOTES.md` for what was
found along the way and the evidence (client 457, server 262, contracts 23, fork e2e, fork browser run, launcher check).

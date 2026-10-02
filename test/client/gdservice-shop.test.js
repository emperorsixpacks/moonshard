import test from 'node:test';
import assert from 'node:assert/strict';
import { GD } from '../../src/gd/config.js';
import { storage } from '../../src/engine/Storage.js';
import { H1, SHOP, VAULT, reply, serverStub, startService, stubLoaders, walletStub } from './helpers/service.js';

/*
 * The Moon Shop in the GdService: what G$ buys (public, before connecting), what the player owns and holds once they have,
 * and `buy(itemId)`: one G$ payment into the prize vault, confirmed with the server like every other paid action.
 */

const connected = (t, server = serverStub({ owned: [] })) => startService(t, { wallet: walletStub(), server, connect: true });

test('the catalog is in the status before anyone connects; what the player owns and their G$ arrive once they do', async (t) => {
  const { gd } = await startService(t, { wallet: walletStub(), server: serverStub({ owned: [] }) });
  await gd.refreshShop();
  let s = gd.getStatus();
  assert.equal(s.shop.enabled, true);
  assert.equal(s.shop.items.find((i) => i.kind === 'blade').id, 'iron_starter');
  assert.equal(s.owned, null);
  assert.equal(s.balance, null);

  await gd.connect();
  s = gd.getStatus();
  assert.deepEqual(s.owned, []);
  assert.equal(s.balance, '100');
});

test('buying: the price goes to the vault the server named, the payment is confirmed, and the item is owned', async (t) => {
  const server = serverStub({ owned: [] });
  const { gd } = await connected(t, server);
  const sent = [];
  gd.loaders = stubLoaders({ shop: { buyItem: async (args) => { sent.push(args); args.onHash(H1); return { hash: H1 }; } } });
  const r = await gd.buy('iron_starter');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.confirmed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].vault, VAULT);
  assert.deepEqual(sent[0].item, SHOP.items[0]);
  assert.deepEqual(server.confirmed, [`/shop/confirm:${H1}`]);
  assert.deepEqual(gd.getStatus().owned, ['iron_starter']);
});

test('a purchase that cannot be right is refused before the wallet is asked for anything', async (t) => {
  const cases = [
    ['an item not in the catalog', {}, 'excalibur', 'not_for_sale'],
    ['an item already owned', { owned: ['iron_starter'] }, 'iron_starter', 'already_owned'],
    ['an item whose requirement is missing', { owned: ['iron_starter'] }, 'golden_albatross', 'requires_item'],
    ['the shop is closed on this server', { shop: { enabled: false, token: SHOP.token, vault: null, items: [] } }, 'iron_starter', 'not_for_sale'],
    ['a server that names another token', { shop: { ...SHOP, token: '0x0000000000000000000000000000000000000bad' } }, 'iron_starter', 'token_mismatch'],
  ];
  for (const [label, over, item, error] of cases) {
    const { gd } = await connected(t, serverStub({ owned: [], ...over }));
    let sent = 0;
    gd.loaders = stubLoaders({ shop: { buyItem: async () => { sent++; return { hash: H1 }; } } });
    const r = await gd.buy(item);
    assert.equal(r.ok, false, label);
    assert.equal(r.error, error, label);
    assert.equal(sent, 0, `${label}: nothing sent`);
  }
});

test('not enough G$: refused with a message that points at the daily claim', async (t) => {
  const { gd } = await startService(t, { wallet: walletStub(), server: serverStub({ owned: [] }) });
  gd.loaders = stubLoaders({ shop: { readGBalance: async () => 5n * 10n ** 18n } });
  await gd.connect();
  assert.equal(gd.getStatus().balance, '5');
  const r = await gd.buy('iron_starter');
  assert.equal(r.error, 'not_enough_g');
  assert.match(r.message, /claim/i);
});

test('an app pinned to a vault refuses to pay into another one', async (t) => {
  const { gd } = await connected(t);
  const pinned = GD.vault;
  GD.vault = '0x0000000000000000000000000000000000000001';
  t.after(() => { GD.vault = pinned; });
  const r = await gd.buy('iron_starter');
  assert.equal(r.error, 'vault_mismatch');
});

test('while a payment is still confirming, the same purchase cannot be sent again', async (t) => {
  const server = serverStub({ owned: [] });
  const { gd } = await connected(t, server);
  server.handlers['/shop/confirm'] = () => reply({ error: 'tx_not_found' }, 404); // the server's node has not seen it yet
  gd.loaders = stubLoaders({ shop: { buyItem: async ({ onHash }) => { onHash(H1); return { hash: H1 }; } } });
  const first = await gd.buy('iron_starter');
  assert.equal(first.ok, true);
  assert.equal(first.confirmPending, true);
  assert.equal(gd.getStatus().awaiting.shop.iron_starter, H1);
  const again = await gd.buy('iron_starter');
  assert.equal(again.error, 'already_submitted');
});

test('what the server says the player owns is what the game unlocks on this device', async (t) => {
  const { gd } = await connected(t, serverStub({ owned: ['iron_starter', 'skin_flame', 'satchel_pet'] }));
  assert.equal(storage.isWeaponUnlocked('iron_starter'), true);
  assert.equal(storage.isWeaponUnlocked('skin_flame'), true);
  assert.equal(storage.isWeaponUnlocked('iron_broadsword'), false);
  assert.equal(storage.data.satchelUnlocked, true);

  // another account on the same device: its own purchases, nothing of the first one's
  const other = await connected(t, serverStub({ owned: [] }));
  assert.ok(other.gd !== gd);
  assert.equal(storage.isWeaponUnlocked('skin_flame'), false);
  assert.equal(storage.isWeaponUnlocked('iron_starter'), false);
  assert.equal(storage.data.satchelUnlocked, false);
  assert.equal(storage.getEquippedWeapon(), 'iron_starter', 'nothing else can stay equipped');
});

test('with the shop closed, the first blade is free and the device keeps its own unlocks (the forge works with materials alone)', async (t) => {
  await connected(t, serverStub({ owned: [] })); // an open shop that has sold this player nothing
  assert.equal(storage.isWeaponUnlocked('iron_starter'), false);
  storage.unlockWeapon('iron_broadsword'); // forged here with materials
  await connected(t, serverStub({ owned: [], shop: { enabled: false, token: SHOP.token, vault: null, items: [] } }));
  assert.equal(storage.isWeaponUnlocked('iron_starter'), true);
  assert.equal(storage.isWeaponUnlocked('iron_broadsword'), true);
});

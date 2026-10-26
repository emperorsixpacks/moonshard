import assert from 'node:assert/strict';
import { createWalletClient, custom, formatUnits, parseAbi, parseUnits, stringToHex } from 'viem';
import { celo } from 'viem/chains';
import { createRequire } from 'node:module';
import { EngagementRewardsSDK } from '@goodsdks/engagement-sdk';
import { settleDue } from '../../server/src/spoils.js';
import { bootFork, localWalletProvider } from './lib.mjs';
import { buyItem } from '../../src/gd/shop.js';

// The citizen SDK's ESM build does a named import from CommonJS `lz-string`, which plain Node rejects
// (Vite handles it fine in the browser). Its CJS build loads, so use that here.
const { ClaimSDK, IdentitySDK } = createRequire(import.meta.url)('@goodsdks/citizen-sdk');

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
const wallet = createWalletClient({ account: player.address, chain: celo, transport: custom(localWalletProvider(f.rpc, player, pub)) });
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

  step('Moon Shop: no blade, no run; the blade is bought with a real G$ transfer into the vault that names it');
  const refused = await api.call('POST', '/runs/start', { mode: 'TRIAL' }, token);
  assert.equal(refused.body.error, 'blade_required', JSON.stringify(refused.body));
  const shop = (await api.call('GET', '/shop')).body;
  assert.equal(shop.vault.toLowerCase(), contracts.vault.toLowerCase());
  const blade = shop.items.find((i) => i.kind === 'blade');
  const playerG0 = await balance(player.address);
  const vaultG0 = await balance(contracts.vault);
  // the game's own purchase code (src/gd/shop.js), with the wallet a browser would give it
  const clients = { clients: () => ({ walletClient: wallet, publicClient: pub }) };
  const bought = await buyItem({ wallet: clients, vault: shop.vault, item: blade });
  assert.equal(bought.unconfirmed, undefined);
  const sent = await pub.getTransaction({ hash: bought.hash });
  assert.equal(sent.to.toLowerCase(), contracts.token.toLowerCase(), 'paid on the G$ token');
  assert.ok(sent.input.endsWith(stringToHex(`moonshard:${blade.id}`).slice(2)), 'the transaction itself names what it bought');
  const price = parseUnits(blade.priceG, 18);
  assert.equal(playerG0 - (await balance(player.address)), price, 'the player paid exactly the price');
  assert.equal((await balance(contracts.vault)) - vaultG0, price, 'and the prize vault received all of it');
  console.log(`   ${blade.name}: ${blade.priceG} G$ from the player into the prize vault`);
  const bladeConfirm = await api.call('POST', '/shop/confirm', { txHash: bought.hash }, token);
  assert.equal(bladeConfirm.status, 200, JSON.stringify(bladeConfirm.body));
  assert.deepEqual(bladeConfirm.body.owned, [blade.id]);
  assert.deepEqual((await api.call('GET', '/rewards/status', undefined, token)).body.owned, [blade.id]);

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
  // What the server tells the player the bounty is worth is read from the real contract (its reward amount and this app's
  // registered 80 / 60 split); the claim below must pay exactly that, not the pool's headline 5,000.
  const offered = (await api.call('GET', '/engagement/status', undefined, token)).body;
  assert.equal(offered.pendingRunId, story.runId, JSON.stringify(offered));
  assert.equal(offered.rewardG, '2400', `the promised amount is the player's share, read from the chain: ${JSON.stringify(offered)}`);
  assert.ok(Date.parse(offered.attestExpiresAt) > api.ctx.now(), 'the status says until when the bounty can be claimed');
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
  assert.equal(gained, BigInt(offered.rewardG) * 10n ** 18n, 'the player received exactly what the status promised');
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

  step('Moon Shop: a look bought with G$ from the bounty; it adds no power');
  const pet = (await api.call('GET', '/shop')).body.items.find((i) => i.id === 'satchel_pet');
  const vaultG1 = await balance(contracts.vault);
  const petBuy = await buyItem({ wallet: clients, vault: shop.vault, item: pet });
  assert.equal((await balance(contracts.vault)) - vaultG1, parseUnits(pet.priceG, 18));
  const petConfirm = await api.call('POST', '/shop/confirm', { txHash: petBuy.hash }, token);
  assert.deepEqual(petConfirm.body.owned, [blade.id, pet.id]);
  // a Celestial blade (the Glaive's power) cannot be had for G$ alone before the Glaive itself
  const celestial = shop.items.find((i) => i.kind === 'cosmetic' && i.requires);
  const early = await buyItem({ wallet: clients, vault: shop.vault, item: celestial });
  const earlyConfirm = await api.call('POST', '/shop/confirm', { txHash: early.hash }, token);
  assert.equal(earlyConfirm.body.recorded, true, 'the payment is kept');
  assert.ok(!earlyConfirm.body.owned.includes(celestial.id), 'but the blade waits for the Glaive');

  step('public stats reflect the session');
  const stats = (await api.call('GET', '/stats')).body;
  assert.equal(stats.verifiedPlayers, 1);
  assert.equal(stats.ubiClaimsTotal, 1);
  assert.equal(stats.engagementClaims, 1);
  assert.ok(Number(stats.spoilsPaidG) > 0);
  assert.equal(stats.shopPurchases, 3);
  assert.equal(Number(stats.shopSpentG), Number(blade.priceG) + Number(pet.priceG) + Number(celestial.priceG));
  console.log(`   G$ spent in the Moon Shop: ${stats.shopSpentG}`);

  console.log(`\n✅ fork e2e passed (${results.length} steps)`);
} catch (err) {
  console.error('\n❌ fork e2e failed at step:', results.at(-1));
  console.error(err);
  process.exitCode = 1;
} finally {
  await f.shutdown();
}

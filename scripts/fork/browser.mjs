import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { bootFork, localWalletProvider } from './lib.mjs';
import { freePort, waitForMoonshard } from './ports.mjs';
import { erc20Abi as erc20 } from 'viem';
import { settleDue } from '../../server/src/spoils.js';

const SHOTS = new URL('../../docs/screenshots/', import.meta.url).pathname;
const WEB_PORT = await freePort();
await mkdir(SHOTS, { recursive: true });

const f = await bootFork({ apiPort: 0 });
const { accounts, api } = f;
const player = accounts.player;

const vite = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
  env: { ...process.env, VITE_API_URL: api.url, VITE_CELO_RPC_URL: f.rpc, VITE_GD_ENV: 'production' },
  stdio: 'ignore',
});
process.on('exit', () => vite.kill()); // never leave a dev server behind, even if a run crashes
const web = `http://127.0.0.1:${WEB_PORT}`;
await waitForMoonshard(web);

const errors = [];
const requests = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const inflight = new Set();
page.on('request', (r) => {
  inflight.add(r.url());
  if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
});
page.on('requestfinished', (r) => inflight.delete(r.url()));
page.on('requestfailed', (r) => {
  inflight.delete(r.url());
  // ERR_ABORTED is the browser abandoning an in-flight request (e.g. a receipt poll when a scene closes): not an app error
  if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${r.url().slice(0, 140)} ${r.failure()?.errorText}`);
});

// Wallet bridge: signing and sending happen in Node with a real key (shared with the API e2e); reads go to the fork.
const provider = localWalletProvider(f.rpc, player, f.pub);
await page.exposeFunction('__gdRequest', (method, params) => provider.request({ method, params }));
await context.addInitScript(({ address }) => {
  window.ethereum = {
    on() {},
    removeListener() {},
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts': return [address];
        case 'eth_chainId': return '0xa4ec';
        case 'wallet_switchEthereumChain': return null;
        default: return window.__gdRequest(method, params);
      }
    },
  };
}, { address: player.address });

const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
// the wallet chip on the menu (the menu is page elements over the whole screen)
const openWallet = async () => { await page.waitForSelector('#ms-menu [data-act="wallet"]', { timeout: 30_000 }); await page.click('#ms-menu [data-act="wallet"]'); };
const closeSheet = async () => { await page.click('#ms-sheets [data-sheet="close"]'); await page.waitForFunction(() => !document.querySelector('#ms-sheets .sheet'), null, { timeout: 5000 }); };
const startScene = async (key, data) => {
  // Phaser's scene.start leaves other scenes running underneath; stop them so one scene (and one run ticket) is live
  await page.evaluate(([k, d]) => {
    for (const sc of window.game.scene.getScenes(true)) if (sc.scene.key !== k) window.game.scene.stop(sc.scene.key);
    window.game.scene.start(k, d);
  }, [key, data]);
  await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 30_000 });
};
const gameReady = () => page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
const panelHas = (text) => page.waitForFunction((t) => document.querySelector('#ms-sheets .sheet')?.innerText.includes(t), text, { timeout: 60_000 });
/** What the button of a Shop card says (the card of item `id`), or null. */
const shopButton = (id) => page.evaluate((i) => document.querySelector(`#ms-menu .sh-card[data-id="${i}"] .sh-btn`)?.innerText.trim() ?? null, id);
const shopTab = async (tab) => {
  await page.click(`#ms-menu .sh [data-act="tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`#ms-menu .sh .sh-tab.on[data-tab="${tab}"]`);
};

try {
  await page.goto(web);
  await gameReady();

  console.log('▶ a first visit opens nothing by itself');
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#ms-sheets .sheet'))), false, 'a guide or panel opened by itself');
  await shot('menu-desktop');

  console.log('▶ panel, disconnected');
  await openWallet();
  await panelHas('Connect wallet');
  await panelHas('How G$ works');
  await shot('panel-disconnected');

  console.log('▶ the way in: connect, prove you are human, buy your blade with G$, play');
  await closeSheet();
  await page.evaluate(() => window.game.scene.getScene('MenuScene').scene.start('SurvivalScene')); // what a menu tile does
  await panelHas('one human, one slot');
  assert.equal(await page.evaluate(() => window.game.scene.isActive('SurvivalScene')), false, 'play started without a verified human');
  await shot('gate-connect');
  await page.click('#ms-sheets [data-act="connect"]');
  // this wallet is a whitelisted human on the fork, holding no G$ yet: the blade step offers today's free claim first
  await panelHas('Get your blade');
  await panelHas('You need 20 G$');
  await shot('gate-blade-claim-first');
  console.log('   claim daily G$ through the real ClaimSDK, from the gate');
  await page.click('#ms-sheets [data-act="ubi"]');
  await panelHas('Buy for 20 G$');
  await shot('gate-blade-buy');
  console.log('   buy the blade: a real G$ transfer into the prize vault');
  const vaultBefore = await f.pub.readContract({ address: f.contracts.token, abi: erc20, functionName: 'balanceOf', args: [f.contracts.vault] });
  await page.click('#ms-sheets [data-act="buy"]');
  await panelHas('Play Endless mode');
  const vaultAfter = await f.pub.readContract({ address: f.contracts.token, abi: erc20, functionName: 'balanceOf', args: [f.contracts.vault] });
  assert.equal(vaultAfter - vaultBefore, 20n * 10n ** 18n, 'the prize vault received the 20 G$');
  await shot('gate-ready');
  await page.click('#ms-sheets [data-act="play"]');
  const firstEndlessAt = Date.now();
  await page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
  await startScene('MenuScene');

  console.log('▶ verified human with a blade: the blessing from the claim, the balance on the G$ button');
  await openWallet();
  await panelHas('Verified human');
  await panelHas("Citizen's Blessing");
  await page.waitForFunction(() => /^G\$ [0-9]/.test(document.querySelector('#wallet-btn-text-landscape')?.textContent ?? ''), null, { timeout: 30_000 });
  await shot('panel-claimed');
  await closeSheet();

  console.log('▶ Daily Shard Trial in the real game (ticketed run, 35 s)');
  // The server paces Endless starts 10 s apart per player (GAME.START_GAP_MS), and PLAY in the gate started one moments ago.
  // A start inside the pace is answered "slow down"; the game waits and starts its run late, which would leave this one under
  // the 30 s a run needs to be ranked. A person takes longer than that between two games; the script waits it out.
  await page.waitForTimeout(Math.max(0, firstEndlessAt + 10_500 - Date.now()));
  await startScene('SurvivalScene');
  // The server ranks a run, and so settles a prize for it, only from 30 s of play. An idle player is killed after about
  // 32 s, which would end the run on its own right at that line, so the player is made unhittable for the wait.
  await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene')?.player, null, { timeout: 30_000 });
  await page.evaluate(() => { window.game.scene.getScene('SurvivalScene').player.invulnerableUntil = Number.MAX_SAFE_INTEGER; });
  await page.waitForTimeout(35_000);
  await page.evaluate(() => window.game.scene.getScene('SurvivalScene').handleGameOver());
  await page.waitForTimeout(2500);
  await shot('gameover-trial');
  assert.ok(requests.includes('POST /api/runs/start'), 'run ticket requested');
  assert.ok(requests.some((r) => /POST \/api\/runs\/.+\/submit/.test(r)), 'run submitted');
  assert.ok(requests.some((r) => /POST \/api\/runs\/.+\/checkpoints/.test(r)), 'checkpoints sent');

  console.log('▶ leaderboard');
  await startScene('LeaderboardScene');
  await page.waitForTimeout(2500);
  await shot('leaderboard');

  console.log('▶ Tutorial boots and runs');
  await startScene('TutorialScene');
  await page.waitForTimeout(8_000);
  await shot('tutorial');

  console.log('▶ Story chapter 1 boots and runs');
  await startScene('StoryScene', { chapter: 1 });
  await page.waitForTimeout(12_000);
  await shot('story-chapter1');

  console.log('▶ boss bounty: attested by the server, signed and sent by the wallet, paid by the real contract');
  const token = (await f.login(player)).token;
  const story = (await api.call('POST', '/runs/start', { mode: 'STORY', chapter: 1 }, token)).body;
  api.advance(50_000);
  await api.call('POST', `/runs/${story.runId}/checkpoints`, { points: [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 })) }, token);
  api.advance(10_500);
  await api.call('POST', `/runs/${story.runId}/submit`, { ticket: story.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, token);

  await startScene('MenuScene');
  await openWallet();
  // the player's share of the pool's 5,000 G$ (registered at 80 / 60), read from the chain by the API: not the headline
  await panelHas('Claim 2,400 G$ bounty');
  await shot('panel-bounty');
  await page.click('#ms-sheets [data-act="bounty"]');
  await panelHas('First-boss bounty claimed');
  await shot('panel-bounty-claimed');
  await closeSheet();

  console.log('▶ the Shop: a look bought with G$, and a blade forged from materials plus a G$ fee');
  await startScene('ForgeScene');
  await page.waitForSelector('#ms-menu .sh .sh-card');
  await shopTab('looks');
  await page.waitForTimeout(500);
  await shot('forge-skins-prices');
  assert.equal(await shopButton('skin_flame'), 'Buy · 100 G$', 'a skin is a G$ price on its button');
  await page.click('#ms-menu .sh-card[data-id="skin_flame"] .sh-btn'); // a real click: the payment goes to the wallet on the fork
  await page.waitForFunction(() => document.querySelector('#ms-menu .sh-card[data-id="skin_flame"] .sh-btn')?.innerText.trim() === 'Equipped', null, { timeout: 120_000 });
  await shot('forge-skin-bought');
  await shopTab('blades');
  await page.waitForTimeout(500);
  assert.equal(await shopButton('iron_broadsword'), 'Forge · 30 G$', 'the Broadsword is materials and a 30 G$ fee');
  await page.click('#ms-menu .sh-card[data-id="iron_broadsword"] .sh-btn');
  await page.waitForFunction(() => document.querySelector('#ms-menu .sh-card[data-id="iron_broadsword"] .sh-btn')?.innerText.trim() === 'Equipped', null, { timeout: 120_000 });
  await shot('forge-broadsword');
  assert.equal(await shopButton('forest_glaive'), 'Forge · 60 G$', 'the Glaive still needs its materials and fee');
  const glaive = await page.$$eval('#ms-menu .sh-card[data-id="forest_glaive"] .sh-cost', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(glaive, ['15 Bark', '10 Amber', '8 Iron'], 'and its materials are on its card');
  await startScene('MenuScene');

  console.log('▶ Spoils: next UTC day settles the trial, the player redeems the voucher on-chain');
  api.advance(27 * 3600_000);
  await settleDue(api.ctx);
  await openWallet();
  await panelHas('Redeem');
  await shot('panel-spoils');
  await page.click('#ms-sheets [data-act="redeem"]');
  await panelHas('Claimed');
  await shot('panel-spoils-redeemed');
  await closeSheet();

  console.log('▶ mobile portrait');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await shot('menu-mobile');
  await openWallet();
  await page.waitForTimeout(400);
  await shot('panel-mobile');

  console.log('▶ stats page');
  const stats = await context.newPage();
  await stats.goto(`${web}/stats.html`);
  await stats.waitForSelector('.tile b');
  const shopTile = await stats.evaluate(() => [...document.querySelectorAll('#chain .tile')].find((t) => t.textContent.includes('MOON SHOP PURCHASES'))?.querySelector('b').textContent);
  assert.equal(shopTile, '3', 'the stats page counts the blade, the skin and the forge fee');
  await stats.screenshot({ path: `${SHOTS}stats.png`, fullPage: true });

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log(`\n✅ browser run passed. Screenshots in docs/screenshots/ (${requests.length} API calls observed)`);
} catch (err) {
  console.error('\n❌ browser run failed');
  console.error(err);
  console.error('browser errors so far:', errors);
  console.error('still loading:', [...inflight].slice(0, 12));
  console.error('page state:', await page.evaluate(() => ({
    url: location.href,
    hasGame: Boolean(window.game),
    activeScenes: window.game?.scene?.getScenes(true).map((s) => s.scene.key),
    sheet: document.querySelector('#ms-sheets .sheet')?.className,
    sheetText: document.querySelector('#ms-sheets .sheet')?.innerText.slice(0, 600),
  })).catch((e) => `unavailable: ${e.message}`));
  await page.screenshot({ path: `${SHOTS}FAILURE.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  vite.kill();
  await f.shutdown();
}

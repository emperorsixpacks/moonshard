import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { bootFork, localWalletProvider } from './lib.mjs';
import { freePort, waitForMoonshard } from './ports.mjs';
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
// the header button is shown in portrait, the floating one in landscape
const openWallet = () => page.locator('#btn-wallet:visible, #btn-wallet-landscape:visible').first().click();
const startScene = async (key, data) => {
  // Phaser's scene.start leaves other scenes running underneath; stop them so one scene (and one run ticket) is live
  await page.evaluate(([k, d]) => {
    for (const sc of window.game.scene.getScenes(true)) if (sc.scene.key !== k) window.game.scene.stop(sc.scene.key);
    window.game.scene.start(k, d);
  }, [key, data]);
  await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 30_000 });
};
const gameReady = () => page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
const panelHas = (text) => page.waitForFunction((t) => document.querySelector('#gd-panel')?.innerText.includes(t), text, { timeout: 60_000 });

try {
  await page.goto(web);
  await gameReady();
  await page.waitForTimeout(800);
  await shot('menu-desktop');

  console.log('▶ panel, disconnected');
  await openWallet();
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
  await startScene('SurvivalScene');
  await page.waitForTimeout(25_000);
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
  await panelHas('CLAIM 5,000 G$ BOUNTY');
  await shot('panel-bounty');
  await page.click('[data-act="bounty"]');
  await panelHas('First-boss bounty claimed');
  await shot('panel-bounty-claimed');
  await page.click('#gd-close');

  console.log('▶ Spoils: next UTC day settles the trial, the player redeems the voucher on-chain');
  api.advance(27 * 3600_000);
  await settleDue(api.ctx);
  await openWallet();
  await panelHas('REDEEM');
  await shot('panel-spoils');
  await page.click('[data-act="redeem"]');
  await panelHas('CLAIMED');
  await shot('panel-spoils-redeemed');
  await page.click('#gd-close');

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
    gdPanel: document.querySelector('#gd-panel')?.className,
    panelText: document.querySelector('#gd-panel')?.innerText.slice(0, 600),
  })).catch((e) => `unavailable: ${e.message}`));
  await page.screenshot({ path: `${SHOTS}FAILURE.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  vite.kill();
  await f.shutdown();
}

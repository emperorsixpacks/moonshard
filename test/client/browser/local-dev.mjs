// The local test launcher (`npm run dev:local`) driven the way a person would use it, in a real browser:
//   a first visitor sees the G$ guide, then is stopped by the gate; connecting uses the built-in test wallet even when a
//   wallet extension owns window.ethereum (as MetaMask or Rabby do in a real browser) and must never be asked for anything;
//   "Verify (face scan)" goes to the stand-in page, one click passes; with no G$ yet the gate offers today's claim, then the
//   blade for 20 G$, then PLAY; the claim, the blade, the first-boss bounty and the Spoils each move real G$ on the local
//   fork and show up in the launcher's ledger; removing the verification brings the gate back; the launcher
//   refuses requests from pages that are not local, and stopping it leaves nothing running.
//   node test/client/browser/local-dev.mjs        (run from the repository root; needs internet for the fork; takes ~5 minutes)
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { clickMenuRow } from './lib.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

// ---- start the launcher and wait until it says it is ready -----------------------------------------------------------
const launcher = spawn(process.execPath, ['scripts/local-dev/launch.mjs', '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const ready = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`the launcher was not ready after 5 minutes\n${output.slice(-1500)}`)), 300_000);
  const onData = (chunk) => {
    output += chunk;
    const match = /LOCAL_DEV_READY (\{.*\})/.exec(output);
    if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
  };
  launcher.stdout.on('data', onData);
  launcher.stderr.on('data', onData);
  launcher.once('exit', (code) => reject(new Error(`the launcher exited early (${code})\n${output.slice(-1500)}`)));
});
const helper = new URL(ready.dev).origin;
launcher.removeAllListeners('exit');

const getJson = async (path) => (await fetch(`${helper}${path}`)).json();
const post = async (path) => {
  const res = await fetch(`${helper}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { status: res.status, body: await res.json() };
};
const ledger = async () => (await getJson('/dev/state')).ledger;

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // A wallet extension in the person's own browser owns window.ethereum before any page script runs and cannot be dislodged.
  // Make one that throws, and fail the run if the game ever asks it for anything.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      value: {
        isRabby: true,
        on() {},
        removeListener() {},
        request: async ({ method }) => { window.__reportExtensionCall?.(method); throw new Error('the real wallet must not be used'); },
      },
      configurable: false,
      writable: false,
    });
  });
  const page = await context.newPage();
  const extensionCalls = [];
  await page.exposeFunction('__reportExtensionCall', (method) => extensionCalls.push(method));
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`); });

  const panelOpen = () => page.waitForFunction(() => document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden'), null, { timeout: 60_000 });
  const panelHas = (text) => page.waitForFunction((t) => document.querySelector('#gd-panel')?.innerText.includes(t), text, { timeout: 90_000 });
  const openWallet = () => page.locator('#btn-wallet:visible, #btn-wallet-landscape:visible').first().click();
  const closePanel = () => page.click('#gd-close');
  const active = (key) => page.evaluate((k) => window.game.scene.isActive(k), key);
  const startScene = async (key) => {
    await page.evaluate((k) => {
      for (const s of window.game.scene.getScenes(true)) if (s.scene.key !== k) window.game.scene.stop(s.scene.key);
      window.game.scene.start(k);
    }, key);
    await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 30_000 });
  };
  const gameReady = () => page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 90_000 });

  // ---- 1. a first visitor ----------------------------------------------------------------------------------------------
  log('▶ the test wallet and the gate');
  await page.goto(ready.game);
  await gameReady();
  check(await page.evaluate(() => window.ethereum?.isRabby === true), 'a wallet extension owns window.ethereum here, as in a real browser');
  check(await page.evaluate(() => window.__MS_LOCAL_DEV?.provider?.isMoonshardLocalDev === true), 'and the page still has the built-in test wallet');
  check((await page.locator('a', { hasText: 'LOCAL TEST' }).count()) === 1, 'a badge says this is a local test session');
  check(!(await getJson('/dev/state')).verified, 'the test player starts unverified');
  await panelHas('WHAT G$ IS');
  check(true, 'a first visit opens the G$ guide');
  await closePanel();
  await clickMenuRow(page, 'ENDLESS MODE');
  await panelOpen();
  check(/VERIFIED HUMANS ONLY/.test(await page.innerText('#gd-panel')), 'tapping Endless opens the gate');
  check(!(await active('SurvivalScene')), 'and the mode does not start');

  // ---- 2. connect, then the face scan stand-in ---------------------------------------------------------------------
  log('▶ connect, then the face-scan stand-in');
  await page.click('[data-act="connect"]');
  await panelHas('VERIFY (FACE SCAN)');
  check(true, 'connecting signs in with the test wallet and the gate moves to "prove you are human"');
  await Promise.all([page.waitForURL(/\/face-scan\?/, { timeout: 60_000 }), page.click('[data-act="verify"]')]);
  check(/LOCAL TEST/.test(await page.innerText('body')) && /Pass the face scan/.test(await page.innerText('body')), 'the verify button leads to the stand-in page');
  check(!(await getJson('/dev/state')).verified, 'which has not verified anyone yet');
  await Promise.all([page.waitForURL((u) => u.href.startsWith(ready.game), { timeout: 60_000 }), page.click('#pass')]);
  await gameReady();
  await panelHas('3. Buy your blade with G$');
  check(true, 'one click returns to the game, verified, at the next step of the mode they asked for: the blade');
  const afterScan = await getJson('/dev/state');
  check(afterScan.verified, 'the real Identity contract on the fork now lists the player as a verified human');

  // ---- 3. the daily claim, then the blade ---------------------------------------------------------------------------
  log('▶ the daily G$ claim, then the blade');
  await panelHas('You need 20 G$');
  check(true, 'with no G$ yet, the gate offers today\'s free claim first');
  await page.click('[data-act="ubi"]');
  await panelHas('BUY RUSTED SHORTSWORD — 20 G$');
  const afterClaim = await ledger();
  const claim = afterClaim.find((row) => row.label === 'Daily UBI claim');
  check(Boolean(claim) && claim.direction === 'in' && Number(claim.amountG.replace(/,/g, '')) > 0, `the real claim contract paid G$ to the player (${claim?.amountG} G$)`);
  await page.click('[data-act="buy"]');
  await panelHas('PLAY ENDLESS MODE');
  const blade = (await ledger()).find((row) => row.label.startsWith('Moon Shop: Rusted Shortsword'));
  check(blade?.direction === 'out' && blade.amountG === '20', `the blade cost 20 G$, paid into the prize vault (${blade?.label}, ${blade?.amountG})`);
  await page.click('[data-act="play"]');
  await page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
  check(true, 'PLAY starts endless mode');
  await startScene('MenuScene');
  await openWallet();
  await panelHas('BLESSING ACTIVE');
  await closePanel();

  // ---- 4. the first-boss bounty ------------------------------------------------------------------------------------
  log('▶ the first-boss bounty');
  const boss = await post('/dev/boss-clear');
  check(boss.status === 200, `the shortcut records a chapter-1 boss clear (${boss.body.message ?? boss.body.error})`);
  await openWallet();
  await panelHas('CLAIM 2,400 G$ BOUNTY');
  await page.click('[data-act="bounty"]');
  await panelHas('First-boss bounty claimed');
  await closePanel();
  const bounty = (await ledger()).find((row) => row.label.startsWith('First-boss bounty'));
  check(bounty?.amountG === '2,400', `the Engagement Rewards contract paid exactly the 2,400 G$ the game promised (${bounty?.amountG})`);

  // ---- 5. a ranked run, the next day, and redeeming the Spoils -----------------------------------------------------
  log('▶ a ranked run, the next day, redeeming Spoils');
  await startScene('SurvivalScene');
  await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene')?.player, null, { timeout: 30_000 });
  // the server ranks a run only from 30 s of play, and an idle hero is killed at about 32 s: keep it alive for the wait
  await page.evaluate(() => { window.game.scene.getScene('SurvivalScene').player.invulnerableUntil = Number.MAX_SAFE_INTEGER; });
  await page.waitForTimeout(35_000);
  await page.evaluate(() => window.game.scene.getScene('SurvivalScene').handleGameOver());
  await page.waitForTimeout(2_500);
  const day = await post('/dev/next-day');
  check(day.status === 200 && /settled 1 day/.test(day.body.message), `skipping a day settles the run into a prize (${day.body.message ?? day.body.error})`);
  await startScene('MenuScene');
  await openWallet();
  await panelHas('REDEEM');
  await page.click('[data-act="redeem"]');
  await panelHas('CLAIMED');
  await closePanel();
  const spoil = (await ledger()).find((row) => row.label.startsWith('Spoils redeemed'));
  check(spoil?.amountG === '1,000', `the vault paid the rank-1 daily prize on the fork (${spoil?.amountG} G$)`);

  // ---- 6. remove the verification: the gate is back -----------------------------------------------------------------
  log('▶ removing the verification brings the gate back');
  const revoked = await post('/dev/revoke');
  check(revoked.status === 200 && !(await getJson('/dev/state')).verified, 'the shortcut removes the player from the Identity contract');
  await page.goto(ready.game);
  await gameReady();
  await page.waitForFunction(() => window.gdService?.getStatus().connected, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.gdService.getStatus().status === 'unverified', null, { timeout: 60_000 });
  await clickMenuRow(page, 'ENDLESS MODE');
  await panelHas('VERIFY (FACE SCAN)');
  check(!(await active('SurvivalScene')), 'the next play tap shows "prove you are human" again and does not start the mode');

  // ---- 7. the control page ----------------------------------------------------------------------------------------
  log('▶ the G$ view');
  const view = await context.newPage();
  await view.goto(ready.dev);
  await view.waitForFunction(() => document.querySelectorAll('#ledger tr').length >= 3, null, { timeout: 30_000 });
  const rows = await view.$$eval('#ledger tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  check(rows.some((r) => /Daily UBI claim/.test(r)) && rows.some((r) => /First-boss bounty/.test(r)) && rows.some((r) => /Spoils redeemed/.test(r)),
    `it lists the three kinds of G$ the player received (${rows.length} rows)`);
  check(rows.some((r) => /Moon Shop: Rusted Shortsword/.test(r)), 'and the G$ they paid for the blade');
  check((await view.innerText('#verified')) === 'no', 'and shows the player as not verified now');

  // ---- 8. the launcher only serves local pages ---------------------------------------------------------------------
  log('▶ safety');
  const foreign = await new Promise((resolve, reject) => {
    const req = request(`${helper}/wallet`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' } }, (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end(JSON.stringify({ method: 'personal_sign', params: ['0x00', ready.player] }));
  });
  check(foreign === 403, `a request from a web page that is not local is refused (${foreign})`);
  check(extensionCalls.length === 0, `the game never asked the wallet extension for anything (${extensionCalls.join(', ') || 'no calls'})`);
  check(errors.length === 0, `no browser errors ${errors.join(' | ')}`);
} catch (err) {
  failures.push(String(err.stack || err));
  log(`\n${err.stack || err}`);
} finally {
  await browser?.close().catch(() => {});
  launcher.kill('SIGINT');
  await new Promise((resolve) => { launcher.once('exit', resolve); setTimeout(() => { launcher.kill('SIGKILL'); resolve(); }, 20_000); });
}

// ---- stopping it leaves nothing running ---------------------------------------------------------------------------------
log('▶ stopping');
const stillUp = async (url) => fetch(url, { signal: AbortSignal.timeout(2_000) }).then(() => true, () => false);
check(!(await stillUp(ready.game)), 'the game server is gone');
check(!(await stillUp(`${helper}/dev/state`)), 'the launcher is gone');
check(!(await stillUp(ready.rpc)), 'the local chain is gone');

if (failures.length) {
  console.log(`\n❌ local-dev check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ local-dev check passed');

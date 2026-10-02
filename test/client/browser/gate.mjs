// The verified-human gate in a real browser, around the edges the unit tests cannot reach:
//   a deep link (?scene=survival) from a visitor lands on the menu with the gate open (never a blank screen)
//   what a player asked to play before the face scan is offered again, as one tap, when they come back verified
//   a verified player is never stopped
//   node test/client/browser/gate.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const active = (page, key) => page.evaluate((k) => window.game.scene.isActive(k), key);
const panelText = (page) => page.evaluate(() => document.querySelector('#gd-panel')?.innerText ?? '');

// ---- 1. a visitor follows a deep link ------------------------------------------------------------------------------
{
  const g = await bootGame();
  try {
    log('▶ a deep link from a visitor');
    await g.page.goto(`${g.web}/?scene=survival`);
    await g.page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
    await g.page.waitForFunction(() => !document.querySelector('#gd-panel')?.classList.contains('hidden'), null, { timeout: 15_000 });
    check(!(await active(g.page, 'SurvivalScene')), 'the mode did not start');
    check(await active(g.page, 'MenuScene'), 'the menu is behind the gate, not a blank screen');
    const text = await panelText(g.page);
    check(/VERIFIED HUMANS ONLY/.test(text) && /ENDLESS MODE/.test(text), 'the gate names the mode that was asked for');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. back from the face scan, verified ---------------------------------------------------------------------------
{
  const remembered = `sessionStorage.setItem('moonshard.gate.v1', JSON.stringify({ key: 'SurvivalScene', data: null, at: Date.now() }));`;
  const g = await bootGame({ api: true, init: sessionInit() + remembered });
  try {
    await installApi(g.page, { verified: true });
    log('▶ back from the face scan with a remembered request');
    await g.goto();
    await g.page.waitForFunction(() => document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden'), null, { timeout: 30_000 });
    const text = await panelText(g.page);
    check(/PLAY ENDLESS MODE/.test(text), 'the mode they asked for is offered as one tap');
    check(!(await active(g.page, 'SurvivalScene')), 'it does not start by itself');
    await g.page.click('[data-act="play"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check(true, 'PLAY starts it');
    check(await g.page.evaluate(() => sessionStorage.getItem('moonshard.gate.v1') === null), 'the memory was used up');

    log('▶ a verified player is never stopped');
    await g.page.evaluate(() => window.game.scene.getScene('SurvivalScene').scene.start('MenuScene'));
    await g.page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 15_000 });
    await g.page.evaluate(() => window.game.scene.getScene('MenuScene').scene.start('TutorialScene'));
    await g.page.waitForFunction(() => window.game.scene.isActive('TutorialScene'), null, { timeout: 15_000 });
    check(true, 'the tutorial starts at once');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. the verification lapses in the middle of a session ------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit() });
  try {
    const api = await installApi(g.page, { verified: true });
    log('▶ a verification that lapses mid-session stops the next "play again"');
    await g.goto();
    await g.page.waitForFunction(() => window.gdService.getStatus().verified === true, null, { timeout: 30_000 });
    await g.startScene('SurvivalScene');
    await g.page.evaluate(() => { window.__marker = window.game.scene.getScene('SurvivalScene').children.list[0]; });

    api.verified = false; // the human check expired on the server
    await g.page.evaluate(() => window.gdService.refreshAll());
    await g.page.waitForFunction(() => window.gdService.getStatus().verified === false, null, { timeout: 15_000 });

    await g.page.evaluate(() => window.game.scene.getScene('SurvivalScene').scene.restart()); // what "play again" does
    await g.page.waitForFunction(() => document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden'), null, { timeout: 15_000 });
    check(/ENDLESS MODE/.test(await panelText(g.page)), 'the gate opens and names the mode');
    check(await g.page.evaluate(() => window.__marker.active), 'the run was not restarted behind it');

    api.verified = true; // they verify again
    await g.page.click('[data-act="recheck"]');
    await g.page.waitForSelector('[data-act="play"]', { timeout: 15_000 });
    await g.page.click('[data-act="play"]');
    await g.page.waitForFunction(() => window.__marker.active === false, null, { timeout: 30_000 });
    check(await active(g.page, 'SurvivalScene'), 'passing the gate carries the restart out');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ gate check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ gate check passed');

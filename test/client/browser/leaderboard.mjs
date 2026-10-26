// The leaderboard in a real browser: a page under the page header, one card per player, the same boards and buttons as before.
//   it lists the players in order with the player's own row marked; All-time and Daily are one tap apart and cost no new request
//   Daily names the prizes beside the medals; the view switch asks the server for the other view; Spoils opens its sheet
//   the status line follows the player and opens the wallet; Menu, Escape and Play Endless leave
//   it fits a phone upright and sideways: no cut-off addresses, no sideways scrolling, the buttons on screen, the page header
//   still clear above it, and no game controls on it
//   node test/client/browser/leaderboard.mjs        (run from the repository root)
import { bootGame, clickMenu, sheetName, sheetOpen, sheetText, waitSheet } from './lib.mjs';
import { ADDRESS, installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const players = [
  { rank: 1, wallet: '0xb2d6a1f0c4e8b3a597d2c1e0f4a8b6c3d9e7b1c7', score: 3206, durationMs: 186_000 },
  { rank: 2, wallet: '0x7a3f9c2e1d4b6a8c0e5f7a9b1c3d5e7f9a1b3c5d', score: 2840, durationMs: 171_000 },
  { rank: 3, wallet: ADDRESS, score: 2410, durationMs: 150_000 },
  { rank: 4, wallet: '0xc4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7', score: 1980, durationMs: 128_000 },
  { rank: 5, wallet: '0x99aabbccddeeff00112233445566778899aabbcc', score: 1500, durationMs: 99_000 },
  { rank: 6, wallet: '0x0a1b2c3d4e5f60718293a4b5c6d7e8f901234567', score: 1210, durationMs: 80_000 },
  { rank: 7, wallet: '0xfedcba9876543210fedcba9876543210fedcba98', score: 900, durationMs: 61_000 },
  { rank: 8, wallet: '0x1234567890abcdef1234567890abcdef12345678', score: 640, durationMs: 40_000 },
];
const boards = { alltime: players, daily: players.slice(0, 3) };

const PHONE = { width: 390, height: 664 };
const SMALL_PHONE = { width: 360, height: 640 };
const SIDEWAYS = { width: 844, height: 390 };

const ready = (page) => page.waitForFunction(() => window.game.scene.getScene('LeaderboardScene')?.boardsReady, null, { timeout: 20_000 });
const lbText = (page) => page.evaluate(() => document.querySelector('#ms-menu .lb')?.innerText ?? '');
const asked = (api) => api.callsTo(/^\/leaderboard/).length;
const rowsShown = (page) => page.evaluate(() => {
  const scroll = document.querySelector('#ms-menu .lb-scroll').getBoundingClientRect();
  return [...document.querySelectorAll('#ms-menu .lb-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= scroll.top - 1 && b.bottom <= scroll.bottom + 1; }).length;
});

/** The layout facts that decide whether a phone can use the screen. */
const layout = (page) => page.evaluate(() => {
  const lb = document.querySelector('#ms-menu .lb');
  const vh = window.innerHeight; const vw = window.innerWidth;
  const bar = lb.querySelector('.lb-bar').getBoundingClientRect();
  const header = document.getElementById('arcade-header');
  const headerBottom = header && header.offsetParent !== null ? header.getBoundingClientRect().bottom : 0;
  const names = [...lb.querySelectorAll('.lb-row .nm')];
  const wallet = document.getElementById('btn-wallet');
  const pill = wallet && wallet.offsetParent !== null ? wallet.getBoundingClientRect() : null;
  const hit = pill ? document.elementFromPoint(pill.x + pill.width / 2, pill.y + pill.height / 2) : null;
  return {
    top: Math.round(lb.getBoundingClientRect().top), headerBottom: Math.round(headerBottom),
    barInside: bar.bottom <= vh + 1 && bar.right <= vw + 1 && bar.left >= -1,
    sideways: lb.scrollWidth > lb.clientWidth + 1 || document.documentElement.scrollWidth > vw + 1,
    cutOff: names.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
    pillReachable: pill ? Boolean(hit && wallet.contains(hit)) : true,
    pad: (() => { const p = document.getElementById('touch-controls'); return p && !p.classList.contains('hidden') && p.offsetParent !== null; })(),
  };
});

// ---- a verified player on a phone held upright ---------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), viewport: PHONE, tutorialDone: true });
  const { page } = g;
  try {
    const api = await installApi(page, { verified: true, boards });
    await g.goto();
    await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
    log('▶ a verified player, phone upright');
    await clickMenu(page, 'ranks');
    await ready(page);
    check(await page.evaluate(() => document.querySelector('#ms-menu .lb-title')?.innerText === 'Leaderboard'), 'the Ranks tile opens the leaderboard');

    let names = await page.$$eval('#ms-menu .lb-row .nm', (els) => els.map((e) => e.innerText));
    check(names.length === 8 && names[0] === '0xb2…b1c7', `a card for each player, best first (${names.length}; ${names[0]})`);
    check(await page.evaluate(() => document.querySelectorAll('#ms-menu .lb-row.me').length === 1 && document.querySelector('#ms-menu .lb-row.me .rk').innerText === '3.'), 'the player\'s own row (rank 3) is marked');
    check(await page.evaluate(() => document.querySelectorAll('#ms-menu .lb-row .av svg').length === 8), 'every player has an avatar');
    check((await lbText(page)).includes('you are rank #3'), 'the status line says where the player stands');
    check((await rowsShown(page)) >= 3, `at least three cards are in view without scrolling (${await rowsShown(page)})`);

    const l = await layout(page);
    check(l.top === l.headerBottom && l.headerBottom > 0, `it starts right under the page header (${l.top} = ${l.headerBottom})`);
    check(l.pillReachable, 'the header\'s wallet button is not covered');
    check(l.barInside, 'Menu and Play Endless are on screen');
    check(!l.sideways, 'nothing scrolls sideways');
    check(l.cutOff === 0, `no address is cut off (${l.cutOff} are)`);
    check(!l.pad, 'there are no game controls on it');

    log('▶ the two boards');
    const before = asked(api);
    await page.click('#ms-menu [data-act="tab"][data-tab="daily"]');
    const daily = await lbText(page);
    check(/Daily prizes: 1st 1000 · 2nd 600 · 3rd 300 G\$/.test(daily), 'Daily names the prizes');
    check((await page.$$eval('#ms-menu .lb-row .nm', (els) => els.length)) === 3, 'and lists its own three');
    check(await page.evaluate(() => [...document.querySelectorAll('#ms-menu .lb-row .hn small')].map((e) => e.innerText).join() === '1000,600,300'), 'with each prize beside its medal');
    check(/Honors/.test(daily), 'under "Honors"');
    await page.click('#ms-menu [data-act="tab"][data-tab="alltime"]');
    check((await page.$$eval('#ms-menu .lb-row .nm', (els) => els.length)) === 8 && /Legend/.test(await lbText(page)), 'All-time is one tap back, under "Legend"');
    check(asked(api) === before, 'switching boards asked the server for nothing');

    log('▶ the view switch');
    check((await lbText(page)).includes('View: Verified'), 'it starts on the verified view');
    await page.click('#ms-menu [data-act="view"]');
    await page.waitForFunction(() => /View: Open/.test(document.querySelector('#ms-menu .lb')?.innerText ?? ''), null, { timeout: 10_000 });
    await ready(page);
    check(api.callsTo(/^\/leaderboard\/alltime/).some((c) => /view=open/.test(c.query)), 'the server was asked for the open view');
    check(await page.evaluate(() => document.querySelector('#ms-menu .lb-tab.on')?.dataset.tab) === 'alltime', 'on the board the player was on');
    await page.click('#ms-menu [data-act="view"]'); // leave the shared state as it was found
    await page.waitForFunction(() => /View: Verified/.test(document.querySelector('#ms-menu .lb')?.innerText ?? ''), null, { timeout: 10_000 });

    log('▶ the Spoils sheet');
    await page.click('#ms-menu [data-act="spoils"]');
    check(await waitSheet(page, /win 1000\/600\/300 G\$ at UTC midnight/), 'Spoils status opens its sheet, with the amounts');
    check((await sheetName(page)) === 'spoils', 'as a sheet of its own');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#ms-sheets .sheet:not(.out)'), null, { timeout: 5000 });
    check(await page.evaluate(() => window.game.scene.isActive('LeaderboardScene')), 'Escape closed the sheet and did not leave the leaderboard');

    log('▶ leaving');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 10_000 });
    check(await page.evaluate(() => !document.querySelector('#ms-menu .lb')), 'Escape goes to the menu, and the screen is gone');
    await clickMenu(page, 'ranks');
    await ready(page);
    await page.click('#ms-menu [data-act="menu"]');
    await page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 10_000 });
    check(true, 'Menu goes to the menu');
    await clickMenu(page, 'ranks');
    await ready(page);
    await page.click('#ms-menu [data-act="endless"]');
    await page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 15_000 });
    check(true, 'Play Endless starts Endless');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- someone who is not connected ----------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, viewport: PHONE, tutorialDone: true });
  const { page } = g;
  try {
    await installApi(page, { verified: false, boards });
    await g.goto();
    log('▶ a visitor');
    await g.startScene('LeaderboardScene');
    await ready(page);
    const text = await lbText(page);
    check(/Not connected\. Tap to connect a wallet and join the board\./.test(text), 'the status line invites them to connect');
    check(await page.evaluate(() => document.querySelectorAll('#ms-menu .lb-row.me').length === 0), 'no row is theirs');
    check(!/First boss/.test(text), 'and no rewards line is shown');
    await page.click('#ms-menu [data-act="wallet"]');
    check(await waitSheet(page, /Wallet|Connect/), 'tapping the line opens the wallet');
    check(await sheetOpen(page), 'as a sheet over the leaderboard');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- a server that cannot be reached -------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: false, viewport: PHONE, tutorialDone: true });
  const { page } = g;
  try {
    await g.goto();
    log('▶ no server');
    await g.startScene('LeaderboardScene');
    await page.waitForFunction(() => /reach the server/i.test(document.querySelector('#ms-menu .lb')?.innerText ?? ''), null, { timeout: 20_000 });
    check(true, 'it says the boards cannot be reached, in plain words');
    check(await page.evaluate(() => Boolean(document.querySelector('#ms-menu .lb [data-act="retry"]'))), 'with a way to try again');
    check(await page.evaluate(() => Boolean(document.querySelector('#ms-menu .lb [data-act="menu"]'))), 'and a way out');
  } finally { await g.close(); }
}

// ---- smaller and sideways ---------------------------------------------------------------------------------------------------
for (const [name, viewport] of [['a small phone upright', SMALL_PHONE], ['a phone sideways', SIDEWAYS]]) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport, tutorialDone: true });
  const { page } = g;
  try {
    await installApi(page, { verified: true, boards });
    await g.goto();
    await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
    log(`▶ ${name}`);
    await g.startScene('LeaderboardScene');
    await ready(page);
    const l = await layout(page);
    check(l.barInside, 'Menu and Play Endless are on screen');
    check(!l.sideways, 'nothing scrolls sideways');
    check(l.cutOff === 0, `no address is cut off (${l.cutOff} are)`);
    check(!l.pad, 'no game controls');
    check(l.pillReachable, 'the header\'s wallet button is not covered');
    check(l.top === l.headerBottom, `it starts under the page header, or at the top when there is none (${l.top} = ${l.headerBottom})`);
    check((await rowsShown(page)) >= 3, `at least three cards are in view (${await rowsShown(page)})`);
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- turning the phone ------------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), viewport: PHONE, tutorialDone: true });
  const { page } = g;
  try {
    const api = await installApi(page, { verified: true, boards });
    await g.goto();
    log('▶ turning the phone');
    await g.startScene('LeaderboardScene');
    await ready(page);
    await page.click('#ms-menu [data-act="tab"][data-tab="daily"]');
    const n = asked(api);
    await page.setViewportSize(SIDEWAYS);
    await page.waitForFunction(() => window.game.scale.height === 270, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    let l = await layout(page);
    check(l.top === 0 && l.barInside && !l.sideways, `sideways it fills the screen from the top (${l.top})`);
    await page.setViewportSize(PHONE);
    await page.waitForFunction(() => window.game.scale.height === 440, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    l = await layout(page);
    check(l.top === l.headerBottom && l.headerBottom > 0 && l.barInside, 'upright again it sits under the header');
    check(await page.evaluate(() => document.querySelector('#ms-menu .lb-tab.on')?.dataset.tab) === 'daily', 'and is still on the daily board');
    check(asked(api) === n, 'without asking the server again');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ leaderboard check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ leaderboard check passed');

// Invite friends, in a real browser with the API stood in for (the server's rules are its own tests, in server/test/referrals.test.js):
//   a friend who arrives through ?ref=CODE has the code taken off the address bar, and a signed-in session claims it once
//   the wallet has an "Invite friends" button, and Settings has a row: both open the sheet with the link, the counts and each friend
//   the sheet fits a 364 px phone with no sideways scroll; Copy puts the whole link on the clipboard; on a phone that can share, Share opens the share sheet
//   closing the sheet comes back to the wallet when it was opened from there, and just closes from Settings
//   a failed load says so and can be retried; someone not signed in is taken to the wallet to sign in
//   node test/client/browser/referral.mjs        (run from the repository root)
import { bootGame, clickMenu, closeSheet, sheetName, sheetOpen, sheetText, waitSheet } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const CODE = 'K7M2QX9A';
const PHONE = { width: 364, height: 740 };
const FRIENDS = [
  { who: '0x1234…abcd', status: 'playing', joinedAt: new Date(Date.now() - 3600_000).toISOString() },
  { who: '0x5678…ef01', status: 'verified', joinedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { who: '0x9abc…2345', status: 'joined', joinedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() },
];
const waitFor = async (fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};
/** Opens the page through an invite link and waits for the menu. */
async function arrive(g, query = `?ref=${CODE}`) {
  await g.page.goto(`${g.web}/${query}`);
  await g.page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
}
/** What the sheet on screen does to the page's width: nothing may stick out of it, or scroll sideways. Measured once it has finished sliding in. */
const fit = async (page) => {
  await new Promise((r) => setTimeout(r, 450));
  return measure(page);
};
const measure = (page) => page.evaluate(() => {
  const sheet = document.querySelector('#ms-sheets .sheet');
  const body = sheet.querySelector('.sheet-b');
  const box = sheet.getBoundingClientRect();
  const stuckOut = [...sheet.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).map((el) => el.className || el.tagName);
  return { sideways: body.scrollWidth > body.clientWidth + 1, stuckOut, withinScreen: box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1 };
});

// ---- 1. a signed-in friend arrives through a link, and looks at their own invite sheet --------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true, viewport: PHONE });
  try {
    await g.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: g.web });
    const api = await installApi(g.page, { verified: true, referrals: { joined: 3, verified: 2, playing: 1, friends: FRIENDS } });

    log('▶ a friend arrives through an invite link');
    await arrive(g);
    check(await g.page.evaluate(() => !location.search.includes('ref=')), 'the invitation is taken off the address bar');
    check(await waitFor(() => api.callsTo(/referrals\/claim/).length === 1), 'the signed-in session claims it');
    check(api.callsTo(/referrals\/claim/)[0]?.body?.code === CODE, 'with the code from the link');
    check(await waitFor(() => g.page.evaluate(() => localStorage.getItem('moonshard.ref.v1') === null)), 'and the code is spent');
    await g.page.reload();
    await g.page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 500));
    check(api.callsTo(/referrals\/claim/).length === 1, 'a reload does not claim again');

    log('▶ the wallet has an Invite friends button');
    await clickMenu(g.page, 'wallet');
    check(await waitSheet(g.page, /Invite friends/), 'the wallet offers it');
    await g.page.click('#ms-sheets [data-act="invite"]');
    check(await waitSheet(g.page, /Share your link/), 'it opens the invite sheet');
    check(await sheetName(g.page) === 'invite', 'a sheet of its own');
    const text = await sheetText(g.page);
    const link = `${g.web}/?ref=${CODE}`;
    check(text.includes(link), `the link is the page's own address with the code (${link})`);
    check(/3\s*Joined/.test(text) && /2\s*Verified/.test(text) && /1\s*Playing/.test(text), 'with how many joined, verified and are playing');
    check(/0x1234…abcd/.test(text) && /0x5678…ef01/.test(text) && /0x9abc…2345/.test(text), 'and each friend, by a masked wallet');
    check(/Joined today/.test(text) && /Joined 2 days ago/.test(text) && /Joined 9 days ago/.test(text), 'with when they joined');
    const phone = await fit(g.page);
    check(!phone.sideways && phone.stuckOut.length === 0 && phone.withinScreen, `it fits a ${PHONE.width}px phone with no sideways scroll ${JSON.stringify(phone)}`);
    const tall = await g.page.evaluate(() => [...document.querySelectorAll('#ms-sheets .sheet button')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
    check(tall.length === 0, `every button is a full-size touch target ${JSON.stringify(tall)}`);
    check(await g.page.evaluate(() => !document.querySelector('#ms-sheets [data-act="share"]')), 'a browser with no share sheet gets Copy only');

    log('▶ Copy');
    await g.page.click('#ms-sheets [data-act="copy"]');
    check(await waitFor(() => g.page.evaluate(() => navigator.clipboard.readText()).then((t) => t === link)), 'puts the whole link on the clipboard');
    check(/Copied/.test(await sheetText(g.page)), 'and says so');
    check(await waitFor(() => sheetText(g.page).then((t) => /Copy link/.test(t)), 5000), 'then goes back to Copy link');

    log('▶ closing it');
    await g.page.click('#ms-sheets [data-sheet="close"]'); // not closeSheet(): the wallet takes its place at once, so a sheet is always there
    check(await waitSheet(g.page, /Invite friends/) && await sheetName(g.page) === 'wallet', 'comes back to the wallet it was opened from');
    await closeSheet(g.page);

    log('▶ Settings has a row too');
    await clickMenu(g.page, 'settings');
    await waitSheet(g.page, /Sound effects/);
    await g.page.click('#ms-sheets [data-act="invite"]');
    check(await waitSheet(g.page, /Share your link/), 'it opens the same sheet');
    await closeSheet(g.page);
    check(!(await sheetOpen(g.page)), 'and closing it just closes it');

    log('▶ a load that fails can be tried again');
    api.referralsStatus = 500;
    await clickMenu(g.page, 'wallet');
    await waitSheet(g.page, /Invite friends/);
    await g.page.click('#ms-sheets [data-act="invite"]');
    check(await waitSheet(g.page, /Something went wrong/), 'it says what happened');
    check(await g.page.evaluate(() => Boolean(document.querySelector('#ms-sheets [data-act="retry"]'))), 'and offers Try again');
    api.referralsStatus = 200;
    await g.page.click('#ms-sheets [data-act="retry"]');
    check(await waitSheet(g.page, /Share your link/), 'which brings the link');
    await g.page.click('#ms-sheets [data-sheet="close"]'); // back to the wallet, then close that too
    await waitSheet(g.page, /Invite friends/);
    await closeSheet(g.page);

    log('▶ a phone held on its side');
    await g.page.setViewportSize({ width: 740, height: 364 });
    await clickMenu(g.page, 'wallet');
    await waitSheet(g.page, /Invite friends/);
    await g.page.click('#ms-sheets [data-act="invite"]');
    await waitSheet(g.page, /Share your link/);
    const side = await fit(g.page);
    check(!side.sideways && side.stuckOut.length === 0 && side.withinScreen, 'the sheet still fits, scrolling inside itself when it is taller than the screen');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. a phone that can share ----------------------------------------------------------------------------------------
{
  const share = 'window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); };';
  const g = await bootGame({ api: true, init: sessionInit() + share, tutorialDone: true, viewport: PHONE });
  try {
    await installApi(g.page, { verified: true, referrals: { friends: [] } });
    await g.goto();
    log('▶ a phone with a share sheet');
    await clickMenu(g.page, 'wallet');
    await waitSheet(g.page, /Invite friends/);
    await g.page.click('#ms-sheets [data-act="invite"]');
    check(await waitSheet(g.page, /Share your link/), 'the invite sheet opens');
    const order = await g.page.evaluate(() => [...document.querySelectorAll('#ms-sheets .sheet [data-act]')].map((b) => b.dataset.act).filter((a) => a === 'share' || a === 'copy'));
    check(order.join() === 'share,copy', 'Share comes first, Copy second');
    check(/No friends yet/.test(await sheetText(g.page)), 'with no friends yet it says to send the link');
    await g.page.click('#ms-sheets [data-act="share"]');
    check(await waitFor(() => g.page.evaluate(() => window.__shared.length === 1)), 'Share opens the phone\'s share sheet');
    const shared = await g.page.evaluate(() => window.__shared[0]);
    check(shared?.url === `${g.web}/?ref=${CODE}` && /Moonshard/.test(shared?.title ?? '') && shared?.text, 'with the link, a title and a line about the game');
    check(await sheetName(g.page) === 'invite', 'and the sheet stays open');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. not signed in --------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, tutorialDone: true, viewport: PHONE });
  try {
    const api = await installApi(g.page, { verified: true });
    log('▶ someone who has not signed in, who arrived through a link');
    await arrive(g);
    check(await g.page.evaluate(() => !location.search.includes('ref=')), 'the invitation is off the address bar');
    check(await g.page.evaluate(() => Boolean(localStorage.getItem('moonshard.ref.v1'))), 'and the code waits for a sign-in');
    await new Promise((r) => setTimeout(r, 400));
    check(api.callsTo(/referrals\/claim/).length === 0, 'nothing is claimed without a session');
    await clickMenu(g.page, 'settings');
    await waitSheet(g.page, /Sound effects/);
    await g.page.click('#ms-sheets [data-act="invite"]');
    check(await waitSheet(g.page, /Not connected|Connect|Continue with email|wallet/i), 'Invite friends takes them to the wallet, where they sign in');
    check(await sheetName(g.page) === 'wallet', 'not to a link they do not have');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ referral check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ referral check passed');

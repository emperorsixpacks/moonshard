// Signing in with an email (Magic), in a real browser, with a stand-in for magic-sdk (no network, no real account):
//   without a Magic key there is no email button; with one it is the main way in for someone without a wallet app
//   the email sheet: a bad address is refused, the code is asked for, a wrong code is refused, the right one signs in
//   the wallet is the one Magic made: the game signs in with its address, and Enter submits a form
//   a reload comes back through the same wallet without a prompt; Disconnect signs out of Magic for real
//   backing out returns to the wallet's sheet
//   node test/client/browser/email-login.mjs        (run from the repository root)
import { bootGame, sheetName, sheetText, waitSheet } from './lib.mjs';
import { installApi } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const MAGIC_ADDRESS = '0x3333333333333333333333333333333333333333';

/** magic-sdk as the game uses it. Whether someone is signed in is kept in localStorage, so a reload keeps it like Magic would. */
const FAKE_MAGIC = `
const SIGNED_IN = 'fake.magic.email';
export class Magic {
  constructor(key, options) {
    const log = (window.__magic ||= { constructed: [], logins: [], logouts: 0, calls: [] });
    log.constructed.push({ key, options });
    this.rpcProvider = {
      on() {}, removeListener() {},
      request: async (args) => {
        log.calls.push(args.method);
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          if (!localStorage.getItem(SIGNED_IN)) throw new Error('not signed in');
          return ['${MAGIC_ADDRESS}'];
        }
        if (args.method === 'eth_chainId') return '0xa4ec';
        if (args.method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        throw new Error('unexpected ' + args.method);
      },
    };
    this.user = {
      isLoggedIn: async () => Boolean(localStorage.getItem(SIGNED_IN)),
      logout: async () => { log.logouts += 1; localStorage.removeItem(SIGNED_IN); },
    };
    this.auth = {
      loginWithEmailOTP: ({ email, showUI }) => {
        log.logins.push({ email, showUI });
        const listeners = {};
        let resolve; let reject;
        const settled = new Promise((res, rej) => { resolve = res; reject = rej; });
        const fire = (event) => (listeners[event] || []).forEach((fn) => fn());
        const handle = {
          on(event, fn) { (listeners[event] ||= []).push(fn); return handle; },
          emit(event, payload) {
            log.calls.push('emit ' + event + ' ' + (payload ?? ''));
            if (event === 'verify-email-otp') {
              if (payload === '123456') { localStorage.setItem(SIGNED_IN, email); resolve('did-token'); } else fire('invalid-email-otp');
            }
            if (event === 'cancel') reject(new Error('cancelled'));
          },
          then: settled.then.bind(settled),
          catch: settled.catch.bind(settled),
        };
        setTimeout(() => fire('email-otp-sent'), 60);
        return handle;
      },
    };
  }
}
`;

async function boot(env) {
  const g = await bootGame({ api: true, env });
  // the dev server serves magic-sdk pre-bundled; the game gets the stand-in instead
  await g.page.route(/\/node_modules\/\.vite\/deps\/magic-sdk/, (route) => route.fulfill({ contentType: 'application/javascript', body: FAKE_MAGIC }));
  const api = await installApi(g.page, { verified: true });
  await g.goto();
  return { g, api };
}
const openWallet = async (page) => { await page.evaluate(() => window.__gdPanel.open()); };
const magic = (page) => page.evaluate(() => window.__magic ?? null);
const fieldValue = (page, name, value) => page.fill(`#ms-sheets input[name="${name}"]`, value);

// ---- no key: nothing changes ---------------------------------------------------------------------------------------------
{
  const { g } = await boot({});
  try {
    log('▶ a game without a Magic key');
    await openWallet(g.page);
    await waitSheet(g.page, /Connect/);
    check(!/email/i.test(await sheetText(g.page)), 'the wallet offers no email sign-in');
    check((await magic(g.page)) === null, 'and the SDK was never loaded');
  } finally { await g.close(); }
}

// ---- with a key ----------------------------------------------------------------------------------------------------------
{
  const { g, api } = await boot({ VITE_MAGIC_PUBLISHABLE_KEY: 'pk_test_FAKE' });
  const { page } = g;
  try {
    log('▶ signing in with an email');
    await openWallet(page);
    await waitSheet(page, /Continue with email/);
    check(await page.$eval('[data-act="email"]', (el) => el.classList.contains('gold')), 'with no wallet app, email is the main (gold) button');
    check((await magic(page)) === null, 'the SDK is not loaded until it is wanted');

    await page.click('[data-act="email"]');
    await waitSheet(page, /Send me a code/);
    check((await sheetName(page)) === 'email', 'the email sheet opens');
    check(/Moonshard never sees it/.test(await sheetText(page)), 'and says where the address goes');

    await fieldValue(page, 'email', 'nope');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /doesn't look like an email/);
    check((await magic(page)) === null, 'a bad address is refused before anything is sent');

    await fieldValue(page, 'email', 'player@example.com');
    await page.keyboard.press('Enter'); // the keyboard's Go / Enter sends the form like the button
    await waitSheet(page, /We sent a 6-digit code to/);
    check(/player@example\.com/.test(await sheetText(page)), 'the code step names the address');
    let m = await magic(page);
    check(JSON.stringify(m.logins) === JSON.stringify([{ email: 'player@example.com', showUI: false }]), `Magic was asked to sign in with its own UI off (${JSON.stringify(m.logins)})`);
    check(m.constructed[0].key === 'pk_test_FAKE' && m.constructed[0].options.network.chainId === 42220 && /^https:\/\/forno\.celo\.org/.test(m.constructed[0].options.network.rpcUrl), `Magic was set up for Celo with the game's key (${JSON.stringify(m.constructed[0])})`);

    await fieldValue(page, 'code', '12');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /code is 6 digits/);
    await fieldValue(page, 'code', '000000');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /That code isn't right/);
    check(!(await page.evaluate(() => localStorage.getItem('fake.magic.email'))), 'a wrong code does not sign in');

    await fieldValue(page, 'code', '123456');
    await page.click('#ms-sheets button[type="submit"]');
    check(await waitSheet(page, /Verified human/), 'the right code connects, and the wallet\'s sheet is back, signed in');
    check((await sheetName(page)) === 'wallet', 'as the wallet sheet');
    check(api.signedInAs === MAGIC_ADDRESS, `the game signed in as the wallet Magic made (${api.signedInAs})`);
    m = await magic(page);
    check(m.calls.includes('personal_sign'), 'the sign-in message was signed by it');

    log('▶ a reload');
    await page.evaluate(() => { window.__magic = null; });
    await g.goto();
    await page.waitForFunction(() => window.gdService?.getStatus().connected === true, null, { timeout: 15_000 });
    const status = await page.evaluate(() => { const s = window.gdService.getStatus(); return { connected: s.connected, needsReconnect: s.needsReconnect, address: s.address }; });
    check(status.connected && !status.needsReconnect && status.address === MAGIC_ADDRESS, `it comes back through the email wallet without a prompt (${JSON.stringify(status)})`);

    log('▶ disconnecting');
    await openWallet(page);
    await waitSheet(page, /Disconnect/);
    await page.click('[data-act="disconnect"]');
    await page.waitForFunction(() => window.gdService.getStatus().connected === false, null, { timeout: 5000 });
    await page.waitForFunction(() => (window.__magic?.logouts ?? 0) === 1, null, { timeout: 5000 }).catch(() => {});
    check((await magic(page)).logouts === 1, 'Magic was told to sign out');
    await g.goto();
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => window.gdService.getStatus().connected) === false, 'and a reload does not sign back in');

    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- Magic forgot the player -----------------------------------------------------------------------------------------------
{
  const { g } = await boot({ VITE_MAGIC_PUBLISHABLE_KEY: 'pk_test_FAKE' });
  const { page } = g;
  try {
    log('▶ Magic has signed the player out since their last visit');
    await openWallet(page);
    await waitSheet(page, /Continue with email/);
    await page.click('[data-act="email"]');
    await waitSheet(page, /Send me a code/);
    await fieldValue(page, 'email', 'player@example.com');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /We sent a 6-digit code/);
    await fieldValue(page, 'code', '123456');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /Verified human/);
    await page.evaluate(() => { localStorage.removeItem('fake.magic.email'); }); // what Magic forgetting the player looks like
    await g.goto();
    await page.waitForFunction(() => window.gdService?.getStatus().needsReconnect === true, null, { timeout: 15_000 });
    await openWallet(page);
    await waitSheet(page, /Reconnect wallet/);
    await page.click('[data-act="reconnect"]');
    check(await waitSheet(page, /Send me a code/), 'Reconnect asks them to sign in again, with the email sheet');
    check((await sheetName(page)) === 'email', 'rather than failing with an error they cannot fix');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- backing out, and a different email ------------------------------------------------------------------------------------
{
  const { g } = await boot({ VITE_MAGIC_PUBLISHABLE_KEY: 'pk_test_FAKE' });
  const { page } = g;
  try {
    log('▶ backing out');
    await openWallet(page);
    await waitSheet(page, /Continue with email/);
    await page.click('[data-act="email"]');
    await waitSheet(page, /Send me a code/);
    await page.click('#ms-sheets [data-act="back"]');
    check(await waitSheet(page, /Continue with email/) && (await sheetName(page)) === 'wallet', 'Back from the first step returns to the wallet');

    await page.click('[data-act="email"]');
    await waitSheet(page, /Send me a code/);
    await fieldValue(page, 'email', 'a@b.co');
    await page.click('#ms-sheets button[type="submit"]');
    await waitSheet(page, /We sent a 6-digit code/);
    await page.click('#ms-sheets [data-act="back"]');
    check(await waitSheet(page, /Send me a code/), '"Use a different email" returns to the first step');
    check((await page.$eval('#ms-sheets input[name="email"]', (el) => el.value)) === 'a@b.co', 'with what they typed kept, to fix a typo');
    await page.click('#ms-sheets [data-sheet="close"]');
    check(await waitSheet(page, /Continue with email/), 'closing the sheet also returns to the wallet');
    check(((await magic(page)).calls ?? []).filter((c) => c === 'emit cancel ').length >= 1, 'and the unfinished sign-in was cancelled at Magic');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ email-login check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ email-login check passed');

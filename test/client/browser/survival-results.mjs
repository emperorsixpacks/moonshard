// What the Survival game-over screen tells a connected player, against a stubbed API (real browser, real scene, real timers).
//   node test/client/browser/survival-results.mjs        (about 2 minutes: it waits out the 9 s request timeout on purpose)
//
// M5  the screen opens at once with "Submitting run...", and a slow answer is never reported as "Offline"
// M6  a run that could not be recorded says why (signed out, busy, wallet connected mid-run)
// M8  Shards are only called "pending G$" when the server accepted a verified, unflagged run
// L6  an exception while building the result still leaves a screen with a way out
import assert from 'node:assert/strict';
import { bootGame, inScene } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const g = await bootGame({ api: true, init: sessionInit() });
const { page } = g;
const api = await installApi(page);
const failures = [];
const log = (...a) => console.log(...a);
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log('   ✓', message); };
const wait = (ms) => page.waitForTimeout(ms);

// the result text, found by what it says (so the same check runs against any version of the scene)
const details = () => inScene(page, 'SurvivalScene', (s) => s.children.list.find((o) => o.type === 'Text' && o.active && o.text.startsWith('Time Survived:'))?.text ?? null);
const lines = async () => (await details())?.split('\n') ?? [];
const label = async () => (await lines()).at(-1);
const shardsLineOf = async () => (await lines())[2];
const hasExit = () => inScene(page, 'SurvivalScene', (s) => Boolean(s.modalButtons?.retry?.rect?.active && s.modalButtons?.menu?.rect?.active));

/** A server that handles a submit at once but may answer late; a repeated submit of a run finds it already submitted. */
function submitBehaviour({ delayMs = 0, body, status = 200 } = {}) {
  const handled = new Set();
  api.handlers.submit = async ({ call }) => {
    const id = call.path.split('/')[2];
    if (handled.has(id)) return { status: 409, body: { error: 'already_submitted' } };
    handled.add(id);
    return { delayMs, status, body };
  };
}
const ranked = { ok: true, isNewBest: true, rankedOk: true, bossCleared: false, flags: [], rank: { open: 2, ranked: 2 } };

let bestScore = 0;
async function playAndDie({ shards = 0, beatBest = false } = {}) {
  await g.startScene('SurvivalScene');
  await wait(1_800); // the run ticket arrives and a little time passes
  // The local record only keeps the day's best score, so a run whose status we want to see stored has to beat it.
  if (beatBest) bestScore += 500;
  await inScene(page, 'SurvivalScene', (s, [n, score]) => {
    s.sessionCrystalsCollected = n;
    if (score) s.totalScore = score;
    s.handleGameOver();
  }, [shards, beatBest ? bestScore : 0]);
  await wait(300);
}

try {
  await g.goto();
  await page.waitForFunction(() => window.gdService?.getStatus().connected && window.gdService.getStatus().verified, null, { timeout: 30_000 });

  log('▶ M5: the submit answers 6 s late (inside the 9 s timeout)');
  submitBehaviour({ delayMs: 6_000, body: ranked });
  await playAndDie();
  check((await label()) === 'Submitting run...', `the screen opens at once saying "Submitting run..." (saw "${await label()}")`);
  check(await hasExit(), 'RETRY and MAIN MENU are there while waiting');
  await wait(7_000);
  check((await label()) === 'Ranked — #2 (New Best)', `then it shows the server's answer (saw "${await label()}")`);

  log('▶ M5: the answer is lost (the client gives up at 9 s; the server had recorded the run)');
  submitBehaviour({ delayMs: 60_000, body: ranked });
  await playAndDie({ beatBest: true });
  await wait(10_500); // past the old 9 s race, which printed "Run Not Recorded (Offline)" here
  const lostAnswer = await label();
  check(!/Offline|Not Recorded/i.test(lostAnswer), `no "Offline" for a run that was recorded (saw "${lostAnswer}")`);
  check(/Run Recorded/.test(lostAnswer), 'the retry found the run already submitted and says it was recorded');
  check(api.callsTo(/\/submit$/).slice(-2).length === 2 && api.callsTo(/\/submit$/).slice(-2)[0].path === api.callsTo(/\/submit$/).slice(-2)[1].path, 'the submit was retried once, on the same run');
  const stored = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('MOONSHARD_SAVE_V1')).dailyRecords).at(-1)?.details?.status);
  check(/Run Recorded/.test(stored || ''), `the local record carries the final status, not "Offline" (stored "${stored}")`);

  log('▶ M5: nothing answers for 20+ seconds');
  let hangs = 2;
  api.handlers.checkpoints = async () => (hangs-- > 0 ? { hang: true } : { body: { ok: true } });
  // two closing checkpoints time out (9 s each), then the submit takes 6 s: the answer arrives after about 24 s
  submitBehaviour({ delayMs: 6_000, body: ranked });
  await playAndDie();
  await wait(19_000);
  check((await label()) === 'Submitting run...', `still "Submitting run..." at 19 s (saw "${await label()}")`);
  await wait(1_800);
  check(/Still submitting/.test(await label()), `after 20 s it says it is still submitting (saw "${await label()}")`);
  await wait(6_500);
  check(/Ranked|Open Board|Run Recorded/.test(await label()), `and updates when the answer comes (saw "${await label()}")`);
  api.handlers.checkpoints = async () => ({ body: { ok: true, accepted: 1, duplicates: 0 } });

  log('▶ M6: why a run was not recorded');
  api.handlers.start = async () => ({ status: 401, body: { error: 'invalid_session' } });
  await playAndDie();
  // the 401 is reported to the session layer, which ends the session: the screen says so instead of "Signed Out"
  check((await label()) === 'Session Ended — Reconnect to Compete', `start refused with 401 (saw "${await label()}")`);
  check(await page.evaluate(() => window.gdService.getStatus().sessionExpired === true), 'the session layer was told the session is over');
  // sign in again for the cases that follow (the seeded session is restored on reload)
  await g.goto();
  await page.waitForFunction(() => window.gdService?.getStatus().connected && window.gdService.getStatus().verified, null, { timeout: 30_000 });
  api.handlers.start = async () => ({ status: 429, body: { error: 'rate_limited' } });
  await playAndDie();
  check((await label()) === 'Run Not Recorded (Server Busy)', `start refused with 429 (saw "${await label()}")`);
  api.handlers.start = async () => ({ body: null });
  // The wallet connected after the run began: no token when the run starts, a session by the time it ends.
  await page.evaluate(() => localStorage.removeItem('moonshard.session.v1'));
  await g.startScene('SurvivalScene');
  await wait(1_500);
  await page.evaluate(() => localStorage.setItem('moonshard.session.v1', JSON.stringify({ token: 'late', address: '0x1111111111111111111111111111111111111111', host: 'web', expiresAt: Date.now() + 3_600_000 })));
  await inScene(page, 'SurvivalScene', (s) => s.handleGameOver());
  await wait(300);
  check((await label()) === 'Run Not Recorded (Wallet Connected Mid-Run)', `connected after the run began (saw "${await label()}")`);
  await page.evaluate(() => localStorage.setItem('moonshard.session.v1', JSON.stringify({ token: 'test-token', address: '0x1111111111111111111111111111111111111111', host: 'web', expiresAt: Date.now() + 3_600_000 })));

  log('▶ M8: Shard Harvest copy follows what the server accepted');
  api.handlers.start = async () => ({ body: null });
  submitBehaviour({ body: ranked });
  await playAndDie({ shards: 3 });
  await wait(500);
  check(/\+6 G\$ pending \(3 Shards\)/.test(await shardsLineOf()), `accepted run: "${await shardsLineOf()}"`);

  submitBehaviour({ body: { ...ranked, rankedOk: false, isNewBest: false, flags: ['cp_regress'] } });
  await playAndDie({ shards: 3 });
  await wait(500);
  check(/not banked/.test(await shardsLineOf()) && !/pending/.test(await shardsLineOf()), `flagged run: "${await shardsLineOf()}"`);
  check(/flagged/.test(await label()), `flagged label: "${await label()}"`);

  submitBehaviour({ status: 400, body: { error: 'invalid_score_rate' } });
  await playAndDie({ shards: 3 });
  await wait(500);
  check(/not banked/.test(await shardsLineOf()) && !/pending/.test(await shardsLineOf()), `refused run: "${await shardsLineOf()}"`);
  check(/Run Not Recorded \(invalid_score_rate\)/.test(await label()), `refused label: "${await label()}"`);

  api.verified = false;
  await page.evaluate(() => window.gdService.fetchIdentity(true));
  submitBehaviour({ body: { ...ranked, rankedOk: false, isNewBest: false } });
  await playAndDie({ shards: 3 });
  await wait(500);
  check(/Verify you are human/.test(await shardsLineOf()) && !/pending/.test(await shardsLineOf()), `unverified player: "${await shardsLineOf()}"`);
  api.verified = true;
  await page.evaluate(() => window.gdService.fetchIdentity(true));

  log('▶ L6: an exception while building the result still leaves a screen with a way out');
  await g.startScene('SurvivalScene');
  await wait(1_000);
  await page.evaluate(() => { window.__realGetStatus = window.gdService.getStatus; window.gdService.getStatus = () => { throw new Error('boom'); }; });
  await inScene(page, 'SurvivalScene', (s) => s.handleGameOver());
  await wait(500);
  await page.evaluate(() => { window.gdService.getStatus = window.__realGetStatus; });
  check(Boolean(await details()), 'the result screen is shown');
  check((await label()) === 'Run Not Recorded', `with an honest label (saw "${await label()}")`);
  check(await hasExit(), 'and RETRY / MAIN MENU exist');

  log('▶ no session: the invitation is unchanged');
  await page.evaluate(() => window.gdService.dropSession());
  await playAndDie({ shards: 2 });
  check((await label()) === 'Not Ranked — Connect Wallet to Compete', `label "${await label()}"`);
  check(/Connect a wallet and verify/.test(await shardsLineOf()), `shards line "${await shardsLineOf()}"`);

  const pageErrors = g.errors.filter((e) => !/boom/.test(e));
  check(pageErrors.length === 0, `no unexpected browser errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
  assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
  log('\n✅ survival results passed');
} catch (err) {
  console.error('\n❌ survival results failed');
  console.error(err.message, failures.length ? `\n - ${failures.join('\n - ')}` : '');
  process.exitCode = 1;
} finally {
  await g.close();
}

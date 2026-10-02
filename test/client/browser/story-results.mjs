// What the Story scene does with the end of a run, against a stubbed API that follows the server's run rules
// (real browser, real scene, real timers).    node test/client/browser/story-results.mjs
//
// M3  one settlement per run: a hazard after the shrine is cleansed neither submits twice nor stacks a game-over screen
//     over the victory banner, and a kill or shard after the finish cannot push a checkpoint above the submitted totals
// M4  the next run (retry, next chapter) starts only after the previous run's submit has landed, so it cannot void it
// M8  the victory banner and the death screen promise only what the server accepted, and print no made-up bounty amount
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
const story = (fn, arg) => inScene(page, 'StoryScene', fn, arg);

/** Everything the player can read in the scene, containers included. */
const texts = () => story((s) => {
  const out = [];
  const walk = (list) => { for (const o of list) { if (o.type === 'Text' && o.active && o.visible) out.push(o.text); else if (o.list) walk(o.list); } };
  walk(s.children.list);
  return out;
});
const screenText = async () => (await texts()).join('\n');

const lastRun = () => api.runList().at(-1);
const submitsOf = (id) => api.calls.filter((c) => c.path === `/runs/${id}/submit`);
const checkpointPointsOf = (id) => api.calls.filter((c) => c.path === `/runs/${id}/checkpoints`).flatMap((c) => c.body.points);

async function startStory(chapter = 1) {
  // a retry reopens the chapter's opening dialogue; a scenario that left it open must not leak into the next one
  await page.evaluate(() => { const s = window.game.scene.getScene('StoryScene'); if (s) { s.dialogueBox = null; s.chapterIntroCard = null; } });
  await g.startScene('StoryScene', { chapter, skipIntroCard: true, skipDialogue: true });
  await wait(1_500); // the ticket arrives and a little time passes
}
const win = (kills = 5, shards = 0) => story((s, [k, n]) => { s.killsCount = k; s.sessionCrystalsCollected = n; s.triggerChapterVictory(); }, [kills, shards]);
const skipDialogueToBanner = async () => { await wait(300); await story((s) => s.dialogueBox?.skipAll()); await wait(900); };
const die = (kills = 5, shards = 0) => story((s, [k, n]) => { s.killsCount = k; s.sessionCrystalsCollected = n; s.handlePlayerGameOver(); }, [kills, shards]);

try {
  await g.goto();
  await page.waitForFunction(() => window.gdService?.getStatus().connected && window.gdService.getStatus().verified, null, { timeout: 30_000 });

  log('▶ M3: the shrine is cleansed, then a hazard kills the hero while the banner is up');
  await startStory();
  await win(5, 2);
  const runId = lastRun().runId;
  await wait(300);
  await skipDialogueToBanner();
  await story((s) => s.handlePlayerGameOver());
  await wait(1_000);
  const screen = await screenText();
  check(!/YOU FELL IN BATTLE/.test(screen), 'no game-over screen on top of the victory banner');
  check(/SHRINE CLEANSED/.test(screen), 'the victory banner is still there');
  check(submitsOf(runId).length === 1 && submitsOf(runId)[0]?.body.bossCleared === true, `one submit, as a boss clear (${submitsOf(runId).length} submits)`);

  log('▶ M3: the same on a slow API, while the first settlement is still under way');
  api.latencyMs = 300;
  await startStory();
  await wait(800);
  await story((s) => { s.killsCount = 5; s.sessionCrystalsCollected = 2; s.triggerChapterVictory(); s.handlePlayerGameOver(); });
  const slowRun = lastRun().runId;
  await wait(4_000);
  check(submitsOf(slowRun).length === 1, `the ticket is submitted once (${submitsOf(slowRun).length} submits: ${JSON.stringify(submitsOf(slowRun).map((c) => c.body.bossCleared))})`);
  check(submitsOf(slowRun)[0]?.body.bossCleared === true, 'and as the boss clear that happened first');
  check(api.runs.get(slowRun).status === 'submitted', 'the server holds it as submitted');
  api.latencyMs = 0;

  log('▶ M3: kills and shards collected after the finish, while a periodic checkpoint is in flight');
  api.handlers.checkpoints = async () => ({ delayMs: 1_500, body: { ok: true, accepted: 1, duplicates: 0 } });
  await startStory();
  // the hero idles for up to 16 s of real time here; on a loaded machine that is long enough for the foes to reach and kill
  // it, and the submit would then carry the totals at its death instead of the scripted ones
  await story((s) => { if (s.player) s.player.invulnerableUntil = Infinity; });
  const before = api.callsTo(/\/checkpoints$/).length;
  for (let i = 0; i < 160 && api.callsTo(/\/checkpoints$/).length === before; i += 1) await wait(100); // the 10 s checkpoint goes out
  const lateRun = lastRun().runId;
  await story((s) => { s.killsCount = 5; s.sessionCrystalsCollected = 2; s.triggerChapterVictory(); s.killsCount = 8; s.sessionCrystalsCollected = 4; });
  await wait(4_500);
  const lateSubmit = submitsOf(lateRun)[0]?.body;
  check(lateSubmit?.kills === 5 && lateSubmit?.shards === 2, `submitted the totals at the finish (${lateSubmit?.kills} kills / ${lateSubmit?.shards} shards; submit: ${JSON.stringify(lateSubmit)})`);
  check(checkpointPointsOf(lateRun).every((p) => p.kills <= lateSubmit.kills && p.shards <= lateSubmit.shards),
    `no checkpoint is above them: ${JSON.stringify(checkpointPointsOf(lateRun).map((p) => [p.kills, p.shards]))}`);
  api.handlers.checkpoints = async () => ({ body: { ok: true, accepted: 1, duplicates: 0 } });

  log('▶ M4: retry 380 ms after dying, on a network with a 250 ms one-way delay');
  api.latencyMs = 250;
  await startStory();
  await wait(800);
  await die(5, 1);
  const dyingRun = lastRun().runId;
  await wait(380);
  await story((s) => s.gameOverRetryCallback());
  await wait(5_000);
  check(api.runs.get(dyingRun).status === 'submitted', `the life that just ended was recorded, not voided (server says "${api.runs.get(dyingRun).status}")`);
  const starts = api.callsTo(/^\/runs\/start$/);
  const lastSubmit = submitsOf(dyingRun).at(-1);
  check(starts.at(-1).at >= lastSubmit.at, 'the new run was requested only after the old submit had arrived');
  check(api.runList().at(-1).status === 'open', 'and the new run is the open one');

  log('▶ M4: next chapter, victory with a slow submit');
  api.latencyMs = 250;
  await startStory(1);
  await wait(500);
  await win(5, 0);
  const wonRun = lastRun().runId;
  await skipDialogueToBanner();
  await story((s) => s.victoryAdvanceCallback());
  await wait(5_000);
  check(api.runs.get(wonRun).status === 'submitted' && api.runs.get(wonRun).submit?.bossCleared === true, `the boss clear was recorded before chapter 2 began (server says "${api.runs.get(wonRun).status}")`);
  api.latencyMs = 0;

  log('▶ M4/M8: a late answer for the life that ended must not paint the next life\'s banner');
  // life 1 dies and its submit takes 6 s; the retry starts life 2, whose start waits for it (4 s cap) and which wins at once
  api.handlers.submit = async ({ call }) => (call.body.bossCleared
    ? { delayMs: 4_000, body: { ok: true, rankedOk: true, bossCleared: true, flags: [], rank: null } }
    : { delayMs: 6_000, body: { ok: true, rankedOk: true, bossCleared: false, flags: [], rank: null } });
  await startStory();
  await wait(500);
  await die(5, 0);
  await wait(400); // the game-over screen ignores input for 350 ms
  await story((s) => s.gameOverRetryCallback());
  await wait(5_300); // life 2's ticket arrives about 4 s after its start, when the wait for life 1 gives up
  await story((s) => { s.killsCount = 6; s.triggerChapterVictory(); });
  await skipDialogueToBanner();
  await wait(1_300); // life 1's answer (6 s after its death) has arrived by now; life 2's own is still on its way
  const waiting = await screenText();
  check(/SAVING YOUR RUN/.test(waiting) && !/BOUNTY NOT RECORDED/.test(waiting), `the banner still waits for its own answer (saw "${waiting.split('\n').find((l) => /SAVING|BOUNTY|SLAIN|RECORDED/i.test(l)) ?? ''}")`);
  await wait(4_000);
  const answered = await screenText();
  check(/BOSS SLAIN! CLAIM 2,400 G\$/.test(answered), 'and shows it when it comes');

  log('▶ M8: the victory banner');
  const banner = async (submitHandler) => {
    if (submitHandler) api.handlers.submit = submitHandler;
    await startStory();
    await win(5, 2);
    await skipDialogueToBanner();
    await wait(600);
    return screenText();
  };
  const accepted = async ({ call, run }) => ({ body: { ok: true, isNewBest: false, rankedOk: true, bossCleared: call.body.bossCleared === true, flags: [], rank: null } });
  let t = await banner(accepted);
  check(/BOSS SLAIN! CLAIM 2,400 G\$ IN THE G\$ WALLET/.test(t), 'accepted boss clear: the amount is the one the server reported');
  check(!/5000|5,000/.test(t), 'and the made-up 5000 is gone');
  check(/\+4 G\$ PENDING \(2 SHARDS\)/.test(t), 'with the shard line below it');

  // GoodDollar has not approved the app yet: the contract refuses claims, so the banner must not tell the player to claim
  Object.assign(api.engagement, { canClaim: false, reason: 'not_claimable', rewardG: null });
  await page.evaluate(() => window.gdService.refreshAll());
  t = await banner(accepted);
  check(/BOSS SLAIN! THE FIRST-BOSS BOUNTY CAN'T BE CLAIMED RIGHT NOW/.test(t) && !/CLAIM [\d,]+ G\$|IN THE G\$ WALLET/.test(t), `an app that is not approved yet: no promise to claim (saw "${t.split('\n').find((l) => /BOSS SLAIN/.test(l))}")`);
  Object.assign(api.engagement, { canClaim: true, reason: null, rewardG: '2400' });
  await page.evaluate(() => window.gdService.refreshAll());

  t = await banner(async () => ({ status: 400, body: { error: 'invalid_score_rate' } }));
  check(/BOUNTY NOT RECORDED/.test(t) && !/BOSS SLAIN|CLAIM/.test(t), 'a refused submit says the bounty was not recorded');
  check(!/SHARD HARVEST BANKED|PENDING/.test(t), 'and no shard promise');

  t = await banner(async () => ({ body: { ok: true, rankedOk: false, bossCleared: false, flags: ['boss_low_coverage'], rank: null } }));
  check(/BOUNTY NOT RECORDED: THE RUN WAS FLAGGED/.test(t) && !/BOSS SLAIN|CLAIM/.test(t), 'a flagged boss kill is not a bounty');
  check(/2 SHARDS NOT BANKED/.test(t) && !/PENDING/.test(t), 'and its shards are not promised either');

  api.handlers.submit = async () => ({ delayMs: 60_000, body: {} });
  await startStory();
  await win(5, 2);
  await skipDialogueToBanner();
  t = await screenText();
  check(/SAVING YOUR RUN/.test(t) && !/CLAIM|PENDING/.test(t), 'while the run is being saved the banner promises nothing');
  api.handlers.submit = accepted;
  // That submit never answers; the client gives up on it after 9 s and finds the run already submitted. Until then the next
  // run's start() waits (up to 4 s) for it, so let it finish before the next scenario kills the hero 1.5 s into its run.
  await wait(9_500);

  log('▶ M8: the death screen');
  const deathScreen = async (submitHandler, shards = 2) => {
    if (submitHandler) api.handlers.submit = submitHandler;
    await startStory();
    await die(5, shards);
    await wait(900);
    return screenText();
  };
  t = await deathScreen(accepted);
  check(/\+4 G\$ PENDING \(2 SHARDS\)/i.test(t), 'accepted run: shards pending');
  t = await deathScreen(async () => ({ status: 400, body: { error: 'shard_count_anomaly' } }));
  check(/NOT BANKED/i.test(t) && !/G\$ PENDING/i.test(t), 'refused run: not banked, no pending');
  t = await deathScreen(async () => ({ body: { ok: true, rankedOk: false, bossCleared: false, flags: ['cp_regress'], rank: null } }));
  check(/NOT BANKED/i.test(t) && !/G\$ PENDING/i.test(t), 'flagged run: not banked, no pending');

  log('▶ M8: no session (anonymous)');
  await page.evaluate(() => window.gdService.dropSession());
  await startStory();
  await win(5, 2);
  await skipDialogueToBanner();
  t = await screenText();
  check(/CONNECT & VERIFY TO EARN BOSS BOUNTIES IN FUTURE RUNS/.test(t), 'anonymous victory: an invitation, not a claim');
  check(!/\d,?\d{3} G\$|5000/.test(t) && !/PENDING/.test(t), 'with no amount and no pending G$');
  t = await deathScreen(undefined, 2);
  check(!/G\$ PENDING/i.test(t), 'anonymous death: no pending G$');
  check(/CONNECT A WALLET|Connect a wallet/i.test(t), 'but a way forward');

  check(g.errors.length === 0, `no browser errors${g.errors.length ? `: ${g.errors.join(' | ')}` : ''}`);
  assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
  log('\n✅ story results passed');
} catch (err) {
  console.error('\n❌ story results failed');
  console.error(err.message, failures.length ? `\n - ${failures.join('\n - ')}` : '');
  process.exitCode = 1;
} finally {
  await g.close();
}

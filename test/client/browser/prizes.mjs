// Prizes switched off on the server (PRIZES_ENABLED, the deployed default), in a real browser: nothing in the game promises
// or pays them. No Shards drop and the Shard counter is gone, the result screen has no Shard line, the wallet panel has no
// Spoils, "How G$ works" names only the bounty, and the leaderboard has no Spoils button or footer. The daily claim, the blade and
// the bounty are not prizes and stay. (With prizes on, the other browser checks cover them.)
//   node test/client/browser/prizes.mjs        (run from the repository root)
import { bootGame, closeSheet, inScene, sceneTexts, settled, sheetText, waitSheet } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const g = await bootGame({ api: true, init: sessionInit() });
try {
  await installApi(g.page, { verified: true, prizes: false });
  await g.goto();
  await g.page.waitForTimeout(1_000); // the server's settings arrive right after start-up; the first check below confirms it

  log('▶ Endless');
  await g.startScene('SurvivalScene');
  await settled(g.page, 'SurvivalScene');
  check(await inScene(g.page, 'SurvivalScene', (scene) => scene.prizesOn === false), 'the scene knows prizes are off');
  check(await inScene(g.page, 'SurvivalScene', (scene) => scene.txtHarvest.visible === false), 'no Shard Harvest counter on the HUD');
  const drops = await inScene(g.page, 'SurvivalScene', (scene) => {
    for (let i = 0; i < 80; i++) scene.onCrateBroken({ x: scene.player.x, y: scene.player.y });
    return scene.shardDrops.getLength();
  });
  check(drops === 0, `no Shards drop (${drops} after 80 broken crates)`);
  const details = await inScene(g.page, 'SurvivalScene', (scene) => scene.gameOverDetailsText({ shards: 0, result: null, label: 'Run recorded' }));
  check(!/Shard/.test(details) && !/\n\n/.test(details), 'the result screen has no Shard line, and no gap where it was');

  log('▶ the wallet and "How G$ works"');
  await g.startScene('MenuScene');
  await g.page.evaluate(() => window.__gdPanel.open());
  check(await waitSheet(g.page, /Verified human/), 'the wallet opens');
  const panel = await sheetText(g.page);
  check(!/Spoils|Shards today/.test(panel), 'no Spoils section and no Shard line');
  check(/First-boss bounty/.test(panel), 'the bounty stays (GoodDollar pays it)');
  await g.page.click('#ms-sheets details.how summary');
  check(await waitSheet(g.page, /bounty for your first boss|First-boss bounty:/), 'the card names the bounty as what there is to win');
  check(!/Daily prizes|Shard Harvest|top 3/.test(await sheetText(g.page)), 'and no daily prizes or Shard Harvest');
  await closeSheet(g.page);

  log('▶ the leaderboard');
  await g.startScene('LeaderboardScene');
  await g.page.waitForFunction(() => window.game.scene.getScene('LeaderboardScene')?.boardsReady, null, { timeout: 20_000 });
  await inScene(g.page, 'LeaderboardScene', (scene) => scene.setActiveTab('daily'));
  const texts = (await sceneTexts(g.page, 'LeaderboardScene')).join(' | ');
  const spoilsButton = await inScene(g.page, 'LeaderboardScene', (scene) => ({ visible: scene.spoilsTxt.visible, tappable: scene.spoilsBtn.input.enabled }));
  check(!spoilsButton.visible && !spoilsButton.tappable, 'no SPOILS STATUS button, and nothing to tap where it was');
  check(!/Spoils settle/.test(texts), 'no "Spoils settle" footer');
  check(!/Harvest/.test(texts), 'the status pill has no Shard Harvest');
  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} finally { await g.close(); }

if (failures.length) {
  console.log(`\n❌ prizes check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ prizes check passed');

// Endless levels in a real browser, against a stubbed API: the real scene, the real beasts, the real timers.
//   node test/client/browser/levels.mjs        (about 2 minutes: the script places and strikes the foes, the rest is the game)
//
// L1  clearing the foes of a level starts the next one (clear bonus, forest materials, the level in the HUD), also at the end
//     of a realm, where a boss falls and the next realm opens
// L2  a jump through the ladder: the HUD, the banner, the realm's look, the foes of the plan, one boss with a bar of its own
// L3  every beast the ladder can bring spawns where its lane puts it, stays in the world, and falls to a blade
// L4  the shots fly: a shot that joined the projectile group once lost its speed and dropped where it was fired
// L5  flyers stay in the air (a flyer was once given gravity as it joined the group), reach a hero on the floor from where they
//     come in, and the ones that dive come back up
// L6  every level is a scene of its own, put on in full: the sky and the tints, the platforms, the grade and the weather
// L7  a scene goes on behind a curtain that is all the way down when the scene changes, and lifts as the next level begins
// L8  a blade made for a realm hits that realm's beasts harder, and every other beast as it always did
// L9  a helm turns aside the blows of foes, a shield what they throw (each only its own kind)
// L10 a run that ends on level N submits it, and the server's best level reaches the wallet status
// L11 a foe cannot be put out of the hero's reach: the arena's edge holds each one in (a blink or a summon past the wall once
//     left a level that could not end)
// L12 a run left through the menu, or one the server already held, still brings the server's best level to the wallet
// L13 a boss that falls to a stomp is counted and paid like any other kill
// L14 in the Story too: a hazard or a fall is cut by no armour, and what a boss throws is the shield's
import assert from 'node:assert/strict';
import { bootGame, inScene, settled } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';
import { GAME_CONFIG } from '../../../src/config.js';
import { BEASTS, LANES, REALMS, levelClearBonus, levelPlan } from '../../../src/engine/levels.js';
import { cutFor, gearStrip, takenDamage } from '../../../src/engine/gear.js';

const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
const { page } = g;
// the player owns the first helm and the first shield (Leather Cap, Oak Buckler), so the hero wears them from the first level
const api = await installApi(page, { verified: true, owned: ['iron_starter', 'leather_cap', 'oak_buckler'] });
const failures = [];
const log = (...a) => console.log(...a);
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log('   ✓', message); };
const wait = (ms) => page.waitForTimeout(ms);
const inArena = (fn, arg) => inScene(page, 'SurvivalScene', fn, arg);
const inStory = (fn, arg) => inScene(page, 'StoryScene', fn, arg);

/** The hero standing on the floor at `x`: set down above it and left to land (one set down on the floor itself falls through). */
async function stand(x) {
  await inArena((s, at) => { s.player.setPosition(at, 250); s.player.setVelocity(0, 0); }, x);
  await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene').player.body.blocked.down, null, { timeout: 5_000 });
}

/**
 * Where the arena has room for a flyer to come down on a hero: the gap between its ruins (src/engine/PRNG.js: platforms over
 * x 115 to 245 and 310 to 490, their tops at y 252 and 192), and a height of the air lane. A foe a check puts inside a platform
 * is pushed out by the physics, up or down as the frame falls, and what it does after that is not the foe's doing.
 */
const CLEAR_X = 277;
const HOVER_Y = LANES.air.y[1];

/** An arena with nothing in it, no spawner running and a player nothing can hurt: a check places the foes it wants. */
const calm = () => inArena((s) => {
  s.player.invulnerableUntil = 1e12;
  s.isWaveTransitioning = true; // checkSpawnQueue does nothing until a level starts
  (s.waveSpawnTimers ?? []).forEach((t) => t?.remove?.(false));
  s.pendingWaveSpawns = [];
  s.waveSpawnQueue = [];
  s.enemies.getChildren().slice().forEach((e) => e.destroy());
  s.projectiles.getChildren().slice().forEach((p) => p.destroyProj()); // as the scene does: a bomb's fuse goes with it
  s.bossBar?.destroy();
  s.bossBar = null;
  s.player.getAttackDamage = () => 99999;
});

/** The blade strikes every foe alive, through the scene's own attack path, facing each one. Returns how many are left. */
const strike = () => inArena((s) => {
  const p = s.player;
  for (const e of s.getLivingWaveEnemies()) {
    p.isAttacking = true;
    p.attackType = 'slash';
    p.flipX = (e.body ? e.body.center.x : e.x) < p.x;
    s.handlePlayerAttack(e);
  }
  p.isAttacking = false;
  return s.getLivingWaveEnemies().length;
});

/** Strikes every 120 ms until `done(scene)` holds, or `ms` have passed. */
async function fightUntil(done, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await strike();
    if (await inArena(done)) return true;
    await wait(120);
  }
  return inArena(done);
}

/** Strikes until nothing is left alive; true if it got there. */
async function clearOut(tries = 40) {
  for (let i = 0; i < tries; i++) {
    if ((await strike()) === 0) return true;
    await wait(100);
  }
  return false;
}

const hud = () => inArena((s) => ({ level: s.txtWave.text, foes: s.txtFoes.text }));
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('MOONSHARD_SAVE_V1')));
const bank = async () => (await save()).inventory ?? { bark: 0, amber: 0, iron: 0 };

/** Where a beast comes in, from its lane (engine/levels.js LANES), on the right side of the arena. */
function spotOf(type) {
  const lane = BEASTS[type].lane;
  const l = LANES[lane];
  if (lane === 'ground') return { x: l.right[0], y: l.y };
  if (lane === 'shooter') return l.right[0];
  if (lane === 'air') return { x: l.right[0], y: l.y[0] };
  return { x: l.right[0], y: l.y };
}

try {
  await g.goto();
  await page.waitForFunction(() => window.gdService?.getStatus().connected && window.gdService.getStatus().verified, null, { timeout: 30_000 });
  await g.startScene('SurvivalScene');
  await settled(page, 'SurvivalScene', 10);
  check(g.errors.length === 0, `the arena opens with no browser errors ${g.errors.join(' | ')}`);

  log('▶ L1: clearing a level starts the next');
  await calm();
  const before = await bank();
  await inArena((s) => { s.totalScore = 0; s.startLevel(1); });
  let h = await hud();
  check(h.level === 'LEVEL 1' && h.foes === `FOES: ${levelPlan(1).foes}`, `level 1 opens with its ${levelPlan(1).foes} foes (HUD "${h.level}", "${h.foes}")`);
  check(await fightUntil((s) => s.level === 2, 40_000), 'striking every foe down starts level 2 on its own');
  h = await hud();
  check(h.level === 'LEVEL 2' && h.foes === `FOES: ${levelPlan(2).foes}`, `the HUD follows (${h.level}, ${h.foes})`);
  const score = await inArena((s) => s.totalScore);
  check(score >= levelClearBonus(1, 600).total, `the clear bonus was paid (score ${score}, a slow clear pays ${levelClearBonus(1, 600).total})`);
  const after = await bank();
  check(after.bark > before.bark && after.amber >= before.amber && after.iron >= before.iron, `level 1's forest materials were banked (bark ${before.bark} → ${after.bark})`);
  check((await save()).bestLevel >= 2, `this device remembers the depth it reached (level ${(await save()).bestLevel})`);

  log('▶ L1: the end of a realm — a boss falls and the next realm opens');
  await calm();
  await inArena((s) => s.startLevel(10));
  check((await inArena((s) => s.plan.boss?.name)) === levelPlan(10).boss.name, `level 10 is ${levelPlan(10).boss.name}`);
  check(await fightUntil((s) => s.level === 11, 60_000), 'the boss and its retinue fall, and level 11 begins');
  const realm = await inArena((s) => ({ sky: s.bgSky.texture.key, realm: s.realmKey, banner: (s.levelBanner ?? []).map((t) => t.text) }));
  check(realm.realm === 'ruins' && realm.sky === REALMS.ruins.theme.sky, `the arena is dressed for the ruins (${realm.realm}, ${realm.sky})`);
  check(realm.banner[0] === 'ENTERING THE SUNKEN RUINS', `and the banner says so (${realm.banner.join(' / ')})`);
  await wait(3_000); // the VANQUISHED bar fades out
  check(await inArena((s) => !s.bossBar?.active), "the fallen boss's health bar is gone");
  check(await inArena((s) => s.killCount.boss_gorgok >= 1), 'the boss was counted as a kill');

  log('▶ L2: a jump through the ladder');
  const bossHp = [];
  for (const n of [1, 5, 6, 7, 10, 11, 15, 16, 20, 21, 25, 26, 31, 50]) {
    const plan = levelPlan(n);
    await calm();
    await inArena((s, level) => s.startLevel(level), n);
    const now = await inArena((s) => {
      const tree = s.bgTrees[0];
      return {
        level: s.level, hud: [s.txtWave.text, s.txtFoes.text], foes: s.waveRemainingFoes, realm: s.realmKey, sky: s.bgSky.texture.key,
        tree: tree.texture.key, treeShown: tree.visible, woodsTree: tree.woodsKey,
        banner: (s.levelBanner ?? []).map((t) => t.text), bar: Boolean(s.bossBar),
      };
    });
    check(now.level === n && now.hud[0] === `LEVEL ${n}` && now.hud[1] === `FOES: ${plan.foes}` && now.foes === plan.foes, `level ${n} (${plan.name}): HUD ${now.hud.join(', ')}`);
    check(now.banner.includes(`LEVEL ${n}`) && now.banner.includes(plan.name.toUpperCase()), `   its banner names it (${now.banner.join(' / ')})`);
    check((now.banner[0] === `ENTERING ${plan.realmName.toUpperCase()}`) === plan.newRealm, `   and says "ENTERING" only where a realm begins (${plan.newRealm})`);
    check(now.banner.some((t) => t.startsWith('BOSS:')) === Boolean(plan.boss), `   and names the boss only on a boss level (${plan.boss?.name ?? 'none'})`);
    const { theme } = plan;
    const trees = theme === null ? now.treeShown && now.tree === now.woodsTree : (theme.trees.length > 0 ? now.treeShown && now.tree === theme.trees[0] : !now.treeShown);
    check(now.realm === plan.realm && now.sky === (theme?.sky ?? 'sky_backdrop') && trees, `   the arena is dressed for ${plan.realmName} (sky ${now.sky}, trees ${now.treeShown ? now.tree : 'none'})`);
    check(!now.bar, '   and no boss bar is up before the boss spawns');

    if (plan.boss) {
      await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene').enemies.getChildren().some((e) => e.mobType === 'boss_gorgok'), null, { timeout: 15_000 });
      const boss = await inArena((s) => {
        const b = s.enemies.getChildren().find((e) => e.mobType === 'boss_gorgok');
        return {
          name: b.bossName, summon: b.summonType, maxHp: b.maxHp, title: s.bossBar?.titleText.text, active: s.bossBar?.active, linked: b.healthBar === s.bossBar,
          bars: s.children.list.filter((o) => o.type === 'Container' && o.titleText).length,
        };
      });
      check(boss.name === plan.boss.name && boss.summon === plan.boss.summon, `   the boss is ${boss.name}, who calls ${boss.summon}`);
      check(boss.title === `☠ ${plan.boss.name.toUpperCase()} ☠` && boss.bars === 1 && boss.linked && boss.active, `   with one bar of its own (${boss.title}, ${boss.bars} bar)`);
      check(boss.maxHp === Math.max(1, Math.round(GAME_CONFIG.MOBS.BOSS_GORGOK.HP * plan.hpMul)), `   and ${boss.maxHp} health (the boss's ${GAME_CONFIG.MOBS.BOSS_GORGOK.HP} × ${plan.hpMul})`);
      bossHp.push(boss.maxHp);
    }
  }
  check(bossHp.every((hp, i) => i === 0 || hp > bossHp[i - 1]), `each boss is stronger than the one before (${bossHp.join(', ')})`);

  log('▶ L3: every beast runs in the arena and falls to a blade');
  for (const type of Object.keys(BEASTS)) {
    await calm();
    const spot = spotOf(type);
    await stand(150);
    await inArena((s, [t, x, y]) => { window.__beast = s.spawnEnemy(t, x, y, 1, {}); }, [type, spot.x, spot.y]);
    await wait(1_400);
    const alive = await inArena((s) => {
      const e = window.__beast;
      const finite = [e.x, e.y, e.body.velocity.x, e.body.velocity.y].every(Number.isFinite);
      return { active: e.active, type: e.mobType, state: e.state, x: e.x, y: e.y, hp: e.hp, finite, width: s.arenaWidth, height: s.arenaHeight, gravity: e.body.allowGravity };
    });
    check(alive.active && alive.type === type && alive.finite && alive.hp > 0, `${BEASTS[type].name} spawns (${alive.state}, at ${Math.round(alive.x)}, ${Math.round(alive.y)})`);
    check(alive.x > -5 && alive.x < alive.width + 5 && alive.y > 0 && alive.y < alive.height, '   inside the arena');
    if (BEASTS[type].kind === 'flyer') check(alive.gravity === false, '   with nothing pulling it down');
    if (['hornet_guard', 'cinder_drake', 'dread_bat'].includes(type)) check(Math.abs(alive.y - spot.y) < 45, `   and still up where it came in (${Math.round(alive.y)}, from ${spot.y})`);
    const kills = await inArena((s) => s.killCount.total);
    check(await clearOut(), '   and it falls to the blade');
    check((await inArena((s) => s.killCount.total)) === kills + 1, '   as one kill');
    await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene').enemies.getChildren().every((e) => !e.active), null, { timeout: 8_000 })
      .then(() => check(true, '   and leaves nothing behind'), () => check(false, `${BEASTS[type].name} was struck down but is still in the arena`));
  }

  log('▶ L4: the shots fly');
  // [beast, where it stands, the shot it fires, whether the shot flies straight]; the hero stands at x 300, in reach of each
  const SHOOTERS = [
    ['mushroom', { x: 440, y: 300 }, 'spore', false],
    ['goblin', { x: 440, y: 300 }, 'goblin_bomb', false],
    ['bog_lurker', { x: 440, y: 300 }, 'mud_glob', false],
    ['mirelurker', { x: 450, y: 300 }, 'mud_glob', false],
    ['hornet_guard', { x: 360, y: 135 }, 'hornet_quill', true],
    ['cinder_drake', { x: 360, y: 135 }, 'magma_glob', false],
    ['astral_shade', { x: 440, y: 300 }, 'lunar_crescent', true],
  ];
  for (const [type, at, kind, straight] of SHOOTERS) {
    await calm();
    await stand(300);
    await inArena((s, [t, spot]) => {
      window.__beast = s.spawnEnemy(t, spot.x, spot.y, 1, {});
      window.__shots = [];
      const seen = new WeakSet();
      clearInterval(window.__watch);
      window.__watch = setInterval(() => {
        for (const p of s.projectiles.getChildren()) {
          if (!p.active || !p.body || seen.has(p)) continue;
          seen.add(p);
          window.__shots.push({ kind: p.projType, x0: p.x, y0: p.y, vx0: p.body.velocity.x, vy0: p.body.velocity.y, ref: p });
        }
      }, 16);
    }, [type, at]);
    const fired = await page.waitForFunction((k) => window.__shots.some((x) => x.kind === k), kind, { timeout: 9_000 }).then(() => true, () => false);
    check(fired, `${BEASTS[type].name} fires a ${kind}`);
    if (!fired) continue;
    await wait(220);
    const shot = await page.evaluate((k) => {
      const s = window.__shots.find((x) => x.kind === k);
      const p = s.ref;
      const flying = p.active && p.body;
      return {
        vx0: s.vx0, vy0: s.vy0, vx: flying ? p.body.velocity.x : null, vy: flying ? p.body.velocity.y : null,
        moved: flying ? Math.hypot(p.x - s.x0, p.y - s.y0) : null, gravity: flying ? p.body.allowGravity : null,
      };
    }, kind);
    check(Math.abs(shot.vx0) >= 100, `   it leaves with speed (${Math.round(shot.vx0)}, ${Math.round(shot.vy0)})`);
    check(shot.moved === null || shot.moved > 20, `   and 220 ms later ${shot.moved === null ? 'it has landed' : `has travelled ${Math.round(shot.moved)} px`}`);
    if (shot.vx !== null) {
      check(straight ? shot.gravity === false && Math.abs(shot.vy - shot.vy0) < 1 : shot.vy > shot.vy0, `   ${straight ? 'in a straight line' : 'in an arc, falling'} (vy ${Math.round(shot.vy0)} → ${Math.round(shot.vy)})`);
    }
    await page.evaluate(() => clearInterval(window.__watch));
  }

  log('▶ L5: flyers that dive come back up');
  // each hovers over the player, which sends it diving; it must climb back to where it hovers (and, for the two that switch
  // gravity on to dive, have it switched off again)
  for (const type of ['hornet_guard', 'cinder_drake', 'dread_bat']) {
    await calm();
    await stand(CLEAR_X);
    await inArena((s, [t, x, y]) => {
      const e = s.spawnEnemy(t, x, y, 1, {});
      window.__trace = [];
      clearInterval(window.__watch);
      window.__watch = setInterval(() => window.__trace.push({ state: e.state, y: e.y, gravity: e.body?.allowGravity }), 30);
    }, [type, CLEAR_X, HOVER_Y]);
    const dove = await page.waitForFunction(() => window.__trace.some((x) => /DIVE/.test(x.state)), null, { timeout: 8_000 }).then(() => true, () => false);
    check(dove, `${BEASTS[type].name} dives on a player below it`);
    const back = await page.waitForFunction((hover) => {
      const t = window.__trace;
      const i = t.findIndex((x) => /DIVE/.test(x.state));
      return i >= 0 && t.slice(i).some((x) => ['HOVER', 'FLY'].includes(x.state) && Math.abs(x.y - hover) < 25);
    }, HOVER_Y, { timeout: 12_000 }).then(() => true, () => false);
    check(back, '   and climbs back to where it hovers');
    if (type !== 'dread_bat') {
      const pulled = await page.evaluate((hover) => {
        const t = window.__trace;
        const i = t.findIndex((x) => /DIVE/.test(x.state));
        const up = t.slice(i).find((x) => ['HOVER', 'FLY'].includes(x.state) && Math.abs(x.y - hover) < 25);
        return up ? up.gravity : null;
      }, HOVER_Y);
      check(pulled === false, '   with nothing pulling it down');
    }
    await page.evaluate(() => clearInterval(window.__watch));
  }

  log('▶ L5: flyers that fight from the air reach a hero on the floor from the height they come in at');
  // at each of the lane's heights, 60 px beside a hero: its shots or its dive must have come within a few seconds (a flyer that
  // comes in much higher is out of its own reach of a hero on the floor: at a height of 95 a hornet only hovers)
  const ENGAGE = { hornet_guard: [/DRILL_DIVE/, 'hornet_quill'], cinder_drake: [/DIVE/, 'magma_glob'], dread_bat: [/SWOOP_DIVE/, null] };
  for (const [type, [dive, shot]] of Object.entries(ENGAGE)) {
    for (const height of LANES.air.y) {
      await calm();
      await stand(300);
      await inArena((s, [t, y]) => {
        const e = s.spawnEnemy(t, 360, y, 1, {});
        window.__seen = new Set();
        clearInterval(window.__watch);
        window.__watch = setInterval(() => {
          window.__seen.add(e.state);
          for (const p of s.projectiles.getChildren()) if (p.active) window.__seen.add(p.projType);
        }, 30);
      }, [type, height]);
      const engaged = await page.waitForFunction(([re, kind]) => [...window.__seen].some((x) => new RegExp(re).test(x) || x === kind), [dive.source, shot], { timeout: 6_000 }).then(() => true, () => false);
      check(engaged, `${BEASTS[type].name} coming in at height ${height} fights a hero on the floor`);
      await page.evaluate(() => clearInterval(window.__watch));
    }
  }

  log('▶ L6: every level is a scene of its own, put on in full');
  // what the arena shows once a level has begun (engine/scenery.js decides it; the scene puts it on, layer by layer)
  const picture = (now) => JSON.stringify([now.sky, now.skyTint, now.tint, now.ground, now.platform, now.grade.fill, now.grade.alpha, now.weather.kind, now.weather.intensity]);
  const looks = {};
  for (const n of [...Array(30).keys()].map((i) => i + 1).concat([31, 36, 50])) {
    const sc = levelPlan(n).scene;
    await calm();
    const now = await inArena((s, level) => {
      s.startLevel(level);
      const backdrop = [s.bgMountains, s.bgFogPines, s.bgMidPines, ...s.bgTrees, ...s.bgBushes];
      const earth = s.children.list.filter((o) => /^(tile_cliff_|prop_(shroom|flower|fern)|plat_)/.test(o.texture?.key ?? ''));
      const platforms = s.raised.flatMap((p) => p.pieces);
      return {
        key: s.sceneKey, shown: s.arenaScene?.key, name: s.arenaScene?.name,
        sky: s.bgSky.texture.key, skyTint: s.bgSky.tintTopLeft, hills: s.bgMountains.visible,
        tint: [...new Set(backdrop.map((o) => o.tintTopLeft))],
        earth: earth.length, ground: [...new Set(earth.map((o) => o.tintTopLeft))],
        raised: s.raised.length, platforms: platforms.length, platform: [...new Set(platforms.map((o) => o.texture.key))], drawn: platforms.every((o) => o.active),
        grade: { fill: s.bgGrade.fillColor, alpha: s.bgGrade.alpha, shown: s.bgGrade.visible, breathing: Boolean(s.gradeBreath) },
        weather: { kind: s.weather.kind, intensity: s.weather.intensity, emitters: s.weather.emitterCount },
        banner: (s.levelBanner ?? []).map((t) => t.text),
      };
    }, n);
    const wrong = [];
    if (now.key !== sc.key || now.shown !== sc.key || now.name !== sc.name) wrong.push('the scene it names');
    if (now.sky !== sc.look.sky || now.skyTint !== (sc.look.skyTint ?? 0xffffff)) wrong.push('the sky');
    if (now.hills !== sc.look.hills) wrong.push('the hills');
    if (now.tint.length !== 1 || now.tint[0] !== (sc.look.tint ?? 0xffffff)) wrong.push('the tint over the backdrop');
    if (now.earth === 0 || now.ground.length !== 1 || now.ground[0] !== sc.look.ground) wrong.push('the tint of the earth');
    if (now.raised === 0 || now.platforms < now.raised || !now.drawn || now.platform.join() !== sc.look.platform) wrong.push('the platforms');
    if (now.grade.fill !== sc.grade.color || Math.abs(now.grade.alpha - sc.grade.alpha) > 0.002 || now.grade.shown !== (sc.grade.alpha > 0 || sc.grade.pulse > 0) || now.grade.breathing !== sc.grade.pulse > 0) wrong.push('the grade');
    if (now.weather.kind !== sc.weather.kind || now.weather.intensity !== sc.weather.intensity || now.weather.emitters !== (sc.weather.kind === 'none' ? 0 : 1)) wrong.push('the weather');
    if (!now.banner.includes(sc.name.toUpperCase()) || !now.banner.includes(`LEVEL ${n}`)) wrong.push('the banner');
    looks[n] = picture(now);
    if (looks[n - 1] && looks[n] === looks[n - 1]) wrong.push(`it looks the same as level ${n - 1}`);
    check(wrong.length === 0, `level ${n}, ${sc.name}: ${sc.weather.kind === 'none' ? 'clear' : `${sc.weather.kind} ${sc.weather.intensity}`}, grade ${sc.grade.alpha}${sc.grade.pulse ? ` ±${sc.grade.pulse}` : ''}${wrong.length ? `; WRONG: ${wrong.join(', ')}` : ''}`);
  }
  check(looks[26] !== looks[6] && looks[31] !== looks[11], 'coming round to a realm again, it is not the scene it was the first time (levels 26 and 6, 31 and 11)');

  log('▶ L7: a scene goes on behind a curtain, and the curtain lifts');
  // a level cleared on an empty arena, down the scene's own path (levelCleared): the curtain falls over the last 650 ms, the next
  // level's scene goes on under it, and the curtain lifts as that level begins
  for (const [from, what] of [[2, 'within the woods (Drifting Mist gives way to the Storm)'], [5, 'from the woods into the hive']]) {
    await calm();
    await inArena((s, n) => { s.startLevel(n); }, from);
    await calm();
    await inArena((s) => {
      const dip = { swaps: [], samples: [], at: performance.now() };
      window.__dip = dip;
      const apply = s.applyScene.bind(s);
      s.applyScene = (scene) => { dip.swaps.push({ key: scene.key, alpha: s.curtain.alpha, at: performance.now() - dip.at }); return apply(scene); };
      clearInterval(window.__watch);
      window.__watch = setInterval(() => dip.samples.push([performance.now() - dip.at, s.curtain.alpha]), 20);
      s.isWaveTransitioning = false;
      s.levelCleared();
    });
    await page.waitForFunction(() => window.__dip.swaps.length > 0, null, { timeout: 8_000 });
    await wait(1_000); // the curtain lifts over 650 ms
    const dip = await page.evaluate(() => {
      clearInterval(window.__watch);
      const s = window.game.scene.getScene('SurvivalScene');
      delete s.applyScene;
      return { ...window.__dip, level: s.level, scene: s.sceneKey, curtain: s.curtain.alpha };
    });
    const next = levelPlan(from + 1).scene;
    const swap = dip.swaps[0];
    check(dip.swaps.length === 1 && swap.key === next.key && dip.level === from + 1 && dip.scene === next.key, `${what}: level ${from + 1} puts on ${next.name}, once`);
    check(swap.alpha >= 0.9, `   behind the curtain (down to ${swap.alpha.toFixed(2)} of 0.96 when the scene changed)`);
    check(dip.samples.filter(([t]) => t < 700).every(([, a]) => a < 0.05), '   after the last foe falls the arena plays in the open for most of a second');
    const lifting = dip.samples.filter(([t]) => t > swap.at);
    check(lifting.length > 10 && lifting.every(([, a], i) => i === 0 || a <= lifting[i - 1][1] + 0.001) && dip.curtain === 0, `   and then the curtain only lifts, to nothing (${dip.curtain})`);
  }

  log('▶ L8: a blade made for a realm hits that realm\'s beasts harder');
  const W = GAME_CONFIG.WEAPONS;
  /** One swing of `blade` at a `type` standing in the arena of `level`, down the scene's own attack path: what the beast was dealt. */
  async function swing(blade, level, type) {
    await calm();
    await inArena((s, n) => { s.startLevel(n); }, level);
    await calm();
    await stand(300);
    return inArena((s, [weapon, mob]) => {
      const p = s.player;
      delete p.getAttackDamage; // the blade's own damage, not the 99999 calm() hands the hero
      p.weaponConfig = weapon;
      s.lastBaneCue = undefined;
      s.children.list.filter((o) => o.type === 'Text' && /^BANE \+/.test(o.text)).forEach((o) => o.destroy()); // the last swing's, still floating
      const e = s.spawnEnemy(mob, 440, 300, 1, {});
      const dealt = [];
      const take = e.takeDamage.bind(e);
      e.takeDamage = (amount, ...rest) => { dealt.push(amount); return take(amount, ...rest); };
      p.isAttacking = true;
      p.attackType = 'slash';
      p.flipX = false;
      s.handlePlayerAttack(e);
      p.isAttacking = false;
      return { dealt, cue: s.children.list.some((o) => o.type === 'Text' && /^BANE \+/.test(o.text)) };
    }, [blade, type]);
  }
  const SLASH = 20; // what Player.getAttackDamage starts from, before the blade's multiplier
  const hitOf = (blade, bane = 1) => Math.round(Math.round(SLASH * blade.damageMul) * bane);
  let blow = await swing(W.MOONSTEEL_BLADE, 6, 'bee');
  check(blow.dealt.length === 1 && blow.dealt[0] === hitOf(W.MOONSTEEL_BLADE, W.MOONSTEEL_BLADE.bane.mul), `the Moonsteel Blade hits a bee of the hive for ${blow.dealt} (x${W.MOONSTEEL_BLADE.damageMul}, then its bane x${W.MOONSTEEL_BLADE.bane.mul})`);
  check(blow.cue, '   and the arena says "BANE +30%"');
  blow = await swing(W.MOONSTEEL_BLADE, 6, 'boar');
  check(blow.dealt.length === 1 && blow.dealt[0] === hitOf(W.MOONSTEEL_BLADE) && !blow.cue, `a boar, which is no beast of the hive, takes ${blow.dealt}: the blade's damage and no more`);
  blow = await swing(W.FOREST_GLAIVE, 3, 'boar');
  check(blow.dealt.length === 1 && blow.dealt[0] === hitOf(W.FOREST_GLAIVE, W.FOREST_GLAIVE.bane.mul) && blow.cue, `the Forest Glaive is the woods' bane: a boar takes ${blow.dealt}`);
  blow = await swing(W.FOREST_GLAIVE, 6, 'bee');
  check(blow.dealt.length === 1 && blow.dealt[0] === hitOf(W.FOREST_GLAIVE) && !blow.cue, `and a bee takes ${blow.dealt} from it, as any blade's plain damage`);
  blow = await swing(W.STARTER, 6, 'bee');
  check(blow.dealt.length === 1 && blow.dealt[0] === SLASH && !blow.cue, `the Rusted Shortsword has no bane: a bee takes ${blow.dealt}`);

  log('▶ L9: a helm turns aside blows from foes, a shield what they throw');
  const A = GAME_CONFIG.ARMOUR;
  const worn = await inArena((s) => ({ helm: s.player.armour.helm?.id, shield: s.player.armour.shield?.id, strip: s.txtGear.text }));
  check(worn.helm === A.LEATHER_CAP.id && worn.shield === A.OAK_BUCKLER.id, `a hero who owns the first helm and shield wears them into the arena (${worn.helm}, ${worn.shield})`);
  check(worn.strip === gearStrip({ helm: A.LEATHER_CAP, shield: A.OAK_BUCKLER }), `   and the HUD says what they turn aside ("${worn.strip}")`);
  /** One hit on the hero, landed the way the game lands it: a blow (a foe's body: handlePlayerHurt) or a shot (a projectile on the hero). What it cost. */
  async function hurt(kind, wear) {
    await calm();
    await stand(300);
    await inArena((s, w) => {
      const p = s.player;
      p.armour = w;
      p.health = p.maxHealth;
      p.invulnerableUntil = 0; // calm() made the hero untouchable
    }, wear);
    if (kind === 'blow') {
      await inArena((s) => {
        const boar = s.spawnEnemy('boar', s.player.x + 36, s.player.y, 1, {});
        s.handlePlayerHurt(boar);
        boar.destroy();
      });
    } else {
      await inArena((s) => { s.spawnProjectile('spore', s.player.x, s.player.y, 0, 0, false); });
      await page.waitForFunction(() => { const p = window.game.scene.getScene('SurvivalScene').player; return p.health < p.maxHealth; }, null, { timeout: 3_000 }).catch(() => {});
    }
    return inArena((s) => s.player.maxHealth - s.player.health);
  }
  const WEAR = [['a helm', { helm: A.LEATHER_CAP }], ['a shield', { shield: A.OAK_BUCKLER }], ['both', { helm: A.LEATHER_CAP, shield: A.OAK_BUCKLER }]];
  for (const [kind, source] of [['blow', 'contact'], ['shot', 'ranged']]) {
    const bare = await hurt(kind, {});
    check(bare > 0, `a ${kind} costs a hero in no armour ${bare}`);
    for (const [label, wear] of WEAR) {
      const cost = await hurt(kind, wear);
      const cut = cutFor(wear, source);
      check(cost === takenDamage(bare, cut), `   with ${label} on it costs ${cost}${cut > 0 ? ` (${Math.round(cut * 100)}% off)` : ' (nothing off: it is not what that armour turns aside)'}`);
      if (cut > 0) check(cost < bare, '   which is less than it costs bare');
    }
  }

  log('▶ L10: the run that ends on level N submits it');
  await calm();
  await inArena((s) => { s.startLevel(7); });
  await wait(500);
  const sentBefore = api.callsTo(/\/submit$/).length;
  await inArena((s) => s.handleGameOver());
  let sent = null;
  for (let i = 0; i < 80 && !sent; i++) {
    if (api.callsTo(/\/submit$/).length > sentBefore) sent = api.callsTo(/\/submit$/).at(-1);
    else await wait(250);
  }
  check(sent?.body?.level === 7, `the submit carries the level (${sent?.body?.level})`);
  await page.waitForFunction(() => window.gdService.getStatus().bestLevel >= 7, null, { timeout: 10_000 })
    .then(() => check(true, `and the server's best level (${api.bestLevel}) reaches the wallet status`), () => check(false, "the server's best level did not reach the wallet status"));

  log('▶ L11: a foe cannot be put out of the hero\'s reach');
  // the arena's edge holds every foe in. spawnEnemy once set it before the group's own defaults switched it off, so a foe that a
  // summon or a blink put past the wall stayed there, out of reach, and the level could not end
  await g.startScene('SurvivalScene'); // a new arena: the last one has ended its run
  await settled(page, 'SurvivalScene', 10);
  await calm();
  await stand(300);
  await inArena((s) => {
    window.__placed = [[s.arenaWidth + 90, 300], [-90, 300]].map(([x, y]) => s.spawnMob('boar', x, y)); // as Gorgok's enrage summons them
  });
  await wait(700);
  const placed = await inArena((s) => window.__placed.map((e) => ({ x: Math.round(e.x), active: e.active, width: s.arenaWidth })));
  check(placed.every((p) => p.active && p.x >= 0 && p.x <= p.width), `a foe set down past either wall is back inside the arena (x ${placed.map((p) => p.x).join(' and ')} of ${placed[0].width})`);
  await calm();
  await stand(150);
  const blink = await inArena((s) => {
    const shade = s.spawnEnemy('astral_shade', s.arenaWidth - 30, 300, 1, {});
    shade.hp = shade.maxHp = 1e6; // it takes the two blows without dying
    shade.setFlipX(false); // the hero is on its left, so it blinks the other way: at the wall
    shade.takeDamage(1, 150);
    shade.takeDamage(1, 150); // the second blow in a row makes it blink
    window.__shade = shade;
    return { x: shade.x, state: shade.state, width: s.arenaWidth };
  });
  check(blink.state === 'PHASE_DRIFT' && blink.x > 0 && blink.x <= blink.width, `an Astral Shade that blinks at the wall lands inside the arena (x ${Math.round(blink.x)} of ${blink.width})`);
  await wait(800);
  check(await inArena((s) => window.__shade.x > 0 && window.__shade.x <= s.arenaWidth), '   and is still there a moment later, in reach');

  log('▶ L12: the best level reaches the wallet from a run left through the menu, and from one the server already held');
  const depth = () => page.evaluate(() => window.gdService.getStatus().bestLevel);
  const submitAnswer = api.handlers.submit;
  /** A new arena (and so a new ticket), on `level` and held calm. */
  async function freshArena(level) {
    await g.startScene('SurvivalScene');
    await settled(page, 'SurvivalScene', 10);
    await calm();
    await inArena((s, n) => { s.startLevel(n); }, level);
    await wait(500);
  }
  await freshArena(9);
  const known = await depth();
  await inArena((s) => s.endRunOnLeave()); // MAIN MENU or RETRY BATTLE in the pause menu: settled like a death, the answer used like one
  await page.waitForFunction((n) => window.gdService.getStatus().bestLevel > n, known, { timeout: 10_000 })
    .then(async () => check(true, `a run left through the menu on level 9 brings the server's best level to the wallet (${known} → ${await depth()})`),
      () => check(false, `a run left through the menu did not bring the server's best level to the wallet (still ${known})`));
  api.handlers.submit = async () => ({ status: 409, body: { error: 'already_submitted' } }); // the server holds the run: its first answer was lost
  api.bestLevel = 12; // and counted the level
  await freshArena(2);
  await inArena((s) => s.handleGameOver());
  await page.waitForFunction(() => window.gdService.getStatus().bestLevel >= 12, null, { timeout: 15_000 })
    .then(() => check(true, 'a run the server already held still brings its best level to the wallet (12)'),
      async () => check(false, `a run the server already held did not bring its best level to the wallet (${await depth()})`));
  api.handlers.submit = submitAnswer;

  log('▶ L13: a boss that falls to a stomp is a kill like any other');
  await g.startScene('SurvivalScene');
  await settled(page, 'SurvivalScene', 10);
  await calm();
  const stomped = await inArena((s) => {
    const boss = s.spawnEnemy('boss_gorgok', 440, 280, 1, {});
    boss.hp = 1; // the stomp finishes it
    const before = { boss: s.killCount.boss_gorgok ?? 0, total: s.killCount.total, score: s.totalScore };
    const p = s.player;
    p.setPosition(boss.x, boss.y - 60); // above it and falling: the arena's stomp, not a blow
    p.setVelocity(0, 200);
    s.handlePlayerHurt(boss);
    return { before, after: { boss: s.killCount.boss_gorgok ?? 0, total: s.killCount.total, score: s.totalScore }, state: boss.state };
  });
  check(stomped.state === 'DEAD' && stomped.after.boss === stomped.before.boss + 1 && stomped.after.total === stomped.before.total + 1,
    `a boss stomped to death is counted (boss kills ${stomped.before.boss} → ${stomped.after.boss}, all kills ${stomped.before.total} → ${stomped.after.total})`);
  check(stomped.after.score > stomped.before.score, `   and pays its points (score ${stomped.before.score} → ${stomped.after.score})`);

  log('▶ L14: in the Story a hazard is cut by no armour, and what a boss throws is the shield\'s');
  async function startStory(chapter) {
    await page.evaluate(() => { const s = window.game.scene.getScene('StoryScene'); if (s) { s.dialogueBox = null; s.chapterIntroCard = null; } });
    await g.startScene('StoryScene', { chapter, skipIntroCard: true, skipDialogue: true });
    await page.waitForTimeout(1_500); // the ticket arrives and a little time passes
  }
  /** The hero in `wear`, whole and touchable, with each hit it takes written down: how much, what it said it came from, what it cost. */
  const arm = (wear) => inStory((s, w) => {
    const p = s.player;
    p.armour = w;
    p.health = p.maxHealth;
    p.invulnerableUntil = 0;
    window.__hits = [];
    if (!p.__wrapped) {
      p.__wrapped = true;
      const take = p.takeDamage.bind(p);
      p.takeDamage = (amount, dir, source) => {
        const before = p.health;
        const landed = Boolean(take(amount, dir, source));
        window.__hits.push({ amount, source: source ?? null, cost: before - p.health, landed });
        return landed;
      };
    }
  }, wear);
  const hits = () => page.evaluate(() => window.__hits);
  const both = { helm: A.LEATHER_CAP, shield: A.OAK_BUCKLER };
  await startStory(1);
  await inStory((s) => { s.enemies.getChildren().slice().forEach((e) => e.destroy()); }); // nothing else is there to touch the hero
  await arm(both);
  await inStory((s) => s.handleHazardHit(s.player, { hazardLabel: 'WATER' }));
  let [hit] = await hits();
  check(hit?.landed && hit.cost === 35, `water costs a hero in a helm and a shield the whole 35 (${hit?.cost})`);
  await wait(300);
  await arm(both);
  await inStory((s) => s.handleHazardHit(s.player, { isLavaGeyser: true }));
  [hit] = await hits();
  check(hit?.landed && hit.cost === 28, `a lava geyser costs the whole 28 (${hit?.cost})`);
  await wait(300);
  await arm(both);
  await inStory((s) => { s.player.setPosition(s.player.x, s.levelHeight + 80); });
  await page.waitForFunction(() => window.__hits.length > 0, null, { timeout: 5_000 }).catch(() => {});
  [hit] = await hits();
  check(hit?.landed && hit.cost === 35, `a fall out of the world costs the whole 35 (${hit?.cost})`);
  // the hero wears a shield and no helm, so only a shot that says it was thrown is thinned
  const shieldOnly = { shield: A.OAK_BUCKLER };
  const shieldCut = cutFor(shieldOnly, 'ranged');
  for (const [chapter, name, launch] of [
    [4, "Ignis's fireball", (s) => s.boss.launchFireball(s.player)],
    [5, "Umbra's void dart", (s) => s.boss.launchVoidDart(s.player, 0)],
    [5, "Umbra's crescent wave", (s) => { s.player.setPosition(s.boss.x - 130, s.boss.groundY); s.boss.fireCrescentWave(-1); }],
  ]) {
    await startStory(chapter);
    await inStory((s, ch) => {
      s.triggerBossEncounter(ch);
      s.inDialogue = false; // the boss's speech is not what is tried here: the world goes on, as it does once the dialogue closes
      s.physics.resume();
      s.physics.world.isPaused = false;
      s.boss.nextActionTime = Number.MAX_SAFE_INTEGER; // it throws nothing but the shot below
    }, chapter);
    await wait(400);
    await arm(shieldOnly);
    await inStory(launch);
    await page.waitForFunction(() => window.__hits.length > 0, null, { timeout: 6_000 }).catch(() => {});
    const [shot] = await hits();
    check(shot?.source === 'ranged', `${name} lands as a thrown hit (${shot ? `it says ${shot.source ?? 'nothing at all'}` : 'it never landed'})`);
    check(shot && shot.cost === takenDamage(shot.amount, shieldCut) && shot.cost < shot.amount, `   so the shield turns part of it aside (${shot?.amount} costs ${shot?.cost}, ${Math.round(shieldCut * 100)}% off)`);
  }

  check(g.errors.length === 0, `no browser errors${g.errors.length ? `: ${g.errors.join(' | ')}` : ''}`);
  assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
  log('\n✅ levels passed');
} catch (err) {
  console.error('\n❌ levels failed');
  console.error(err.message, failures.length ? `\n - ${failures.join('\n - ')}` : '');
  process.exitCode = 1;
} finally {
  await g.close();
}

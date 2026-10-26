import { GAME_CONFIG } from '../config.js';
import { createMulberry32, generateDailySurvivalSpec } from './PRNG.js';
import { sceneFor } from './scenery.js';

/*
 * Endless, as a ladder of numbered levels, and every level a pure function of its number (no Phaser, no clock, no storage): the
 * same level is the same for every player, so scores stay comparable, and the whole ladder can be tested and checked against
 * the server's score ceiling (server/test/runs.plausibility.test.js).
 *
 * Levels 1-5 are the hand-built waves in PRNG.js, exactly as they always were. From level 6 on a level is built from its number:
 * how many foes, how tough, which beasts, where they come in. Every five levels the realm changes, with its own beasts and its
 * own look, and the fifth level of a realm is a boss.
 */

const S = GAME_CONFIG.SURVIVAL;
const LV = S.LEVELS;

const BOSS_TYPE = 'boss_gorgok';
/** Where the boss of every boss level comes in (the same spot the hand-built wave 5 uses). */
const BOSS_SPOT = { x: 620, y: 270 };

/**
 * Every beast the arena can spawn, by the type name the scene knows it by (the stats are GAME_CONFIG.MOBS[TYPE]).
 * `kind`: a walker is on the floor, a flyer holds its height and dives (the scene brings one that wanders off back to the
 * player), a floater drifts along a fixed height and only fights what comes near it. `lane`: where it comes in (see LANES).
 * `home`: the realm it belongs to, the one whose blade (GAME_CONFIG.WEAPONS `bane`) hits it harder than any other does.
 */
export const BEASTS = {
  boar: { name: 'Boar', kind: 'walker', lane: 'ground', home: 'woods' },
  snail: { name: 'Snail', kind: 'walker', lane: 'ground', home: 'woods' },
  mushroom: { name: 'Mushroom', kind: 'walker', lane: 'shooter', home: 'woods' },
  goblin: { name: 'Goblin', kind: 'walker', lane: 'shooter', home: 'woods' },
  bog_lurker: { name: 'Bog Lurker', kind: 'walker', lane: 'ground', home: 'ruins' },
  mirelurker: { name: 'Mirelurker', kind: 'walker', lane: 'ground', home: 'ruins' },
  skeleton_warrior: { name: 'Skeleton Warrior', kind: 'walker', lane: 'ground', home: 'ruins' },
  basalt_golem: { name: 'Basalt Golem', kind: 'walker', lane: 'ground', home: 'caldera' },
  void_stalker: { name: 'Void Stalker', kind: 'walker', lane: 'ground', home: 'spire' },
  bee: { name: 'Bee', kind: 'flyer', lane: 'air', home: 'hive' },
  flying_eye: { name: 'Flying Eye', kind: 'flyer', lane: 'air', home: 'hive' },
  dread_bat: { name: 'Dread Bat', kind: 'flyer', lane: 'air', home: 'ruins' },
  hornet_guard: { name: 'Hornet Guard', kind: 'flyer', lane: 'air', home: 'hive' },
  cinder_drake: { name: 'Cinder Drake', kind: 'flyer', lane: 'air', home: 'caldera' },
  crypt_wraith: { name: 'Crypt Wraith', kind: 'floater', lane: 'float', home: 'ruins' },
  astral_shade: { name: 'Astral Shade', kind: 'floater', lane: 'float', home: 'spire' },
};

/**
 * Where each lane comes in, in the arena's 800 x 360 space, from the spots the hand-built waves use. The floor is at y 320: a
 * ground foe drops to it from y 280, a shooter stands on a platform (the two low ones, or the terrace between them), a flyer
 * starts high (and the flyers that fight from the air keep the height they come in at, so not so high that their shots and
 * dives, which reach 180 to 200, fall short of a hero on the floor, whose head is at about y 270), and a floater comes in at the
 * height it will keep.
 */
export const LANES = {
  ground: { y: 280, left: [70, 250], right: [550, 730] },
  shooter: { left: [{ x: 180, y: 240 }, { x: 400, y: 175 }], right: [{ x: 620, y: 240 }, { x: 400, y: 175 }] },
  air: { y: [135, 160], left: [150, 350], right: [450, 650] },
  float: { y: 294, left: [200, 300], right: [500, 600] },
};

/** The boss every realm ends on is Gorgok in a new coat: its name, its colour, and what it calls when it is enraged. */
const GORGOK = Object.freeze({ name: GAME_CONFIG.MOBS.BOSS_GORGOK.NAME, tint: null, summon: 'boar' });

/*
 * The realms, in the order they come round, with how each looks (`theme`, for the scene), who guards its last level (`boss`) and
 * the five levels it is made of (`recipes`: `lead` beasts are the bulk of a level, `support` beasts the rest, `leadShare` is the
 * bulk's share; the last recipe is the boss level, whose minions follow its recipe). Each level of a realm leads with a
 * different beast, so no two levels in a row feel alike, and the beasts of the realms before may turn up as support.
 */
const RECIPES = {
  hive: [
    { name: 'Hornet Raid', lead: ['hornet_guard'], support: ['bee', 'boar', 'mushroom'] },
    { name: 'Spore and Sight', lead: ['mushroom', 'flying_eye'], support: ['bee', 'goblin'] },
    { name: 'Bomber Stampede', lead: ['goblin', 'boar'], support: ['hornet_guard', 'flying_eye'] },
    { name: 'The Swarm', lead: ['bee', 'hornet_guard'], support: ['flying_eye', 'mushroom', 'goblin', 'boar'], leadShare: 0.55 },
    { name: "The Tyrant's Hive", lead: ['hornet_guard', 'goblin'], support: ['bee', 'mushroom', 'boar'] },
  ],
  ruins: [
    { name: 'Bone March', lead: ['skeleton_warrior'], support: ['mushroom', 'boar', 'goblin'], leadShare: 0.5 },
    { name: 'Restless Dead', lead: ['crypt_wraith'], support: ['skeleton_warrior', 'mushroom'], leadShare: 0.45 },
    { name: 'Night Wings', lead: ['dread_bat'], support: ['crypt_wraith', 'skeleton_warrior', 'mushroom'] },
    { name: 'The Sunken Gauntlet', lead: ['bog_lurker', 'mirelurker'], support: ['skeleton_warrior', 'dread_bat', 'crypt_wraith', 'mushroom'] },
    { name: "The Warden's Crypt", lead: ['skeleton_warrior', 'crypt_wraith'], support: ['dread_bat', 'bog_lurker', 'mirelurker', 'mushroom'] },
  ],
  caldera: [
    { name: 'Magma Wings', lead: ['cinder_drake'], support: ['boar', 'goblin', 'hornet_guard'] },
    { name: 'Stone Giants', lead: ['basalt_golem'], support: ['goblin', 'boar', 'mirelurker'], leadShare: 0.4 },
    { name: 'Ember Raid', lead: ['cinder_drake', 'hornet_guard'], support: ['mirelurker', 'goblin', 'boar'] },
    { name: 'The Inferno Horde', lead: ['basalt_golem', 'cinder_drake', 'boar'], support: ['goblin', 'hornet_guard', 'mirelurker'], leadShare: 0.5 },
    { name: "The Cinder Lord's Forge", lead: ['cinder_drake', 'basalt_golem'], support: ['boar', 'goblin', 'mirelurker'] },
  ],
  spire: [
    { name: 'Moonlit Drift', lead: ['astral_shade'], support: ['flying_eye', 'dread_bat', 'crypt_wraith'], leadShare: 0.4 },
    { name: 'Pounce in the Dark', lead: ['void_stalker'], support: ['dread_bat', 'basalt_golem', 'flying_eye'] },
    { name: 'Shades and Wings', lead: ['astral_shade', 'dread_bat'], support: ['crypt_wraith', 'void_stalker', 'flying_eye'] },
    { name: 'The Unmoored', lead: ['void_stalker', 'astral_shade', 'basalt_golem'], support: ['crypt_wraith', 'dread_bat', 'flying_eye'], leadShare: 0.5 },
    { name: 'The Pale Court', lead: ['astral_shade', 'void_stalker'], support: ['dread_bat', 'crypt_wraith', 'basalt_golem', 'flying_eye'] },
  ],
};

/**
 * The 480 x 270 backdrops and trees BootScene already loads. `theme: null` is the forest as the scene builds it. `tint` is the
 * colour over the backdrop layers, trees and bushes; `ground` the one over the earth and what grows on it (the grass is
 * green, so under a lava or a moon sky it takes a darker, duller colour than the layers behind it).
 */
export const REALMS = {
  woods: { name: 'The High Forest', theme: null, boss: GORGOK },
  hive: {
    name: 'The Hive Canopy',
    theme: { sky: 'bg_hive', hills: true, tint: 0xffe8aa, ground: 0xffe8aa, trees: ['pine_golden', 'pine_dark'], bush: 'bush_golden', mote: 0xffd966 },
    boss: Object.freeze({ name: 'THE HIVE TYRANT', tint: 0xffcf6b, summon: 'hornet_guard' }),
  },
  ruins: {
    name: 'The Sunken Ruins',
    theme: { sky: 'bg_ruins', hills: true, tint: 0x99aacc, ground: 0x8a9aaa, trees: ['pine_dark'], bush: 'bush_dark', mote: 0x99ccff },
    boss: Object.freeze({ name: 'THE BONE WARDEN', tint: 0xb7c4ff, summon: 'skeleton_warrior' }),
  },
  caldera: {
    name: 'The Obsidian Caldera',
    theme: { sky: 'bg_caldera', hills: false, tint: 0xcc7755, ground: 0x7a5a44, trees: ['boulders'], bush: null, mote: 0xff8844 },
    boss: Object.freeze({ name: 'THE CINDER LORD', tint: 0xff8a5c, summon: 'cinder_drake' }),
  },
  spire: {
    name: 'The Lunar Spire',
    theme: { sky: 'bg_lunar_spire', hills: false, tint: 0xd2a8ff, ground: 0x6d6a99, trees: [], bush: null, mote: 0xd2a8ff },
    boss: Object.freeze({ name: 'MOONBORN, THE PALE KING', tint: 0xd2a8ff, summon: 'astral_shade' }),
  },
};

/** After the hand-built waves the realms come round in this order, over and over. */
const ROTATION = ['hive', 'ruins', 'caldera', 'spire'];

/** Every realm, in the order a run meets them for the first time. */
export const REALM_ORDER = Object.freeze(['woods', ...ROTATION]);

/** The levels a realm is made of the first time round: `from` to `to`, five of them (the woods are the hand-built waves). */
export function realmSpan(key) {
  const at = REALM_ORDER.indexOf(key);
  if (at < 0) return null;
  if (at === 0) return { from: 1, to: LV.SCRIPTED };
  const from = LV.SCRIPTED + 1 + (at - 1) * LV.BOSS_EVERY;
  return { from, to: from + LV.BOSS_EVERY - 1 };
}

/** The beasts that live in a realm (their `home`), in the order BEASTS lists them: the ones its blade is the bane of. */
export const beastsOf = (key) => Object.entries(BEASTS).filter(([, beast]) => beast.home === key).map(([type]) => type);

/** The tough beasts that follow a player round to a realm they have been in before (ELITE_SHARE_PER_LAP), the toughest first. */
const ELITES = ['basalt_golem', 'skeleton_warrior', 'void_stalker', 'crypt_wraith', 'astral_shade', 'cinder_drake'];

/** The hand-built waves are named here (PRNG.js titles them for the old banner, "Wave 1: Forest Incursion (15 Foes)"). */
const SCRIPTED_NAMES = ['Forest Incursion', 'Airborne Ambush', 'Toxic Spores', 'The Frenzied Stampede', "The Chieftain's Wrath"];

const clampLevel = (n) => (Number.isFinite(Number(n)) ? Math.max(1, Math.floor(Number(n))) : 1);
const round2 = (x) => Math.round(x * 100) / 100;

let waves = null;
/** The hand-built waves, read once (they are the same for everyone). */
function scriptedWaves() {
  if (!waves) waves = generateDailySurvivalSpec().waves;
  return waves;
}

export const isBossLevel = (n) => clampLevel(n) % LV.BOSS_EVERY === 0;

function roman(n) {
  const marks = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, mark] of marks) {
    while (n >= value) { out += mark; n -= value; }
  }
  return out;
}

/** Which realm a level is in, which lap of the realms it is (0 the first time round), and its place among the realm's five. */
function locate(level) {
  if (level <= LV.SCRIPTED) return { key: 'woods', lap: 0, slot: level - 1 };
  const index = level - LV.SCRIPTED - 1;
  const stage = Math.floor(index / LV.BOSS_EVERY);
  return { key: ROTATION[stage % ROTATION.length], lap: Math.floor(stage / ROTATION.length), slot: index % LV.BOSS_EVERY };
}

/** The realm a level is in: its key, its name (with the lap, from the second time round: "The Hive Canopy II") and its theme. */
export function realmOf(n) {
  const { key, lap } = locate(clampLevel(n));
  const realm = REALMS[key];
  return { key, lap, name: lap > 0 ? `${realm.name} ${roman(lap + 1)}` : realm.name, theme: realm.theme };
}

/** How many foes level n has. */
export function foesIn(n) {
  const level = clampLevel(n);
  if (level <= LV.SCRIPTED) return scriptedWaves()[level - 1].spawns.length;
  return Math.min(LV.FOES_CAP, LV.FOES_BASE + Math.floor((level - LV.SCRIPTED - 1) / LV.FOES_EVERY));
}

/** Foes in levels 1 to n together: what a player has had to kill to get to level n + 1. */
export function cumulativeFoes(n) {
  const level = clampLevel(n);
  const firstAtCap = LV.SCRIPTED + 1 + (LV.FOES_CAP - LV.FOES_BASE) * LV.FOES_EVERY;
  const counted = Math.min(level, firstAtCap);
  let total = 0;
  for (let i = 1; i <= counted; i++) total += foesIn(i);
  return total + (level - counted) * LV.FOES_CAP;
}

/** How many times its base HP every foe of level n has: the hand-built waves' climb, then a gentler one up to HP_CAP. */
export function levelHpMul(n) {
  const level = clampLevel(n);
  const scripted = (at) => 1 + (at - 1) * S.HP_SCALE_PER_WAVE;
  if (level <= LV.SCRIPTED) return round2(scripted(level));
  return round2(Math.min(LV.HP_CAP, scripted(LV.SCRIPTED) + (level - LV.SCRIPTED) * LV.HP_STEP));
}

/** How many times its base speed a walker of level n has: five percent a level, as the hand-built waves always had, up to SPEED_CAP. */
export function levelSpeedMul(n) {
  return round2(Math.min(LV.SPEED_CAP, 1 + (clampLevel(n) - 1) * LV.SPEED_STEP));
}

/** What clearing level n pays before the speed bonus, the par time for it, and what each second under par is worth. */
function bonusTerms(level) {
  const base = S.WAVE_CLEAR_BONUS + LV.CLEAR_STEP * Math.min(level - 1, LV.CLEAR_STEPS_MAX);
  if (level <= LV.SCRIPTED) {
    return { base, par: LV.SCRIPTED_PAR_SEC + (level - 1) * LV.SCRIPTED_PAR_STEP_SEC, perSec: LV.SCRIPTED_SPEED_PTS_PER_SEC };
  }
  return { base, par: Math.min(LV.PAR_CAP_SEC, Math.round(foesIn(level) * LV.PAR_SEC_PER_FOE)), perSec: LV.SPEED_PTS_PER_SEC };
}

/**
 * The points for clearing level n in `seconds`. A clear under the level's par time earns a speed bonus for each second to
 * spare, and never less than a slow clear earns (the old waves paid 20 for one second to spare and 25 for none).
 * @returns {{total: number, base: number, speed: number, par: number, seconds: number, fast: boolean}}
 */
export function levelClearBonus(n, seconds) {
  const { base, par, perSec } = bonusTerms(clampLevel(n));
  const taken = Math.max(1, Math.floor(Number(seconds) || 0)); // the scene counts whole seconds, and never fewer than one
  const fast = taken < par;
  const speed = fast ? Math.max(LV.MIN_SPEED_BONUS, (par - taken) * perSec) : LV.MIN_SPEED_BONUS;
  return { total: base + speed, base, speed, par, seconds: taken, fast };
}

/** The most level n can pay: a clear in one second. The server's score ceiling is built on the most any level can pay. */
export function levelClearBonusMax(n) {
  const { base, par, perSec } = bonusTerms(clampLevel(n));
  return base + Math.max(LV.MIN_SPEED_BONUS, (par - 1) * perSec);
}

/** The forest materials clearing level n drops, on top of what its crates and boss drop. */
export function levelMaterials(n) {
  const level = clampLevel(n);
  const boss = isBossLevel(level) ? 2 : 0;
  return {
    bark: level <= LV.SCRIPTED ? 1 : 2,
    amber: (level % 2 === 0 ? 1 : 0) + boss,
    iron: (level % 3 === 0 ? 1 : 0) + boss,
  };
}

/** `count` beasts from a recipe, the lead beasts first and round and round so each one shows up, the rest from the support beasts. */
function compose(recipe, count) {
  const leads = Math.min(count, Math.round(count * (recipe.leadShare ?? 0.6)));
  const bag = [];
  for (let i = 0; i < count; i++) {
    bag.push(i < leads ? recipe.lead[i % recipe.lead.length] : recipe.support[(i - leads) % recipe.support.length]);
  }
  return bag;
}

const between = (rng, [low, high]) => rng.rangeInt(low, high);

/** Where the i-th foe of a level comes in. They alternate sides, so the first few to come out don't all come from one. */
function spotFor(type, i, rng) {
  const side = i % 2 === 0 ? 'left' : 'right';
  const laneName = BEASTS[type].lane;
  const lane = LANES[laneName];
  if (laneName === 'shooter') {
    const { x, y } = rng.choice(lane[side]);
    return { x, y };
  }
  return { x: between(rng, lane[side]), y: Array.isArray(lane.y) ? between(rng, lane.y) : lane.y };
}

/**
 * Coming round to a realm again, some of its foes are tough beasts from elsewhere, more each lap. The realms' own beasts differ
 * a lot in toughness (the hive's are the lightest), and this keeps a second lap from being a rest after the first one's end.
 */
function eliteBeasts(recipe, lap, count) {
  const share = Math.min(LV.ELITE_SHARE_MAX, LV.ELITE_SHARE_PER_LAP * lap);
  const own = new Set([...recipe.lead, ...recipe.support]);
  const strangers = ELITES.filter((type) => !own.has(type));
  const pool = strangers.length ? strangers : ELITES;
  return Array.from({ length: Math.round(count * share) }, (_, i) => pool[i % pool.length]);
}

/** The foes of a built level, in the order they come, from nothing but its number. */
function builtSpawns(level, recipe, lap, boss) {
  const rng = createMulberry32(`moonshard-level-${level}`);
  const minions = foesIn(level) - (boss ? 1 : 0);
  const elites = eliteBeasts(recipe, lap, minions);
  const spawns = boss ? [{ type: BOSS_TYPE, ...BOSS_SPOT, variant: boss }] : [];
  const bag = rng.shuffle([...compose(recipe, minions - elites.length), ...elites]);
  bag.forEach((type, i) => spawns.push({ type, ...spotFor(type, i, rng) }));
  return spawns;
}

/** Everything about level n but which beasts are new in it (that needs the levels before it, and they need this). */
function basePlan(level) {
  const { key, lap, slot } = locate(level);
  const realm = REALMS[key];
  const here = realmOf(level);
  const boss = isBossLevel(level) ? realm.boss : null;
  const { par } = bonusTerms(level);
  const common = {
    level, realm: here.key, realmName: here.name, lap: here.lap, theme: here.theme, boss, hpMul: levelHpMul(level), speedMul: levelSpeedMul(level),
    parSec: par, materials: levelMaterials(level),
    scene: sceneFor({ realm: key, slot, lap, theme: here.theme }),
  };

  if (level <= LV.SCRIPTED) {
    const spawns = scriptedWaves()[level - 1].spawns.map(({ type, x, y }) => (
      type === BOSS_TYPE ? { type, x, y, variant: realm.boss } : { type, x, y }
    ));
    return { ...common, name: SCRIPTED_NAMES[level - 1], spawns, foes: spawns.length, maxConcurrent: LV.SCRIPTED_CONCURRENT[level - 1] ?? LV.MAX_CONCURRENT };
  }

  const recipe = RECIPES[key][slot];
  const spawns = builtSpawns(level, recipe, lap, boss);
  return { ...common, name: recipe.name, spawns, foes: spawns.length, maxConcurrent: LV.MAX_CONCURRENT };
}

let firstSeen = null;
/** The first level each beast shows up in. One lap of the realms shows them all, and the laps after it only repeat. */
function firstSeenLevels() {
  if (firstSeen) return firstSeen;
  firstSeen = {};
  const lap = LV.SCRIPTED + LV.BOSS_EVERY * ROTATION.length;
  for (let n = 1; n <= lap; n++) {
    for (const spawn of basePlan(n).spawns) {
      if (spawn.type !== BOSS_TYPE && !(spawn.type in firstSeen)) firstSeen[spawn.type] = n;
    }
  }
  return firstSeen;
}

/**
 * Level n of Endless.
 * @returns {{level: number, name: string, realm: string, realmName: string, lap: number, theme: object|null, scene: object,
 *            boss: {name: string, tint: number|null, summon: string}|null,
 *            spawns: Array<{type: string, x: number, y: number, variant?: object}>, foes: number, hpMul: number, speedMul: number,
 *            maxConcurrent: number, parSec: number, introduces: string[], materials: {bark: number, amber: number, iron: number},
 *            newRealm: boolean}}
 *   `introduces`: the beasts that have not been in a level before this one (the boss is announced on its own); `newRealm`:
 *   this is the first level of a new realm; `scene`: how the arena looks and what the air does in this level (engine/scenery.js).
 */
export function levelPlan(n) {
  const level = clampLevel(n);
  const seen = firstSeenLevels();
  const introduces = level > 1 ? Object.keys(seen).filter((type) => seen[type] === level) : [];
  const newRealm = level > 1 && (locate(level).key !== locate(level - 1).key || locate(level).lap !== locate(level - 1).lap);
  return { ...basePlan(level), introduces, newRealm };
}

/** The blades past the Glaive, in the order they are forged: each needs a level reached in Endless (`minLevel`). */
export const BLADE_TIERS = Object.values(GAME_CONFIG.WEAPONS)
  .filter((weapon) => weapon.minLevel)
  .sort((a, b) => a.minLevel - b.minLevel);

/**
 * The next blade the levels lead to, for the results screen: the first of the level-gated blades the player does not have yet,
 * and whether the levels they have reached already open it. null once they have them all, or while the blade before it (the
 * Forest Glaive for the first) is still to be forged.
 * @param {{reached?: number, owned?: Iterable<string>}} [from]
 */
export function bladeGoal({ reached = 0, owned = [] } = {}) {
  const have = new Set(owned);
  const next = BLADE_TIERS.find((tier) => !have.has(tier.id));
  if (!next || !have.has(next.requires)) return null;
  return { id: next.id, name: next.name, minLevel: next.minLevel, unlocked: reached >= next.minLevel };
}

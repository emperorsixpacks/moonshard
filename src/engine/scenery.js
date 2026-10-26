/*
 * What Endless looks like, level by level, as pure data (no Phaser, no clock): the same level looks the same for every player, and
 * the scene (scenes/SurvivalScene.js) only has to put a look on. Every level has a scene of its own, so the arena never stays
 * the same for long: a realm (engine/levels.js REALMS) has five levels and so five scenes, one for each place in it: it opens
 * clear, the weather turns, the light fades, and the fifth, the boss's, is the darkest and pulses. Coming round to a realm
 * again, it is darker and the weather heavier, a little more each lap.
 *
 * A scene is a `look` (the pictures and their tints), a `grade` (a colour laid over the whole screen, so dusk and night read as
 * dusk and night), and a `weather` (what falls or drifts through the air: engine/EndlessWeather.js draws it).
 */

/** The forest the arena is built with (levels 1 to 5 begin from it): what a realm's `theme` says, for the woods. */
export const WOODS_LOOK = Object.freeze({ sky: 'sky_backdrop', hills: true, tint: null, ground: 0xffffff, trees: null, bush: 'bush_green', mote: 0x88ee88 });

/** The platforms each realm's arena is built with (the images BootScene loads; the story's chapters wear the same ones). */
export const PLATFORM_TEXTURES = Object.freeze({
  woods: 'plat_wood', hive: 'plat_branch', ruins: 'plat_stone', caldera: 'plat_obsidian', spire: 'plat_crystal',
});

/** How far a platform picture sits above its platform's top: the branch is drawn with a little more above it (as in the story). */
export const platformLift = (key) => (key === 'plat_branch' ? -2 : 0);

/** Every kind of weather there is (EndlessWeather has a drawing of each). */
export const WEATHER_KINDS = Object.freeze(['none', 'rain', 'drizzle', 'pollen', 'mist', 'dust', 'wisps', 'embers', 'ash', 'starfall', 'snow']);

/** The darkest a grade ever gets: the player has to see the foes, whatever the lap. */
export const GRADE_ALPHA_MAX = 0.4;

const LAP_GRADE_STEP = 0.05;
const LAP_WEATHER_STEP = 0.1;
const LAP_SHADE = 0x200010;

const none = ['none', 0];

/*
 * The five scenes of each realm, in the order the levels come. A mood changes only what it names, the rest is the realm's own.
 *   tint, ground, mote   the colours over the backdrop (`ground` over the earth and what grows on it), and the ambient motes
 *   grade                [colour, alpha, pulse]: laid over the screen; a pulse is how far the alpha swings, for a boss's scene
 *   weather              [kind, intensity from 0 to 1, options]
 */
const MOODS = {
  woods: [
    { name: 'Morning', weather: none }, // the forest as it always was: the first thing a player sees is unchanged
    { name: 'Drifting Mist', tint: 0xc4d6e6, ground: 0xd6e2ee, mote: 0xcfe8ff, grade: [0x9ab4d0, 0.06], weather: ['mist', 0.6] },
    { name: 'Storm', tint: 0x9fb0c8, ground: 0xbac6d6, mote: 0xa8d5e5, grade: [0x1a2a4a, 0.16], weather: ['rain', 0.7, { lightning: true }] },
    { name: 'Dusk', tint: 0xffb48a, ground: 0xffd0b0, mote: 0xffaa66, grade: [0x5a2a66, 0.14], weather: none },
    { name: 'Midnight', tint: 0x7f8fc0, ground: 0x9aa6d0, mote: 0xbfd0ff, grade: [0x0a1440, 0.26], weather: ['starfall', 0.5] },
  ],
  hive: [
    { name: 'Golden Afternoon', weather: ['pollen', 0.7] },
    { name: 'Honey Drizzle', tint: 0xffd88a, ground: 0xffd88a, mote: 0xffc34d, weather: ['drizzle', 0.6] },
    { name: 'Swarm Haze', tint: 0xffe0a0, mote: 0xffd34d, grade: [0xffa31a, 0.1], weather: ['pollen', 1] },
    { name: 'Amber Dusk', tint: 0xffc070, ground: 0xffc888, mote: 0xffa040, grade: [0x6b2c0a, 0.16], weather: ['pollen', 0.4] },
    { name: "The Tyrant's Glow", tint: 0xffcf6b, grade: [0x7a3b00, 0.2, 0.06], weather: ['pollen', 0.8] },
  ],
  ruins: [
    { name: 'Cold Mist', weather: ['mist', 0.7] },
    { name: 'Falling Dust', tint: 0xa0a8bc, mote: 0xc8c8d8, weather: ['dust', 0.8] },
    { name: 'Moonlit Fog', tint: 0x8090c0, mote: 0xaad0ff, grade: [0x0c1030, 0.2], weather: ['mist', 1] },
    { name: 'Spectral Drift', tint: 0x88c0b0, ground: 0x88b0a8, mote: 0x88ffcc, grade: [0x0a3a30, 0.14], weather: ['wisps', 0.8] },
    { name: "The Warden's Crypt", tint: 0x88b8b0, mote: 0x66ffcc, grade: [0x0a2a2a, 0.24, 0.06], weather: ['mist', 0.8] },
  ],
  caldera: [
    { name: 'Ember Rise', weather: ['embers', 0.7] },
    { name: 'Ashfall', tint: 0xb87a60, mote: 0xcccccc, weather: ['ash', 0.9] },
    { name: 'Magma Storm', tint: 0xd4745a, grade: [0xc02800, 0.12], weather: ['embers', 1] },
    { name: 'Smolder', tint: 0x9a5a48, ground: 0x6a4a3a, grade: [0x200800, 0.2], weather: ['ash', 0.8] },
    { name: "The Cinder Lord's Forge", tint: 0xff8a5c, grade: [0x6a1a00, 0.24, 0.07], weather: ['embers', 1] },
  ],
  spire: [
    { name: 'Starfall', weather: ['starfall', 0.8] },
    { name: 'Aurora', tint: 0xb8d0ff, mote: 0x88e0ff, grade: [0x40d0ff, 0.1], weather: ['starfall', 0.4] },
    { name: 'Void Snow', tint: 0xc8c0f0, mote: 0xffffff, weather: ['snow', 0.8] },
    { name: 'Eclipse Edge', tint: 0xa088d0, ground: 0x544a80, grade: [0x1a0640, 0.22], weather: ['starfall', 0.6] },
    { name: 'The Pale Court', tint: 0xd2a8ff, mote: 0xff99dd, grade: [0x5a1040, 0.22, 0.07], weather: ['snow', 0.6] },
  ],
};

export const MOOD_NAMES = Object.freeze(Object.fromEntries(Object.entries(MOODS).map(([realm, moods]) => [realm, moods.map((m) => m.name)])));

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Mix two 0xRRGGBB colours: `t` of the way from `a` to `b`. */
function mix(a, b, t) {
  const channel = (shift) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * The scene of one place in a realm.
 * @param {{ realm: string, slot: number, lap?: number, theme?: object|null }} at `slot` is the level's place in its realm, 0
 *   to 4 (4 is the boss's); `lap` how many times round the realms the player has been (0 the first); `theme` the realm's own
 *   look (engine/levels.js REALMS), null for the woods
 * @returns {{ key: string, name: string, realm: string, slot: number, lap: number, boss: boolean,
 *   look: { sky: string, skyTint: number|null, hills: boolean, tint: number|null, ground: number, platform: string, trees: string[]|null, bush: string|null, mote: number },
 *   grade: { color: number, alpha: number, pulse: number },
 *   weather: { kind: string, intensity: number, lightning: boolean } }}
 */
export function sceneFor({ realm, slot, lap = 0, theme = null }) {
  const moods = MOODS[realm] ?? MOODS.woods;
  const at = Math.min(Math.max(0, Math.floor(slot) || 0), moods.length - 1);
  const mood = moods[at];
  const base = theme ?? WOODS_LOOK;
  const laps = Math.max(0, Math.floor(lap) || 0);

  const look = {
    sky: base.sky,
    // the woods' sky is plain daylight, so dusk and night colour it; the other realms' skies are painted for their place, and only the grade goes over them
    skyTint: theme === null ? (mood.tint ?? null) : null,
    hills: base.hills,
    tint: mood.tint ?? base.tint,
    ground: mood.ground ?? base.ground,
    platform: PLATFORM_TEXTURES[realm] ?? PLATFORM_TEXTURES.woods,
    trees: base.trees === null ? null : [...base.trees],
    bush: base.bush,
    mote: mood.mote ?? base.mote,
  };

  let [color, alpha, pulse] = mood.grade ?? [0x000000, 0, 0];
  let [kind, intensity, options] = mood.weather ?? none;
  if (laps > 0) {
    // the second time round it is darker, and the weather heavier
    color = alpha > 0 ? mix(color, LAP_SHADE, 0.4) : LAP_SHADE;
    alpha = Math.min(GRADE_ALPHA_MAX, alpha + LAP_GRADE_STEP * laps);
    if (kind !== 'none') intensity = clamp01(intensity + LAP_WEATHER_STEP * laps);
  }
  return {
    key: `${realm}:${laps}:${at}`,
    name: mood.name,
    realm, slot: at, lap: laps,
    boss: at === moods.length - 1,
    look,
    grade: { color, alpha: round3(alpha), pulse: pulse ?? 0 },
    weather: { kind, intensity: round3(intensity), lightning: Boolean(options?.lightning) },
  };
}

/**
 * What putting `to` on over `from` takes: a new picture (the sky, the platforms, the trees, the bushes, the hills) is cut to under
 * a curtain, a change of colour only is not, and nothing changes in the same scene. `from` null is the first scene of a run.
 */
export function sceneSwap(from, to) {
  if (!from) return { pictures: true, colours: true, weather: true };
  const a = from.look;
  const b = to.look;
  const pictures = a.sky !== b.sky || a.platform !== b.platform || a.hills !== b.hills || a.bush !== b.bush || String(a.trees) !== String(b.trees);
  const colours = a.tint !== b.tint || a.ground !== b.ground || a.mote !== b.mote
    || from.grade.color !== to.grade.color || from.grade.alpha !== to.grade.alpha || from.grade.pulse !== to.grade.pulse;
  const weather = from.weather.kind !== to.weather.kind || from.weather.intensity !== to.weather.intensity || from.weather.lightning !== to.weather.lightning;
  return { pictures, colours, weather };
}

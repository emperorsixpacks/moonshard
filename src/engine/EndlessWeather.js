import Phaser from 'phaser';
import { sound } from './Audio.js';

/*
 * The weather of an Endless level: what falls or drifts through the air over the arena. engine/scenery.js says which kind it is
 * and how heavy, level by level; there is one drawing of each kind here. The emitters are fixed to the screen, not to the arena,
 * so the same few dozen particles cover whatever the camera shows, and they sit over the arena and under the foes and the hero
 * (depth 19 and 20), so the weather never hides who is hitting whom.
 */

const DEPTH = 16;
const FADE_MS = 800; // weather fades in as a scene arrives and out as it leaves, so nothing pops
const FLASH_DEPTH = 150; // over the world, under the curtain between levels (160) and the HUD (200)
const BASE_AREA = 480 * 270; // the picture the rates below are for
const MAX_AREA_GAIN = 3; // a taller picture (a phone held upright) gets more particles, up to this many times as many, and no more

/** When to emit so that about `perSec` particles are born each second over a picture of `w` by `h`. */
function birth(perSec, w, h) {
  const n = Math.max(0.5, perSec * Math.min(MAX_AREA_GAIN, Math.max(1, (w * h) / BASE_AREA)));
  return n <= 30 ? { frequency: Math.round(1000 / n), quantity: 1 } : { frequency: 33, quantity: Math.round(n / 30) };
}

/** How long a particle takes to cross a picture `h` tall at `speed` units a second. */
const crossing = (h, speed) => Math.round(((h + 40) / speed) * 1000);

/*
 * One recipe per kind (scenery.js WEATHER_KINDS): the texture, and the emitter's own config for an intensity `k` from 0 to 1 over
 * a picture of `w` by `h`.
 */
const RECIPES = {
  rain: (k, w, h) => ({
    texture: 'raindrop',
    ...birth(130 * k, w, h),
    x: { min: -40, max: w + 120 }, y: -16,
    lifespan: crossing(h, 335),
    speedX: { min: -55, max: -35 }, speedY: { min: 290, max: 380 },
    scaleX: { min: 0.7, max: 1.1 }, scaleY: { min: 0.9, max: 1.3 },
    alpha: { start: 0.6, end: 0.25 },
    tint: 0xa8d5e5,
  }),
  drizzle: (k, w, h) => ({
    texture: 'raindrop',
    ...birth(40 * k, w, h),
    x: { min: -20, max: w + 40 }, y: -16,
    lifespan: crossing(h, 170),
    speedX: { min: -14, max: -6 }, speedY: { min: 140, max: 200 },
    scale: 0.8,
    alpha: { start: 0.55, end: 0.15 },
    tint: 0xffc34d,
  }),
  pollen: (k, w, h) => ({
    texture: 'spark',
    ...birth(14 * k, w, h),
    x: { min: 0, max: w }, y: { min: h * 0.1, max: h * 0.85 },
    lifespan: { min: 3800, max: 5200 },
    speedX: { min: -10, max: 14 }, speedY: { min: -8, max: 8 },
    scale: { start: 1.4, end: 0.4 },
    alpha: { values: [0, 0.7, 0.7, 0], interpolation: 'linear' },
    tint: [0xffe27a, 0xfff0a8],
    blendMode: 'ADD',
  }),
  mist: (k, w, h) => ({
    texture: 'mist_puff',
    ...birth(1.4 * k, w, h),
    x: { min: -120, max: w * 0.7 }, y: { min: h * 0.4, max: h * 0.95 },
    lifespan: { min: 8000, max: 11000 },
    speedX: { min: 7, max: 15 }, speedY: { min: -2, max: 2 },
    scale: { min: 4, max: 7 },
    alpha: { values: [0, 0.15, 0.15, 0], interpolation: 'linear' },
    tint: 0xdfeaf5,
  }),
  dust: (k, w, h) => ({
    texture: 'ash_particle',
    ...birth(11 * k, w, h),
    x: { min: 0, max: w }, y: -8,
    lifespan: crossing(h, 34),
    speedX: { min: -8, max: 8 }, speedY: { min: 22, max: 46 },
    scale: { min: 0.8, max: 1.3 },
    alpha: { start: 0.55, end: 0.1 },
    tint: [0xc8c8d8, 0xaab0c4],
  }),
  wisps: (k, w, h) => ({
    texture: 'mist_puff',
    ...birth(3.2 * k, w, h),
    x: { min: 0, max: w }, y: { min: h * 0.45, max: h * 0.95 },
    lifespan: { min: 3500, max: 5200 },
    speedX: { min: -14, max: 14 }, speedY: { min: -26, max: -10 },
    scale: { min: 0.45, max: 0.9 },
    alpha: { values: [0, 0.4, 0.4, 0], interpolation: 'linear' },
    tint: [0x88ffcc, 0x66ffe0],
    blendMode: 'ADD',
  }),
  embers: (k, w, h) => ({
    texture: 'spark',
    ...birth(26 * k, w, h),
    x: { min: 0, max: w }, y: { min: h * 0.7, max: h + 20 },
    lifespan: { min: 2200, max: 3400 },
    speedX: { min: -25, max: 25 }, speedY: { min: -105, max: -50 },
    scale: { start: 1.3, end: 0 },
    alpha: { start: 0.85, end: 0 },
    tint: [0xff3300, 0xff7700, 0xffbb00],
    blendMode: 'ADD',
  }),
  ash: (k, w, h) => ({
    texture: 'ash_particle',
    ...birth(18 * k, w, h),
    x: { min: 0, max: w }, y: { min: -10, max: h * 0.6 },
    lifespan: { min: 3200, max: 5200 },
    speedX: { min: -18, max: 18 }, speedY: { min: 12, max: 34 },
    scale: { start: 1.0, end: 0.4 },
    alpha: { start: 0.7, end: 0.1 },
    tint: [0x554444, 0x776666, 0x998888],
  }),
  starfall: (k, w, h) => ({
    texture: 'spark',
    ...birth(10 * k, w, h),
    x: { min: 0, max: w + 80 }, y: -8,
    lifespan: crossing(h, 90),
    speedX: { min: -30, max: -10 }, speedY: { min: 60, max: 120 },
    scale: { min: 0.9, max: 1.6 },
    alpha: { start: 0.9, end: 0 },
    tint: [0xffffff, 0xbfd8ff, 0xffe9a8],
    blendMode: 'ADD',
  }),
  snow: (k, w, h) => ({
    texture: 'ash_particle',
    ...birth(24 * k, w, h),
    x: { min: -20, max: w + 40 }, y: -8,
    lifespan: crossing(h, 40),
    speedX: { min: -16, max: 12 }, speedY: { min: 25, max: 55 },
    scale: { min: 1, max: 1.8 },
    alpha: { start: 0.9, end: 0.5 },
    tint: [0xffffff, 0xe8e4ff],
  }),
};

const calmWanted = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default class EndlessWeather {
  constructor(scene) {
    this.scene = scene;
    this.now = null; // what is falling: { kind, intensity, lightning }
    this.live = []; // the emitters of it
    this.strikes = null; // the timer to the next flash of lightning
    this.fresh = true; // nothing has been on yet: the first weather of a run is there from the start
  }

  get kind() { return this.now?.kind ?? 'none'; }
  get intensity() { return this.now?.intensity ?? 0; }
  get emitterCount() { return this.live.length; }

  /**
   * Put a level's weather on (scenery.js: `{ kind, intensity, lightning }`). The same weather again changes nothing; a new one
   * fades the old out while it fades in.
   */
  set(weather) {
    const { kind = 'none', intensity = 0, lightning = false } = weather ?? {};
    const was = this.now;
    if (was && was.kind === kind && was.intensity === intensity && was.lightning === lightning) return;
    this.retire();
    this.now = { kind, intensity, lightning };
    this.build();
  }

  /** The picture changed size (a phone turned): the emitters are laid out for it again. */
  resize() {
    if (!this.now) return;
    this.retire(true);
    this.fresh = true;
    this.build();
  }

  build() {
    const { kind, intensity, lightning } = this.now;
    const recipe = RECIPES[kind];
    const calm = calmWanted();
    const k = Math.min(1, Math.max(0, calm ? intensity * 0.5 : intensity));
    if (recipe && k > 0) {
      const { width: w, height: h } = this.scene.cameras.main;
      const { texture, ...config } = recipe(k, w, h);
      const emitter = this.scene.add.particles(0, 0, texture, config).setScrollFactor(0).setDepth(DEPTH).setAlpha(this.fresh ? 1 : 0);
      if (!this.fresh) this.scene.tweens.add({ targets: emitter, alpha: 1, duration: FADE_MS });
      this.live.push(emitter);
    }
    this.fresh = false;
    if (lightning && !calm && k > 0) this.scheduleStrike();
  }

  /** Take the emitters and the lightning away: faded out, or at once (`now`) when the picture is being laid out again. */
  retire(now = false) {
    this.strikes?.remove(false);
    this.strikes = null;
    for (const emitter of this.live) {
      this.scene.tweens.killTweensOf(emitter);
      if (now) {
        emitter.destroy();
      } else {
        emitter.stop();
        this.scene.tweens.add({ targets: emitter, alpha: 0, duration: FADE_MS, onComplete: () => emitter.destroy() });
      }
    }
    this.live = [];
  }

  scheduleStrike() {
    this.strikes = this.scene.time.delayedCall(Phaser.Math.Between(9000, 16000), () => {
      this.strike();
      this.scheduleStrike();
    });
  }

  /** A soft double flash and, a moment after, the thunder. The picture does not shake: the hero has to stay where the player put them. */
  strike() {
    const cam = this.scene.cameras.main;
    const flash = this.scene.add.rectangle(cam.width / 2, cam.height / 2, cam.width + 40, cam.height + 40, 0xdfe8ff, 0)
      .setScrollFactor(0).setDepth(FLASH_DEPTH);
    this.scene.tweens.chain({
      targets: flash,
      tweens: [
        { alpha: 0.3, duration: 50 },
        { alpha: 0.06, duration: 60 },
        { alpha: 0.42, duration: 50 },
        { alpha: 0, duration: 360, ease: 'Cubic.easeOut' },
      ],
      onComplete: () => flash.destroy(),
    });
    this.scene.time.delayedCall(450, () => sound.playThunder());
  }

  destroy() {
    this.retire(true);
    this.now = null;
  }
}

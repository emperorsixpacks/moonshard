import Phaser from 'phaser';
import { sound } from './Audio.js';

/**
 * WeatherManager
 * Provides dynamic ambient weather overlays per chapter/biome:
 * - Whispering Woods (Chapter 1): Translucent falling rain, droplet splashes, and periodic ambient lightning with thunder.
 * - Obsidian Caldera (Chapter 4): Upward turbulent fiery embers, drifting volcanic ash flakes, and a pulsing molten lava heat glow.
 */
export default class WeatherManager {
  constructor(scene, chapterId) {
    this.scene = scene;
    this.chapterId = chapterId;
    this.emitters = [];
    this.timers = [];
    this.tweens = [];
    this.elements = [];

    this.initWeather();
  }

  initWeather() {
    if (!this.scene) return;

    if (this.chapterId === 1) {
      this.initRainAndLightning();
    } else if (this.chapterId === 4) {
      this.initCalderaEmbersAndAsh();
    }
  }

  /**
   * Chapter 1: Whispering Woods Weather
   */
  initRainAndLightning() {
    const scene = this.scene;
    const levelWidth = scene.levelWidth || 2800;

    // 1. Slanted falling rain particle emitter
    try {
      const rain = scene.add.particles(0, 0, 'raindrop', {
        x: { min: -100, max: levelWidth + 200 },
        y: -20,
        quantity: 3,
        frequency: 45,
        lifespan: 1400,
        speedX: { min: -55, max: -35 },
        speedY: { min: 290, max: 380 },
        scaleX: { min: 0.7, max: 1.1 },
        scaleY: { min: 0.9, max: 1.3 },
        alpha: { start: 0.55, end: 0.2 },
        tint: 0xa8d5e5
      }).setDepth(16);

      this.emitters.push(rain);
    } catch (e) {
      console.warn('Failed to initialize rain emitter:', e);
    }

    // 2. Periodic Ambient Lightning Flashes + Thunder
    this.scheduleNextLightning();
  }

  scheduleNextLightning() {
    if (!this.scene || !this.scene.time) return;

    // Trigger lightning every 11 to 20 seconds
    const delay = Phaser.Math.Between(11000, 20000);
    const timer = this.scene.time.delayedCall(delay, () => {
      this.triggerLightningStrike();
      this.scheduleNextLightning();
    });
    this.timers.push(timer);
  }

  triggerLightningStrike() {
    const scene = this.scene;
    if (!scene || !scene.cameras || !scene.cameras.main) return;

    const w = scene.cameras.main.width || 480;
    const h = scene.cameras.main.height || 270;

    // Full-viewport flash overlay
    const flash = scene.add.rectangle(w / 2, h / 2, w + 40, h + 40, 0xffffff, 0)
      .setScrollFactor(0)
      .setDepth(240);
    this.elements.push(flash);

    // Realistic double-flash sequence:
    // Flash 1: Quick burst
    flash.setAlpha(0.45);
    scene.cameras.main.shake(80, 0.005);

    scene.time.delayedCall(60, () => {
      if (!flash.active) return;
      flash.setAlpha(0.08); // brief dip

      scene.time.delayedCall(50, () => {
        if (!flash.active) return;
        // Flash 2: Main intense illumination
        flash.setAlpha(0.75);
        scene.cameras.main.shake(140, 0.009);

        // Sound: deep rolling thunder synth
        sound.playThunder();

        // Fade out smoothly
        const tw = scene.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 380,
          ease: 'Cubic.easeOut',
          onComplete: () => flash.destroy()
        });
        this.tweens.push(tw);
      });
    });
  }

  /**
   * Chapter 4: Obsidian Caldera Weather
   */
  initCalderaEmbersAndAsh() {
    const scene = this.scene;
    const levelWidth = scene.levelWidth || 2600;
    const w = scene.cameras.main.width || 480;
    const h = scene.cameras.main.height || 270;

    // 1. Rising fiery turbulent embers
    try {
      const embers = scene.add.particles(0, 0, 'spark', {
        x: { min: 0, max: levelWidth },
        y: { min: 280, max: 420 },
        quantity: 2,
        frequency: 80,
        lifespan: { min: 2200, max: 3400 },
        speedX: { min: -25, max: 25 },
        speedY: { min: -50, max: -105 },
        scale: { start: 1.2, end: 0 },
        alpha: { start: 0.85, end: 0 },
        tint: [0xff3300, 0xff7700, 0xffbb00],
        blendMode: 'ADD'
      }).setDepth(16);

      this.emitters.push(embers);
    } catch (e) {
      console.warn('Failed to initialize embers emitter:', e);
    }

    // 2. Volcanic ash flakes drifting across the cavern
    try {
      const ash = scene.add.particles(0, 0, 'ash_particle', {
        x: { min: 0, max: levelWidth },
        y: { min: -10, max: 340 },
        quantity: 1,
        frequency: 110,
        lifespan: { min: 3200, max: 5200 },
        gravityY: 10,
        speedX: { min: -18, max: 18 },
        speedY: { min: 12, max: 32 },
        scale: { start: 1.0, end: 0.4 },
        alpha: { start: 0.65, end: 0.1 },
        tint: [0x554444, 0x776666, 0x998888]
      }).setDepth(17);

      this.emitters.push(ash);
    } catch (e) {
      console.warn('Failed to initialize ash emitter:', e);
    }

    // 3. Pulsing Molten Lava Heat-Glow at base of screen
    const lavaGlow = scene.add.rectangle(w / 2, h, w + 40, 70, 0xff3700, 0.15)
      .setOrigin(0.5, 1.0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(6);
    this.elements.push(lavaGlow);

    const glowTween = scene.tweens.add({
      targets: lavaGlow,
      alpha: { from: 0.12, to: 0.24 },
      scaleY: { from: 0.9, to: 1.15 },
      duration: 1900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tweens.push(glowTween);
  }

  destroy() {
    this.timers.forEach(t => {
      if (t && t.remove) t.remove(false);
    });
    this.timers = [];

    this.tweens.forEach(tw => {
      if (tw && tw.stop) tw.stop();
    });
    this.tweens = [];

    this.emitters.forEach(e => {
      if (e && e.destroy) e.destroy();
    });
    this.emitters = [];

    this.elements.forEach(el => {
      if (el && el.destroy) el.destroy();
    });
    this.elements = [];
  }
}

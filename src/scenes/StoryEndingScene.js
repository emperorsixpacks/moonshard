import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import { isTallCanvas } from '../engine/uiScale.js';
import confetti from 'canvas-confetti';

// Sizes in the styles below are font-size hints: under 7 they are drawn in VT323 at 2.3x (see engine/typography.js),
// from 7 up they stay in Press Start 2P. The tall (portrait) canvas has more room, so its type is larger.
const LANDSCAPE = {
  moonY: 62, moonR: 32, haloR: 52,
  pineY: 175, pineScale: 0.85,
  titleY: 108, titleHint: '11px',
  descY: 141, descHint: '5.5px', descSpacing: 5,
  heroScale: 1.1, heroY: 188, petScale: 0.75, petDx: 30, petDy: -6,
  mobScale: 1, boarDx: 120, snailDx: -110, mobY: 205,
  btn: { w: 106, h: 22, dx: 120, hint: '5.5px' },
  btnYFromBottom: 26,
  lines: [
    'Pure moonlight cascades through the ancient roots, banishing the Pale Blight forever.',
    'The woodland breathes in peace once more.',
    'Your name is etched in the eternal bark of the World-Tree.'
  ]
};

const TALL = {
  moonY: 90, moonR: 38, haloR: 62,
  pineY: 300, pineScale: 1.15,
  titleY: 168, titleHint: '15px',
  descY: 236, descHint: '6.9px', descSpacing: 7,
  heroScale: 1.3, heroY: 322, petScale: 0.95, petDx: 38, petDy: -12,
  mobScale: 1.35, boarDx: 155, snailDx: -150, mobY: 340,
  btn: { w: 142, h: 40, dx: 150, hint: '6.3px' },
  btnYFromBottom: 36,
  // the first sentence is split at its comma so no line is wider than the screen
  lines: [
    'Pure moonlight cascades through the ancient roots,',
    'banishing the Pale Blight forever.',
    'The woodland breathes in peace once more.',
    'Your name is etched in the eternal bark of the World-Tree.'
  ]
};

export default class StoryEndingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StoryEndingScene' });
  }

  create(data) {
    const w = this.cameras?.main?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || GAME_CONFIG.HEIGHT;
    const L = isTallCanvas(this) ? TALL : LANDSCAPE;

    pauseService.detachScene();
    sound.playBGM('victory');
    this.events.once('shutdown', () => {
      sound.stopBGM();
    });

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Peaceful Night Sky Background
    this.add.rectangle(w / 2, h / 2, w, h, 0x051622);

    // Distant mountain & pine silhouettes
    for (let i = 0; i < 9; i++) {
      this.add.image(30 + i * 55, L.pineY, 'pine_green').setScale(L.pineScale).setTint(0x0e2c38);
    }

    // Fully Restored Radiant Silver Moon
    const halo = this.add.circle(w / 2, L.moonY, L.haloR, 0x00ffff, 0.15);
    const moon = this.add.circle(w / 2, L.moonY, L.moonR, 0xf0faff);
    moon.setStrokeStyle(3, 0xffffff);

    this.tweens.add({
      targets: halo,
      scale: 1.3,
      alpha: 0.35,
      duration: 2200,
      yoyo: true,
      loop: -1
    });

    // Gentle floating leaves / light motes
    this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: w },
      y: { min: 0, max: h },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.5, end: 0 },
      speedY: { min: -20, max: -8 },
      lifespan: 3000,
      frequency: 160
    });

    // Victory Title & Narrative
    this.add.text(w / 2, L.titleY, '✨ THE SILVER DAWN ✨', {
      fontFamily: 'Press Start 2P',
      fontSize: L.titleHint,
      color: '#ffd166',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.add.text(w / 2, L.descY, L.lines.join('\n'), {
      fontFamily: 'Press Start 2P',
      fontSize: L.descHint,
      color: '#cce6f0',
      align: 'center',
      lineSpacing: L.descSpacing,
      wordWrap: { width: w - 24 }
    }).setOrigin(0.5);

    // Selene & Companion resting triumphantly
    const heroX = w / 2 - 12;
    const hero = this.add.sprite(heroX, L.heroY, 'char_idle').setScale(L.heroScale);
    hero.play('player_idle');

    const pet = this.add.sprite(heroX + L.petDx, L.heroY + L.petDy, 'fairy_fly').setScale(L.petScale);
    pet.play('fairy_fly_anim');

    // Peaceful boar grazing
    const boar = this.add.sprite(w / 2 + L.boarDx, L.mobY, 'boar_idle').setScale(L.mobScale).setFlipX(true);
    boar.play('boar_idle_anim');

    // Peaceful snail
    const snail = this.add.sprite(w / 2 + L.snailDx, L.mobY, 'snail_walk').setScale(L.mobScale);
    snail.play('snail_walk_anim');

    // Navigation Buttons Container
    const btnY = h - L.btnYFromBottom;
    this.createButton(w / 2 - L.btn.dx, btnY, '🏕️ MAIN MENU', () => {
      this.scene.start('MenuScene');
    }, L.btn);

    this.createButton(w / 2, btnY, '⚒️ VISIT FORGE', () => {
      this.scene.start('ForgeScene');
    }, L.btn);

    this.createButton(w / 2 + L.btn.dx, btnY, '🏆 DAILY TRIAL', () => {
      this.scene.start('SurvivalScene');
    }, L.btn);

    // Celebration Confetti (not repeated when the screen is only laid out again after a rotation)
    if (!data?.resized) {
      sound.playVictory();
      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.5 }
      });

      this.time.delayedCall(1200, () => {
        confetti({
          particleCount: 50,
          spread: 100,
          origin: { y: 0.4 }
        });
      });
    }
  }

  createButton(x, y, text, action, size = LANDSCAPE.btn) {
    const btn = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, size.w, size.h, 0x09222c, 0.95);
    bg.setStrokeStyle(1.5, 0x00ffff);
    btn.add(bg);

    const label = this.add.text(0, 0, text, {
      fontFamily: 'Press Start 2P',
      fontSize: size.hint,
      color: '#ffffff'
    }).setOrigin(0.5);
    btn.add(label);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      bg.setFillStyle(0x134e5e);
      label.setColor('#ffd166');
      sound.playBlip(true);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(0x09222c);
      label.setColor('#ffffff');
    });
    bg.on('pointerdown', () => {
      sound.playCoin();
      action();
    });

    return btn;
  }

  // Portrait and landscape have different layouts: lay the screen out again when the phone is turned.
  onViewportResize(w, h) {
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
    this.scene.restart({ resized: true });
  }
}

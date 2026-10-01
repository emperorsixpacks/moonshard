import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import confetti from 'canvas-confetti';

export default class StoryEndingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StoryEndingScene' });
  }

  create(data) {
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

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
      this.add.image(30 + i * 55, 175, 'pine_green').setScale(0.85).setTint(0x0e2c38);
    }

    // Fully Restored Radiant Silver Moon
    const halo = this.add.circle(w / 2, 70, 52, 0x00ffff, 0.15);
    const moon = this.add.circle(w / 2, 70, 32, 0xf0faff);
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
    this.add.text(w / 2, 120, '✨ THE SILVER DAWN ✨', {
      fontFamily: 'Press Start 2P',
      fontSize: '11px',
      color: '#ffd166',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    const desc = this.add.text(w / 2, 148, 
      'Pure moonlight cascades through the ancient roots, banishing the Pale Blight forever.\nThe woodland breathes in peace once more.\nYour name is etched in the eternal bark of the World-Tree.', {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#cce6f0',
      align: 'center',
      lineSpacing: 5
    }).setOrigin(0.5);

    // Selene & Companion resting triumphantly
    const hero = this.add.sprite(w / 2 - 12, 195, 'char_idle').setScale(1.1);
    hero.play('player_idle');

    const pet = this.add.sprite(w / 2 + 18, 185, 'fairy_fly').setScale(0.75);
    pet.play('fairy_fly_anim');

    // Peaceful boar grazing
    const boar = this.add.sprite(w / 2 + 120, 205, 'boar_idle').setFlipX(true);
    boar.play('boar_idle_anim');

    // Peaceful snail
    const snail = this.add.sprite(w / 2 - 110, 205, 'snail_walk');
    snail.play('snail_walk_anim');

    // Navigation Buttons Container
    const btnY = h - 26;
    this.createButton(w / 2 - 120, btnY, '🏕️ MAIN MENU', () => {
      this.scene.start('MenuScene');
    });

    this.createButton(w / 2, btnY, '⚒️ VISIT FORGE', () => {
      this.scene.start('ForgeScene');
    });

    this.createButton(w / 2 + 120, btnY, '🏆 DAILY TRIAL', () => {
      this.scene.start('SurvivalScene');
    });

    // Celebration Confetti
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

  createButton(x, y, text, action) {
    const btn = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, 106, 22, 0x09222c, 0.95);
    bg.setStrokeStyle(1.5, 0x00ffff);
    btn.add(bg);

    const label = this.add.text(0, 0, text, {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
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
}

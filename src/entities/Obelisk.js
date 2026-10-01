import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';

export default class Obelisk extends Phaser.GameObjects.Container {
  constructor(scene, x, y, shrineName = 'Ancient Guardian Obelisk') {
    super(scene, x, y);
    scene.add.existing(this);

    this.shrineName = shrineName;
    this.isCleansed = false;
    this.isLocked = false;
    this.cleansingProgress = 0;
    this.requiredHits = 3;
    this.setDepth(18);

    // Pillar graphics
    this.pillar = scene.add.rectangle(0, -20, 20, 48, 0x223322);
    this.pillar.setStrokeStyle(2, 0x446644);
    this.add(this.pillar);

    // Glowing core rune
    this.rune = scene.add.circle(0, -24, 7, 0x772222);
    this.add(this.rune);

    // Corruption aura
    this.aura = scene.add.circle(0, -24, 16, 0x550022, 0.4);
    this.add(this.aura);

    // Barrier shield (active when boss locked)
    this.barrier = scene.add.circle(0, -24, 24, 0xaa0033, 0.35);
    this.barrier.setStrokeStyle(1.5, 0xff2244);
    this.barrier.setVisible(false);
    this.add(this.barrier);

    // Prompt text
    this.promptText = scene.add.text(0, -56, 'PURGE CORRUPTION', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#ff6666',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5);
    this.add(this.promptText);

    // Pulsing tween
    this.pulseTween = scene.tweens.add({
      targets: this.aura,
      scale: 1.3,
      alpha: 0.1,
      duration: 800,
      yoyo: true,
      loop: -1
    });

    // Physics trigger body
    scene.physics.add.existing(this);
    this.body.setSize(28, 52);
    this.body.setOffset(-14, -48);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
  }

  lock() {
    this.isLocked = true;
    this.barrier.setVisible(true);
    this.promptText.setText('SEALED BY BOSS 🔒');
    this.promptText.setColor('#ff4444');

    this.barrierTween = this.scene.tweens.add({
      targets: this.barrier,
      scale: 1.15,
      alpha: 0.6,
      duration: 600,
      yoyo: true,
      loop: -1
    });
  }

  unlock() {
    this.isLocked = false;
    if (this.barrierTween) this.barrierTween.stop();

    this.scene.tweens.add({
      targets: this.barrier,
      scale: 1.8,
      alpha: 0,
      duration: 500,
      onComplete: () => this.barrier.setVisible(false)
    });

    sound.playObelisk();
    this.promptText.setText('SHRINE UNLOCKED! STRIKE! ⚔️');
    this.promptText.setColor('#ffff66');
  }

  strike() {
    if (this.isCleansed) return false;

    if (this.isLocked) {
      sound.playHit();
      const lockAlert = this.scene.add.text(this.x, this.y - 68, 'DEFEAT THE BOSS FIRST! 🔒', {
        fontFamily: 'Press Start 2P',
        fontSize: '6px',
        color: '#ff4444',
        stroke: '#000',
        strokeThickness: 2
      }).setOrigin(0.5);

      this.scene.tweens.add({
        targets: lockAlert,
        y: this.y - 82,
        alpha: 0,
        duration: 800,
        onComplete: () => lockAlert.destroy()
      });
      return false;
    }

    this.cleansingProgress++;
    sound.playHit();

    // Flash white
    this.pillar.fillColor = 0xffffff;
    this.scene.time.delayedCall(80, () => {
      this.pillar.fillColor = this.isCleansed ? 0x0582ca : 0x223322;
    });

    if (this.cleansingProgress >= this.requiredHits) {
      this.cleanse();
      return true;
    } else {
      // Progress feedback
      this.promptText.setText(`${this.requiredHits - this.cleansingProgress} STRIKES LEFT`);
      this.rune.fillColor = 0xddaa22;
      return false;
    }
  }

  cleanse() {
    this.isCleansed = true;
    this.pulseTween.stop();

    // Turn celestial radiant cyan/gold
    this.pillar.fillColor = 0x112233;
    this.pillar.setStrokeStyle(2, 0x0582ca);
    this.rune.fillColor = 0xf6c026;
    this.aura.fillColor = 0x0582ca;
    this.aura.setAlpha(0.6);

    this.promptText.setText('SHRINE RESTORED!');
    this.promptText.setColor('#0582ca');

    sound.playObelisk();

    // Shoot radiant light beam upward
    const beam = this.scene.add.rectangle(this.x, this.y - 120, 10, 240, 0xf6c026, 0.7);
    this.scene.tweens.add({
      targets: beam,
      scaleX: 2.5,
      alpha: 0,
      duration: 1200,
      onComplete: () => beam.destroy()
    });

    // Camera flash & gentle rumble
    this.scene.cameras.main.flash(400, 246, 192, 38);
    this.scene.cameras.main.shake(400, 0.01);

    if (this.scene && typeof this.scene.triggerChapterVictory === 'function') {
      this.scene.triggerChapterVictory();
    }
  }
}

import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';

export default class Crate extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'crate');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Bounding box for 16x16 crate
    this.body.setSize(16, 16);
    this.body.setOffset(0, 0);
    this.body.setImmovable(true);
    this.body.setAllowGravity(false);
    this.setDepth(18);

    this.isBroken = false;
  }

  breakCrate(player) {
    if (this.isBroken) return;
    this.isBroken = true;
    this.body.setEnable(false);
    sound.playHit();

    if (this.scene && typeof this.scene.onCrateBroken === 'function') {
      this.scene.onCrateBroken(this);
    }

    // Spawn material drop
    this.spawnDrop(player);

    // Destruction debris effect
    for (let i = 0; i < 5; i++) {
      const splinter = this.scene.add.rectangle(this.x, this.y, 4, 3, 0x8b5a2b);
      this.scene.physics.add.existing(splinter);
      splinter.body.setVelocity((Math.random() - 0.5) * 140, -100 - Math.random() * 80);
      this.scene.tweens.add({
        targets: splinter,
        alpha: 0,
        duration: 300,
        onComplete: () => splinter.destroy()
      });
    }

    this.destroy();
  }

  spawnDrop(player) {
    let color = '#2ecc71';
    let label = '+35 HP 💚';

    if (player && player.health < player.maxHealth) {
      player.heal(35);
      color = '#2ecc71';
      label = '+35 HP 💚';
    } else {
      // Full health bonus
      if (this.scene.totalScore !== undefined) {
        // Daily Shard Trial / Survival Scene
        const bonusPts = 100;
        this.scene.totalScore += bonusPts;
        if (this.scene.txtScore) this.scene.txtScore.setText(`SCORE: ${this.scene.totalScore}`);
        color = '#ffd700';
        label = `FULL HP! +${bonusPts} PTS ✨`;
      } else {
        // Story Scene
        storage.addMaterials({ bark: 1, amber: 1 });
        color = '#ffaa00';
        label = '+Spoils 🪵🍯';
      }
    }

    sound.playCoin();

    // Floating text label
    const dropText = this.scene.add.text(this.x, this.y - 12, label, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: color,
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(210);

    this.scene.tweens.add({
      targets: dropText,
      y: this.y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => dropText.destroy()
    });
  }
}

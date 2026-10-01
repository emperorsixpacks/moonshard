import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';

export default class ShardDrop extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, valueNim = 0.001) {
    ShardDrop.ensureTexture(scene);
    super(scene, x, y, 'shard');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.valueNim = valueNim;
    this.isCollected = false;

    this.setDepth(190);
    this.body.setSize(12, 14);
    this.body.setOffset(2, 2);
    this.setBounce(0.35);
    this.setCollideWorldBounds(true);

    // Initial pop upward & outward
    const popX = (Math.random() - 0.5) * 80;
    const popY = -90 - Math.random() * 50;
    this.setVelocity(popX, popY);

    // Gentle floating glow tween
    this.bobTween = scene.tweens.add({
      targets: this,
      scaleX: { from: 0.9, to: 1.15 },
      scaleY: { from: 0.9, to: 1.15 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Auto despawn after 30 seconds if not collected
    this.despawnTimer = scene.time.delayedCall(30000, () => {
      if (!this.isCollected) {
        scene.tweens.add({
          targets: this,
          alpha: 0,
          duration: 400,
          onComplete: () => this.destroy(),
        });
      }
    });
  }

  static ensureTexture(scene) {
    if (scene.textures && !scene.textures.exists('shard')) {
      const g = scene.make.graphics({ x: 0, y: 0, add: false });
      // Outer glow circle
      g.fillStyle(0x00f0ff, 0.4);
      g.fillCircle(8, 9, 8);

      // Main diamond crystal shape
      g.fillStyle(0x2fe0ff, 1);
      g.beginPath();
      g.moveTo(8, 1);
      g.lineTo(15, 8);
      g.lineTo(8, 17);
      g.lineTo(1, 8);
      g.closePath();
      g.fillPath();

      // Inner golden-lunar facet
      g.fillStyle(0xffe680, 0.95);
      g.beginPath();
      g.moveTo(8, 3);
      g.lineTo(13, 8);
      g.lineTo(8, 15);
      g.lineTo(8, 3);
      g.closePath();
      g.fillPath();

      // Specular shine
      g.fillStyle(0xffffff, 1);
      g.fillRect(6, 4, 3, 3);

      g.generateTexture('shard', 16, 18);
      g.destroy();
    }
  }

  collect(player) {
    if (this.isCollected) return;
    this.isCollected = true;
    this.body.setEnable(false);
    if (this.bobTween) this.bobTween.stop();
    if (this.despawnTimer) this.despawnTimer.remove();

    sound.playCoin();

    if (this.scene && typeof this.scene.onShardCollected === 'function') {
      this.scene.onShardCollected(this);
    }

    // Sparkle pickup visual
    for (let i = 0; i < 4; i++) {
      const sparkle = this.scene.add.rectangle(this.x, this.y, 3, 3, 0x00f0ff);
      this.scene.physics.add.existing(sparkle);
      sparkle.body.setVelocity((Math.random() - 0.5) * 100, -60 - Math.random() * 40);
      this.scene.tweens.add({
        targets: sparkle,
        alpha: 0,
        scale: 0.2,
        duration: 350,
        onComplete: () => sparkle.destroy(),
      });
    }

    // Float notification text
    const isCapped = Boolean(this.scene && this.scene.isDailyHarvestCapped);
    const floatLabel = isCapped ? 'DAILY CAP (0.1 NIM MAX) 🔒' : '+0.001 NIM 💎';
    const floatColor = isCapped ? '#fbbf24' : '#38e1ff';
    const floatStroke = isCapped ? '#3b2200' : '#002233';

    const text = this.scene.add.text(this.x, this.y - 12, floatLabel, {
      fontFamily: 'Press Start 2P',
      fontSize: isCapped ? '5px' : '6.5px',
      color: floatColor,
      stroke: floatStroke,
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(250);

    this.scene.tweens.add({
      targets: text,
      y: this.y - 32,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });

    // Shrink and destroy
    this.scene.tweens.add({
      targets: this,
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      duration: 150,
      onComplete: () => this.destroy(),
    });
  }
}

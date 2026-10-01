import Phaser from 'phaser';

export default class BossHealthBar extends Phaser.GameObjects.Container {
  constructor(scene, bossName = 'BOSS', maxHp = 100, x = 240, y = 48) {
    super(scene, x, y);
    scene.add.existing(this);

    this.maxHp = maxHp;
    this.currentHp = maxHp;
    this.setScrollFactor(0);
    this.setDepth(450);

    const barWidth = 220;
    const barHeight = 10;

    // Outer ornate frame
    this.frameBg = scene.add.rectangle(0, 0, barWidth + 8, barHeight + 8, 0x050508, 0.95);
    this.frameBg.setStrokeStyle(1.5, 0x8b1a1a);
    this.add(this.frameBg);

    // Inner background (dark maroon)
    this.innerBg = scene.add.rectangle(0, 0, barWidth, barHeight, 0x220505);
    this.add(this.innerBg);

    // Damage trailing bar (orange-red)
    this.trailBar = scene.add.rectangle(-barWidth / 2, -barHeight / 2, barWidth, barHeight, 0xff7700);
    this.trailBar.setOrigin(0, 0);
    this.add(this.trailBar);

    // Main health fill (vibrant crimson)
    this.hpBar = scene.add.rectangle(-barWidth / 2, -barHeight / 2, barWidth, barHeight, 0xee2222);
    this.hpBar.setOrigin(0, 0);
    this.add(this.hpBar);

    // Top gold accent line
    this.goldTop = scene.add.rectangle(0, -barHeight / 2 - 2, barWidth + 4, 1, 0xffd700, 0.7);
    this.add(this.goldTop);

    // Boss Name Label
    this.titleText = scene.add.text(0, -13, `☠ ${bossName.toUpperCase()} ☠`, {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#ffdd77',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    this.add(this.titleText);

    // Boss HP numbers
    this.hpText = scene.add.text(0, 0, `${maxHp} / ${maxHp}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    this.add(this.hpText);

    this.barWidth = barWidth;
    this.barHeight = barHeight;
    this.targetY = y;

    // Intro entrance animation
    this.setAlpha(0);
    this.y = this.targetY - 16;
    scene.tweens.add({
      targets: this,
      alpha: 1,
      y: this.targetY,
      duration: 500,
      ease: 'Back.easeOut'
    });
  }

  updateHealth(hp, maxHp = null) {
    if (maxHp !== null) this.maxHp = maxHp;
    this.currentHp = Math.max(0, hp);

    const pct = Phaser.Math.Clamp(this.currentHp / this.maxHp, 0, 1);
    const targetW = this.barWidth * pct;

    this.hpBar.width = targetW;
    this.hpText.setText(`${Math.ceil(this.currentHp)} / ${this.maxHp}`);

    // Trailing bar tween
    this.scene.tweens.add({
      targets: this.trailBar,
      width: targetW,
      duration: 350,
      ease: 'Cubic.easeOut'
    });

    if (pct < 0.3) {
      this.hpBar.fillColor = 0xff0033;
      this.frameBg.setStrokeStyle(1.5, 0xff2222);
    }
  }

  defeat() {
    this.updateHealth(0);
    this.titleText.setText('☠ VANQUISHED! ☠');
    this.titleText.setColor('#88ff88');

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.targetY - 16,
      delay: 1500,
      duration: 800,
      onComplete: () => this.destroy()
    });
  }
}

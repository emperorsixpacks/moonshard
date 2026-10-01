import Phaser from 'phaser';

export default class HeroHealthBar extends Phaser.GameObjects.Container {
  constructor(scene, x = 200, y = 14, maxHp = 100) {
    super(scene, x, y);
    scene.add.existing(this);

    this.maxHp = maxHp;
    this.currentHp = maxHp;
    this.setScrollFactor(0);
    this.setDepth(205);

    const barWidth = 104;
    const barHeight = 9;

    this.barWidth = barWidth;
    this.barHeight = barHeight;

    // Outer ornate border frame
    this.frameBg = scene.add.rectangle(0, 0, barWidth + 6, barHeight + 6, 0x070b12, 0.95);
    this.frameBg.setStrokeStyle(1.5, 0x34495e);
    this.add(this.frameBg);

    // Inner dark background
    this.innerBg = scene.add.rectangle(0, 0, barWidth, barHeight, 0x200505);
    this.add(this.innerBg);

    // Damage trailing bar (smooth interpolation when hurt)
    this.trailBar = scene.add.rectangle(-barWidth / 2, -barHeight / 2, barWidth, barHeight, 0xe67e22);
    this.trailBar.setOrigin(0, 0);
    this.add(this.trailBar);

    // Main health fill
    this.hpBar = scene.add.rectangle(-barWidth / 2, -barHeight / 2, barWidth, barHeight, 0x2ecc71);
    this.hpBar.setOrigin(0, 0);
    this.add(this.hpBar);

    // Subtle top highlight sheen
    this.topSheen = scene.add.rectangle(0, -barHeight / 2 + 1, barWidth, 1, 0xffffff, 0.35);
    this.add(this.topSheen);

    // Heart / HP emblem to the left
    this.lblIcon = scene.add.text(-barWidth / 2 - 16, 0, '💚', {
      fontSize: '8px'
    }).setOrigin(0.5);
    this.add(this.lblIcon);

    // Numerical HP display
    this.hpText = scene.add.text(0, 0, `${maxHp} / ${maxHp}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    this.add(this.hpText);
  }

  updateHealth(hp, maxHp = null) {
    if (maxHp !== null) this.maxHp = maxHp;
    const prevHp = this.currentHp;
    this.currentHp = Math.max(0, Math.min(this.maxHp, hp));

    const pct = Phaser.Math.Clamp(this.currentHp / this.maxHp, 0, 1);
    const targetW = this.barWidth * pct;

    this.hpBar.width = targetW;
    this.hpText.setText(`${Math.ceil(this.currentHp)} / ${this.maxHp}`);

    // Color shifting based on health status
    if (pct > 0.5) {
      this.hpBar.fillColor = 0x2ecc71; // Emerald Green
      this.lblIcon.setText('💚');
      this.frameBg.setStrokeStyle(1.5, 0x34495e);
    } else if (pct > 0.25) {
      this.hpBar.fillColor = 0xf1c40f; // Warning Amber
      this.lblIcon.setText('💛');
      this.frameBg.setStrokeStyle(1.5, 0xd35400);
    } else {
      this.hpBar.fillColor = 0xe74c3c; // Critical Crimson
      this.lblIcon.setText('💔');
      this.frameBg.setStrokeStyle(1.5, 0xff2222);
    }

    // Trailing bar animation
    this.scene.tweens.killTweensOf(this.trailBar);
    this.scene.tweens.add({
      targets: this.trailBar,
      width: targetW,
      duration: 350,
      ease: 'Cubic.easeOut'
    });

    // Hurt punch animation if damage was taken
    if (this.currentHp < prevHp) {
      this.scene.tweens.add({
        targets: this,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 70,
        yoyo: true,
        ease: 'Quad.easeInOut'
      });
    }
  }

  flashHeal() {
    this.scene.tweens.add({
      targets: this.hpBar,
      alpha: 0.4,
      duration: 100,
      yoyo: true,
      repeat: 1
    });
  }
}

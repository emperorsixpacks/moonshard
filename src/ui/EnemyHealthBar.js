import Phaser from 'phaser';

export default class EnemyHealthBar {
  constructor(scene, owner, width = 26, height = 3.5, yOffset = 8) {
    this.scene = scene;
    this.owner = owner;
    this.width = width;
    this.height = height;
    this.yOffset = yOffset;

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(owner.depth ? owner.depth + 2 : 25);
    this.visible = true;
  }

  update(currentHp, maxHp) {
    if (!this.graphics || !this.graphics.scene) return;

    if (!this.owner || !this.owner.active || this.owner.state === 'DEAD' || !this.visible) {
      this.graphics.clear();
      return;
    }

    // Position above the enemy's physical body
    const enemyTop = (this.owner.body && this.owner.body.top !== undefined)
      ? this.owner.body.top
      : (this.owner.y - (this.owner.height ? this.owner.height / 2 : 16));

    const x = Math.round(this.owner.x);
    const y = Math.round(enemyTop - this.yOffset);

    const safeMax = Math.max(1, maxHp || 1);
    const safeCur = Math.max(0, Math.min(safeMax, currentHp || 0));
    const pct = Phaser.Math.Clamp(safeCur / safeMax, 0, 1);

    this.graphics.clear();

    const halfW = Math.round(this.width / 2);
    const drawX = x - halfW;

    // Dark outer border
    this.graphics.fillStyle(0x0a0a0e, 0.85);
    this.graphics.fillRect(drawX - 1, y - 1, this.width + 2, this.height + 2);

    // Dark red inner backing
    this.graphics.fillStyle(0x3a0808, 0.9);
    this.graphics.fillRect(drawX, y, this.width, this.height);

    // Health fill with dynamic health status color
    if (pct > 0) {
      const fillW = Math.max(1, Math.round(this.width * pct));
      let fillColor = 0x2ecc71; // Green
      if (pct <= 0.25) {
        fillColor = 0xe74c3c; // Red
      } else if (pct <= 0.5) {
        fillColor = 0xf1c40f; // Yellow
      }

      this.graphics.fillStyle(fillColor, 1.0);
      this.graphics.fillRect(drawX, y, fillW, this.height);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible && this.graphics) {
      this.graphics.clear();
    }
  }

  destroy() {
    if (this.graphics) {
      this.graphics.destroy();
      this.graphics = null;
    }
    this.owner = null;
    this.scene = null;
  }
}

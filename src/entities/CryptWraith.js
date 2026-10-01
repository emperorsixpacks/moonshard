import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class CryptWraith extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'crypt_wraith_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(28, 48);
    this.body.setOffset(18, 16);
    this.body.setAllowGravity(false);
    this.setScale(1.0);
    this.setDepth(19);

    this.mobType = 'crypt_wraith';
    this.hp = (GAME_CONFIG.MOBS.CRYPT_WRAITH && GAME_CONFIG.MOBS.CRYPT_WRAITH.HP) || 60;
    this.maxHp = this.hp;
    this.state = 'FLOAT'; // FLOAT, SHRIEK, PHASE, STUNNED, DEAD

    this.baseY = y;
    this.bobTimer = 0;
    this.attackCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 28, 3, -26);
    this.play('crypt_wraith_idle_anim', true);
  }

  update(player) {
    if (this.state === 'DEAD' || !player || player.isDead) return;

    if (this.healthBar) {
      this.healthBar.update(this.hp, this.maxHp);
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const now = this.scene.time.now;

    if (this.state === 'STUNNED') {
      if (now > this.stateTimer) {
        this.state = 'FLOAT';
        this.clearTint();
        this.setAlpha(1.0);
        this.play('crypt_wraith_idle_anim', true);
      }
      return;
    }

    if (this.state === 'SHRIEK') {
      this.setVelocity(0, 0);
      if (now > this.stateTimer) {
        this.state = 'FLOAT';
        this.play('crypt_wraith_idle_anim', true);
      }
      return;
    }

    if (this.state === 'PHASE') {
      if (now > this.stateTimer) {
        this.state = 'FLOAT';
        this.setAlpha(1.0);
        this.play('crypt_wraith_idle_anim', true);
      }
      return;
    }

    // Ethereal floating bob
    this.bobTimer += 0.04;
    this.y = this.baseY + Math.sin(this.bobTimer) * 8;

    const dirToPlayer = player.x < this.x ? -1 : 1;
    this.setFlipX(dirToPlayer > 0);

    // Crypt Shriek attack
    if (dist < 110 && now > this.attackCooldownUntil) {
      this.performShriek(player);
      return;
    }

    // Float towards player slowly (strictly clamped before boss gate)
    const floatSpeed = (GAME_CONFIG.MOBS.CRYPT_WRAITH && GAME_CONFIG.MOBS.CRYPT_WRAITH.FLOAT_SPEED) || 50;
    const maxRight = (this.scene.gateX || 2090) - 80;

    if (this.x > maxRight) {
      this.x = maxRight;
      this.setVelocityX(0);
    } else if (dist < 260 && !(dirToPlayer > 0 && this.x >= maxRight)) {
      this.setVelocityX(dirToPlayer * floatSpeed);
    } else {
      this.setVelocityX(0);
    }
  }

  performShriek(player) {
    this.state = 'SHRIEK';
    this.attackCooldownUntil = this.scene.time.now + 3000;
    this.stateTimer = this.scene.time.now + 600;
    this.setVelocity(0, 0);
    const dirToPlayer = player.x < this.x ? -1 : 1;
    this.setFlipX(dirToPlayer > 0);
    this.play('crypt_wraith_shriek_anim', true);

    juice.spawnFloatingText(this.scene, this.x, this.y - 30, 'SPECTRAL SHRIEK! 👻', '#38bdf8');
    sound.playWhoosh();

    // Damage player if still in radius
    this.scene.time.delayedCall(250, () => {
      if (this.state === 'DEAD' || !this.scene || !player || player.isDead) return;
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (d < 100) {
        const knockDir = this.x < player.x ? 1 : -1;
        player.takeDamage(20, knockDir);
        juice.screenShake(this.scene, 8, 120);
      }
    });
  }

  takeDamage(amount, sourceX) {
    if (this.state === 'DEAD') return false;

    // Frontal attack vs backstab
    // flipX = false faces left (negative X). Back is towards positive X (sourceX > this.x).
    // flipX = true faces right (positive X). Back is towards negative X (sourceX < this.x).
    const facingRight = this.flipX;
    const attackerFromBehind = (facingRight && sourceX < this.x) || (!facingRight && sourceX > this.x);

    let finalDamage = amount;
    const isCrit = attackerFromBehind || this.state === 'SHRIEK';

    if (attackerFromBehind) {
      finalDamage = Math.round(amount * 2.0);
      juice.spawnFloatingText(this.scene, this.x, this.y - 25, 'GHOST PURGE! 🗡️', '#38bdf8');
    }

    this.hp -= finalDamage;
    sound.playHit();
    juice.flashWhite(this, 90);
    juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDamage, isCrit ? 'crit' : 'normal');
    juice.hitStop(this.scene, isCrit ? 45 : 25);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: (GAME_CONFIG.MOBS.CRYPT_WRAITH && GAME_CONFIG.MOBS.CRYPT_WRAITH.PTS) || 70 };
    }

    // Phase shift evasion on hit
    this.state = 'PHASE';
    this.stateTimer = this.scene.time.now + 400;
    this.setAlpha(0.4);
    const retreatDir = sourceX < this.x ? 1 : -1;
    this.setVelocity(retreatDir * 90, -40);

    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.enable = false;
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }

    juice.spawnDeathParticles(this.scene, this.x, this.y, 0x38bdf8);
    sound.playMonsterDeath();

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleY: 1.4,
      scaleX: 0.3,
      duration: 400,
      onComplete: () => {
        this.destroy();
      }
    });
  }
}

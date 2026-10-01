import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import Projectile from './Projectile.js';

export default class HornetGuard extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'bee_fly');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(34, 34);
    this.body.setOffset(15, 15);
    this.body.setAllowGravity(false);
    this.setDepth(19);

    // Armored Golden Hornet Tint & Scale
    this.setScale(1.15);
    this.setTint(0xf59e0b);

    this.mobType = 'hornet_guard';
    this.hp = GAME_CONFIG.MOBS.HORNET_GUARD.HP || 45;
    this.maxHp = this.hp;
    this.state = 'HOVER'; // HOVER, TWIN_STINGER, DRILL_DIVE, EMBEDDED, STUNNED, DEAD

    this.hoverBaseY = y;
    this.patrolDir = 1;
    this.attackCooldownUntil = 0;
    this.stateTimer = 0;

    // Visual Pollen Shield (protective aura)
    this.shieldAura = scene.add.circle(x, y, 22, 0xfbbf24, 0.25).setDepth(this.depth - 1);
    this.shieldActive = true;

    this.healthBar = new EnemyHealthBar(scene, this, 28, 3, -22);
    this.play('bee_fly_anim', true);
  }

  update(player) {
    if (this.state === 'DEAD' || !player || player.isDead) {
      if (this.shieldAura) this.shieldAura.setVisible(false);
      return;
    }

    if (this.healthBar) {
      this.healthBar.update(this.hp, this.maxHp);
    }

    if (this.shieldAura) {
      this.shieldAura.setPosition(this.x, this.y);
      this.shieldAura.setVisible(this.shieldActive && this.state !== 'EMBEDDED');
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const now = this.scene.time.now;

    if (this.state === 'STUNNED') {
      if (now > this.stateTimer) {
        this.state = 'HOVER';
        this.play('bee_fly_anim', true);
      }
      return;
    }

    if (this.state === 'EMBEDDED') {
      this.setVelocity(0, 0);
      if (now > this.stateTimer) {
        this.state = 'HOVER';
        this.body.setAllowGravity(false);
        this.shieldActive = true;
        this.play('bee_fly_anim', true);
        this.attackCooldownUntil = now + 2500;
      }
      return;
    }

    if (this.state === 'DRILL_DIVE') {
      // Check collision with platform ground
      if (this.body.blocked.down || this.y >= this.drillTargetY) {
        this.state = 'EMBEDDED';
        this.stateTimer = now + 1200; // 1.2s embedded vulnerability window
        this.shieldActive = false;
        sound.playBoarChargeHit();
        this.scene.cameras.main.shake(80, 0.007);
        this.setVelocity(0, 0);
        this.play('bee_hit_anim', true);
      }
      return;
    }

    if (this.state === 'HOVER') {
      // Gentle hovering wave
      const floatY = this.hoverBaseY + Math.sin(now * 0.005) * 12;
      this.y += (floatY - this.y) * 0.08;

      // Slow aerial patrol
      this.setVelocityX(this.patrolDir * (GAME_CONFIG.MOBS.HORNET_GUARD.HOVER_SPEED || 65));
      this.setFlipX(player.x > this.x);

      // Bounce horizontal boundaries
      if (this.body.blocked.left) this.patrolDir = 1;
      else if (this.body.blocked.right) this.patrolDir = -1;

      // Attack triggers
      if (dist < 180 && now > this.attackCooldownUntil) {
        if (Math.abs(player.x - this.x) < 50 && player.y > this.y + 40) {
          // Player is directly underneath -> Drill Dive!
          this.startDrillDive(player);
        } else {
          // Mid-range -> Twin Stinger Volley
          this.fireTwinStingers(player);
        }
      }
    }
  }

  fireTwinStingers(player) {
    this.attackCooldownUntil = this.scene.time.now + 2800;
    this.play('bee_attack_anim', true);
    sound.playSlash(1);

    const dirX = player.x < this.x ? -1 : 1;
    [-1, 1].forEach((offset, idx) => {
      this.scene.time.delayedCall(idx * 120, () => {
        if (this.state === 'DEAD' || !this.active) return;
        const q = new Projectile(
          this.scene,
          this.x + dirX * 12,
          this.y + 8,
          'hornet_quill',
          dirX * (GAME_CONFIG.MOBS.HORNET_GUARD.STINGER_SPEED || 190),
          60 + offset * 30,
          GAME_CONFIG.MOBS.HORNET_GUARD.DAMAGE || 18,
          'enemy',
          0.8
        );
        q.body.setAllowGravity(false);
        if (this.scene.projectiles) {
          this.scene.projectiles.add(q);
        }
      });
    });
  }

  startDrillDive(player) {
    this.state = 'DRILL_DIVE';
    this.drillTargetY = player.y + 10;
    this.body.setAllowGravity(true);
    this.body.setGravityY(400);

    const dirX = player.x < this.x ? -1 : 1;
    this.setVelocityX(dirX * 60);
    this.setVelocityY(GAME_CONFIG.MOBS.HORNET_GUARD.DRILL_SPEED || 240);
    sound.playUpwardSlash();
    this.play('bee_attack_anim', true);
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    let finalDmg = amount;
    let isEmbedded = this.state === 'EMBEDDED';

    if (isEmbedded) {
      // Automatic critical hit while embedded in platform
      finalDmg = Math.round(amount * 2.5);
    } else if (isUpwardSlash) {
      // Anti-air upward slash breaks shield
      finalDmg = Math.round(amount * 1.6);
      this.shieldActive = false;
    } else if (this.shieldActive) {
      // Pollen shield mitigates frontal attacks
      finalDmg = Math.round(amount * 0.5);
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (isEmbedded) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'crit', `STINGER STUCK! -${finalDmg} 🗡️`);
      juice.hitStopCrit(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'counter', `AERIAL BREAK -${finalDmg}! 💥`);
      juice.hitStopHeavy(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, this.shieldActive ? 'normal' : 'heavy', this.shieldActive ? `SHIELD -${finalDmg}` : null);
      juice.hitStopLight(this.scene);
    }

    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 380;
    this.play('bee_hit_anim', true);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.HORNET_GUARD.PTS || 55 };
    }
    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.shieldAura) {
      this.shieldAura.destroy();
      this.shieldAura = null;
    }
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('bee_hit_anim');

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + 20,
      duration: 350,
      onComplete: () => this.destroy()
    });
  }

  destroy(fromScene) {
    if (this.shieldAura) {
      this.shieldAura.destroy();
      this.shieldAura = null;
    }
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }
    super.destroy(fromScene);
  }
}

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class FlyingEye extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'eye_flight');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Frame is 150x150. Bounding box is ~40x30 at offset (58, 61)
    this.body.setSize(36, 28);
    this.body.setOffset(58, 62);
    this.body.setAllowGravity(false);
    this.setDepth(19);

    this.mobType = 'flying_eye';
    this.hp = GAME_CONFIG.MOBS.FLYING_EYE.HP;
    this.maxHp = GAME_CONFIG.MOBS.FLYING_EYE.HP;
    this.baseY = y;
    this.startX = x;
    this.patrolRange = 140;
    this.patrolDir = -1;
    this.setFlipX(true); // LuizMelo faces right by default; flipX=true faces left

    this.state = 'HOVER'; // HOVER, DIVE, RETURN, ATTACK_SHOOT, DEAD
    this.diveTarget = null;
    this.attackCooldownUntil = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 28, 3.5, 6);
    this.play('eye_flight_anim');
  }

  update(player) {
    if (this.healthBar) this.healthBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocity(0, 0);
      return;
    }

    if (this.state === 'HOVER') {
      // Player tracking & attack engagement
      if (player && !player.isDead) {
        const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
        const dx = player.x - this.x;

        // In Survival arena, follow player rather than getting stuck in patrol range
        const isSurvival = this.scene.scene && this.scene.scene.key === 'SurvivalScene';
        if (isSurvival) {
          if (Math.abs(dx) > 30) {
            this.patrolDir = dx > 0 ? 1 : -1;
          }
          const cam = this.scene.cameras?.main;
          const minY = cam ? cam.worldView.y + 44 : 155;
          const maxY = Math.min(player.y - 20, 255);
          const desiredY = Phaser.Math.Clamp(player.y - 55, minY, maxY);
          this.baseY = Phaser.Math.Linear(this.baseY, desiredY, 0.04);
          this.y = Phaser.Math.Clamp(this.baseY + Math.sin(this.scene.time.now * 0.004) * 12, minY, maxY + 10);
        } else {
          // Rebound within patrol range in story mode
          if (this.x < this.startX - this.patrolRange) this.patrolDir = 1;
          if (this.x > this.startX + this.patrolRange) this.patrolDir = -1;
          this.y = this.baseY + Math.sin(this.scene.time.now * 0.004) * 14;
        }

        const speed = (isSurvival && Math.abs(dx) > 100)
          ? GAME_CONFIG.MOBS.FLYING_EYE.HOVER_SPEED * 1.6
          : GAME_CONFIG.MOBS.FLYING_EYE.HOVER_SPEED;
        this.setVelocityX(this.patrolDir * speed);
        this.setFlipX(this.patrolDir < 0);

        if (this.scene.time.now > this.attackCooldownUntil && dist < 240) {
          if (Math.random() < 0.5) {
            this.startDive(player);
          } else {
            this.startShoot(player);
          }
        }
      } else {
        this.y = this.baseY + Math.sin(this.scene.time.now * 0.004) * 14;
        this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.FLYING_EYE.HOVER_SPEED);
        this.setFlipX(this.patrolDir < 0);
      }
      return;
    }

    if (this.state === 'DIVE') {
      if (!this.diveTarget) {
        this.state = 'RETURN';
        return;
      }
      const angle = Phaser.Math.Angle.Between(this.x, this.y, this.diveTarget.x, this.diveTarget.y);
      this.setVelocityX(Math.cos(angle) * GAME_CONFIG.MOBS.FLYING_EYE.DIVE_SPEED);
      this.setVelocityY(Math.sin(angle) * GAME_CONFIG.MOBS.FLYING_EYE.DIVE_SPEED);
      this.setFlipX(this.body.velocity.x < 0);

      // Reached dive target or hit ground
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.diveTarget.x, this.diveTarget.y);
      if (dist < 20 || this.y >= this.diveTarget.y + 12 || this.body.blocked.down) {
        this.state = 'RETURN';
      }
      return;
    }

    if (this.state === 'RETURN') {
      this.setVelocityX(this.patrolDir * (GAME_CONFIG.MOBS.FLYING_EYE.HOVER_SPEED * 0.7));
      this.setVelocityY(-90);

      const isSurvival = this.scene.scene && this.scene.scene.key === 'SurvivalScene';
      const cam = this.scene.cameras?.main;
      const minY = isSurvival ? (cam ? cam.worldView.y + 44 : 155) : 60;

      if (this.y <= this.baseY || this.y <= minY) {
        this.baseY = Math.max(this.baseY, minY);
        this.y = this.baseY;
        this.state = 'HOVER';
        this.setVelocityY(0);
        this.attackCooldownUntil = this.scene.time.now + 2400;
        this.play('eye_flight_anim', true);
      }
      return;
    }

    if (this.state === 'ATTACK_SHOOT') {
      this.setVelocity(0, 0);
    }
  }

  startDive(player) {
    this.state = 'DIVE';
    this.diveTarget = { x: player.x, y: player.y };
    this.play('eye_attack_anim', true);
    sound.playSlash(1);
  }

  startShoot(player) {
    this.state = 'ATTACK_SHOOT';
    this.setVelocity(0, 0);
    this.attackCooldownUntil = this.scene.time.now + 2800;

    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);
    this.play('eye_attack_anim', true);

    this.scene.time.delayedCall(300, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      sound.playSlash(2);
      // Shoot projectile towards player
      const angle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
      const vx = Math.cos(angle) * 150;
      const vy = Math.sin(angle) * 150;
      if (typeof this.scene.spawnProjectile === 'function') {
        this.scene.spawnProjectile('eye_dart', this.x, this.y, vx, vy);
      }
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD') {
        this.state = 'HOVER';
        this.play('eye_flight_anim', true);
      }
    });
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    // Upward slash critical bonus on aerial flying eyes!
    let finalDmg = amount;
    let isAntiAir = false;
    if (isUpwardSlash) {
      finalDmg = Math.round(amount * GAME_CONFIG.PLAYER.UPWARD_SLASH_BONUS);
      isAntiAir = true;
    }

    this.hp -= finalDmg;
    sound.playHit();

    // Damage popup via JuiceEffects
    if (isAntiAir) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'crit', `ANTI-AIR -${finalDmg}! 🗡️`);
      juice.hitStopHeavy(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'normal');
      juice.hitStopLight(this.scene);
    }

    // Knockback
    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 120);
    this.setVelocityY(-100);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.FLYING_EYE.PTS, isAntiAir };
    } else {
      this.play('eye_hit_anim', true);
      this.setTint(0xff5555);
      this.scene.time.delayedCall(120, () => this.clearTint());
      this.state = 'RETURN';
      return { killed: false, pts: 0, isAntiAir };
    }
  }

  die() {
    this.state = 'DEAD';
    if (this.healthBar) this.healthBar.setVisible(false);
    if (this.body) {
      this.body.setEnable(false);
    }
    sound.playEnemyDeath();
    this.play('eye_dead_anim', true);
    this.body.setAllowGravity(true);
    this.setVelocityY(-80);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 500,
      delay: 200,
      onComplete: () => this.destroy()
    });
  }

  destroy(fromScene) {
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }
    super.destroy(fromScene);
  }
}

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import Projectile from './Projectile.js';

export default class CinderDrake extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'demon_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(0.7);
    this.body.setSize(30, 32);
    this.body.setOffset(24, 20);
    this.body.setAllowGravity(false); // Glides effortlessly across lava caverns
    this.setDepth(19);

    // Deep basalt & fiery crimson tint
    this.setTint(0xff5522);

    this.mobType = 'cinder_drake';
    this.hp = GAME_CONFIG.MOBS.CINDER_DRAKE.HP || 50;
    this.maxHp = this.hp;
    this.state = 'FLY'; // FLY, SPIT, DIVE, STUNNED, DEAD

    this.baseY = y;
    this.patrolDir = 1;
    this.attackCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3, -18);
    this.play('demon_flying_anim', true);
  }

  update(player) {
    if (this.state === 'DEAD' || !player || player.isDead) return;

    if (this.healthBar) {
      this.healthBar.update(this.hp, this.maxHp);
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const dy = Math.abs(player.y - this.y);
    const now = this.scene.time.now;

    if (this.state === 'STUNNED') {
      if (now > this.stateTimer) {
        this.state = 'FLY';
        this.body.setAllowGravity(false);
        this.play('demon_flying_anim', true);
      }
      return;
    }

    if (this.state === 'DIVE') {
      // Check if dive passed player or reached low boundary
      if (this.y >= this.diveTargetY || (this.body.blocked && this.body.blocked.down)) {
        this.state = 'FLY';
        this.body.setAllowGravity(false);
        this.play('demon_flying_anim', true);
        this.attackCooldownUntil = now + 2600;
      }
      return;
    }

    if (this.state === 'FLY') {
      // Hovering wave over magma pits
      const targetY = this.baseY + Math.sin(now * 0.004) * 16;
      this.y += (targetY - this.y) * 0.06;

      this.setVelocityX(this.patrolDir * (GAME_CONFIG.MOBS.CINDER_DRAKE.FLY_SPEED || 70));
      this.setFlipX(player.x > this.x);

      if (this.body.blocked.left) this.patrolDir = 1;
      else if (this.body.blocked.right) this.patrolDir = -1;

      // Attacks
      if (dist < 200 && now > this.attackCooldownUntil) {
        if (dist < 130 && player.y > this.y + 20) {
          this.startDiveBomb(player);
        } else {
          this.spitMagmaGlob(player);
        }
      }
    }
  }

  startDiveBomb(player) {
    this.state = 'DIVE';
    this.diveTargetY = player.y + 15;
    this.body.setAllowGravity(true);
    this.body.setGravityY(350);

    const dirX = player.x < this.x ? -1 : 1;
    this.setVelocityX(dirX * 110);
    this.setVelocityY(GAME_CONFIG.MOBS.CINDER_DRAKE.DIVE_SPEED || 220);
    this.play('demon_attack_anim', true);
    sound.playSlash(2);
  }

  spitMagmaGlob(player) {
    this.attackCooldownUntil = this.scene.time.now + 3000;
    this.play('demon_attack_anim', true);
    sound.playUpwardSlash();

    const dirX = player.x < this.x ? -1 : 1;
    this.scene.time.delayedCall(160, () => {
      if (this.state === 'DEAD' || !this.active) return;
      const glob = new Projectile(
        this.scene,
        this.x + dirX * 14,
        this.y + 6,
        'magma_glob',
        dirX * (GAME_CONFIG.MOBS.CINDER_DRAKE.MAGMA_SPEED || 160),
        -30,
        GAME_CONFIG.MOBS.CINDER_DRAKE.DAMAGE || 20,
        'enemy',
        0.9
      );
      glob.body.setAllowGravity(true);
      glob.body.setGravityY(220);
      if (this.scene.projectiles) {
        this.scene.projectiles.add(glob);
      }
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD') {
        this.play('demon_flying_anim', true);
      }
    });
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    let finalDmg = amount;
    let isDiveCounter = this.state === 'DIVE';

    if (isDiveCounter) {
      finalDmg = Math.round(amount * 2.2);
    } else if (isUpwardSlash) {
      finalDmg = Math.round(amount * 1.5);
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (isDiveCounter) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'counter', `DIVE COUNTER -${finalDmg}! 💥`);
      juice.hitStopCrit(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'upslash');
      juice.hitStopLight(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 18, finalDmg, 'normal');
      juice.hitStopLight(this.scene);
    }

    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 400;
    this.play('demon_hit_anim', true);

    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 90);
    this.setVelocityY(-90);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.CINDER_DRAKE.PTS || 65 };
    }
    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('demon_dead_anim', true);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 500,
      delay: 300,
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

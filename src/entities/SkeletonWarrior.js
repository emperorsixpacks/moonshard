import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class SkeletonWarrior extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'skeleton_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Collider scaled to humanoid warrior
    this.setScale(0.75);
    this.body.setSize(22, 42);
    this.body.setOffset(64, 54);
    this.setDepth(19);

    this.mobType = 'skeleton_warrior';
    this.hp = GAME_CONFIG.MOBS.SKELETON_WARRIOR.HP || 65;
    this.maxHp = this.hp;
    this.state = 'PATROL'; // PATROL, GUARDED, ATTACK, STUNNED, DEAD
    this.patrolDir = -1;
    this.setFlipX(false); // flipX false faces left, true faces right

    this.attackCooldownUntil = 0;
    this.stateTimer = 0;
    this.isGuarding = false;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3, -24);
    this.play('skeleton_walk_anim', true);
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
        this.state = 'PATROL';
        this.isGuarding = false;
        this.play('skeleton_walk_anim', true);
      }
      return;
    }

    if (this.state === 'ATTACK') {
      // Thrusting attack in progress
      this.setVelocityX(0);
      return;
    }

    // Facing calculation: skeleton faces towards player when engaged
    if (dist < 140 && dy < 50) {
      const faceLeft = player.x < this.x;
      this.setFlipX(!faceLeft);

      // Raise shield if player is facing and approaching
      if (dist > 35 && dist < 120) {
        if (!this.isGuarding) {
          this.state = 'GUARDED';
          this.isGuarding = true;
          this.setVelocityX(0);
          this.play('skeleton_shield_anim', true);
        }
      } else if (dist <= 35 && now > this.attackCooldownUntil) {
        // In striking range -> sword thrust!
        this.startAttack(player);
      }
    } else {
      // Normal patrol
      this.isGuarding = false;
      this.state = 'PATROL';
      this.setVelocityX(this.patrolDir * (GAME_CONFIG.MOBS.SKELETON_WARRIOR.WALK_SPEED || 45));
      this.setFlipX(this.patrolDir > 0);
      if (this.anims.currentAnim?.key !== 'skeleton_walk_anim') {
        this.play('skeleton_walk_anim', true);
      }

      if (this.body.blocked.left) this.patrolDir = 1;
      else if (this.body.blocked.right) this.patrolDir = -1;
    }
  }

  startAttack(player) {
    this.state = 'ATTACK';
    this.isGuarding = false;
    this.setVelocityX(0);
    this.attackCooldownUntil = this.scene.time.now + 2200;
    this.play('skeleton_attack_anim', true);
    sound.playSlash(1);

    // Damage window during sword slash swing
    this.scene.time.delayedCall(220, () => {
      if (this.state === 'DEAD' || !player || player.isDead) return;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (dist < 42 && Math.abs(player.y - this.y) < 35) {
        const kDir = this.flipX ? 1 : -1;
        player.takeDamage(GAME_CONFIG.MOBS.SKELETON_WARRIOR.DAMAGE || 22, kDir);
      }
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD') {
        this.state = 'PATROL';
        this.play('skeleton_walk_anim', true);
      }
    });
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    // Direction check:
    // flipX false = faces left (back is right: attackFromX > this.x)
    // flipX true = faces right (back is left: attackFromX < this.x)
    const facesRight = this.flipX;
    const attackerBehind = facesRight ? (attackFromX < this.x) : (attackFromX > this.x);

    let finalDmg = amount;
    let isCrit = false;

    // 1. Backstab bypasses shield completely
    if (attackerBehind) {
      finalDmg = Math.round(amount * 2.8);
      isCrit = true;
    } else if (isUpwardSlash) {
      // 2. Upward slash breaks shield phalanx
      finalDmg = Math.round(amount * 1.5);
      this.isGuarding = false;
      juice.spawnDamageNumber(this.scene, this.x, this.y - 20, finalDmg, 'counter', `GUARD BROKEN! -${finalDmg}`);
      juice.hitStopHeavy(this.scene);
    } else if (this.isGuarding) {
      // 3. Frontal block absorbs damage
      sound.playWallSlide();
      this.scene.showFloatingText(this.x, this.y - 22, 'BLOCKED! 🛡️', '#e2e8f0');
      juice.hitStopLight(this.scene);
      return { killed: false, pts: 0 };
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (isCrit) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 20, finalDmg, 'crit', `BACKSTAB -${finalDmg}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else if (!isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 20, finalDmg, 'normal');
      juice.hitStopLight(this.scene);
    }

    this.state = 'STUNNED';
    this.isGuarding = false;
    this.stateTimer = this.scene.time.now + 450;
    this.play('skeleton_hit_anim', true);

    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 90);
    this.setVelocityY(-90);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.SKELETON_WARRIOR.PTS || 70 };
    }
    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('skeleton_dead_anim', true);

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

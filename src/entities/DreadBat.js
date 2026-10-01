import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class DreadBat extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'dread_bat_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(30, 24);
    this.body.setOffset(17, 20);
    this.body.setAllowGravity(false);
    this.setScale(1.0);
    this.setDepth(19);

    this.mobType = 'dread_bat';
    this.hp = (GAME_CONFIG.MOBS.DREAD_BAT && GAME_CONFIG.MOBS.DREAD_BAT.HP) || 40;
    this.maxHp = this.hp;
    this.state = 'HOVER'; // HOVER, SWOOP_DIVE, RECOVER, STUNNED, DEAD

    this.hoverBaseY = y;
    this.hoverTimer = 0;
    this.patrolDir = 1;
    this.attackCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3, -18);
    this.play('dread_bat_idle_anim', true);
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
        this.state = 'HOVER';
        this.clearTint();
        this.play('dread_bat_idle_anim', true);
      }
      return;
    }

    if (this.state === 'RECOVER') {
      // Fly back up to roost altitude
      const dy = this.hoverBaseY - this.y;
      if (Math.abs(dy) < 8) {
        this.state = 'HOVER';
        this.play('dread_bat_idle_anim', true);
      } else {
        this.setVelocityY(dy < 0 ? 90 : -90);
        this.setVelocityX(this.patrolDir * 40);
        this.setFlipX(this.patrolDir > 0);
      }
      return;
    }

    if (this.state === 'SWOOP_DIVE') {
      if (this.body && Math.abs(this.body.velocity.x) > 10) {
        this.setFlipX(this.body.velocity.x > 0);
      }
      if (now > this.stateTimer) {
        this.state = 'RECOVER';
      }
      return;
    }

    // Hover state: gentle bobbing and patrol
    this.hoverTimer += 0.05;
    this.y = this.hoverBaseY + Math.sin(this.hoverTimer) * 10;

    const dirToPlayer = player.x < this.x ? -1 : 1;

    // Telegraph and trigger Swoop Dive
    if (dist < 200 && dist > 40 && now > this.attackCooldownUntil) {
      this.swoopDive(player);
      return;
    }

    // Facing direction: face player when close, face patrol direction when roaming
    if (dist < 220) {
      this.setFlipX(dirToPlayer > 0);
    } else {
      this.setFlipX(this.patrolDir > 0);
    }

    // Patrol back and forth (strictly bounded before boss arena seal!)
    const flySpeed = (GAME_CONFIG.MOBS.DREAD_BAT && GAME_CONFIG.MOBS.DREAD_BAT.FLY_SPEED) || 75;
    const maxRight = Math.min((this.scene.levelWidth || 2600) - 100, (this.scene.gateX || 2090) - 80);
    this.setVelocityX(this.patrolDir * flySpeed);

    if (this.x < 100) {
      this.x = 100;
      this.patrolDir = 1;
      this.setFlipX(true);
    } else if (this.x > maxRight) {
      this.x = maxRight;
      this.patrolDir = -1;
      this.setFlipX(false);
    } else if (this.body.blocked.left) {
      this.patrolDir = 1;
      this.setFlipX(true);
    } else if (this.body.blocked.right) {
      this.patrolDir = -1;
      this.setFlipX(false);
    }
  }

  swoopDive(player) {
    this.state = 'SWOOP_DIVE';
    this.attackCooldownUntil = this.scene.time.now + 2800;
    this.stateTimer = this.scene.time.now + 900;
    const dirToPlayer = player.x < this.x ? -1 : 1;
    this.setFlipX(dirToPlayer > 0);
    this.play('dread_bat_attack_anim', true);
    sound.playWhoosh();

    const diveSpeed = (GAME_CONFIG.MOBS.DREAD_BAT && GAME_CONFIG.MOBS.DREAD_BAT.DIVE_SPEED) || 220;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    this.setVelocity(Math.cos(angle) * diveSpeed, Math.sin(angle) * diveSpeed);
  }

  takeDamage(amount, sourceX) {
    if (this.state === 'DEAD') return false;

    this.hp -= amount;
    sound.playHit();
    juice.flashWhite(this, 90);

    const isCrit = amount >= 35 || this.state === 'SWOOP_DIVE';
    if (this.state === 'SWOOP_DIVE') {
      amount = Math.round(amount * 1.5);
      juice.spawnFloatingText(this.scene, this.x, this.y - 25, 'DIVE COUNTER! 🦇', '#a855f7');
    }

    juice.spawnDamageNumber(this.scene, this.x, this.y - 20, amount, isCrit ? 'crit' : 'normal');
    juice.hitStop(this.scene, isCrit ? 45 : 25);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: (GAME_CONFIG.MOBS.DREAD_BAT && GAME_CONFIG.MOBS.DREAD_BAT.PTS) || 55 };
    }

    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 380;
    const knockDir = sourceX < this.x ? 1 : -1;
    this.setVelocity(knockDir * 80, -60);
    this.setTint(0xc084fc);

    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.enable = false;
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }

    juice.spawnDeathParticles(this.scene, this.x, this.y, 0x9333ea);
    sound.playMonsterDeath();

    this.scene.tweens.add({
      targets: this,
      y: this.y + 40,
      alpha: 0,
      rotation: 1.2,
      duration: 350,
      onComplete: () => {
        this.destroy();
      }
    });
  }
}

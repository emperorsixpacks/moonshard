import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import Projectile from './Projectile.js';

export default class BogLurker extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'bog_lurker_walk');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(18, 32);
    this.body.setOffset(3, 6);
    this.setScale(1.2);
    this.setDepth(19);

    this.mobType = 'bog_lurker';
    this.hp = (GAME_CONFIG.MOBS.BOG_LURKER && GAME_CONFIG.MOBS.BOG_LURKER.HP) || 55;
    this.maxHp = this.hp;
    this.state = 'PATROL'; // PATROL, SPIT, STUNNED, DEAD
    this.patrolDir = -1;
    this.setFlipX(false);

    this.attackCooldownUntil = 0;
    this.spitCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 24, 3, -24);
    this.play('bog_lurker_walk_anim', true);
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
        this.clearTint();
        this.play('bog_lurker_walk_anim', true);
      }
      return;
    }

    if (this.state === 'SPIT') {
      this.setVelocityX(0);
      if (now > this.stateTimer) {
        this.state = 'PATROL';
        this.play('bog_lurker_walk_anim', true);
      }
      return;
    }

    const dirToPlayer = player.x < this.x ? -1 : 1;

    // Mud / Slime Glob Spit Attack
    if (dist < 220 && dy < 60 && now > this.spitCooldownUntil && this.body.blocked.down) {
      this.spitSlime(player, dirToPlayer);
      return;
    }

    // Ground Patrol with ledge edge detection & gate safety
    const speed = (GAME_CONFIG.MOBS.BOG_LURKER && GAME_CONFIG.MOBS.BOG_LURKER.WALK_SPEED) || 35;
    const hitWall = this.body.blocked.left || this.body.blocked.right;
    const hitLedge = this.isLedgeAhead(this.patrolDir);
    const gateClamped = this.scene.gateX && this.x >= this.scene.gateX - 60;

    if (hitWall || hitLedge || gateClamped) {
      if (gateClamped) {
        this.x = this.scene.gateX - 60;
        this.patrolDir = -1;
      } else {
        this.patrolDir *= -1;
      }
    }

    if (dist < 180 && !this.isLedgeAhead(dirToPlayer)) {
      this.setFlipX(dirToPlayer > 0);
      this.setVelocityX(dirToPlayer * speed * 1.25);
    } else {
      this.setFlipX(this.patrolDir > 0);
      this.setVelocityX(this.patrolDir * speed);
    }
  }

  isLedgeAhead(dir) {
    if (!this.body || !this.body.blocked.down || !this.scene.platforms) return false;

    const lookX = this.x + (dir * (this.body.width / 2 + 10));
    const footY = this.body.bottom + 8;

    const hasGround = this.scene.platforms.getChildren().some(plat => {
      const pb = plat.body;
      if (!pb) return false;
      return lookX >= pb.left && lookX <= pb.right && footY >= pb.top && footY <= pb.bottom + 14;
    });

    return !hasGround;
  }

  spitSlime(player, dir) {
    this.state = 'SPIT';
    this.stateTimer = this.scene.time.now + 650;
    this.spitCooldownUntil = this.scene.time.now + 2500;
    this.setVelocityX(0);
    this.setFlipX(dir > 0);

    this.scene.time.delayedCall(220, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      const vx = dir * ((GAME_CONFIG.MOBS.BOG_LURKER && GAME_CONFIG.MOBS.BOG_LURKER.SPIT_SPEED) || 160);
      const vy = -60;
      this.scene.spawnProjectile('mud_glob', this.x + (dir * 12), this.y - 4, vx, vy, true);
      sound.playHit();
    });
  }

  takeDamage(amount, sourceX) {
    if (this.state === 'DEAD') return false;

    this.hp -= amount;
    sound.playHit();
    juice.flashWhite(this, 90);

    const isStomp = Math.abs(sourceX - this.x) < 8;
    const isCrit = amount >= 35;
    juice.spawnDamageNumber(this.scene, this.x, this.y - 20, amount, isCrit ? 'crit' : 'normal');
    juice.hitStop(this.scene, isCrit ? 45 : 25);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: (GAME_CONFIG.MOBS.BOG_LURKER && GAME_CONFIG.MOBS.BOG_LURKER.PTS) || 60 };
    }

    // Sludge stagger
    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 380;
    const knockDir = sourceX < this.x ? 1 : -1;
    this.setVelocity(knockDir * 90, -80);
    this.setTint(0x4ade80);

    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.enable = false;
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }

    juice.spawnDeathParticles(this.scene, this.x, this.y, 0x22c55e);
    sound.playMonsterDeath();

    this.scene.tweens.add({
      targets: this,
      scaleY: 0.1,
      scaleX: 1.5,
      alpha: 0,
      duration: 350,
      onComplete: () => {
        this.destroy();
      }
    });
  }
}

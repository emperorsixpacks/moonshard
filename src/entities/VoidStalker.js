import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class VoidStalker extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'void_stalker_run');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(44, 24);
    this.body.setOffset(20, 12);
    this.setScale(1.15);
    this.setDepth(19);

    this.mobType = 'void_stalker';
    this.hp = (GAME_CONFIG.MOBS.VOID_STALKER && GAME_CONFIG.MOBS.VOID_STALKER.HP) || 65;
    this.maxHp = this.hp;
    this.state = 'RUN'; // RUN, POUNCE, STUNNED, DEAD
    this.patrolDir = -1;

    this.attackCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 32, 3, -20);
    this.play('void_stalker_run_anim', true);
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
        this.state = 'RUN';
        this.clearTint();
        this.play('void_stalker_run_anim', true);
      }
      return;
    }

    if (this.state === 'POUNCE') {
      if (now > this.stateTimer || this.body.blocked.down) {
        this.state = 'RUN';
        this.play('void_stalker_run_anim', true);
      }
      return;
    }

    const dirToPlayer = player.x < this.x ? -1 : 1;

    // Pounce Leap Attack (only if no pit / chasm ahead!)
    if (dist < 160 && dist > 50 && dy < 50 && now > this.attackCooldownUntil && this.body.blocked.down) {
      if (!this.isLedgeAhead(dirToPlayer)) {
        this.pounceAttack(player, dirToPlayer);
        return;
      }
    }

    // Fast Sprinting Patrol with ledge edge detection & gate safety
    const runSpeed = (GAME_CONFIG.MOBS.VOID_STALKER && GAME_CONFIG.MOBS.VOID_STALKER.RUN_SPEED) || 115;
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

    if (dist < 240 && !this.isLedgeAhead(dirToPlayer)) {
      this.setFlipX(dirToPlayer > 0);
      this.setVelocityX(dirToPlayer * runSpeed);
    } else {
      this.setFlipX(this.patrolDir > 0);
      this.setVelocityX(this.patrolDir * runSpeed * 0.7);
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

  pounceAttack(player, dir) {
    this.state = 'POUNCE';
    this.attackCooldownUntil = this.scene.time.now + 2600;
    this.stateTimer = this.scene.time.now + 850;
    this.setFlipX(dir > 0);

    const pounceSpeed = (GAME_CONFIG.MOBS.VOID_STALKER && GAME_CONFIG.MOBS.VOID_STALKER.POUNCE_SPEED) || 230;
    this.setVelocity(dir * pounceSpeed, -140);
    sound.playWhoosh();
    juice.spawnFloatingText(this.scene, this.x, this.y - 25, 'VOID POUNCE! ⚡', '#c084fc');
  }

  takeDamage(amount, sourceX) {
    if (this.state === 'DEAD') return false;

    const inMidPounce = this.state === 'POUNCE';
    let finalDamage = amount;
    if (inMidPounce) {
      finalDamage = Math.round(amount * 1.6);
      juice.spawnFloatingText(this.scene, this.x, this.y - 25, 'POUNCE COUNTER! 💥', '#e879f9');
    }

    this.hp -= finalDamage;
    sound.playHit();
    juice.flashWhite(this, 90);
    juice.spawnDamageNumber(this.scene, this.x, this.y - 20, finalDamage, inMidPounce ? 'counter' : 'normal');
    juice.hitStop(this.scene, inMidPounce ? 45 : 25);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: (GAME_CONFIG.MOBS.VOID_STALKER && GAME_CONFIG.MOBS.VOID_STALKER.PTS) || 90 };
    }

    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 320;
    const knockDir = sourceX < this.x ? 1 : -1;
    this.setVelocity(knockDir * 90, -60);
    this.setTint(0xa855f7);

    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.enable = false;
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }

    juice.spawnDeathParticles(this.scene, this.x, this.y, 0x8b5cf6);
    sound.playMonsterDeath();

    this.scene.tweens.add({
      targets: this,
      scaleX: 0.1,
      scaleY: 1.4,
      alpha: 0,
      duration: 350,
      onComplete: () => {
        this.destroy();
      }
    });
  }
}

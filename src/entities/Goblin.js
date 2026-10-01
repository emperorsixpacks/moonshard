import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class Goblin extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'goblin_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Frame 150x150. Body is 30x36 at (59, 65)
    this.body.setSize(30, 36);
    this.body.setOffset(59, 65);
    this.setDepth(19);

    this.mobType = 'goblin';
    this.hp = GAME_CONFIG.MOBS.GOBLIN.HP;
    this.maxHp = GAME_CONFIG.MOBS.GOBLIN.HP;
    this.state = 'PATROL'; // PATROL, ATTACK, STUNNED, DEAD
    this.patrolDir = -1;
    this.setFlipX(true); // LuizMelo faces right by default; flipX=true faces left

    this.attackCooldownUntil = 0;
    this.stunnedUntil = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3.5, 6);
    this.play('goblin_run_anim');
  }

  update(player) {
    if (this.healthBar) this.healthBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocityX(0);
      return;
    }

    const hitWall = this.body.blocked.left || this.body.blocked.right;

    if (this.state === 'STUNNED') {
      if (this.scene.time.now > this.stunnedUntil) {
        this.state = 'PATROL';
        this.play('goblin_run_anim', true);
      }
      return;
    }

    if (this.state === 'ATTACK') {
      this.setVelocityX(0);
      return;
    }

    if (hitWall || this.isLedgeAhead(this.patrolDir)) {
      this.patrolDir *= -1;
    }

    this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.GOBLIN.WALK_SPEED);
    this.setFlipX(this.patrolDir < 0);

    // Check player for bomb toss (360-degree proximity)
    if (player && !player.isDead && this.scene.time.now > this.attackCooldownUntil) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      const dy = Math.abs(this.y - player.y);

      if (dist < 240 && dy < 70) {
        this.startAttack(player);
      }
    }
  }

  isLedgeAhead(dir) {
    if (!this.body.blocked.down || !this.scene.platforms) return false;

    // In Survival arena, allow walking off upper platforms if player is below
    if (this.scene.scene && this.scene.scene.key === 'SurvivalScene') {
      const player = this.scene.player;
      if (player && !player.isDead && player.y > this.y + 35) {
        return false;
      }
    }

    const lookX = this.x + (dir * (this.body.width / 2 + 8));
    const footY = this.body.bottom + 6;

    const hasGround = this.scene.platforms.getChildren().some(plat => {
      const pb = plat.body;
      if (!pb) return false;
      return lookX >= pb.left && lookX <= pb.right && footY >= pb.top && footY <= pb.bottom + 14;
    });

    return !hasGround;
  }

  startAttack(player) {
    this.state = 'ATTACK';
    this.setVelocityX(0);
    this.attackCooldownUntil = this.scene.time.now + 3200;

    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    this.play('goblin_attack_anim', true);

    // Throw bomb at frame 4 (approx 350ms)
    this.scene.time.delayedCall(350, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      this.tossBomb(dir, player);
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD') {
        this.state = 'PATROL';
        this.play('goblin_run_anim', true);
      }
    });
  }

  tossBomb(dir, player) {
    sound.playSlash(1);
    const spawnX = this.x + (dir * 20);
    const spawnY = this.y - 6;

    const throwPower = Phaser.Math.Clamp(Math.abs(player.x - this.x) * 1.1, 90, 180);
    const vx = dir * throwPower;
    const vy = -180;

    if (typeof this.scene.spawnProjectile === 'function') {
      this.scene.spawnProjectile('goblin_bomb', spawnX, spawnY, vx, vy);
    }
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    this.hp -= amount;
    sound.playHit();
    juice.spawnDamageNumber(this.scene, this.x, this.y - 18, amount, isUpwardSlash ? 'upslash' : 'normal');
    juice.hitStopLight(this.scene);

    // Knockback
    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 130);
    this.setVelocityY(-90);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.GOBLIN.PTS };
    } else {
      this.state = 'STUNNED';
      this.stunnedUntil = this.scene.time.now + 260;
      this.play('goblin_hit_anim', true);
      this.setTint(0xff5555);
      this.scene.time.delayedCall(120, () => this.clearTint());
      return { killed: false, pts: 0 };
    }
  }

  die() {
    this.state = 'DEAD';
    if (this.healthBar) this.healthBar.setVisible(false);
    this.body.setEnable(false);
    sound.playEnemyDeath();
    this.play('goblin_dead_anim', true);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 10,
      duration: 450,
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

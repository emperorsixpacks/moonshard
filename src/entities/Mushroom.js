import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class Mushroom extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'mushroom_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Frame is 150x150. Sprite center is ~75, body is 24x38 at (63, 63)
    this.body.setSize(24, 38);
    this.body.setOffset(63, 63);
    this.setDepth(19);

    this.mobType = 'mushroom';
    this.hp = GAME_CONFIG.MOBS.MUSHROOM.HP;
    this.maxHp = GAME_CONFIG.MOBS.MUSHROOM.HP;
    this.state = 'PATROL'; // PATROL, ATTACK, STUNNED, DEAD
    this.patrolDir = -1; // -1 = left, 1 = right
    this.setFlipX(true); // LuizMelo sprites face right by default. flipX=true faces left

    this.attackCooldownUntil = 0;
    this.stunnedUntil = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3.5, 6);
    this.play('mushroom_run_anim');
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
        this.play('mushroom_run_anim', true);
      }
      return;
    }

    if (this.state === 'ATTACK') {
      this.setVelocityX(0);
      return;
    }

    // Default: PATROL with ledge check
    if (hitWall || this.isLedgeAhead(this.patrolDir)) {
      this.patrolDir *= -1;
    }

    this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.MUSHROOM.WALK_SPEED);
    this.setFlipX(this.patrolDir < 0);

    // Check player for ranged toxic spore attack (farther range and player targeting)
    if (player && !player.isDead && this.scene.time.now > this.attackCooldownUntil) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      const dy = Math.abs(this.y - player.y);

      if (dist < 380 && dy < 220) {
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
    this.attackCooldownUntil = this.scene.time.now + 2600;

    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    this.play('mushroom_attack_anim', true);

    // Telegraph charge effect at spore cap so player can anticipate and dodge
    const chargeEffect = this.scene.add.circle(this.x + dir * 16, this.y - 6, 4, 0x88ff44, 0.8).setDepth(21);
    this.scene.tweens.add({
      targets: chargeEffect,
      scale: 2.0,
      alpha: 0,
      duration: 380,
      onComplete: () => chargeEffect.destroy()
    });

    // Fire spore on windup completion
    this.scene.time.delayedCall(400, () => {
      if (!this.active || !this.scene || this.state === 'DEAD') return;
      this.fireSpore(dir, player);
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!this.active || !this.scene || this.state === 'DEAD') return;
      this.state = 'PATROL';
      this.play('mushroom_run_anim', true);
    });

    // Failsafe timer to return to PATROL if animation complete doesn't trigger
    this.scene.time.delayedCall(900, () => {
      if (!this.active || !this.scene || this.state === 'DEAD') return;
      if (this.state === 'ATTACK') {
        this.state = 'PATROL';
        this.play('mushroom_run_anim', true);
      }
    });
  }

  fireSpore(dir, targetPlayer) {
    sound.playSlash(1);
    const spawnX = this.x + (dir * 18);
    const spawnY = this.y - 6;

    if (this.scene && typeof this.scene.spawnProjectile === 'function') {
      const player = (targetPlayer && !targetPlayer.isDead) ? targetPlayer : this.scene.player;
      const speed = GAME_CONFIG.MOBS.MUSHROOM.SPORE_SPEED || 180;

      let vx = dir * speed;
      let vy = 0;

      if (player && !player.isDead) {
        // Accurately aim toward the player's center so player can react and dodge
        const targetX = player.x;
        const targetY = player.y - 12;
        const angle = Phaser.Math.Angle.Between(spawnX, spawnY, targetX, targetY);
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      }

      this.scene.spawnProjectile('spore', spawnX, spawnY, vx, vy, true);
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
    this.setVelocityX(knockDir * 110);
    this.setVelocityY(-90);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.MUSHROOM.PTS };
    } else {
      this.state = 'STUNNED';
      this.stunnedUntil = this.scene.time.now + 280;
      this.play('mushroom_hit_anim', true);
      this.setTint(0xff5555);
      this.scene.time.delayedCall(120, () => this.clearTint());
      return { killed: false, pts: 0 };
    }
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('mushroom_dead_anim', true);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 12,
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

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import Projectile from './Projectile.js';

export default class AstralShade extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'nightborne_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(0.75);
    this.body.setSize(24, 38);
    this.body.setOffset(28, 26);
    this.setDepth(19);

    // Ethereal cosmic violet tint & translucency
    this.setTint(0xc084fc);
    this.setAlpha(0.48);

    this.mobType = 'astral_shade';
    this.hp = GAME_CONFIG.MOBS.ASTRAL_SHADE.HP || 55;
    this.maxHp = this.hp;
    this.state = 'PHASE_DRIFT'; // PHASE_DRIFT, SOLID_CAST, WARP, STUNNED, DEAD

    this.patrolDir = -1;
    this.attackCooldownUntil = 0;
    this.stateTimer = 0;
    this.recentHits = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3, -24);
    this.play('nightborne_run_anim', true);
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
        this.state = 'PHASE_DRIFT';
        this.setAlpha(0.48);
        this.play('nightborne_run_anim', true);
      }
      return;
    }

    if (this.state === 'SOLID_CAST') {
      this.setVelocityX(0);
      return;
    }

    if (this.state === 'PHASE_DRIFT') {
      // Ethereal hovering drift
      this.setVelocityX(this.patrolDir * (GAME_CONFIG.MOBS.ASTRAL_SHADE.FLOAT_SPEED || 60));
      this.setFlipX(player.x > this.x);

      if (this.body.blocked.left) this.patrolDir = 1;
      else if (this.body.blocked.right) this.patrolDir = -1;

      // Close to mid range cast window
      if (dist < 170 && dy < 65 && now > this.attackCooldownUntil) {
        this.startSolidCast(player);
      }
    }
  }

  startSolidCast(player) {
    this.state = 'SOLID_CAST';
    this.setVelocityX(0);
    this.attackCooldownUntil = this.scene.time.now + 3000;

    // Solidify visually right before firing
    this.setAlpha(1.0);
    this.play('nightborne_attack_anim', true);

    const dirX = player.x < this.x ? -1 : 1;
    this.setFlipX(dirX > 0);

    // Fire crescent ray at swing peak
    this.scene.time.delayedCall(300, () => {
      if (this.state === 'DEAD' || !this.active || this.state === 'STUNNED') return;
      sound.playSlash(2);
      const crescent = new Projectile(
        this.scene,
        this.x + dirX * 16,
        this.y - 2,
        'lunar_crescent',
        dirX * (GAME_CONFIG.MOBS.ASTRAL_SHADE.CRESCENT_SPEED || 180),
        0,
        GAME_CONFIG.MOBS.ASTRAL_SHADE.DAMAGE || 22,
        'enemy',
        0.8
      );
      crescent.body.setAllowGravity(false);
      if (this.scene.projectiles) {
        this.scene.projectiles.add(crescent);
      }
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD' && this.state !== 'STUNNED') {
        this.state = 'PHASE_DRIFT';
        this.setAlpha(0.48);
        this.play('nightborne_run_anim', true);
      }
    });
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    let finalDmg = amount;
    let isCasting = this.state === 'SOLID_CAST';

    // Punish window: striking while casting deals counter damage
    if (isCasting) {
      finalDmg = Math.round(amount * 2.2);
    } else if (isUpwardSlash) {
      finalDmg = Math.round(amount * 1.5);
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (isCasting) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 22, finalDmg, 'counter', `VOID PUNISH -${finalDmg}! 💥`);
      juice.hitStopCrit(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 22, finalDmg, 'upslash');
      juice.hitStopHeavy(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 22, finalDmg, 'normal');
      juice.hitStopLight(this.scene);
    }

    this.recentHits++;
    if (this.recentHits >= 2 && this.hp > 0) {
      // Evasive blink warp
      this.recentHits = 0;
      this.performShadowWarp();
      return { killed: false, pts: 0 };
    }

    this.state = 'STUNNED';
    this.setAlpha(0.8);
    this.stateTimer = this.scene.time.now + 400;
    this.play('nightborne_hit_anim', true);

    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 80);
    this.setVelocityY(-80);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.ASTRAL_SHADE.PTS || 75 };
    }
    return { killed: false, pts: 0 };
  }

  performShadowWarp() {
    sound.playWallSlide();
    const warpDir = this.flipX ? -1 : 1;
    this.x += warpDir * 60;
    this.state = 'PHASE_DRIFT';
    this.setAlpha(0.48);
    this.play('nightborne_run_anim', true);
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.setAlpha(1.0);
    this.play('nightborne_dead_anim', true);

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

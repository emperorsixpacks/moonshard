import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import Projectile from './Projectile.js';

export default class Mirelurker extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'boar_walk');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Collider setup (compact swamp amphibian body)
    this.body.setSize(30, 20);
    this.body.setOffset(9, 12);
    this.setDepth(19);

    // Deep marsh bioluminescent moss tint
    this.setTint(0x34d399);

    this.mobType = 'mirelurker';
    this.hp = GAME_CONFIG.MOBS.MIRELURKER.HP || 55;
    this.maxHp = this.hp;
    this.state = 'PATROL'; // PATROL, COILED, LEAP, STUNNED, DEAD
    this.patrolDir = -1;
    this.setFlipX(false);

    this.attackCooldownUntil = 0;
    this.spitCooldownUntil = 0;
    this.stateTimer = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 26, 3, -16);
    this.play('boar_walk_anim', true);
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
        this.setTint(0x34d399);
        this.play('boar_walk_anim', true);
      }
      return;
    }

    if (this.state === 'COILED') {
      this.setVelocityX(0);
      if (now > this.stateTimer) {
        this.performLeap(player);
      }
      return;
    }

    if (this.state === 'LEAP') {
      // Landed back on ground after leap
      if (this.body.blocked.down && now > this.stateTimer + 150) {
        this.state = 'PATROL';
        this.play('boar_walk_anim', true);
        this.attackCooldownUntil = now + 2400;
      }
      return;
    }

    // --- PATROL STATE ---
    if (this.state === 'PATROL') {
      // Face towards patrol direction
      this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.MIRELURKER.WALK_SPEED);
      this.setFlipX(this.patrolDir > 0);

      // Check patrol boundaries or ledges
      if (this.body.blocked.left) this.patrolDir = 1;
      else if (this.body.blocked.right) this.patrolDir = -1;

      // Ambush trigger: close range (< 120px) -> coil and leap!
      if (dist < 120 && dy < 45 && now > this.attackCooldownUntil) {
        this.coilAmbush(player);
        return;
      }

      // Mid-range mud glob spit (120px - 220px)
      if (dist >= 120 && dist < 220 && dy < 60 && now > this.spitCooldownUntil) {
        this.spitMudGlob(player);
      }
    }
  }

  coilAmbush(player) {
    this.state = 'COILED';
    this.stateTimer = this.scene.time.now + 400;
    this.setVelocityX(0);
    this.setTint(0x10b981); // Brightens as it coils
    this.play('boar_idle_anim', true);

    const alertMark = this.scene.add.text(this.x, this.y - 18, '🫧', {
      fontSize: '8px'
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: alertMark,
      y: this.y - 28,
      alpha: 0,
      duration: 380,
      onComplete: () => alertMark.destroy()
    });
  }

  performLeap(player) {
    this.state = 'LEAP';
    this.stateTimer = this.scene.time.now;
    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir > 0);

    // High energetic arc leap
    this.setVelocityX(dir * (GAME_CONFIG.MOBS.MIRELURKER.LEAP_SPEED || 210));
    this.setVelocityY(-260);
    sound.playSlash(1);
    this.play('boar_run_anim', true);
  }

  spitMudGlob(player) {
    this.spitCooldownUntil = this.scene.time.now + 3200;
    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir > 0);

    const mud = new Projectile(
      this.scene,
      this.x + dir * 14,
      this.y - 4,
      'mud_glob',
      dir * (GAME_CONFIG.MOBS.MIRELURKER.SPIT_SPEED || 170),
      -40,
      GAME_CONFIG.MOBS.MIRELURKER.DAMAGE || 18,
      'enemy',
      0.8
    );
    mud.body.setAllowGravity(true);
    mud.body.setGravityY(250);

    if (this.scene.projectiles) {
      this.scene.projectiles.add(mud);
    }
    sound.playWallSlide();
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    let finalDmg = amount;
    let isStompVuln = this.state === 'LEAP' || this.state === 'COILED';

    if (isStompVuln) {
      finalDmg = Math.round(amount * 1.8);
    } else if (isUpwardSlash) {
      finalDmg = Math.round(amount * 1.5);
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (isStompVuln) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDmg, 'crit', `LEAP COUNTER -${finalDmg}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDmg, 'upslash');
      juice.hitStopLight(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDmg, 'normal');
      juice.hitStopLight(this.scene);
    }

    // Stun on hit
    this.state = 'STUNNED';
    this.stateTimer = this.scene.time.now + 400;
    this.play('boar_hit_anim', true);

    // Knockback
    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 110);
    this.setVelocityY(-110);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.MIRELURKER.PTS || 60 };
    }
    return { killed: false, pts: 0 };
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('boar_hit_anim');

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 10,
      duration: 350,
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

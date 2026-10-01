import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class BossSkeleton extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, healthBar = null) {
    super(scene, x, y, 'skeleton_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.healthBar = healthBar;
    this.overheadBar = new EnemyHealthBar(scene, this, 44, 5, 12);
    this.mobType = 'boss_skeleton';
    this.bossName = GAME_CONFIG.MOBS.BOSS_SKELETON.NAME;

    this.setScale(1.2);
    this.body.setSize(34, 52);
    this.body.setOffset(58, 48);
    this.body.setAllowGravity(true);
    this.setDepth(25);

    this.hp = GAME_CONFIG.MOBS.BOSS_SKELETON.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOSS_SKELETON.HP;
    this.isPhase2 = false;

    this.state = 'IDLE'; // IDLE, WALK, ATTACK, SHIELD, STUNNED, DEAD
    this.shieldGuarding = false;
    this.stunnedUntil = 0;
    this.nextActionTime = scene.time.now + 1200;
    this.walkSpeed = GAME_CONFIG.MOBS.BOSS_SKELETON.WALK_SPEED;

    this.play('skeleton_idle_anim');

    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }
  }

  update(player) {
    if (this.overheadBar) this.overheadBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocityX(0);
      return;
    }

    // Phase 2 check (< 50% HP)
    if (!this.isPhase2 && this.hp <= this.maxHp * 0.5) {
      this.triggerPhase2(player);
      return;
    }

    if (this.state === 'STUNNED') {
      this.setVelocityX(0);
      if (this.scene.time.now > this.stunnedUntil) {
        this.state = 'IDLE';
        this.shieldGuarding = false;
        this.nextActionTime = this.scene.time.now + 600;
        this.play('skeleton_idle_anim', true);
      }
      return;
    }

    if (this.state === 'ATTACK' || this.state === 'SHIELD') {
      this.setVelocityX(0);
      return;
    }

    if (!player || player.isDead) {
      this.setVelocityX(0);
      return;
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    if (this.scene.time.now > this.nextActionTime) {
      if (dist < 70) {
        this.startCleaveAttack(player);
      } else if (dist < 220 && Math.random() < 0.35) {
        this.raiseShield(player);
      } else {
        this.state = 'WALK';
        this.setVelocityX(dir * (this.isPhase2 ? this.walkSpeed * 1.35 : this.walkSpeed));
        this.play('skeleton_walk_anim', true);
        this.nextActionTime = this.scene.time.now + Phaser.Math.Between(1200, 2000);
      }
    } else if (this.state === 'WALK') {
      this.setVelocityX(dir * (this.isPhase2 ? this.walkSpeed * 1.35 : this.walkSpeed));
      if (dist < 65) {
        this.startCleaveAttack(player);
      }
    }
  }

  raiseShield(player) {
    this.state = 'SHIELD';
    this.shieldGuarding = true;
    this.setVelocityX(0);
    this.play('skeleton_shield_anim', true);

    // Shield aura effect
    const aura = this.scene.add.circle(this.x, this.y, 28, 0x88bbff, 0.25);
    this.scene.tweens.add({
      targets: aura,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 500,
      onComplete: () => aura.destroy()
    });

    const shieldDuration = this.isPhase2 ? 1400 : 2000;
    this.scene.time.delayedCall(shieldDuration, () => {
      if (this.state === 'SHIELD' && this.state !== 'DEAD') {
        this.shieldGuarding = false;
        this.state = 'IDLE';
        this.play('skeleton_idle_anim', true);
        this.nextActionTime = this.scene.time.now + 500;
      }
    });
  }

  startCleaveAttack(player) {
    this.state = 'ATTACK';
    this.shieldGuarding = false;
    this.setVelocityX(0);
    this.play('skeleton_attack_anim', true);
    sound.playEnemyAttack();

    // Hitbox timing on active frame (frame 4-5)
    this.scene.time.delayedCall(380, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      const attackRange = 75;
      const p = this.scene.player;
      if (p && !p.isDead) {
        const pDist = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
        const facingPlayer = (this.flipX && p.x < this.x) || (!this.flipX && p.x > this.x);
        if (pDist < attackRange && facingPlayer) {
          const kDir = this.x < p.x ? 1 : -1;
          p.takeDamage(GAME_CONFIG.MOBS.BOSS_SKELETON.DAMAGE, kDir);
          this.scene.cameras.main.shake(120, 0.012);
        }
      }
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state === 'DEAD') return;
      this.state = 'IDLE';
      this.play('skeleton_idle_anim', true);
      this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 800 : 1300);
    });
  }

  triggerPhase2(player) {
    this.isPhase2 = true;
    this.state = 'STUNNED';
    this.stunnedUntil = this.scene.time.now + 1200;
    this.shieldGuarding = false;
    this.setVelocityX(0);
    this.play('skeleton_shield_anim', true);
    this.setTint(0xff8888);

    sound.playHit();
    this.scene.cameras.main.shake(250, 0.02);

    // Floating text
    this.scene.showFloatingText(this.x, this.y - 45, 'SOVEREIGN ENRAGED!', '#ff4444');

    // Summon skeleton reinforcement minions in Chapter 3
    if (this.scene && typeof this.scene.spawnMob === 'function') {
      this.scene.time.delayedCall(400, () => {
        if (!this.active || this.state === 'DEAD') return;
        this.scene.spawnMob('goblin', this.x - 120, this.y);
        this.scene.spawnMob('flying_eye', this.x + 120, this.y - 80);
      });
    }
  }

  takeDamage(amount, fromX = null, isBackstab = false, isCounter = false) {
    if (this.state === 'DEAD') return;

    // Shield Guard mechanic: Frontal hits blocked!
    if (this.shieldGuarding) {
      const isFromBehind = fromX !== null && ((this.flipX && fromX > this.x) || (!this.flipX && fromX < this.x));
      if (!isFromBehind && !isBackstab) {
        // Blocked!
        sound.playHit();
        this.scene.showFloatingText(this.x, this.y - 30, 'BLOCKED!', '#ffff44');
        
        // Deflection sparks
        for (let i = 0; i < 6; i++) {
          const spark = this.scene.add.rectangle(this.x + (this.flipX ? -20 : 20), this.y, 4, 4, 0xffffff);
          this.scene.tweens.add({
            targets: spark,
            x: spark.x + (this.flipX ? -25 : 25) + Phaser.Math.Between(-10, 10),
            y: spark.y + Phaser.Math.Between(-20, 20),
            alpha: 0,
            duration: 250,
            onComplete: () => spark.destroy()
          });
        }
        return;
      } else {
        // Guard Broken!
        this.shieldGuarding = false;
        this.state = 'STUNNED';
        this.stunnedUntil = this.scene.time.now + 1000;
        this.play('skeleton_hit_anim', true);
        this.scene.showFloatingText(this.x, this.y - 30, 'GUARD BROKEN!', '#44ff44');
        amount *= 1.5;
      }
    }

    let finalDmg = amount;
    if (isBackstab) finalDmg *= 1.5;
    if (isCounter) finalDmg *= 1.5;
    finalDmg = Math.round(finalDmg);

    this.hp = Math.max(0, this.hp - finalDmg);
    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }

    sound.playHit();
    if (isBackstab) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDmg, 'crit', `CRIT -${finalDmg}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else if (isCounter) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDmg, 'counter', `COUNTER -${finalDmg}! 💥`);
      juice.hitStopHeavy(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDmg, 'normal');
      juice.hitStopHeavy(this.scene);
    }

    if (this.hp <= 0) {
      this.die();
    } else if (this.state !== 'SHIELD') {
      this.play('skeleton_hit_anim', true);
      this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (this.state !== 'DEAD' && this.state !== 'SHIELD') {
          this.state = 'IDLE';
          this.play('skeleton_idle_anim', true);
        }
      });
    }
  }

  die() {
    this.state = 'DEAD';
    this.shieldGuarding = false;
    this.setVelocity(0, 0);
    this.body.setEnable(false);

    if (this.healthBar) {
      this.healthBar.defeat();
    }

    if (this.overheadBar) {
      this.overheadBar.destroy();
      this.overheadBar = null;
    }

    sound.playEnemyDeath();
    this.play('skeleton_dead_anim', true);
    this.scene.cameras.main.shake(600, 0.025);

    // Drop bountiful amber
    storage.addMaterials({ amber: 15, iron: 10, bark: 12 });
    storage.addScore(GAME_CONFIG.MOBS.BOSS_SKELETON.PTS);
    if (typeof this.scene.updateHudMaterials === 'function') {
      this.scene.updateHudMaterials();
    }
    this.scene.showFloatingText(this.x, this.y - 40, '+15 AMBER', '#ffcc00');

    // Unlock Chapter Obelisk & Arena Gate
    if (this.scene.obelisk) {
      this.scene.obelisk.unlock();
    }
    if (typeof this.scene.openArenaGate === 'function') {
      this.scene.openArenaGate();
    }

    // Bone crumble dust
    for (let i = 0; i < 16; i++) {
      const bone = this.scene.add.rectangle(this.x, this.y, Phaser.Math.Between(3, 7), Phaser.Math.Between(3, 7), 0xdddddd);
      this.scene.physics.add.existing(bone);
      bone.body.setVelocity(Phaser.Math.Between(-140, 140), Phaser.Math.Between(-260, -60));
      bone.body.setGravityY(500);
      this.scene.tweens.add({
        targets: bone,
        alpha: 0,
        delay: 600,
        duration: 400,
        onComplete: () => bone.destroy()
      });
    }

    this.scene.time.delayedCall(1600, () => {
      if (this.scene && typeof this.scene.onBossDefeated === 'function') {
        this.scene.onBossDefeated(this);
      }
    });
  }
}

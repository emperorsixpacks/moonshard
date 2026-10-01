import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class BossDemon extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, healthBar = null) {
    super(scene, x, y, 'demon_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.healthBar = healthBar;
    this.overheadBar = new EnemyHealthBar(scene, this, 48, 5, 14);
    this.mobType = 'boss_demon';
    this.bossName = GAME_CONFIG.MOBS.BOSS_DEMON.NAME;

    this.setScale(1.4);
    this.body.setSize(42, 48);
    this.body.setOffset(18, 10);
    this.body.setAllowGravity(false);
    this.setDepth(25);

    this.hp = GAME_CONFIG.MOBS.BOSS_DEMON.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOSS_DEMON.HP;
    this.isPhase2 = false;

    this.state = 'HOVER'; // HOVER, DIVE, CAST, RETREAT, DEAD
    this.hoverBaseY = y;
    this.hoverTime = 0;
    this.nextActionTime = scene.time.now + 1500;
    this.projectiles = scene.physics.add.group();

    this.play('demon_flying_anim');

    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }
  }

  update(player) {
    if (this.overheadBar) this.overheadBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocity(0, 0);
      return;
    }

    // Phase 2 check (< 40% HP)
    if (!this.isPhase2 && this.hp <= this.maxHp * 0.4) {
      this.triggerPhase2(player);
      return;
    }

    if (!player || player.isDead) {
      this.setVelocity(0, 0);
      return;
    }

    // Face player
    this.setFlipX(player.x > this.x);

    if (this.state === 'HOVER') {
      this.hoverTime += 0.05;
      const targetY = this.hoverBaseY + Math.sin(this.hoverTime) * 22;
      const dy = targetY - this.y;
      this.setVelocityY(dy * 4);

      // Smooth horizontal drift toward player vantage
      const desiredX = player.x + (player.x < this.x ? 130 : -130);
      const dx = desiredX - this.x;
      this.setVelocityX(Phaser.Math.Clamp(dx * 1.5, -60, 60));

      if (this.scene.time.now > this.nextActionTime) {
        const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
        if (Math.random() < 0.55 || dist > 260) {
          this.startFireballBarrage(player);
        } else {
          this.startSwoopDive(player);
        }
      }
    } else if (this.state === 'RETREAT') {
      const dy = this.hoverBaseY - this.y;
      this.setVelocityY(dy * 3);
      if (Math.abs(dy) < 10) {
        this.state = 'HOVER';
        this.play('demon_flying_anim', true);
        this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 700 : 1200);
      }
    }
  }

  startFireballBarrage(player) {
    this.state = 'CAST';
    this.setVelocity(0, 0);
    this.play('demon_attack_anim', true);
    sound.playEnemyAttack();

    const count = this.isPhase2 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      this.scene.time.delayedCall(250 + i * 280, () => {
        if (this.state === 'DEAD' || !this.scene) return;
        this.launchFireball(player);
      });
    }

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state === 'DEAD') return;
      this.state = 'HOVER';
      this.play('demon_flying_anim', true);
      this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 1000 : 1800);
    });
  }

  launchFireball(player) {
    if (!this.scene || !player) return;
    const fireball = this.scene.physics.add.sprite(this.x + (this.flipX ? 24 : -24), this.y + 8, 'demon_projectile');
    fireball.setScale(1.2);
    fireball.body.setSize(18, 18);
    fireball.body.setAllowGravity(false);
    fireball.setDepth(30);

    const angle = Phaser.Math.Angle.Between(fireball.x, fireball.y, player.x, player.y);
    fireball.setRotation(angle);

    const speed = this.isPhase2 ? 220 : 170;
    this.scene.physics.velocityFromRotation(angle, speed, fireball.body.velocity);

    // Fire trail particles
    const trailTimer = this.scene.time.addEvent({
      delay: 70,
      repeat: 30,
      callback: () => {
        if (!fireball.active || !this.scene) return;
        const ember = this.scene.add.circle(fireball.x, fireball.y, Phaser.Math.Between(2, 4), 0xff6600, 0.8);
        this.scene.tweens.add({
          targets: ember,
          alpha: 0,
          scale: 0.3,
          duration: 300,
          onComplete: () => ember.destroy()
        });
      }
    });

    // Player collision
    const collider = this.scene.physics.add.overlap(this.scene.player, fireball, () => {
      if (this.scene.player && !this.scene.player.isDead) {
        const kDir = fireball.x < this.scene.player.x ? 1 : -1;
        this.scene.player.takeDamage(18, kDir);
        trailTimer.destroy();
        fireball.destroy();
        collider.destroy();
      }
    });

    // Despawn after 3.5 seconds
    this.scene.time.delayedCall(3500, () => {
      if (fireball.active) {
        trailTimer.destroy();
        fireball.destroy();
        if (collider.active) collider.destroy();
      }
    });
  }

  startSwoopDive(player) {
    this.state = 'DIVE';
    this.play('demon_attack_anim', true);
    sound.playEnemyAttack();

    const targetX = player.x;
    const targetY = player.y;
    const diveAngle = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);

    const diveSpeed = this.isPhase2 ? 280 : 220;
    this.scene.physics.velocityFromRotation(diveAngle, diveSpeed, this.body.velocity);

    // Active claw swipe damage check
    const diveTimer = this.scene.time.addEvent({
      delay: 50,
      repeat: 12,
      callback: () => {
        if (this.state !== 'DIVE' || !this.scene) return;
        const p = this.scene.player;
        if (p && !p.isDead) {
          const dist = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
          if (dist < 50) {
            const kDir = this.x < p.x ? 1 : -1;
            p.takeDamage(GAME_CONFIG.MOBS.BOSS_DEMON.DAMAGE, kDir);
            this.scene.cameras.main.shake(120, 0.015);
          }
        }
      }
    });

    // Swoop back up
    this.scene.time.delayedCall(650, () => {
      diveTimer.destroy();
      if (this.state === 'DEAD') return;
      this.state = 'RETREAT';
      this.play('demon_flying_anim', true);
      this.setVelocityX(this.flipX ? -80 : 80);
    });
  }

  triggerPhase2(player) {
    this.isPhase2 = true;
    this.setTint(0xff5533);
    sound.playHit();
    this.scene.cameras.main.shake(300, 0.025);
    this.scene.showFloatingText(this.x, this.y - 45, 'IGNIS: MOLTEN FURY!', '#ff3300');

    // Lava eruption geyser visual
    for (let i = 0; i < 14; i++) {
      const ember = this.scene.add.rectangle(this.x, this.y + 20, 5, 5, 0xffaa00);
      this.scene.physics.add.existing(ember);
      ember.body.setVelocity(Phaser.Math.Between(-160, 160), Phaser.Math.Between(-300, -100));
      ember.body.setGravityY(400);
      this.scene.tweens.add({
        targets: ember,
        alpha: 0,
        delay: 500,
        duration: 400,
        onComplete: () => ember.destroy()
      });
    }
  }

  takeDamage(amount, fromX = null, isBackstab = false, isCounter = false) {
    if (this.state === 'DEAD') return;

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
    } else {
      this.play('demon_hit_anim', true);
      this.scene.time.delayedCall(300, () => {
        if (this.state !== 'DEAD') {
          this.play('demon_flying_anim', true);
        }
      });
    }
  }

  die() {
    this.state = 'DEAD';
    this.setVelocity(0, 60);
    this.body.setEnable(false);

    if (this.healthBar) {
      this.healthBar.defeat();
    }

    if (this.overheadBar) {
      this.overheadBar.destroy();
      this.overheadBar = null;
    }

    sound.playEnemyDeath();
    this.play('demon_dead_anim', true);
    this.scene.cameras.main.shake(700, 0.025);

    storage.addMaterials({ amber: 20, iron: 12, bark: 14 });
    storage.addScore(GAME_CONFIG.MOBS.BOSS_DEMON.PTS);
    if (typeof this.scene.updateHudMaterials === 'function') {
      this.scene.updateHudMaterials();
    }
    this.scene.showFloatingText(this.x, this.y - 40, '+20 AMBER', '#ffcc00');

    // Unlock Chapter Obelisk & Arena Gate
    if (this.scene.obelisk) {
      this.scene.obelisk.unlock();
    }
    if (typeof this.scene.openArenaGate === 'function') {
      this.scene.openArenaGate();
    }

    // Molten burst
    for (let i = 0; i < 20; i++) {
      const flame = this.scene.add.circle(this.x, this.y, Phaser.Math.Between(4, 9), 0xff3300, 0.9);
      this.scene.physics.add.existing(flame);
      flame.body.setVelocity(Phaser.Math.Between(-180, 180), Phaser.Math.Between(-240, 80));
      flame.body.setGravityY(250);
      this.scene.tweens.add({
        targets: flame,
        alpha: 0,
        scale: 0.2,
        duration: 800,
        onComplete: () => flame.destroy()
      });
    }

    this.scene.time.delayedCall(1600, () => {
      if (this.scene && typeof this.scene.onBossDefeated === 'function') {
        this.scene.onBossDefeated(this);
      }
    });
  }
}

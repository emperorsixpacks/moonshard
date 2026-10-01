import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class BossNightBorne extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, healthBar = null) {
    super(scene, x, y, 'nightborne_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.healthBar = healthBar;
    this.overheadBar = new EnemyHealthBar(scene, this, 48, 5, 20);
    this.mobType = 'boss_nightborne';
    this.bossName = GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.NAME;

    // Sprite is 80x80; visual body is rows 20-64 (height 44) and cols 23-57 (width 34).
    // Bottom of feet is at row 64. With offset Y = 20 and height = 44 (20 + 44 = 64),
    // the physics body bottom aligns exactly with the visual soles of his boots.
    this.setScale(1.35);
    this.body.setSize(34, 44);
    this.body.setOffset(23, 20);
    this.body.setAllowGravity(true);
    this.setCollideWorldBounds(true);
    this.setDepth(25);

    this.hp = GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.HP;
    this.isPhase2 = false;

    this.state = 'IDLE'; // IDLE, RUN, ATTACK, WARP, VOLLEY, SINGULARITY, DEAD
    this.nextActionTime = scene.time.now + 1200;
    this.runSpeed = GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.RUN_SPEED;
    this.recentHits = [];

    // Arena horizontal bounds
    this.arenaMinX = 2120;
    this.arenaMaxX = 2550;
    this.groundY = 348; // Standing center Y when feet rest at ground line Y = 380

    this.play('nightborne_idle_anim');

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

    // Keep within arena bounds
    if (this.x < this.arenaMinX) {
      this.x = this.arenaMinX;
      if (this.body.velocity.x < 0) this.setVelocityX(0);
    } else if (this.x > this.arenaMaxX) {
      this.x = this.arenaMaxX;
      if (this.body.velocity.x > 0) this.setVelocityX(0);
    }

    // Phase 2 check (< 50% HP)
    if (!this.isPhase2 && this.hp <= this.maxHp * 0.5) {
      this.triggerPhase2(player);
      return;
    }

    // Busy states
    if (this.state === 'WARP' || this.state === 'SINGULARITY' || this.state === 'ATTACK' || this.state === 'VOLLEY') {
      return;
    }

    if (!player || player.isDead) {
      this.setVelocityX(0);
      return;
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    // AI decision making
    if (this.scene.time.now > this.nextActionTime) {
      if (dist < 90) {
        // Melee range: Cleave attack
        this.startVoidCleave(player);
      } else if (dist > 220) {
        // Long range: 60% chance to warp strike, 40% chance for ranged void volley
        if (Math.random() < 0.6) {
          this.startWarpSlash(player);
        } else {
          this.startVoidVolley(player);
        }
      } else if (dist >= 90 && dist <= 220) {
        // Mid range: 40% volley, 30% warp, 30% sprint in
        const roll = Math.random();
        if (roll < 0.4) {
          this.startVoidVolley(player);
        } else if (roll < 0.7) {
          this.startWarpSlash(player);
        } else {
          this.state = 'RUN';
          const speed = this.isPhase2 ? this.runSpeed * 1.35 : this.runSpeed;
          this.setVelocityX(dir * speed);
          this.play('nightborne_run_anim', true);
          this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 800 : 1200);
        }
      }
    } else if (this.state === 'RUN') {
      const speed = this.isPhase2 ? this.runSpeed * 1.35 : this.runSpeed;
      this.setVelocityX(dir * speed);
      if (dist < 85) {
        this.startVoidCleave(player);
      }
    }
  }

  startVoidCleave(player) {
    this.state = 'ATTACK';
    this.setVelocityX(0);
    this.play('nightborne_attack_anim', true);
    sound.playEnemyAttack();

    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    // Telegraph alert
    this.scene.showFloatingText(this.x, this.y - 42, 'VOID CLEAVE!', '#dd66ff');

    // Blade charge sparks during windup
    for (let i = 0; i < 6; i++) {
      const sp = this.scene.add.circle(this.x + dir * 18, this.y - 4, Phaser.Math.Between(2, 5), 0xdd77ff, 0.9);
      this.scene.tweens.add({
        targets: sp,
        x: sp.x + Phaser.Math.Between(-15, 15),
        y: sp.y + Phaser.Math.Between(-15, 15),
        alpha: 0,
        duration: 350,
        onComplete: () => sp.destroy()
      });
    }

    // Step forward aggressively into the slash to prevent whiffing
    this.scene.time.delayedCall(200, () => {
      if (this.state !== 'ATTACK' || !this.scene) return;
      this.setVelocityX(dir * (this.isPhase2 ? 140 : 100));
    });

    // Impact timing (frame 9 - slash arc and shockwave release)
    this.scene.time.delayedCall(450, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      this.setVelocityX(0);

      const p = this.scene.player;
      if (p && !p.isDead) {
        const pDist = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
        const facing = (this.flipX && p.x < this.x) || (!this.flipX && p.x > this.x);
        if (pDist < 100 && facing) {
          const kDir = this.x < p.x ? 1 : -1;
          p.takeDamage(GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.DAMAGE, kDir);
          this.scene.cameras.main.shake(180, 0.022);
          sound.playSlash(3);
        }
      }

      // Visual slashing energy arc
      this.drawSlashArc(dir);

      // Launch vibrant glowing crescent void wave along the ground
      this.fireCrescentWave(dir);
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state === 'DEAD') return;
      this.state = 'IDLE';
      this.play('nightborne_idle_anim', true);
      this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 450 : 800);
    });
  }

  drawSlashArc(dir) {
    if (!this.scene) return;
    const arcX = this.x + dir * 28;
    const arcY = this.y - 2;

    const arc = this.scene.add.graphics();
    arc.setDepth(28);
    arc.lineStyle(4, 0xee88ff, 1);
    arc.beginPath();
    const startAngle = dir > 0 ? -Math.PI / 3 : Math.PI - Math.PI / 3;
    const endAngle = dir > 0 ? Math.PI / 3 : Math.PI + Math.PI / 3;
    arc.arc(arcX, arcY, 32, startAngle, endAngle, false);
    arc.strokePath();

    this.scene.tweens.add({
      targets: arc,
      alpha: 0,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 220,
      onComplete: () => arc.destroy()
    });
  }

  fireCrescentWave(dir) {
    if (!this.scene) return;
    const spawnX = this.x + dir * 30;
    const spawnY = this.groundY + 18; // Close to ground surface

    // High-visibility multi-layered glowing crescent projectile container
    const wave = this.scene.add.container(spawnX, spawnY);
    this.scene.physics.add.existing(wave);
    wave.body.setSize(24, 38);
    wave.body.setOffset(-12, -19);
    wave.body.setAllowGravity(false);
    wave.setDepth(28);

    // Outer aura
    const outerAura = this.scene.add.ellipse(0, 0, 24, 42, 0x7700cc, 0.65);
    // Inner vibrant crescent
    const innerWave = this.scene.add.ellipse(0, 0, 16, 36, 0xee88ff, 0.95);
    // Bright core
    const core = this.scene.add.ellipse(dir * 2, 0, 8, 26, 0xffffff, 1.0);

    wave.add([outerAura, innerWave, core]);

    const speed = (this.isPhase2 ? 280 : 220) * dir;
    wave.body.setVelocityX(speed);

    // Trail particles
    const trailTimer = this.scene.time.addEvent({
      delay: 55,
      repeat: 25,
      callback: () => {
        if (!wave.active || !this.scene) return;
        const ember = this.scene.add.circle(wave.x, wave.y + Phaser.Math.Between(-10, 10), Phaser.Math.Between(2, 5), 0xdd77ff, 0.8);
        this.scene.tweens.add({
          targets: ember,
          alpha: 0,
          scale: 0.2,
          duration: 280,
          onComplete: () => ember.destroy()
        });
      }
    });

    const waveHit = this.scene.physics.add.overlap(this.scene.player, wave, () => {
      if (this.scene.player && !this.scene.player.isDead) {
        const kDir = wave.x < this.scene.player.x ? 1 : -1;
        this.scene.player.takeDamage(22, kDir);
        this.scene.cameras.main.shake(120, 0.015);
        sound.playHit();
        trailTimer.destroy();
        waveHit.destroy();
        wave.destroy();
      }
    });

    this.scene.time.delayedCall(1700, () => {
      if (wave.active) {
        trailTimer.destroy();
        waveHit.destroy();
        wave.destroy();
      }
    });
  }

  startWarpSlash(player) {
    this.state = 'WARP';
    this.setVelocity(0, 0);

    // Telegraph alert
    this.scene.showFloatingText(this.x, this.y - 42, 'SHADOW WARP!', '#aa44ff');

    // Departure vortex
    for (let i = 0; i < 12; i++) {
      const p = this.scene.add.circle(this.x, this.y, Phaser.Math.Between(3, 6), 0xaa44ff, 0.9);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Phaser.Math.Between(-35, 35),
        y: p.y + Phaser.Math.Between(-35, 35),
        alpha: 0,
        duration: 320,
        onComplete: () => p.destroy()
      });
    }

    sound.playHit();
    this.setVisible(false);

    // Calculate landing behind player, clamped firmly to solid arena floor
    const behindX = player.x + (player.flipX ? 75 : -75);
    const targetX = Phaser.Math.Clamp(behindX, this.arenaMinX + 20, this.arenaMaxX - 20);

    // Warning marker on the floor where Umbra is about to strike!
    const groundMarker = this.scene.add.rectangle(targetX, 376, 44, 6, 0xdd55ff, 0.85);
    groundMarker.setDepth(20);
    this.scene.tweens.add({
      targets: groundMarker,
      alpha: { from: 0.3, to: 1 },
      scaleX: 1.25,
      yoyo: true,
      duration: 160,
      repeat: 1,
      onComplete: () => groundMarker.destroy()
    });

    // Materialize behind player after 340ms
    this.scene.time.delayedCall(340, () => {
      if (this.state === 'DEAD' || !this.scene || !player) return;

      // Always firmly grounded on arena floor
      this.setPosition(targetX, this.groundY);
      this.setVelocity(0, 0);
      this.setVisible(true);
      this.setFlipX(player.x < this.x);

      // Explosive arrival burst
      for (let i = 0; i < 16; i++) {
        const p = this.scene.add.circle(this.x, this.y, Phaser.Math.Between(3, 6), 0xff88ff, 0.95);
        this.scene.tweens.add({
          targets: p,
          x: p.x + Phaser.Math.Between(-40, 40),
          y: p.y + Phaser.Math.Between(-40, 40),
          scale: 0.2,
          alpha: 0,
          duration: 320,
          onComplete: () => p.destroy()
        });
      }

      sound.playSlash(2);
      this.scene.cameras.main.shake(120, 0.015);

      // Immediately chain into a deadly cleave
      this.startVoidCleave(player);
    });
  }

  startVoidVolley(player) {
    this.state = 'VOLLEY';
    this.setVelocity(0, 0);
    this.play('nightborne_attack_anim', true);
    sound.playEnemyAttack();

    const dir = player.x < this.x ? -1 : 1;
    this.setFlipX(dir < 0);

    this.scene.showFloatingText(this.x, this.y - 42, 'VOID VOLLEY!', '#9955ff');

    // Fire 3 dark astral spears in sequence
    const darts = [
      { delay: 260, spread: -0.15 },
      { delay: 460, spread: 0 },
      { delay: 660, spread: 0.15 }
    ];

    darts.forEach(d => {
      this.scene.time.delayedCall(d.delay, () => {
        if (this.state === 'DEAD' || !this.scene || !this.scene.player) return;
        this.launchVoidDart(this.scene.player, d.spread);
      });
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state === 'DEAD') return;
      this.state = 'IDLE';
      this.play('nightborne_idle_anim', true);
      this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 550 : 1000);
    });
  }

  launchVoidDart(player, spreadAngle = 0) {
    if (!this.scene || !player) return;
    const spawnX = this.x + (this.flipX ? -20 : 20);
    const spawnY = this.y - 12;

    const dart = this.scene.add.container(spawnX, spawnY);
    this.scene.physics.add.existing(dart);
    dart.body.setSize(18, 12);
    dart.body.setOffset(-9, -6);
    dart.body.setAllowGravity(false);
    dart.setDepth(28);

    const outer = this.scene.add.rectangle(0, 0, 18, 8, 0x7700cc, 0.9);
    const inner = this.scene.add.rectangle(0, 0, 12, 4, 0xffaaff, 1);
    dart.add([outer, inner]);

    const baseAngle = Phaser.Math.Angle.Between(spawnX, spawnY, player.x, player.y);
    const finalAngle = baseAngle + spreadAngle;
    dart.setRotation(finalAngle);

    const speed = this.isPhase2 ? 290 : 240;
    this.scene.physics.velocityFromRotation(finalAngle, speed, dart.body.velocity);

    sound.playSlash(1);

    // Trail
    const trailTimer = this.scene.time.addEvent({
      delay: 50,
      repeat: 20,
      callback: () => {
        if (!dart.active || !this.scene) return;
        const t = this.scene.add.circle(dart.x, dart.y, 2.5, 0xcc66ff, 0.8);
        this.scene.tweens.add({
          targets: t,
          alpha: 0,
          scale: 0.2,
          duration: 250,
          onComplete: () => t.destroy()
        });
      }
    });

    const collider = this.scene.physics.add.overlap(this.scene.player, dart, () => {
      if (this.scene.player && !this.scene.player.isDead) {
        const kDir = dart.x < this.scene.player.x ? 1 : -1;
        this.scene.player.takeDamage(16, kDir);
        this.scene.cameras.main.shake(100, 0.012);
        trailTimer.destroy();
        collider.destroy();
        dart.destroy();
      }
    });

    this.scene.time.delayedCall(2200, () => {
      if (dart.active) {
        trailTimer.destroy();
        collider.destroy();
        dart.destroy();
      }
    });
  }

  triggerPhase2(player) {
    this.isPhase2 = true;
    this.state = 'SINGULARITY';
    this.setVelocity(0, 0);
    this.setTint(0xdd88ff);

    sound.playHit();
    this.scene.cameras.main.shake(500, 0.035);
    this.scene.cameras.main.flash(350, 180, 50, 240);
    this.scene.showFloatingText(this.x, this.y - 50, 'UMBRA: ECLIPSE ASCENSION!', '#ee44ff');

    // Central pulsing Singularity Core
    const orbX = (this.arenaMinX + this.arenaMaxX) / 2;
    const orbY = 300;
    const orb = this.scene.add.circle(orbX, orbY, 20, 0x0a0014, 0.95);
    orb.setStrokeStyle(3, 0xee55ff);
    orb.setDepth(30);

    // Gravitational pull pulse event
    const pullTimer = this.scene.time.addEvent({
      delay: 50,
      repeat: 30,
      callback: () => {
        if (!orb.active || !this.scene) return;
        const p = this.scene.player;
        if (p && !p.isDead) {
          const dx = orb.x - p.x;
          if (Math.abs(dx) < 220) {
            p.x += Math.sign(dx) * 1.5;
          }
        }
        // Swirling void particle into orb
        const spark = this.scene.add.circle(
          orb.x + Phaser.Math.Between(-70, 70),
          orb.y + Phaser.Math.Between(-70, 70),
          Phaser.Math.Between(2, 4),
          0xcc66ff,
          0.8
        );
        this.scene.tweens.add({
          targets: spark,
          x: orb.x,
          y: orb.y,
          alpha: 0,
          duration: 350,
          onComplete: () => spark.destroy()
        });
      }
    });

    this.scene.tweens.add({
      targets: orb,
      scaleX: 2.2,
      scaleY: 2.2,
      duration: 1400,
      yoyo: true,
      onComplete: () => {
        pullTimer.destroy();
        orb.destroy();
        if (this.state === 'DEAD') return;
        this.state = 'IDLE';
        this.play('nightborne_idle_anim', true);
        this.nextActionTime = this.scene.time.now + 300;
      }
    });
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

    // Poise system: track consecutive hits in short window
    const now = this.scene.time.now;
    this.recentHits.push(now);
    this.recentHits = this.recentHits.filter(t => now - t < 1200);

    // Evasive Shadow Counter if cornered/combo-locked
    if (this.recentHits.length >= 3 && this.state !== 'WARP' && this.state !== 'DEAD') {
      this.recentHits = [];
      this.scene.showFloatingText(this.x, this.y - 45, 'SHADOW COUNTER!', '#ffff44');
      if (this.scene.player) {
        this.startWarpSlash(this.scene.player);
        return;
      }
    }

    if (this.hp <= 0) {
      this.die();
    } else {
      // Flash damage tint
      this.setTint(0xff77ff);
      this.scene.time.delayedCall(120, () => {
        if (this.active) {
          if (this.isPhase2) this.setTint(0xdd88ff);
          else this.clearTint();
        }
      });

      // Only interrupt with hit animation if currently in IDLE or RUN (preserve active attacks)
      if (this.state === 'IDLE' || this.state === 'RUN') {
        this.play('nightborne_hit_anim', true);
        this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (this.state !== 'DEAD' && this.state !== 'WARP' && this.state !== 'ATTACK') {
            this.state = 'IDLE';
            this.play('nightborne_idle_anim', true);
          }
        });
      }
    }
  }

  die() {
    this.state = 'DEAD';
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
    this.play('nightborne_dead_anim', true);
    this.scene.cameras.main.shake(800, 0.035);

    storage.addMaterials({ amber: 30, iron: 15, bark: 20 });
    storage.addScore(GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.PTS);
    if (typeof this.scene.updateHudMaterials === 'function') {
      this.scene.updateHudMaterials();
    }
    this.scene.showFloatingText(this.x, this.y - 45, '+30 AMBER', '#ffcc00');

    // Unlock Chapter Obelisk & Arena Gate
    if (this.scene.obelisk) {
      this.scene.obelisk.unlock();
    }
    if (typeof this.scene.openArenaGate === 'function') {
      this.scene.openArenaGate();
    }

    // Cosmic void burst particles
    for (let i = 0; i < 30; i++) {
      const star = this.scene.add.circle(this.x, this.y, Phaser.Math.Between(3, 8), 0xaa55ff, 0.9);
      this.scene.physics.add.existing(star);
      star.body.setVelocity(Phaser.Math.Between(-220, 220), Phaser.Math.Between(-260, 60));
      star.body.setGravityY(150);
      this.scene.tweens.add({
        targets: star,
        alpha: 0,
        scale: 0.1,
        duration: 1200,
        onComplete: () => star.destroy()
      });
    }

    // Allow full 23-frame cosmic supernova animation to play out
    this.scene.time.delayedCall(2400, () => {
      if (this.scene && typeof this.scene.onBossDefeated === 'function') {
        this.scene.onBossDefeated(this);
      }
    });
  }

  destroy(fromScene) {
    if (this.overheadBar) {
      this.overheadBar.destroy();
      this.overheadBar = null;
    }
    super.destroy(fromScene);
  }
}

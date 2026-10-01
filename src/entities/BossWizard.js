import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class BossWizard extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, healthBar = null) {
    super(scene, x, y, 'wizard_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.healthBar = healthBar;
    this.overheadBar = new EnemyHealthBar(scene, this, 42, 5, 10);
    this.mobType = 'boss_wizard';
    this.bossName = GAME_CONFIG.MOBS.BOSS_WIZARD.NAME;

    this.setScale(1.15);
    this.body.setSize(30, 52);
    this.body.setOffset(60, 48);
    this.body.setAllowGravity(true);
    this.setDepth(25);

    this.hp = GAME_CONFIG.MOBS.BOSS_WIZARD.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOSS_WIZARD.HP;
    this.isPhase2 = false;

    // Available teleport warp positions in Chapter 2 Arena
    this.warpPositions = [
      { x: 2180, y: 240 },
      { x: 2360, y: 180 },
      { x: 2460, y: 350 },
      { x: 2260, y: 350 },
      { x: 2500, y: 240 }
    ];

    this.state = 'IDLE'; // IDLE, CASTING, METEOR_STORM, TELEPORTING, DEAD
    this.nextActionTime = scene.time.now + 1200;
    this.teleportCooldown = scene.time.now + 3000;
    this.hitCountSinceTeleport = 0;

    this.play('wizard_idle_anim');

    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }
  }

  update(player) {
    if (this.overheadBar) this.overheadBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD' || this.state === 'TELEPORTING') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocity(0, 0);
      return;
    }

    // Phase 2 transition check (< 35% HP)
    if (!this.isPhase2 && this.hp <= this.maxHp * 0.35) {
      this.triggerPhase2(player);
      return;
    }

    // Always face player
    if (player) {
      this.setFlipX(player.x < this.x);
    }

    if (this.state === 'IDLE' && this.scene.time.now > this.nextActionTime) {
      if (player && !player.isDead) {
        if (this.isPhase2 && Math.random() < 0.4) {
          this.startMeteorStorm(player);
        } else {
          this.startArcaneOrbCast(player);
        }
      }
    }
  }

  startArcaneOrbCast(player) {
    this.state = 'CASTING';
    this.nextActionTime = this.scene.time.now + (this.isPhase2 ? 2600 : 3500);
    this.play('wizard_attack_anim', true);

    // Cast 3 arcane orbs in succession
    this.scene.time.delayedCall(400, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      this.fireArcaneOrb(player, -0.2);
    });

    this.scene.time.delayedCall(650, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      this.fireArcaneOrb(player, 0);
    });

    this.scene.time.delayedCall(900, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      this.fireArcaneOrb(player, 0.2);
    });

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.state !== 'DEAD') {
        this.state = 'IDLE';
        this.play('wizard_idle_anim', true);
      }
    });
  }

  fireArcaneOrb(player, spreadAngle = 0) {
    sound.playSlash(2);
    const angle = Phaser.Math.Angle.Between(this.x, this.y - 10, player.x, player.y) + spreadAngle;
    const speed = 145;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    if (typeof this.scene.spawnProjectile === 'function') {
      this.scene.spawnProjectile('arcane_orb', this.x, this.y - 12, vx, vy, true); // true = deflectable!
    }
  }

  startMeteorStorm(player) {
    this.state = 'METEOR_STORM';
    this.nextActionTime = this.scene.time.now + 5000;
    this.play('wizard_attack_anim', true);
    sound.playObelisk();
    this.scene.cameras.main.shake(300, 0.015);

    // Incantation text
    const chant = this.scene.add.text(this.x, this.y - 45, 'CORRUPTED RAIN!!', {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#c066ff',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: chant,
      y: this.y - 70,
      alpha: 0,
      duration: 1200,
      onComplete: () => chant.destroy()
    });

    // Drop 4 meteors across arena
    for (let i = 0; i < 4; i++) {
      this.scene.time.delayedCall(400 + i * 350, () => {
        if (this.state === 'DEAD' || !this.scene) return;
        const targetX = Phaser.Math.Between(2140, 2560);

        // Danger telegraph marker on ground
        const marker = this.scene.add.rectangle(targetX, 375, 40, 4, 0xff0044, 0.6);
        this.scene.tweens.add({
          targets: marker,
          alpha: { from: 0.2, to: 0.9 },
          yoyo: true,
          duration: 200,
          repeat: 2,
          onComplete: () => {
            marker.destroy();
            // Drop meteor from sky
            if (typeof this.scene.spawnProjectile === 'function') {
              this.scene.spawnProjectile('arcane_meteor', targetX, 40, 0, 240);
            }
          }
        });
      });
    }

    this.scene.time.delayedCall(2200, () => {
      if (this.state !== 'DEAD') {
        this.state = 'IDLE';
        this.play('wizard_idle_anim', true);
        this.teleportAway();
      }
    });
  }

  triggerPhase2(player) {
    this.isPhase2 = true;
    sound.playVictory();
    this.scene.cameras.main.flash(400, 180, 50, 240);
    this.scene.cameras.main.shake(400, 0.02);

    const text = this.scene.add.text(this.x, this.y - 40, 'MALAKOR UNLEASHES ARCANE SURGE!', {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#c066ff',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: text,
      y: this.y - 65,
      alpha: 0,
      duration: 1200,
      onComplete: () => text.destroy()
    });

    this.teleportAway();
  }

  teleportAway() {
    if (this.state === 'DEAD' || this.state === 'TELEPORTING') return;

    this.state = 'TELEPORTING';
    sound.playSlash(1);
    this.hitCountSinceTeleport = 0;

    // Arcane puff on origin
    this.createTeleportPuff(this.x, this.y);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 250,
      onComplete: () => {
        if (this.state === 'DEAD' || !this.scene) return;

        // Choose new vantage point distant from current pos
        const candidates = this.warpPositions.filter(p => Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) > 100);
        const pick = Phaser.Utils.Array.GetRandom(candidates.length > 0 ? candidates : this.warpPositions);

        this.x = pick.x;
        this.y = pick.y;
        this.setVelocity(0, 0);

        this.createTeleportPuff(this.x, this.y);

        this.scene.tweens.add({
          targets: this,
          alpha: 1,
          duration: 250,
          onComplete: () => {
            if (this.state !== 'DEAD') {
              this.state = 'IDLE';
              this.play('wizard_idle_anim', true);
            }
          }
        });
      }
    });
  }

  createTeleportPuff(x, y) {
    for (let i = 0; i < 8; i++) {
      const p = this.scene.add.circle(x, y - 20, Phaser.Math.Between(3, 6), 0x9933ff, 0.8);
      this.scene.physics.add.existing(p);
      p.body.setVelocity(Phaser.Math.Between(-90, 90), Phaser.Math.Between(-90, 90));
      this.scene.tweens.add({
        targets: p,
        alpha: 0,
        scale: 0.2,
        duration: 350,
        onComplete: () => p.destroy()
      });
    }
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD' || this.state === 'TELEPORTING') return false;

    let finalDmg = amount;
    if (isUpwardSlash) {
      finalDmg = Math.round(amount * 1.5);
    }

    this.hp -= finalDmg;
    sound.playHit();
    this.hitCountSinceTeleport++;

    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }

    // Damage popup via JuiceEffects
    if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 28, finalDmg, 'crit', `UP-SLASH -${finalDmg}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 28, finalDmg, 'normal');
      juice.hitStopHeavy(this.scene);
    }

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.BOSS_WIZARD.PTS };
    } else {
      this.play('wizard_hit_anim', true);
      this.setTint(0xcc66ff);
      this.scene.time.delayedCall(120, () => this.clearTint());

      // Auto-teleport away if attacked multiple times in melee
      if (this.hitCountSinceTeleport >= 2) {
        this.teleportAway();
      }
      return { killed: false, pts: 0 };
    }
  }

  die() {
    this.state = 'DEAD';
    if (this.overheadBar) {
      this.overheadBar.setVisible(false);
    }
    this.body.setEnable(false);
    this.setVelocity(0, 0);
    sound.playEnemyDeath();
    this.play('wizard_dead_anim', true);

    if (this.healthBar) {
      this.healthBar.defeat();
    }

    this.scene.cameras.main.shake(700, 0.025);

    // Drop Archmage bounty
    storage.addMaterials({ amber: 12, iron: 8, bark: 10 });
    if (typeof this.scene.updateHudMaterials === 'function') {
      this.scene.updateHudMaterials();
    }

    // Unlock Chapter 2 Obelisk & Arena Gate
    if (this.scene.obelisk) {
      this.scene.obelisk.unlock();
    }
    if (typeof this.scene.openArenaGate === 'function') {
      this.scene.openArenaGate();
    }

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 20,
      duration: 1200,
      delay: 500,
      onComplete: () => this.destroy()
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

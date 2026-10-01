import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class BossGorgok extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, healthBar = null) {
    super(scene, x, y, 'chieftain_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.healthBar = healthBar;
    this.overheadBar = new EnemyHealthBar(scene, this, 48, 5, 12);
    this.mobType = 'boss_gorgok';
    this.bossName = GAME_CONFIG.MOBS.BOSS_GORGOK.NAME;

    // Scale up to colossus size (1.8x)
    this.setScale(1.8);
    this.body.setSize(38, 24);
    this.body.setOffset(5, 8);
    this.setDepth(25);

    this.hp = GAME_CONFIG.MOBS.BOSS_GORGOK.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOSS_GORGOK.HP;
    this.isEnraged = false;
    this.summonedMinions = false;

    this.state = 'PATROL'; // PATROL, ALERT, CHARGE, STUNNED, STOMP, DEAD
    this.patrolDir = -1;
    this.setFlipX(false); // Anokolisa boar faces left when flipX=false

    this.actionCooldown = scene.time.now + 1500;
    this.stunnedUntil = 0;

    this.play('chieftain_walk_anim');

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

    const hitWall = this.body.blocked.left || this.body.blocked.right;

    // Phase 2 Enrage check
    if (!this.isEnraged && this.hp <= this.maxHp * 0.5) {
      this.triggerEnrage(player);
      return;
    }

    if (this.state === 'STUNNED') {
      this.setVelocityX(0);
      if (this.scene.time.now > this.stunnedUntil) {
        this.state = 'PATROL';
        this.actionCooldown = this.scene.time.now + 1000;
        this.play(this.isEnraged ? 'chieftain_run_anim' : 'chieftain_walk_anim', true);
      }
      return;
    }

    if (this.state === 'ALERT') {
      this.setVelocityX(0);
      if (this.scene.time.now > this.alertTimer) {
        this.startCharge(player);
      }
      return;
    }

    if (this.state === 'STOMP') {
      this.setVelocityX(0);
      return;
    }

    if (this.state === 'CHARGE') {
      const chargeSpeed = this.isEnraged ? (GAME_CONFIG.MOBS.BOSS_GORGOK.CHARGE_SPEED * 1.25) : GAME_CONFIG.MOBS.BOSS_GORGOK.CHARGE_SPEED;
      this.setVelocityX(this.chargeDir * chargeSpeed);
      this.setFlipX(this.chargeDir > 0);

      // Arena wall impact or cliff edge -> Wall crash stun!
      if (hitWall || this.isLedgeAhead(this.chargeDir)) {
        this.state = 'STUNNED';
        this.stunnedUntil = this.scene.time.now + (this.isEnraged ? 800 : 1300);
        this.setVelocityX(0);
        this.play('chieftain_idle_anim', true);
        sound.playHit();
        this.scene.cameras.main.shake(140, 0.016);

        // Falling rocks visual cue
        this.triggerCrashParticles();
      }
      return;
    }

    // Default: PATROL with ledge check
    if (hitWall || this.isLedgeAhead(this.patrolDir)) {
      this.patrolDir *= -1;
    }

    const walkSpeed = this.isEnraged ? (GAME_CONFIG.MOBS.BOSS_GORGOK.WALK_SPEED * 1.3) : GAME_CONFIG.MOBS.BOSS_GORGOK.WALK_SPEED;
    this.setVelocityX(this.patrolDir * walkSpeed);
    this.setFlipX(this.patrolDir > 0);

    // AI decision when cooldown ready
    if (player && !player.isDead && this.scene.time.now > this.actionCooldown) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      const dy = Math.abs(this.y - player.y);

      if (dist < 260 && dy < 60) {
        // Enraged bosses alternate between Ground Stomp shockwaves and Horn Charge
        if (this.isEnraged && Math.random() < 0.4) {
          this.triggerEarthStomp(player);
        } else {
          this.triggerAlert(player);
        }
      }
    }
  }

  isLedgeAhead(dir) {
    if (!this.body.blocked.down || !this.scene.platforms) return false;
    const lookX = this.x + (dir * (this.body.width / 2 + 12));
    const footY = this.body.bottom + 8;

    const hasGround = this.scene.platforms.getChildren().some(plat => {
      const pb = plat.body;
      if (!pb) return false;
      return lookX >= pb.left && lookX <= pb.right && footY >= pb.top && footY <= pb.bottom + 16;
    });

    return !hasGround;
  }

  triggerAlert(player) {
    this.state = 'ALERT';
    this.alertTimer = this.scene.time.now + (this.isEnraged ? 350 : 550);
    this.play('chieftain_idle_anim', true);
    sound.playSlash(1);

    // Enraged war cry text
    const warn = this.scene.add.text(this.x, this.y - 32, this.isEnraged ? '!! ROAAAAR !!' : '!', {
      fontFamily: 'Press Start 2P',
      fontSize: this.isEnraged ? '8px' : '10px',
      color: '#ff2222',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: warn,
      y: this.y - 48,
      alpha: 0,
      duration: 500,
      onComplete: () => warn.destroy()
    });
  }

  startCharge(player) {
    this.state = 'CHARGE';
    this.chargeDir = player.x < this.x ? -1 : 1;
    this.actionCooldown = this.scene.time.now + (this.isEnraged ? 2400 : 3600);
    this.play('chieftain_run_anim', true);
    sound.playSlash(2);
  }

  triggerEarthStomp(player) {
    this.state = 'STOMP';
    this.actionCooldown = this.scene.time.now + 4000;
    this.setVelocity(0, -120); // Mini leap
    this.play('chieftain_idle_anim', true);

    this.scene.time.delayedCall(400, () => {
      if (this.state === 'DEAD' || !this.scene) return;
      sound.playRicochet();
      this.scene.cameras.main.shake(220, 0.018);

      // Send shockwave projectiles left & right along ground
      if (typeof this.scene.spawnProjectile === 'function') {
        this.scene.spawnProjectile('shockwave', this.x - 20, this.y + 16, -160, 0);
        this.scene.spawnProjectile('shockwave', this.x + 20, this.y + 16, 160, 0);
      }

      this.state = 'PATROL';
      this.play(this.isEnraged ? 'chieftain_run_anim' : 'chieftain_walk_anim', true);
    });
  }

  triggerEnrage(player) {
    this.isEnraged = true;
    this.state = 'ALERT';
    this.alertTimer = this.scene.time.now + 1200;
    this.setVelocity(0, -160);
    this.setTint(0xff6666);

    sound.playVictory();
    this.scene.cameras.main.flash(300, 220, 30, 30);
    this.scene.cameras.main.shake(300, 0.02);

    const roarText = this.scene.add.text(this.x, this.y - 36, 'CHIEFTAIN ENRAGED!', {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#ff2222',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: roarText,
      y: this.y - 60,
      alpha: 0,
      duration: 1000,
      onComplete: () => roarText.destroy()
    });

    // Summon 2 wild boars to flank player
    if (!this.summonedMinions && typeof this.scene.spawnMob === 'function') {
      this.summonedMinions = true;
      this.scene.spawnMob('boar', this.x - 120, this.y);
      this.scene.spawnMob('boar', this.x + 120, this.y);
    }
  }

  triggerCrashParticles() {
    for (let i = 0; i < 6; i++) {
      const rock = this.scene.add.circle(this.x + (this.chargeDir * 24), this.y - 10, Phaser.Math.Between(2, 4), 0x7a6b58);
      this.scene.physics.add.existing(rock);
      rock.body.setVelocity(Phaser.Math.Between(-80, 80), Phaser.Math.Between(-140, -40));
      this.scene.tweens.add({
        targets: rock,
        alpha: 0,
        duration: 400,
        delay: 200,
        onComplete: () => rock.destroy()
      });
    }
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    // Frontal Armor check:
    // Gorgok faces left when flipX=false (back is to the right: attackFromX > this.x)
    // Gorgok faces right when flipX=true (back is to the left: attackFromX < this.x)
    const facesRight = this.flipX;
    const attackerBehind = facesRight ? (attackFromX < this.x) : (attackFromX > this.x);

    let finalDmg = amount;
    let isCrit = false;

    if (attackerBehind) {
      // Critical backstab bypasses armored plate!
      finalDmg = Math.round(amount * 2.2);
      isCrit = true;
    } else {
      // Frontal heavy armor mitigates damage
      finalDmg = Math.max(1, Math.round(amount * 0.6));
    }

    this.hp -= finalDmg;
    sound.playHit();

    if (this.healthBar) {
      this.healthBar.updateHealth(this.hp, this.maxHp);
    }

    // Damage popup via JuiceEffects
    if (isCrit) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDmg, 'crit', `BACK-SLASH -${finalDmg}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 25, finalDmg, 'normal', `GUARD -${finalDmg}`);
      juice.hitStopHeavy(this.scene);
    }

    // Knockback resistance (heavy colossus)
    const knockDir = attackFromX < this.x ? 1 : -1;
    this.setVelocityX(knockDir * 40);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.BOSS_GORGOK.PTS, isCrit };
    } else {
      this.play('chieftain_hit_anim', true);
      this.setTint(0xff3333);
      this.scene.time.delayedCall(140, () => {
        if (this.isEnraged) {
          this.setTint(0xff7777);
        } else {
          this.clearTint();
        }
      });
      return { killed: false, pts: 0, isCrit };
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
    this.play('chieftain_hit_anim');

    if (this.healthBar) {
      this.healthBar.defeat();
    }

    // Slow-mo impact & dramatic screen shake
    this.scene.cameras.main.shake(600, 0.025);

    // Drop generous boss bounty
    storage.addMaterials({ bark: 8, iron: 5, amber: 3 });
    if (typeof this.scene.updateHudMaterials === 'function') {
      this.scene.updateHudMaterials();
    }

    // Unlock Chapter Obelisk & Arena Gate
    if (this.scene.obelisk) {
      this.scene.obelisk.unlock();
    }
    if (typeof this.scene.openArenaGate === 'function') {
      this.scene.openArenaGate();
    }

    // Boss defeat death tween
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 15,
      duration: 1000,
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

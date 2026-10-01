import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class Bee extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'bee_fly');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Bee frame is 64x64. Collider:
    this.body.setSize(20, 20);
    this.body.setOffset(22, 22);
    this.body.setAllowGravity(false);
    this.setDepth(19);

    this.mobType = 'bee';
    this.hp = GAME_CONFIG.MOBS.BEE.HP;
    this.maxHp = GAME_CONFIG.MOBS.BEE.HP;
    this.state = 'HOVER'; // HOVER, SWOOP, RECOVER, DEAD
    this.baseY = y;
    this.patrolDir = -1;
    this.swoopCooldownUntil = 0;
    this.swoopTargetX = 0;
    this.swoopTargetY = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 22, 3.5, 6);
    this.play('bee_fly_anim');
  }

  update(player) {
    if (this.healthBar) this.healthBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocity(0, 0);
      return;
    }

    const isSurvival = this.scene.scene && this.scene.scene.key === 'SurvivalScene';
    const livingEnemies = isSurvival && typeof this.scene.getLivingWaveEnemies === 'function'
      ? this.scene.getLivingWaveEnemies()
      : [];
    const onlyFlyersLeft = isSurvival
      && this.scene.waveSpawnQueue?.length === 0
      && this.scene.pendingWaveSpawns?.length === 0
      && livingEnemies.length > 0
      && livingEnemies.every(e => this.scene.isFlyer ? this.scene.isFlyer(e) : e.mobType === 'bee' || e.mobType === 'flying_eye');

    if (isSurvival) {
      const cam = this.scene.cameras?.main;
      const minX = cam ? cam.worldView.x + 48 : 32;
      const maxX = cam ? cam.worldView.right - 48 : (this.scene.arenaWidth || GAME_CONFIG.WIDTH) - 32;
      if (this.x <= minX) {
        this.x = minX;
        this.patrolDir = 1;
      } else if (this.x >= maxX) {
        this.x = maxX;
        this.patrolDir = -1;
      }
    }

    if (this.state === 'HOVER') {
      // Check for swoop opportunity & player tracking
      if (player && !player.isDead) {
        const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
        const dx = player.x - this.x;
        const desiredSide = dx >= 0 ? -1 : 1;
        const desiredX = Phaser.Math.Clamp(player.x + desiredSide * 95, 48, (this.scene.arenaWidth || GAME_CONFIG.WIDTH) - 48);
        const dxToStaging = desiredX - this.x;

        // In survival, bees stage near the hero so the final flyers cannot stall a wave.
        if (isSurvival && Math.abs(dxToStaging) > 14) {
          this.patrolDir = dxToStaging > 0 ? 1 : -1;
        } else if (Math.abs(dx) > 30) {
          this.patrolDir = dx > 0 ? 1 : -1;
        }

        // Dynamically adjust hover altitude to stay strictly within the visible playable area below HUD
        const cam = this.scene.cameras?.main;
        const minY = isSurvival ? (cam ? cam.worldView.y + 44 : 155) : (cam ? cam.worldView.y + 30 : 60);
        const maxY = player.y - 30;
        const desiredHoverY = Phaser.Math.Clamp(player.y - (onlyFlyersLeft ? 42 : 55), minY, maxY);
        this.baseY = Phaser.Math.Linear(this.baseY, desiredHoverY, onlyFlyersLeft ? 0.12 : 0.05);

        // Sinusoidal bobbing around baseY
        const wave = Math.sin(this.scene.time.now * 0.005) * 12;
        this.y = Phaser.Math.Clamp(this.baseY + wave, minY, maxY + 10);

        // Close in faster if player is far away
        const speed = onlyFlyersLeft
          ? GAME_CONFIG.MOBS.BEE.HOVER_SPEED * 2.8
          : (Math.abs(dx) > 100 ? GAME_CONFIG.MOBS.BEE.HOVER_SPEED * 1.8 : GAME_CONFIG.MOBS.BEE.HOVER_SPEED);
        const velocityX = isSurvival && Math.abs(dxToStaging) > 14
          ? Math.sign(dxToStaging) * speed
          : this.patrolDir * speed;
        this.setVelocityX(velocityX);
        this.setVelocityY(0);
        this.setFlipX(dx > 0);

        const swoopRange = GAME_CONFIG.MOBS.BEE.SWOOP_RANGE || 320;
        const survivalSwoopRange = onlyFlyersLeft ? 520 : Math.max(swoopRange, 380);
        const canSwoop = dist < survivalSwoopRange && player.y > this.y + 8 && this.scene.time.now > this.swoopCooldownUntil;
        if (canSwoop) {
          this.startSwoop(player);
        }
      } else {
        this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.BEE.HOVER_SPEED);
        this.setVelocityY(0);
        this.setFlipX(this.patrolDir > 0);
        const wave = Math.sin(this.scene.time.now * 0.005) * 16;
        this.y = Phaser.Math.Clamp(this.baseY + wave, 60, 360);
      }

      // Reverse horizontal direction at boundaries
      if (this.body.blocked.left) this.patrolDir = 1;
      if (this.body.blocked.right) this.patrolDir = -1;
    } else if (this.state === 'SWOOP') {
      if (player && !player.isDead) {
        this.swoopTargetX = player.x;
        this.swoopTargetY = player.y;
      }

      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.swoopTargetX, this.swoopTargetY);
      const floorLimit = (this.scene.levelHeight ? this.scene.levelHeight - 30 : 400);
      if (this.y >= this.swoopTargetY + 12 || this.y >= floorLimit || dist < 16 || this.body.blocked.down) {
        this.recover();
      } else {
        const angle = Phaser.Math.Angle.Between(this.x, this.y, this.swoopTargetX, this.swoopTargetY);
        this.scene.physics.velocityFromRotation(angle, GAME_CONFIG.MOBS.BEE.SWOOP_SPEED, this.body.velocity);
        this.setFlipX(this.body.velocity.x > 0);
      }
    } else if (this.state === 'RECOVER') {
      // Ascend back towards origin height above player
      this.setVelocityY(-110);
      this.setVelocityX(this.patrolDir * 60);

      const cam = this.scene.cameras?.main;
      const minY = isSurvival ? (cam ? cam.worldView.y + 44 : 155) : (cam ? cam.worldView.y + 30 : 60);
      const targetRecoveryY = player && !player.isDead ? Math.max(minY, player.y - 55) : this.baseY;
      if (this.y <= targetRecoveryY || this.y <= minY) {
        this.baseY = targetRecoveryY;
        this.y = targetRecoveryY;
        this.state = 'HOVER';
        this.setVelocityY(0);
        this.swoopCooldownUntil = this.scene.time.now + 1600;
        this.play('bee_fly_anim', true);
      }
    }
  }

  startSwoop(player) {
    if (!player || player.isDead) return;
    this.state = 'SWOOP';
    this.swoopTargetX = player.x;
    this.swoopTargetY = player.y;
    this.play('bee_attack_anim', true);

    // Visual telegraph arrow / warning
    const warn = this.scene.add.text(this.x, this.y - 14, 'SWOOP!', {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#ffcc00'
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: warn,
      alpha: 0,
      duration: 350,
      onComplete: () => warn.destroy()
    });
  }

  recover() {
    this.state = 'RECOVER';
    this.play('bee_fly_anim', true);
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    let finalDamage = amount;
    let isCounter = false;

    // Upward slash counter mechanic
    if (isUpwardSlash || this.state === 'SWOOP') {
      finalDamage = Math.round(amount * 2.5);
      isCounter = true;
    }

    this.hp -= finalDamage;
    sound.playHit();

    // Damage / Counter popup via JuiceEffects
    if (isCounter) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 12, finalDamage, 'counter', `AERIAL COUNTER! -${finalDamage}`);
      juice.hitStopHeavy(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 12, finalDamage, 'upslash');
      juice.hitStopLight(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 12, finalDamage, 'normal');
      juice.hitStopLight(this.scene);
    }

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.BEE.PTS, isCounter };
    } else {
      this.recover();
      return { killed: false, pts: 0, isCounter };
    }
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('bee_hit_anim');

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + 16,
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

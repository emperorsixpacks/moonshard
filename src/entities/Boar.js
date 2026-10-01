import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class Boar extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'boar_walk');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Boar frame is 48x32. Collider size:
    this.body.setSize(32, 22);
    this.body.setOffset(8, 10);
    this.setDepth(19);

    this.mobType = 'boar';
    this.hp = GAME_CONFIG.MOBS.BOAR.HP;
    this.maxHp = GAME_CONFIG.MOBS.BOAR.HP;
    this.state = 'PATROL'; // PATROL, ALERT, CHARGE, STUNNED, DEAD
    this.patrolDir = -1; // -1 = left, 1 = right
    this.setFlipX(false); // Default facing left

    this.chargeCooldownUntil = 0;
    this.alertTimer = 0;
    this.stunnedUntil = 0;

    this.healthBar = new EnemyHealthBar(scene, this, 28, 3.5, 6);
    this.play('boar_walk_anim');
  }

  update(player) {
    if (this.healthBar) this.healthBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      this.setVelocityX(0);
      return;
    }

    const onGround = this.body.blocked.down;
    const hitWall = this.body.blocked.left || this.body.blocked.right;

    if (this.state === 'STUNNED') {
      if (onGround && Math.abs(this.body.velocity.x) > 10) {
        this.setVelocityX(this.body.velocity.x * 0.88);
      }
      if (this.scene.time.now > this.stunnedUntil) {
        this.state = 'PATROL';
        this.play('boar_walk_anim', true);
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

    if (this.state === 'CHARGE') {
      this.setVelocityX(this.chargeDir * GAME_CONFIG.MOBS.BOAR.CHARGE_SPEED);
      this.setFlipX(this.chargeDir > 0);

      if (hitWall || this.isLedgeAhead(this.chargeDir)) {
        // Wall or cliff edge brake stun
        this.state = 'STUNNED';
        this.stunnedUntil = this.scene.time.now + 900;
        this.setVelocityX(0);
        this.play('boar_idle_anim', true);
        sound.playHit();
        this.scene.cameras.main.shake(80, 0.008);
      }
      return;
    }

    // Default: PATROL with ledge edge detection
    if (hitWall || this.isLedgeAhead(this.patrolDir)) {
      this.patrolDir *= -1;
    }

    this.setVelocityX(this.patrolDir * GAME_CONFIG.MOBS.BOAR.WALK_SPEED);
    this.setFlipX(this.patrolDir > 0);

    // Player detection & proximity seeking
    if (player && !player.isDead) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      const dy = Math.abs(this.y - player.y);
      const dx = player.x - this.x;

      // Proximity tracking: in Survival arena, seek player across full arena; in Story, use local proximity
      const isSurvival = this.scene && this.scene.scene && this.scene.scene.key === 'SurvivalScene';
      const maxSeekDist = isSurvival ? 840 : 180;
      const maxSeekDy = isSurvival ? 140 : 60;

      if (dist < maxSeekDist && dy < maxSeekDy) {
        const targetDir = dx >= 0 ? 1 : -1;
        if (!this.isLedgeAhead(targetDir)) {
          this.patrolDir = targetDir;
        }
      }

      // Close attack proximity trigger (< 140px) -> charge attack!
      if (dist < 140 && dy < 45 && this.scene.time.now > this.chargeCooldownUntil) {
        this.triggerAlert(player);
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

    const lookX = this.x + (dir * (this.body.width / 2 + 10));
    const footY = this.body.bottom + 8;

    const hasGround = this.scene.platforms.getChildren().some(plat => {
      const pb = plat.body;
      if (!pb) return false;
      return lookX >= pb.left && lookX <= pb.right && footY >= pb.top && footY <= pb.bottom + 14;
    });

    return !hasGround;
  }

  triggerAlert(player) {
    this.state = 'ALERT';
    this.alertTimer = this.scene.time.now + 450;
    this.play('boar_idle_anim', true);

    // Alert emote / dust puff
    const alertMark = this.scene.add.text(this.x, this.y - 18, '!', {
      fontFamily: 'Press Start 2P',
      fontSize: '10px',
      color: '#ff3333'
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: alertMark,
      y: this.y - 28,
      alpha: 0,
      duration: 400,
      onComplete: () => alertMark.destroy()
    });
  }

  startCharge(player) {
    this.state = 'CHARGE';
    this.chargeDir = player.x < this.x ? -1 : 1;
    this.chargeCooldownUntil = this.scene.time.now + 3500;
    this.play('boar_run_anim', true);

    // Charge audio
    sound.playSlash(2);
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    // Back-slash detection:
    // Boar is facing left (flipX false, dir < 0) -> back is to the RIGHT (attackFromX > this.x)
    // Boar is facing right (flipX true, dir > 0) -> back is to the LEFT (attackFromX < this.x)
    const boarFacingRight = this.flipX;
    const attackerBehind = boarFacingRight ? (attackFromX < this.x) : (attackFromX > this.x);

    let finalDamage = amount;
    let isBackstab = false;
    let isCounter = false;

    const wasCharging = this.state === 'CHARGE' || this.state === 'ALERT';

    if (attackerBehind) {
      finalDamage = Math.round(amount * (GAME_CONFIG.MOBS.BOAR.BACKSTAB_MULTIPLIER || 3.0));
      isBackstab = true;
    } else if (wasCharging) {
      // Slashing a charging or winding-up boar counters and staggers it!
      const counterMultiplier = isUpwardSlash ? 3.5 : (GAME_CONFIG.MOBS.BOAR.COUNTER_MULTIPLIER || 3.0);
      finalDamage = Math.round(amount * counterMultiplier);
      isCounter = true;
    } else if (isUpwardSlash) {
      finalDamage = Math.round(amount * (GAME_CONFIG.PLAYER.UPWARD_SLASH_BONUS || 1.5));
    }

    this.hp -= finalDamage;
    sound.playHit();

    // Damage popup via JuiceEffects
    if (isBackstab) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDamage, 'crit', `CRIT -${finalDamage}! 🗡️`);
      juice.hitStopCrit(this.scene);
    } else if (isCounter) {
      const counterLabel = isUpwardSlash ? `UP-COUNTER -${finalDamage}! ⚔️` : `COUNTER -${finalDamage}! 💥`;
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDamage, 'counter', counterLabel);
      juice.hitStopHeavy(this.scene);
    } else if (isUpwardSlash) {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDamage, 'upslash');
      juice.hitStopLight(this.scene);
    } else {
      juice.spawnDamageNumber(this.scene, this.x, this.y - 16, finalDamage, 'normal');
      juice.hitStopLight(this.scene);
    }

    // Stagger / Stun the boar and interrupt charge immediately
    const stunDuration = wasCharging ? 950 : 350;
    this.state = 'STUNNED';
    this.stunnedUntil = this.scene.time.now + stunDuration;
    this.chargeCooldownUntil = this.scene.time.now + 3000;
    this.play('boar_hit_anim', true);

    if (isCounter) {
      sound.playSlash(2);
    }

    // Knockback
    const knockDir = attackFromX < this.x ? 1 : -1;
    const knockForceX = wasCharging ? 180 : 120;
    const knockForceY = isUpwardSlash ? -240 : (wasCharging ? -130 : -90);
    this.setVelocityX(knockDir * knockForceX);
    this.setVelocityY(knockForceY);

    if (this.hp <= 0) {
      this.die();
      return { killed: true, pts: GAME_CONFIG.MOBS.BOAR.PTS, isBackstab, isCounter };
    } else {
      // Flash red
      this.setTint(0xff3333);
      this.scene.time.delayedCall(140, () => this.clearTint());
      return { killed: false, pts: 0, isBackstab, isCounter };
    }
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

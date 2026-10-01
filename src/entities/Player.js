import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { juice } from '../engine/JuiceEffects.js';

export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'char_idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Physics setup - sprite frame is 96x80; character body is 18x38 centered at x=48, feet baseline at y=74
    this.body.setSize(18, 38);
    this.body.setOffset(39, 36);
    this.body.setMaxVelocity(300, 500);
    this.setDepth(20);

    // State
    this.health = GAME_CONFIG.PLAYER.MAX_HEALTH;
    this.maxHealth = GAME_CONFIG.PLAYER.MAX_HEALTH;
    this.isDead = false;
    this.isAttacking = false;
    this.attackType = 'combo1'; // combo1, combo2, upward
    this.lastAttackTime = 0;
    this.canDoubleJump = false;
    this.isWallSliding = false;
    this.invulnerableUntil = 0;
    this.currentSwingHits = new Set();

    // Equipped gear & cosmetic properties
    this.equippedWeaponId = storage.getEquippedWeapon();
    this.weaponConfig = Object.values(GAME_CONFIG.WEAPONS).find(w => w.id === this.equippedWeaponId) || GAME_CONFIG.WEAPONS.STARTER;
    this.companionActive = storage.isCompanionActive();

    // Pet companion sprite (Sylva, Moon Sprite)
    if (this.companionActive) {
      this.pet = scene.add.sprite(x - 14, y - 20, 'fairy_fly');
      this.pet.setScale(0.7);
      this.pet.play('fairy_fly_anim');
      this.pet.setDepth(this.depth + 1);
    }

    // Weapon trail / particle emitter
    this.setupCosmeticParticles(scene);

    // Attack hitbox (separate invisible physics trigger)
    this.attackHitbox = scene.add.rectangle(x, y, 28, 28, 0xffffff, 0).setOrigin(0, 0);
    scene.physics.add.existing(this.attackHitbox);
    this.attackHitbox.body.setAllowGravity(false);
    this.attackHitbox.body.setEnable(false);

    // Play default animation
    this.play('player_idle');
  }

  setupCosmeticParticles(scene) {
    if (this.weaponConfig.effect === 'golden_spark') {
      this.particles = scene.add.particles(0, 0, 'spark', {
        scale: { start: 1.2, end: 0 },
        speed: { min: 20, max: 50 },
        lifespan: 300,
        blendMode: 'ADD',
        tint: 0xffd700,
        emitting: false
      });
    } else if (this.weaponConfig.effect === 'void_smoke') {
      this.particles = scene.add.particles(0, 0, 'spark', {
        scale: { start: 1.5, end: 0 },
        speed: { min: 10, max: 30 },
        lifespan: 400,
        blendMode: 'ADD',
        tint: 0x9933ff,
        emitting: false
      });
    } else if (this.weaponConfig.effect === 'crimson_flame') {
      this.particles = scene.add.particles(0, 0, 'spark', {
        scale: { start: 1.3, end: 0 },
        speed: { min: 25, max: 60 },
        lifespan: 350,
        blendMode: 'ADD',
        tint: [0xff3300, 0xff7700, 0xffcc00],
        emitting: false
      });
    } else if (this.weaponConfig.effect === 'frost_moon') {
      this.particles = scene.add.particles(0, 0, 'spark', {
        scale: { start: 1.2, end: 0.1 },
        speed: { min: 15, max: 45 },
        lifespan: 400,
        blendMode: 'ADD',
        tint: [0x38e1ff, 0x88ffff, 0xffffff],
        emitting: false
      });
    } else if (this.weaponConfig.effect === 'verdant_bloom') {
      this.particles = scene.add.particles(0, 0, 'spark', {
        scale: { start: 1.2, end: 0 },
        speed: { min: 15, max: 40 },
        lifespan: 380,
        blendMode: 'ADD',
        tint: [0x33ee66, 0x98ff98, 0xffff66],
        emitting: false
      });
    }
  }

  update(cursors, customInputs = {}) {
    if (this.isDead) return;

    const onGround = this.body.blocked.down;
    const touchingLeftWall = this.body.blocked.left;
    const touchingRightWall = this.body.blocked.right;

    // Reset double jump on landing
    if (onGround) {
      this.canDoubleJump = true;
      this.isWallSliding = false;
    }

    // Input state combining keyboard & touch
    const left = cursors.left.isDown || cursors.keys?.A?.isDown || customInputs.left;
    const right = cursors.right.isDown || cursors.keys?.D?.isDown || customInputs.right;
    const up = cursors.up.isDown || cursors.keys?.W?.isDown || customInputs.up;
    const down = cursors.down.isDown || cursors.keys?.S?.isDown || customInputs.down;
    const jumpPressed = Phaser.Input.Keyboard.JustDown(cursors.up) ||
                        Phaser.Input.Keyboard.JustDown(cursors.space) ||
                        Phaser.Input.Keyboard.JustDown(cursors.keys?.W) ||
                        customInputs.justJump;
    const attackPressed = (cursors.keys?.J && Phaser.Input.Keyboard.JustDown(cursors.keys.J)) ||
                          (cursors.keys?.Z && Phaser.Input.Keyboard.JustDown(cursors.keys.Z)) ||
                          (cursors.keys?.ENTER && Phaser.Input.Keyboard.JustDown(cursors.keys.ENTER)) ||
                          customInputs.justAttack;
    const upSlashPressed = (cursors.keys?.K && Phaser.Input.Keyboard.JustDown(cursors.keys.K)) ||
                           customInputs.justUpSlash;

    // Wall slide detection
    if (!onGround && (touchingLeftWall || touchingRightWall) && this.body.velocity.y > 0) {
      this.isWallSliding = true;
      this.body.setVelocityY(Math.min(this.body.velocity.y, GAME_CONFIG.PLAYER.WALL_SLIDE_SPEED));
      sound.playWallSlide();
    } else {
      this.isWallSliding = false;
    }

    // Attack triggering
    if ((attackPressed || upSlashPressed) && !this.isAttacking) {
      this.executeAttack(up || upSlashPressed);
    }

    // Movement (locked or restricted during heavy attack swing)
    if (!this.isAttacking || !onGround) {
      const speed = GAME_CONFIG.PLAYER.RUN_SPEED;
      if (left) {
        this.setVelocityX(-speed);
        this.setFlipX(true);
        if (onGround && !this.isAttacking) this.play('player_run', true);
      } else if (right) {
        this.setVelocityX(speed);
        this.setFlipX(false);
        if (onGround && !this.isAttacking) this.play('player_run', true);
      } else {
        this.setVelocityX(0);
        if (onGround && !this.isAttacking) this.play('player_idle', true);
      }

      // Ambient cosmetic weapon particle trail while running or airborne
      if (this.particles && (Math.abs(this.body.velocity.x) > 20 || !onGround)) {
        if (this.scene.time.now % 100 < 20) {
          this.particles.emitParticleAt(this.x + (this.flipX ? 6 : -6), this.y - 8, 1);
        }
      }
    }

    // Jumping & Wall jumping
    if (jumpPressed) {
      if (this.isWallSliding) {
        // Wall jump kick-off
        const kickDir = touchingLeftWall ? 1 : -1;
        this.setVelocityX(kickDir * GAME_CONFIG.PLAYER.WALL_JUMP_X);
        this.setVelocityY(GAME_CONFIG.PLAYER.WALL_JUMP_Y);
        this.setFlipX(kickDir < 0);
        this.canDoubleJump = true;
        sound.playJump(false);
        this.play('player_jump_start', true);
      } else if (onGround) {
        // Normal jump
        this.setVelocityY(GAME_CONFIG.PLAYER.JUMP_FORCE);
        sound.playJump(false);
        this.play('player_jump_start', true);
      } else if (this.canDoubleJump) {
        // Double jump
        this.setVelocityY(GAME_CONFIG.PLAYER.DOUBLE_JUMP_FORCE);
        this.canDoubleJump = false;
        sound.playJump(true);
        this.play('player_jump_all', true);
        this.spawnDoubleJumpPuff();
      }
    }

    // In-air animation handling
    if (!onGround && !this.isAttacking) {
      if (this.body.velocity.y < -50) {
        this.play('player_jump_start', true);
      } else if (this.body.velocity.y > 50) {
        this.play('player_jump_end', true);
      }
    }

    // Update attack hitbox and scan for hits
    if (this.isAttacking) {
      this.updateAttackHitbox();
      this.performAttackScan();
    }

    // Update companion position
    if (this.pet) {
      const targetPetX = this.flipX ? this.x + 16 : this.x - 16;
      const targetPetY = this.y - 18 + Math.sin(this.scene.time.now * 0.006) * 4;
      this.pet.x += (targetPetX - this.pet.x) * 0.12;
      this.pet.y += (targetPetY - this.pet.y) * 0.12;
      this.pet.setFlipX(!this.flipX);
    }

    // Invulnerability blinking
    if (this.scene.time.now < this.invulnerableUntil) {
      this.setAlpha(Math.floor(this.scene.time.now / 80) % 2 === 0 ? 0.3 : 1.0);
    } else {
      this.setAlpha(1.0);
    }
  }

  getAttackBounds(forceUpward) {
    const rangeMul = this.weaponConfig.rangeMul || 1.0;
    const isUp = forceUpward !== undefined ? forceUpward : (this.attackType === 'upward');
    if (isUp) {
      const w = 52 * rangeMul;
      const h = 60 * rangeMul;
      return new Phaser.Geom.Rectangle(this.x - w / 2, this.y - 48 * rangeMul, w, h);
    } else {
      const w = (this.attackType === 'combo2' ? 48 : 42) * rangeMul;
      const h = 38 * rangeMul;
      const x = this.flipX ? (this.x - w) : this.x;
      const y = this.y - 12;
      return new Phaser.Geom.Rectangle(x, y, w, h);
    }
  }

  executeAttack(isUpward) {
    this.isAttacking = true;
    this.currentSwingHits.clear();
    const now = this.scene.time.now;
    const isCombo = (now - this.lastAttackTime < GAME_CONFIG.PLAYER.COMBO_WINDOW_MS) && (this.attackType === 'combo1');

    if (isUpward) {
      this.attackType = 'upward';
      sound.playUpwardSlash();
      // Grounded anti-air leap only (prevent infinite aerial flight exploit)
      if (this.body.blocked.down) {
        this.setVelocityY(-140);
      }
    } else if (isCombo) {
      this.attackType = 'combo2';
      sound.playSlash(2);
    } else {
      this.attackType = 'combo1';
      sound.playSlash(1);
    }
    this.lastAttackTime = now;

    // Enable and accurately position attack hitbox
    this.attackHitbox.body.setEnable(true);
    this.updateAttackHitbox();
    this.performAttackScan();

    if (this.weaponConfig.effect && this.weaponConfig.isSkin) {
      sound.playElementalSlash(this.weaponConfig.effect);
    }

    if (this.particles) {
      const px = this.flipX ? (this.x - 14) : (this.x + 14);
      const py = isUpward ? (this.y - 24) : (this.y - 8);
      this.particles.emitParticleAt(px, py, 6);
    }

    // Play attack anim (Attack-01 has 8 frames; 0..3 = Combo 1, 4..7 = Combo 2)
    if (this.attackType === 'combo2') {
      this.play('player_attack_combo2', true);
    } else {
      this.play('player_attack_combo1', true);
    }

    // Heavy slash slight push
    if (this.body.blocked.down && this.attackType === 'combo2') {
      this.setVelocityX(this.flipX ? -30 : 30);
    }

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.isAttacking = false;
      this.attackHitbox.body.setEnable(false);
      this.currentSwingHits.clear();
      if (this.body.blocked.down) {
        this.play('player_idle', true);
      }
    });

    // Fallback timer in case anim complete doesn't trigger
    this.scene.time.delayedCall(320, () => {
      if (this.isAttacking) {
        this.isAttacking = false;
        this.attackHitbox.body.setEnable(false);
        this.currentSwingHits.clear();
      }
    });
  }

  updateAttackHitbox() {
    if (!this.attackHitbox || !this.attackHitbox.body) return;
    const bounds = this.getAttackBounds();

    this.attackHitbox.setPosition(bounds.x, bounds.y);
    this.attackHitbox.setSize(bounds.width, bounds.height);
    this.attackHitbox.body.setSize(bounds.width, bounds.height);
    this.attackHitbox.body.reset(bounds.x, bounds.y);
  }

  performAttackScan() {
    if (!this.isAttacking || this.isDead) return;
    const attackBounds = this.getAttackBounds();

    // 1. Scan enemies
    if (this.scene.enemies && this.scene.enemies.getChildren) {
      const enemyList = this.scene.enemies.getChildren();
      for (let i = 0; i < enemyList.length; i++) {
        const enemy = enemyList[i];
        if (!enemy || !enemy.active || enemy.state === 'DEAD' || this.currentSwingHits.has(enemy)) continue;

        // Facing direction check for horizontal swings
        if (this.attackType !== 'upward') {
          const enemyCenterX = enemy.body ? enemy.body.center.x : enemy.x;
          if (!this.flipX && enemyCenterX < this.x) continue;
          if (this.flipX && enemyCenterX > this.x) continue;
        }

        // Use the enemy's physical Arcade body bounds if available, else getBounds()
        const eb = enemy.body;
        const enemyRect = eb
          ? new Phaser.Geom.Rectangle(eb.x, eb.y, eb.width, eb.height)
          : enemy.getBounds();

        if (Phaser.Geom.Intersects.RectangleToRectangle(attackBounds, enemyRect)) {
          this.currentSwingHits.add(enemy);
          if (this.scene.handlePlayerAttackEnemy) {
            this.scene.handlePlayerAttackEnemy(enemy);
          } else if (this.scene.handlePlayerAttack) {
            this.scene.handlePlayerAttack(enemy);
          }
        }
      }
    }

    // 2. Scan crates
    if (this.scene.crates && this.scene.crates.getChildren) {
      const crateList = this.scene.crates.getChildren();
      for (let i = 0; i < crateList.length; i++) {
        const crate = crateList[i];
        if (!crate || !crate.active || crate.isBroken || this.currentSwingHits.has(crate)) continue;

        const crateBounds = crate.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(attackBounds, crateBounds)) {
          this.currentSwingHits.add(crate);
          crate.breakCrate(this);
          if (this.scene.updateHudMaterials) {
            this.scene.updateHudMaterials();
          }
        }
      }
    }

    // 3. Scan obelisk
    if (this.scene.obelisk && this.scene.obelisk.active && !this.scene.obelisk.isCleansed && !this.currentSwingHits.has(this.scene.obelisk)) {
      const obeliskBounds = this.scene.obelisk.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(attackBounds, obeliskBounds)) {
        this.currentSwingHits.add(this.scene.obelisk);
        const cleansed = this.scene.obelisk.strike();
        if (cleansed && this.scene.triggerChapterVictory) {
          this.scene.triggerChapterVictory();
        }
      }
    }
  }

  getAttackDamage() {
    const baseDamage = this.attackType === 'combo2' ? 35 : (this.attackType === 'upward' ? 40 : 20);
    const multiplier = this.weaponConfig.damageMul || 1.0;
    return Math.round(baseDamage * multiplier);
  }

  takeDamage(amount = 20, knockbackDir = 0) {
    if (this.isDead || (this.scene && this.scene.inDialogue) || this.scene.time.now < this.invulnerableUntil) return false;

    // Normalize knockback direction: if a world X coordinate was passed, determine direction relative to player
    let dir = 0;
    if (Math.abs(knockbackDir) > 2) {
      dir = knockbackDir < this.x ? 1 : -1;
    } else if (knockbackDir > 0) {
      dir = 1;
    } else if (knockbackDir < 0) {
      dir = -1;
    }

    this.health = Math.max(0, this.health - amount);
    this.invulnerableUntil = this.scene.time.now + GAME_CONFIG.PLAYER.INVULNERABILITY_MS;
    sound.playHit();
    juice.spawnDamageNumber(this.scene, this.x, this.y - 18, amount, 'player');
    juice.hitStopLight(this.scene);

    // Knockback
    this.setVelocityX(dir * 160);
    this.setVelocityY(-180);

    // Screen shake
    this.scene.cameras.main.shake(120, 0.015);

    if (this.scene && this.scene.heroHealthBar) {
      this.scene.heroHealthBar.updateHealth(this.health, this.maxHealth);
    }
    if (this.scene && this.scene.updateHearts) {
      this.scene.updateHearts();
    }

    if (this.health <= 0) {
      this.die();
      if (this.scene && typeof this.scene.handlePlayerGameOver === 'function') {
        this.scene.handlePlayerGameOver();
      } else if (this.scene && typeof this.scene.handleGameOver === 'function') {
        this.scene.handleGameOver();
      }
    }
    return true;
  }

  heal(amount = 35) {
    if (this.health >= this.maxHealth) return false;
    this.health = Math.min(this.maxHealth, this.health + amount);
    sound.playCoin();
    if (this.scene && this.scene.heroHealthBar) {
      this.scene.heroHealthBar.updateHealth(this.health, this.maxHealth);
      this.scene.heroHealthBar.flashHeal();
    }
    if (this.scene && this.scene.updateHearts) {
      this.scene.updateHearts();
    }
    return true;
  }

  die() {
    this.isDead = true;
    this.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.attackHitbox.body.setEnable(false);
    if (this.pet) this.pet.destroy();
    sound.playEnemyDeath();
    this.play('player_dead', true);
  }

  spawnDoubleJumpPuff() {
    const puff = this.scene.add.circle(this.x, this.y + 12, 6, 0xffffff, 0.7);
    this.scene.tweens.add({
      targets: puff,
      scale: 1.8,
      alpha: 0,
      duration: 250,
      onComplete: () => puff.destroy()
    });
  }
}

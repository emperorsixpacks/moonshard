import Phaser from 'phaser';
import Player from '../entities/Player.js';
import Boar from '../entities/Boar.js';
import Snail from '../entities/Snail.js';
import Bee from '../entities/Bee.js';
import Mushroom from '../entities/Mushroom.js';
import FlyingEye from '../entities/FlyingEye.js';
import Goblin from '../entities/Goblin.js';
import BossGorgok from '../entities/BossGorgok.js';
import BogLurker from '../entities/BogLurker.js';
import DreadBat from '../entities/DreadBat.js';
import CryptWraith from '../entities/CryptWraith.js';
import BasaltGolem from '../entities/BasaltGolem.js';
import VoidStalker from '../entities/VoidStalker.js';
import Projectile from '../entities/Projectile.js';
import BossHealthBar from '../ui/BossHealthBar.js';
import HeroHealthBar from '../ui/HeroHealthBar.js';
import Crate from '../entities/Crate.js';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { getTodaySeedString, generateDailySurvivalSpec } from '../engine/PRNG.js';
import { pauseService } from '../engine/PauseService.js';
import { gdService } from '../engine/GdService.js';
import { layoutHud } from '../ui/hudLayout.js';
import { cssPerUnitOf } from '../engine/uiScale.js';
import { useHudHeight } from '../engine/HudAnchor.js';
import { juice } from '../engine/JuiceEffects.js';
import confetti from 'canvas-confetti';
import ShardDrop from '../entities/ShardDrop.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { runs, shardsLine, survivalLabel } from '../gd/runs.js';
import { ActiveClock, pageHidden } from '../gd/activeClock.js';
import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';

// After this long without an answer from the server the result screen says the run is still being submitted.
const SLOW_SUBMIT_MS = 20_000;


export default class SurvivalScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SurvivalScene' });
  }

  create() {
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    this.arenaWidth = 840;
    this.arenaHeight = 440;

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.show();
    }

    pauseService.attachScene(this, 'ENDLESS MODE');
    pauseService.showButtons();
    pauseService.updateTimer(0);
    sound.playBGM('battle');
    this.events.once('shutdown', () => {
      pauseService.detachScene();
      sound.stopBGM();
    });

    this.physics.world.setBounds(0, 0, this.arenaWidth, this.arenaHeight);

    // Classic fixed arena (identical for every player). The date only keys the
    // daily record — the arena layout itself never changes.
    this.dayKey = getTodaySeedString();
    this.spec = generateDailySurvivalSpec();

    // Arena Lush Forest Background & Atmosphere
    this.createArenaForestBackground();

    // Game stats. Time survived is the time actually played: it stops while paused or while the tab is hidden,
    // because it is worth 10 points a second and the daily prizes go to the top scores.
    this.activeClock = new ActiveClock();
    this.secondsSurvived = 0;
    this.totalScore = 0;
    this.killCount = { boar: 0, snail: 0, bee: 0, mushroom: 0, flying_eye: 0, goblin: 0, boss_gorgok: 0, total: 0 };
    this.comboCount = 0;
    this.currentComboMultiplier = 1.0;
    this.isGameOver = false;

    // Groups
    this.platforms = this.physics.add.staticGroup();
    this.crates = this.physics.add.group();
    this.enemies = this.physics.add.group();
    this.projectiles = this.physics.add.group({ runChildUpdate: true });
    this.shardDrops = this.physics.add.group();
    this.sessionCrystalsCollected = 0;
    this.crystalBankResult = null;
    this.rewardsStatus = null;
    this.isDailyHarvestCapped = false;
    this.runProof = null;
    this.gameOverDetails = null;
    runs.start({ mode: 'TRIAL' });
    this.events.once('shutdown', () => runs.stop());
    fetchRewardsStatus().then((st) => {
      this.rewardsStatus = st;
      this.checkDailyHarvestCap();
    }).catch(() => {});

    // Build seeded arena
    this.buildSeededArena();

    // Spawn player in center
    this.player = new Player(this, 400, 240);
    this.physics.add.collider(this.player, this.platforms);

    // Camera setup
    this.cameras.main.setBounds(0, 0, this.arenaWidth, this.arenaHeight);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // Collisions
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.crates, this.platforms);
    this.physics.add.collider(this.shardDrops, this.platforms);
    this.physics.add.overlap(this.player, this.shardDrops, (_p, crystal) => {
      crystal.collect(this.player);
    });


    // Projectile terrain collision
    this.physics.add.collider(this.projectiles, this.platforms, (proj) => {
      if (proj && proj.active) {
        if (proj.projType === 'goblin_bomb') {
          // bombs bounce on ground
        } else {
          proj.destroyProj ? proj.destroyProj() : proj.destroy();
        }
      }
    });

    // Player attack vs enemies
    this.physics.add.overlap(this.player.attackHitbox, this.enemies, (hitbox, enemy) => {
      if (this.player.currentSwingHits && this.player.currentSwingHits.has(enemy)) return;
      if (this.player.currentSwingHits) this.player.currentSwingHits.add(enemy);
      this.handlePlayerAttack(enemy);
    });

    // Player attack vs projectiles (deflection)
    this.physics.add.overlap(this.player.attackHitbox, this.projectiles, (hitbox, proj) => {
      if (!this.player.isAttacking || !proj || proj.isDead || proj.isDeflected) return;
      if (proj.isDeflectable) {
        proj.deflect(this.player);
      }
    });

    // Player attack vs crates
    this.physics.add.overlap(this.player.attackHitbox, this.crates, (hitbox, crate) => {
      if (this.player.currentSwingHits && this.player.currentSwingHits.has(crate)) return;
      if (this.player.currentSwingHits) this.player.currentSwingHits.add(crate);
      crate.breakCrate(this.player);
    });

    // Player vs enemy body
    this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
      this.handlePlayerHurt(enemy);
    });

    // Player vs projectiles
    this.physics.add.overlap(this.player, this.projectiles, (player, proj) => {
      if (this.player.isDead || !proj || proj.isDead || proj.isDeflected) return;
      const knockDir = proj.x < this.player.x ? 1 : -1;
      const damaged = this.player.takeDamage(proj.damage || 15, knockDir);
      if (damaged) {
        this.comboCount = 0;
        this.currentComboMultiplier = 1.0;
        this.txtCombo.setText('COMBO: 1.0x');
        this.updateHearts();
        if (this.player.isDead) {
          this.handleGameOver();
        }
      }
      proj.destroyProj ? proj.destroyProj() : proj.destroy();
    });

    // Deflected projectiles vs enemies
    this.physics.add.overlap(this.projectiles, this.enemies, (proj, enemy) => {
      if (!proj || proj.isDead || !proj.isDeflected || !enemy || enemy.state === 'DEAD' || enemy._killHandled) return;
      const res = enemy.takeDamage(60, proj.x);
      proj.destroyProj ? proj.destroyProj() : proj.destroy();
      if (res && res.killed) {
        this.addKill(enemy.mobType, res.pts, 40, enemy.x, enemy.y - 12, 'DEFLECT KILL! ⚡', enemy);
      }
    });

    // Controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.cursors.keys = this.input.keyboard.addKeys('W,A,S,D,J,K,Z,X,ENTER,ESC');

    // HUD
    this.createSurvivalHUD();

    // Start wave progression (kill-gated with concurrency cap)
    this.currentWaveIndex = 0;
    this.wavePendingCount = 0;
    this.waveRemainingFoes = 0;
    this.waveSpawnQueue = [];
    this.maxConcurrentEnemies = 2;
    this.inFlightSpawns = 0;
    this.pendingWaveSpawns = [];
    this.waveHpMul = 1;
    this.endlessMode = false;
    this.endlessWave = 1;
    this.waveStartTime = this.activeClock.ms;
    this.waveSpawnTimers = [];
    this.modalButtons = null;
    this.player.body.setCollideWorldBounds(true);
    this.startWave(this.currentWaveIndex);
  }

  createArenaForestBackground() {
    const w = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;

    // 1. Sky
    this.bgSky = this.add.tileSprite(0, 0, w, h, 'sky_backdrop').setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    if (h > 270) this.bgSky.tileScaleY = h / 270;

    // 2. Mountains
    this.bgMountains = this.add.tileSprite(0, 20, w, Math.max(200, h - 20), 'sky_mountains').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    if (h > 270) this.bgMountains.tileScaleY = Math.max(1, (h - 20) / 250);

    // 3. Fog pines
    this.bgFogPines = this.add.tileSprite(0, 50, w, Math.max(220, h - 50), 'forest_bg_p0').setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    if (h > 270) this.bgFogPines.tileScaleY = Math.max(1, (h - 50) / 206);

    // 4. Midground pines
    this.bgMidPines = this.add.tileSprite(0, 80, w, Math.max(220, h - 80), 'forest_bg_p1').setOrigin(0, 0).setScrollFactor(0).setDepth(3);
    if (h > 270) this.bgMidPines.tileScaleY = Math.max(1, (h - 80) / 176);

    // 5. Tall Forest Pines in Arena
    const treePositions = [
      { x: 70, scale: 1.1, type: 'pine_green' },
      { x: 200, scale: 0.95, type: 'pine_dark' },
      { x: 360, scale: 1.05, type: 'pine_golden' },
      { x: 500, scale: 0.9, type: 'pine_dark' },
      { x: 650, scale: 1.1, type: 'pine_green' },
      { x: 770, scale: 1.0, type: 'pine_golden' },
    ];

    treePositions.forEach(t => {
      const tree = this.add.image(t.x, 326, t.type)
        .setOrigin(0.5, 1.0)
        .setScale(t.scale)
        .setDepth(4);

      this.tweens.add({
        targets: tree,
        angle: { from: -0.8, to: 0.8 },
        duration: 2600 + Math.random() * 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });

    // 6. Bushes
    [100, 260, 420, 580, 720].forEach(bx => {
      this.add.image(bx, 322, 'bush_green').setOrigin(0.5, 1.0).setDepth(5).setScale(0.8);
    });

    // 7. Ambient particles
    this.createArenaForestParticles();
  }

  createArenaForestParticles() {
    this.particles = this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: this.arenaWidth },
      y: { min: 40, max: 320 },
      quantity: 1,
      frequency: 240,
      lifespan: 3800,
      gravityY: -8,
      speedX: { min: -12, max: 12 },
      speedY: { min: -8, max: 8 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.6, end: 0 },
      tint: 0x88ee88,
      blendMode: 'ADD'
    }).setDepth(15);
  }

  onViewportResize(w, h) {
    if (this.bgSky) {
      this.bgSky.setSize(w, h);
      this.bgSky.tileScaleY = h > 270 ? h / 270 : 1;
    }
    if (this.bgMountains) {
      this.bgMountains.setSize(w, Math.max(200, h - 20));
      this.bgMountains.tileScaleY = h > 270 ? Math.max(1, (h - 20) / 250) : 1;
    }
    if (this.bgFogPines) {
      this.bgFogPines.setSize(w, Math.max(220, h - 50));
      this.bgFogPines.tileScaleY = h > 270 ? Math.max(1, (h - 50) / 206) : 1;
    }
    if (this.bgMidPines) {
      this.bgMidPines.setSize(w, Math.max(220, h - 80));
      this.bgMidPines.tileScaleY = h > 270 ? Math.max(1, (h - 80) / 176) : 1;
    }
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
  }

  buildSeededArena() {
    const depth = 10;

    // Build platforms from deterministic spec
    this.spec.platforms.forEach(plat => {
      const isGround = plat.type === 'ground';
      const count = isGround ? 0 : Math.max(1, Math.round(plat.width / 48));
      const actualWidth = isGround ? plat.width : count * 48;
      const startX = plat.x - actualWidth / 2;
      const topY = plat.y - plat.height / 2;

      // Invisible static collider body matching visual width
      const rect = this.add.rectangle(plat.x, plat.y, actualWidth, plat.height, 0x000000, 0);
      this.physics.add.existing(rect, true);
      if (!isGround) {
        // Solid bottom & top: blocks jumping through from underneath while preventing side snagging
        rect.body.checkCollision.down = true;
        rect.body.checkCollision.left = false;
        rect.body.checkCollision.right = false;
        rect.body.checkCollision.up = true;
      }
      this.platforms.add(rect);

      if (isGround) {
        // Render lush grass cliff top
        const numTiles = Math.ceil(plat.width / 16);
        for (let i = 0; i < numTiles; i++) {
          const tileX = startX + i * 16;
          let topKey = (i % 3 === 0) ? 'tile_cliff_top_mid2' : 'tile_cliff_top_mid1';
          if (i === 0) topKey = 'tile_cliff_top_left';
          else if (i === numTiles - 1) topKey = 'tile_cliff_top_right';

          this.add.image(tileX, topY - 10, topKey).setOrigin(0, 0).setDepth(depth);

          for (let cy = topY + 6; cy <= Math.max(topY + 50, this.arenaHeight + 20); cy += 16) {
            this.add.image(tileX, cy, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(depth - 1);
          }
        }

        // Flora along the grass
        for (let px = startX + 30; px < startX + plat.width - 30; px += 64) {
          const hash = Math.floor((px * 9301 + 49297) % 233280);
          const roll = hash % 5;
          if (roll === 0) {
            this.add.image(px, topY, 'prop_shroom_big').setOrigin(0.5, 1.0).setDepth(depth + 1);
          } else if (roll === 1) {
            this.add.image(px, topY, 'prop_flower_blue').setOrigin(0.5, 1.0).setDepth(depth + 1);
          } else if (roll === 2) {
            this.add.image(px, topY, 'prop_flower_purple').setOrigin(0.5, 1.0).setDepth(depth + 1);
          } else if (roll === 3) {
            this.add.image(px, topY, 'prop_shroom_small').setOrigin(0.5, 1.0).setDepth(depth + 1);
          } else if (roll === 4) {
            this.add.image(px, topY, 'prop_fern').setOrigin(0.5, 1.0).setDepth(depth + 1);
          }
        }
      } else {
        // Elevated wooden timber / ruins platforms
        for (let i = 0; i < count; i++) {
          this.add.image(startX + i * 48, topY, 'plat_wood').setOrigin(0, 0).setDepth(depth);
        }
      }
    });

    // Spawn initial supply crates
    this.spawnCrates();

    // Solid boundary barriers at edges to prevent clipping out of arena
    const leftWall = this.add.rectangle(-10, this.arenaHeight / 2, 20, this.arenaHeight, 0x000000, 0);
    this.physics.add.existing(leftWall, true);
    this.platforms.add(leftWall);

    const rightWall = this.add.rectangle(this.arenaWidth + 10, this.arenaHeight / 2, 20, this.arenaHeight, 0x000000, 0);
    this.physics.add.existing(rightWall, true);
    this.platforms.add(rightWall);
  }

  spawnProjectile(type, x, y, vx, vy, isDeflectable = true) {
    if (this.isGameOver) return null;
    const proj = new Projectile(this, x, y, type, vx, vy, isDeflectable);
    this.projectiles.add(proj);
    proj.setVelocity(vx, vy);
    return proj;
  }

  getMaxConcurrentForWave(waveIndex) {
    if (waveIndex === 0) return 2; // Wave 1: max 2 active enemies
    if (waveIndex === 1) return 3; // Wave 2: max 3 active enemies
    if (waveIndex === 2) return 3; // Wave 3: max 3 active enemies
    if (waveIndex === 3) return 4; // Wave 4: max 4 active enemies
    if (waveIndex === 4) return 4; // Wave 5: max 4 active enemies (Boss + 3 minions)
    return 4;
  }

  spawnCrates() {
    if (!this.spec?.crates) return;
    this.spec.crates.forEach(spot => {
      const existing = this.crates.getChildren().find(c => c && c.active && Math.abs(c.x - spot.x) < 12 && Math.abs(c.y - spot.y) < 12);
      if (!existing) {
        const crate = new Crate(this, spot.x, spot.y);
        this.crates.add(crate);
      }
    });
  }

  startWave(index) {
    if (this.isGameOver) return;
    this.isWaveTransitioning = false;

    const waves = this.spec.waves;
    if (index >= waves.length) {
      this.startEndless();
      return;
    }

    const wave = waves[index];
    this.currentWaveIndex = index;
    this.waveHpMul = this.getWaveHpMul(index);
    this.waveSpawnQueue = [...wave.spawns];
    this.waveRemainingFoes = wave.spawns.length;
    this.wavePendingCount = wave.spawns.length;
    this.maxConcurrentEnemies = this.getMaxConcurrentForWave(index);
    this.pendingSpawns = [];
    this.inFlightSpawns = 0;
    if (this.waveSpawnTimers) {
      this.waveSpawnTimers.forEach(t => t && t.remove && t.remove(false));
    }
    this.waveSpawnTimers = [];

    if (this.pendingWaveSpawns) {
      this.pendingWaveSpawns.forEach(e => {
        if (e && e.timer && e.timer.remove) e.timer.remove(false);
        if (e && e.spawnTimer && e.spawnTimer.remove) e.spawnTimer.remove(false);
        if (e) e.done = true;
      });
    }
    this.pendingWaveSpawns = [];
    this.waveStartTime = this.activeClock.ms;
    this.endlessMode = false;
    this.emptyArenaSince = null;
    this.updateWaveHud();

    // Replenish supply crates at each wave so player can find healing!
    this.spawnCrates();

    this.announceWave(wave.title);

    // Initial spawn check to populate arena up to maxConcurrentEnemies
    this.checkSpawnQueue();
  }

  getLivingWaveEnemies() {
    return this.enemies.getChildren().filter(e => (
      e
      && e.active
      && !e._killHandled
      && e.state !== 'DEAD'
      && e.mobType
    ));
  }

  getCountedWaveEnemies(enemies) {
    const livingEnemies = enemies || this.getLivingWaveEnemies();
    return livingEnemies.filter(e => e.countsTowardWave !== false);
  }

  isFlyer(enemy) {
    return enemy && (enemy.mobType === 'bee' || enemy.mobType === 'flying_eye');
  }

  getWaveSpawnBlockerCount(enemies) {
    const livingEnemies = enemies || this.getCountedWaveEnemies();
    return livingEnemies.filter(e => !this.isFlyer(e)).length;
  }

  prunePendingWaveSpawns() {
    this.pendingWaveSpawns = (this.pendingWaveSpawns || []).filter(entry => entry && !entry.done);
    this.inFlightSpawns = this.pendingWaveSpawns.length;
  }

  recoverStalePendingWaveSpawns() {
    const now = performance.now();
    (this.pendingWaveSpawns || []).forEach(entry => {
      if (entry && !entry.done && now - (entry.createdAt || now) > 2500) {
        if (entry.spawn) this.waveSpawnQueue.unshift(entry.spawn);
        if (entry.timer) entry.timer.remove(false);
        if (entry.spawnTimer) entry.spawnTimer.remove(false);
        entry.done = true;
      }
    });
    this.prunePendingWaveSpawns();
  }

  completePendingWaveSpawn(entry) {
    if (!entry || entry.done) return;
    entry.done = true;
    this.pendingWaveSpawns = (this.pendingWaveSpawns || []).filter(p => p !== entry);
    this.inFlightSpawns = this.pendingWaveSpawns.length;
  }

  syncWaveFoeCounter(activeEnemies) {
    if (this.endlessMode || this.isWaveTransitioning) return false;

    this.prunePendingWaveSpawns();
    const living = this.getCountedWaveEnemies(activeEnemies);
    const queuedCount = this.waveSpawnQueue ? this.waveSpawnQueue.length : 0;
    const inFlightCount = this.pendingWaveSpawns ? this.pendingWaveSpawns.length : 0;
    this.inFlightSpawns = inFlightCount;
    const actualRemaining = living.length + queuedCount + inFlightCount;

    if (this.waveRemainingFoes !== actualRemaining || this.wavePendingCount !== actualRemaining) {
      this.waveRemainingFoes = actualRemaining;
      this.wavePendingCount = actualRemaining;
      this.updateWaveHud();
    }

    if (actualRemaining === 0 && !this.isWaveTransitioning) {
      this.waveCleared();
      return true;
    }

    return false;
  }

  keepFlyerInCombat(enemy) {
    if (!enemy || !this.player || this.player.isDead) return;
    if (!this.isFlyer(enemy)) return;

    enemy.setVisible(true);
    enemy.setAlpha(1);
    enemy.setDepth(19);
    if (enemy.body && !enemy.body.enable) enemy.body.setEnable(true);

    const cam = this.cameras.main;
    const isVisible =
      enemy.x >= cam.worldView.x + 24 &&
      enemy.x <= cam.worldView.right - 24 &&
      enemy.y >= cam.worldView.y + 44 &&
      enemy.y <= cam.worldView.bottom - 24;

    const livingEnemies = this.getLivingWaveEnemies();
    const onlyFlyersLeft =
      livingEnemies.length > 0 &&
      livingEnemies.every(e => this.isFlyer(e)) &&
      (!this.waveSpawnQueue || this.waveSpawnQueue.length === 0) &&
      (!this.pendingWaveSpawns || this.pendingWaveSpawns.length === 0);

    if (isVisible) {
      enemy.offscreenSince = null;
    } else {
      if (!enemy.offscreenSince) enemy.offscreenSince = performance.now();

      if (onlyFlyersLeft || performance.now() - enemy.offscreenSince > 900) {
        const side = enemy.x < this.player.x ? -1 : 1;
        const x = Phaser.Math.Clamp(this.player.x + side * 130, cam.worldView.x + 72, cam.worldView.right - 72);
        const y = Phaser.Math.Clamp(this.player.y - 62, cam.worldView.y + 76, cam.worldView.bottom - 48);

        enemy.setPosition(x, y);
        enemy.setVelocity(side * -40, 0);
        enemy.patrolDir = enemy.x < this.player.x ? 1 : -1;
        enemy.offscreenSince = null;

        enemy.baseY = y;
        enemy.state = 'HOVER';
      } else if (enemy.x < cam.worldView.x) {
        enemy.patrolDir = 1;
      } else if (enemy.x > cam.worldView.right) {
        enemy.patrolDir = -1;
      }
    }

    if (onlyFlyersLeft) {
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const stagingX = Phaser.Math.Clamp(
        this.player.x + (dx >= 0 ? -95 : 95),
        cam.worldView.x + 64,
        cam.worldView.right - 64
      );
      const stagingY = Phaser.Math.Clamp(
        this.player.y - 58,
        cam.worldView.y + 74,
        cam.worldView.bottom - 50
      );

      if (enemy.mobType === 'bee' && enemy.state === 'RECOVER') {
        enemy.state = 'HOVER';
        enemy.baseY = stagingY;
        enemy.swoopCooldownUntil = Math.min(enemy.swoopCooldownUntil || 0, this.time.now + 400);
      }

      if (enemy.state === 'HOVER' || enemy.state === 'RECOVER') {
        enemy.setVelocity(
          Phaser.Math.Clamp((stagingX - enemy.x) * 4, -220, 220),
          Phaser.Math.Clamp((stagingY - enemy.y) * 4, -160, 160)
        );

        enemy.baseY = stagingY;
      }

      if (enemy.mobType === 'bee' && enemy.state === 'HOVER') {
        const closeEnough = Math.abs(dx) < 260 && dy > 8;
        if (closeEnough && this.time.now > (enemy.forcedSwoopAt || 0) && typeof enemy.startSwoop === 'function') {
          enemy.forcedSwoopAt = this.time.now + 900;
          enemy.swoopCooldownUntil = 0;
          enemy.startSwoop(this.player);
        } else if (enemy.swoopCooldownUntil && enemy.swoopCooldownUntil > this.time.now + 400) {
          enemy.swoopCooldownUntil = this.time.now + 400;
        }
      }
    }
  }

  checkSpawnQueue() {
    if (this.isGameOver || this.endlessMode || this.isWaveTransitioning) return;

    this.prunePendingWaveSpawns();
    this.recoverStalePendingWaveSpawns();

    const activeEnemies = this.getCountedWaveEnemies();
    const activeCount = activeEnemies.length;
    const blockerCount = this.getWaveSpawnBlockerCount(activeEnemies);

    if (this.syncWaveFoeCounter(activeEnemies)) return;

    // Self-healing fail-safe: empty arena with queued/pending foes must keep spawning
    let pendingCount = this.pendingWaveSpawns ? this.pendingWaveSpawns.length : 0;
    if (activeCount === 0 && (this.waveSpawnQueue.length > 0 || pendingCount > 0)) {
      if (!this.emptyArenaSince) {
        this.emptyArenaSince = performance.now();
      } else if (performance.now() - this.emptyArenaSince > 1500) {
        (this.pendingWaveSpawns || []).forEach(entry => {
          if (entry && entry.spawn) this.waveSpawnQueue.unshift(entry.spawn);
          if (entry && entry.timer) entry.timer.remove(false);
          if (entry && entry.spawnTimer) entry.spawnTimer.remove(false);
          if (entry) entry.done = true;
        });
        this.pendingWaveSpawns = [];
        this.inFlightSpawns = 0;
        pendingCount = 0;
        this.emptyArenaSince = null;
      }
    } else {
      this.emptyArenaSince = null;
    }

    if (this.waveSpawnQueue.length === 0 && activeCount === 0 && pendingCount === 0) {
      this.waveCleared();
      return;
    }

    const availableSlots = this.maxConcurrentEnemies - (activeCount + pendingCount);
    if (availableSlots <= 0 || this.waveSpawnQueue.length === 0) {
      return;
    }

    const toSpawn = Math.min(availableSlots, this.waveSpawnQueue.length);
    for (let i = 0; i < toSpawn; i++) {
      const spawn = this.waveSpawnQueue.shift();
      if (!spawn) continue;

      const entry = { spawn, done: false, timer: null, spawnTimer: null, createdAt: performance.now() };
      this.pendingWaveSpawns.push(entry);
      this.inFlightSpawns = this.pendingWaveSpawns.length;

      const staggerDelay = i * 180;

      entry.timer = this.time.delayedCall(staggerDelay, () => {
        if (this.isGameOver || this.isWaveTransitioning || entry.done) {
          this.completePendingWaveSpawn(entry);
          return;
        }
        this.showSpawnTelegraph(spawn.x, spawn.y);
      });

      entry.spawnTimer = this.time.delayedCall(staggerDelay + 350, () => {
        this.completePendingWaveSpawn(entry);
        if (this.isGameOver || this.isWaveTransitioning) return;
        this.spawnEnemy(spawn.type, spawn.x, spawn.y, this.waveHpMul);
        this.syncWaveFoeCounter();
        this.checkSpawnQueue();
      });

      this.waveSpawnTimers.push(entry.timer, entry.spawnTimer);
    }
  }

  showSpawnTelegraph(x, y) {
    const rune = this.add.circle(x, y, 12, 0xf6c026, 0.7).setDepth(18);
    this.tweens.add({
      targets: rune,
      scale: 1.6,
      alpha: 0,
      duration: 350,
      onComplete: () => rune.destroy()
    });
    return rune;
  }

  waveCleared() {
    if (this.isGameOver || this.isWaveTransitioning) return;
    this.isWaveTransitioning = true;

    if (this.pendingSpawns) {
      this.pendingSpawns.forEach(p => {
        if (p && p.timer) p.timer.remove(false);
        if (p && p.spawnTimer) p.spawnTimer.remove(false);
      });
      this.pendingSpawns = [];
    }
    this.waveSpawnTimers.forEach(t => t && t.remove(false));
    this.waveSpawnTimers = [];
    this.waveSpawnQueue = [];
    this.inFlightSpawns = 0;
    (this.pendingWaveSpawns || []).forEach(entry => { if (entry) entry.done = true; });
    this.pendingWaveSpawns = [];
    this.waveRemainingFoes = 0;
    this.wavePendingCount = 0;
    this.updateWaveHud();

    // Base wave clear bonus
    const baseBonus = GAME_CONFIG.SURVIVAL.WAVE_CLEAR_BONUS + (this.currentWaveIndex * 50);

    // Speed bonus: finishing the wave faster awards more score!
    const waveDurationSec = Math.max(1, Math.floor((this.activeClock.ms - this.waveStartTime) / 1000));
    const targetParSec = 30 + this.currentWaveIndex * 10; // Target time: W1: 30s, W2: 40s, W3: 50s...
    const speedBonus = waveDurationSec < targetParSec
      ? (targetParSec - waveDurationSec) * 20
      : 25; // Minimum speed bonus

    const totalBonus = baseBonus + speedBonus;
    this.totalScore += totalBonus;
    this.txtScore.setText(`SCORE: ${this.totalScore}`);

    const bonusLabel = waveDurationSec < targetParSec
      ? `SPEED CLEAR! +${totalBonus} PTS ⚡ (${waveDurationSec}s)`
      : `WAVE CLEAR! +${totalBonus} PTS ✨ (${waveDurationSec}s)`;

    this.showScorePopup(this.player ? this.player.x : 400, (this.player ? this.player.y : 200) - 24, totalBonus, bonusLabel);

    sound.playCoin();
    confetti({ particleCount: 40, spread: 70, origin: { y: 0.6 } });
    this.announceWave(`✨ WAVE ${this.currentWaveIndex + 1} CLEARED! +${totalBonus} PTS (${waveDurationSec}s) ✨`);

    this.time.delayedCall(1500, () => {
      if (this.isGameOver) return;
      this.startWave(this.currentWaveIndex + 1);
    });
  }

  startEndless() {
    if (this.isGameOver) return;

    this.endlessMode = true;
    this.waveRemainingFoes = 0;
    this.wavePendingCount = 0;
    this.endlessWave = 1;
    this.maxConcurrentEnemies = 4;
    this.inFlightSpawns = 0;
    this.waveHpMul = GAME_CONFIG.SURVIVAL.ENDLESS_HP_MUL_BASE;
    this.updateWaveHud();

    this.announceWave('SURVIVAL RUSH!');

    // Endless mode periodic spawner: checks every 2 seconds if arena has open slots up to maxConcurrentEnemies
    this.endlessTimer = this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (this.isGameOver) return;
        const activeCount = this.enemies.getChildren().filter(e => e && e.active && e.state !== 'DEAD' && !e._killHandled).length;
        const openSlots = this.maxConcurrentEnemies - (activeCount + this.inFlightSpawns);
        if (openSlots <= 0) return;

        for (let i = 0; i < openSlots; i++) {
          const types = ['boar', 'snail', 'bee', 'mushroom', 'flying_eye', 'goblin'];
          if ((this.currentWaveIndex || 0) >= 2) types.push('bog_lurker');
          if ((this.currentWaveIndex || 0) >= 3) types.push('dread_bat');
          if ((this.currentWaveIndex || 0) >= 4) types.push('crypt_wraith');
          if ((this.currentWaveIndex || 0) >= 5) types.push('basalt_golem');
          if ((this.currentWaveIndex || 0) >= 6) types.push('void_stalker');

          const chosen = Phaser.Utils.Array.GetRandom(types);
          const spawnX = Math.random() < 0.5 ? 80 : 760;
          let spawnY = 280;
          if (chosen === 'bee' || chosen === 'flying_eye' || chosen === 'dread_bat' || chosen === 'crypt_wraith') spawnY = Phaser.Math.Between(80, 140);
          else if (chosen === 'mushroom' || chosen === 'goblin' || chosen === 'void_stalker') spawnY = Math.random() < 0.5 ? 150 : 210;

          this.inFlightSpawns++;
          this.showSpawnTelegraph(spawnX, spawnY);
          const t = this.time.delayedCall(450, () => {
            if (this.isGameOver) return;
            this.inFlightSpawns = Math.max(0, this.inFlightSpawns - 1);
            this.spawnEnemy(chosen, spawnX, spawnY, this.waveHpMul);
          });
          this.waveSpawnTimers.push(t);
        }
      }
    });
  }

  getWaveHpMul(index) {
    return 1 + index * GAME_CONFIG.SURVIVAL.HP_SCALE_PER_WAVE;
  }

  showScorePopup(x, y, pts, label = '') {
    const text = label ? `+${pts} ${label}` : `+${pts}`;
    const popup = this.add.text(x, y, text, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: label ? '#ffd700' : '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(220);

    this.tweens.add({
      targets: popup,
      y: y - 26,
      alpha: 0,
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => popup.destroy()
    });

    // Score HUD punch animation
    if (this.txtScore) {
      this.tweens.killTweensOf(this.txtScore);
      this.txtScore.setScale(1.25);
      this.txtScore.setTint(0xffd700);
      this.tweens.add({
        targets: this.txtScore,
        scale: 1.0,
        duration: 180,
        onComplete: () => this.txtScore.clearTint()
      });
    }
  }

  addKill(mobType, basePts, bonusPts = 0, hitX = null, hitY = null, label = '', enemy = null) {
    if (this.isGameOver) return 0;

    if (enemy) {
      if (enemy._killHandled) return 0;
      enemy._killHandled = true;
    }

    this.killCount[mobType] = (this.killCount[mobType] || 0) + 1;
    this.killCount.total++;

    this.comboCount++;
    this.currentComboMultiplier = Math.min(
      GAME_CONFIG.SURVIVAL.MAX_COMBO,
      1.0 + this.comboCount * GAME_CONFIG.SURVIVAL.COMBO_INCREMENT
    );

    const ptsEarned = Math.round((basePts + bonusPts) * this.currentComboMultiplier);
    this.totalScore += ptsEarned;
    this.txtScore.setText(`SCORE: ${this.totalScore}`);
    this.txtCombo.setText(`COMBO: ${this.currentComboMultiplier.toFixed(1)}x`);

    const popupX = hitX !== null ? hitX : (this.player ? this.player.x : 400);
    const popupY = hitY !== null ? hitY : (this.player ? this.player.y - 10 : 200);
    const comboTag = this.currentComboMultiplier > 1.0 ? `${this.currentComboMultiplier.toFixed(1)}x` : '';
    const fullLabel = [label, comboTag].filter(Boolean).join(' ');
    this.showScorePopup(popupX, popupY, ptsEarned, fullLabel);

    if (!this.endlessMode) {
      this.checkSpawnQueue();
    }

    // Shard drop (2 G$ each, paid after UTC midnight) - rare drops!
    if (this.shardDrops && enemy) {
      const isBoss = mobType === 'boss_gorgok';
      const eliteTypes = ['bog_lurker', 'dread_bat', 'crypt_wraith', 'basalt_golem', 'void_stalker', 'hornet_guard', 'skeleton_warrior', 'cinder_drake', 'astral_shade', 'mirelurker'];
      const isElite = eliteTypes.includes(mobType);
      const chance = isBoss ? 0.50 : (isElite ? 0.15 : 0.05);
      if (Math.random() < chance) {
        const crystal = new ShardDrop(this, popupX, popupY);
        this.shardDrops.add(crystal);
      }
    }

    return ptsEarned;
  }

  onCrateBroken(crate) {
    if (this.shardDrops && Math.random() < 0.05) {
      const crystal = new ShardDrop(this, crate.x, crate.y - 6);
      this.shardDrops.add(crystal);
    }
  }

  onShardCollected(crystal) {
    const wasCapped = this.isDailyHarvestCapped;
    this.sessionCrystalsCollected = (this.sessionCrystalsCollected || 0) + 1;
    this.checkDailyHarvestCap();
    if (!wasCapped && this.isDailyHarvestCapped && this.player) {
      juice.spawnFloatingText(
        this,
        this.player.x,
        this.player.y - 40,
        `DAILY SHARD CAP REACHED (${DAILY_SHARD_CAP_GD} G$)! 🔒`,
        '#f59e0b',
        18,
        2500
      );
    }
  }

  onEnemyShattered(enemy) {
    if (!enemy || enemy._killHandled) return;
    this.addKill('snail', GAME_CONFIG.MOBS.SNAIL.PTS * 1.5, 0, enemy.x, enemy.y - 12, 'SHATTER! 💥', enemy);
  }


  updateWaveHud() {
    if (this.txtWave) {
      const label = this.endlessMode
        ? `RUSH ${this.endlessWave || 1}`
        : `WAVE ${this.currentWaveIndex + 1}/${this.spec.waves.length}`;
      this.txtWave.setText(label);
    }
    if (this.txtFoes) {
      const count = this.waveRemainingFoes !== undefined ? this.waveRemainingFoes : this.wavePendingCount;
      this.txtFoes.setText(this.endlessMode ? 'FOES: ∞' : `FOES: ${count}`);
    }
  }

  spawnEnemy(type, x, y, hpMul = 1, options = {}) {
    let enemy;
    if (type === 'boar') {
      enemy = new Boar(this, x, y);
    } else if (type === 'snail') {
      enemy = new Snail(this, x, y);
    } else if (type === 'bee') {
      enemy = new Bee(this, x, y);
    } else if (type === 'mushroom') {
      enemy = new Mushroom(this, x, y);
    } else if (type === 'flying_eye') {
      enemy = new FlyingEye(this, x, y);
    } else if (type === 'goblin') {
      enemy = new Goblin(this, x, y);
    } else if (type === 'bog_lurker') {
      enemy = new BogLurker(this, x, y);
    } else if (type === 'dread_bat') {
      enemy = new DreadBat(this, x, y);
    } else if (type === 'crypt_wraith') {
      enemy = new CryptWraith(this, x, y);
    } else if (type === 'basalt_golem') {
      enemy = new BasaltGolem(this, x, y);
    } else if (type === 'void_stalker') {
      enemy = new VoidStalker(this, x, y);
    } else if (type === 'boss_gorgok') {
      if (!this.bossBar) {
        this.bossBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_GORGOK.NAME, GAME_CONFIG.MOBS.BOSS_GORGOK.HP);
        this.bossBar.y = 44;
      }
      enemy = new BossGorgok(this, x, y, this.bossBar);
    }

    if (enemy) {
      enemy.mobType = type;
      enemy.countsTowardWave = options.countsTowardWave !== false;
      if (hpMul !== 1) {
        enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
        enemy.maxHp = enemy.hp;
      }
      // Progressive wave speed boost (each wave enemies move slightly faster)
      const speedBoost = 1 + (this.currentWaveIndex || 0) * 0.05;
      if (enemy.walkSpeed) enemy.walkSpeed *= speedBoost;

      if (enemy.body) enemy.body.setCollideWorldBounds(true);
      this.enemies.add(enemy);

      // Spawn puff
      const spawnPuff = this.add.circle(x, y, 14, 0x88ee88, 0.75).setDepth(20);
      this.tweens.add({
        targets: spawnPuff,
        scale: 1.6,
        alpha: 0,
        duration: 350,
        onComplete: () => spawnPuff.destroy()
      });

      return enemy;
    }
    return null;
  }

  spawnMob(type, x, y) {
    return this.spawnEnemy(type, x, y, this.waveHpMul || 1, { countsTowardWave: false });
  }

  announceWave(title) {
    const w = GAME_CONFIG.WIDTH;
    const waveText = this.add.text(w / 2, 48, title, {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#f6c026',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(250);

    this.tweens.add({
      targets: waveText,
      scale: { from: 1.4, to: 1.0 },
      alpha: { from: 1, to: 0 },
      duration: 2200,
      onComplete: () => waveText.destroy()
    });
  }

  createSurvivalHUD() {
    const w = GAME_CONFIG.WIDTH;
    // One layout for every screen (ui/hudLayout.js): type sized for the screen, nothing overlapping, and the page's
    // wallet / timer / pause buttons kept just below the bar.
    const hud = layoutHud({ width: w, unit: cssPerUnitOf(this), variant: 'survival' });
    this.hudLayout = hud;
    useHudHeight(this, hud.barH);
    const { mode, score, wave, foes, harvest } = hud.slots;
    const label = (slot, text, color) => this.add.text(slot.x, slot.y, text, { ...hud.fonts.label, color })
      .setOrigin(slot.ox, 0.5).setScrollFactor(0).setDepth(201);
    const value = (slot, text, color) => this.add.text(slot.x, slot.y, text, { ...hud.fonts.value, color })
      .setOrigin(slot.ox, 0.5).setScrollFactor(0).setDepth(201);

    this.hudContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(200);

    const bar = this.add.rectangle(w / 2, hud.barH / 2, w, hud.barH, 0x0a140a, 0.9);
    bar.setStrokeStyle(1, 0x3d5c3d);
    this.hudContainer.add(bar);

    // Mode title
    label(mode, 'ENDLESS MODE', '#e9b213');

    // Score
    this.txtScore = label(score, 'SCORE: 0', '#ffffff');

    // Shard Harvest Counter
    this.txtHarvest = value(harvest, '💎 +0 G$', '#38e1ff');

    this.txtCombo = this.add.text(w / 2, hud.barH + 14, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#ffd700',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    // Hero Health Bar
    this.heroHealthBar = new HeroHealthBar(this, hud.health.x, hud.health.y, this.player ? this.player.maxHealth : GAME_CONFIG.PLAYER.MAX_HEALTH, hud.healthBar);

    // Wave progress
    this.txtWave = label(wave, 'WAVE 1/5', '#f6c026');
    this.txtFoes = value(foes, 'FOES: 0', '#d0f0c0');

    this.offscreenArrow = this.add.text(w / 2, hud.barH + 8, '▲ ENEMY ABOVE ▲', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#ffdd55',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setScrollFactor(0).setDepth(300).setVisible(false);
  }

  updateHearts() {
    if (!this.player) return;
    if (this.heroHealthBar) {
      this.heroHealthBar.updateHealth(this.player.health, this.player.maxHealth);
    }
  }

  checkDailyHarvestCap() {
    const st = this.rewardsStatus?.crystalStatus;
    const earned = Number(st?.gdEarned || 0);
    const cap = Number(st?.dailyCapGd ?? DAILY_SHARD_CAP_GD);
    const sessionEarned = (this.sessionCrystalsCollected || 0) * SHARD_RATE_GD;
    this.isDailyHarvestCapped = earned + sessionEarned >= cap || Boolean(st?.isCapped);
    this.updateCrystalHarvestHud();
  }

  updateCrystalHarvestHud() {
    if (!this.txtHarvest) return;
    const st = this.rewardsStatus?.crystalStatus;
    const cap = Number(st?.dailyCapGd ?? DAILY_SHARD_CAP_GD);
    const sessionEarned = (this.sessionCrystalsCollected || 0) * SHARD_RATE_GD;
    if (Number(st?.gdEarned || 0) + sessionEarned >= cap || st?.isCapped) {
      this.txtHarvest.setText(`💎 ${cap} G$ (MAX 🔒)`);
      this.txtHarvest.setColor('#f59e0b');
    } else {
      this.txtHarvest.setText(`💎 +${sessionEarned} G$`);
      this.txtHarvest.setColor('#ffd700');
    }
  }


  handlePlayerAttack(enemy) {
    if (!this.player.isAttacking || enemy.state === 'DEAD' || enemy._killHandled) return;

    // Direction check: ensure player is facing the enemy for horizontal attacks
    if (this.player.attackType !== 'upward') {
      const enemyCenterX = enemy.body ? enemy.body.center.x : enemy.x;
      if (!this.player.flipX && enemyCenterX < this.player.x) return;
      if (this.player.flipX && enemyCenterX > this.player.x) return;
    }

    const dmg = this.player.getAttackDamage();
    const isUpward = this.player.attackType === 'upward';
    const res = enemy.takeDamage(dmg, this.player.x, isUpward);

    if (res && res.killed && !enemy._killHandled) {
      const label = res.isBackstab ? 'CRIT!' : (res.isCounter ? 'COUNTER! 💥' : (res.shattered ? 'SHATTER! 💥' : (isUpward ? 'UP-SLASH!' : '')));
      const bonus = res.isBackstab ? 25 : (res.isCounter ? 20 : 0);
      this.addKill(enemy.mobType, res.pts, bonus, enemy.x, enemy.y - 12, label, enemy);
    }
  }

  handlePlayerHurt(enemy) {
    if (this.player.isDead || enemy.state === 'DEAD' || enemy.state === 'STUNNED') return;

    // --- UNIVERSAL STOMP BOUNCE DETECTION ---
    // If player is airborne, falling downward, and physically above the enemy:
    const isFalling = this.player.body && this.player.body.velocity.y > 20;
    const playerBottom = this.player.body ? this.player.body.bottom : this.player.y + 16;
    const enemyTop = enemy.body ? enemy.body.top : enemy.y - 14;
    const isAbove = playerBottom <= enemyTop + 20 || this.player.y < enemy.y - 4;

    if (isFalling && isAbove) {
      this.player.setVelocityY(-260);
      sound.playBoarChargeHit();
      sound.playRicochet();

      juice.spawnDamageNumber(this, enemy.x, enemy.y - 18, 35, 'stomp', '💥 STOMP! -35');
      juice.hitStopHeavy(this);

      if (enemy.mobType === 'snail') {
        if (enemy.state === 'WALK') {
          const res = enemy.takeDamage(35, this.player.x);
          if (res && res.killed) {
            this.addKill(enemy.mobType, res.pts, 25, enemy.x, enemy.y - 12, 'STOMP KILL! 👢', enemy);
          }
        } else if (enemy.state === 'SHELLED') {
          const kickDir = this.player.flipX ? -1 : 1;
          enemy.kickShell(kickDir);
        } else if (enemy.state === 'SLIDING') {
          const res = enemy.takeDamage(99, this.player.x);
          if (res && res.killed) {
            this.addKill(enemy.mobType, res.pts, 25, enemy.x, enemy.y - 12, 'STOMP KILL! 👢', enemy);
          }
        }
      } else if (enemy.mobType === 'boss_gorgok') {
        enemy.takeDamage(25, this.player.x);
      } else {
        const res = enemy.takeDamage(35, this.player.x);
        if (res && res.killed) {
          this.addKill(enemy.mobType, res.pts, 25, enemy.x, enemy.y - 12, 'STOMP KILL! 👢', enemy);
        }
      }
      return; // Successfully stomped: evade all player damage!
    }

    if (enemy.mobType === 'snail' && enemy.state === 'SHELLED') {
      const kickDir = this.player.x < enemy.x ? 1 : -1;
      enemy.kickShell(kickDir);
      return;
    }

    if (enemy.mobType === 'snail' && enemy.state === 'SLIDING') {
      const dirTowardsPlayer = (enemy.body.velocity.x > 0 && this.player.x > enemy.x) ||
                               (enemy.body.velocity.x < 0 && this.player.x < enemy.x);
      if (!dirTowardsPlayer) return;
    }

    // Boss Gorgok collision mechanics: ONLY damages player when actively CHARGING!
    if (enemy.mobType === 'boss_gorgok') {
      if (enemy.state !== 'CHARGE') {
        return;
      }

      // Direct charge impact: heavy damage, screen shake, and strong knockback in charge direction
      const knockDir = enemy.chargeDir || (enemy.x < this.player.x ? 1 : -1);
      const enemyDmg = enemy.damage || GAME_CONFIG.MOBS.BOSS_GORGOK?.DAMAGE || 30;
      const damaged = this.player.takeDamage(enemyDmg, knockDir);
      if (damaged) {
        this.comboCount = 0;
        this.currentComboMultiplier = 1.0;
        this.txtCombo.setText('COMBO: 1.0x');
        this.updateHearts();
        sound.playSlash(2);
        this.cameras.main.shake(180, 0.02);

        // Visual charge impact cue
        const impactText = this.add.text(this.player.x, this.player.y - 20, `💥 CHARGE HIT! -${enemyDmg}`, {
          fontFamily: 'Press Start 2P',
          fontSize: '7px',
          color: '#ff2222',
          stroke: '#000',
          strokeThickness: 2
        }).setOrigin(0.5);
        this.tweens.add({
          targets: impactText,
          y: this.player.y - 42,
          alpha: 0,
          duration: 650,
          onComplete: () => impactText.destroy()
        });

        if (this.player.isDead) {
          this.handleGameOver();
        }
      }
      return;
    }

    const knockDir = enemy.x < this.player.x ? 1 : -1;
    const enemyDmg = enemy.damage || (enemy.mobType && GAME_CONFIG.MOBS[enemy.mobType.toUpperCase()]?.DAMAGE) || 20;
    const damaged = this.player.takeDamage(enemyDmg, knockDir);
    if (damaged) {
      // Reset combo on hit
      this.comboCount = 0;
      this.currentComboMultiplier = 1.0;
      this.txtCombo.setText('COMBO: 1.0x');
      this.updateHearts();

      if (this.player.isDead) {
        this.handleGameOver();
      }
    }
  }

  handleGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    sound.stopBGM();
    sound.playGameOver();
    pauseService.hideButtons();

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Final score formula: (Kills * Mob Value) + (Seconds Survived * 10) + Hit Combo Multiplier
    const timeBonus = this.secondsSurvived * GAME_CONFIG.SURVIVAL.PTS_PER_SECOND;
    this.totalScore += timeBonus;

    const runData = {
      seed: this.dayKey,
      duration: this.secondsSurvived,
      durationMs: Math.round(this.activeClock.ms),
      kills: this.killCount.total,
      // What is submitted, and what the result screen describes: a shard picked up after this point is not part of the run.
      shards: this.sessionCrystalsCollected || 0,
      score: this.totalScore,
      timestamp: Date.now()
    };

    // The result screen opens at once and never waits for the server: it says "Submitting run..." and fills in what the
    // server answered once finish() resolves. Whatever the submit does, the player has a screen with a way out.
    let proof;
    try {
      proof = this.beginRunProof(runData);
    } catch (err) {
      console.warn('[survival] could not prepare the run proof', err?.message);
      proof = { label: 'Run Not Recorded', verified: false, offline: false, notConnected: false, shards: runData.shards, signature: 'RUN-UNSAVED', result: undefined, slow: false };
      this.runProof = proof;
    }
    this.showGameOverModal(proof);
    this.settleRunProof(runData, proof);
  }

  /** The proof the result screen starts from: what is known before the server has answered. */
  beginRunProof(runData) {
    const status = gdService.getStatus();
    const proof = {
      verified: false,
      signature: `RUN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 8999 + 1000)}`,
      offline: false,
      notConnected: !status.connected,
      shards: runData.shards,
      result: undefined,
      slow: false,
    };
    this.runProof = proof;
    this.describeProof(proof, status);
    this.recordTrial(runData, proof);
    return proof;
  }

  describeProof(proof, status = gdService.getStatus()) {
    proof.label = survivalLabel({ connected: status.connected, verified: status.verified, result: proof.result, slow: proof.slow, sessionExpired: status.sessionExpired });
  }

  /** Settle the run with the server and bring the result screen and the local record up to date. Never throws. */
  async settleRunProof(runData, proof) {
    try {
      if (!gdService.getStatus().connected) {
        runs.stop(); // this run has no ticket to settle
        return;
      }
      // finish() can take a while on a slow API (checkpoint, submit and one retry of each). Say so rather than
      // guessing: the run is usually still being recorded, and calling it "offline" would be wrong.
      const slowTimer = setTimeout(() => {
        proof.slow = true;
        this.describeProof(proof);
        this.refreshGameOverModal(proof);
      }, SLOW_SUBMIT_MS);
      let result;
      try {
        result = await runs.finish({
          score: runData.score,
          kills: runData.kills,
          shards: runData.shards,
          durationMs: runData.durationMs,
        });
      } finally {
        clearTimeout(slowTimer);
      }
      proof.slow = false;
      proof.result = result;
      proof.offline = result.reason === 'offline' || result.status === 0;
      if (result.rankedOk) {
        proof.verified = true;
        proof.rank = result.rank?.ranked;
        proof.isNewBest = result.isNewBest;
      } else if (result.rank) {
        proof.rank = result.rank.open;
      }
      this.describeProof(proof);
      this.recordTrial(runData, proof);
    } catch (err) {
      // finish() does not reject; this is a bug on our side. The player still gets an honest, final screen.
      console.warn('[survival] could not settle the run', err?.message);
      proof.slow = false;
      proof.result = proof.result ?? { ticketed: true, error: 'submit_failed', reason: 'server_error' };
      proof.label = 'Run Not Recorded';
    }
    this.refreshGameOverModal(proof);
  }

  /** Keep the local copy of the day's best trial; its status is updated in place once the server has answered. */
  recordTrial(runData, proof) {
    const details = () => ({
      ...runData,
      proofId: proof.signature,
      verified: proof.verified,
      rank: proof.rank || null,
      status: proof.label,
    });
    try {
      storage.recordDailyTrial(this.dayKey, runData.score, details());
      // recordDailyTrial keeps the first record of a score, so a later status has to be written over it.
      const stored = storage.getDailyRecord(this.dayKey);
      if (stored?.details?.proofId === proof.signature) {
        stored.details = details();
        storage.save();
      }
    } catch (err) {
      console.warn('[survival] could not save the local record', err?.message);
    }
  }

  gameOverDetailsText(proof) {
    let crystalLine = '';
    try {
      if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
        crystalLine = `🔒 Daily Shard Cap Reached (${DAILY_SHARD_CAP_GD} G$ Max) • Resets 00:00 UTC`;
      } else {
        const st = gdService.getStatus();
        const shards = shardsLine({
          shards: proof.shards,
          rateG: SHARD_RATE_GD,
          connected: st.connected,
          verified: st.verified,
          result: proof.result,
          sessionExpired: st.sessionExpired,
        });
        crystalLine = `${shards.icon} ${shards.text}`;
      }
    } catch (err) {
      console.warn('[survival] could not describe the Shard Harvest', err?.message); // the rest of the screen still matters
    }
    return [
      `Time Survived: ${this.secondsSurvived}s (+${this.secondsSurvived * GAME_CONFIG.SURVIVAL.PTS_PER_SECOND} pts)`,
      `Kills: 🐗${this.killCount.boar || 0} 🐌${this.killCount.snail || 0} 🐝${this.killCount.bee || 0} 🍄${this.killCount.mushroom || 0} 👁️${this.killCount.flying_eye || 0} 👺${this.killCount.goblin || 0}`,
      crystalLine,
      `${proof.label}`
    ].join('\n');
  }

  /** Redraw the result text when the server's answer arrives. Does nothing if that screen is gone or a newer run replaced it. */
  refreshGameOverModal(proof) {
    const text = this.gameOverDetails;
    if (this.runProof !== proof || !text || !text.active) return;
    try {
      text.setText(this.gameOverDetailsText(proof));
    } catch (err) {
      console.warn('[survival] could not update the result screen', err?.message);
    }
  }

  showGameOverModal(proof) {
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    // Full screen backdrop overlay to capture clicks and dim the arena
    const backdrop = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(490)
      .setInteractive();

    // Modal Card Frame
    const box = this.add.rectangle(w / 2, h / 2, 400, 206, 0x121c12, 0.98)
      .setStrokeStyle(2, 0xe9b213)
      .setScrollFactor(0)
      .setDepth(500);

    const title = this.add.text(w / 2, h / 2 - 76, 'ENDLESS RUN LOCKED IN', {
      fontFamily: 'Press Start 2P',
      fontSize: '10px',
      color: '#f6c026'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    const scoreDisplay = this.add.text(w / 2, h / 2 - 54, `FINAL SCORE: ${this.totalScore}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    // Kept so the result line can be redrawn when the server's answer arrives (see refreshGameOverModal).
    this.gameOverDetails = this.add.text(w / 2, h / 2 - 14, this.gameOverDetailsText(proof), {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#a0c4a0',
      lineSpacing: 5,
      align: 'center',
      wordWrap: { width: 376 } // a long reason or server code wraps inside the card instead of running off it
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);


    // Navigation callbacks with listener cleanup
    let modalClosed = false;
    const cleanup = () => {
      if (modalClosed) return;
      modalClosed = true;
      this.input.keyboard.off('keydown', onKeyDown);
      this.input.off('pointerdown', onScenePointerDown);
      if (this.game && this.game.canvas) {
        this.game.canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      }
    };

    const goRetry = () => {
      cleanup();
      sound.playCoin();
      this.scene.restart();
    };

    const goLeaderboard = () => {
      cleanup();
      sound.playCoin();
      this.scene.start('LeaderboardScene', { lastScore: this.totalScore });
    };

    const goMenu = () => {
      cleanup();
      sound.playCoin();
      this.scene.start('MenuScene');
    };

    const onKeyDown = (event) => {
      if (modalClosed) return;
      const key = (event.key || '').toUpperCase();
      if (key === 'R' || key === ' ') {
        goRetry();
      } else if (key === 'L') {
        goLeaderboard();
      } else if (key === 'ESCAPE' || key === 'M' || key === 'ENTER') {
        goMenu();
      }
    };
    this.input.keyboard.on('keydown', onKeyDown);

    // Button builder helper
    const createBtn = (bx, by, bw, bh, bgCol, borderCol, textCol, label, action) => {
      const rect = this.add.rectangle(bx, by, bw, bh, bgCol)
        .setStrokeStyle(1, borderCol)
        .setScrollFactor(0)
        .setDepth(502)
        .setInteractive({ useHandCursor: true });

      const txt = this.add.text(bx, by, label, {
        fontFamily: 'Press Start 2P',
        fontSize: '6px',
        color: textCol
      }).setOrigin(0.5).setScrollFactor(0).setDepth(503).setInteractive({ useHandCursor: true });

      const setHover = (hover) => {
        const s = hover ? 1.05 : 1.0;
        rect.setScale(s);
        txt.setScale(s);
      };

      rect.on('pointerover', () => setHover(true));
      txt.on('pointerover', () => setHover(true));
      rect.on('pointerout', () => setHover(false));
      txt.on('pointerout', () => setHover(false));

      rect.on('pointerdown', action);
      txt.on('pointerdown', action);

      return { rect, txt };
    };

    const btnY = h / 2 + 65;
    // RETRY
    const retryBtn = createBtn(w / 2 - 124, btnY, 108, 26, 0x163816, 0x4ade80, '#4ade80', 'RETRY', goRetry);
    // LEADERBOARD
    const lbBtn = createBtn(w / 2, btnY, 124, 26, 0x15283c, 0x38bdf8, '#38bdf8', 'LEADERBOARD', goLeaderboard);
    // MAIN MENU
    const menuBtn = createBtn(w / 2 + 124, btnY, 108, 26, 0x382414, 0xf59e0b, '#f59e0b', 'MAIN MENU', goMenu);

    this.modalButtons = {
      retry: retryBtn,
      leaderboard: lbBtn,
      menu: menuBtn
    };

    const buttons = [
      { minX: (w / 2 - 124) - 54, maxX: (w / 2 - 124) + 54, minY: btnY - 13, maxY: btnY + 13, action: goRetry },
      { minX: (w / 2) - 62, maxX: (w / 2) + 62, minY: btnY - 13, maxY: btnY + 13, action: goLeaderboard },
      { minX: (w / 2 + 124) - 54, maxX: (w / 2 + 124) + 54, minY: btnY - 13, maxY: btnY + 13, action: goMenu }
    ];

    const onScenePointerDown = (pointer) => {
      if (modalClosed) return;
      const px = pointer.x;
      const py = pointer.y;
      for (const b of buttons) {
        if (px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY) {
          b.action();
          return;
        }
      }
    };
    this.input.on('pointerdown', onScenePointerDown);

    const onCanvasPointerDown = (e) => {
      if (modalClosed) return;
      if (!this.game || !this.game.canvas) return;
      const rect = this.game.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * w;
      const py = ((e.clientY - rect.top) / rect.height) * h;
      for (const b of buttons) {
        if (px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY) {
          b.action();
          return;
        }
      }
    };
    if (this.game && this.game.canvas) {
      this.game.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    }
  }

  update(_time, delta) {
    if (this.isGameOver) return;

    // Survival timer: only frames that are played count. Pausing stops physics but this method keeps running behind
    // the pause screen, and a hidden tab can resume with a huge wall-clock gap, so neither may add time.
    this.activeClock.tick(delta, { paused: pauseService.isPaused, hidden: pageHidden() });
    const elapsedSec = this.activeClock.seconds;
    if (elapsedSec !== this.secondsSurvived) {
      this.secondsSurvived = elapsedSec;
      pauseService.updateTimer(this.secondsSurvived);
    }

    // The survival time bonus is only added to totalScore at game over, so include it live; otherwise the
    // closing checkpoint of a very long run would carry the whole bonus in one window and trip the server's rate check.
    runs.update({
      score: this.totalScore + this.secondsSurvived * GAME_CONFIG.SURVIVAL.PTS_PER_SECOND,
      kills: this.killCount.total,
      shards: this.sessionCrystalsCollected || 0,
    });

    const touchInputs = window.touchController ? {
      ...window.touchController.state,
      ...window.touchController.consumeTriggers()
    } : {};

    if (this.player) {
      this.player.update(this.cursors, touchInputs);
    }

    const camScrollX = this.cameras.main.scrollX;
    if (this.bgMountains) this.bgMountains.tilePositionX = camScrollX * 0.05;
    if (this.bgFogPines) this.bgFogPines.tilePositionX = camScrollX * 0.12;
    if (this.bgMidPines) this.bgMidPines.tilePositionX = camScrollX * 0.22;

    // Heartbeat check for spawn queue every 400ms
    if (!this.nextSpawnQueueCheck || performance.now() > this.nextSpawnQueueCheck) {
      this.nextSpawnQueueCheck = performance.now() + 400;
      this.checkSpawnQueue();
    }

    // Directional indicator for truly off-screen enemies
    const cam = this.cameras.main;
    const offscreenEnemy = this.enemies.getChildren().find(e => {
      if (!e || !e.active || e.state === 'DEAD' || e._killHandled) return false;
      const isVisible = (e.x >= cam.worldView.x && e.x <= cam.worldView.right && e.y >= cam.worldView.y + 32 && e.y <= cam.worldView.bottom);
      return !isVisible;
    });

    if (offscreenEnemy && this.offscreenArrow) {
      const mobName = offscreenEnemy.mobType.toUpperCase();
      const isLeft = offscreenEnemy.x < cam.worldView.x;
      const isRight = offscreenEnemy.x > cam.worldView.right;
      const isAbove = offscreenEnemy.y < cam.worldView.y + 32;
      const isBelow = offscreenEnemy.y > cam.worldView.bottom;

      if (isLeft) {
        // Offscreen to the left
        this.offscreenArrow.setX(54);
        this.offscreenArrow.setY((this.hudLayout?.barH ?? 28) + 10);
        this.offscreenArrow.setText(`◄ ${mobName}`);
        this.offscreenArrow.setVisible(true);
      } else if (isRight) {
        // Offscreen to the right
        this.offscreenArrow.setX(GAME_CONFIG.WIDTH - 54);
        this.offscreenArrow.setY((this.hudLayout?.barH ?? 28) + 10);
        this.offscreenArrow.setText(`${mobName} ►`);
        this.offscreenArrow.setVisible(true);
      } else if (isAbove) {
        // Offscreen strictly above
        const screenX = Phaser.Math.Clamp(offscreenEnemy.x - cam.worldView.x, 60, GAME_CONFIG.WIDTH - 60);
        this.offscreenArrow.setX(screenX);
        this.offscreenArrow.setY(34);
        this.offscreenArrow.setText(`▲ ${mobName} ▲`);
        this.offscreenArrow.setVisible(true);
      } else if (isBelow) {
        // Offscreen strictly below
        const screenX = Phaser.Math.Clamp(offscreenEnemy.x - cam.worldView.x, 60, GAME_CONFIG.WIDTH - 60);
        this.offscreenArrow.setX(screenX);
        this.offscreenArrow.setY(GAME_CONFIG.HEIGHT - 22);
        this.offscreenArrow.setText(`▼ ${mobName} ▼`);
        this.offscreenArrow.setVisible(true);
      } else {
        this.offscreenArrow.setVisible(false);
      }
    } else if (this.offscreenArrow) {
      this.offscreenArrow.setVisible(false);
    }

    this.enemies.getChildren().forEach(e => {
      if (e && e.active && e.state !== 'DEAD') {
        this.keepFlyerInCombat(e);

        if (e.y > 330 && e.mobType !== 'bee' && e.mobType !== 'flying_eye') {
          e.y = 308;
          e.setVelocityY(0);
        }
        // Active pursuit descend: If player is on the ground floor, steer perched enemies towards player X so they drop down
        if (this.player && this.player.y > 280 && e.y < 260 && e.mobType !== 'bee' && e.mobType !== 'flying_eye') {
          const dxToPlayer = this.player.x - e.x;
          if (Math.abs(dxToPlayer) > 20) {
            e.patrolDir = dxToPlayer > 0 ? 1 : -1;
          }
        }
        e.update(this.player);
      }
    });

    // Fall out of bounds check
    if (this.player && this.player.y > this.arenaHeight + 20) {
      this.player.die();
      this.updateHearts();
      this.handleGameOver();
    }
  }

  showFloatingText(x, y, text, color = '#ffffff') {
    const txt = this.add.text(x, y, text, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: color,
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(250);

    txt.setScale(1.25);
    this.tweens.add({
      targets: txt,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 130,
      ease: 'Back.easeOut'
    });

    this.tweens.add({
      targets: txt,
      y: y - 26,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy()
    });
  }
}

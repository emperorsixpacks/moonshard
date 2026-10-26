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
import Mirelurker from '../entities/Mirelurker.js';
import HornetGuard from '../entities/HornetGuard.js';
import SkeletonWarrior from '../entities/SkeletonWarrior.js';
import CinderDrake from '../entities/CinderDrake.js';
import AstralShade from '../entities/AstralShade.js';
import Projectile from '../entities/Projectile.js';
import BossHealthBar from '../ui/BossHealthBar.js';
import HeroHealthBar from '../ui/HeroHealthBar.js';
import Crate from '../entities/Crate.js';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { getTodaySeedString, generateDailySurvivalSpec } from '../engine/PRNG.js';
import { BEASTS, bladeGoal, levelClearBonus, levelMaterials, levelPlan } from '../engine/levels.js';
import { baneMul, gearStrip } from '../engine/gear.js';
import { GRADE_ALPHA_MAX, PLATFORM_TEXTURES, WOODS_LOOK, platformLift, sceneSwap } from '../engine/scenery.js';
import EndlessWeather from '../engine/EndlessWeather.js';
import { pauseService } from '../engine/PauseService.js';
import { gdService } from '../engine/GdService.js';
import { startIsBlocked } from '../engine/playGate.js';
import { layoutHud } from '../ui/hudLayout.js';
import { cssPerUnitOf } from '../engine/uiScale.js';
import { useHudHeight } from '../engine/HudAnchor.js';
import { fillUnderground } from '../engine/underground.js';
import { juice } from '../engine/JuiceEffects.js';
import confetti from 'canvas-confetti';
import ShardDrop from '../entities/ShardDrop.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { runs, shardsLine, survivalLabel } from '../gd/runs.js';
import { ActiveClock, pageHidden } from '../gd/activeClock.js';
import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';

// After this long without an answer from the server the result screen says the run is still being submitted.
const SLOW_SUBMIT_MS = 20_000;

// What builds each foe a level can bring (engine/levels.js BEASTS names the same types); the boss is built in spawnEnemy.
const BEAST_CLASSES = {
  boar: Boar, snail: Snail, bee: Bee, mushroom: Mushroom, flying_eye: FlyingEye, goblin: Goblin,
  bog_lurker: BogLurker, dread_bat: DreadBat, crypt_wraith: CryptWraith, basalt_golem: BasaltGolem, void_stalker: VoidStalker,
  mirelurker: Mirelurker, hornet_guard: HornetGuard, skeleton_warrior: SkeletonWarrior, cinder_drake: CinderDrake, astral_shade: AstralShade,
};

/** A beast's name for a banner or an arrow: "HORNET GUARD". */
const beastName = (type) => (BEASTS[type]?.name ?? String(type).replace(/_/g, ' ')).toUpperCase();


export default class SurvivalScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SurvivalScene' });
  }

  init() {
    // held upright, a run takes the whole screen (engine/playStage.js); the size is set before create() reads it
    window.viewportManager?.enterPlay(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.viewportManager?.leavePlay(this));
  }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.arenaWidth = 840;
    // the arena is built 440 tall; a taller picture (a phone held upright) shows more earth under the ground, and on a
    // short screen the picture is scrolled down by `camTop` so the ground rises clear of the pad (engine/playStage.js)
    this.camTop = window.viewportManager?.playOwner === this ? (window.viewportManager.playLift || 0) : 0;
    this.arenaHeight = Math.max(440, h + this.camTop);

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
    // Shards are the Shard Harvest's, a prize: they drop only while the server pays prizes (PRIZES_ENABLED)
    this.prizesOn = gdService.getStatus().prizes === true;
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
    this.cameras.main.setBounds(0, this.camTop, this.arenaWidth, this.arenaHeight - this.camTop);
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
      const damaged = this.player.takeDamage(proj.damage || 15, knockDir, 'ranged'); // what a foe threw: the shield's
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
    this.cursors.keys = this.input.keyboard.addKeys('W,A,S,D,J,K,X,E,ENTER,ESC');

    // HUD
    this.createSurvivalHUD();

    // Start level progression (kill-gated with concurrency cap)
    this.level = 1;
    this.plan = null;
    this.realmKey = null;
    this.wavePendingCount = 0;
    this.waveRemainingFoes = 0;
    this.waveSpawnQueue = [];
    this.maxConcurrentEnemies = 2;
    this.inFlightSpawns = 0;
    this.pendingWaveSpawns = [];
    this.waveHpMul = 1;
    this.waveSpeedMul = 1;
    this.waveStartTime = this.activeClock.ms;
    this.waveSpawnTimers = [];
    this.modalButtons = null;
    this.player.body.setCollideWorldBounds(true);
    this.startLevel(1);
  }

  createArenaForestBackground() {
    const w = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;

    // 1. Sky
    this.bgSky = this.add.tileSprite(0, 0, w, h, 'sky_backdrop').setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    if (h > 270) this.bgSky.tileScaleY = h / 270;

    // 2. Mountains
    // (the hills and trees are drawn for the arena's 440; more height than that is sky)
    const hb = Math.min(h, GAME_CONFIG.PORTRAIT_HEIGHT || 440);
    this.bgMountains = this.add.tileSprite(0, 20, w, Math.max(200, hb - 20), 'sky_mountains').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    if (hb > 270) this.bgMountains.tileScaleY = Math.max(1, (hb - 20) / 250);

    // 3. Fog pines
    this.bgFogPines = this.add.tileSprite(0, 50, w, Math.max(220, hb - 50), 'forest_bg_p0').setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    if (hb > 270) this.bgFogPines.tileScaleY = Math.max(1, (hb - 50) / 206);

    // 4. Midground pines
    this.bgMidPines = this.add.tileSprite(0, 80, w, Math.max(220, hb - 80), 'forest_bg_p1').setOrigin(0, 0).setScrollFactor(0).setDepth(3);
    if (hb > 270) this.bgMidPines.tileScaleY = Math.max(1, (hb - 80) / 176);

    // 5. Tall Forest Pines in Arena
    const treePositions = [
      { x: 70, scale: 1.1, type: 'pine_green' },
      { x: 200, scale: 0.95, type: 'pine_dark' },
      { x: 360, scale: 1.05, type: 'pine_golden' },
      { x: 500, scale: 0.9, type: 'pine_dark' },
      { x: 650, scale: 1.1, type: 'pine_green' },
      { x: 770, scale: 1.0, type: 'pine_golden' },
    ];

    // (kept, so a realm can dress them: applyRealm)
    this.bgTrees = treePositions.map(t => {
      const tree = this.add.image(t.x, 326, t.type)
        .setOrigin(0.5, 1.0)
        .setScale(t.scale)
        .setDepth(4);
      tree.woodsKey = t.type;

      this.tweens.add({
        targets: tree,
        angle: { from: -0.8, to: 0.8 },
        duration: 2600 + Math.random() * 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      return tree;
    });

    // 6. Bushes
    this.bgBushes = [100, 260, 420, 580, 720].map(bx => (
      this.add.image(bx, 322, 'bush_green').setOrigin(0.5, 1.0).setDepth(5).setScale(0.8)
    ));

    // 7. Ambient particles
    this.createArenaForestParticles();

    // 8. What a level's scene (engine/scenery.js) adds: the colour of the hour over the world (under the foes, the hero and the
    // weather, so they stay clear), the weather in the air, and the curtain that hides one scene turning into the next
    this.bgGrade = this.add.rectangle(0, 0, w, h, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(14).setAlpha(0).setVisible(false);
    this.weather = new EndlessWeather(this);
    this.curtain = this.add.rectangle(0, 0, w, h, 0x070b18, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(160).setAlpha(0);
    this.events.once('shutdown', () => this.weather.destroy());
    this.arenaScene = null;
    this.platformKey = PLATFORM_TEXTURES.woods;
    this.groundTint = WOODS_LOOK.ground;
    this.raised = [];
  }

  createArenaForestParticles(tint = WOODS_LOOK.mote) {
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
      tint,
      blendMode: 'ADD'
    }).setDepth(15);
  }

  /**
   * Dress the arena for a level's scene (engine/scenery.js sceneFor): its sky, whether the forest hills show, the trees and
   * bushes, the platforms, the tint over them and over the earth, the grade over the whole picture, the motes in the air and the
   * weather. It is all put on at once (startLevel and the tests read the result); the look of it arriving is the curtain's.
   */
  applyScene(scene) {
    const { look } = scene;
    const change = sceneSwap(this.arenaScene, scene);
    this.arenaScene = scene;

    if (change.pictures) {
      this.bgSky.setTexture(look.sky);
      for (const layer of [this.bgMountains, this.bgFogPines, this.bgMidPines]) layer.setVisible(look.hills);
      this.bgTrees.forEach((tree, i) => {
        const own = look.trees === null;
        tree.setVisible(own || look.trees.length > 0);
        if (own) tree.setTexture(tree.woodsKey);
        else if (look.trees.length > 0) tree.setTexture(look.trees[i % look.trees.length]);
      });
      this.bgBushes.forEach((bush) => bush.setVisible(look.bush !== null).setTexture(look.bush ?? WOODS_LOOK.bush));
      this.platformKey = look.platform;
      this.raised.forEach((platform) => this.drawPlatform(platform));
    }

    if (change.colours) {
      const tint = look.tint ?? 0xffffff;
      this.bgSky.setTint(look.skyTint ?? 0xffffff);
      for (const layer of [this.bgMountains, this.bgFogPines, this.bgMidPines, ...this.bgTrees, ...this.bgBushes]) layer.setTint(tint);
      // the earth, what grows on it and the platforms (buildSeededArena makes them from these textures)
      this.groundTint = look.ground;
      for (const piece of this.children.list) {
        if (/^(tile_cliff_|prop_(shroom|flower|fern)|plat_)/.test(piece.texture?.key ?? '')) piece.setTint(look.ground);
      }
      this.particles?.destroy();
      this.createArenaForestParticles(look.mote);
      this.applyGrade(scene.grade);
    }

    this.weather.set(scene.weather);
  }

  /** The colour laid over the world: still, or, for a boss's scene, breathing. */
  applyGrade({ color, alpha, pulse }) {
    this.gradeBreath?.stop();
    this.gradeBreath = null;
    this.bgGrade.setFillStyle(color, 1).setAlpha(alpha).setVisible(alpha > 0 || pulse > 0);
    if (pulse > 0) {
      this.gradeBreath = this.tweens.add({
        targets: this.bgGrade,
        alpha: { from: Math.max(0, alpha - pulse), to: Math.min(GRADE_ALPHA_MAX, alpha + pulse) },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /**
   * Draw a raised platform from the scene's platform picture: 48-wide tiles end to end, or a branch (75 wide) spread so that it
   * ends where the platform does (the collider is the platform's own width, whatever it is drawn with).
   */
  drawPlatform(platform) {
    platform.pieces.forEach((piece) => piece.destroy());
    const key = this.platformKey;
    const { width: tileW, height: tileH } = this.textures.getFrame(key);
    const count = Math.max(1, Math.round(platform.width / tileW));
    const each = platform.width / count;
    platform.pieces = Array.from({ length: count }, (_, i) => (
      this.add.image(platform.x + i * each, platform.y + platformLift(key), key)
        .setOrigin(0, 0).setDisplaySize(each, tileH).setDepth(10).setTint(this.groundTint)
    ));
  }

  /** Draw the curtain over the arena (not over the HUD): the scene changes behind it. */
  curtainDown(ms = 480) {
    this.tweens.killTweensOf(this.curtain);
    this.tweens.add({ targets: this.curtain, alpha: 0.96, duration: ms, ease: 'Sine.easeIn' });
  }

  curtainUp(ms = 650) {
    this.tweens.killTweensOf(this.curtain);
    this.tweens.add({ targets: this.curtain, alpha: 0, duration: ms, ease: 'Sine.easeOut' });
  }

  onViewportResize(w, h) {
    const hb = Math.min(h, GAME_CONFIG.PORTRAIT_HEIGHT || 440);
    if (this.bgSky) {
      this.bgSky.setSize(w, h);
      this.bgSky.tileScaleY = h > 270 ? h / 270 : 1;
    }
    if (this.bgMountains) {
      this.bgMountains.setSize(w, Math.max(200, hb - 20));
      this.bgMountains.tileScaleY = hb > 270 ? Math.max(1, (hb - 20) / 250) : 1;
    }
    if (this.bgFogPines) {
      this.bgFogPines.setSize(w, Math.max(220, hb - 50));
      this.bgFogPines.tileScaleY = hb > 270 ? Math.max(1, (hb - 50) / 206) : 1;
    }
    if (this.bgMidPines) {
      this.bgMidPines.setSize(w, Math.max(220, hb - 80));
      this.bgMidPines.tileScaleY = hb > 270 ? Math.max(1, (hb - 80) / 176) : 1;
    }
    if (this.bgGrade) this.bgGrade.setSize(w, h);
    if (this.curtain) this.curtain.setSize(w, h);
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
    this.weather?.resize();
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
        const bodyBottom = Math.max(topY + 50, 440 + 20); // the arena's own 440, as it was before the taller picture
        for (let i = 0; i < numTiles; i++) {
          const tileX = startX + i * 16;
          let topKey = (i % 3 === 0) ? 'tile_cliff_top_mid2' : 'tile_cliff_top_mid1';
          if (i === 0) topKey = 'tile_cliff_top_left';
          else if (i === numTiles - 1) topKey = 'tile_cliff_top_right';

          this.add.image(tileX, topY - 10, topKey).setOrigin(0, 0).setDepth(depth);

          for (let cy = topY + 6; cy <= bodyBottom; cy += 16) {
            this.add.image(tileX, cy, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(depth - 1);
          }
        }
        // the arena is 440 tall; a taller picture shows more earth, as one tiled sprite rather than a tile each
        fillUnderground(this, { x: startX, top: topY + 6 + 16 * (Math.floor((bodyBottom - (topY + 6)) / 16) + 1), width: numTiles * 16, bottom: this.arenaHeight + 20 });

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
        // Raised platforms: timber, until a scene brings another picture (applyScene)
        const raised = { x: startX, y: topY, width: actualWidth, pieces: [] };
        this.raised.push(raised);
        this.drawPlatform(raised);
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
    proj.launch(vx, vy);
    return proj;
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

  /** Begin level n of Endless (engine/levels.js): its foes, how tough and how fast they are, how many are in the arena at once. */
  startLevel(n) {
    if (this.isGameOver) return;
    this.isWaveTransitioning = false;

    const plan = levelPlan(n);
    this.plan = plan;
    this.level = plan.level;
    storage.recordBestLevel(plan.level);
    this.waveHpMul = plan.hpMul;
    this.waveSpeedMul = plan.speedMul;
    this.waveSpawnQueue = [...plan.spawns];
    this.waveRemainingFoes = plan.foes;
    this.wavePendingCount = plan.foes;
    this.maxConcurrentEnemies = plan.maxConcurrent;
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
    this.emptyArenaSince = null;
    this.updateWaveHud();

    // Every level has a scene of its own (engine/scenery.js): put on at once, and shown from behind the curtain when one is down
    this.realmKey = plan.realm;
    this.sceneKey = plan.scene.key;
    this.applyScene(plan.scene);
    if (this.curtain.alpha > 0) this.curtainUp();

    // Replenish supply crates at each level so player can find healing!
    this.spawnCrates();

    this.announceLevel(plan);

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
    if (this.isWaveTransitioning) return false;

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
      this.levelCleared();
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
    if (this.isGameOver || this.isWaveTransitioning) return;

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
      this.levelCleared();
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
        this.spawnEnemy(spawn.type, spawn.x, spawn.y, this.waveHpMul, { variant: spawn.variant });
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

  /** Every foe of the level is down: pay the clear bonus and the level's forest materials, then begin the next one. */
  levelCleared() {
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
    this.dismissSummons();

    // Clear bonus, with a speed bonus for finishing under the level's par time (engine/levels.js)
    const levelDurationSec = Math.max(1, Math.floor((this.activeClock.ms - this.waveStartTime) / 1000));
    const clear = levelClearBonus(this.level, levelDurationSec);
    this.totalScore += clear.total;
    this.txtScore.setText(`SCORE: ${this.totalScore}`);

    const bonusLabel = clear.fast
      ? `SPEED CLEAR! +${clear.total} PTS ⚡ (${levelDurationSec}s)`
      : `LEVEL CLEAR! +${clear.total} PTS ✨ (${levelDurationSec}s)`;

    const px = this.player ? this.player.x : 400;
    const py = this.player ? this.player.y : 200;
    this.showScorePopup(px, py - 24, clear.total, bonusLabel);

    // The level's forest materials (the Citizen's Blessing adds to them: what the inventory gained is what the popup says)
    const before = { ...storage.getMaterials() };
    storage.addMaterials(levelMaterials(this.level));
    const gained = Object.fromEntries(Object.keys(before).map((k) => [k, storage.getMaterials()[k] - before[k]]));
    const found = [['bark', '🌲'], ['amber', '🍯'], ['iron', '⚙️']].filter(([k]) => gained[k] > 0).map(([k, icon]) => `+${gained[k]}${icon}`).join(' ');
    if (found) this.showFloatingText(px, py - 48, found, '#98ff20');

    sound.playCoin();
    confetti({ particleCount: 40, spread: 70, origin: { y: 0.6 } });
    this.announceWave(`✨ LEVEL ${this.level} CLEARED! +${clear.total} PTS (${levelDurationSec}s) ✨`);

    // The next level's scene goes on under a dip of the curtain: down over the last 650 ms (all the way down well before the swap,
    // so a slow frame cannot show the scene changing under a curtain half drawn), up as the level begins
    const next = sceneSwap(this.arenaScene, levelPlan(this.level + 1).scene);
    if (next.pictures || next.colours) this.time.delayedCall(850, () => { if (!this.isGameOver) this.curtainDown(); });
    this.time.delayedCall(1500, () => {
      if (this.isGameOver) return;
      this.startLevel(this.level + 1);
    });
  }

  /** What a boss called to help (`countsTowardWave` false) does not outlast the level: it fades with the last foe that counts. */
  dismissSummons() {
    this.getLivingWaveEnemies().filter(e => e.countsTowardWave === false).forEach(e => {
      const puff = this.add.circle(e.x, e.y, 14, 0x88ee88, 0.75).setDepth(20);
      this.tweens.add({ targets: puff, scale: 1.6, alpha: 0, duration: 350, onComplete: () => puff.destroy() });
      e.destroy();
    });
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

    this.checkSpawnQueue();

    // Shard drop (2 G$ each, paid after UTC midnight) - rare drops!
    if (this.prizesOn && enemy) {
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
    if (this.prizesOn && Math.random() < 0.05) {
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
      this.txtWave.setText(`LEVEL ${this.level}`);
    }
    if (this.txtFoes) {
      const count = this.waveRemainingFoes !== undefined ? this.waveRemainingFoes : this.wavePendingCount;
      this.txtFoes.setText(`FOES: ${count}`);
    }
  }

  spawnEnemy(type, x, y, hpMul = 1, options = {}) {
    let enemy;
    const Beast = BEAST_CLASSES[type];
    if (Beast) {
      enemy = new Beast(this, x, y);
    } else if (type === 'boss_gorgok') {
      enemy = new BossGorgok(this, x, y);
      // each realm's last level is Gorgok in another coat, with its own name and its own call for help
      const { variant } = options;
      if (variant) {
        enemy.bossName = variant.name;
        enemy.summonType = variant.summon;
        enemy.baseTint = variant.tint;
        if (variant.tint !== null) enemy.setTint(variant.tint);
      }
    }

    if (enemy) {
      enemy.mobType = type;
      enemy.countsTowardWave = options.countsTowardWave !== false;
      if (hpMul !== 1) {
        enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
        enemy.maxHp = enemy.hp;
      }
      // The level's speed multiplier reaches only a beast that keeps its pace in a `walkSpeed` of its own, and none of the arena's
      // does yet (their speeds are constants in their own code), so for now every foe moves at its own pace at every level.
      if (enemy.walkSpeed) enemy.walkSpeed *= this.waveSpeedMul;
      if (type === 'boss_gorgok') this.attachBossBar(enemy);

      // a body that joins the group is given the group's defaults, gravity and the edge of the world included: a flyer is put
      // back in the air, and every foe is kept inside the arena (a blink or a summon can place one past the wall, out of reach)
      const floats = Boolean(enemy.body) && !enemy.body.allowGravity;
      this.enemies.add(enemy);
      if (enemy.body) {
        enemy.body.setCollideWorldBounds(true);
        if (floats) enemy.body.setAllowGravity(false);
      }

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

  /** A boss's health bar, made once the boss has its level's health and named for it (the bar of the boss before is gone). */
  attachBossBar(boss) {
    this.bossBar?.destroy();
    this.bossBar = new BossHealthBar(this, boss.bossName, boss.maxHp);
    this.bossBar.y = 44;
    boss.healthBar = this.bossBar;
  }

  spawnMob(type, x, y) {
    return this.spawnEnemy(type, x, y, this.waveHpMul || 1, { countsTowardWave: false });
  }

  /**
   * The banner that opens a level: a new realm if it brings one, the level's number and name, its boss, and the beasts the
   * player has not met yet. It stays a moment so it can be read, then fades (and a banner still up is gone before the
   * next one is drawn over it).
   */
  announceLevel(plan) {
    if (this.levelBanner) {
      this.tweens.killTweensOf(this.levelBanner);
      this.levelBanner.forEach(t => t.destroy());
    }
    const w = this.cameras.main.width;
    const top = Math.round(this.cameras.main.height * 0.3);
    const lines = [];
    if (plan.newRealm) lines.push({ text: `ENTERING ${plan.realmName.toUpperCase()}`, size: '7px', color: '#9be7ff' });
    lines.push({ text: `LEVEL ${plan.level}`, size: '10px', color: '#f6c026' });
    lines.push({ text: plan.name.toUpperCase(), size: '7px', color: '#ffffff' });
    lines.push({ text: plan.scene.name.toUpperCase(), size: '6px', color: '#a8c4ff' });
    if (plan.boss) lines.push({ text: `BOSS: ${plan.boss.name}`, size: '7px', color: '#ff6b6b' });
    if (plan.introduces.length > 0) lines.push({ text: `NEW: ${plan.introduces.map(beastName).join(', ')}`, size: '7px', color: '#98ff20' });

    let y = top;
    const texts = lines.map(({ text, size, color }) => {
      const t = this.add.text(w / 2, y, text, { fontFamily: 'Press Start 2P', fontSize: size, color, stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5).setScrollFactor(0).setDepth(250);
      y += parseFloat(size) + 8;
      return t;
    });
    this.levelBanner = texts;
    this.tweens.add({ targets: texts, scale: { from: 1.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: texts, alpha: 0, delay: 1700, duration: 900, onComplete: () => texts.forEach(t => t.destroy()) });
  }

  announceWave(title) {
    const w = this.cameras.main.width;
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
    const w = this.cameras.main.width;
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
    this.txtHarvest.setVisible(Boolean(this.prizesOn));

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
    this.txtWave = label(wave, 'LEVEL 1', '#f6c026');
    this.txtFoes = value(foes, 'FOES: 0', '#d0f0c0');

    // The armour worn (engine/gear.js), under the bar at the left: the page's wallet and timer buttons are at the right
    this.txtGear = this.add.text(hud.left, hud.barH + 9, gearStrip(this.player?.armour), { ...hud.fonts.value, color: '#cfe3ff', stroke: '#000000', strokeThickness: 2 })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(201);

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
    if (!this.txtHarvest || !this.prizesOn) return;
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

    // A blade forged for a realm hits that realm's beasts harder (engine/gear.js)
    const bane = baneMul(this.player.weaponConfig, enemy.mobType, this.plan?.realm);
    const dmg = Math.round(this.player.getAttackDamage() * bane);
    if (bane > 1) this.showBaneCue(enemy, bane);
    const isUpward = this.player.attackType === 'upward';
    const res = enemy.takeDamage(dmg, this.player.x, isUpward);

    if (res && res.killed && !enemy._killHandled) {
      const label = res.isBackstab ? 'CRIT!' : (res.isCounter ? 'COUNTER! 💥' : (res.shattered ? 'SHATTER! 💥' : (isUpward ? 'UP-SLASH!' : '')));
      const bonus = res.isBackstab ? 25 : (res.isCounter ? 20 : 0);
      this.addKill(enemy.mobType, res.pts, bonus, enemy.x, enemy.y - 12, label, enemy);
    }
  }

  /** A blade's bane lands: say so, but not on every swing at a pack (it would write over itself). */
  showBaneCue(enemy, bane) {
    if (this.time.now - (this.lastBaneCue ?? -Infinity) < 1500) return;
    this.lastBaneCue = this.time.now;
    this.showFloatingText(enemy.x, enemy.y - 34, `BANE +${Math.round((bane - 1) * 100)}%`, '#ffd34d');
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
      } else {
        // a boss takes a lighter stomp than the rest; one that falls to it is a kill like any other (score, shards, the count)
        const res = enemy.takeDamage(enemy.mobType === 'boss_gorgok' ? 25 : 35, this.player.x);
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

        // Visual charge impact cue (the hero's own damage number says what the hit cost once the armour had its share)
        const impactText = this.add.text(this.player.x, this.player.y - 20, '💥 CHARGE HIT!', {
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
    if (this.curtain?.alpha > 0) this.curtainUp(150);
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
      level: this.level,
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

  /**
   * Leaving through the pause menu (MAIN MENU, RETRY BATTLE) ends the run like a death does: it is settled with the totals at
   * this moment (the same ones the game-over screen would use), so the score and the Shards the HUD counted are not dropped.
   */
  endRunOnLeave() {
    if (this.isGameOver) return; // already settled by its own ending
    runs.finish({
      score: this.totalScore + this.secondsSurvived * GAME_CONFIG.SURVIVAL.PTS_PER_SECOND,
      kills: this.killCount.total,
      shards: this.sessionCrystalsCollected || 0,
      durationMs: Math.round(this.activeClock.ms),
      level: this.level,
    }).then((result) => this.refreshDepth(result));
  }

  /**
   * The server's best level opens the blades and armour that ask for one, and the Shop and the goal line read it from the wallet
   * status. A settled run says when it moved; one the server already held says nothing of the level (its first answer was
   * lost), which is as good a reason to ask again. Resolves to whether the status was fetched; never rejects.
   */
  refreshDepth(result) {
    const deeper = (result?.bestLevel ?? 0) > (gdService.getStatus().bestLevel ?? 0);
    if (!deeper && !result?.alreadySubmitted) return Promise.resolve(false);
    return gdService.refreshAll().then(() => true, () => false);
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
          level: runData.level,
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
      this.refreshDepth(result).then((fetched) => { if (fetched) this.refreshGameOverModal(proof); }).catch(() => {}); // the Shop and the goal line read it
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
      if (!this.prizesOn) {
        crystalLine = ''; // no Shards drop while the server pays no prizes
      } else if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
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
    // the beasts of the deeper realms, and the bosses, count together after the six of the forest
    const forest = ['boar', 'snail', 'bee', 'mushroom', 'flying_eye', 'goblin'];
    const others = this.killCount.total - forest.reduce((sum, type) => sum + (this.killCount[type] || 0), 0);
    return [
      `Time Survived: ${this.secondsSurvived}s (+${this.secondsSurvived * GAME_CONFIG.SURVIVAL.PTS_PER_SECOND} pts)`,
      `Kills: 🐗${this.killCount.boar || 0} 🐌${this.killCount.snail || 0} 🐝${this.killCount.bee || 0} 🍄${this.killCount.mushroom || 0} 👁️${this.killCount.flying_eye || 0} 👺${this.killCount.goblin || 0}${others > 0 ? ` 👹${others}` : ''}`,
      crystalLine,
      this.bladeGoalLine(proof),
      `${proof.label}`
    ].filter((line) => line !== '').join('\n');
  }

  /**
   * The blade the levels lead to next, while the player is on the way to one (engine/levels.js bladeGoal): how deep it asks them
   * to go, or that it is ready at the Forge. Nothing until the server has answered for the run, and nothing when there is no blade to go for.
   */
  bladeGoalLine(proof) {
    if (proof.result === undefined) return '';
    try {
      const st = gdService.getStatus();
      const best = Math.max(st.bestLevel ?? 0, proof.result.bestLevel ?? 0);
      const goal = bladeGoal({ reached: best, owned: st.owned ?? [] });
      if (!goal) return '';
      return goal.unlocked ? `⚔️ ${goal.name} is ready to forge` : `⚔️ ${goal.name}: reach level ${goal.minLevel} (best ${best})`;
    } catch (err) {
      console.warn('[survival] could not describe the next blade', err?.message);
      return '';
    }
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
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    // Full screen backdrop overlay to capture clicks and dim the arena
    const backdrop = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(490)
      .setInteractive();

    // Modal Card Frame
    const box = this.add.rectangle(w / 2, h / 2, 400, 226, 0x121c12, 0.98)
      .setStrokeStyle(2, 0xe9b213)
      .setScrollFactor(0)
      .setDepth(500);

    const title = this.add.text(w / 2, h / 2 - 96, 'ENDLESS RUN LOCKED IN', {
      fontFamily: 'Press Start 2P',
      fontSize: '10px',
      color: '#f6c026'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    const realm = this.plan?.realmName ? ` · ${this.plan.realmName.toUpperCase()}` : '';
    this.add.text(w / 2, h / 2 - 78, `LEVEL ${this.level}${realm}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#9be7ff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    const scoreDisplay = this.add.text(w / 2, h / 2 - 58, `FINAL SCORE: ${this.totalScore}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    // Kept so the result line can be redrawn when the server's answer arrives (see refreshGameOverModal).
    this.gameOverDetails = this.add.text(w / 2, h / 2 - 8, this.gameOverDetailsText(proof), {
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
      if (startIsBlocked('SurvivalScene')) {
        // the gate may refuse this restart (the verification lapsed since the run began): then it opens over this screen, which stays as it is
        this.scene.restart();
        return;
      }
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

    const btnY = h / 2 + 85;
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
      const mobName = beastName(offscreenEnemy.mobType);
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
        this.offscreenArrow.setX(cam.width - 54);
        this.offscreenArrow.setY((this.hudLayout?.barH ?? 28) + 10);
        this.offscreenArrow.setText(`${mobName} ►`);
        this.offscreenArrow.setVisible(true);
      } else if (isAbove) {
        // Offscreen strictly above
        const screenX = Phaser.Math.Clamp(offscreenEnemy.x - cam.worldView.x, 60, cam.width - 60);
        this.offscreenArrow.setX(screenX);
        this.offscreenArrow.setY(34);
        this.offscreenArrow.setText(`▲ ${mobName} ▲`);
        this.offscreenArrow.setVisible(true);
      } else if (isBelow) {
        // Offscreen strictly below
        const screenX = Phaser.Math.Clamp(offscreenEnemy.x - cam.worldView.x, 60, cam.width - 60);
        this.offscreenArrow.setX(screenX);
        this.offscreenArrow.setY(Math.min(cam.height - 22, GAME_CONFIG.HEIGHT - 22));
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

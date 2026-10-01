import Phaser from 'phaser';
import Player from '../entities/Player.js';
import Boar from '../entities/Boar.js';
import Snail from '../entities/Snail.js';
import Bee from '../entities/Bee.js';
import Mushroom from '../entities/Mushroom.js';
import FlyingEye from '../entities/FlyingEye.js';
import Goblin from '../entities/Goblin.js';
import BossGorgok from '../entities/BossGorgok.js';
import BossWizard from '../entities/BossWizard.js';
import BossSkeleton from '../entities/BossSkeleton.js';
import BossDemon from '../entities/BossDemon.js';
import BossNightBorne from '../entities/BossNightBorne.js';
import Mirelurker from '../entities/Mirelurker.js';
import HornetGuard from '../entities/HornetGuard.js';
import SkeletonWarrior from '../entities/SkeletonWarrior.js';
import CinderDrake from '../entities/CinderDrake.js';
import AstralShade from '../entities/AstralShade.js';
import BogLurker from '../entities/BogLurker.js';
import DreadBat from '../entities/DreadBat.js';
import CryptWraith from '../entities/CryptWraith.js';
import BasaltGolem from '../entities/BasaltGolem.js';
import VoidStalker from '../entities/VoidStalker.js';
import Projectile from '../entities/Projectile.js';
import Crate from '../entities/Crate.js';
import Obelisk from '../entities/Obelisk.js';
import BossHealthBar from '../ui/BossHealthBar.js';
import HeroHealthBar from '../ui/HeroHealthBar.js';
import StoryDialogueBox from '../ui/StoryDialogueBox.js';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import { juice } from '../engine/JuiceEffects.js';
import WeatherManager from '../engine/WeatherManager.js';
import confetti from 'canvas-confetti';
import ShardDrop from '../entities/ShardDrop.js';
import { gdService } from '../engine/GdService.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { runs, bossLine, shardsLine } from '../gd/runs.js';
import { ActiveClock, pageHidden } from '../gd/activeClock.js';
import { SHARD_RATE_GD, DAILY_SHARD_CAP_GD } from '../gd/config.js';

// Colours of the reward lines on the end screens, by the tone the copy helpers (gd/runs.js) give each line.
const TONE_COLOR = { muted: '#a0c4a0', warn: '#f59e0b', bad: '#ff7777', good: '#ffd700', shard: '#38e1ff' };


export default class StoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StoryScene' });
  }

  init(data) {
    this.chapterId = data.chapter || 1;
    this.showcaseMob = data && data.showcaseMob ? data.showcaseMob : null;
    this.spawnPlayerX = (data && typeof data.playerX === 'number') ? data.playerX : 60;
    this.spawnPlayerY = (data && typeof data.playerY === 'number') ? data.playerY : 346;
    this.chapterConfig = GAME_CONFIG.CHAPTERS.find(c => c.id === this.chapterId) || GAME_CONFIG.CHAPTERS[0];
    this.killsCount = 0;
    this.isGameOver = false;
    this.isVictory = false;
    this.inDialogue = false;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.levelWidth = this.chapterId === 1 ? 2800 : 2600;
    this.levelHeight = 440;
    this.gateX = this.chapterId === 1 ? 2310 : 2090;
    this.groundSegments = [];
    this.victoryAdvanceCallback = null;
    this.gameOverRetryCallback = null;
    this.activeGameOverCleanup = null;
    this.activeVictoryCleanup = null;

    // Boss & Arena state
    this.boss = null;
    this.bossHealthBar = null;
    this.bossTriggered = false;
    this.bossApproachTriggered = false;
    this.bossApproachBanner = null;
    this.bossBattleBanner = null;
    this.bossApproachMarkers = [];
    this.bossBarrierWall = null;
    this.bossBarrierVisual = null;
    this.bossArenaUnsealed = false;
    this.bossLockedBanner = null;
    this.lastBossLockedWarningTime = 0;
    this.initialLevelEnemiesCount = 0;
    this.arenaGateWall = null;
    this.arenaGateVisual = null;
    this.skipIntroCard = Boolean(data && data.skipIntroCard);
    this.skipDialogue = Boolean(data && data.skipDialogue);
    // Time played, not wall-clock time: it stops while paused or while the tab is hidden, and it is what the run's
    // duration is reported from (see update()).
    this.activeClock = new ActiveClock();
    this.secondsElapsed = 0;
  }

  create() {
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    this.isGameOver = false;
    this.isVictory = false;
    if (this.physics) {
      this.physics.resume();
      if (this.physics.world) this.physics.world.isPaused = false;
    }

    if (this.bossApproachBanner) {
      this.bossApproachBanner.destroy();
      this.bossApproachBanner = null;
    }
    if (this.bossBattleBanner) {
      this.bossBattleBanner.destroy();
      this.bossBattleBanner = null;
    }
    if (this.bossLockedBanner) {
      this.bossLockedBanner.destroy();
      this.bossLockedBanner = null;
    }
    if (this.bossBarrierVisual) {
      this.bossBarrierVisual.destroy();
      this.bossBarrierVisual = null;
    }

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    pauseService.attachScene(this, `CHAPTER ${this.chapterId}: ${this.chapterConfig.title}`);
    pauseService.hideButtons();
    pauseService.updateTimer(0);
    sound.playBGM(this.chapterId >= 4 ? 'battle' : 'forest');
    this.events.once('shutdown', () => {
      if (this.bossApproachBanner) {
        this.bossApproachBanner.destroy();
        this.bossApproachBanner = null;
      }
      if (this.bossBattleBanner) {
        this.bossBattleBanner.destroy();
        this.bossBattleBanner = null;
      }
      if (this.bossLockedBanner) {
        this.bossLockedBanner.destroy();
        this.bossLockedBanner = null;
      }
      if (this.bossBarrierVisual) {
        this.bossBarrierVisual.destroy();
        this.bossBarrierVisual = null;
      }
      if (this.activeGameOverCleanup) {
        this.activeGameOverCleanup();
        this.activeGameOverCleanup = null;
      }
      if (this.activeVictoryCleanup) {
        this.activeVictoryCleanup();
        this.activeVictoryCleanup = null;
      }
      if (this.weatherManager) {
        this.weatherManager.destroy();
        this.weatherManager = null;
      }
      pauseService.detachScene();
      sound.stopBGM();
    });

    // Physics bounds
    this.physics.world.setBounds(0, 0, this.levelWidth, this.levelHeight);

    // Lush Parallax High Forest Background & Atmosphere
    this.createForestBackground();

    // Dynamic Weather Overlays (Rain/Lightning in Whispering Woods, Embers/Ash in Obsidian Caldera)
    this.weatherManager = new WeatherManager(this, this.chapterId);

    // Platform, Hazard, Crate, Enemy, Projectile, and Shard groups
    this.platforms = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();
    this.crates = this.physics.add.group();
    this.enemies = this.physics.add.group();
    this.projectiles = this.physics.add.group({ runChildUpdate: true });
    this.shardDrops = this.physics.add.group();
    this.sessionCrystalsCollected = 0;
    this.runResult = null; // what the server answered when the run was settled (see settleRun); null while it is still out
    this.runResultPromise = null;
    this.runRefreshPromise = null;
    this.settledShards = 0;
    this.runEpoch = (this.runEpoch || 0) + 1; // a settlement from an earlier life must not write into this one
    this.crystalBankResult = null;
    fetchRewardsStatus().then((st) => {
      this.rewardsStatus = st;
      this.checkDailyHarvestCap();
    }).catch(() => {});
    runs.start({ mode: 'STORY', chapter: this.chapterId });
    this.events.once('shutdown', () => runs.stop());

    // Build the Level Geometry & Spawns
    this.buildChapterLevel();

    if (this.showcaseMob) {
      this.enemies.clear(true, true);
      if (this.showcaseMob === 'bog_lurker' || this.showcaseMob === 'mirelurker') {
        this.spawnMob('bog_lurker', 240, 340);
      } else if (this.showcaseMob === 'dread_bat' || this.showcaseMob === 'hornet_guard') {
        this.spawnMob('dread_bat', 240, 240);
      } else if (this.showcaseMob === 'crypt_wraith' || this.showcaseMob === 'skeleton_warrior') {
        this.spawnMob('crypt_wraith', 240, 320);
      } else if (this.showcaseMob === 'basalt_golem' || this.showcaseMob === 'cinder_drake') {
        this.spawnMob('basalt_golem', 240, 340);
      } else if (this.showcaseMob === 'void_stalker' || this.showcaseMob === 'astral_shade') {
        this.spawnMob('void_stalker', 240, 340);
      }
    }

    // Track total level enemies and place the mystical Boss Arena Seal
    this.initialLevelEnemiesCount = this.enemies ? this.enemies.getChildren().length : 0;
    const gateX = this.chapterId === 1 ? 2310 : 2090;
    this.createBossArenaSeal(gateX, 380);

    // Spawn Player standing on ground (Y=380)
    const px = (typeof this.spawnPlayerX === 'number') ? this.spawnPlayerX : 60;
    const py = (typeof this.spawnPlayerY === 'number') ? this.spawnPlayerY : 346;
    this.player = new Player(this, px, py);
    this.player.lastSafeX = px;
    this.player.lastSafeY = py;
    this.physics.add.collider(this.player, this.platforms);

    // Camera follow
    this.cameras.main.setBounds(0, 0, this.levelWidth, this.levelHeight);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08, 0, -28);
    this.cameras.main.setZoom(1);
    this.cameras.main.scrollX = 0;
    this.cameras.main.scrollY = 170;

    // Collisions
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.crates, this.platforms);
    this.physics.add.collider(this.crates, this.crates);
    this.physics.add.collider(this.shardDrops, this.platforms);
    this.physics.add.overlap(this.player, this.shardDrops, (_p, crystal) => {
      crystal.collect(this.player);
    });


    // Projectile collisions with environment
    this.physics.add.collider(this.projectiles, this.platforms, (proj) => {
      if (proj.projType === 'goblin_bomb') {
        // Bombs bounce with friction
      } else {
        proj.explode();
      }
    });

    // Hazards (Water in ch1, honeycomb traps in ch2, spikes in ch3)
    this.physics.add.overlap(this.player, this.hazards, (player, hazard) => {
      if (this.inDialogue) return;
      this.handleHazardHit(player, hazard);
    });

    // Player attack vs enemies
    this.physics.add.overlap(this.player.attackHitbox, this.enemies, (hitbox, enemy) => {
      if (this.player.currentSwingHits && this.player.currentSwingHits.has(enemy)) return;
      if (this.player.currentSwingHits) this.player.currentSwingHits.add(enemy);
      this.handlePlayerAttackEnemy(enemy);
    });

    // Player attack vs projectiles (Deflect or cut!)
    this.physics.add.overlap(this.player.attackHitbox, this.projectiles, (hitbox, proj) => {
      if (!this.player.isAttacking || proj.isDead) return;
      if (proj.isDeflectable && !proj.isDeflected) {
        proj.deflect(this.player);
      } else if (!proj.isDeflected) {
        proj.explode();
        this.registerComboHit();
      }
    });

    // Player body vs projectile
    this.physics.add.overlap(this.player, this.projectiles, (player, proj) => {
      if (this.inDialogue || proj.isDead || proj.isDeflected || player.isDead) return;
      proj.explode();
      const knockDir = proj.x < player.x ? 1 : -1;
      const damaged = player.takeDamage(proj.damage || 15, knockDir);
      if (damaged) {
        this.comboCount = 0;
        this.updateHearts();
        if (player.isDead) {
          this.handlePlayerGameOver();
        }
      }
    });

    // Deflected projectile vs enemies & bosses!
    this.physics.add.overlap(this.enemies, this.projectiles, (enemy, proj) => {
      if (!proj.isDeflected || proj.isDead || enemy.state === 'DEAD') return;
      proj.explode();
      const res = enemy.takeDamage(35, proj.x);
      if (res && res.killed) {
        this.killsCount++;
        this.registerComboHit();
        this.onEnemyKilled();
      }
    });

    // Player attack vs Boss Barrier
    if (this.bossBarrierWall) {
      this.physics.add.overlap(this.player.attackHitbox, this.bossBarrierWall, () => {
        if (!this.bossArenaUnsealed && !this.bossTriggered) {
          if (this.player.currentSwingHits && this.player.currentSwingHits.has(this.bossBarrierWall)) return;
          if (this.player.currentSwingHits) this.player.currentSwingHits.add(this.bossBarrierWall);
          sound.playRicochet();
          const rem = this.getRemainingEnemiesCount();
          this.triggerBossLockedWarning(rem);
        }
      });
    }

    // Player attack vs crates
    this.physics.add.overlap(this.player.attackHitbox, this.crates, (hitbox, crate) => {
      if (this.player.currentSwingHits && this.player.currentSwingHits.has(crate)) return;
      if (this.player.currentSwingHits) this.player.currentSwingHits.add(crate);
      crate.breakCrate(this.player);
      this.updateHudMaterials();
    });

    // Player attack vs Obelisk
    if (this.obelisk) {
      this.physics.add.overlap(this.player.attackHitbox, this.obelisk, () => {
        if (this.player.currentSwingHits && this.player.currentSwingHits.has(this.obelisk)) return;
        if (this.player.currentSwingHits) this.player.currentSwingHits.add(this.obelisk);
        const cleansed = this.obelisk.strike();
        if (cleansed) {
          this.triggerChapterVictory();
        }
      });
    }

    // Player body vs enemy body
    this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
      this.handlePlayerEnemyCollision(enemy);
    });

    // Keyboard inputs
    this.cursors = this.input.keyboard.createCursorKeys();
    this.cursors.keys = this.input.keyboard.addKeys('W,A,S,D,J,K,Z,X,E,R,ENTER,ESC');

    // On-screen HUD
    this.createStoryHUD();

    // Chapter Title Intro Card
    if (!this.skipDialogue) {
      if (this.skipIntroCard) {
        this.triggerChapterOpeningDialogue();
      } else {
        this.showChapterIntroCard();
      }
    } else {
      if (this.physics) {
        this.physics.resume();
        if (this.physics.world) this.physics.world.isPaused = false;
      }
      pauseService.showButtons();
      if (typeof window !== 'undefined' && window.touchController) {
        window.touchController.show();
      }
    }
  }

  buildChapterLevel() {
    if (this.chapterId === 1) {
      this.buildChapter1Woods();
    } else if (this.chapterId === 2) {
      this.buildChapter2Canopy();
    } else if (this.chapterId === 3) {
      this.buildChapter3Ruins();
    } else if (this.chapterId === 4) {
      this.buildChapter4Caldera();
    } else if (this.chapterId === 5) {
      this.buildChapter5LunarSpire();
    }
  }

  buildChapter1Woods() {
    // =========================================================================
    // Chapter 1: Whispering Woods (2800px) - Forest & Lake, Water Hazards
    // =========================================================================
    // --- ZONE 1: The Forest Outskirts (0 - 480px) ---
    this.createGround(0, 380, 480);
    this.spawnMob('boar', 200, 340);
    this.spawnMob('bog_lurker', 280, 340);
    this.spawnMob('snail', 380, 340);

    // --- OBSTACLE 1: Cascades Chasm (480 - 740px, 260px wide water chasm) ---
    // Ground leap cannot clear 260px! Must use stepping boughs over the roaring water!
    this.createHazard(480, 400, 260, 'WATER HAZARD 🌊');
    this.createPlatform(430, 315, 96); // Launching bough
    this.createPlatform(550, 260, 96); // Mid-water stepping stone
    this.createPlatform(670, 305, 96); // Receiving bough
    this.spawnMob('bee', 550, 150);
    this.spawnCrate(550, 225);

    // --- ZONE 2: Lake Watchtower Ridge (740 - 1020px) ---
    this.createGround(740, 380, 280);
    this.spawnMob('boar', 830, 340);
    this.spawnMob('bog_lurker', 920, 340);

    // --- OBSTACLE 2: Watchtower Ravine Ascent (1020 - 1300px, 280px gap) ---
    // Rushing water abyss! Ascending watchtower staircase of platforms
    this.createHazard(1020, 400, 280, 'WATER HAZARD 🌊');
    this.createPlatform(980, 310, 96);  // Step 1: Lower scaffold
    this.createPlatform(1090, 240, 96); // Step 2: High watchtower deck (with Crate)
    this.createPlatform(1200, 280, 96); // Step 3: Descending step
    this.spawnMob('flying_eye', 1100, 140);
    this.spawnMob('snail', 1090, 205);
    this.spawnCrate(1130, 205);

    // --- ZONE 3: Ancient Pine Canopy & Ravine (1300 - 1540px) ---
    this.createGround(1300, 380, 240);
    this.spawnMob('mushroom', 1360, 340);
    this.spawnMob('bog_lurker', 1440, 340);

    // --- OBSTACLE 3: Deep Forest Ravine (1540 - 1820px, 280px gap) ---
    // Deep chasm. High canopy bridge gives safe passage and tactical drop on enemies!
    this.createHazard(1540, 400, 280, 'WATER HAZARD 🌊');
    this.createPlatform(1500, 295, 96); // Canopy climb 1
    this.createPlatform(1610, 230, 96); // High canopy bridge (with Crate)
    this.createPlatform(1730, 270, 96); // Drop-stomp perch above patrol
    this.spawnMob('flying_eye', 1620, 140);
    this.spawnMob('mushroom', 1610, 195);
    this.spawnCrate(1610, 195);

    // --- ZONE 3b: Pine Glade Patrol (1820 - 2080px) ---
    this.createGround(1820, 380, 260);
    this.spawnMob('boar', 1890, 340);
    this.spawnMob('bog_lurker', 1980, 340);
    this.spawnCrate(1850, 350);

    // --- ZONE 4: Sanctuary Moat & Boss Approach (2080 - 2800px) ---
    this.createHazard(2080, 400, 80, 'WATER HAZARD 🌊');
    this.createPlatform(2060, 310, 96); // Moat crossing bridge
    this.createGround(2160, 380, 640);

    this.createPlatform(2260, 300, 96);
    this.createPlatform(2440, 240, 96);

    this.spawnMob('boar', 2220, 340);
    this.spawnMob('snail', 2270, 340);

    this.spawnCrate(2280, 270);
    this.spawnCrate(2520, 350);

    // Warning signpost and twin burning totems marking boss arena approach
    this.createBossApproachLandmarks(2240, 380);

    this.obelisk = new Obelisk(this, 2720, 380, 'Shrine of Whispering Waters');
    this.obelisk.lock();
  }

  buildChapter2Canopy() {
    // =========================================================================
    // Chapter 2: The Hive Canopy (2600px) - Autumn Trees, Honeycomb Traps, Bees
    // =========================================================================
    // --- ZONE 1: Canopy Outskirts (0 - 460px) ---
    this.createGround(0, 380, 460);
    this.spawnMob('boar', 200, 340);
    this.spawnMob('dread_bat', 300, 160);
    this.spawnMob('snail', 390, 340);

    // --- OBSTACLE 1: Amber Chasm (460 - 740px, 280px wide Honeycomb Trap) ---
    // Cannot be jumped from ground! Must climb giant branch platforms!
    this.createHazard(460, 395, 280, 'HONEYCOMB TRAP 🍯');
    this.createPlatform(410, 310, 150); // Branch 1: Launch bough
    this.createPlatform(540, 240, 150); // Branch 2: Suspended hive bough (with Crate)
    this.createPlatform(670, 290, 150); // Branch 3: Descent bough
    this.spawnMob('bee', 540, 140);
    this.spawnMob('flying_eye', 660, 150);
    this.spawnCrate(580, 205);

    // --- ZONE 2: Hive Ridge (740 - 1020px) ---
    this.createGround(740, 380, 280);
    this.spawnMob('dread_bat', 830, 140);
    this.spawnMob('mushroom', 940, 340);

    // --- OBSTACLE 2: Great Hive Ravine (1020 - 1320px, 300px wide Honeycomb Trap) ---
    // Deep honey trap guarded by swarm. Stepped branches are the only way across!
    this.createHazard(1020, 395, 300, 'HONEYCOMB TRAP 🍯');
    this.createPlatform(970, 310, 150);  // Branch 1: Ascent
    this.createPlatform(1100, 230, 150); // Branch 2: High hive crown (with Crate)
    this.createPlatform(1230, 280, 150); // Branch 3: Descent
    this.spawnMob('bee', 1100, 130);
    this.spawnMob('snail', 1120, 195);
    this.spawnCrate(1140, 195);

    // --- ZONE 3: Mid-Canopy Grove (1320 - 1560px) ---
    this.createGround(1320, 380, 240);
    this.spawnMob('goblin', 1380, 340);
    this.spawnMob('dread_bat', 1450, 150);
    this.spawnMob('mushroom', 1510, 340);

    // --- OBSTACLE 3: Queen's Bough Overpass (1560 - 1860px, 300px wide Trap) ---
    // Fatal honey pit! High canopy walkway spanning the chasm.
    this.createHazard(1560, 395, 300, 'HONEYCOMB TRAP 🍯');
    this.createPlatform(1510, 300, 150); // Canopy step 1
    this.createPlatform(1640, 220, 150); // Canopy step 2: Queen's bough
    this.createPlatform(1770, 270, 150); // Canopy step 3: Overlook perch
    this.spawnMob('bee', 1640, 130);
    this.spawnMob('goblin', 1660, 180);
    this.spawnCrate(1680, 185);

    // --- ZONE 4: Golden Hive Sanctuary & Boss Approach (1860 - 2600px) ---
    this.createGround(1860, 380, 740);
    this.spawnMob('boar', 1900, 340);
    this.spawnMob('dread_bat', 1950, 140);
    this.spawnMob('snail', 1990, 340);

    this.createPlatform(2180, 270, 150);
    this.createPlatform(2340, 210, 150);
    this.spawnCrate(2200, 235);
    this.spawnCrate(2420, 350);

    // Warning signpost and amber totems marking boss arena approach
    this.createBossApproachLandmarks(2030, 380);

    this.obelisk = new Obelisk(this, 2520, 380, 'Golden Hive Shrine');
    this.obelisk.lock();
  }

  buildChapter3Ruins() {
    // =========================================================================
    // Chapter 3: Sunken Ruins (2600px) - Mossy Stone, Spike Traps, Boss Vorgath
    // =========================================================================
    // --- ZONE 1: Ruined Courtyard (0 - 420px) ---
    this.createGround(0, 380, 420);
    this.spawnMob('boar', 180, 340);
    this.spawnMob('crypt_wraith', 260, 320);
    this.spawnMob('snail', 360, 340);

    // --- OBSTACLE 1: Spiked Moat (420 - 700px, 280px wide Ancient Spikes) ---
    // Fatal spike pit! Stepping stone columns are required to cross!
    this.createHazard(420, 400, 280, 'ANCIENT SPIKES ⚡');
    this.createPlatform(380, 310, 96); // Column 1
    this.createPlatform(500, 240, 96); // Column 2: High pedestal (with Crate)
    this.createPlatform(620, 290, 96); // Column 3
    this.spawnMob('flying_eye', 500, 140);
    this.spawnCrate(510, 205);

    // --- ZONE 2: Crypt Hallway (700 - 980px) ---
    this.createGround(700, 380, 280);
    this.spawnMob('crypt_wraith', 780, 320);
    this.spawnMob('boar', 880, 340);

    // --- OBSTACLE 2: Crypt Colonnade Abyss (980 - 1280px, 300px wide Spikes) ---
    // Deep spiked chasm. Multi-tier stone columns provide the only crossing.
    this.createHazard(980, 400, 300, 'ANCIENT SPIKES ⚡');
    this.createPlatform(940, 310, 96);  // Pillar 1
    this.createPlatform(1060, 230, 96); // Pillar 2: High archway (with Crate)
    this.createPlatform(1180, 280, 96); // Pillar 3
    this.spawnMob('bee', 1060, 140);
    this.spawnMob('mushroom', 1080, 195);
    this.spawnCrate(1080, 195);

    // --- ZONE 3: Sunken Catacombs (1280 - 1540px) ---
    this.createGround(1280, 380, 260);
    this.spawnMob('goblin', 1340, 340);
    this.spawnMob('crypt_wraith', 1420, 320);
    this.spawnMob('snail', 1490, 340);

    // --- OBSTACLE 3: Vorgath's Spiked Precipice (1540 - 1840px, 300px Spikes) ---
    // Ancient stone pillars across the spike trench.
    this.createHazard(1540, 400, 300, 'ANCIENT SPIKES ⚡');
    this.createPlatform(1500, 300, 96); // Pillar 1
    this.createPlatform(1620, 220, 96); // Pillar 2: High tomb pillar (with Crate)
    this.createPlatform(1740, 270, 96); // Pillar 3: Overlook perch
    this.spawnMob('flying_eye', 1620, 130);
    this.spawnMob('mushroom', 1640, 185);
    this.spawnCrate(1640, 185);

    // --- ZONE 4: Crypt Sanctuary & Boss Approach (1840 - 2600px) ---
    this.createGround(1840, 380, 760);
    this.spawnMob('boar', 1890, 340);
    this.spawnMob('crypt_wraith', 1940, 320);
    this.spawnMob('goblin', 1980, 340);

    this.createPlatform(2120, 270, 96);
    this.createPlatform(2300, 210, 96);
    this.spawnCrate(2140, 235);
    this.spawnCrate(2380, 350);

    // Warning signpost and crypt flame pillars marking boss arena approach
    this.createBossApproachLandmarks(2030, 380);

    // Crypt Obelisk (Locked by Vorgath)
    this.obelisk = new Obelisk(this, 2520, 380, 'Crypt Shrine of the Ancients');
    this.obelisk.lock();
  }

  buildChapter4Caldera() {
    // =========================================================================
    // Chapter 4: Obsidian Caldera (2600px) - Volcanic Magma, Basalt Platforms, Ignis
    // =========================================================================
    // --- ZONE 1: Caldera Edge (0 - 420px) ---
    this.createGround(0, 380, 420);
    this.spawnMob('goblin', 180, 340);
    this.spawnMob('basalt_golem', 260, 340);
    this.spawnMob('boar', 350, 340);

    // --- OBSTACLE 1: Magma Rift (420 - 720px, 300px wide Molten Lava & Geyser) ---
    // Boiling magma! Stepping basalt platforms over erupting geyser
    this.createHazard(420, 400, 300, 'MOLTEN LAVA 🔥');
    this.createPlatform(380, 300, 96); // Basalt 1
    this.createPlatform(500, 220, 96); // Basalt 2: High perch over geyser (with Crate)
    this.createPlatform(620, 270, 96); // Basalt 3
    this.spawnMob('flying_eye', 500, 130);
    this.spawnCrate(510, 185);
    this.createLavaGeyser(570, 392, 240, 0);

    // --- ZONE 2: Basalt Ridge (720 - 1000px) ---
    this.createGround(720, 380, 280);
    this.spawnMob('mushroom', 820, 340);
    this.spawnMob('basalt_golem', 920, 340);

    // --- OBSTACLE 2: Basalt Lake (1000 - 1320px, 320px wide Molten Lava & Geyser) ---
    // Wide molten lake! High basalt bridges required to navigate safely
    this.createHazard(1000, 400, 320, 'MOLTEN LAVA 🔥');
    this.createPlatform(960, 300, 96);  // Basalt 1
    this.createPlatform(1080, 220, 96); // Basalt 2: High volcanic ledge (with Crate)
    this.createPlatform(1200, 270, 96); // Basalt 3
    this.spawnMob('flying_eye', 1080, 130);
    this.spawnMob('mushroom', 1100, 185);
    this.spawnCrate(1100, 185);
    this.createLavaGeyser(1140, 392, 240, 900);

    // --- ZONE 3: Obsidian Steppes (1320 - 1560px) ---
    this.createGround(1320, 380, 240);
    this.spawnMob('goblin', 1370, 340);
    this.spawnMob('basalt_golem', 1440, 340);
    this.spawnMob('flying_eye', 1500, 160);

    // --- OBSTACLE 3: Crucible Bridge (1560 - 1880px, 320px wide Molten Lava) ---
    // Deep magma pit with lava eruptions.
    this.createHazard(1560, 400, 320, 'MOLTEN LAVA 🔥');
    this.createPlatform(1520, 300, 96); // Basalt 1
    this.createPlatform(1640, 220, 96); // Basalt 2: Crucible platform (with Crate)
    this.createPlatform(1760, 270, 96); // Basalt 3
    this.spawnMob('flying_eye', 1640, 130);
    this.spawnCrate(1660, 185);
    this.createLavaGeyser(1700, 392, 240, 1800);

    // --- ZONE 4: Molten Core Sanctuary & Boss Approach (1880 - 2600px) ---
    this.createGround(1880, 380, 720);
    this.spawnMob('boar', 1900, 340);
    this.spawnMob('basalt_golem', 1950, 340);
    this.spawnMob('goblin', 1990, 340);

    this.createPlatform(2200, 270, 96);
    this.createPlatform(2380, 210, 96);
    this.spawnCrate(2220, 235);
    this.spawnCrate(2420, 350);

    // Warning signpost and obsidian magma pillars marking boss arena approach
    this.createBossApproachLandmarks(1940, 380);

    // Caldera Obelisk (Locked by Ignis)
    this.obelisk = new Obelisk(this, 2520, 380, 'Shrine of the Molten Core');
    this.obelisk.lock();
  }

  buildChapter5LunarSpire() {
    // =========================================================================
    // Chapter 5: The Lunar Spire (2600px) - Astral Chasm, Crystal Steps, Umbra
    // =========================================================================
    // --- ZONE 1: Astral Foothills (0 - 400px) ---
    this.createGround(0, 380, 400);
    this.spawnMob('goblin', 180, 340);
    this.spawnMob('void_stalker', 260, 340);
    this.spawnMob('boar', 340, 340);

    // --- OBSTACLE 1: Void Rift Crossing (400 - 720px, 320px wide Astral Chasm) ---
    // Bottomless cosmic abyss! Floating crystal steps required to cross!
    this.createHazard(400, 400, 320, 'ASTRAL CHASM 🌌');
    this.createPlatform(360, 310, 96); // Crystal 1
    this.createPlatform(480, 230, 96); // Crystal 2: Celestial step (with Crate)
    this.createPlatform(600, 280, 96); // Crystal 3
    this.spawnMob('flying_eye', 480, 140);
    this.spawnMob('bee', 600, 150);
    this.spawnCrate(490, 195);

    // --- ZONE 2: Starlight Ridge (720 - 1000px) ---
    this.createGround(720, 380, 280);
    this.spawnMob('mushroom', 820, 340);
    this.spawnMob('void_stalker', 920, 340);

    // --- OBSTACLE 2: Celestial Staircase (1000 - 1340px, 340px wide Astral Chasm) ---
    // Multi-tier crystal stairway ascending above the void abyss
    this.createHazard(1000, 400, 340, 'ASTRAL CHASM 🌌');
    this.createPlatform(960, 310, 96);  // Step 1: Ascent
    this.createPlatform(1080, 220, 96); // Step 2: High astral balcony (with Crate)
    this.createPlatform(1220, 280, 96); // Step 3: Descent
    this.spawnMob('flying_eye', 1080, 130);
    this.spawnMob('bee', 1220, 140);
    this.spawnCrate(1100, 185);

    // --- ZONE 3: Astral Plateau (1340 - 1580px) ---
    this.createGround(1340, 380, 240);
    this.spawnMob('goblin', 1380, 340);
    this.spawnMob('void_stalker', 1440, 340);
    this.spawnMob('mushroom', 1510, 340);

    // --- OBSTACLE 3: Starlight Precipice (1580 - 1900px, 320px wide Astral Chasm) ---
    // Cosmic void gap into the Lunar Spire core.
    this.createHazard(1580, 400, 320, 'ASTRAL CHASM 🌌');
    this.createPlatform(1540, 300, 96); // Crystal step 1
    this.createPlatform(1660, 220, 96); // Crystal step 2: High Spire balcony (with Crate)
    this.createPlatform(1780, 270, 96); // Crystal step 3
    this.spawnMob('flying_eye', 1660, 130);
    this.spawnCrate(1680, 185);

    // --- ZONE 4: Lunar Heart Sanctuary & Final Boss Approach (1900 - 2600px) ---
    this.createGround(1900, 380, 700);
    this.spawnMob('boar', 1910, 340);
    this.spawnMob('void_stalker', 1960, 340);
    this.spawnMob('goblin', 2000, 340);

    this.createPlatform(2180, 270, 96);
    this.createPlatform(2360, 210, 96);
    this.spawnCrate(2200, 235);
    this.spawnCrate(2420, 350);

    // Warning signpost and celestial spires marking boss arena approach
    this.createBossApproachLandmarks(1940, 380);

    // Final Celestial Obelisk (Locked by Umbra)
    this.obelisk = new Obelisk(this, 2520, 380, 'The Lunar Heart Obelisk');
    this.obelisk.lock();
  }

  createForestBackground() {
    const w = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;

    let bgKey = 'bg_whispering';
    if (this.chapterId === 2) bgKey = 'bg_hive';
    else if (this.chapterId === 3) bgKey = 'bg_ruins';
    else if (this.chapterId === 4) bgKey = 'bg_caldera';
    else if (this.chapterId === 5) bgKey = 'bg_lunar_spire';

    // 1. Sky Gradient / Main Backdrop
    this.bgSky = this.add.tileSprite(0, 0, w, h, bgKey).setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    if (h > 270) {
      this.bgSky.tileScaleY = h / 270;
    }

    if (this.chapterId <= 3) {
      // 2. Distant Mountains (very slow parallax)
      this.bgMountains = this.add.tileSprite(0, 20, w, Math.max(200, h - 20), 'sky_mountains').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
      if (h > 270) this.bgMountains.tileScaleY = Math.max(1, (h - 20) / 250);

      // 3. Foggy Distant Mountain Pines (slow parallax)
      this.bgFogPines = this.add.tileSprite(0, 50, w, Math.max(220, h - 50), 'forest_bg_p0').setOrigin(0, 0).setScrollFactor(0).setDepth(2);
      if (h > 270) this.bgFogPines.tileScaleY = Math.max(1, (h - 50) / 206);

      // 4. Midground Forest Silhouettes
      this.bgMidPines = this.add.tileSprite(0, 80, w, Math.max(220, h - 80), 'forest_bg_p1').setOrigin(0, 0).setScrollFactor(0).setDepth(3);
      if (h > 270) this.bgMidPines.tileScaleY = Math.max(1, (h - 80) / 176);

      // 5. Standalone Tall Pine Trees placed along the level
      const treeSpacing = 140;
      const numTrees = Math.floor(this.levelWidth / treeSpacing);
      for (let i = 0; i < numTrees; i++) {
        const tx = 60 + i * treeSpacing + ((i * 37) % 50 - 25);
        let treeKey = (i % 3 === 0) ? 'pine_green' : (i % 3 === 1 ? 'pine_dark' : 'pine_golden');
        if (this.chapterId === 2 && treeKey === 'pine_green') treeKey = 'pine_golden';
        if (this.chapterId === 3) treeKey = 'pine_dark';

        const scale = 0.9 + ((i * 19) % 30) * 0.01;
        const tree = this.add.image(tx, 388, treeKey)
          .setOrigin(0.5, 1.0)
          .setScale(scale)
          .setDepth(4);

        this.tweens.add({
          targets: tree,
          angle: { from: -0.8, to: 0.8 },
          duration: 2400 + (i % 5) * 200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }

      // 6. Forest Bushes behind platforms
      const bushSpacing = 150;
      const numBushes = Math.floor(this.levelWidth / bushSpacing);
      for (let i = 0; i < numBushes; i++) {
        const bx = 90 + i * bushSpacing + ((i * 43) % 60 - 30);
        const bushKey = this.chapterId === 2 ? 'bush_golden' : (this.chapterId === 3 ? 'bush_dark' : 'bush_green');
        this.add.image(bx, 382, bushKey).setOrigin(0.5, 1.0).setDepth(5).setScale(0.85);
      }
    } else if (this.chapterId === 4) {
      // Caldera: Dark basalt boulders along the horizon
      const rockSpacing = 170;
      const numRocks = Math.floor(this.levelWidth / rockSpacing);
      for (let i = 0; i < numRocks; i++) {
        const rx = 80 + i * rockSpacing + ((i * 31) % 40 - 20);
        this.add.image(rx, 390, 'boulders')
          .setOrigin(0.5, 1.0)
          .setScale(1.2 + (i % 3) * 0.2)
          .setTint(0x331111)
          .setDepth(4);
      }
    } else if (this.chapterId === 5) {
      // Lunar Spire: Floating stellar nebulae & celestial starlight
      const starSpacing = 150;
      const numStars = Math.floor(this.levelWidth / starSpacing);
      for (let i = 0; i < numStars; i++) {
        const sx = 70 + i * starSpacing + ((i * 41) % 50 - 25);
        const st = this.add.circle(sx, Phaser.Math.Between(60, 240), Phaser.Math.Between(2, 4), 0xccaaff, 0.8)
          .setDepth(3);
        this.tweens.add({
          targets: st,
          scale: 1.5,
          alpha: 0.3,
          duration: 1200 + (i % 4) * 300,
          yoyo: true,
          repeat: -1
        });
      }
    }

    this.createForestParticles();
  }

  createForestParticles() {
    let tint = 0x88ee88;
    let gravY = -8;
    let speedY = { min: -8, max: 8 };

    if (this.chapterId === 2) {
      tint = 0xffcc44;
    } else if (this.chapterId === 3) {
      tint = 0x88ffbb;
    } else if (this.chapterId === 4) {
      tint = 0xff4411;
      gravY = -22;
      speedY = { min: -28, max: -6 };
    } else if (this.chapterId === 5) {
      tint = 0xaaccff;
      gravY = -4;
      speedY = { min: -10, max: 10 };
    }

    this.particles = this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: this.levelWidth },
      y: { min: 40, max: 360 },
      quantity: 1,
      frequency: this.chapterId === 4 ? 140 : 240,
      lifespan: 3600,
      gravityY: gravY,
      speedX: { min: -12, max: 12 },
      speedY: speedY,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.7, end: 0 },
      tint: tint,
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

  createGround(x, y, width) {
    const depth = 10;
    this.groundSegments.push({ x1: x, x2: x + width, y: y });
    const body = this.add.rectangle(x + width / 2, y + 20, width, 40, 0x000000, 0);
    this.physics.add.existing(body, true);
    body.isMainGround = true;
    this.platforms.add(body);

    const numTiles = Math.ceil(width / 16);
    for (let i = 0; i < numTiles; i++) {
      const tileX = x + i * 16;
      let topKey = 'tile_cliff_top_mid1';
      if (i === 0 && x > 0) {
        topKey = 'tile_cliff_top_left';
      } else if (i === numTiles - 1 && (x + width < this.levelWidth)) {
        topKey = 'tile_cliff_top_right';
      } else if (i % 3 === 0) {
        topKey = 'tile_cliff_top_mid2';
      }

      const topImg = this.add.image(tileX, y - 10, topKey).setOrigin(0, 0).setDepth(depth);
      if (this.chapterId === 4) topImg.setTint(0x774433);
      else if (this.chapterId === 5) topImg.setTint(0x7788aa);

      for (let cy = y + 6; cy <= y + 68; cy += 16) {
        let bodyKey = 'tile_cliff_body_mid';
        if (i === 0 && x > 0) bodyKey = 'tile_cliff_body_left';
        else if (i === numTiles - 1 && (x + width < this.levelWidth)) bodyKey = 'tile_cliff_body_right';
        const bodyImg = this.add.image(tileX, cy, bodyKey).setOrigin(0, 0).setDepth(depth - 1);
        if (this.chapterId === 4) bodyImg.setTint(0x442211);
        else if (this.chapterId === 5) bodyImg.setTint(0x556688);
      }
    }

    // Add decorative flora / crystals along the surface
    for (let px = x + 24; px < x + width - 24; px += 56) {
      const hash = Math.floor((px * 9301 + 49297) % 233280);
      const roll = hash % 5;
      if (this.chapterId === 4) {
        // Volcanic embers
        if (roll < 2) {
          const spark = this.add.circle(px, y - 2, 2, 0xff5500, 0.8).setDepth(depth + 1);
          this.tweens.add({ targets: spark, alpha: 0.2, yoyo: true, repeat: -1, duration: 600 });
        }
      } else if (this.chapterId === 5) {
        // Moon crystal flowers
        if (roll === 1 || roll === 2) {
          const fl = this.add.image(px, y, roll === 1 ? 'prop_flower_blue' : 'prop_flower_purple').setOrigin(0.5, 1.0).setDepth(depth + 1);
          fl.setTint(0x88ffff);
        }
      } else {
        if (roll === 0) {
          this.add.image(px, y, 'prop_shroom_big').setOrigin(0.5, 1.0).setDepth(depth + 1);
        } else if (roll === 1) {
          this.add.image(px, y, 'prop_flower_blue').setOrigin(0.5, 1.0).setDepth(depth + 1);
        } else if (roll === 2) {
          this.add.image(px, y, 'prop_flower_purple').setOrigin(0.5, 1.0).setDepth(depth + 1);
        } else if (roll === 3) {
          this.add.image(px, y, 'prop_shroom_small').setOrigin(0.5, 1.0).setDepth(depth + 1);
        } else if (roll === 4) {
          this.add.image(px, y, 'prop_fern').setOrigin(0.5, 1.0).setDepth(depth + 1);
        }
      }
    }
  }

  createPlatform(x, y, width) {
    const depth = 10;
    let tileSize = 48;
    let tileKey = 'plat_wood';

    if (this.chapterId === 5) {
      tileSize = 48;
      tileKey = 'plat_crystal';
    } else if (this.chapterId === 4) {
      tileSize = 48;
      tileKey = 'plat_obsidian';
    } else if (this.chapterId === 3) {
      tileSize = 48;
      tileKey = 'plat_stone';
    } else if (this.chapterId === 2) {
      tileSize = 75;
      tileKey = 'plat_branch';
    }

    const count = Math.max(1, Math.round(width / tileSize));
    const actualWidth = count * tileSize;

    const body = this.add.rectangle(x + actualWidth / 2, y + 6, actualWidth, 12, 0x000000, 0);
    this.physics.add.existing(body, true);
    body.body.checkCollision.down = false;
    body.body.checkCollision.left = false;
    body.body.checkCollision.right = false;
    body.body.checkCollision.up = true;
    this.platforms.add(body);

    for (let i = 0; i < count; i++) {
      const yOffset = this.chapterId === 2 ? -2 : 0;
      this.add.image(x + i * tileSize, y + yOffset, tileKey).setOrigin(0, 0).setDepth(depth);
    }
  }

  createHazard(x, y, width, label) {
    const haz = this.add.rectangle(x + width / 2, y + 16, width, 24, 0x000000, 0);
    this.physics.add.existing(haz, true);
    haz.isLava = (this.chapterId === 4) || (label && label.includes('LAVA'));
    haz.hazardLabel = label;
    this.hazards.add(haz);

    if (this.chapterId === 4) {
      // Lava Hazard
      const count = Math.ceil(width / 64);
      for (let i = 0; i < count; i++) {
        const lava = this.add.image(x + i * 64, y - 8, 'lava_surface').setOrigin(0, 0).setDepth(11);
        this.tweens.add({
          targets: lava,
          y: y - 5,
          duration: 900 + i * 140,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
        this.add.image(x + i * 64, y + 24, 'lava_deep').setOrigin(0, 0).setDepth(10);
      }
    } else if (this.chapterId === 5) {
      // Astral Chasm
      const count = Math.ceil(width / 32);
      for (let i = 0; i < count; i++) {
        const star = this.add.circle(x + i * 32 + 16, y + 12, 5, 0xbb88ff, 0.75).setDepth(11);
        this.tweens.add({
          targets: star,
          scale: 1.6,
          alpha: 0.3,
          duration: 750 + i * 120,
          yoyo: true,
          repeat: -1
        });
      }
    } else if (this.chapterId === 1) {
      const waterCount = Math.ceil(width / 64);
      for (let i = 0; i < waterCount; i++) {
        const waterImg = this.add.image(x + i * 64, y - 8, 'water_surface').setOrigin(0, 0).setDepth(11);
        this.tweens.add({
          targets: waterImg,
          y: y - 5,
          duration: 1000 + i * 160,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
        this.add.image(x + i * 64, y + 24, 'water_deep').setOrigin(0, 0).setDepth(10);
      }
      this.add.image(x + 4, y - 8, 'prop_reeds').setOrigin(0.5, 1.0).setDepth(12);
      this.add.image(x + width - 4, y - 8, 'prop_reeds').setOrigin(0.5, 1.0).setDepth(12).setFlipX(true);
    } else if (this.chapterId === 2) {
      // Golden Amber Honey Trap: flowing liquid surface at ravine base with amber bubbles
      const honeyCount = Math.ceil(width / 64);
      for (let i = 0; i < honeyCount; i++) {
        const honeySurface = this.add.image(x + i * 64, y - 8, 'water_surface')
          .setOrigin(0, 0)
          .setDepth(11)
          .setTint(0xffaa00);
        this.tweens.add({
          targets: honeySurface,
          y: y - 5,
          duration: 1100 + i * 160,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
        this.add.image(x + i * 64, y + 24, 'water_deep')
          .setOrigin(0, 0)
          .setDepth(10)
          .setTint(0x995500);
      }
      // Rising golden honey bubbles
      for (let i = 0; i < Math.floor(width / 36); i++) {
        const bubble = this.add.circle(x + 18 + i * 36, y + 8, 3, 0xffd54f, 0.75).setDepth(12);
        this.tweens.add({
          targets: bubble,
          y: y - 18,
          alpha: 0,
          scale: 1.5,
          duration: 900 + (i % 3) * 260,
          repeat: -1,
          ease: 'Sine.easeOut'
        });
      }
    } else {
      const sCount = Math.ceil(width / 16);
      for (let i = 0; i < sCount; i++) {
        this.add.triangle(x + i * 16 + 8, y + 12, 0, 16, 8, 0, 16, 16, 0x888899).setDepth(11);
      }
    }
  }

  createLavaGeyser(x, surfaceY = 392, peakY = 240, cycleDelay = 0) {
    if (!this.lavaGeysers) {
      this.lavaGeysers = [];
    }

    const colHeight = surfaceY - peakY;
    const geyser = this.add.container(x, surfaceY).setDepth(14);

    // Visual layers for the eruption column
    const outerFlame = this.add.rectangle(0, -colHeight / 2, 28, colHeight, 0xff2200, 0.85);
    const innerFlame = this.add.rectangle(0, -colHeight / 2, 16, colHeight, 0xff8800, 0.95);
    const coreFlame = this.add.rectangle(0, -colHeight / 2, 6, colHeight, 0xffffff, 1.0);
    const crest = this.add.ellipse(0, -colHeight, 32, 18, 0xffcc00, 0.9);

    geyser.add([outerFlame, innerFlame, coreFlame, crest]);
    geyser.setScale(1, 0); // Flat at lava surface initially

    // Physics hitbox for active eruption
    const hitbox = this.add.rectangle(x, surfaceY - colHeight / 2, 24, colHeight, 0x000000, 0);
    this.physics.add.existing(hitbox, true);
    hitbox.body.enable = false;
    hitbox.isLavaGeyser = true;
    this.hazards.add(hitbox);

    // Surface bubbling warning indicator
    const warningGlow = this.add.circle(x, surfaceY - 2, 16, 0xff6600, 0).setDepth(13);

    const geyserData = {
      x, surfaceY, peakY, colHeight, geyser, hitbox, warningGlow,
      state: 'DORMANT'
    };
    this.lavaGeysers.push(geyserData);

    const runCycle = () => {
      if (!this.scene || !this.scene.isActive()) return;

      // 1. DORMANT (2.4s) - Safe to leap
      geyserData.state = 'DORMANT';
      if (hitbox.body) hitbox.body.enable = false;
      geyser.setScale(1, 0);
      warningGlow.setAlpha(0);

      this.time.delayedCall(2400, () => {
        if (!this.scene || !this.scene.isActive() || this.isGameOver || this.isVictory) return;
        if (this.inDialogue) {
          this.time.delayedCall(1000, runCycle);
          return;
        }

        // 2. WARNING TELEGRAPH (800ms) - Rising warning sparks & pulsing surface glow
        geyserData.state = 'WARNING';
        warningGlow.setAlpha(0.6);
        this.tweens.add({
          targets: warningGlow,
          scaleX: 1.8,
          scaleY: 1.8,
          alpha: { from: 0.3, to: 0.9 },
          duration: 200,
          yoyo: true,
          repeat: 3
        });

        for (let i = 0; i < 8; i++) {
          this.time.delayedCall(i * 90, () => {
            if (!this.scene || !this.scene.isActive() || this.inDialogue) return;
            const ember = this.add.circle(x + Phaser.Math.Between(-12, 12), surfaceY - 6, Phaser.Math.Between(2, 4), 0xffaa00, 0.9);
            this.tweens.add({
              targets: ember,
              y: ember.y - Phaser.Math.Between(20, 45),
              alpha: 0,
              duration: 350,
              onComplete: () => ember.destroy()
            });
          });
        }

        this.time.delayedCall(800, () => {
          if (!this.scene || !this.scene.isActive() || this.isGameOver || this.isVictory) return;
          if (this.inDialogue) {
            warningGlow.setAlpha(0);
            this.time.delayedCall(1000, runCycle);
            return;
          }

          // 3. ERUPTION SURGE (1200ms) - Active pillar of fire
          geyserData.state = 'ERUPT';
          if (hitbox.body) hitbox.body.enable = true;
          warningGlow.setAlpha(0);
          sound.playBoarChargeHit();

          this.tweens.add({
            targets: geyser,
            scaleY: 1,
            duration: 160,
            ease: 'Back.easeOut'
          });

          // Continuous spray of fiery embers while erupting
          const sprayTimer = this.time.addEvent({
            delay: 70,
            repeat: 14,
            callback: () => {
              if (!this.scene || !this.scene.isActive() || geyserData.state !== 'ERUPT' || this.inDialogue) return;
              const spark = this.add.circle(x + Phaser.Math.Between(-10, 10), peakY + Phaser.Math.Between(-10, 10), Phaser.Math.Between(3, 6), 0xffdd00, 0.9);
              this.physics.add.existing(spark);
              spark.body.setVelocity(Phaser.Math.Between(-60, 60), Phaser.Math.Between(-120, -40));
              spark.body.setGravityY(250);
              this.tweens.add({
                targets: spark,
                alpha: 0,
                duration: 400,
                onComplete: () => spark.destroy()
              });
            }
          });

          // 4. RECEDE (200ms)
          this.time.delayedCall(1200, () => {
            sprayTimer.destroy();
            if (!this.scene || !this.scene.isActive()) return;
            if (hitbox.body) hitbox.body.enable = false;
            geyserData.state = 'RECEDE';

            this.tweens.add({
              targets: geyser,
              scaleY: 0,
              duration: 200,
              ease: 'Sine.easeIn',
              onComplete: () => {
                runCycle();
              }
            });
          });
        });
      });
    };

    this.time.delayedCall(cycleDelay, runCycle);
  }

  spawnMob(type, x, y) {
    let mob;
    if (type === 'boar') {
      mob = new Boar(this, x, y);
    } else if (type === 'snail') {
      mob = new Snail(this, x, y);
    } else if (type === 'bee') {
      mob = new Bee(this, x, y);
    } else if (type === 'mushroom') {
      mob = new Mushroom(this, x, y);
    } else if (type === 'flying_eye') {
      mob = new FlyingEye(this, x, y);
    } else if (type === 'goblin') {
      mob = new Goblin(this, x, y);
    } else if (type === 'bog_lurker' || type === 'mirelurker') {
      mob = new BogLurker(this, x, y);
    } else if (type === 'dread_bat' || type === 'hornet_guard') {
      mob = new DreadBat(this, x, y);
    } else if (type === 'crypt_wraith' || type === 'skeleton_warrior') {
      mob = new CryptWraith(this, x, y);
    } else if (type === 'basalt_golem' || type === 'cinder_drake') {
      mob = new BasaltGolem(this, x, y);
    } else if (type === 'void_stalker' || type === 'astral_shade') {
      mob = new VoidStalker(this, x, y);
    }
    if (mob) {
      mob.mobType = type;
      this.enemies.add(mob);
    }
    return mob;
  }

  spawnProjectile(type, x, y, vx, vy, isDeflectable = false) {
    const proj = new Projectile(this, x, y, type, vx, vy, isDeflectable);
    this.projectiles.add(proj);
    proj.setVelocity(vx, vy);
    return proj;
  }

  createBossApproachLandmarks(x, groundY = 380) {
    const container = this.add.container(x, groundY);
    container.setDepth(15);
    this.bossApproachMarkers.push(container);

    // Chapter-specific styling for boundary monoliths & flames
    const theme = {
      1: { pillarCol: 0x243224, strokeCol: 0x4d664d, rune: '᚛ ᛟ ᚜', runeCol: '#ff5544', flameCol: 0xff6600, innerFlame: 0xffdd00 },
      2: { pillarCol: 0x4a3418, strokeCol: 0x886022, rune: '✦ 🍯 ✦', runeCol: '#ffcc22', flameCol: 0xffaa00, innerFlame: 0xffff66 },
      3: { pillarCol: 0x1a2228, strokeCol: 0x335566, rune: '☠ ᛉ ☠', runeCol: '#55ddff', flameCol: 0x00ccff, innerFlame: 0xccffff },
      4: { pillarCol: 0x1e0e0e, strokeCol: 0x661818, rune: '🔥 ⚡ 🔥', runeCol: '#ff4422', flameCol: 0xff3300, innerFlame: 0xffcc00 },
      5: { pillarCol: 0x140c24, strokeCol: 0x6622aa, rune: '✧ ☾ ✧', runeCol: '#cc88ff', flameCol: 0x9933ff, innerFlame: 0xffffff }
    }[this.chapterId] || { pillarCol: 0x222222, strokeCol: 0x555555, rune: '⚠️', runeCol: '#ffaa00', flameCol: 0xff6600, innerFlame: 0xffdd00 };

    // 1. Carved Wooden/Stone Warning Signpost at x - 32
    const postX = -32;
    const post = this.add.rectangle(postX, -14, 4, 28, 0x382012).setStrokeStyle(1, 0x201008);
    const board = this.add.rectangle(postX, -28, 42, 18, 0x2a160a).setStrokeStyle(1.5, 0x552c16);
    const skullIcon = this.add.text(postX - 11, -28, '☠️', { fontSize: '8px' }).setOrigin(0.5);
    const boardText = this.add.text(postX + 7, -28, 'BOSS', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ff4444'
    }).setOrigin(0.5);

    // Floating pulsing beacon over signpost
    const beacon = this.add.text(postX, -44, '!', {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#ffcc00'
    }).setOrigin(0.5);
    this.tweens.add({
      targets: beacon,
      y: -48,
      alpha: { from: 1, to: 0.35 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // 2. Twin Boundary Monoliths / Totems flanking the entrance (Left: -12, Right: 18)
    const createPillar = (px) => {
      const pRect = this.add.rectangle(px, -20, 14, 40, theme.pillarCol).setStrokeStyle(1.5, theme.strokeCol);
      const runeText = this.add.text(px, -20, theme.rune, {
        fontFamily: 'Press Start 2P',
        fontSize: '4.5px',
        color: theme.runeCol
      }).setOrigin(0.5);

      // Brazier cup on top
      const cup = this.add.rectangle(px, -42, 18, 6, 0x111111).setStrokeStyle(1, theme.strokeCol);

      // Flickering flame
      const outerFlame = this.add.ellipse(px, -48, 10, 14, theme.flameCol, 0.9);
      const innerFlame = this.add.ellipse(px, -47, 5, 8, theme.innerFlame, 0.95);

      this.tweens.add({
        targets: [outerFlame, innerFlame],
        scaleY: { from: 1, to: 1.3 },
        scaleX: { from: 1, to: 0.85 },
        duration: 250 + Math.random() * 100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      // Ambient rising sparks
      this.time.addEvent({
        delay: 350 + Math.random() * 200,
        loop: true,
        callback: () => {
          if (!this.scene || !this.scene.isActive()) return;
          const spark = this.add.circle(x + px + Phaser.Math.Between(-4, 4), groundY - 50, Phaser.Math.Between(1, 2.5), theme.flameCol, 0.85);
          spark.setDepth(16);
          this.tweens.add({
            targets: spark,
            y: spark.y - Phaser.Math.Between(14, 30),
            x: spark.x + Phaser.Math.Between(-6, 6),
            alpha: 0,
            duration: 400,
            onComplete: () => spark.destroy()
          });
        }
      });

      return [pRect, runeText, cup, outerFlame, innerFlame];
    };

    const leftPillar = createPillar(-12);
    const rightPillar = createPillar(18);

    container.add([post, board, skullIcon, boardText, beacon, ...leftPillar, ...rightPillar]);
  }

  triggerBossApproachWarning() {
    if (this.bossApproachTriggered || this.bossTriggered || this.isGameOver || this.isVictory) return;
    this.bossApproachTriggered = true;

    // 1. Audio tension rumble & camera micro-shake
    sound.playRumble();
    this.cameras.main.shake(380, 0.007);

    // 2. Chapter boss approach info
    const bossInfo = {
      1: { name: 'CHIEFTAIN GORGOK', title: 'Armored War Boar Colossus', color: '#ff6644', border: 0xaa3322 },
      2: { name: 'ARCHMAGE MALAKOR', title: 'Sorcerer of the Golden Hive', color: '#ffcc22', border: 0xaa8800 },
      3: { name: 'VORGATH', title: 'The Fallen Bone Sovereign', color: '#55ddff', border: 0x2277aa },
      4: { name: 'IGNIS', title: 'The Cinder Drake of the Deep', color: '#ff4422', border: 0xaa2200 },
      5: { name: 'SOVEREIGN UMBRA', title: 'Sovereign of the Shattered Moon', color: '#dd88ff', border: 0x8822bb }
    }[this.chapterId] || { name: 'UNKNOWN FOE', title: 'Ancient Guardian', color: '#ffffff', border: 0xaaaaaa };

    // 3. Atmospheric Screen Flash / Vignette Pulse
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    const flash = this.add.rectangle(w / 2, h / 2, w, h, bossInfo.border, 0.28)
      .setScrollFactor(0)
      .setDepth(440);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 600,
      ease: 'Sine.easeOut',
      onComplete: () => flash.destroy()
    });

    // 4. Cinematic Top Warning Banner
    if (this.bossApproachBanner) {
      this.bossApproachBanner.destroy();
      this.bossApproachBanner = null;
    }

    const banner = this.add.container(w / 2, -45).setScrollFactor(0).setDepth(445);
    this.bossApproachBanner = banner;

    const bg = this.add.rectangle(0, 0, 310, 34, 0x110808, 0.94)
      .setStrokeStyle(1.5, bossInfo.border);
    const skull = this.add.text(-135, 0, '⚠️', { fontSize: '10px' }).setOrigin(0.5);
    const mainText = this.add.text(0, -7, '⚠️ DANGER AHEAD: BOSS LAIR ⚠️', {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: bossInfo.color
    }).setOrigin(0.5);
    const subText = this.add.text(0, 7, `${bossInfo.name} • ${bossInfo.title}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#f0f0f0'
    }).setOrigin(0.5);

    banner.add([bg, skull, mainText, subText]);

    // Slide banner in from top to clear the top HUD
    this.tweens.add({
      targets: banner,
      y: 58,
      duration: 350,
      ease: 'Back.easeOut'
    });

    // Auto-dismiss after 4.5s
    this.time.delayedCall(4500, () => {
      this.dismissBossApproachWarning();
    });

    // 5. Sylva Fairy Companion Alert
    if (this.player && this.player.pet) {
      const pet = this.player.pet;
      this.showFloatingText(pet.x, pet.y - 18, '⚠️ POWERFUL AURA AHEAD!', '#ffffbb');
      this.tweens.add({
        targets: pet,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 150,
        yoyo: true,
        repeat: 3
      });
    } else if (this.player) {
      this.showFloatingText(this.player.x, this.player.y - 28, '⚠️ SENSE GREAT POWER AHEAD!', '#ffffbb');
    }
  }

  dismissBossApproachWarning(immediate = false) {
    if (!this.bossApproachBanner) return;
    const b = this.bossApproachBanner;
    this.bossApproachBanner = null;
    if (immediate) {
      b.destroy();
      return;
    }
    this.tweens.add({
      targets: b,
      y: -50,
      alpha: 0,
      duration: 250,
      ease: 'Sine.easeIn',
      onComplete: () => b.destroy()
    });
  }

  getRemainingEnemiesCount() {
    if (!this.enemies) return 0;
    const gateX = this.gateX || (this.chapterId === 1 ? 2310 : 2090);
    return this.enemies.getChildren().filter(e => {
      if (!e.active) return false;
      if (e.state === 'DEAD' || e.isDead) return false;
      if (e.hp !== undefined && e.hp <= 0) return false;
      if (e.mobType && e.mobType.startsWith('boss')) return false;
      // Failsafe: Never count enemies beyond the sealed gate or fallen into chasms
      if (e.x >= gateX - 10) return false;
      if (e.y > this.levelHeight + 30) return false;
      return true;
    }).length;
  }

  createBossArenaSeal(x, groundY = 380) {
    // 1. Static physical collider blocking player and all flying/ground mobs from crossing
    this.bossBarrierWall = this.add.rectangle(x, 200, 24, 440, 0x000000, 0);
    this.physics.add.existing(this.bossBarrierWall, true);
    this.platforms.add(this.bossBarrierWall);

    // Chapter themes for glowing seal
    const theme = {
      1: { col: 0x44ff88, stroke: 0x22aa44, hex: '#44ff88', rune: '᚛ ᛟ ᚜' },
      2: { col: 0xffcc22, stroke: 0xaa8800, hex: '#ffcc22', rune: '✦ 🍯 ✦' },
      3: { col: 0x55ddff, stroke: 0x2277aa, hex: '#55ddff', rune: '☠ ᛉ ☠' },
      4: { col: 0xff4422, stroke: 0xaa2200, hex: '#ff4422', rune: '🔥 ⚡ 🔥' },
      5: { col: 0xcc88ff, stroke: 0x8822bb, hex: '#cc88ff', rune: '✧ ☾ ✧' }
    }[this.chapterId] || { col: 0xffcc00, stroke: 0xaa8800, hex: '#ffcc00', rune: '⚠️' };

    // 2. Container for mystical visual gate
    const container = this.add.container(x, groundY);
    container.setDepth(18);
    this.bossBarrierVisual = container;

    // Glowing energy barrier columns
    const beamBack = this.add.rectangle(0, -110, 20, 230, theme.col, 0.18);
    const beamCore = this.add.rectangle(0, -110, 8, 230, 0xffffff, 0.35);

    // Left and right containment pillars
    const leftPillar = this.add.rectangle(-12, -110, 4, 230, theme.stroke, 0.85);
    const rightPillar = this.add.rectangle(12, -110, 4, 230, theme.stroke, 0.85);

    // Pulsing rune seals stacked vertically
    const runeTop = this.add.text(0, -170, theme.rune, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: theme.hex
    }).setOrigin(0.5);

    const runeMid = this.add.text(0, -110, '🔒', {
      fontSize: '14px'
    }).setOrigin(0.5);

    const runeLabel = this.add.text(0, -90, 'SEALED', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ff4444',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);

    const runeBottom = this.add.text(0, -50, theme.rune, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: theme.hex
    }).setOrigin(0.5);

    container.add([beamBack, beamCore, leftPillar, rightPillar, runeTop, runeMid, runeLabel, runeBottom]);

    // Breathing pulse tween for mystical aura
    this.tweens.add({
      targets: [beamBack, beamCore],
      alpha: { from: 0.15, to: 0.45 },
      scaleX: { from: 0.9, to: 1.15 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.tweens.add({
      targets: runeMid,
      scale: { from: 0.95, to: 1.15 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  triggerBossLockedWarning(remaining) {
    if (this.isGameOver || this.isVictory || this.inDialogue) return;
    if (this.time.now - this.lastBossLockedWarningTime < 2800) return;
    this.lastBossLockedWarningTime = this.time.now;

    sound.playHit();
    this.cameras.main.shake(180, 0.005);

    const nearest = this.getNearestRemainingEnemy();
    const nearestDesc = nearest ? `Nearest: ${nearest.dir === 'WEST' ? 'behind us ◄' : 'ahead ►'} (${nearest.distance}px)` : '';

    // 1. Companion Sylva or Player speech
    const warningMsg = nearest ? `⚠️ ${remaining} foes remain! ${nearestDesc}` : `⚠️ Foes remain! Defeat all ${remaining} enemies first!`;
    if (this.player && this.player.pet) {
      const pet = this.player.pet;
      this.showFloatingText(pet.x, pet.y - 18, warningMsg, '#ffcc44');
      this.tweens.add({
        targets: pet,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 150,
        yoyo: true,
        repeat: 2
      });
    } else if (this.player) {
      this.showFloatingText(this.player.x, this.player.y - 28, warningMsg, '#ffcc44');
    }

    // 2. Cinematic top alert banner
    if (this.bossLockedBanner) {
      this.bossLockedBanner.destroy();
      this.bossLockedBanner = null;
    }

    const w = GAME_CONFIG.WIDTH;
    const banner = this.add.container(w / 2, -45).setScrollFactor(0).setDepth(446);
    this.bossLockedBanner = banner;

    const bgHeight = nearest ? 44 : 34;
    const bg = this.add.rectangle(0, 0, 320, bgHeight, 0x140808, 0.95)
      .setStrokeStyle(1.5, 0xcc3322);
    const lockIcon = this.add.text(-140, 0, '🔒', { fontSize: '10px' }).setOrigin(0.5);
    const mainText = this.add.text(0, nearest ? -12 : -7, '🔒 BOSS LAIR SEALED 🔒', {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#ff4444'
    }).setOrigin(0.5);
    const subText = this.add.text(0, nearest ? 0 : 7, `Defeat all ${remaining} remaining enemies to enter!`, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ffcc66'
    }).setOrigin(0.5);

    banner.add([bg, lockIcon, mainText, subText]);

    if (nearest) {
      const arrow = nearest.dir === 'WEST' ? '◄' : '►';
      const trackerText = this.add.text(0, 12, `🎯 ${arrow} ${nearest.distance}px: ${nearest.name}`, {
        fontFamily: 'Press Start 2P',
        fontSize: '4.5px',
        color: '#ffdd55'
      }).setOrigin(0.5);
      banner.add(trackerText);
    }

    this.tweens.add({
      targets: banner,
      y: 62,
      duration: 300,
      ease: 'Back.easeOut'
    });

    this.time.delayedCall(3800, () => {
      this.dismissBossLockedWarning();
    });
  }

  getNearestRemainingEnemy() {
    if (!this.enemies || !this.player) return null;
    let nearest = null;
    let minDist = Infinity;
    this.enemies.getChildren().forEach(enemy => {
      if (enemy.active && enemy.state !== 'DEAD' && !enemy.isBoss) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        if (d < minDist) {
          minDist = d;
          nearest = {
            enemy,
            distance: Math.round(d),
            dir: enemy.x < this.player.x ? 'WEST' : 'EAST',
            name: (enemy.mobType || 'Enemy').toUpperCase()
          };
        }
      }
    });
    return nearest;
  }

  getEnemiesLeftBehind() {
    if (!this.enemies || !this.player) return { count: 0, nearest: null };
    const screenLeft = this.cameras.main.worldView ? this.cameras.main.worldView.x : (this.player.x - 240);
    let count = 0;
    let nearest = null;
    let minDist = Infinity;

    this.enemies.getChildren().forEach(enemy => {
      if (enemy.active && enemy.state !== 'DEAD' && !enemy.isBoss) {
        // Passed enemy that is now off-screen to the left
        if (enemy.x < screenLeft - 8 || enemy.x < this.player.x - 170) {
          count++;
          const d = Math.round(Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y));
          if (d < minDist) {
            minDist = d;
            nearest = {
              enemy,
              distance: d,
              name: (enemy.mobType || 'Enemy').toUpperCase()
            };
          }
        }
      }
    });

    return { count, nearest };
  }

  ensureEnemyTrackerPill(w) {
    if (!this.enemyTrackerPill) {
      this.enemyTrackerPill = this.add.container(w / 2, 42).setScrollFactor(0).setDepth(440);
      const bg = this.add.rectangle(0, 0, 250, 18, 0x140c06, 0.94)
        .setStrokeStyle(1.2, 0xffaa00);
      const txt = this.add.text(0, 0, '', {
        fontFamily: 'Press Start 2P',
        fontSize: '4.5px',
        color: '#ffcc00'
      }).setOrigin(0.5);

      this.enemyTrackerPill.add([bg, txt]);
      this.enemyTrackerPillBg = bg;
      this.enemyTrackerPillText = txt;

      this.tweens.add({
        targets: this.enemyTrackerPill,
        alpha: { from: 0, to: 1 },
        duration: 200
      });
    }
  }

  showLeftEdgeOffscreenIndicator(count) {
    const h = GAME_CONFIG.HEIGHT;
    if (!this.leftEdgeIndicator) {
      this.leftEdgeIndicator = this.add.container(18, h / 2).setScrollFactor(0).setDepth(440);
      const bg = this.add.rectangle(0, 0, 26, 22, 0x220808, 0.92)
        .setStrokeStyle(1.5, 0xff3333);
      const arrow = this.add.text(-2, -4, '◄', {
        fontFamily: 'Press Start 2P',
        fontSize: '7px',
        color: '#ff4444'
      }).setOrigin(0.5);
      const numTxt = this.add.text(0, 5, `${count}`, {
        fontFamily: 'Press Start 2P',
        fontSize: '4.5px',
        color: '#ffdd55'
      }).setOrigin(0.5);

      this.leftEdgeIndicator.add([bg, arrow, numTxt]);
      this.leftEdgeIndicatorNum = numTxt;

      this.tweens.add({
        targets: this.leftEdgeIndicator,
        scale: { from: 0.85, to: 1.15 },
        duration: 380,
        yoyo: true,
        repeat: -1
      });
    } else if (this.leftEdgeIndicatorNum) {
      this.leftEdgeIndicatorNum.setText(`${count}`);
    }
  }

  dismissLeftEdgeIndicator() {
    if (!this.leftEdgeIndicator) return;
    const ind = this.leftEdgeIndicator;
    this.leftEdgeIndicator = null;
    this.leftEdgeIndicatorNum = null;
    this.tweens.add({
      targets: ind,
      alpha: 0,
      duration: 180,
      onComplete: () => ind.destroy()
    });
  }

  updateEnemyTracker(gateX, remainingFoes) {
    if (this.isGameOver || this.isVictory || this.inDialogue) {
      this.dismissEnemyTracker();
      return;
    }

    const foesBehind = this.getEnemiesLeftBehind();
    const isNearGate = this.player && this.player.x >= gateX - 220;
    const w = GAME_CONFIG.WIDTH;

    // 1. Immediately indicate when enemies have been passed and are outside the screen
    if (foesBehind.count > 0) {
      this.ensureEnemyTrackerPill(w);
      const countLabel = foesBehind.count === 1 ? '1 FOE BEHIND' : `${foesBehind.count} FOES BEHIND`;
      this.enemyTrackerPillText.setText(`⚠️ ◄ ${countLabel}: ${foesBehind.nearest.name} (${foesBehind.nearest.distance}px)`);
      if (this.enemyTrackerPillBg) this.enemyTrackerPillBg.setStrokeStyle(1.2, 0xff3333);
      this.showLeftEdgeOffscreenIndicator(foesBehind.count);
    } else if (isNearGate && remainingFoes > 0) {
      // 2. Approaching sealed boss gate with remaining foes anywhere in the map
      const nearest = this.getNearestRemainingEnemy();
      if (!nearest) {
        this.dismissEnemyTracker();
        return;
      }
      this.ensureEnemyTrackerPill(w);
      const arrow = nearest.dir === 'WEST' ? '◄' : '►';
      this.enemyTrackerPillText.setText(`🎯 ${arrow} ${nearest.distance}px: ${nearest.name} (${remainingFoes} left)`);
      if (this.enemyTrackerPillBg) this.enemyTrackerPillBg.setStrokeStyle(1.2, 0xffaa00);
      this.dismissLeftEdgeIndicator();
    } else {
      this.dismissEnemyTracker();
    }
  }

  dismissEnemyTracker() {
    this.dismissLeftEdgeIndicator();
    if (!this.enemyTrackerPill) return;
    const pill = this.enemyTrackerPill;
    this.enemyTrackerPill = null;
    this.enemyTrackerPillBg = null;
    this.enemyTrackerPillText = null;
    this.tweens.add({
      targets: pill,
      alpha: 0,
      duration: 200,
      onComplete: () => pill.destroy()
    });
  }

  dismissBossLockedWarning(immediate = false) {
    if (!this.bossLockedBanner) return;
    const b = this.bossLockedBanner;
    this.bossLockedBanner = null;
    if (immediate) {
      b.destroy();
      return;
    }
    this.tweens.add({
      targets: b,
      y: -50,
      alpha: 0,
      duration: 250,
      ease: 'Sine.easeIn',
      onComplete: () => b.destroy()
    });
  }

  unsealBossArena() {
    if (this.bossArenaUnsealed) return;
    this.bossArenaUnsealed = true;

    this.dismissBossLockedWarning(true);
    sound.playSparkle();

    // Announcement banner
    const w = GAME_CONFIG.WIDTH;
    const banner = this.add.container(w / 2, -45).setScrollFactor(0).setDepth(446);
    const bg = this.add.rectangle(0, 0, 310, 34, 0x08180c, 0.95)
      .setStrokeStyle(1.5, 0x22cc66);
    const starIcon = this.add.text(-135, 0, '✨', { fontSize: '10px' }).setOrigin(0.5);
    const mainText = this.add.text(0, -7, '✨ ALL FOES DEFEATED! ✨', {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#44ff88'
    }).setOrigin(0.5);
    const subText = this.add.text(0, 7, 'The Boss Arena is now unsealed!', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ffffff'
    }).setOrigin(0.5);

    banner.add([bg, starIcon, mainText, subText]);

    this.tweens.add({
      targets: banner,
      y: 58,
      duration: 350,
      ease: 'Back.easeOut'
    });

    this.time.delayedCall(3500, () => {
      this.tweens.add({
        targets: banner,
        y: -50,
        alpha: 0,
        duration: 250,
        ease: 'Sine.easeIn',
        onComplete: () => banner.destroy()
      });
    });

    // Animate away the visual barrier
    if (this.bossBarrierVisual) {
      const vis = this.bossBarrierVisual;
      this.bossBarrierVisual = null;
      this.tweens.add({
        targets: vis,
        alpha: 0,
        scaleY: 1.3,
        scaleX: 1.5,
        duration: 600,
        ease: 'Sine.easeOut',
        onComplete: () => vis.destroy()
      });
    }

    // Remove physical collider wall so player can walk through
    if (this.bossBarrierWall) {
      if (this.platforms) {
        this.platforms.remove(this.bossBarrierWall, true, true);
      }
      this.bossBarrierWall.destroy();
      this.bossBarrierWall = null;
    }

    this.updateHudObjective();
  }

  updateHudObjective() {
    if (!this.txtObjective) return;
    if (!this.bossArenaUnsealed) {
      const remaining = this.getRemainingEnemiesCount();
      const cleared = Math.max(0, this.initialLevelEnemiesCount - remaining);
      this.txtObjective.setText(`OBJECTIVE: Defeat Foes (${cleared}/${this.initialLevelEnemiesCount})`);
      this.txtObjective.setColor('#ffcc66');
    } else if (!this.bossTriggered) {
      this.txtObjective.setText('OBJECTIVE: Enter Boss Arena!');
      this.txtObjective.setColor('#44ff88');
    } else if (this.boss && this.boss.active && this.boss.hp > 0) {
      const bossName = (this.bossHealthBar && this.bossHealthBar.bossName) ? this.bossHealthBar.bossName : 'Boss';
      this.txtObjective.setText(`OBJECTIVE: Defeat ${bossName}!`);
      this.txtObjective.setColor('#ff6644');
    } else {
      this.txtObjective.setText('OBJECTIVE: Cleanse Guardian Obelisk');
      this.txtObjective.setColor('#d0f0c0');
    }
  }

  onEnemyKilled() {
    this.updateHudObjective();
    if (this.getRemainingEnemiesCount() === 0) {
      this.unsealBossArena();
    }
  }

  onBossDefeated(boss) {
    this.updateHudObjective();
  }

  triggerBossEncounter(chapter) {
    if (this.bossTriggered) return;
    this.bossTriggered = true;
    this.dismissBossApproachWarning(true);
    this.dismissBossLockedWarning(true);
    this.updateHudObjective();

    sound.playVictory();
    this.cameras.main.shake(400, 0.02);

    if (chapter === 1) {
      if (this.player && this.player.x < 2330) this.player.x = 2330;
      // Restrict camera to Chapter 1 Boss Arena
      this.cameras.main.setBounds(2300, 0, 500, this.levelHeight);

      // Arena barricade gate at x = 2310
      this.arenaGateWall = this.add.rectangle(2310, 340, 20, 100, 0x000000, 0);
      this.physics.add.existing(this.arenaGateWall, true);
      this.platforms.add(this.arenaGateWall);

      // Visual gate: wooden spike barricade
      this.arenaGateVisual = this.add.container(2310, 340);
      for (let gy = -40; gy <= 40; gy += 24) {
        const cratePart = this.add.image(0, gy, 'crate').setScale(1.1).setTint(0x4a2a1a);
        this.arenaGateVisual.add(cratePart);
      }
      this.arenaGateVisual.setDepth(15);

      // Boss Health Bar
      this.bossHealthBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_GORGOK.NAME, GAME_CONFIG.MOBS.BOSS_GORGOK.HP);

      // Spawn Boss Gorgok (halt AI until dialogue concludes)
      this.boss = new BossGorgok(this, 2600, 340, this.bossHealthBar);
      this.enemies.add(this.boss);
      this.boss.actionCooldown = this.time.now + 999999;

      this.startDialogue([
        { speaker: 'GORGOK', text: 'GRAAAAGH! WHO ENTERS MY GLADE?! THE CRYSTAL... IT SINGS IN MY BLOOD!' },
        { speaker: 'LUNA', text: 'Gorgok! Fight the corruption! You were the revered guardian of these woods!' },
        { speaker: 'GORGOK', text: 'GUARDIAN NO MORE! I AM THE TUSK OF THE BLIGHT! CRUSH THE MOONWARDEN!' },
        { speaker: 'LUNA', text: 'Forgive me, ancient friend. The Moonshard will shatter your chains!' }
      ], () => {
        if (this.boss && this.boss.active) {
          this.boss.actionCooldown = this.time.now + 600;
        }
        this.showBossWarningBanner(GAME_CONFIG.MOBS.BOSS_GORGOK.NAME, 'ARMORED WAR BOAR COLOSSUS');
      });
    } else if (chapter === 2) {
      if (this.player && this.player.x < 2120) this.player.x = 2120;
      // Restrict camera to Chapter 2 Boss Arena
      this.cameras.main.setBounds(2080, 0, 520, this.levelHeight);

      // Arena barricade gate at x = 2090
      this.arenaGateWall = this.add.rectangle(2090, 340, 20, 100, 0x000000, 0);
      this.physics.add.existing(this.arenaGateWall, true);
      this.platforms.add(this.arenaGateWall);

      // Visual gate: hive blocks
      this.arenaGateVisual = this.add.container(2090, 340);
      for (let gy = -40; gy <= 40; gy += 24) {
        const block = this.add.image(0, gy, 'crate').setScale(1.1).setTint(0x664411);
        this.arenaGateVisual.add(block);
      }
      this.arenaGateVisual.setDepth(15);

      // Boss Health Bar
      this.bossHealthBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_WIZARD.NAME, GAME_CONFIG.MOBS.BOSS_WIZARD.HP);

      // Spawn Boss Malakor (halt AI until dialogue concludes)
      this.boss = new BossWizard(this, 2380, 240, this.bossHealthBar);
      this.enemies.add(this.boss);
      this.boss.nextActionTime = this.time.now + 999999;

      this.startDialogue([
        { speaker: 'MALAKOR', text: 'Ah, the little Moonwarden finally arrives. How tragic that you climbed so high only to fall.' },
        { speaker: 'LUNA', text: 'Surrender the lunar shard, Malakor! Your experiments are rotting the forest from within!' },
        { speaker: 'MALAKOR', text: 'Rot? This is TRANSCENDENCE! With the celestial core, I shall bend reality itself! DIE!' }
      ], () => {
        if (this.boss && this.boss.active) {
          this.boss.nextActionTime = this.time.now + 700;
        }
        this.showBossWarningBanner(GAME_CONFIG.MOBS.BOSS_WIZARD.NAME, 'WIELDER OF TWILIGHT ARCANA');
      });
    } else if (chapter === 3) {
      if (this.player && this.player.x < 2120) this.player.x = 2120;
      // Restrict camera to Chapter 3 Vorgath Arena
      this.cameras.main.setBounds(2080, 0, 520, this.levelHeight);

      // Arena barricade gate at x = 2090
      this.arenaGateWall = this.add.rectangle(2090, 340, 20, 100, 0x000000, 0);
      this.physics.add.existing(this.arenaGateWall, true);
      this.platforms.add(this.arenaGateWall);

      // Visual gate: dark ruin stone pillars
      this.arenaGateVisual = this.add.container(2090, 340);
      for (let gy = -40; gy <= 40; gy += 24) {
        const block = this.add.image(0, gy, 'crate').setScale(1.1).setTint(0x221133);
        this.arenaGateVisual.add(block);
      }
      this.arenaGateVisual.setDepth(15);

      this.bossHealthBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_SKELETON.NAME, GAME_CONFIG.MOBS.BOSS_SKELETON.HP);
      this.boss = new BossSkeleton(this, 2400, 340, this.bossHealthBar);
      this.enemies.add(this.boss);
      this.boss.nextActionTime = this.time.now + 999999;

      this.startDialogue([
        { speaker: 'VORGATH', text: 'WHO AWAKENS THE SOVEREIGN OF ASH AND BONE?! FOOLISH WARRIOR OF LIGHT!' },
        { speaker: 'LUNA', text: 'Vorgath! The ancient crypts have fallen to darkness, but your blade still serves honor!' },
        { speaker: 'VORGATH', text: 'HONOR IS DUST! ONLY OBLIVION ENDURES! RAISE YOUR BLADE, MORTAL!' },
        { speaker: 'LUNA', text: 'Then sleep in peace, ancient king. The Moonshard shall grant you rest!' }
      ], () => {
        if (this.boss && this.boss.active) {
          this.boss.nextActionTime = this.time.now + 600;
        }
        this.showBossWarningBanner(GAME_CONFIG.MOBS.BOSS_SKELETON.NAME, 'ANCIENT MONARCH OF THE CRYPT');
      });
    } else if (chapter === 4) {
      if (this.player) {
        if (this.player.x < 2120) this.player.x = 2120;
        if (this.player.y > 346) this.player.y = 346;
        if (this.player.body) this.player.setVelocity(0, 0);
      }
      // Restrict camera to Chapter 4 Ignis Arena
      this.cameras.main.setBounds(2080, 0, 520, this.levelHeight);

      // Arena barricade gate at x = 2090
      this.arenaGateWall = this.add.rectangle(2090, 340, 20, 100, 0x000000, 0);
      this.physics.add.existing(this.arenaGateWall, true);
      this.platforms.add(this.arenaGateWall);

      // Visual gate: fiery volcanic blocks
      this.arenaGateVisual = this.add.container(2090, 340);
      for (let gy = -40; gy <= 40; gy += 24) {
        const block = this.add.image(0, gy, 'crate').setScale(1.1).setTint(0x551100);
        this.arenaGateVisual.add(block);
      }
      this.arenaGateVisual.setDepth(15);

      this.bossHealthBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_DEMON.NAME, GAME_CONFIG.MOBS.BOSS_DEMON.HP);
      this.boss = new BossDemon(this, 2380, 220, this.bossHealthBar);
      this.enemies.add(this.boss);
      this.boss.nextActionTime = this.time.now + 999999;

      this.startDialogue([
        { speaker: 'IGNIS', text: 'SUCH SWEET FRAGILE FLESH TO BURN IN MY CALDERA! YOU DARE TREAD UPON MY FLAMES?!' },
        { speaker: 'LUNA', text: 'Your hellfire ends here, Ignis! The heat of your fury cannot melt the silver blade!' },
        { speaker: 'IGNIS', text: 'THEN ASHES BECOME YOUR TOMB! WITNESS THE CINDER SKY!' },
        { speaker: 'LUNA', text: 'Sylva, hold on! We strike through the inferno!' }
      ], () => {
        if (this.boss && this.boss.active) {
          this.boss.nextActionTime = this.time.now + 600;
        }
        this.showBossWarningBanner(GAME_CONFIG.MOBS.BOSS_DEMON.NAME, 'PYROMANCER OF THE OBSIDIAN DEEP');
      });
    } else if (chapter === 5) {
      if (this.player) {
        if (this.player.x < 2120) this.player.x = 2120;
        if (this.player.y > 346) this.player.y = 346;
        if (this.player.body) this.player.setVelocity(0, 0);
      }
      // Restrict camera to Chapter 5 Umbra Pinnacle Arena
      this.cameras.main.setBounds(2080, 0, 520, this.levelHeight);

      // Arena barricade gate at x = 2090
      this.arenaGateWall = this.add.rectangle(2090, 340, 20, 100, 0x000000, 0);
      this.physics.add.existing(this.arenaGateWall, true);
      this.platforms.add(this.arenaGateWall);

      // Visual gate: cosmic astral blocks
      this.arenaGateVisual = this.add.container(2090, 340);
      for (let gy = -40; gy <= 40; gy += 24) {
        const block = this.add.image(0, gy, 'crate').setScale(1.1).setTint(0x110022);
        this.arenaGateVisual.add(block);
      }
      this.arenaGateVisual.setDepth(15);

      this.bossHealthBar = new BossHealthBar(this, GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.NAME, GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.HP);
      this.boss = new BossNightBorne(this, 2400, 340, this.bossHealthBar);
      this.enemies.add(this.boss);
      this.physics.add.collider(this.boss, this.platforms);
      this.boss.nextActionTime = this.time.now + 999999;

      this.startDialogue([
        { speaker: 'UMBRA', text: 'At last... The final thread of moonlight arrives. Do you truly believe you can mend the shattered cosmos?' },
        { speaker: 'LUNA', text: 'Umbra! The Moon was never meant to rule in shadow. We are Wardens, not conquerors!' },
        { speaker: 'UMBRA', text: 'The light was weak! In the void of the eclipse, we are eternal! BOW BEFORE THE VOID!' },
        { speaker: 'LUNA', text: 'Never! By the radiance of the silver crest—LET THERE BE LIGHT!' }
      ], () => {
        if (this.boss && this.boss.active) {
          this.boss.nextActionTime = this.time.now + 600;
        }
        this.showBossWarningBanner(GAME_CONFIG.MOBS.BOSS_NIGHTBORNE.NAME, 'SOVEREIGN OF THE SHATTERED MOON');
      });
    }
  }

  showBossWarningBanner(name, subtitle) {
    sound.playBGM('boss');
    if (this.bossBattleBanner) {
      this.bossBattleBanner.destroy();
      this.bossBattleBanner = null;
    }

    const w = GAME_CONFIG.WIDTH;
    const banner = this.add.container(w / 2, 84).setScrollFactor(0).setDepth(480);
    this.bossBattleBanner = banner;

    const bg = this.add.rectangle(0, 0, 360, 36, 0x1f0606, 0.9);
    bg.setStrokeStyle(1.5, 0xff2222);
    banner.add(bg);

    const warn = this.add.text(0, -9, `⚠️ BOSS BATTLE: ${name} ⚠️`, {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#ffdd44'
    }).setOrigin(0.5);
    banner.add(warn);

    const sub = this.add.text(0, 7, subtitle, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#ff9999'
    }).setOrigin(0.5);
    banner.add(sub);

    this.tweens.add({
      targets: banner,
      alpha: 0,
      y: 64,
      delay: 2400,
      duration: 600,
      onComplete: () => {
        if (this.bossBattleBanner === banner) this.bossBattleBanner = null;
        banner.destroy();
      }
    });
  }

  openArenaGate() {
    if (this.arenaGateWall) {
      this.platforms.remove(this.arenaGateWall);
      this.arenaGateWall.destroy();
      this.arenaGateWall = null;
    }

    if (this.arenaGateVisual) {
      this.tweens.add({
        targets: this.arenaGateVisual,
        alpha: 0,
        y: this.arenaGateVisual.y + 40,
        duration: 800,
        onComplete: () => {
          if (this.arenaGateVisual) {
            this.arenaGateVisual.destroy();
            this.arenaGateVisual = null;
          }
        }
      });
    }

    // Unlock camera bounds back to entire level
    this.cameras.main.setBounds(0, 0, this.levelWidth, this.levelHeight);
  }

  spawnCrate(x, y) {
    const crate = new Crate(this, x, y);
    this.crates.add(crate);
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

  createStoryHUD() {
    const w = GAME_CONFIG.WIDTH;

    // HUD Top Bar Container (Fixed to Camera)
    this.hudContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(200);

    // Top background panel
    const bar = this.add.rectangle(w / 2, 14, w, 28, 0x0a140a, 0.85);
    bar.setStrokeStyle(1, 0x224422);
    this.hudContainer.add(bar);

    // Chapter name & Objective
    this.txtChapter = this.add.text(12, 6, `CH.${this.chapterId}: ${this.chapterConfig.title}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#f6c026'
    });
    this.hudContainer.add(this.txtChapter);

    this.txtObjective = this.add.text(12, 17, `OBJECTIVE: Cleanse Guardian Obelisk`, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#d0f0c0'
    });
    this.hudContainer.add(this.txtObjective);
    this.updateHudObjective();

    // Hero Health Bar
    this.heroHealthBar = new HeroHealthBar(this, 240, 14, this.player ? this.player.maxHealth : GAME_CONFIG.PLAYER.MAX_HEALTH);
    this.hudContainer.add(this.heroHealthBar);

    // Materials Counter
    this.txtMaterials = this.add.text(w - 12, 10, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#98ff20'
    }).setOrigin(1, 0);
    this.hudContainer.add(this.txtMaterials);
    this.updateHudMaterials();

    // Shard Harvest Counter (2 G$ per shard)
    this.txtHarvest = this.add.text(w - 12, 22, '💎 +0 G$', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#38e1ff'
    }).setOrigin(1, 0);
    this.hudContainer.add(this.txtHarvest);

    // Combo Counter (Center Screen, below Boss Health Bar)
    this.txtCombo = this.add.text(w / 2, 70, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '9px',
      color: '#ffd700',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  updateHudMaterials() {
    const mats = storage.getMaterials();
    this.txtMaterials.setText(`🌲${mats.bark} 🍯${mats.amber} ⚙️${mats.iron}`);
  }

  checkDailyHarvestCap() {
    const st = this.rewardsStatus?.crystalStatus;
    const earned = Number(st?.gdEarned || 0);
    const cap = Number(st?.dailyCapGd ?? DAILY_SHARD_CAP_GD);
    const sessionEarned = (this.sessionCrystalsCollected || 0) * SHARD_RATE_GD;
    this.isDailyHarvestCapped = earned + sessionEarned >= cap || Boolean(st?.isCapped);
    this.updateHudHarvest();
  }

  updateHudHarvest() {
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


  updateHearts() {
    if (!this.player) return;
    if (this.heroHealthBar) {
      this.heroHealthBar.updateHealth(this.player.health, this.player.maxHealth);
    }
  }

  showChapterIntroCard() {
    this.inDialogue = true;
    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }
    this.physics.pause();
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    const card = this.add.container(w / 2, h / 2).setScrollFactor(0).setDepth(300);
    this.chapterIntroCard = card;
    const box = this.add.rectangle(0, 0, 320, 80, 0x112211, 0.95);
    box.setStrokeStyle(2, 0x3c6e3c);
    card.add(box);

    const title = this.add.text(0, -20, `CHAPTER ${this.chapterId}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '11px',
      color: '#f6c026'
    }).setOrigin(0.5);
    card.add(title);

    const name = this.add.text(0, -2, this.chapterConfig.title, {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#ffffff'
    }).setOrigin(0.5);
    card.add(name);

    const desc = this.add.text(0, 16, this.chapterConfig.description, {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#7da57d',
      align: 'center',
      wordWrap: { width: 280 }
    }).setOrigin(0.5);
    card.add(desc);

    const advanceIntro = () => {
      if (!this.chapterIntroCard) return;
      this.input.off('pointerdown', pointerHandler);
      if (this.game && this.game.canvas) {
        this.game.canvas.removeEventListener('pointerdown', canvasHandler);
      }
      this.chapterIntroCard.destroy();
      this.chapterIntroCard = null;
      this.triggerChapterOpeningDialogue();
    };

    const pointerHandler = () => advanceIntro();
    this.input.once('pointerdown', pointerHandler);

    const canvasHandler = () => advanceIntro();
    if (this.game && this.game.canvas) {
      this.game.canvas.addEventListener('pointerdown', canvasHandler, { once: true });
    }
    box.setInteractive({ useHandCursor: true }).on('pointerdown', advanceIntro);

    this.time.delayedCall(2400, () => {
      if (!this.chapterIntroCard) return;
      this.tweens.add({
        targets: card,
        alpha: 0,
        y: h / 2 - 20,
        duration: 400,
        onComplete: () => {
          if (this.chapterIntroCard === card) this.chapterIntroCard = null;
          card.destroy();
          this.triggerChapterOpeningDialogue();
        }
      });
    });
  }

  triggerChapterOpeningDialogue() {
    if (this.chapterId === 1) {
      this.startDialogue([
        { speaker: 'COMPANION', text: 'Selene! Look at the lake shoreline... the water is thick with jagged purple crystals!' },
        { speaker: 'LUNA', text: 'The Pale Blight has spread this far... The Shrine of Whispering Waters is in grave danger.' },
        { speaker: 'COMPANION', text: 'Chieftain Gorgok is guarding the glade ahead, but the crystal madness has taken him. Be careful!' },
        { speaker: 'LUNA', text: 'We must free Gorgok from his pain and cleanse the sacred Obelisk. To the glade!' }
      ]);
    } else if (this.chapterId === 2) {
      this.startDialogue([
        { speaker: 'LUNA', text: 'The air up here smells of scorched honey and sulfur... We have reached the Golden Canopy.' },
        { speaker: 'COMPANION', text: 'Archmage Malakor has built alchemical extraction rigs into the elder boughs!' },
        { speaker: 'LUNA', text: 'He is siphoning the fallen moon shards to forge forbidden arcana. His arrogance ends now.' }
      ]);
    } else if (this.chapterId === 3) {
      this.startDialogue([
        { speaker: 'LUNA', text: 'The Sunken Ruins... we have descended to the subterranean roots of the World-Tree.' },
        { speaker: 'COMPANION', text: 'I sense a grim presence guarding the tomb... Vorgath, the fallen Bone Sovereign!' },
        { speaker: 'LUNA', text: 'His shield was once unbreakable, but the Moonshard strikes true. We must shatter his guard!' }
      ]);
    } else if (this.chapterId === 4) {
      this.startDialogue([
        { speaker: 'LUNA', text: 'The temperature is rising rapidly... We have entered the Obsidian Caldera.' },
        { speaker: 'COMPANION', text: 'Watch your step, Selene! The ground below is collapsing into molten lava pools!' },
        { speaker: 'LUNA', text: 'And soaring above the magma is Ignis, the Cinder Drake. Prepare your leaps -- we fight across the embers!' }
      ]);
    } else if (this.chapterId === 5) {
      this.startDialogue([
        { speaker: 'LUNA', text: 'The Lunar Spire... we have transcended the mortal realm into the cosmic firmament.' },
        { speaker: 'COMPANION', text: 'Selene! The Moon\'s core is fracturing! Umbra is siphoning the very starlight of the heavens!' },
        { speaker: 'LUNA', text: 'This is the final battle for the cosmos. For the Moon, for Sylva, and for all life—let\'s bring back the dawn!' }
      ]);
    }
  }

  startDialogue(lines, onComplete) {
    if (this.chapterIntroCard) {
      this.chapterIntroCard.destroy();
      this.chapterIntroCard = null;
    }
    if (this.dialogueBox) {
      this.dialogueBox.destroy();
      this.dialogueBox = null;
    }
    this.inDialogue = true;
    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }
    pauseService.hideButtons();
    this.physics.pause();
    if (this.player && this.player.body) {
      this.player.setVelocity(0, 0);
      this.player.play('player_idle', true);
    }
    if (this.enemies) {
      this.enemies.getChildren().forEach(e => {
        if (e.body) {
          e.body.setVelocity(0, 0);
        }
        if (e.attackCooldownUntil !== undefined) {
          e.attackCooldownUntil = this.time.now + 2500;
        }
        if (e.nextActionTime !== undefined) {
          e.nextActionTime = this.time.now + 2500;
        }
      });
    }
    // Clear in-flight projectiles so player is not hit during dialogue
    if (this.projectiles) {
      this.projectiles.clear(true, true);
    }

    const currentChapter = this.chapterId;
    const box = new StoryDialogueBox(this);
    this.dialogueBox = box;
    box.startDialogue(lines, () => {
      if (!this.scene || !this.scene.isActive() || this.chapterId !== currentChapter) return;
      this.dialogueBox = null;
      this.inDialogue = false;
      this.physics.resume();

      // Give player a 1.2s grace window after dialogue before mobs attack
      if (this.enemies) {
        this.enemies.getChildren().forEach(e => {
          if (e.attackCooldownUntil !== undefined) {
            e.attackCooldownUntil = this.time.now + 1200;
          }
          if (e.nextActionTime !== undefined) {
            e.nextActionTime = this.time.now + 1200;
          }
        });
      }

      if (!this.isVictory && (!this.player || !this.player.isDead)) {
        if (typeof window !== 'undefined' && window.touchController) {
          window.touchController.show();
        }
        pauseService.showButtons();
      }
      if (onComplete) onComplete();
    });
    return box;
  }

  handlePlayerAttackEnemy(enemy) {
    if (!this.player.isAttacking || enemy.state === 'DEAD') return;

    // Direction check: ensure player is facing the enemy for horizontal attacks
    if (this.player.attackType !== 'upward') {
      const enemyCenterX = enemy.body ? enemy.body.center.x : enemy.x;
      if (!this.player.flipX && enemyCenterX < this.player.x) return;
      if (this.player.flipX && enemyCenterX > this.player.x) return;
    }

    const dmg = this.player.getAttackDamage();
    const isUpward = this.player.attackType === 'upward';
    const res = enemy.takeDamage(dmg, this.player.x, isUpward);

    if ((res && res.killed) || enemy.state === 'DEAD' || (enemy.hp !== undefined && enemy.hp <= 0)) {
      this.killsCount++;
      this.registerComboHit();
      this.onEnemyKilled();

      // Drop materials directly to storage
      if (enemy.mobType === 'boar') {
        storage.addMaterials({ bark: 1, iron: 1 });
      } else if (enemy.mobType === 'bee') {
        storage.addMaterials({ amber: 1 });
      } else if (enemy.mobType === 'snail') {
        storage.addMaterials({ bark: 1 });
      } else if (enemy.mobType === 'mushroom') {
        storage.addMaterials({ bark: 1, amber: 1 });
      } else if (enemy.mobType === 'flying_eye') {
        storage.addMaterials({ amber: 1, iron: 1 });
      } else if (enemy.mobType === 'goblin') {
        storage.addMaterials({ iron: 2, bark: 1 });
      } else if (enemy.mobType === 'bog_lurker' || enemy.mobType === 'mirelurker') {
        storage.addMaterials({ bark: 1, amber: 1 });
      } else if (enemy.mobType === 'dread_bat' || enemy.mobType === 'hornet_guard') {
        storage.addMaterials({ amber: 2 });
      } else if (enemy.mobType === 'crypt_wraith' || enemy.mobType === 'skeleton_warrior') {
        storage.addMaterials({ iron: 2 });
      } else if (enemy.mobType === 'basalt_golem' || enemy.mobType === 'cinder_drake') {
        storage.addMaterials({ amber: 1, iron: 2 });
      } else if (enemy.mobType === 'void_stalker' || enemy.mobType === 'astral_shade') {
        storage.addMaterials({ amber: 2, iron: 1 });
      }
      this.updateHudMaterials();

      // Shard drop (2 G$ each, paid after UTC midnight) - rare drops!
      if (this.shardDrops) {
        const isBoss = enemy.mobType && enemy.mobType.startsWith('boss');
        const eliteTypes = ['bog_lurker', 'dread_bat', 'crypt_wraith', 'basalt_golem', 'void_stalker', 'hornet_guard', 'skeleton_warrior', 'cinder_drake', 'astral_shade', 'mirelurker'];
        const isElite = eliteTypes.includes(enemy.mobType);
        const chance = isBoss ? 1.0 : (isElite ? 0.15 : 0.05);
        if (Math.random() < chance) {
          const crystal = new ShardDrop(this, enemy.x, enemy.y - 8);
          this.shardDrops.add(crystal);
        }
      }
    }
  }

  onEnemyShattered(enemy) {
    if (!enemy) return;
    this.killsCount++;
    this.registerComboHit();
    this.onEnemyKilled();
    storage.addMaterials({ bark: 1 });
    this.updateHudMaterials();

    if (this.shardDrops && Math.random() < 0.05) {
      const crystal = new ShardDrop(this, enemy.x, enemy.y - 8);
      this.shardDrops.add(crystal);
    }
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


  handlePlayerEnemyCollision(enemy) {
    if (this.inDialogue || this.player.isDead || enemy.state === 'DEAD' || enemy.state === 'STUNNED') return;

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
          enemy.takeDamage(35, this.player.x);
          this.registerComboHit(true);
        } else if (enemy.state === 'SHELLED') {
          const kickDir = this.player.flipX ? -1 : 1;
          enemy.kickShell(kickDir);
          this.registerComboHit(true);
        } else if (enemy.state === 'SLIDING') {
          const res = enemy.takeDamage(99, this.player.x);
          if (res && res.killed) {
            this.onEnemyShattered(enemy);
          }
        }
      } else if (enemy.mobType === 'boss_gorgok') {
        enemy.takeDamage(25, this.player.x);
        this.registerComboHit(true);
      } else {
        const res = enemy.takeDamage(35, this.player.x);
        this.registerComboHit(true);
        if ((res && res.killed) || enemy.state === 'DEAD' || (enemy.hp !== undefined && enemy.hp <= 0)) {
          this.killsCount++;
          this.onEnemyKilled();
          if (typeof storage !== 'undefined') {
            storage.addMaterials({ bark: 1, iron: 1 });
            this.updateHudMaterials();
          }
        }
      }
      return; // Successfully stomped: evade all player damage!
    }

    // Snail in SHELLED or SLIDING state horizontal collision
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
          this.handlePlayerGameOver();
        }
      }
      return;
    }

    // Normal damage
    const knockDir = enemy.x < this.player.x ? 1 : -1;
    const enemyDmg = enemy.damage || (enemy.mobType && GAME_CONFIG.MOBS[enemy.mobType.toUpperCase()]?.DAMAGE) || 20;
    const damaged = this.player.takeDamage(enemyDmg, knockDir);
    if (damaged) {
      this.comboCount = 0;
      this.updateHearts();
      if (this.player.isDead) {
        this.handlePlayerGameOver();
      }
    }
  }

  handleHazardHit(player, hazard) {
    if (player.isDead || this.inDialogue) return;

    // 1. Lava Geyser eruption column hit
    if (hazard && hazard.isLavaGeyser) {
      const damaged = player.takeDamage(28, player.flipX ? 1 : -1);
      if (damaged) {
        this.updateHearts();
        sound.playHit();
        this.cameras.main.shake(160, 0.02);
        this.showFloatingText(player.x, player.y - 20, 'LAVA GEYSER! 🔥', '#ff6600');
        player.setVelocityY(-260);
        player.setVelocityX(player.flipX ? 140 : -140);
        if (player.isDead) {
          this.handlePlayerGameOver();
        }
      }
      return;
    }

    // 2. Entering molten lava pit = INSTANT DEATH
    const isLava = (this.chapterId === 4) || (hazard && hazard.isLava) || (hazard && hazard.hazardLabel && hazard.hazardLabel.includes('LAVA'));
    if (isLava) {
      player.health = 0;
      this.updateHearts();
      sound.playHit();
      this.cameras.main.shake(500, 0.035);
      this.showFloatingText(player.x, player.y - 20, 'INCINERATED BY LAVA! ☠️', '#ff3300');

      // Incineration flame particles
      for (let i = 0; i < 24; i++) {
        const flame = this.add.circle(player.x, player.y + 10, Phaser.Math.Between(4, 9), 0xff4400, 0.9);
        this.physics.add.existing(flame);
        flame.body.setVelocity(Phaser.Math.Between(-140, 140), Phaser.Math.Between(-260, -60));
        flame.body.setGravityY(350);
        this.tweens.add({
          targets: flame,
          alpha: 0,
          scale: 0.2,
          duration: 700,
          onComplete: () => flame.destroy()
        });
      }

      player.die();
      this.handlePlayerGameOver();
      return;
    }

    // 3. Other hazards (water, honeycomb, spikes, astral chasm)
    const damaged = player.takeDamage(35, player.flipX ? 1 : -1);
    if (damaged) {
      this.updateHearts();
      const label = (hazard && hazard.hazardLabel) ? `${hazard.hazardLabel} -35` : 'CHASM HAZARD! -35';
      this.showFloatingText(player.x, player.y - 20, label, '#ff4444');

      // Play chapter-specific hazard splash audio & particle burst
      this.triggerHazardFX(player, hazard);

      if (player.isDead) {
        this.handlePlayerGameOver();
        return;
      }

      // Feature 1: Safe ledge respawn (Hollow Knight / Celeste style)
      this.respawnPlayerAtSafeLedge(player);
    }
  }

  triggerHazardFX(player, hazard) {
    const px = player.x;
    const py = player.y;

    if (this.chapterId === 1) {
      // Water Splash
      sound.playWaterSplash();
      for (let i = 0; i < 16; i++) {
        const drop = this.add.circle(px + Phaser.Math.Between(-14, 14), py + 10, Phaser.Math.Between(2, 5), 0x38bdf8, 0.9).setDepth(20);
        this.physics.add.existing(drop);
        drop.body.setVelocity(Phaser.Math.Between(-80, 80), Phaser.Math.Between(-220, -90));
        drop.body.setGravityY(450);
        this.tweens.add({
          targets: drop,
          alpha: 0,
          scale: 0.2,
          duration: 450 + i * 20,
          onComplete: () => drop.destroy()
        });
      }
    } else if (this.chapterId === 2) {
      // Gooey Amber Honey Splash
      sound.playHoneySquish();
      for (let i = 0; i < 16; i++) {
        const drop = this.add.circle(px + Phaser.Math.Between(-12, 12), py + 10, Phaser.Math.Between(3, 6), 0xffaa00, 0.95).setDepth(20);
        this.physics.add.existing(drop);
        drop.body.setVelocity(Phaser.Math.Between(-60, 60), Phaser.Math.Between(-180, -70));
        drop.body.setGravityY(350);
        this.tweens.add({
          targets: drop,
          alpha: 0,
          scale: 0.3,
          duration: 550 + i * 25,
          onComplete: () => drop.destroy()
        });
      }
    } else if (this.chapterId === 3) {
      // Ancient Spikes Impale
      sound.playSpikeHit();
      for (let i = 0; i < 14; i++) {
        const spark = this.add.rectangle(px + Phaser.Math.Between(-10, 10), py + 8, 3, 3, 0xdddddd, 0.9).setDepth(20);
        this.physics.add.existing(spark);
        spark.body.setVelocity(Phaser.Math.Between(-100, 100), Phaser.Math.Between(-160, -50));
        spark.body.setGravityY(350);
        this.tweens.add({
          targets: spark,
          alpha: 0,
          duration: 350,
          onComplete: () => spark.destroy()
        });
      }
    } else if (this.chapterId === 5) {
      // Cosmic Astral Chasm Void
      sound.playElementalSlash('frost_moon');
      for (let i = 0; i < 16; i++) {
        const star = this.add.circle(px + Phaser.Math.Between(-14, 14), py + 10, Phaser.Math.Between(2, 5), 0xc084fc, 0.85).setDepth(20);
        this.tweens.add({
          targets: star,
          scale: 1.8,
          alpha: 0,
          y: star.y - Phaser.Math.Between(20, 50),
          duration: 450 + i * 20,
          onComplete: () => star.destroy()
        });
      }
    } else {
      sound.playHit();
    }
  }

  respawnPlayerAtSafeLedge(player) {
    let rx = player.lastSafeX;
    let ry = player.lastSafeY;

    // Validate whether candidate rx is situated safely on a registered ground segment away from hazards
    const isOverHazard = (x) => this.hazards?.getChildren()?.some(h => {
      const hb = h.body;
      return hb && x >= hb.left - 20 && x <= hb.right + 20;
    });

    const isSafeOnGround = (x) => this.groundSegments?.some(s => x >= s.x1 + 35 && x <= s.x2 - 35);

    if (!rx || isOverHazard(rx) || !isSafeOnGround(rx)) {
      // Find the nearest ground segment to the left of the player's fall location
      const leftSegments = (this.groundSegments || []).filter(s => s.x2 <= player.x).sort((a, b) => b.x2 - a.x2);
      const chosenSeg = leftSegments[0] || (this.groundSegments && this.groundSegments[0]);
      if (chosenSeg) {
        rx = chosenSeg.x2 - 45;
        ry = chosenSeg.y - 34;
      } else {
        rx = this.chapterId === 1 ? 60 : 40;
        ry = 346;
      }
    }

    player.lastSafeX = rx;
    player.lastSafeY = ry;

    // Reset player velocity, state and position at safe ledge
    player.setVelocity(0, 0);
    if (player.body) {
      player.body.reset(rx, ry);
      player.body.velocity.x = 0;
      player.body.velocity.y = 0;
    }
    player.state = 0;

    // Camera quick pan to safe ledge
    this.cameras.main.pan(rx, ry - 28, 200, 'Quad.easeOut');

    // Recovery dust puff at respawn location
    const puff = this.add.circle(rx, ry + 12, 14, 0xffffff, 0.75).setDepth(21);
    this.tweens.add({
      targets: puff,
      scale: 2.2,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeOut',
      onComplete: () => puff.destroy()
    });

    // Grace period invulnerability & player recovery blink
    player.invulnerableUntil = this.time.now + 2000;
    player.setAlpha(0.3);
    this.tweens.add({
      targets: player,
      alpha: 1.0,
      duration: 150,
      yoyo: true,
      repeat: 4,
      onComplete: () => {
        if (player && !player.isDead) player.setAlpha(1.0);
      }
    });
  }

  registerComboHit(isRicochet = false) {
    this.comboCount += isRicochet ? 2 : 1;
    this.comboTimer = this.time.now + 2500;

    const mul = (1.0 + (this.comboCount * 0.1)).toFixed(1);
    this.txtCombo.setText(`COMBO x${mul}!`);
    this.txtCombo.setAlpha(1);

    this.tweens.add({
      targets: this.txtCombo,
      scale: { from: 1.3, to: 1.0 },
      duration: 150
    });
  }

  /**
   * Settle the run with the server, once per life (runs.finish is idempotent, and the scene's own guards keep a second
   * outcome from being reported). The totals are taken at this moment: kills and shards that come later, while the scene
   * keeps running behind the end screen, are not part of the run and are not described by it.
   */
  settleRun(bossCleared) {
    this.settledShards = this.sessionCrystalsCollected || 0;
    const epoch = this.runEpoch;
    return runs.finish({
      score: 0,
      kills: this.killsCount,
      shards: this.settledShards,
      durationMs: Math.round(this.activeClock.ms),
      bossCleared,
    }).then((res) => {
      // The first-boss bounty itself is claimed from the G$ wallet panel; refresh it so it sees this run.
      const refreshed = gdService.refreshAll().catch(() => {});
      // The scene is reused when a life restarts, and a slow answer can arrive after that: it belongs to the life that
      // has ended, not to the one on screen.
      if (epoch === this.runEpoch) {
        this.runResult = res;
        this.runRefreshPromise = refreshed;
      }
      return res;
    });
  }

  triggerChapterVictory() {
    if (this.isVictory || this.isGameOver) return;
    this.isVictory = true;
    sound.playVictory();
    pauseService.hideButtons();

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Mark progression in Storage
    storage.markChapterComplete(this.chapterId, this.killsCount);

    if (this.chapterIntroCard) {
      this.chapterIntroCard.destroy();
      this.chapterIntroCard = null;
    }

    this.runResultPromise = this.settleRun(true);

    if (this.chapterId === 1) {
      this.startDialogue([
        { speaker: 'SHRINE', text: '✨ "The first root inhales pure moonlight. The waters run crystal-clear once more."' },
        { speaker: 'COMPANION', text: 'Gorgok is at peace, Selene! But the golden canopy above is still shrouded in dark arcana. Onward!' }
      ], () => {
        this.showVictoryBanner();
      });
    } else if (this.chapterId === 2) {
      this.startDialogue([
        { speaker: 'SHRINE', text: '✨ "The Golden Hive hums in harmony. The false sorcerer is broken, and the boughs are cleansed."' },
        { speaker: 'LUNA', text: 'Only the Sunken Ruins remain below. The primordial Heart Shard awaits in the abyss.' }
      ], () => {
        this.showVictoryBanner();
      });
    } else if (this.chapterId === 3) {
      this.startDialogue([
        { speaker: 'SHRINE', text: '✨ "The crypt falls quiet as Vorgath\'s soul finds eternal peace. The subterranean seal unlocks."' },
        { speaker: 'LUNA', text: 'Beyond this crypt lies the Obsidian Caldera... The heat of the molten deep awaits!' }
      ], () => {
        this.showVictoryBanner();
      });
    } else if (this.chapterId === 4) {
      this.startDialogue([
        { speaker: 'SHRINE', text: '✨ "The Cinder Drake collapses into embers. The magma calms, revealing a stairway of pure starlight."' },
        { speaker: 'LUNA', text: 'Sylva, look up! The Lunar Spire pierces into the cosmos... to Umbra!' }
      ], () => {
        this.showVictoryBanner();
      });
    } else if (this.chapterId === 5) {
      this.startDialogue([
        { speaker: 'SHRINE', text: '✨ "THE SHATTERED MOON IS RESTORED! Pure celestial light cascades across the entire cosmos!"' },
        { speaker: 'LUNA', text: 'We did it, Sylva... The darkness is banished, and the Silver Dawn has arrived!' }
      ], () => {
        this.showVictoryBanner();
      });
    }
  }

  /**
   * The Shard Harvest line of an end screen, or null when there is nothing to say. It follows what the server accepted
   * (gd/runs.js): "pending G$" only for a verified, recorded, unflagged run.
   * `underBountyLine`: it sits under the victory banner's bounty line, which already says what a player who is not
   * connected or verified is missing and why a run was not recorded. The death screen has no such line, so there the
   * Shard line says it itself.
   */
  shardsBadge({ underBountyLine = false } = {}) {
    if (this.isDailyHarvestCapped || this.rewardsStatus?.crystalStatus?.isCapped) {
      return { text: `🔒 Daily Shard Cap reached (${DAILY_SHARD_CAP_GD} G$) • Resets 00:00 UTC`, color: TONE_COLOR.warn };
    }
    if (!(this.settledShards > 0)) return null;
    const st = gdService.getStatus();
    if (underBountyLine && !(st.connected && st.verified)) return null;
    const line = shardsLine({
      shards: this.settledShards,
      rateG: SHARD_RATE_GD,
      connected: st.connected,
      verified: st.verified,
      result: this.runResult || undefined,
      brief: underBountyLine,
    });
    return { text: `${line.icon} ${line.text}`, color: TONE_COLOR[line.tone] };
  }

  /** The reward lines of the victory banner: what the server accepted, not what the player did. */
  bountyBadge() {
    const st = gdService.getStatus();
    const boss = bossLine({
      connected: st.connected,
      verified: st.verified,
      result: this.runResult || undefined,
      alreadyClaimed: Boolean(this.rewardsStatus?.firstBossClaimed),
      rewardG: st.bounty?.rewardG, // the player's real share, when the server says so; no amount otherwise
    });
    const shards = this.shardsBadge({ underBountyLine: true });
    return {
      text: `${boss.icon} ${boss.text}`.toUpperCase(),
      color: TONE_COLOR[boss.tone],
      shards: shards && { ...shards, text: shards.text.toUpperCase() },
    };
  }

  showVictoryBanner() {
    sound.playBGM('victory');
    pauseService.hideButtons();
    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Celebration Confetti
    try {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.55 }
      });
    } catch (e) {}

    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    this.victoryInputReadyTime = performance.now() + 350; // brief delay so final attack swing doesn't accidentally skip

    // Victory Banner Container
    const banner = this.add.container(w / 2, h / 2).setScrollFactor(0).setDepth(500);

    // Dim background overlay (interactive to block touches underneath)
    const overlay = this.add.rectangle(0, 0, w, h, 0x000000, 0.65).setInteractive();
    banner.add(overlay);

    const nextCh = this.chapterId < 5 ? this.chapterId + 1 : null;
    const boxHeight = nextCh ? 180 : 156;
    const box = this.add.rectangle(0, 0, 396, boxHeight, 0x0b2110, 0.96);
    box.setStrokeStyle(2, 0xf6c026);
    banner.add(box);

    const title = this.add.text(0, -boxHeight / 2 + 20, '✨ SHRINE CLEANSED! ✨', {
      fontFamily: 'Press Start 2P',
      fontSize: '11px',
      color: '#f6c026'
    }).setOrigin(0.5);
    banner.add(title);

    const subTitleText = nextCh ? `Chapter ${this.chapterId} Cleared! | Foes Cleansed: ${this.killsCount}` : `Cosmos Restored! All 5 Shrines Cleansed!`;
    const msg = this.add.text(0, -boxHeight / 2 + 37, subTitleText, {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#b0f0b0'
    }).setOrigin(0.5);
    banner.add(msg);

    // Bounty line, and under it the Shard Harvest line. Both start from what is known now ("Saving your run...") and
    // are redrawn when the server's answer arrives, and again once the wallet status has been refreshed (which is where
    // the bounty amount comes from).
    const badgeStyle = (color) => ({
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color,
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      wordWrap: { width: 372 },
    });
    // Anchored by their tops: the bounty line may wrap onto a second line (slow font, narrow screen), and the Shard line
    // is stacked under whatever height it ended up with, so the two can never overlap.
    const rewardBadge = this.add.text(0, -boxHeight / 2 + 45, '', badgeStyle('#a0c4a0')).setOrigin(0.5, 0);
    const shardBadge = this.add.text(0, 0, '', badgeStyle(TONE_COLOR.shard)).setOrigin(0.5, 0);
    banner.add(rewardBadge);
    banner.add(shardBadge);
    const renderBadges = () => {
      if (!rewardBadge.active) return;
      const next = this.bountyBadge();
      rewardBadge.setText(next.text).setColor(next.color);
      shardBadge.setText(next.shards?.text ?? '').setColor(next.shards?.color ?? TONE_COLOR.muted);
      shardBadge.setY(rewardBadge.y + rewardBadge.height + 1);
    };
    renderBadges();
    this.runResultPromise
      ?.then(() => {
        renderBadges();
        return this.runRefreshPromise;
      })
      .then(renderBadges);


    let actionTaken = false;
    const cleanup = () => {
      this.input.off('pointerdown', onScenePointerDown);
      this.input.keyboard.off('keydown', onKeyDown);
      if (this.game && this.game.canvas) {
        this.game.canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      }
      this.activeVictoryCleanup = null;
    };
    this.activeVictoryCleanup = cleanup;

    const doAdvance = () => {
      if (actionTaken || performance.now() < this.victoryInputReadyTime) return;
      actionTaken = true;
      cleanup();
      sound.playCoin();
      if (nextCh) {
        this.scene.restart({ chapter: nextCh });
      } else {
        this.scene.start('MenuScene');
      }
    };

    const doRetry = () => {
      if (actionTaken || performance.now() < this.victoryInputReadyTime) return;
      actionTaken = true;
      cleanup();
      sound.playCoin();
      this.scene.restart({ chapter: this.chapterId });
    };

    const doMenu = () => {
      if (actionTaken || performance.now() < this.victoryInputReadyTime) return;
      actionTaken = true;
      cleanup();
      sound.playCoin();
      this.scene.start('MenuScene');
    };

    this.victoryAdvanceCallback = nextCh ? doAdvance : doMenu;

    const buttons = [];
    const createBtn = (relX, relY, bw, bh, bgCol, borderCol, textCol, label, action) => {
      const btnRect = this.add.rectangle(relX, relY, bw, bh, bgCol)
        .setStrokeStyle(1.5, borderCol)
        .setInteractive({ useHandCursor: true });
      banner.add(btnRect);

      const btnLabel = this.add.text(relX, relY, label, {
        fontFamily: 'Press Start 2P',
        fontSize: '7px',
        color: textCol
      }).setOrigin(0.5);
      banner.add(btnLabel);

      const setHover = (hover) => {
        const s = hover ? 1.03 : 1.0;
        btnRect.setScale(s);
        btnLabel.setScale(s);
      };

      btnRect.on('pointerover', () => setHover(true));
      btnRect.on('pointerout', () => setHover(false));
      btnRect.on('pointerdown', action);

      buttons.push({
        minX: (w / 2 + relX) - bw / 2,
        maxX: (w / 2 + relX) + bw / 2,
        minY: (h / 2 + relY) - bh / 2,
        maxY: (h / 2 + relY) + bh / 2,
        action
      });

      return { btnRect, btnLabel };
    };

    if (nextCh) {
      // Advance to next chapter
      createBtn(0, 0, 280, 26, 0x1d5828, 0x76ee76, '#ffffff', `ADVANCE TO CHAPTER ${nextCh} ➔`, doAdvance);
      // Secondary options: Retry Chapter or Main Menu
      createBtn(-78, 36, 140, 24, 0x223322, 0x55aa55, '#88ee88', '↺ RETRY', doRetry);
      createBtn(78, 36, 140, 24, 0x332818, 0xee9933, '#ffcc77', '◄ MAIN MENU', doMenu);
    } else {
      // Replay Chapter or Main Menu
      createBtn(-80, 14, 150, 28, 0x223322, 0x55aa55, '#88ee88', '↺ REPLAY CHAPTER', doRetry);
      createBtn(80, 14, 150, 28, 0x332818, 0xee9933, '#ffcc77', '◄ MAIN MENU', doMenu);
    }

    const hintY = nextCh ? 62 : 48;
    const hintText = this.add.text(0, hintY, '▶ SELECT AN OPTION TO CONTINUE ◀', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#f6c026'
    }).setOrigin(0.5);
    banner.add(hintText);

    this.tweens.add({
      targets: hintText,
      alpha: { from: 1, to: 0.25 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    const onScenePointerDown = (pointer) => {
      if (actionTaken || this.time.now < this.victoryInputReadyTime) return;
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
      if (actionTaken || this.time.now < this.victoryInputReadyTime) return;
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

    const onKeyDown = (event) => {
      if (actionTaken || this.time.now < this.victoryInputReadyTime) return;
      const key = (event.key || '').toUpperCase();
      if (nextCh && (key === 'ENTER' || key === ' ' || key === 'J')) {
        doAdvance();
      } else if (key === 'R') {
        doRetry();
      } else if (key === 'ESCAPE' || key === 'M') {
        doMenu();
      }
    };
    this.input.keyboard.on('keydown', onKeyDown);
  }

  handlePlayerGameOver() {
    // One outcome per run. Once the shrine is cleansed (isVictory) a stray hazard or projectile that finishes the hero
    // off is not a defeat: it would submit the same ticket a second time as "boss not cleared" and stack a game-over
    // screen on the victory banner.
    if (this.isGameOver || this.isVictory) return;
    this.isGameOver = true;
    sound.stopBGM();
    sound.playGameOver();
    pauseService.hideButtons();
    this.gameOverInputReadyTime = performance.now() + 350;

    if (this.player && !this.player.isDead) {
      this.player.die();
    }

    this.runResultPromise = this.settleRun(false);

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    if (this.chapterIntroCard) {
      this.chapterIntroCard.destroy();
      this.chapterIntroCard = null;
    }

    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    // Use scene-level UI objects with setScrollFactor(0) to guarantee
    // button hit-tests are never offset by camera scroll!
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(490);

    const box = this.add.rectangle(w / 2, h / 2, 360, 130, 0x240e0e, 0.96)
      .setStrokeStyle(2, 0xff4444)
      .setScrollFactor(0)
      .setDepth(500);

    const title = this.add.text(w / 2, h / 2 - 42, 'YOU FELL IN BATTLE', {
      fontFamily: 'Press Start 2P',
      fontSize: '11px',
      color: '#ff4444'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    const subtitle = this.add.text(w / 2, h / 2 - 22, `Chapter ${this.chapterId}: ${this.chapterConfig.title}`, {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#ffaaaa'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    // What happened to this life's Shards. It starts from what is known now and is redrawn when the server's answer
    // arrives: "pending G$" is only promised to a verified player whose run the server recorded without flags.
    const rewardLine = this.add.text(w / 2, h / 2 - 16, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: TONE_COLOR.muted,
      align: 'center',
      wordWrap: { width: 340 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(501);
    const renderReward = () => {
      if (!rewardLine.active) return;
      const next = this.shardsBadge();
      rewardLine.setText(next?.text ?? '').setColor(next?.color ?? TONE_COLOR.muted);
    };
    renderReward();
    this.runResultPromise.then(renderReward);

    const hintText = this.add.text(w / 2, h / 2 + 42, '▶ TAP RETRY OR MAIN MENU TO CONTINUE ◀', {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#ffaaaa'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501);

    this.tweens.add({
      targets: hintText,
      alpha: { from: 1, to: 0.25 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    let actionTaken = false;
    const cleanup = () => {
      this.input.off('pointerdown', onScenePointerDown);
      this.input.keyboard.off('keydown', onKeyDown);
      if (this.game && this.game.canvas) {
        this.game.canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      }
      overlay.destroy();
      box.destroy();
      title.destroy();
      subtitle.destroy();
      rewardLine.destroy();
      hintText.destroy();
      retryBtn.destroy();
      retryLabel.destroy();
      menuBtn.destroy();
      menuLabel.destroy();
      this.activeGameOverCleanup = null;
    };
    this.activeGameOverCleanup = cleanup;

    const doRetry = () => {
      if (actionTaken || performance.now() < this.gameOverInputReadyTime) return;
      actionTaken = true;
      cleanup();
      sound.playCoin();
      this.scene.restart({ chapter: this.chapterId });
    };

    const doMenu = () => {
      if (actionTaken || performance.now() < this.gameOverInputReadyTime) return;
      actionTaken = true;
      cleanup();
      sound.playCoin();
      this.scene.start('MenuScene');
    };

    this.gameOverRetryCallback = doRetry;

    // Retry Button
    const rx = w / 2 - 78;
    const ry = h / 2 + 14; // a few pixels lower than before, to make room for the Shard line above the buttons
    const retryBtn = this.add.rectangle(rx, ry, 140, 28, 0x5a1818)
      .setStrokeStyle(1.5, 0xff7777)
      .setScrollFactor(0)
      .setDepth(502)
      .setInteractive({ useHandCursor: true });

    const retryLabel = this.add.text(rx, ry, '↺ RETRY', {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(503).setInteractive({ useHandCursor: true });

    retryBtn.on('pointerdown', doRetry);
    retryLabel.on('pointerdown', doRetry);

    // Menu Button
    const mx = w / 2 + 78;
    const my = h / 2 + 14;
    const menuBtn = this.add.rectangle(mx, my, 140, 28, 0x382414)
      .setStrokeStyle(1.5, 0xf59e0b)
      .setScrollFactor(0)
      .setDepth(502)
      .setInteractive({ useHandCursor: true });

    const menuLabel = this.add.text(mx, my, '◄ MAIN MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: '#f59e0b'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(503).setInteractive({ useHandCursor: true });

    menuBtn.on('pointerdown', doMenu);
    menuLabel.on('pointerdown', doMenu);

    const onScenePointerDown = (pointer) => {
      if (actionTaken || performance.now() < this.gameOverInputReadyTime) return;
      const px = pointer.x;
      const py = pointer.y;
      if (px >= rx - 70 && px <= rx + 70 && py >= ry - 14 && py <= ry + 14) {
        doRetry();
      } else if (px >= mx - 70 && px <= mx + 70 && py >= my - 14 && py <= my + 14) {
        doMenu();
      }
    };
    this.input.on('pointerdown', onScenePointerDown);

    const onCanvasPointerDown = (e) => {
      if (actionTaken || performance.now() < this.gameOverInputReadyTime) return;
      if (!this.game || !this.game.canvas) return;
      const rect = this.game.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * w;
      const py = ((e.clientY - rect.top) / rect.height) * h;
      if (px >= rx - 70 && px <= rx + 70 && py >= ry - 14 && py <= ry + 14) {
        doRetry();
      } else if (px >= mx - 70 && px <= mx + 70 && py >= my - 14 && py <= my + 14) {
        doMenu();
      }
    };
    if (this.game && this.game.canvas) {
      this.game.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    }

    const onKeyDown = (event) => {
      if (actionTaken || performance.now() < this.gameOverInputReadyTime) return;
      const key = (event.key || '').toUpperCase();
      if (key === 'R' || key === 'ENTER' || key === ' ' || key === 'J') {
        doRetry();
      } else if (key === 'ESCAPE' || key === 'M') {
        doMenu();
      }
    };
    this.input.keyboard.on('keydown', onKeyDown);
  }

  update(_time, delta) {
    // Played time advances through dialogue (the scene is live) but not behind the pause screen or in a hidden tab.
    this.activeClock.tick(delta, { paused: pauseService.isPaused, hidden: pageHidden() });
    runs.update({ score: 0, kills: this.killsCount, shards: this.sessionCrystalsCollected || 0 });
    if (this.inDialogue) {
      if (this.player && this.player.body) {
        this.player.setVelocityX(0);
      }
      return;
    }

    if (!this.isVictory && !this.isGameOver && this.player && !this.player.isDead) {
      const sec = this.activeClock.seconds;
      if (sec !== this.secondsElapsed) {
        this.secondsElapsed = sec;
        pauseService.updateTimer(this.secondsElapsed);
      }
    }

    const touchInputs = window.touchController ? {
      ...window.touchController.state,
      ...window.touchController.consumeTriggers()
    } : {};

    // Victory screen keyboard/touch advance check
    if (this.isVictory && this.victoryAdvanceCallback && performance.now() > this.victoryInputReadyTime) {
      const advancePressed = (
        touchInputs.justAttack ||
        touchInputs.justUpSlash ||
        touchInputs.justJump ||
        Phaser.Input.Keyboard.JustDown(this.cursors.space) ||
        (this.cursors.keys?.ENTER && Phaser.Input.Keyboard.JustDown(this.cursors.keys.ENTER)) ||
        (this.cursors.keys?.J && Phaser.Input.Keyboard.JustDown(this.cursors.keys.J)) ||
        (this.cursors.keys?.Z && Phaser.Input.Keyboard.JustDown(this.cursors.keys.Z)) ||
        (this.cursors.keys?.E && Phaser.Input.Keyboard.JustDown(this.cursors.keys.E))
      );
      if (advancePressed) {
        this.victoryAdvanceCallback();
        return;
      }
    }

    // Game over screen keyboard/touch retry check
    if (this.player?.isDead && this.gameOverRetryCallback && performance.now() > this.gameOverInputReadyTime) {
      const retryPressed = (
        touchInputs.justAttack ||
        touchInputs.justUpSlash ||
        touchInputs.justJump ||
        Phaser.Input.Keyboard.JustDown(this.cursors.space) ||
        (this.cursors.keys?.ENTER && Phaser.Input.Keyboard.JustDown(this.cursors.keys.ENTER)) ||
        (this.cursors.keys?.R && Phaser.Input.Keyboard.JustDown(this.cursors.keys.R)) ||
        (this.cursors.keys?.J && Phaser.Input.Keyboard.JustDown(this.cursors.keys.J))
      );
      if (retryPressed) {
        this.gameOverRetryCallback();
        return;
      }
    }

    if (this.player) {
      this.player.update(this.cursors, touchInputs);

      // Feature 1: Track confirmed safe grounded coordinates (solid main ground, not over hazards)
      if (this.player.body && this.player.body.blocked.down && this.player.y <= 360) {
        const px = this.player.x;
        const safeSeg = this.groundSegments?.find(s => px >= s.x1 + 35 && px <= s.x2 - 35);
        const overHazard = this.hazards?.getChildren()?.some(h => {
          const hb = h.body;
          return hb && px >= hb.left - 20 && px <= hb.right + 20;
        });
        if (safeSeg && !overHazard) {
          this.player.lastSafeX = px;
          this.player.lastSafeY = safeSeg.y - 34;
        }
      }

      const gateX = this.gateX || (this.chapterId === 1 ? 2310 : 2090);
      const arenaThresholdX = this.chapterId === 1 ? 2320 : 2120;
      const remainingFoes = this.getRemainingEnemiesCount();

      // Check boss approach warning zone (~200–240px before arena)
      if (!this.bossApproachTriggered && !this.bossTriggered && !this.player.isDead) {
        const approachX = this.chapterId === 1 ? 2060 : 1880;
        if (this.player.x >= approachX) {
          this.triggerBossApproachWarning();
        }
      }

      // If player reaches the boss area before killing all enemies, notify and block them
      if (!this.bossTriggered && !this.player.isDead && !this.inDialogue) {
        if (remainingFoes > 0) {
          // Real-time enemy tracker: immediately indicates when enemies are passed & off-screen, or near sealed gate
          this.updateEnemyTracker(gateX, remainingFoes);

          // Approached within 40px of the sealed gate
          if (this.player.x >= gateX - 40) {
            this.triggerBossLockedWarning(remainingFoes);
          }
          // Prevent crossing beyond the gate
          if (this.player.x >= gateX - 10) {
            this.player.x = gateX - 16;
            if (this.player.body) {
              this.player.body.setVelocityX(Math.min(this.player.body.velocity.x, -80));
            }
          }
        } else {
          // All foes defeated! Drop the mystical gate with triumphant fanfare
          if (!this.bossArenaUnsealed) {
            this.unsealBossArena();
          }

          // Immediately remove Danger Ahead approach banner the moment player reaches the boss lair
          if (this.bossApproachBanner && this.player.x >= arenaThresholdX) {
            this.dismissBossApproachWarning(true);
          }

          // Trigger arena boss encounter
          if (this.player.x >= arenaThresholdX) {
            this.triggerBossEncounter(this.chapterId);
          }
        }
      }
    }

    const camScrollX = this.cameras.main.scrollX;
    if (this.bgMountains) this.bgMountains.tilePositionX = camScrollX * 0.05;
    if (this.bgFogPines) this.bgFogPines.tilePositionX = camScrollX * 0.12;
    if (this.bgMidPines) this.bgMidPines.tilePositionX = camScrollX * 0.22;

    // Update enemies only when NOT in dialogue
    if (this.enemies) {
      const gateX = this.gateX || (this.chapterId === 1 ? 2310 : 2090);
      this.enemies.getChildren().forEach(enemy => {
        if (!this.inDialogue) {
          enemy.update(this.player);
        }

        // Clamp regular mobs before the closed boss gate
        if (!this.bossArenaUnsealed && enemy.active && enemy.state !== 'DEAD' && (!enemy.mobType || !enemy.mobType.startsWith('boss'))) {
          if (enemy.x >= gateX - 20) {
            enemy.x = gateX - 60;
            if (enemy.patrolDir) enemy.patrolDir = -1;
            if (enemy.body) enemy.body.setVelocityX(Math.min(enemy.body.velocity.x, -60));
          }
        }

        // Failsafe: auto-cull fallen mobs so they never soft-lock progression
        if (enemy.active && enemy.state !== 'DEAD' && enemy.y > this.levelHeight + 20) {
          if (typeof enemy.die === 'function') {
            enemy.die();
          } else {
            enemy.destroy();
          }
          this.killsCount++;
          this.onEnemyKilled();
        }
      });
    }

    // Combo decay
    if (this.comboCount > 0 && this.time.now > this.comboTimer) {
      this.comboCount = 0;
      this.tweens.add({
        targets: this.txtCombo,
        alpha: 0,
        duration: 200
      });
    }

    // Failsafe game over check (any source of player death)
    if (this.player && this.player.isDead && !this.isGameOver) {
      this.handlePlayerGameOver();
    }

    // Fall out of world check
    if (this.player && this.player.y > this.levelHeight + 30 && !this.player.isDead) {
      const damaged = this.player.takeDamage(35, 0);
      this.updateHearts();
      if (this.player.isDead) {
        this.handlePlayerGameOver();
      } else {
        this.triggerHazardFX(this.player, null);
        this.respawnPlayerAtSafeLedge(this.player);
      }
    }
  }
}

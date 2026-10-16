import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import Player from '../entities/Player.js';
import Crate from '../entities/Crate.js';
import Snail from '../entities/Snail.js';
import Goblin from '../entities/Goblin.js';
import Bee from '../entities/Bee.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import { pauseService } from '../engine/PauseService.js';
import confetti from 'canvas-confetti';
import { createCoach, doneHtml } from '../ui/coachView.js';
import { openSheet } from '../ui/sheet.js';
import { LESSONS } from '../ui/tutorialLessons.js';
import { fillUnderground, GROUND_TILES_DEPTH } from '../engine/underground.js';

/*
 * Sizes for the two canvases (480x270 landscape, 480x440 tall), in game units.
 *
 * A text hint of 7px or more is drawn in the pixel font at that size; a smaller hint is drawn in VT323 at 2.3x the hint
 * (engine/typography.js), so '6.8px' is a 15.5-unit VT323 line and '13.5px' is a 13.5-unit pixel-font heading.
 * The tall canvas is the one shown upright on a phone, at about 0.81 CSS px per unit, so its sizes are picked to read as
 * >= 9 CSS px for captions, >= 10 for body text and >= 11 for headings there. The landscape canvas is shown at 1.4 to
 * 2.1 CSS px per unit, where the sizes below are already large enough.
 */

/** Labels floating over the playfield. */
const WORLD = {
  land: { banner: '7px', indicator: '5px', tag: '5.5px', counter: '6.5px', stomp: '6px', graze: '5px' },
  tall: { banner: '12px', indicator: '6.3px', tag: '6.3px', counter: '6.8px', stomp: '6.5px', graze: '6.3px' },
};

export default class TutorialScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TutorialScene' });
  }

  init(data) {
    this.fromPrologue = Boolean(data && data.fromPrologue);
    // held upright, a run takes the whole screen (engine/playStage.js); the size is set before create() reads it
    window.viewportManager?.enterPlay(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.viewportManager?.leavePlay(this));
  }

  create() {
    const w = GAME_CONFIG.WIDTH; // the glade is 480 wide; the picture may be narrower and follow the hero
    const cw = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;
    const hb = Math.min(h, GAME_CONFIG.PORTRAIT_HEIGHT || 440); // the hills and trees are drawn for the level's 440; more height is sky

    this.cameras.main.resetFX();
    this.cameras.main.setBackgroundColor('#050e08');

    // Attach pause service with clean mode label (hide timer badge)
    pauseService.attachScene(this, '🎓 COMBAT TUTORIAL: PRACTICE GLADE', { showTimer: false });
    sound.playBGM('forest');

    // Enable touch controls
    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.show();
      window.touchController.clearTutorialHighlights();
    }

    // Parallax High Forest Background Layers
    this.bgSky = this.add.tileSprite(0, 0, cw, h, 'sky_backdrop').setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    if (h > 270) this.bgSky.tileScaleY = h / 270;
    this.bgMountains = this.add.tileSprite(0, 20, cw, Math.max(200, hb - 20), 'sky_mountains').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    if (hb > 270) this.bgMountains.tileScaleY = Math.max(1, (hb - 20) / 250);
    this.bgFogPines = this.add.tileSprite(0, 50, cw, Math.max(220, hb - 50), 'forest_bg_p0').setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    if (hb > 270) this.bgFogPines.tileScaleY = Math.max(1, (hb - 50) / 206);
    this.bgMidPines = this.add.tileSprite(0, 80, cw, Math.max(220, hb - 80), 'forest_bg_p1').setOrigin(0, 0).setScrollFactor(0).setDepth(3);
    if (hb > 270) this.bgMidPines.tileScaleY = Math.max(1, (hb - 80) / 176);

    // the ground is 70 above the bottom of the 440 picture; a taller picture keeps it there and shows earth below
    // (and on a short screen the ground rises clear of the pad: engine/playStage.js)
    const lift = window.viewportManager?.playOwner === this ? (window.viewportManager.playLift || 0) : 0;
    const groundY = h > 300 ? Math.min(h - 70, 370 - lift) : 210;
    this.groundY = groundY;

    // Decorative background pine trees
    for (let i = 0; i < 4; i++) {
      const tx = 60 + i * 110;
      const treeKey = (i % 2 === 0) ? 'pine_green' : 'pine_dark';
      const tree = this.add.image(tx, groundY, treeKey).setOrigin(0.5, 1.0).setScale(0.8).setDepth(4);
      this.tweens.add({
        targets: tree,
        angle: { from: -0.8, to: 0.8 },
        duration: 2500 + i * 200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    // Bushes along the glade
    for (let bx = 40; bx < w; bx += 100) {
      this.add.image(bx, groundY, 'bush_green').setOrigin(0.5, 1.0).setDepth(5).setScale(0.8);
    }

    // Static physics platforms group
    this.platforms = this.physics.add.staticGroup();

    // Solid cliff grass ground across the glade
    this.createGround(0, groundY, w);

    // Elevated practice wooden platform (for jump training)
    this.createPlatform(190, groundY - 65, 100);

    // Ambient floating spores/pollen
    this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: w },
      y: { min: 25, max: groundY - 15 },
      quantity: 1,
      frequency: 300,
      lifespan: 3500,
      gravityY: -6,
      speedX: { min: -10, max: 10 },
      speedY: { min: -6, max: 6 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.5, end: 0 },
      tint: 0x88ee88,
      blendMode: 'ADD'
    }).setDepth(15);

    // Player instance (spawn at X=160 clear of touch D-Pad)
    this.physics.world.setBounds(0, 0, w, h);
    this.player = new Player(this, 160, groundY - 30);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.platforms);
    // a picture narrower than the glade follows the hero along it
    this.cameras.main.setBounds(0, 0, w, h);
    if (cw < w) this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // Fallback cursors for desktop development
    this.cursors = this.input.keyboard.createCursorKeys();
    this.cursors.keys = this.input.keyboard.addKeys('W,A,S,D,J,K,X,E,R,ENTER,ESC');

    // Animated Sylva the Moon Sprite trainer hovering beside player
    this.sylva = this.add.sprite(200, groundY - 60, 'fairy_fly').setScale(0.95).setDepth(30);
    this.sylva.play('fairy_fly_anim');
    this.tweens.add({
      targets: this.sylva,
      y: groundY - 68,
      duration: 1200,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut'
    });

    // Sylva's lesson card (an HTML layer over the game: src/ui/coachView.js)
    this.createTutorialHUD();

    // Groups for interactive targets
    this.crates = this.physics.add.group();
    this.physics.add.collider(this.crates, this.platforms);

    this.enemies = this.physics.add.group();
    this.physics.add.collider(this.enemies, this.platforms);

    // Player attack vs crates
    this.physics.add.overlap(this.player.attackHitbox, this.crates, (hitbox, crate) => {
      if (this.currentLesson === 3 && !this.lessonCompleted && crate.active) {
        crate.breakCrate(this.player);
        this.coach.done('crate');
        this.completeCurrentLesson();
      }
    });

    // Player attack vs enemies
    this.physics.add.overlap(this.player.attackHitbox, this.enemies, (hitbox, enemy) => {
      if (this.player.currentSwingHits && this.player.currentSwingHits.has(enemy)) return;
      if (this.player.currentSwingHits) this.player.currentSwingHits.add(enemy);
      this.handlePlayerAttackEnemy(enemy);
    });

    // Stomp bounce collision check
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.handlePlayerEnemyOverlap(e));

    // State machine tracking
    this.currentLesson = 1;
    this.lessonCompleted = false;
    this.lessonState = {};

    // Start Lesson 1
    this.startLesson(1);

    // Ensure cleanup on shutdown
    this.events.once('shutdown', () => {
      this.coach?.destroy();
      this.coach = null;
      this.closeVictory();
      pauseService.detachScene();
      if (typeof window !== 'undefined' && window.touchController) {
        window.touchController.clearTutorialHighlights();
      }
    });
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
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
  }

  /** Sizes for the labels floating over the playfield, for the canvas that is on screen. */
  worldSizes() {
    return (this.cameras?.main?.height || GAME_CONFIG.HEIGHT) > 300 ? WORLD.tall : WORLD.land;
  }

  createGround(x, y, width) {
    const depth = 10;
    const body = this.add.rectangle(x + width / 2, y + 20, width, 40, 0x000000, 0);
    this.physics.add.existing(body, true);
    this.platforms.add(body);

    const numTiles = Math.ceil(width / 16);
    const pictureBottom = (this.cameras?.main?.height || GAME_CONFIG.PORTRAIT_HEIGHT || 380) + 20;
    const maxBottom = y + GROUND_TILES_DEPTH;
    for (let i = 0; i < numTiles; i++) {
      const tileX = x + i * 16;
      let topKey = (i % 2 === 0) ? 'tile_cliff_top_mid1' : 'tile_cliff_top_mid2';
      this.add.image(tileX, y - 10, topKey).setOrigin(0, 0).setDepth(depth);

      for (let cy = y + 6; cy <= maxBottom; cy += 16) {
        this.add.image(tileX, cy, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(depth - 1);
      }
    }
    // a run held upright is taller than the glade: carry the earth on down to the bottom of the picture
    fillUnderground(this, { x, top: y + 6 + 16 * (Math.floor((maxBottom - (y + 6)) / 16) + 1), width: numTiles * 16, bottom: pictureBottom });

    for (let px = x + 24; px < x + width - 24; px += 56) {
      const roll = Math.floor(px % 4);
      if (roll === 0) this.add.image(px, y, 'prop_shroom_small').setOrigin(0.5, 1.0).setDepth(depth + 1);
      else if (roll === 1) this.add.image(px, y, 'prop_flower_blue').setOrigin(0.5, 1.0).setDepth(depth + 1);
      else if (roll === 2) this.add.image(px, y, 'prop_fern').setOrigin(0.5, 1.0).setDepth(depth + 1);
    }
  }

  createPlatform(x, y, width) {
    const depth = 10;
    const count = Math.max(1, Math.round(width / 48));
    const actualWidth = count * 48;
    const body = this.add.rectangle(x + actualWidth / 2, y + 6, actualWidth, 12, 0x000000, 0);
    this.physics.add.existing(body, true);
    body.body.checkCollision.down = true;
    body.body.checkCollision.left = false;
    body.body.checkCollision.right = false;
    body.body.checkCollision.up = true;
    this.platforms.add(body);

    for (let i = 0; i < count; i++) {
      this.add.image(x + i * 48, y, 'plat_wood').setOrigin(0, 0).setDepth(depth);
    }
  }

  createTutorialHUD() {
    this.coach?.destroy();
    this.coach = createCoach(document.getElementById('ms-hud'), { onSkip: () => this.skipTutorial() });
  }

  /** "Skip": the player knows how to play. Count the tutorial as done and go back to the menu, whose big button now leads on. */
  skipTutorial() {
    if (this.isVictory || this.skipped) return;
    this.skipped = true;
    storage.setTutorialDone();
    sound.playCoin();
    this.scene.start('MenuScene');
  }

  onCrateBroken(crate) {
    if (this.currentLesson === 3 && !this.lessonCompleted) {
      this.coach.done('crate');
      this.completeCurrentLesson();
    }
  }

  startLesson(lessonNum) {
    this.currentLesson = lessonNum;
    this.lessonCompleted = false;
    this.lessonState = {};

    // Clear previous interactive entities & indicators safely
    if (this.crates) {
      const crateList = [...this.crates.getChildren()];
      crateList.forEach(c => {
        if (c && c.destroy) c.destroy();
      });
      this.crates.clear(false, false);
    }

    if (this.enemies) {
      const enemyList = [...this.enemies.getChildren()];
      enemyList.forEach(e => {
        if (e.indicator) { e.indicator.destroy(); e.indicator = null; }
        if (e.dummyLabel) { e.dummyLabel.destroy(); e.dummyLabel = null; }
        if (e.stompTag) { e.stompTag.destroy(); e.stompTag = null; }
        if (e && e.destroy) e.destroy();
      });
      this.enemies.clear(false, false);
    }

    this.trainingCrate = null;
    this.tutorialBee = null;
    this.sparringDummy = null;
    this.trainingSnail = null;

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.clearTutorialHighlights();
    }

    const lesson = LESSONS[lessonNum - 1];
    if (lesson) {
      this.coach.lesson(lessonNum - 1);
      if (window.touchController) {
        if (lesson.buttons.length) window.touchController.setTutorialHighlight(lesson.buttons);
        else window.touchController.clearTutorialHighlights();
      }
    }

    switch (lessonNum) {
      case 1:
        this.lessonState = { movedLeft: false, movedRight: false };
        break;

      case 2:
        this.lessonState = { jumped: false, doubleJumped: false };
        break;

      case 3:
        this.spawnTrainingCrate(260, (this.groundY || 210) - 20);
        this.lessonState = { crateShattered: false };
        break;

      case 4:
        // upward air attack at a harmless diving bee
        this.spawnTutorialBee(310, (this.groundY || 210) - 115);
        this.lessonState = { beeSliced: false };
        break;

      case 5:
        // aerial stomp bounce, in open airspace clear of the platform
        this.spawnTrainingShell(360, (this.groundY || 210) - 20);
        this.lessonState = { stomped: false };
        break;

      case 6:
        // live sparring: defeat the training dummy
        this.spawnSparringDummy(350, (this.groundY || 210) - 35);
        this.lessonState = { dummyDefeated: false };
        break;

      default:
        this.showTutorialVictory();
        break;
    }
  }

  completeCurrentLesson() {
    if (this.lessonCompleted) return;
    this.lessonCompleted = true;
    this.coach.complete();

    try {
      sound.playCoin();
      if (typeof sound.playSparkle === 'function') sound.playSparkle();
    } catch {}

    // a burst of gold from the hero
    for (let i = 0; i < 14; i++) {
      const spark = this.add.circle(this.player.x, this.player.y - 14, Phaser.Math.Between(1, 3), i % 3 === 0 ? 0xffffff : 0xf4b63f, 1).setDepth(500);
      const angle = (i / 14) * Math.PI * 2;
      const dist = Phaser.Math.Between(22, 46);
      this.tweens.add({
        targets: spark,
        x: spark.x + Math.cos(angle) * dist,
        y: spark.y + Math.sin(angle) * dist - 8,
        alpha: 0,
        duration: Phaser.Math.Between(420, 650),
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy()
      });
    }

    // Floating checkmark banner
    const checkText = this.add.text(this.player.x, this.player.y - 42, '✔ LESSON COMPLETE!', {
      fontFamily: 'Press Start 2P',
      fontSize: this.worldSizes().banner,
      color: '#FFD97A',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(500);
    // keep the whole banner on screen when the player is at an edge
    const half = checkText.width / 2 + 4;
    checkText.x = Phaser.Math.Clamp(checkText.x, half, (this.cameras.main.width || GAME_CONFIG.WIDTH) - half);

    this.tweens.add({
      targets: checkText,
      y: checkText.y - 24,
      alpha: { from: 1, to: 0 },
      duration: 800,
      onComplete: () => checkText.destroy()
    });

    this.time.delayedCall(950, () => {
      this.startLesson(this.currentLesson + 1);
    });
  }

  spawnTrainingCrate(x, y) {
    const crate = new Crate(this, x, y);
    this.crates.add(crate);
    this.trainingCrate = crate;
  }

  spawnTutorialBee(x, y) {
    const bee = new Bee(this, x, y);
    bee.isTutorialBee = true;
    bee.isHarmless = true;
    bee.hp = 15;
    bee.maxHp = 15;
    if (bee.body) {
      bee.body.setCollideWorldBounds(true);
    }
    if (bee.healthBar) {
      bee.healthBar.update(bee.hp, bee.maxHp);
    }

    const indicator = this.add.text(x, y - 26, '⚔️ STRIKE UP', {
      fontFamily: 'Press Start 2P',
      fontSize: this.worldSizes().indicator,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(25);
    bee.indicator = indicator;

    this.enemies.add(bee);
    this.tutorialBee = bee;

    // Trigger initial swoop attack toward player after short telegraph
    this.time.delayedCall(650, () => {
      if (bee.active && bee.state === 'HOVER') {
        bee.startSwoop(this.player);
      }
    });
  }

  spawnTrainingShell(x, y) {
    const snail = new Snail(this, x, y);
    if (snail.body) snail.body.setCollideWorldBounds(true);
    this.enemies.add(snail);
    this.trainingSnail = snail;

    snail.enterShelled();
    if (snail.body) {
      snail.body.setVelocityX(0);
    }

    // Floating bounce guide tag
    const stompTag = this.add.text(x, y - 28, '⬇ STOMP BOUNCE', {
      fontFamily: 'Press Start 2P',
      fontSize: this.worldSizes().tag,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(25);

    this.tweens.add({
      targets: stompTag,
      y: y - 32,
      duration: 500,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut'
    });

    snail.stompTag = stompTag;
  }

  spawnSparringDummy(x, y) {
    const dummy = new Goblin(this, x, y);
    if (dummy.body) dummy.body.setCollideWorldBounds(true);
    dummy.hp = 35;
    dummy.maxHp = 35;
    dummy.attackCooldownUntil = Infinity; // Sparring dummy: does not toss bombs
    dummy.isSparringDummy = true;

    // Immediately render health bar
    if (dummy.healthBar) {
      dummy.healthBar.update(dummy.hp, dummy.maxHp);
    }

    // Distinct Sparring Dummy Nameplate
    const dummyLabel = this.add.text(x, y - 32, '🥋 TRAINING DUMMY', {
      fontFamily: 'Press Start 2P',
      fontSize: this.worldSizes().tag,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(26);
    dummy.dummyLabel = dummyLabel;

    // Spawn dust particles
    for (let i = 0; i < 6; i++) {
      const puff = this.add.circle(x + Phaser.Math.Between(-15, 15), y + Phaser.Math.Between(-10, 10), 4, 0x88ee88, 0.8);
      this.tweens.add({
        targets: puff,
        y: puff.y - 20,
        alpha: 0,
        scale: 0.2,
        duration: 400,
        onComplete: () => puff.destroy()
      });
    }

    this.enemies.add(dummy);
    this.sparringDummy = dummy;
  }

  handlePlayerAttackEnemy(enemy) {
    if (!enemy || !enemy.active || enemy.state === 'DEAD') return;

    // 1. Hit harmless swooping bee in Lesson 4
    if (this.currentLesson === 4 && enemy === this.tutorialBee && !this.lessonCompleted) {
      sound.playImpact();
      sound.playUpwardSlash();

      if (enemy.indicator) {
        enemy.indicator.destroy();
        enemy.indicator = null;
      }

      for (let i = 0; i < 8; i++) {
        const sp = this.add.circle(enemy.x, enemy.y, 3, 0xffd166, 0.9);
        this.tweens.add({
          targets: sp,
          x: sp.x + Phaser.Math.Between(-30, 30),
          y: sp.y + Phaser.Math.Between(-30, 30),
          alpha: 0,
          scale: 0,
          duration: 400,
          onComplete: () => sp.destroy()
        });
      }

      const counterText = this.add.text(enemy.x, enemy.y - 14, 'AERIAL SLICE! 💥', {
        fontFamily: 'Press Start 2P',
        fontSize: this.worldSizes().counter,
        color: '#ffea00',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5);
      this.tweens.add({
        targets: counterText,
        y: counterText.y - 20,
        alpha: 0,
        duration: 650,
        onComplete: () => counterText.destroy()
      });

      enemy.die();
      this.tutorialBee = null;
      this.coach.done('bee');
      this.completeCurrentLesson();
      return;
    }

    // 2. Hit sparring dummy in Lesson 6
    if (this.currentLesson === 6 && enemy === this.sparringDummy && !this.lessonCompleted) {
      const dmg = this.player.attackType === 'upward' ? 22 : 16;
      sound.playSwordSlash();
      enemy.takeDamage(dmg, this.player.x, this.player.attackType === 'upward');

      if (enemy.hp <= 0) {
        if (enemy.dummyLabel) {
          enemy.dummyLabel.destroy();
          enemy.dummyLabel = null;
        }
        this.coach.done('dummy');
        this.completeCurrentLesson();
      }
    }
  }

  checkCombatHits() {
    if (!this.player || !this.player.isAttacking) return;
    const bounds = this.player.getAttackBounds();

    // 1. Hit training crate in Lesson 3
    if (this.currentLesson === 3 && this.trainingCrate && !this.lessonCompleted) {
      if (!this.trainingCrate.active || this.trainingCrate.isBroken) {
        this.coach.done('crate');
        this.completeCurrentLesson();
        return;
      }
      const cb = this.trainingCrate.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, cb)) {
        this.trainingCrate.breakCrate(this.player);
        this.coach.done('crate');
        this.completeCurrentLesson();
        return;
      }
    }

    // 2. Hit harmless swooping bee in Lesson 4
    if (this.currentLesson === 4 && this.tutorialBee && this.tutorialBee.active && !this.lessonCompleted) {
      const tb = this.tutorialBee.body
        ? new Phaser.Geom.Rectangle(this.tutorialBee.body.x - 6, this.tutorialBee.body.y - 6, this.tutorialBee.body.width + 12, this.tutorialBee.body.height + 12)
        : this.tutorialBee.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, tb)) {
        if (!this.player.currentSwingHits.has(this.tutorialBee)) {
          this.player.currentSwingHits.add(this.tutorialBee);
          this.handlePlayerAttackEnemy(this.tutorialBee);
          return;
        }
      }
    }

    // 3. Hit sparring dummy in Lesson 6
    if (this.currentLesson === 6 && this.sparringDummy && this.sparringDummy.active && !this.lessonCompleted) {
      const db = this.sparringDummy.body
        ? new Phaser.Geom.Rectangle(this.sparringDummy.body.x - 10, this.sparringDummy.body.y - 10, this.sparringDummy.body.width + 20, this.sparringDummy.body.height + 20)
        : this.sparringDummy.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, db)) {
        if (!this.player.currentSwingHits.has(this.sparringDummy)) {
          this.player.currentSwingHits.add(this.sparringDummy);
          this.handlePlayerAttackEnemy(this.sparringDummy);
        }
      }
    }
  }

  handlePlayerEnemyOverlap(enemy) {
    if (!this.player || this.player.isDead) return;

    // Harmless bee check: If tutorial bee touches player without being sliced
    if (enemy.isTutorialBee) {
      if (!enemy.hasTelegraphedHarmlessTouch) {
        enemy.hasTelegraphedHarmlessTouch = true;
        const grazeText = this.add.text(enemy.x, enemy.y - 10, 'SWOOP! (0 DMG)', {
          fontFamily: 'Press Start 2P',
          fontSize: this.worldSizes().graze,
          color: '#38bdf8',
          stroke: '#000000',
          strokeThickness: 2
        }).setOrigin(0.5);
        this.tweens.add({
          targets: grazeText,
          y: grazeText.y - 16,
          alpha: 0,
          duration: 500,
          onComplete: () => grazeText.destroy()
        });
        this.time.delayedCall(1000, () => {
          if (enemy.active) enemy.hasTelegraphedHarmlessTouch = false;
        });
      }
      return;
    }

    const isFalling = this.player.body && this.player.body.velocity.y > 40;
    const isAbove = (this.player.y + 16) < enemy.y;

    if (isFalling && isAbove) {
      this.player.body.setVelocityY(-270);
      sound.playBoarChargeHit();

      const txt = this.add.text(enemy.x, enemy.y - 18, '💥 STOMP BOUNCE! -25', {
        fontFamily: 'Press Start 2P',
        fontSize: this.worldSizes().stomp,
        color: '#ffd166',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5).setDepth(500);

      this.tweens.add({
        targets: txt,
        y: txt.y - 20,
        alpha: 0,
        duration: 750,
        onComplete: () => txt.destroy()
      });

      if (this.currentLesson === 5 && !this.lessonCompleted) {
        if (enemy.stompTag) {
          enemy.stompTag.destroy();
          enemy.stompTag = null;
        }
        this.coach.done('stomp');
        this.completeCurrentLesson();
      } else if (this.currentLesson === 6 && this.sparringDummy && this.sparringDummy.active && !this.lessonCompleted) {
        this.sparringDummy.takeDamage(25, this.player.x, false);
        if (this.sparringDummy.hp <= 0) {
          if (this.sparringDummy.dummyLabel) {
            this.sparringDummy.dummyLabel.destroy();
            this.sparringDummy.dummyLabel = null;
          }
          this.coach.done('dummy');
          this.completeCurrentLesson();
        }
      }
    }
  }

  update() {
    if (!this.player) return;

    const touchInputs = window.touchController ? {
      ...window.touchController.state,
      ...window.touchController.consumeTriggers()
    } : {};

    this.player.update(this.cursors, touchInputs);

    if (this.sylva) {
      const targetSylvaX = this.player.flipX ? this.player.x + 24 : this.player.x - 24;
      const targetSylvaY = this.player.y - 28;
      this.sylva.x += (targetSylvaX - this.sylva.x) * 0.08;
      this.sylva.y += (targetSylvaY - this.sylva.y) * 0.08;
      this.sylva.setFlipX(!this.player.flipX);
    }

    if (this.enemies) {
      this.enemies.getChildren().forEach(enemy => {
        if (enemy.active && enemy.update) {
          enemy.update(this.player);
        }
        if (enemy.indicator && enemy.active) {
          enemy.indicator.setPosition(enemy.x, enemy.y - 26);
        }
        if (enemy.dummyLabel && enemy.active) {
          enemy.dummyLabel.setPosition(enemy.x, enemy.y - 32);
        }
        if (enemy.stompTag && enemy.active) {
          enemy.stompTag.setPosition(enemy.x, enemy.y - 28);
        }
      });
    }

    this.checkCombatHits();

    if (!this.lessonCompleted) {
      if (this.currentLesson === 1) {
        if (this.player.body.velocity.x < -20) this.lessonState.movedLeft = true;
        if (this.player.body.velocity.x > 20) this.lessonState.movedRight = true;

        if (this.lessonState.movedLeft) this.coach.done('left');
        if (this.lessonState.movedRight) this.coach.done('right');

        if (this.lessonState.movedLeft && this.lessonState.movedRight) {
          this.completeCurrentLesson();
        }
      } else if (this.currentLesson === 2) {
        if (!this.player.body.blocked.down && this.player.body.velocity.y < -50) {
          if (this.player.canDoubleJump) {
            this.lessonState.jumped = true;
          } else {
            this.lessonState.doubleJumped = true;
          }
        }

        if (this.lessonState.jumped) this.coach.done('jump');
        if (this.lessonState.doubleJumped) this.coach.done('double');

        if (this.lessonState.jumped && this.lessonState.doubleJumped) {
          this.completeCurrentLesson();
        }
      } else if (this.currentLesson === 3) {
        if ((!this.trainingCrate || !this.trainingCrate.active || this.trainingCrate.isBroken) && !this.lessonCompleted) {
          this.coach.done('crate');
          this.completeCurrentLesson();
        }
      }
    }
  }

  showTutorialVictory() {
    sound.stopBGM();
    sound.playBGM('victory');
    pauseService.hideButtons();

    this.coach?.hide();
    this.isVictory = true;
    storage.setTutorialDone(); // the story's way-in no longer offers the tutorial again

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.clearTutorialHighlights();
      window.touchController.hide();
    }

    try {
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch {}

    const proceedToStory = () => {
      sound.playVictory();
      this.closeVictory();
      if (this.fromPrologue) {
        this.scene.start('StoryScene', { chapter: 1 });
      } else {
        this.scene.start('StoryIntroScene');
      }
    };
    const leaveTo = (key) => {
      sound.playCoin();
      this.closeVictory();
      this.scene.start(key);
    };

    this.victorySheet = openSheet(document.getElementById('ms-sheets'), {
      title: 'Training complete',
      name: 'result',
      dismissable: false,
      body: doneHtml({ fromPrologue: this.fromPrologue }),
      onAction: (act) => {
        if (act === 'story') proceedToStory();
        else if (act === 'trial') leaveTo('SurvivalScene');
        else if (act === 'menu') leaveTo('MenuScene');
      },
    });
    this.input.keyboard.once('keydown-SPACE', proceedToStory);
    this.input.keyboard.once('keydown-ENTER', proceedToStory);
  }

  closeVictory() {
    if (!this.victorySheet) return;
    const host = document.getElementById('ms-sheets');
    if (host) host.innerHTML = '';
    this.victorySheet = null;
  }
}

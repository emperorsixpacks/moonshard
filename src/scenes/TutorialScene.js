import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import Player from '../entities/Player.js';
import Crate from '../entities/Crate.js';
import Snail from '../entities/Snail.js';
import Goblin from '../entities/Goblin.js';
import Bee from '../entities/Bee.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';
import { pauseService } from '../engine/PauseService.js';
import confetti from 'canvas-confetti';

/*
 * Sizes for the two canvases (480x270 landscape, 480x440 tall), in game units.
 *
 * A text hint of 7px or more is drawn in the pixel font at that size; a smaller hint is drawn in VT323 at 2.3x the hint
 * (engine/typography.js), so '6.8px' is a 15.5-unit VT323 line and '13.5px' is a 13.5-unit pixel-font heading.
 * The tall canvas is the one shown upright on a phone, at about 0.81 CSS px per unit, so its sizes are picked to read as
 * >= 9 CSS px for captions, >= 10 for body text and >= 11 for headings there. The landscape canvas is shown at 1.4 to
 * 2.1 CSS px per unit, where the sizes below are already large enough.
 */

/** The lesson card at the top. Positions are measured from the middle of the card. */
const HUD = {
  land: {
    card: { w: 340, h: 58, x: 175, y: 35 },
    avatar: { x: -146, y: 0, size: 24, scale: 0.5 },
    pill: { x: -88, y: -19, w: 74, h: 12, size: '5px' },
    title: { x: 32, y: -19, originX: 0.5, size: '6px' },
    dialogue: { x: -126, y: 1, wrap: 286, size: '4.5px', spacing: 2 },
    progress: { x: 14, y: 21, originX: 0.5, size: '4.5px' },
  },
  tall: {
    card: { w: 450, h: 112, x: 240, y: 62 },
    avatar: { x: -196, y: -34, size: 36, scale: 0.72 },
    pill: { x: -124, y: -42, w: 88, h: 18, size: '6.3px' },
    title: { x: -168, y: -20, originX: 0, size: '13.5px' },
    dialogue: { x: -215, y: 12, wrap: 430, size: '6.8px', spacing: 4 },
    progress: { x: -215, y: 43, originX: 0, size: '6.8px' },
  },
};

/** Labels floating over the playfield. */
const WORLD = {
  land: { banner: '7px', indicator: '5px', tag: '5.5px', counter: '6.5px', stomp: '6px', graze: '5px' },
  tall: { banner: '12px', indicator: '6.3px', tag: '6.3px', counter: '6.8px', stomp: '6.5px', graze: '6.3px' },
};

/** The "training complete" card. Positions are measured from the middle of the card. */
const VICTORY = {
  land: {
    card: { w: 360, h: 170 },
    title: { y: -68, size: '11px' },
    desc: { y: -26, size: '5.5px', spacing: 4 },
    start: { y: 24, w: 280, h: 24 },
    row: { y: 56, w: 134, h: 24, dx: 74 },
    btn: '6px',
  },
  tall: {
    card: { w: 440, h: 248 },
    title: { y: -100, size: '14px' },
    desc: { y: -42, size: '6.8px', spacing: 6 },
    start: { y: 28, w: 380, h: 40 },
    row: { y: 80, w: 186, h: 40, dx: 96 },
    btn: '6.9px',
  },
};

export default class TutorialScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TutorialScene' });
  }

  init(data) {
    this.fromPrologue = Boolean(data && data.fromPrologue);
  }

  create() {
    const w = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;

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
    this.bgSky = this.add.tileSprite(0, 0, w, h, 'sky_backdrop').setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    if (h > 270) this.bgSky.tileScaleY = h / 270;
    this.bgMountains = this.add.tileSprite(0, 20, w, Math.max(200, h - 20), 'sky_mountains').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    if (h > 270) this.bgMountains.tileScaleY = Math.max(1, (h - 20) / 250);
    this.bgFogPines = this.add.tileSprite(0, 50, w, Math.max(220, h - 50), 'forest_bg_p0').setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    if (h > 270) this.bgFogPines.tileScaleY = Math.max(1, (h - 50) / 206);
    this.bgMidPines = this.add.tileSprite(0, 80, w, Math.max(220, h - 80), 'forest_bg_p1').setOrigin(0, 0).setScrollFactor(0).setDepth(3);
    if (h > 270) this.bgMidPines.tileScaleY = Math.max(1, (h - 80) / 176);

    const groundY = h > 300 ? h - 70 : 210;
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

    // Fallback cursors for desktop development
    this.cursors = this.input.keyboard.createCursorKeys();
    this.cursors.keys = this.input.keyboard.addKeys('W,A,S,D,J,K,Z,X,E,R,ENTER,ESC');

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

    // Tutorial HUD & Guidance Card (top center)
    this.createTutorialHUD(w, h);

    // Groups for interactive targets
    this.crates = this.physics.add.group();
    this.physics.add.collider(this.crates, this.platforms);

    this.enemies = this.physics.add.group();
    this.physics.add.collider(this.enemies, this.platforms);

    // Player attack vs crates
    this.physics.add.overlap(this.player.attackHitbox, this.crates, (hitbox, crate) => {
      if (this.currentLesson === 3 && !this.lessonCompleted && crate.active) {
        crate.breakCrate(this.player);
        this.txtProgress.setText('[ SHATTER THE CRATE: 1 / 1 ✔ ]');
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
      pauseService.detachScene();
      if (typeof window !== 'undefined' && window.touchController) {
        window.touchController.clearTutorialHighlights();
      }
    });
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
    if (this.hudContainer) {
      const curStep = this.txtStep?.text || 'LESSON 1 / 6';
      const curTitle = this.txtTitle?.text || '1. RUNNING & TRAVERSAL';
      const curDiag = this.txtDialogue?.text || '';
      const curProg = this.txtProgress?.text || '';
      this.hudContainer.destroy();
      this.createTutorialHUD(w, h);
      this.txtStep.setText(curStep);
      this.txtTitle.setText(curTitle);
      this.txtDialogue.setText(curDiag);
      this.txtProgress.setText(curProg);
      if (this.isVictory) this.hudContainer.setVisible(false);
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
    const maxBottom = Math.max(y + 68, (this.cameras?.main?.height || GAME_CONFIG.PORTRAIT_HEIGHT || 380) + 20);
    for (let i = 0; i < numTiles; i++) {
      const tileX = x + i * 16;
      let topKey = (i % 2 === 0) ? 'tile_cliff_top_mid1' : 'tile_cliff_top_mid2';
      this.add.image(tileX, y - 10, topKey).setOrigin(0, 0).setDepth(depth);

      for (let cy = y + 6; cy <= maxBottom; cy += 16) {
        this.add.image(tileX, cy, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(depth - 1);
      }
    }

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

  createTutorialHUD(w, h) {
    const isTall = (h || this.cameras?.main?.height || 270) > 300;
    const H = isTall ? HUD.tall : HUD.land;

    this.hudContainer = this.add.container(H.card.x, H.card.y).setDepth(400);

    // Card background
    this.hudBg = this.add.rectangle(0, 0, H.card.w, H.card.h, 0x06140b, 0.94);
    this.hudBg.setStrokeStyle(1.5, 0x2e6e3e);
    this.hudContainer.add(this.hudBg);

    // Inner framing
    const inner = this.add.rectangle(0, 0, H.card.w - 6, H.card.h - 6, 0x000000, 0);
    inner.setStrokeStyle(1, 0x183b22, 0.6);
    this.hudContainer.add(inner);

    // Sylva Avatar Frame with fairy_portrait (left side)
    this.avatarBg = this.add.rectangle(H.avatar.x, H.avatar.y, H.avatar.size, H.avatar.size, 0x102818, 0.95);
    this.avatarBg.setStrokeStyle(1.5, 0x4ade80);
    this.hudContainer.add(this.avatarBg);

    this.avatarSylva = this.add.image(H.avatar.x, H.avatar.y, 'fairy_portrait').setScale(H.avatar.scale);
    this.hudContainer.add(this.avatarSylva);

    // Step tag pill (top row)
    this.stepPill = this.add.rectangle(H.pill.x, H.pill.y, H.pill.w, H.pill.h, 0x16381e, 0.95);
    this.stepPill.setStrokeStyle(1, 0x4ade80);
    this.hudContainer.add(this.stepPill);

    this.txtStep = this.add.text(H.pill.x, H.pill.y, 'LESSON 1 / 6', {
      fontFamily: 'Press Start 2P',
      fontSize: H.pill.size,
      color: '#4ade80'
    }).setOrigin(0.5);
    this.hudContainer.add(this.txtStep);

    // Title / Action instruction (top row)
    this.txtTitle = this.add.text(H.title.x, H.title.y, '1. RUNNING & TRAVERSAL', {
      fontFamily: 'Press Start 2P',
      fontSize: H.title.size,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(H.title.originX, 0.5);
    this.hudContainer.add(this.txtTitle);

    // Sylva dialogue quote (middle rows: one or two lines, centred between the title and the checklist)
    this.txtDialogue = this.add.text(H.dialogue.x, H.dialogue.y, 'Sylva: "Tap the ◀ and ▶ buttons on the left D-Pad to run."', {
      fontFamily: 'Press Start 2P',
      fontSize: H.dialogue.size,
      color: '#e4faec',
      wordWrap: { width: H.dialogue.wrap },
      lineSpacing: H.dialogue.spacing,
      align: 'left'
    }).setOrigin(0, 0.5);
    this.hudContainer.add(this.txtDialogue);

    // Task checklist badge (bottom row)
    this.txtProgress = this.add.text(H.progress.x, H.progress.y, '[ ◀ RUN LEFT: ⭕ ]   [ ▶ RUN RIGHT: ⭕ ]', {
      fontFamily: 'Press Start 2P',
      fontSize: H.progress.size,
      color: '#98ff20',
      stroke: '#000000',
      strokeThickness: 1.5
    }).setOrigin(H.progress.originX, 0.5);
    this.hudContainer.add(this.txtProgress);
  }

  onCrateBroken(crate) {
    if (this.currentLesson === 3 && !this.lessonCompleted) {
      this.txtProgress.setText('[ SHATTER THE CRATE: 1 / 1 ✔ ]');
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

    switch (lessonNum) {
      case 1:
        // LESSON 1: MOVEMENT
        this.txtStep.setText('LESSON 1 / 6');
        this.txtTitle.setText('1. RUNNING & TRAVERSAL');
        this.txtDialogue.setText('Sylva: "Welcome, Moonwarden! Tap ◀ and ▶ on the left D-Pad to run."');
        this.txtProgress.setText('[ ◀ RUN LEFT: ⭕ ]   [ ▶ RUN RIGHT: ⭕ ]');
        if (window.touchController) {
          window.touchController.setTutorialHighlight(['touch-left', 'touch-right']);
        }
        this.lessonState = { movedLeft: false, movedRight: false };
        break;

      case 2:
        // LESSON 2: JUMP & DOUBLE JUMP
        this.txtStep.setText('LESSON 2 / 6');
        this.txtTitle.setText('2. JUMP & DOUBLE JUMP');
        this.txtDialogue.setText('Sylva: "Tap JUMP on the right to leap. Tap again in mid-air for a Double Jump!"');
        this.txtProgress.setText('[ JUMP: ⭕ ]   [ MID-AIR DOUBLE JUMP: ⭕ ]');
        if (window.touchController) {
          window.touchController.setTutorialHighlight(['touch-jump']);
        }
        this.lessonState = { jumped: false, doubleJumped: false };
        break;

      case 3:
        // LESSON 3: GROUND SLASH
        this.txtStep.setText('LESSON 3 / 6');
        this.txtTitle.setText('3. GROUND SWORD SLASH');
        this.txtDialogue.setText('Sylva: "Draw the Moonshard! Tap SLASH to strike and shatter the practice crate."');
        this.txtProgress.setText('[ SHATTER THE CRATE: 0 / 1 ]');
        if (window.touchController) {
          window.touchController.setTutorialHighlight(['touch-attack']);
        }
        this.spawnTrainingCrate(260, (this.groundY || 210) - 20);
        this.lessonState = { crateShattered: false };
        break;

      case 4:
        // LESSON 4: UPWARD AIR ATTACK (Harmless Diving Bee)
        this.txtStep.setText('LESSON 4 / 6');
        this.txtTitle.setText('4. UPWARD AERIAL ATTACK');
        this.txtDialogue.setText('Sylva: "A corrupted bee swoops from above! Tap UP ATTK to strike it out of the air!"');
        this.txtProgress.setText('[ SLICE SWOOPING BEE: 0 / 1 ]');
        if (window.touchController) {
          window.touchController.setTutorialHighlight(['touch-upslash']);
        }
        this.spawnTutorialBee(310, (this.groundY || 210) - 115);
        this.lessonState = { beeSliced: false };
        break;

      case 5:
        // LESSON 5: AERIAL STOMP BOUNCE (Open airspace, clear of platform)
        this.txtStep.setText('LESSON 5 / 6');
        this.txtTitle.setText('5. AERIAL STOMP BOUNCE');
        this.txtDialogue.setText('Sylva: "Jump high above armored foes and fall onto them to Stomp Bounce safely!"');
        this.txtProgress.setText('[ STOMP BOUNCE ON SHELL: 0 / 1 ]');
        if (window.touchController) {
          window.touchController.setTutorialHighlight(['touch-jump']);
        }
        this.spawnTrainingShell(360, (this.groundY || 210) - 20);
        this.lessonState = { stomped: false };
        break;

      case 6:
        // LESSON 6: LIVE COMBAT SPARRING (Defeat training dummy)
        this.txtStep.setText('LESSON 6 / 6');
        this.txtTitle.setText('6. LIVE COMBAT SPARRING');
        this.txtDialogue.setText('Sylva: "Splendid! Combine all attacks to defeat this training dummy!"');
        this.txtProgress.setText('[ DEFEAT SPARRING DUMMY: 0 / 1 ]');
        if (window.touchController) {
          window.touchController.clearTutorialHighlights();
        }
        this.spawnSparringDummy(350, (this.groundY || 210) - 35);
        this.lessonState = { dummyDefeated: false };
        break;

      default:
        this.showTutorialVictory();
        break;
    }

    // Pop animation on HUD card
    this.tweens.add({
      targets: this.hudContainer,
      scale: { from: 0.95, to: 1.0 },
      duration: 300,
      ease: 'Back.easeOut'
    });
  }

  completeCurrentLesson() {
    if (this.lessonCompleted) return;
    this.lessonCompleted = true;

    try {
      sound.playCoin();
      if (typeof sound.playSparkle === 'function') sound.playSparkle();
    } catch {}

    // Floating checkmark banner
    const checkText = this.add.text(this.player.x, this.player.y - 42, '✔ LESSON COMPLETE!', {
      fontFamily: 'Press Start 2P',
      fontSize: this.worldSizes().banner,
      color: '#4ade80',
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

    const indicator = this.add.text(x, y - 26, '⚔️ SLICE WITH UP ATTK', {
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
      this.txtProgress.setText('[ SLICE SWOOPING BEE: 1 / 1 ✔ ]');
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
        this.txtProgress.setText('[ DEFEAT SPARRING DUMMY: 1 / 1 ✔ ]');
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
        this.txtProgress.setText('[ SHATTER THE CRATE: 1 / 1 ✔ ]');
        this.completeCurrentLesson();
        return;
      }
      const cb = this.trainingCrate.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, cb)) {
        this.trainingCrate.breakCrate(this.player);
        this.txtProgress.setText('[ SHATTER THE CRATE: 1 / 1 ✔ ]');
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
        this.txtProgress.setText('[ STOMP BOUNCE ON SHELL: 1 / 1 ✔ ]');
        this.completeCurrentLesson();
      } else if (this.currentLesson === 6 && this.sparringDummy && this.sparringDummy.active && !this.lessonCompleted) {
        this.sparringDummy.takeDamage(25, this.player.x, false);
        if (this.sparringDummy.hp <= 0) {
          if (this.sparringDummy.dummyLabel) {
            this.sparringDummy.dummyLabel.destroy();
            this.sparringDummy.dummyLabel = null;
          }
          this.txtProgress.setText('[ DEFEAT SPARRING DUMMY: 1 / 1 ✔ ]');
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

        const leftIcon = this.lessonState.movedLeft ? '✔' : '⭕';
        const rightIcon = this.lessonState.movedRight ? '✔' : '⭕';
        this.txtProgress.setText(`[ ◀ RUN LEFT: ${leftIcon} ]   [ ▶ RUN RIGHT: ${rightIcon} ]`);

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

        const jumpIcon = this.lessonState.jumped ? '✔' : '⭕';
        const djumpIcon = this.lessonState.doubleJumped ? '✔' : '⭕';
        this.txtProgress.setText(`[ JUMP: ${jumpIcon} ]   [ MID-AIR DOUBLE JUMP: ${djumpIcon} ]`);

        if (this.lessonState.jumped && this.lessonState.doubleJumped) {
          this.completeCurrentLesson();
        }
      } else if (this.currentLesson === 3) {
        if ((!this.trainingCrate || !this.trainingCrate.active || this.trainingCrate.isBroken) && !this.lessonCompleted) {
          this.txtProgress.setText('[ SHATTER THE CRATE: 1 / 1 ✔ ]');
          this.completeCurrentLesson();
        }
      }
    }
  }

  showTutorialVictory() {
    sound.stopBGM();
    sound.playBGM('victory');
    pauseService.hideButtons();

    if (this.hudContainer) {
      this.hudContainer.setVisible(false);
    }
    this.isVictory = true;

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

    const w = this.cameras.main.width || GAME_CONFIG.WIDTH;
    const h = this.cameras.main.height || GAME_CONFIG.HEIGHT;

    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.75).setDepth(600).setInteractive();

    const card = this.add.container(w / 2, h / 2).setDepth(601);
    const V = h > 300 ? VICTORY.tall : VICTORY.land;

    const cardBg = this.add.rectangle(0, 0, V.card.w, V.card.h, 0x061a10, 0.96);
    cardBg.setStrokeStyle(2, 0x4ade80);
    card.add(cardBg);

    const title = this.add.text(0, V.title.y, '🏆 TRAINING COMPLETE!', {
      fontFamily: 'Press Start 2P',
      fontSize: V.title.size,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    card.add(title);

    const desc = this.add.text(0, V.desc.y, [
      'You have mastered the Moonshard!',
      '• Movement & Mid-Air Double Jumps',
      '• Ground Cleaves & Upward Air Slashes',
      '• Stomp Bounces & Shell Tactics'
    ].join('\n'), {
      fontFamily: 'Press Start 2P',
      fontSize: V.desc.size,
      color: '#c8eed4',
      lineSpacing: V.desc.spacing,
      align: 'center'
    }).setOrigin(0.5);
    card.add(desc);

    const createBtn = (bx, by, bw, bh, bgCol, borderCol, textCol, label, action) => {
      const rect = this.add.rectangle(bx, by, bw, bh, bgCol)
        .setStrokeStyle(1.5, borderCol)
        .setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, by, label, {
        fontFamily: 'Press Start 2P',
        fontSize: V.btn,
        color: textCol
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      const setHover = (hover) => {
        const s = hover ? 1.04 : 1.0;
        rect.setScale(s);
        txt.setScale(s);
      };

      rect.on('pointerover', () => setHover(true));
      txt.on('pointerover', () => setHover(true));
      rect.on('pointerout', () => setHover(false));
      txt.on('pointerout', () => setHover(false));
      rect.on('pointerdown', action);
      txt.on('pointerdown', action);

      card.add([rect, txt]);
    };

    const storyBtnLabel = this.fromPrologue ? '⚔️ BEGIN CHAPTER 1 ➔' : '⚔️ START STORY MODE';
    const proceedToStory = () => {
      sound.playVictory();
      if (this.fromPrologue) {
        this.scene.start('StoryScene', { chapter: 1 });
      } else {
        this.scene.start('StoryIntroScene');
      }
    };

    createBtn(0, V.start.y, V.start.w, V.start.h, 0x164e22, 0x4ade80, '#ffffff', storyBtnLabel, proceedToStory);

    this.input.keyboard.once('keydown-SPACE', proceedToStory);
    this.input.keyboard.once('keydown-ENTER', proceedToStory);

    createBtn(-V.row.dx, V.row.y, V.row.w, V.row.h, 0x1a3848, 0x38bdf8, '#38bdf8', '🏆 DAILY TRIAL', () => {
      sound.playCoin();
      this.scene.start('SurvivalScene');
    });

    createBtn(V.row.dx, V.row.y, V.row.w, V.row.h, 0x382414, 0xf59e0b, '#f59e0b', '◄ MAIN MENU', () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    });

    this.tweens.add({
      targets: card,
      scale: { from: 0.85, to: 1.0 },
      duration: 350,
      ease: 'Back.easeOut'
    });
  }
}

import Phaser from "phaser";
import { GAME_CONFIG } from "../config.js";
import { sound } from "../engine/Audio.js";
import { storage } from "../engine/Storage.js";
import { pauseService } from "../engine/PauseService.js";

const PROLOGUE_SLIDES = [
  {
    chapterTag: "PROLOGUE • I. THE SILVER ERA",
    title: "THE VIGIL OF THE MOON",
    text: "For centuries, the High Forest flourished under the cool vigil of the Silver Moon. Its radiant grace blessed the ancient World-Tree, keeping beast and warden alike in sacred equilibrium.",
    badge: "📜 CHRONICLES OF ELDERWOOD",
    bgColor: 0x05131d,
    tint: 0x38bdf8,
    elements: (scene, container) => {
      // Sky backdrop
      const sky = scene.add.image(240, 80, "sky_backdrop")
        .setScale(1.05)
        .setTint(0x183850)
        .setAlpha(0.7);
      container.add(sky);

      // Mountain silhouette horizon
      const mountains = scene.add.image(240, 118, "sky_mountains")
        .setScale(1.25, 0.8)
        .setTint(0x0c2232)
        .setAlpha(0.9);
      container.add(mountains);

      // Celestial silver moon in the night sky
      const moonAura = scene.add.circle(240, 62, 54, 0x38bdf8, 0.12);
      const moonGlow = scene.add.circle(240, 62, 38, 0x88ccff, 0.25);
      const moon = scene.add.circle(240, 62, 24, 0xe2f4ff);
      moon.setStrokeStyle(2, 0xffffff);
      container.add(moonAura);
      container.add(moonGlow);
      container.add(moon);

      scene.tweens.add({
        targets: [moonGlow, moonAura],
        scale: 1.2,
        alpha: 0.35,
        duration: 2000,
        yoyo: true,
        loop: -1,
        ease: "Sine.easeInOut"
      });

      // Distant lush pines silhouette
      for (let i = 0; i < 9; i++) {
        const pine = scene.add.image(28 + i * 52, 126, "pine_green")
          .setScale(0.66)
          .setTint(0x0f2d37)
          .setAlpha(0.95);
        container.add(pine);
      }
    }
  },
  {
    chapterTag: "PROLOGUE • II. THE CATACLYSM",
    title: "THE SHATTERED SKY",
    text: "Then came the Night of Sorrows. A cosmic tremor tore the moon asunder. Shards of burning lunar core rained down like jagged meteors, plunging deep into the heartwood and elder roots.",
    badge: "⚡ THE NIGHT OF SORROWS",
    bgColor: 0x140308,
    tint: 0xff4d6d,
    elements: (scene, container) => {
      const cx = 240;
      const cy = 60;

      // 1. Apocalyptic Sky & Mountain Horizon
      const sky = scene.add.image(240, 75, "sky_backdrop")
        .setScale(1.05)
        .setTint(0x601424)
        .setAlpha(0.75);
      container.add(sky);

      const mountains = scene.add.image(240, 118, "sky_mountains")
        .setScale(1.25, 0.8)
        .setTint(0x320714)
        .setAlpha(0.95);
      container.add(mountains);

      // Scorched Pine Tree Silhouettes along the horizon
      for (let i = 0; i < 9; i++) {
        const tree = scene.add.image(24 + i * 54, 126, "pine_dark")
          .setScale(0.65)
          .setTint(0x20050e)
          .setAlpha(0.95);
        container.add(tree);
      }

      // 2. Cosmic Lunar Energy Shockwaves
      const shockwaveOuter = scene.add.circle(cx, cy, 68, 0xff1e38, 0.14);
      const shockwaveMid = scene.add.circle(cx, cy, 48, 0xff5500, 0.26);
      container.add(shockwaveOuter);
      container.add(shockwaveMid);

      scene.tweens.add({
        targets: shockwaveOuter,
        scale: 1.35,
        alpha: 0.02,
        duration: 1600,
        yoyo: true,
        loop: -1,
        ease: "Sine.easeInOut"
      });

      scene.tweens.add({
        targets: shockwaveMid,
        scale: 1.22,
        alpha: 0.38,
        duration: 1100,
        yoyo: true,
        loop: -1,
        ease: "Sine.easeInOut"
      });

      // 3. Procedural Pixel-Art Shattered Moon Texture
      scene.ensureShatteredMoonTexture();
      const moonImg = scene.add.image(cx, cy, "tex_shattered_moon");
      container.add(moonImg);

      scene.tweens.add({
        targets: moonImg,
        scale: 1.04,
        duration: 1200,
        yoyo: true,
        loop: -1,
        ease: "Sine.easeInOut"
      });

      // 4. Molten Core Halo Pulse behind fracture
      const coreHalo = scene.add.circle(cx + 4, cy, 14, 0xffaa00, 0.45);
      container.add(coreHalo);
      scene.tweens.add({
        targets: coreHalo,
        scale: 1.35,
        alpha: 0.7,
        duration: 450,
        yoyo: true,
        loop: -1
      });

      // 5. Raining Burning Lunar Core Shards & Meteors (plunging DOWN into the forest roots)
      const fallingShards = [
        // Burning Lunar Core shards bursting from the bottom fracture of the shattered moon (cx=240, cy=54)
        { startX: cx - 6, startY: cy + 12, targetX: cx - 45, targetY: 138, tailLen: 26, speed: 720, delay: 0 },
        { startX: cx + 4, startY: cy + 14, targetX: cx + 48, targetY: 136, tailLen: 26, speed: 750, delay: 220 },
        { startX: cx - 2, startY: cy + 18, targetX: cx - 15, targetY: 142, tailLen: 22, speed: 640, delay: 460 },
        { startX: cx - 8, startY: cy + 10, targetX: cx - 85, targetY: 135, tailLen: 30, speed: 820, delay: 680 },
        { startX: cx + 8, startY: cy + 10, targetX: cx + 90, targetY: 135, tailLen: 30, speed: 800, delay: 350 },

        // Jagged Meteors raining down diagonally from high celestial atmosphere into the elder roots
        { startX: 70, startY: -20, targetX: 125, targetY: 136, tailLen: 42, speed: 850, delay: 100 },
        { startX: 160, startY: -25, targetX: 205, targetY: 138, tailLen: 36, speed: 820, delay: 380 },
        { startX: 320, startY: -25, targetX: 275, targetY: 138, tailLen: 36, speed: 840, delay: 550 },
        { startX: 410, startY: -20, targetX: 355, targetY: 136, tailLen: 42, speed: 870, delay: 250 },
        { startX: 240, startY: -30, targetX: 240, targetY: 140, tailLen: 38, speed: 780, delay: 750 }
      ];

      fallingShards.forEach((m, idx) => {
        const dx = m.targetX - m.startX;
        const dy = m.targetY - m.startY;
        const flightAngle = Math.atan2(dy, dx);

        const mGroup = scene.add.container(m.startX, m.startY);
        mGroup.setAlpha(0); // Invisible until tween starts

        // Fiery outer flare tail
        const tailOuter = scene.add.rectangle(0, 0, m.tailLen, 3.8, 0xff2200, 0.6);
        tailOuter.setOrigin(1, 0.5);
        tailOuter.setRotation(flightAngle);

        // Fiery inner bright core tail
        const tailInner = scene.add.rectangle(0, 0, m.tailLen * 0.75, 2.0, 0xffaa00, 0.95);
        tailInner.setOrigin(1, 0.5);
        tailInner.setRotation(flightAngle);

        // White-hot trailing needle
        const tailNeedle = scene.add.rectangle(0, 0, m.tailLen * 0.45, 1.0, 0xffffff, 0.95);
        tailNeedle.setOrigin(1, 0.5);
        tailNeedle.setRotation(flightAngle);

        // Glowing burning head at (0, 0)
        const outerGlow = scene.add.circle(0, 0, 5.5, 0xff3300, 0.5);
        const coreGlow = scene.add.circle(0, 0, 3.8, 0xffaa00, 0.85);
        const coreWhite = scene.add.circle(0, 0, 2.0, 0xffffff, 1.0);

        mGroup.add(tailOuter);
        mGroup.add(tailInner);
        mGroup.add(tailNeedle);
        mGroup.add(outerGlow);
        mGroup.add(coreGlow);
        mGroup.add(coreWhite);
        container.add(mGroup);

        scene.tweens.add({
          targets: mGroup,
          x: { start: m.startX, to: m.targetX },
          y: { start: m.startY, to: m.targetY },
          alpha: { start: 1, to: 0.1 },
          scaleX: { start: 1.1, to: 0.7 },
          scaleY: { start: 1.1, to: 0.7 },
          duration: m.speed,
          delay: m.delay,
          loop: -1,
          repeatDelay: 220 + (idx % 4) * 140,
          onStart: () => mGroup.setAlpha(1),
          onRepeat: () => {
            mGroup.setPosition(m.startX, m.startY);
            mGroup.setAlpha(1);
          }
        });
      });

      // 6. Scorched Ground Embers rising from the elder roots where lunar shards plunge
      const groundEmbers = scene.add.particles(0, 0, "spark", {
        x: { min: 80, max: 400 },
        y: { min: 126, max: 138 },
        scale: { start: 0.8, end: 0 },
        alpha: { start: 0.85, end: 0 },
        speedY: { min: -26, max: -10 },
        speedX: { min: -12, max: 12 },
        lifespan: 1100,
        frequency: 110,
        tint: [0xff3300, 0xff7700, 0xffcc00]
      });
      container.add(groundEmbers);
    }
  },
  {
    chapterTag: "PROLOGUE • III. THE PALE BLIGHT",
    title: "CORRUPTED ROOTS",
    text: "Deep underground, celestial purity turned venomous. The Pale Blight took root. Forest beasts mutated into crystal-crazed thralls, and ancient Guardian Obelisks were bound in dark seal rings.",
    badge: "🔮 CORRUPTED SHRINES",
    bgColor: 0x12051e,
    tint: 0xc084fc,
    elements: (scene, container) => {
      const sky = scene.add.image(240, 75, "sky_backdrop")
        .setScale(1.05)
        .setTint(0x351448)
        .setAlpha(0.7);
      container.add(sky);

      const mountains = scene.add.image(240, 118, "sky_mountains")
        .setScale(1.25, 0.8)
        .setTint(0x200b32)
        .setAlpha(0.9);
      container.add(mountains);

      // Obelisk silhouette bound by dark crystal
      const obelisk = scene.add.rectangle(240, 86, 18, 52, 0x1a1226);
      obelisk.setStrokeStyle(2, 0x9933cc);
      const ring = scene.add.circle(240, 81, 24, 0x7700aa, 0.4);
      ring.setStrokeStyle(1.5, 0xff00ff);
      container.add(obelisk);
      container.add(ring);

      scene.tweens.add({
        targets: ring,
        scale: 1.15,
        alpha: 0.7,
        duration: 1200,
        yoyo: true,
        loop: -1
      });

      // Corrupted mob silhouettes on sides
      const boar = scene.add.sprite(180, 106, "boar_idle").setTint(0xaa2244).setScale(1.1);
      boar.play("boar_idle_anim");
      const snail = scene.add.sprite(300, 106, "snail_walk").setTint(0x9922aa).setScale(1.1);
      snail.play("snail_walk_anim");
      snail.setFlipX(true);
      container.add(boar);
      container.add(snail);
    }
  },
  {
    chapterTag: "PROLOGUE • IV. THE MOONWARDEN",
    title: "THE MOONSHARD AWAKENS",
    text: "You are Selene, the last Moonwarden. Armed with the ancestral Moonshard—forged from an uncorrupted lunar seed—you must cleanse the three Shrines, free the guardians, and restore the High Forest!",
    badge: "⚔️ WARDEN OF THE HIGH FOREST",
    bgColor: 0x051d18,
    tint: 0x4ade80,
    elements: (scene, container) => {
      const sky = scene.add.image(240, 75, "sky_backdrop")
        .setScale(1.05)
        .setTint(0x0f3428)
        .setAlpha(0.7);
      container.add(sky);

      const mountains = scene.add.image(240, 118, "sky_mountains")
        .setScale(1.25, 0.8)
        .setTint(0x0a241c)
        .setAlpha(0.9);
      container.add(mountains);

      // Hero ready for battle
      const hero = scene.add.sprite(230, 94, "char_idle").setScale(1.3);
      hero.play("player_idle");
      container.add(hero);

      // Glowing sword blade aura
      const bladeGlow = scene.add.circle(248, 94, 14, 0x00ffff, 0.45);
      container.add(bladeGlow);

      scene.tweens.add({
        targets: bladeGlow,
        scale: 1.4,
        alpha: 0.7,
        duration: 600,
        yoyo: true,
        loop: -1
      });

      // Companion hovering
      const pet = scene.add.sprite(205, 74, "fairy_fly").setScale(0.8);
      pet.play("fairy_fly_anim");
      container.add(pet);
    }
  }
];

export default class StoryIntroScene extends Phaser.Scene {
  constructor() {
    super({ key: "StoryIntroScene" });
  }

  ensureShatteredMoonTexture() {
    if (this.textures.exists("tex_shattered_moon")) return;

    const size = 80;
    const canvas = this.textures.createCanvas("tex_shattered_moon", size, size);
    const ctx = canvas.getContext();
    const cx = size / 2;
    const cy = size / 2;
    const r = 26;

    ctx.save();

    // 1. Left Major Crescent Lunar Half
    ctx.beginPath();
    ctx.arc(cx - 3, cy, r, 0.5 * Math.PI, 1.5 * Math.PI, false);
    ctx.lineTo(cx - 1, cy - r + 3);
    // Jagged fissure inner edge
    ctx.lineTo(cx - 4, cy - 14);
    ctx.lineTo(cx + 2, cy - 2);
    ctx.lineTo(cx - 5, cy + 10);
    ctx.lineTo(cx - 1, cy + r - 3);
    ctx.closePath();
    ctx.fillStyle = "#a82436";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff7588";
    ctx.stroke();

    // Lunar maria / craters on left piece
    ctx.fillStyle = "#6d1220";
    ctx.beginPath();
    ctx.arc(cx - 12, cy - 8, 5, 0, Math.PI * 2);
    ctx.arc(cx - 10, cy + 9, 6, 0, Math.PI * 2);
    ctx.arc(cx - 17, cy + 1, 4, 0, Math.PI * 2);
    ctx.fill();

    // 2. Upper Severed Shard (drifting top right)
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy - 18);
    ctx.lineTo(cx + 22, cy - 12);
    ctx.lineTo(cx + 17, cy - 2);
    ctx.lineTo(cx + 6, cy - 5);
    ctx.closePath();
    ctx.fillStyle = "#9c2032";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff7588";
    ctx.stroke();

    // 3. Lower Severed Shard (drifting bottom right)
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy + 4);
    ctx.lineTo(cx + 20, cy + 2);
    ctx.lineTo(cx + 22, cy + 16);
    ctx.lineTo(cx + 8, cy + 19);
    ctx.closePath();
    ctx.fillStyle = "#8a1828";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff6b6b";
    ctx.stroke();

    // 4. Molten Veins & Fissure Energy
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ff9900";
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 20);
    ctx.lineTo(cx + 4, cy - 5);
    ctx.lineTo(cx - 2, cy + 6);
    ctx.lineTo(cx + 5, cy + 20);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 20);
    ctx.lineTo(cx + 4, cy - 5);
    ctx.lineTo(cx - 2, cy + 6);
    ctx.lineTo(cx + 5, cy + 20);
    ctx.stroke();

    ctx.restore();
    canvas.refresh();
  }

  init() {
    this.currentSlide = 0;
    this.isTransitioning = false;
    this.tutorialPromptOpen = false;
    this.lastAdvanceTime = 0;
  }

  create() {
    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || (typeof window !== 'undefined' && window.innerHeight > window.innerWidth ? (GAME_CONFIG.PORTRAIT_HEIGHT || 440) : GAME_CONFIG.HEIGHT);
    this.currentSlide = 0;
    this.isTransitioning = false;
    this.tutorialPromptOpen = false;
    this.lastAdvanceTime = 0;

    pauseService.detachScene();

    if (typeof window !== "undefined" && window.touchController) {
      if (h > 300) {
        window.touchController.show();
      } else {
        window.touchController.hide();
      }
    }

    // Outer Background
    this.bgRect = this.add.rectangle(w / 2, h / 2, w, h, 0x05131d);

    const isTall = h > 300;

    // Slide Illustration Container (vertically centered in upper canvas)
    const illustrationOffsetY = isTall ? 65 : 0;
    this.illustrationContainer = this.add.container(0, illustrationOffsetY);

    // Top Header tags
    const chapterTagY = isTall ? 28 : 18;
    const titleTagY = isTall ? 46 : 32;

    this.txtChapterTag = this.add.text(w / 2, chapterTagY, "", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "7px" : "6.5px",
      color: "#00f0ff",
      letterSpacing: 1
    }).setOrigin(0.5);

    this.txtTitle = this.add.text(w / 2, titleTagY, "", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "11px" : "9px",
      color: "#ffd166",
      stroke: "#000",
      strokeThickness: 3
    }).setOrigin(0.5);

    // Bottom Story Narration Interface Box
    const boxW = isTall ? (w - 30) : (w - 40);
    const boxH = isTall ? 88 : 50;
    const boxY = isTall ? (h - 78) : 166;

    // Dual-layer RPG Dialogue Frame
    this.textBoxOuter = this.add.rectangle(w / 2, boxY, boxW, boxH, 0x07111a, 0.92);
    this.textBoxOuter.setStrokeStyle(1.5, 0x1d3a47);

    // Inner accent border
    this.textBoxInner = this.add.rectangle(w / 2, boxY, boxW - 6, boxH - 6, 0x000000, 0);
    this.textBoxInner.setStrokeStyle(1, 0x0c2534, 0.8);

    // Dialogue Box Corner Rivets
    const boxCorners = [
      { x: w / 2 - boxW / 2 + 4, y: boxY - boxH / 2 + 4 },
      { x: w / 2 + boxW / 2 - 4, y: boxY - boxH / 2 + 4 },
      { x: w / 2 - boxW / 2 + 4, y: boxY + boxH / 2 - 4 },
      { x: w / 2 + boxW / 2 - 4, y: boxY + boxH / 2 - 4 }
    ];
    boxCorners.forEach(bc => {
      this.add.rectangle(bc.x, bc.y, 3, 3, 0xf6c026, 0.9);
    });

    // Dialogue Box Badge / Ribbon
    this.badgeBox = this.add.rectangle(w / 2, boxY - boxH / 2, isTall ? 180 : 160, isTall ? 14 : 12, 0x0a1c28);
    this.badgeBox.setStrokeStyle(1, 0x244b62);
    this.txtBadge = this.add.text(w / 2, boxY - boxH / 2, "", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "5.5px" : "5px",
      color: "#ffd166"
    }).setOrigin(0.5);

    // Story narration text
    this.txtBody = this.add.text(28, boxY - (isTall ? 28 : 14), "", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "6.8px" : "6px",
      color: "#e8f8fc",
      lineSpacing: isTall ? 6 : 5.5,
      wordWrap: { width: boxW - 16 }
    });

    // Bottom Controls Bar
    const controlsY = isTall ? (h - 18) : 203;
    const pillH = isTall ? 22 : 17;

    // 1. Skip Button Pill (bottom left)
    const skipPillX = isTall ? 80 : 72;
    const skipPillY = controlsY;
    this.skipPill = this.add.rectangle(skipPillX, skipPillY, isTall ? 108 : 96, pillH, 0x091722, 0.9)
      .setStrokeStyle(1, 0x244254)
      .setInteractive({ useHandCursor: true });

    this.txtSkip = this.add.text(skipPillX, skipPillY, "⏭ SKIP STORY", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "6px" : "5.5px",
      color: "#8aa4b8"
    }).setOrigin(0.5);

    this.skipPill.on("pointerover", () => {
      this.skipPill.setStrokeStyle(1, 0x4ade80);
      this.txtSkip.setColor("#ffffff");
    });
    this.skipPill.on("pointerout", () => {
      this.skipPill.setStrokeStyle(1, 0x244254);
      this.txtSkip.setColor("#8aa4b8");
    });
    this.skipPill.on("pointerdown", () => this.skipPrologue());

    // 2. Pagination Dots
    this.dots = [];
    for (let i = 0; i < PROLOGUE_SLIDES.length; i++) {
      const dot = this.add.circle(w / 2 - 24 + i * 16, controlsY, isTall ? 3.5 : 3, i === 0 ? 0x00ffff : 0x224455);
      this.dots.push(dot);
    }

    // 3. Action Prompt (Next / Begin) Pill (bottom right)
    const nextPillX = w - (isTall ? 72 : 66);
    const nextPillY = controlsY;
    this.nextPill = this.add.rectangle(nextPillX, nextPillY, isTall ? 96 : 84, pillH, 0x1d1a08, 0.9)
      .setStrokeStyle(1, 0xf6c026)
      .setInteractive({ useHandCursor: true });

    this.txtPrompt = this.add.text(nextPillX, nextPillY, "NEXT ▶", {
      fontFamily: "Press Start 2P",
      fontSize: isTall ? "6.5px" : "5.5px",
      color: "#ffd166"
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const onNextClick = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.advanceSlide();
    };
    this.nextPill.on("pointerdown", onNextClick);
    this.txtPrompt.on("pointerdown", onNextClick);

    this.tweens.add({
      targets: [this.nextPill, this.txtPrompt],
      scale: 1.04,
      duration: 650,
      yoyo: true,
      loop: -1
    });

    // Input handlers
    this.input.keyboard.on("keydown-SPACE", () => {
      if (this.tutorialPromptOpen) {
        if (this.onChoosePlayTutorial) this.onChoosePlayTutorial();
        return;
      }
      this.advanceSlide();
    });
    this.input.keyboard.on("keydown-ENTER", () => {
      if (this.tutorialPromptOpen) {
        if (this.onChoosePlayTutorial) this.onChoosePlayTutorial();
        return;
      }
      this.advanceSlide();
    });
    this.input.keyboard.on("keydown-ESCAPE", () => {
      if (this.tutorialPromptOpen) {
        if (this.onChooseSkipTutorial) this.onChooseSkipTutorial();
        return;
      }
      this.skipPrologue();
    });
    this.input.on("pointerdown", (pointer) => {
      if (this.tutorialPromptOpen) return;
      // Ignore clicks in the bottom control bar area (handled by dedicated buttons)
      if (pointer.y > 185) return;
      this.advanceSlide();
    });

    // Ambient floating sparks
    this.particles = this.add.particles(0, 0, "spark", {
      x: { min: 0, max: w },
      y: { min: 0, max: h },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.4, end: 0 },
      speedY: { min: -15, max: -5 },
      lifespan: 2500,
      frequency: 180
    });

    sound.playBGM('title');
    this.renderSlide(0);
  }

  update() {
    if (this.isTransitioning) return;
    if (typeof window !== "undefined" && window.touchController) {
      const tc = window.touchController;
      const triggers = tc.consumeTriggers();

      if (triggers.justAttack || triggers.justJump || triggers.justUpSlash || (tc.state.right && !this._rightHeld)) {
        this._rightHeld = true;
        this.advanceSlide();
      } else if (!tc.state.right) {
        this._rightHeld = false;
      }

      if (tc.state.left && !this._leftHeld) {
        this._leftHeld = true;
        if (this.currentSlide > 0) {
          sound.playCancel();
          this.currentSlide--;
          this.renderSlide(this.currentSlide);
        }
      } else if (!tc.state.left) {
        this._leftHeld = false;
      }
    }
  }

  renderSlide(idx) {
    const data = PROLOGUE_SLIDES[idx];
    if (!data) return;

    this.illustrationContainer.removeAll(true);
    data.elements(this, this.illustrationContainer);

    this.txtChapterTag.setText(data.chapterTag);
    this.txtChapterTag.setColor("#" + data.tint.toString(16).padStart(6, "0"));
    this.txtTitle.setText(data.title);
    this.txtBody.setText(data.text);
    this.txtBadge.setText(data.badge || "📜 MOONSHARD CHRONICLE");

    // Color transition on background & interface borders
    this.tweens.add({
      targets: this.bgRect,
      fillColor: data.bgColor,
      duration: 500
    });


    if (this.textBoxOuter) {
      this.textBoxOuter.setStrokeStyle(1.5, data.tint, 0.7);
    }
    if (this.badgeBox) {
      this.badgeBox.setStrokeStyle(1, data.tint, 0.8);
    }

    // Special cinematic effects for Cataclysm
    if (idx === 1) {
      this.cameras.main.shake(500, 0.007);
      sound.playRumble();
    } else {
      sound.playBlip(true);
    }

    this.dots.forEach((dot, i) => {
      dot.fillColor = i === idx ? data.tint : 0x224455;
      dot.radius = i === idx ? 3.5 : 2.5;
    });

    if (idx === PROLOGUE_SLIDES.length - 1) {
      this.txtPrompt.setText("BEGIN QUEST ⚔️");
      this.txtPrompt.setColor("#00ffcc");
      this.nextPill.setStrokeStyle(1, 0x00ffcc);
    } else {
      this.txtPrompt.setText("NEXT ▶");
      this.txtPrompt.setColor("#ffd166");
      this.nextPill.setStrokeStyle(1, 0xf6c026);
    }
  }

  advanceSlide() {
    if (this.isTransitioning || this.tutorialPromptOpen) return;

    const now = Date.now();
    if (this.lastAdvanceTime && (now - this.lastAdvanceTime < 350)) {
      return;
    }
    this.lastAdvanceTime = now;

    if (this.currentSlide < PROLOGUE_SLIDES.length - 1) {
      this.currentSlide++;
      this.renderSlide(this.currentSlide);
    } else {
      this.promptTutorialChoice();
    }
  }

  skipPrologue() {
    if (this.isTransitioning || this.tutorialPromptOpen) return;

    const now = Date.now();
    if (this.lastAdvanceTime && (now - this.lastAdvanceTime < 350)) {
      return;
    }
    this.lastAdvanceTime = now;

    this.promptTutorialChoice();
  }

  promptTutorialChoice() {
    if (this.isTransitioning || this.tutorialPromptOpen) return;
    this.tutorialPromptOpen = true;
    sound.playVictory();

    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    // Dark blocking backdrop overlay
    this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.85)
      .setDepth(500)
      .setInteractive();

    const card = this.add.container(w / 2, h / 2).setDepth(501);

    // Modal background card frame
    const cardBg = this.add.rectangle(0, 0, 380, 184, 0x06151e, 0.98);
    cardBg.setStrokeStyle(1.5, 0x00e5ff);
    card.add(cardBg);

    // Corner decorative rivets
    const rivets = [
      { x: -184, y: -86 },
      { x: 184, y: -86 },
      { x: -184, y: 86 },
      { x: 184, y: 86 }
    ];
    rivets.forEach(rv => {
      card.add(this.add.rectangle(rv.x, rv.y, 3, 3, 0xf6c026, 0.9));
    });

    // Inner subtle glow panel for Sylva & Dialogue
    const innerPanel = this.add.rectangle(0, -36, 356, 72, 0x0c242e, 0.85);
    innerPanel.setStrokeStyle(1, 0x1d4754);
    card.add(innerPanel);

    // Sylva Avatar frame
    const avatarRing = this.add.circle(-134, -36, 22, 0x082e38);
    avatarRing.setStrokeStyle(1.5, 0x00ffcc);
    const sylvaAvatar = this.add.image(-134, -36, 'fairy_portrait').setScale(0.72);
    card.add([avatarRing, sylvaAvatar]);

    // Title
    const title = this.add.text(-96, -56, '⚔️ PLAY COMBAT TUTORIAL?', {
      fontFamily: 'Press Start 2P',
      fontSize: '7.5px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0, 0.5);
    card.add(title);

    // Subtitle / Dialogue from Sylva (clean 2 lines)
    const sylvaText = this.add.text(-96, -40, '"Master your blade before the woods!\nPractice slashes, aerial jumps & combos."', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#d2f4ee',
      lineSpacing: 5
    });
    card.add(sylvaText);

    // Feature highlights badges
    const pill1Bg = this.add.rectangle(-85, 3, 150, 16, 0x07151c, 0.95);
    pill1Bg.setStrokeStyle(1, 0x1d4754);
    const pill1Txt = this.add.text(-85, 3, '🎮 Touch Controls', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#64dfdf'
    }).setOrigin(0.5);

    const pill2Bg = this.add.rectangle(85, 3, 150, 16, 0x07151c, 0.95);
    pill2Bg.setStrokeStyle(1, 0x1d4754);
    const pill2Txt = this.add.text(85, 3, '🗡️ Combos & Air Jumps', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#64dfdf'
    }).setOrigin(0.5);
    card.add([pill1Bg, pill1Txt, pill2Bg, pill2Txt]);

    const createBtn = (bx, by, bw, bh, bgCol, borderCol, hoverBg, hoverBorder, textCol, label, action) => {
      const rect = this.add.rectangle(bx, by, bw, bh, bgCol)
        .setStrokeStyle(1.5, borderCol)
        .setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, by, label, {
        fontFamily: 'Press Start 2P',
        fontSize: '6px',
        color: textCol
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      const setHover = (hover) => {
        rect.setFillStyle(hover ? hoverBg : bgCol);
        rect.setStrokeStyle(1.5, hover ? hoverBorder : borderCol);
        txt.setColor(hover ? '#ffd166' : textCol);
        if (hover) sound.playBlip(true);
      };

      rect.on('pointerover', () => setHover(true));
      txt.on('pointerover', () => setHover(true));
      rect.on('pointerout', () => setHover(false));
      txt.on('pointerout', () => setHover(false));
      rect.on('pointerdown', action);
      txt.on('pointerdown', action);

      card.add([rect, txt]);
      return { rect, txt };
    };

    const choosePlayTutorial = () => {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      sound.playCoin();
      this.cameras.main.fade(400, 0, 0, 0);
      this.time.delayedCall(400, () => {
        this.scene.start('TutorialScene', { fromPrologue: true });
      });
    };

    const chooseSkipTutorial = () => {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      sound.playCoin();
      this.cameras.main.fade(400, 0, 0, 0);
      this.time.delayedCall(400, () => {
        this.scene.start('StoryScene', { chapter: 1 });
      });
    };

    this.onChoosePlayTutorial = choosePlayTutorial;
    this.onChooseSkipTutorial = chooseSkipTutorial;

    // Button 1: PLAY TUTORIAL (Recommended)
    createBtn(0, 30, 340, 26, 0x134e2c, 0x4ade80, 0x1d7040, 0x86efac, '#ffffff', '⚔️ PLAY TUTORIAL (RECOMMENDED)', choosePlayTutorial);

    // Button 2: SKIP TO CHAPTER 1
    createBtn(0, 62, 340, 22, 0x162432, 0x334d65, 0x223548, 0x64dfdf, '#cbd5e1', '⏩ SKIP TO CHAPTER 1 (WHISPERING WOODS)', chooseSkipTutorial);

    // Keyboard shortcut hint
    const keyHint = this.add.text(0, 80, '[ENTER / SPACE] Play  •  [ESC] Skip', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#527588'
    }).setOrigin(0.5);
    card.add(keyHint);

    // Card entrance animation
    card.setScale(0.85);
    card.setAlpha(0);
    this.tweens.add({
      targets: card,
      scale: 1,
      alpha: 1,
      duration: 250,
      ease: 'Back.easeOut'
    });
  }

  onViewportResize(w, h) {
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
    if (!this.tutorialPromptOpen && !this.isTransitioning) {
      this.scene.restart();
    }
  }
}

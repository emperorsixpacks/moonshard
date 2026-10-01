import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { nimiqService } from '../engine/NimiqService.js';
import { pauseService } from '../engine/PauseService.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    pauseService.detachScene();
    this.cameras.main.resetFX();
    sound.playBGM('title');

    if (typeof window !== 'undefined' && window.touchController) {
      if (h > 300) {
        window.touchController.show();
      } else {
        window.touchController.hide();
      }
    }

    if (typeof window !== 'undefined' && typeof window.__dismissGameLoader === 'function') {
      window.__dismissGameLoader();
    }

    // Parallax background
    // Layered forest background matching the realm
    this.bgSky = this.add.tileSprite(0, 0, w, h, 'sky_backdrop').setOrigin(0, 0).setDepth(0);
    if (h > 270) this.bgSky.tileScaleY = h / 270;
    this.bgMountains = this.add.tileSprite(0, 20, w, Math.max(200, h - 20), 'sky_mountains').setOrigin(0, 0).setDepth(1);
    if (h > 270) this.bgMountains.tileScaleY = Math.max(1, (h - 20) / 250);
    this.bgFogPines = this.add.tileSprite(0, 50, w, Math.max(220, h - 50), 'forest_bg_p0').setOrigin(0, 0).setDepth(2);
    if (h > 270) this.bgFogPines.tileScaleY = Math.max(1, (h - 50) / 206);
    this.bgMidPines = this.add.tileSprite(0, 80, w, Math.max(220, h - 80), 'forest_bg_p1').setOrigin(0, 0).setDepth(3);
    if (h > 270) this.bgMidPines.tileScaleY = Math.max(1, (h - 80) / 176);

    // Decorative background pine trees and grass cliff along bottom
    const treeSpacing = 120;
    for (let i = 0; i < Math.ceil(w / treeSpacing); i++) {
      const tx = 40 + i * treeSpacing;
      const treeKey = (i % 2 === 0) ? 'pine_green' : 'pine_dark';
      this.add.image(tx, h - 20, treeKey).setOrigin(0.5, 1.0).setScale(0.85).setDepth(4);
    }
    const numTiles = Math.ceil(w / 16);
    for (let i = 0; i < numTiles; i++) {
      const tileX = i * 16;
      let topKey = (i % 2 === 0) ? 'tile_cliff_top_mid1' : 'tile_cliff_top_mid2';
      this.add.image(tileX, h - 24, topKey).setOrigin(0, 0).setDepth(5);
      this.add.image(tileX, h - 8, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(5);
    }

    // Ambient floating leaves/embers
    this.createAmbientLeaves(w, h);

    // Title banner container
    const isTall = h > 300;
    const titleY = isTall ? 50 : 33;
    const titleBoxW = isTall ? 340 : 310;
    const titleBoxH = isTall ? 50 : 42;
    const titleBox = this.add.rectangle(w / 2, titleY, titleBoxW, titleBoxH, 0x0a140a, 0.88).setDepth(10);
    titleBox.setStrokeStyle(1.5, 0x2e4e2e);

    const titleText = this.add.text(w / 2, titleY - (isTall ? 14 : 12), 'MOONSHARD', {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '14px' : '13px',
      color: '#f6c026',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(11);

    const subText = this.add.text(w / 2, titleY + 1, 'THE HIGH FOREST', {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '7.5px' : '6.5px',
      color: '#98ff20',
      stroke: '#000000',
      strokeThickness: 2,
      letterSpacing: 2
    }).setOrigin(0.5).setDepth(11);

    // Connection status badge (tap to connect after skipping the gate)
    const status = nimiqService.getStatus();
    const statusBadge = status.connected ? `⚡ ${status.shortAddress}` : (status.offline ? '⚡ API OFFLINE' : '⚡ NOT CONNECTED');
    const badge = this.add.text(w / 2, titleY + (isTall ? 14 : 12), statusBadge, {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '5.5px' : '4.5px',
      color: '#a0c4a0',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(11);
    badge.setInteractive({ useHandCursor: true });
    badge.on('pointerdown', () => {
      if (!status.connected && window.__lunaGate) window.__lunaGate.show().then(() => {});
    });

    // Pulse animation on title
    this.tweens.add({
      targets: [titleText, subText],
      scale: 1.02,
      duration: 1200,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut'
    });

    // Menu Buttons Container - properly spaced across the viewport height
    const startY = isTall ? 114 : 66;
    const spacing = isTall ? 45 : 22;
    const btnW = isTall ? 340 : 310;
    const btnH = isTall ? 33 : 20;

    const options = [
      {
        text: '⚔️ 1. STORY MODE',
        desc: 'The Shattered Moon & The Blighted Roots',
        action: () => this.openStoryModal(),
        shouldFade: false
      },
      {
        text: '🎓 2. COMBAT TUTORIAL',
        desc: 'Learn Touch Moves, Jumps, Slashes & Combos',
        action: () => this.scene.start('TutorialScene'),
        shouldFade: true
      },
      {
        text: '🏆 3. ENDLESS MODE',
        desc: 'Endless Arena • On-Chain Leaderboard',
        action: () => this.scene.start('SurvivalScene'),
        shouldFade: true
      },
      {
        text: '⚒️ 4. FORGE & SATCHEL',
        desc: 'Craft Blades & Companion Relics',
        action: () => this.scene.start('ForgeScene'),
        shouldFade: true
      },
      {
        text: '💰 5. LEADERBOARD',
        desc: 'All-Time & Daily Rankings',
        action: () => this.scene.start('LeaderboardScene'),
        shouldFade: true
      },
      {
        text: '⚙️ 6. SETTINGS',
        desc: 'Sound Effects & Background Music',
        action: () => this.openSettingsModal(),
        shouldFade: false
      }
    ];

    options.forEach((opt, idx) => {
      this.createMenuButton(w / 2, startY + idx * spacing, btnW, btnH, opt.text, opt.desc, opt.action, opt.shouldFade, isTall);
    });

    // Animated warrior on menu
    const hero = this.add.sprite(46, h - 38, 'char_idle').setScale(1.1).setDepth(10);
    hero.play('player_idle');
    this.menuHero = hero;
    this.heroGroundY = h - 38;

    // Tiny companion pet hovering if active
    if (storage.isCompanionActive()) {
      const pet = this.add.sprite(hero.x - 14, hero.y - 20, 'fairy_fly').setScale(0.7).setDepth(10);
      pet.play('fairy_fly_anim');
      this.menuPet = pet;
    }

    // Peaceful boar grazing on right
    const boar = this.add.sprite(w - 52, h - 32, 'boar_idle').setDepth(10);
    boar.play('boar_idle_anim');
    boar.setFlipX(true);
  }

  createMenuButton(x, y, width, height, label, subtitle, callback, shouldFade = false, isTall = false) {
    const btnBg = this.add.rectangle(x, y, width, height, 0x142814, 0.88).setDepth(10);
    btnBg.setStrokeStyle(1.5, 0x3c6e3c);
    btnBg.setInteractive({ useHandCursor: true });

    const txt = this.add.text(x, y - (isTall ? 5 : 3), label, {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '8.5px' : '7px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(11);

    const sub = this.add.text(x, y + (isTall ? 6 : 5), subtitle, {
      fontFamily: 'Press Start 2P',
      fontSize: isTall ? '5.5px' : '4.5px',
      color: '#86b886'
    }).setOrigin(0.5).setDepth(11);

    btnBg.on('pointerover', () => {
      btnBg.setFillStyle(0x285028, 0.95);
      btnBg.setStrokeStyle(1.5, 0x98ff20);
      txt.setColor('#f6c026');
      sound.playSlash(1);
    });

    btnBg.on('pointerout', () => {
      btnBg.setFillStyle(0x142814, 0.88);
      btnBg.setStrokeStyle(1.5, 0x3c6e3c);
      txt.setColor('#ffffff');
    });

    btnBg.on('pointerdown', () => {
      sound.playCoin();
      if (shouldFade) {
        this.cameras.main.fade(200, 0, 0, 0);
        this.time.delayedCall(220, callback);
      } else {
        callback();
      }
    });
  }

  createAmbientLeaves(w, h) {
    for (let i = 0; i < 15; i++) {
      const leaf = this.add.circle(
        Phaser.Math.Between(0, w),
        Phaser.Math.Between(0, h),
        Phaser.Math.Between(1, 2),
        0x98ff20,
        Phaser.Math.FloatBetween(0.3, 0.7)
      );

      this.tweens.add({
        targets: leaf,
        x: `+=${Phaser.Math.Between(20, 60)}`,
        y: `+=${Phaser.Math.Between(30, 80)}`,
        duration: Phaser.Math.Between(3000, 6000),
        repeat: -1,
        yoyo: false,
        onRepeat: () => {
          leaf.x = Phaser.Math.Between(0, w);
          leaf.y = 0;
        }
      });
    }
  }

  openStoryModal() {
    if (this.storyModalObjects) return;
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    this.storyModalObjects = [];

    // 1. Dim full-screen overlay backdrop (captures any clicks outside panel)
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.72)
      .setDepth(590)
      .setInteractive();
    overlay.on('pointerdown', () => this.closeStoryModal());
    this.storyModalObjects.push(overlay);

    // 2. Modal panel frame
    const panelW = 426;
    const panelH = 250;
    const panel = this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x071317, 0.96)
      .setStrokeStyle(2, 0x1d4754)
      .setDepth(600)
      .setInteractive(); // Blocks clicks from hitting overlay underneath
    this.storyModalObjects.push(panel);

    // 3. Header
    const title = this.add.text(w / 2, h / 2 - 108, '⚔️ CHOOSE CHAPTER', {
      fontFamily: 'Press Start 2P',
      fontSize: '8px',
      color: '#ffd166'
    }).setOrigin(0.5).setDepth(601);
    this.storyModalObjects.push(title);

    const sub = this.add.text(w / 2, h / 2 - 96, 'THE SHATTERED MOON & THE BLIGHTED ROOTS', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#7ba0ab'
    }).setOrigin(0.5).setDepth(601);
    this.storyModalObjects.push(sub);

    const ch2Unlocked = storage.isChapterUnlocked(2);
    const ch3Unlocked = storage.isChapterUnlocked(3);
    const ch4Unlocked = storage.isChapterUnlocked(4);
    const ch5Unlocked = storage.isChapterUnlocked(5);

    const entries = [
      {
        title: '📜 PROLOGUE: THE SHATTERED MOON',
        desc: 'Origin of the Pale Blight',
        unlocked: true,
        action: () => this.scene.start('StoryIntroScene')
      },
      {
        title: '🌲 CHAPTER 1: WHISPERING WOODS',
        desc: 'Boss Gorgok • Whispering Waters',
        unlocked: true,
        action: () => this.scene.start('StoryScene', { chapter: 1 })
      },
      {
        title: '🍯 CHAPTER 2: THE HIVE CANOPY',
        desc: ch2Unlocked ? 'Boss Malakor • High Boughs' : '🔒 Complete Ch. 1 to Unlock',
        unlocked: ch2Unlocked,
        action: () => this.scene.start('StoryScene', { chapter: 2 })
      },
      {
        title: '🏛️ CHAPTER 3: THE SUNKEN RUINS',
        desc: ch3Unlocked ? 'Boss Vorgath • Ancient Crypt' : '🔒 Complete Ch. 2 to Unlock',
        unlocked: ch3Unlocked,
        action: () => this.scene.start('StoryScene', { chapter: 3 })
      },
      {
        title: '🌋 CHAPTER 4: OBSIDIAN CALDERA',
        desc: ch4Unlocked ? 'Boss Ignis • Molten Deep' : '🔒 Complete Ch. 3 to Unlock',
        unlocked: ch4Unlocked,
        action: () => this.scene.start('StoryScene', { chapter: 4 })
      },
      {
        title: '🌙 CHAPTER 5: THE LUNAR SPIRE',
        desc: ch5Unlocked ? 'Boss Umbra • Shattered Core' : '🔒 Complete Ch. 4 to Unlock',
        unlocked: ch5Unlocked,
        action: () => this.scene.start('StoryScene', { chapter: 5 })
      }
    ];

    const startY = 60;
    const spacing = 22;
    const btnW = 398;
    const btnH = 18;

    entries.forEach((item, idx) => {
      const ey = startY + idx * spacing;
      const btnBg = this.add.rectangle(w / 2, ey, btnW, btnH, item.unlocked ? 0x0d222b : 0x0a1417, 0.9)
        .setStrokeStyle(1, item.unlocked ? (item.isEpilogue ? 0x554422 : 0x225566) : 0x1a2d33)
        .setDepth(601);
      this.storyModalObjects.push(btnBg);

      // Title left-anchored
      const leftX = (w / 2) - (btnW / 2) + 10;
      const t = this.add.text(leftX, ey, item.title, {
        fontFamily: 'Press Start 2P',
        fontSize: '5px',
        color: item.unlocked ? '#ffffff' : '#556b73'
      }).setOrigin(0, 0.5).setDepth(602);
      this.storyModalObjects.push(t);

      // Description/Status right-anchored to prevent any overflow
      const rightX = (w / 2) + (btnW / 2) - 10;
      const d = this.add.text(rightX, ey, item.desc, {
        fontFamily: 'Press Start 2P',
        fontSize: '4.5px',
        color: item.unlocked ? '#64dfdf' : '#667b84'
      }).setOrigin(1, 0.5).setDepth(602);
      this.storyModalObjects.push(d);

      if (item.unlocked) {
        btnBg.setInteractive({ useHandCursor: true });
        t.setInteractive({ useHandCursor: true });
        d.setInteractive({ useHandCursor: true });

        const setItemHover = (isHover) => {
          btnBg.setFillStyle(isHover ? 0x194254 : 0x0d222b);
          btnBg.setStrokeStyle(1, isHover ? 0xffd166 : 0x225566);
          t.setColor(isHover ? '#ffd166' : '#ffffff');
          if (isHover) sound.playBlip(true);
        };

        const onAction = () => {
          sound.playConfirm();
          this.closeStoryModal();
          item.action();
        };

        btnBg.on('pointerover', () => setItemHover(true));
        btnBg.on('pointerout', () => setItemHover(false));
        btnBg.on('pointerdown', onAction);

        t.on('pointerover', () => setItemHover(true));
        t.on('pointerout', () => setItemHover(false));
        t.on('pointerdown', onAction);

        d.on('pointerover', () => setItemHover(true));
        d.on('pointerout', () => setItemHover(false));
        d.on('pointerdown', onAction);
      }
    });

    // Close button
    const closeBtnY = startY + entries.length * spacing + 10;
    const closeBg = this.add.rectangle(w / 2, closeBtnY, 140, 22, 0x162c33, 0.95)
      .setStrokeStyle(1.5, 0x3d6b73)
      .setDepth(602)
      .setInteractive({ useHandCursor: true });
    this.storyModalObjects.push(closeBg);

    const closeText = this.add.text(w / 2, closeBtnY, '✕ BACK TO MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#e0f0f5'
    }).setOrigin(0.5).setDepth(603).setInteractive({ useHandCursor: true });
    this.storyModalObjects.push(closeText);

    const setCloseHover = (isHover) => {
      closeBg.setFillStyle(isHover ? 0x244c59 : 0x162c33);
      closeBg.setStrokeStyle(1.5, isHover ? 0x64dfdf : 0x3d6b73);
      closeText.setColor(isHover ? '#ffd166' : '#e0f0f5');
      if (isHover) sound.playBlip(true);
    };

    closeBg.on('pointerover', () => setCloseHover(true));
    closeBg.on('pointerout', () => setCloseHover(false));
    closeText.on('pointerover', () => setCloseHover(true));
    closeText.on('pointerout', () => setCloseHover(false));

    closeBg.on('pointerdown', () => this.closeStoryModal());
    closeText.on('pointerdown', () => this.closeStoryModal());

    // ESC key listener
    this.storyModalEscHandler = () => this.closeStoryModal();
    this.input.keyboard.once('keydown-ESC', this.storyModalEscHandler);
  }

  closeStoryModal() {
    if (!this.storyModalObjects) return;
    sound.playCancel();
    if (this.storyModalEscHandler) {
      this.input.keyboard.off('keydown-ESC', this.storyModalEscHandler);
      this.storyModalEscHandler = null;
    }
    this.storyModalObjects.forEach(obj => {
      if (obj && obj.destroy) obj.destroy();
    });
    this.storyModalObjects = null;
  }

  openSettingsModal() {
    if (this.settingsModalObjects) return;
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    this.settingsModalObjects = [];

    // 1. Full-screen backdrop
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.76)
      .setDepth(650)
      .setInteractive();
    overlay.on('pointerdown', () => this.closeSettingsModal());
    this.settingsModalObjects.push(overlay);

    // 2. Modal panel frame
    const panelW = 380;
    const panelH = 186;
    const panel = this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x07151e, 0.98)
      .setStrokeStyle(2, 0x1d4754)
      .setDepth(660)
      .setInteractive();
    this.settingsModalObjects.push(panel);

    // Corner rivets
    const rivets = [
      { x: w / 2 - panelW / 2 + 6, y: h / 2 - panelH / 2 + 6 },
      { x: w / 2 + panelW / 2 - 6, y: h / 2 - panelH / 2 + 6 },
      { x: w / 2 - panelW / 2 + 6, y: h / 2 + panelH / 2 - 6 },
      { x: w / 2 + panelW / 2 - 6, y: h / 2 + panelH / 2 - 6 }
    ];
    rivets.forEach(rv => {
      const r = this.add.rectangle(rv.x, rv.y, 3, 3, 0xf6c026, 0.9).setDepth(661);
      this.settingsModalObjects.push(r);
    });

    // 3. Header
    const title = this.add.text(w / 2, h / 2 - 66, '⚙️ AUDIO SETTINGS', {
      fontFamily: 'Press Start 2P',
      fontSize: '8.5px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(661);
    this.settingsModalObjects.push(title);

    const sub = this.add.text(w / 2, h / 2 - 50, 'SOUND EFFECTS & MUSIC PREFERENCES', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#7ba0ab'
    }).setOrigin(0.5).setDepth(661);
    this.settingsModalObjects.push(sub);

    // 4. Sound Effects Row (SFX)
    const sfxY = h / 2 - 18;
    const sfxRow = this.add.rectangle(w / 2, sfxY, 340, 36, 0x0b1f29, 0.9)
      .setStrokeStyle(1, 0x1d4754)
      .setDepth(661);
    this.settingsModalObjects.push(sfxRow);

    const sfxLabel = this.add.text(w / 2 - 155, sfxY - 6, '🔊 SOUND EFFECTS (SFX)', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#ffffff'
    }).setOrigin(0, 0.5).setDepth(662);
    this.settingsModalObjects.push(sfxLabel);

    const sfxDesc = this.add.text(w / 2 - 155, sfxY + 7, 'Sword slashes, enemy hits, jumps & UI', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#76a0b0'
    }).setOrigin(0, 0.5).setDepth(662);
    this.settingsModalObjects.push(sfxDesc);

    const sfxBtnBg = this.add.rectangle(w / 2 + 112, sfxY, 84, 22, 0x144a25, 0.95)
      .setStrokeStyle(1.5, 0x4ade80)
      .setDepth(662)
      .setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(sfxBtnBg);

    const sfxBtnTxt = this.add.text(w / 2 + 112, sfxY, '[ ON ]', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#4ade80'
    }).setOrigin(0.5).setDepth(663).setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(sfxBtnTxt);

    const updateSfxUI = () => {
      const isMuted = sound.isSoundMuted();
      sfxBtnBg.setFillStyle(isMuted ? 0x3b1515 : 0x144a25, 0.95);
      sfxBtnBg.setStrokeStyle(1.5, isMuted ? 0xf87171 : 0x4ade80);
      sfxBtnTxt.setText(isMuted ? '[ MUTED ]' : '[ ON ]');
      sfxBtnTxt.setColor(isMuted ? '#f87171' : '#4ade80');
    };
    updateSfxUI();

    const toggleSfxAction = () => {
      const isMuted = sound.toggleSound();
      updateSfxUI();
      if (!isMuted) sound.playBlip(true);
    };
    sfxBtnBg.on('pointerdown', toggleSfxAction);
    sfxBtnTxt.on('pointerdown', toggleSfxAction);

    // 5. Music Row (BGM)
    const bgmY = h / 2 + 24;
    const bgmRow = this.add.rectangle(w / 2, bgmY, 340, 36, 0x0b1f29, 0.9)
      .setStrokeStyle(1, 0x1d4754)
      .setDepth(661);
    this.settingsModalObjects.push(bgmRow);

    const bgmLabel = this.add.text(w / 2 - 155, bgmY - 6, '🎵 BACKGROUND MUSIC (BGM)', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#ffffff'
    }).setOrigin(0, 0.5).setDepth(662);
    this.settingsModalObjects.push(bgmLabel);

    const bgmDesc = this.add.text(w / 2 - 155, bgmY + 7, 'Melodic chapter soundtracks & ambient cues', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#76a0b0'
    }).setOrigin(0, 0.5).setDepth(662);
    this.settingsModalObjects.push(bgmDesc);

    const bgmBtnBg = this.add.rectangle(w / 2 + 112, bgmY, 84, 22, 0x144a25, 0.95)
      .setStrokeStyle(1.5, 0x4ade80)
      .setDepth(662)
      .setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(bgmBtnBg);

    const bgmBtnTxt = this.add.text(w / 2 + 112, bgmY, '[ ON ]', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#4ade80'
    }).setOrigin(0.5).setDepth(663).setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(bgmBtnTxt);

    const updateMusicUI = () => {
      const isMuted = sound.isMusicMuted();
      bgmBtnBg.setFillStyle(isMuted ? 0x3b1515 : 0x144a25, 0.95);
      bgmBtnBg.setStrokeStyle(1.5, isMuted ? 0xf87171 : 0x4ade80);
      bgmBtnTxt.setText(isMuted ? '[ MUTED ]' : '[ ON ]');
      bgmBtnTxt.setColor(isMuted ? '#f87171' : '#4ade80');
    };
    updateMusicUI();

    const toggleMusicAction = () => {
      sound.toggleMusic();
      updateMusicUI();
      sound.playBlip(true);
    };
    bgmBtnBg.on('pointerdown', toggleMusicAction);
    bgmBtnTxt.on('pointerdown', toggleMusicAction);

    // 6. Close Button
    const closeBtnY = h / 2 + 68;
    const closeBg = this.add.rectangle(w / 2, closeBtnY, 150, 22, 0x162c33, 0.95)
      .setStrokeStyle(1.5, 0x3d6b73)
      .setDepth(662)
      .setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(closeBg);

    const closeText = this.add.text(w / 2, closeBtnY, '✕ BACK TO MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: '6.5px',
      color: '#e0f0f5'
    }).setOrigin(0.5).setDepth(663).setInteractive({ useHandCursor: true });
    this.settingsModalObjects.push(closeText);

    const setCloseHover = (isHover) => {
      closeBg.setFillStyle(isHover ? 0x244c59 : 0x162c33);
      closeBg.setStrokeStyle(1.5, isHover ? 0x64dfdf : 0x3d6b73);
      closeText.setColor(isHover ? '#ffd166' : '#e0f0f5');
      if (isHover) sound.playBlip(true);
    };

    closeBg.on('pointerover', () => setCloseHover(true));
    closeBg.on('pointerout', () => setCloseHover(false));
    closeText.on('pointerover', () => setCloseHover(true));
    closeText.on('pointerout', () => setCloseHover(false));

    closeBg.on('pointerdown', () => this.closeSettingsModal());
    closeText.on('pointerdown', () => this.closeSettingsModal());

    // ESC key listener
    this.settingsModalEscHandler = () => this.closeSettingsModal();
    this.input.keyboard.once('keydown-ESC', this.settingsModalEscHandler);
  }

  closeSettingsModal() {
    if (!this.settingsModalObjects) return;
    sound.playCancel();
    if (this.settingsModalEscHandler) {
      this.input.keyboard.off('keydown-ESC', this.settingsModalEscHandler);
      this.settingsModalEscHandler = null;
    }
    this.settingsModalObjects.forEach(obj => {
      if (obj && obj.destroy) obj.destroy();
    });
    this.settingsModalObjects = null;
  }

  onViewportResize(w, h) {
    if (this.cameras?.main && this.cameras.main.width === w && this.cameras.main.height === h) {
      return;
    }
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
    // Re-layout menu on viewport orientation change if no modal open
    if (!this.storyModalObjects && !this.settingsModalObjects) {
      this.scene.restart();
    }
  }

  update() {
    if (this.bgMountains) this.bgMountains.tilePositionX += 0.05;
    if (this.bgFogPines) this.bgFogPines.tilePositionX += 0.12;
    if (this.bgMidPines) this.bgMidPines.tilePositionX += 0.22;

    // Active gameplay buttons on Menu
    if (typeof window !== 'undefined' && window.touchController && this.menuHero) {
      const tc = window.touchController;
      const triggers = tc.consumeTriggers();
      const speed = 2.0;
      let isMoving = false;

      if (tc.state.left) {
        this.menuHero.x = Math.max(28, this.menuHero.x - speed);
        this.menuHero.setFlipX(true);
        if (!this.heroAttacking) this.menuHero.anims.play('player_run', true);
        isMoving = true;
      } else if (tc.state.right) {
        const w = this.cameras.main.width || 480;
        this.menuHero.x = Math.min(w - 28, this.menuHero.x + speed);
        this.menuHero.setFlipX(false);
        if (!this.heroAttacking) this.menuHero.anims.play('player_run', true);
        isMoving = true;
      }

      if (this.menuPet) {
        const targetPetX = this.menuHero.x + (this.menuHero.flipX ? 16 : -16);
        this.menuPet.x = Phaser.Math.Linear(this.menuPet.x, targetPetX, 0.15);
        this.menuPet.setFlipX(this.menuHero.flipX);
      }

      if (triggers.justAttack) {
        this.heroAttacking = true;
        this.menuHero.anims.play('player_attack', true);
        sound.playSlash(1);
        this.time.delayedCall(300, () => { this.heroAttacking = false; });
      } else if (triggers.justUpSlash) {
        this.heroAttacking = true;
        this.menuHero.anims.play('player_upslash', true);
        sound.playSlash(2);
        this.time.delayedCall(300, () => { this.heroAttacking = false; });
      } else if (triggers.justJump) {
        if (!this.heroJumping) {
          this.heroJumping = true;
          sound.playJump();
          const baseY = this.heroGroundY || this.menuHero.y;
          this.tweens.add({
            targets: this.menuHero,
            y: baseY - 24,
            duration: 200,
            yoyo: true,
            ease: 'Quad.easeOut',
            onComplete: () => {
              this.heroJumping = false;
              this.menuHero.y = baseY;
            }
          });
        }
      } else if (!isMoving && !this.heroAttacking && !this.heroJumping) {
        this.menuHero.anims.play('player_idle', true);
      }
    }
  }
}

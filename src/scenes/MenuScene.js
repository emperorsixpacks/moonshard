import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { gdService } from '../engine/GdService.js';
import { pauseService } from '../engine/PauseService.js';

/*
 * Sizes for the two canvases (480x270 landscape, 480x440 tall), in game units.
 *
 * A text hint of 7px or more is drawn in the pixel font at that size; a smaller hint is drawn in VT323 at 2.3x the hint
 * (engine/typography.js), so '6.3px' is a 14.5-unit VT323 caption and '14px' is a 14-unit pixel-font heading.
 * The tall canvas is the one shown upright on a phone, at about 0.81 CSS px per unit, so its sizes are picked to read as
 * >= 9 CSS px for captions, >= 10 for body text and >= 11 for headings there. The landscape canvas is shown at 1.4 to
 * 2.1 CSS px per unit, where the sizes below are already large enough.
 */
const LAYOUT = {
  land: {
    banner: { w: 310, h: 42, y: 33, title: '13px', titleDy: -12, sub: '6.5px', subDy: 1, badge: '4.5px', badgeDy: 12, stroke: 3 },
    list: { gap: 4, pad: 3, rowH: 25, rowGap: 2, icon: '15px', iconDx: 19, label: '8px', labelDy: -5, desc: '4.5px', descDy: 6 },
  },
  tall: {
    banner: { w: 424, h: 68, y: 48, title: '20px', titleDy: -21, sub: '11.5px', subDy: 2, badge: '6.8px', badgeDy: 21, stroke: 3 },
    list: { gap: 6, pad: 4, rowH: 44, rowGap: 3, icon: '26px', iconDx: 30, label: '14px', labelDy: -9, desc: '6.3px', descDy: 10 },
  },
  // Positions below are measured from the top edge of the modal panel (which is centred on the canvas)
  storyModal: {
    land: {
      panelW: 426, panelH: 244, titleY: 20, title: '8px', subY: 33, sub: '4.5px',
      firstY: 58, pitch: 25, entryW: 398, entryH: 21, padX: 10, entry: '5px', entryDesc: '4.5px',
      closeY: 219, closeW: 150, closeH: 24, close: '6.5px',
    },
    tall: {
      panelW: 456, panelH: 384, titleY: 32, title: '14px', subY: 57, sub: '6.3px',
      firstY: 100, pitch: 41, entryW: 428, entryH: 36, padX: 14, entry: '6.9px', entryDesc: '6.3px',
      closeY: 352, closeW: 200, closeH: 38, close: '6.9px',
    },
  },
  settingsModal: {
    land: {
      panelW: 380, panelH: 186, titleY: 27, title: '8.5px', subY: 43, sub: '5px',
      rowW: 340, rowH: 36, rowPad: 16, label: '6px', labelDy: -6, desc: '4.5px', descDy: 7,
      btnW: 84, btnH: 22, btn: '6px', row1Y: 75, row2Y: 117,
      closeY: 161, closeW: 150, closeH: 22, close: '6.5px',
    },
    tall: {
      panelW: 440, panelH: 296, titleY: 36, title: '14px', subY: 62, sub: '6.3px',
      rowW: 404, rowH: 64, rowPad: 16, label: '6.9px', labelDy: -13, desc: '6.3px', descDy: 13,
      btnW: 104, btnH: 38, btn: '6.9px', row1Y: 116, row2Y: 190,
      closeY: 262, closeW: 210, closeH: 38, close: '6.9px',
    },
  },
};

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.layoutSize = { w, h };

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
    const L = isTall ? LAYOUT.tall : LAYOUT.land;
    const titleY = L.banner.y;
    const titleBox = this.add.rectangle(w / 2, titleY, L.banner.w, L.banner.h, 0x0a140a, 0.88).setDepth(10);
    titleBox.setStrokeStyle(1.5, 0x2e4e2e);

    const titleText = this.add.text(w / 2, titleY + L.banner.titleDy, 'MOONSHARD', {
      fontFamily: 'Press Start 2P',
      fontSize: L.banner.title,
      color: '#f6c026',
      stroke: '#000000',
      strokeThickness: L.banner.stroke
    }).setOrigin(0.5).setDepth(11);

    const subText = this.add.text(w / 2, titleY + L.banner.subDy, 'THE HIGH FOREST', {
      fontFamily: 'Press Start 2P',
      fontSize: L.banner.sub,
      color: '#98ff20',
      stroke: '#000000',
      strokeThickness: 2,
      letterSpacing: 2
    }).setOrigin(0.5).setDepth(11);

    // Wallet status badge: tap to open the G$ wallet panel
    const badgeText = (st) => {
      if (!st.connected) return '⚡ TAP TO CONNECT • EARN G$';
      if (st.status === 'verified') return st.ubi?.canClaim ? '💚 DAILY G$ READY — TAP TO CLAIM' : `✔ VERIFIED • ${st.shortAddress}`;
      if (st.status === 'expired') return '🛡 RE-VERIFY TO KEEP EARNING G$';
      return `🛡 ${st.shortAddress} • VERIFY TO EARN G$`;
    };
    const badge = this.add.text(w / 2, titleY + L.banner.badgeDy, badgeText(gdService.getStatus()), {
      fontFamily: 'Press Start 2P',
      fontSize: L.banner.badge,
      color: '#a0c4a0',
      stroke: '#000000',
      strokeThickness: 2,
      padding: { x: 10, y: 2 } // a bigger tap target; the glyphs stay where they are
    }).setOrigin(0.5).setDepth(11);
    badge.setInteractive({ useHandCursor: true });
    badge.on('pointerdown', () => window.__gdPanel?.open());
    const stopWatching = gdService.subscribe((st) => { if (badge.active) badge.setText(badgeText(st)); });
    this.events.once('shutdown', stopWatching);

    // Pulse animation on title
    this.tweens.add({
      targets: [titleText, subText],
      scale: 1.02,
      duration: 1200,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut'
    });

    // Menu entries: an icon at the left of each row, the label and its caption centred
    const options = [
      {
        icon: '⚔️',
        text: '1. STORY MODE',
        desc: 'The Shattered Moon & The Blighted Roots',
        action: () => this.openStoryModal(),
        shouldFade: false
      },
      {
        icon: '🎓',
        text: '2. COMBAT TUTORIAL',
        desc: 'Learn Touch Moves, Jumps, Slashes & Combos',
        action: () => this.scene.start('TutorialScene'),
        shouldFade: true
      },
      {
        icon: '🏆',
        text: '3. ENDLESS MODE',
        desc: 'Endless Arena • Verified Leaderboard',
        action: () => this.scene.start('SurvivalScene'),
        shouldFade: true
      },
      {
        icon: '⚒️',
        text: '4. FORGE & SATCHEL',
        desc: 'Craft Blades & Companion Relics',
        action: () => this.scene.start('ForgeScene'),
        shouldFade: true
      },
      {
        icon: '💰',
        text: '5. LEADERBOARD',
        desc: 'All-Time & Daily Rankings',
        action: () => this.scene.start('LeaderboardScene'),
        shouldFade: true
      },
      {
        icon: '⚙️',
        text: '6. SETTINGS',
        desc: 'Sound Effects & Background Music',
        action: () => this.openSettingsModal(),
        shouldFade: false
      }
    ];

    // A dark backing behind the whole list, so the sky never shows through between the rows
    const rowW = L.banner.w - 2 * L.list.pad;
    const rowsTop = titleY + L.banner.h / 2 + L.list.gap + L.list.pad;
    const rowPitch = L.list.rowH + L.list.rowGap;
    const backingH = options.length * rowPitch - L.list.rowGap + 2 * L.list.pad;
    this.add.rectangle(w / 2, rowsTop - L.list.pad + backingH / 2, L.banner.w, backingH, 0x050c05, 0.6)
      .setStrokeStyle(1, 0x1c301c, 0.9)
      .setDepth(9);

    options.forEach((opt, idx) => {
      this.createMenuButton({
        x: w / 2,
        y: rowsTop + L.list.rowH / 2 + idx * rowPitch,
        width: rowW,
        height: L.list.rowH,
        icon: opt.icon,
        label: opt.text,
        subtitle: opt.desc,
        callback: opt.action,
        shouldFade: opt.shouldFade,
        style: L.list
      });
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

    // The screen was turned while a modal was open: bring it back on the new canvas
    if (this.reopenModal) {
      const reopen = this.reopenModal;
      this.reopenModal = null;
      this[reopen]();
    }
  }

  createMenuButton({ x, y, width, height, icon, label, subtitle, callback, shouldFade = false, style }) {
    const btnBg = this.add.rectangle(x, y, width, height, 0x142814, 0.88).setDepth(10);
    btnBg.setStrokeStyle(1.5, 0x3c6e3c);
    btnBg.setInteractive({ useHandCursor: true });

    // The icon is its own, bigger text object: at the label's size an emoji is a speck
    this.add.text(x - width / 2 + style.iconDx, y, icon, {
      fontFamily: 'Press Start 2P',
      fontSize: style.icon
    }).setOrigin(0.5).setDepth(11);

    const txt = this.add.text(x, y + style.labelDy, label, {
      fontFamily: 'Press Start 2P',
      fontSize: style.label,
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(11);

    this.add.text(x, y + style.descDy, subtitle, {
      fontFamily: 'Press Start 2P',
      fontSize: style.desc,
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
    // Laid out for the canvas that is on screen: the tall (upright phone) canvas gets bigger rows and type
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const M = h > 300 ? LAYOUT.storyModal.tall : LAYOUT.storyModal.land;
    const top = h / 2 - M.panelH / 2;
    this.storyModalObjects = [];

    // 1. Dim full-screen overlay backdrop (captures any clicks outside panel)
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.72)
      .setDepth(590)
      .setInteractive();
    overlay.on('pointerdown', () => this.closeStoryModal());
    this.storyModalObjects.push(overlay);

    // 2. Modal panel frame
    const panel = this.add.rectangle(w / 2, h / 2, M.panelW, M.panelH, 0x071317, 0.96)
      .setStrokeStyle(2, 0x1d4754)
      .setDepth(600)
      .setInteractive(); // Blocks clicks from hitting overlay underneath
    this.storyModalObjects.push(panel);

    // 3. Header
    const title = this.add.text(w / 2, top + M.titleY, '⚔️ CHOOSE CHAPTER', {
      fontFamily: 'Press Start 2P',
      fontSize: M.title,
      color: '#ffd166'
    }).setOrigin(0.5).setDepth(601);
    this.storyModalObjects.push(title);

    const sub = this.add.text(w / 2, top + M.subY, 'THE SHATTERED MOON & THE BLIGHTED ROOTS', {
      fontFamily: 'Press Start 2P',
      fontSize: M.sub,
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

    entries.forEach((item, idx) => {
      const ey = top + M.firstY + idx * M.pitch;
      const btnBg = this.add.rectangle(w / 2, ey, M.entryW, M.entryH, item.unlocked ? 0x0d222b : 0x0a1417, 0.9)
        .setStrokeStyle(1, item.unlocked ? (item.isEpilogue ? 0x554422 : 0x225566) : 0x1a2d33)
        .setDepth(601);
      this.storyModalObjects.push(btnBg);

      // Title left-anchored
      const leftX = (w / 2) - (M.entryW / 2) + M.padX;
      const t = this.add.text(leftX, ey, item.title, {
        fontFamily: 'Press Start 2P',
        fontSize: M.entry,
        color: item.unlocked ? '#ffffff' : '#556b73'
      }).setOrigin(0, 0.5).setDepth(602);
      this.storyModalObjects.push(t);

      // Description/Status right-anchored to prevent any overflow
      const rightX = (w / 2) + (M.entryW / 2) - M.padX;
      const d = this.add.text(rightX, ey, item.desc, {
        fontFamily: 'Press Start 2P',
        fontSize: M.entryDesc,
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
    this.addModalCloseButton(this.storyModalObjects, {
      x: w / 2,
      y: top + M.closeY,
      width: M.closeW,
      height: M.closeH,
      fontSize: M.close,
      depth: 602,
      onClose: () => this.closeStoryModal()
    });

    // ESC key listener
    this.storyModalEscHandler = () => this.closeStoryModal();
    this.input.keyboard.once('keydown-ESC', this.storyModalEscHandler);
  }

  closeStoryModal({ silent = false } = {}) {
    if (!this.storyModalObjects) return;
    if (!silent) sound.playCancel();
    if (this.storyModalEscHandler) {
      this.input.keyboard.off('keydown-ESC', this.storyModalEscHandler);
      this.storyModalEscHandler = null;
    }
    this.storyModalObjects.forEach(obj => {
      if (obj && obj.destroy) obj.destroy();
    });
    this.storyModalObjects = null;
  }

  /** The "✕ BACK TO MENU" button that ends both modals. Its objects are added to `objects`. */
  addModalCloseButton(objects, { x, y, width, height, fontSize, depth, onClose }) {
    const closeBg = this.add.rectangle(x, y, width, height, 0x162c33, 0.95)
      .setStrokeStyle(1.5, 0x3d6b73)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    objects.push(closeBg);

    const closeText = this.add.text(x, y, '✕ BACK TO MENU', {
      fontFamily: 'Press Start 2P',
      fontSize,
      color: '#e0f0f5'
    }).setOrigin(0.5).setDepth(depth + 1).setInteractive({ useHandCursor: true });
    objects.push(closeText);

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

    closeBg.on('pointerdown', onClose);
    closeText.on('pointerdown', onClose);
  }

  openSettingsModal() {
    if (this.settingsModalObjects) return;
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const M = h > 300 ? LAYOUT.settingsModal.tall : LAYOUT.settingsModal.land;
    const top = h / 2 - M.panelH / 2;
    this.settingsModalObjects = [];

    // 1. Full-screen backdrop
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.76)
      .setDepth(650)
      .setInteractive();
    overlay.on('pointerdown', () => this.closeSettingsModal());
    this.settingsModalObjects.push(overlay);

    // 2. Modal panel frame
    const panel = this.add.rectangle(w / 2, h / 2, M.panelW, M.panelH, 0x07151e, 0.98)
      .setStrokeStyle(2, 0x1d4754)
      .setDepth(660)
      .setInteractive();
    this.settingsModalObjects.push(panel);

    // Corner rivets
    const rivets = [
      { x: w / 2 - M.panelW / 2 + 6, y: top + 6 },
      { x: w / 2 + M.panelW / 2 - 6, y: top + 6 },
      { x: w / 2 - M.panelW / 2 + 6, y: top + M.panelH - 6 },
      { x: w / 2 + M.panelW / 2 - 6, y: top + M.panelH - 6 }
    ];
    rivets.forEach(rv => {
      const r = this.add.rectangle(rv.x, rv.y, 3, 3, 0xf6c026, 0.9).setDepth(661);
      this.settingsModalObjects.push(r);
    });

    // 3. Header
    const title = this.add.text(w / 2, top + M.titleY, '⚙️ AUDIO SETTINGS', {
      fontFamily: 'Press Start 2P',
      fontSize: M.title,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(661);
    this.settingsModalObjects.push(title);

    const sub = this.add.text(w / 2, top + M.subY, 'SOUND EFFECTS & MUSIC PREFERENCES', {
      fontFamily: 'Press Start 2P',
      fontSize: M.sub,
      color: '#7ba0ab'
    }).setOrigin(0.5).setDepth(661);
    this.settingsModalObjects.push(sub);

    // One row per setting: label and description at the left, the on/off button at the right
    const rowLeft = w / 2 - M.rowW / 2 + M.rowPad;
    const btnX = w / 2 + M.rowW / 2 - M.rowPad - M.btnW / 2;
    const addRow = (y, label, desc) => {
      const row = this.add.rectangle(w / 2, y, M.rowW, M.rowH, 0x0b1f29, 0.9)
        .setStrokeStyle(1, 0x1d4754)
        .setDepth(661);
      this.settingsModalObjects.push(row);

      const labelText = this.add.text(rowLeft, y + M.labelDy, label, {
        fontFamily: 'Press Start 2P',
        fontSize: M.label,
        color: '#ffffff'
      }).setOrigin(0, 0.5).setDepth(662);
      this.settingsModalObjects.push(labelText);

      const descText = this.add.text(rowLeft, y + M.descDy, desc, {
        fontFamily: 'Press Start 2P',
        fontSize: M.desc,
        color: '#76a0b0'
      }).setOrigin(0, 0.5).setDepth(662);
      this.settingsModalObjects.push(descText);

      const btnBg = this.add.rectangle(btnX, y, M.btnW, M.btnH, 0x144a25, 0.95)
        .setStrokeStyle(1.5, 0x4ade80)
        .setDepth(662)
        .setInteractive({ useHandCursor: true });
      this.settingsModalObjects.push(btnBg);

      const btnTxt = this.add.text(btnX, y, '[ ON ]', {
        fontFamily: 'Press Start 2P',
        fontSize: M.btn,
        color: '#4ade80'
      }).setOrigin(0.5).setDepth(663).setInteractive({ useHandCursor: true });
      this.settingsModalObjects.push(btnTxt);

      return { btnBg, btnTxt };
    };

    // 4. Sound Effects Row (SFX)
    const sfxY = top + M.row1Y;
    const { btnBg: sfxBtnBg, btnTxt: sfxBtnTxt } = addRow(sfxY, '🔊 SOUND EFFECTS (SFX)', 'Sword slashes, enemy hits, jumps & UI');

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
    const bgmY = top + M.row2Y;
    const { btnBg: bgmBtnBg, btnTxt: bgmBtnTxt } = addRow(bgmY, '🎵 BACKGROUND MUSIC (BGM)', 'Melodic chapter soundtracks & ambient cues');

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
    this.addModalCloseButton(this.settingsModalObjects, {
      x: w / 2,
      y: top + M.closeY,
      width: M.closeW,
      height: M.closeH,
      fontSize: M.close,
      depth: 662,
      onClose: () => this.closeSettingsModal()
    });

    // ESC key listener
    this.settingsModalEscHandler = () => this.closeSettingsModal();
    this.input.keyboard.once('keydown-ESC', this.settingsModalEscHandler);
  }

  closeSettingsModal({ silent = false } = {}) {
    if (!this.settingsModalObjects) return;
    if (!silent) sound.playCancel();
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
    // Compared with the canvas the menu was laid out for: by the time this is called the camera has already been
    // resized by the scale manager, so comparing with the camera would never see a change.
    if (this.layoutSize && this.layoutSize.w === w && this.layoutSize.h === h) {
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
    // Re-layout the menu on a viewport orientation change. A modal is sized for the canvas it was opened on, so an open
    // one is closed quietly and opened again on the new canvas.
    const openModal = this.storyModalObjects ? 'openStoryModal' : (this.settingsModalObjects ? 'openSettingsModal' : null);
    if (openModal) this.reopenModal = openModal;
    this.closeStoryModal({ silent: true });
    this.closeSettingsModal({ silent: true });
    this.scene.restart();
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

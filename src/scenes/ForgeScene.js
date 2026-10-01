import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import { isTallCanvas } from '../engine/uiScale.js';
import confetti from 'canvas-confetti';

// One layout per canvas shape. Text sizes are font-size hints (engine/typography.js): under 7 the text is drawn in
// VT323 at 2.3x ('4.5px' is 10.5 units), from 7 up in Press Start 2P at that size. All numbers are game units.
// `dy` is where a text starts measured from the top of its card, `dx` is measured from the middle of the screen.
const LANDSCAPE = {
  title: { y: 18, hint: '10px' },
  sub: { y: 31, hint: '5px' },
  mats: { y: 44, hint: '5.5px' },
  tabs: { y: 60, w: 126, h: 18, xs: [85, 240, 395], hint: '4.5px' },
  cardW: 420,
  skins: {
    top: 72, h: 52, gap: 3,
    iconDx: -180, iconBox: 32, iconImg: 28,
    textDx: -152, wrap: 250,
    title: { dy: 4.5, hint: '6px' },
    badge: { dy: 18.5, hint: '4.5px' },
    desc: { dy: 30.5, hint: '4px' },
    btn: { dx: 152, w: 92, h: 32, hint: '4.5px', spacing: 2 }
  },
  free: {
    top: 72, h: 40, gap: 6,
    textDx: -190,
    name: { dy: 10, hint: '8px' },
    stats: { dy: 24, hint: '5px' },
    btn: { dx: 152, w: 92, h: 24, hint: '5px' }
  },
  nim: {
    top: 72, h: 36, gap: 4,
    textDx: -190, wrap: 285,
    name: { dy: 6.2, hint: '5.5px' },
    desc: { dy: 19.7, hint: '4.5px' },
    btn: { dx: 152, w: 92, h: 28, hint: '4.5px', spacing: 1 }
  },
  back: { x: 48, fromBottom: 16, w: 72, h: 20, hint: '6px' },
  preview: {
    dx: 75, fromBottom: 18, w: 130, h: 26,
    heroDx: -44, heroScale: 0.9, iconDx: -18, iconSize: 18,
    textDxIcon: -6, textDxPlain: -24, hint: '4.5px'
  }
};

// The tall (portrait) canvas has 170 more units to spread the same screen over, so type is larger and looser.
const TALL = {
  title: { y: 24, hint: '14px' },
  sub: { y: 46, hint: '6.1px' },
  mats: { y: 68, hint: '6.9px' },
  tabs: { y: 102, w: 146, h: 34, xs: [88, 240, 392], hint: '6.2px' },
  cardW: 452,
  skins: {
    top: 126, h: 80, gap: 9,
    iconDx: -193, iconBox: 50, iconImg: 44,
    textDx: -158, wrap: 276,
    title: { dy: 10.8, hint: '6.9px' },
    badge: { dy: 28.2, hint: '5.65px' },
    desc: { dy: 43.2, hint: '5.9px' },
    btn: { dx: 172, w: 92, h: 52, hint: '6.1px', spacing: 3 }
  },
  free: {
    top: 126, h: 80, gap: 9,
    textDx: -206,
    name: { dy: 23.3, hint: '14px' },
    stats: { dy: 43.3, hint: '6.1px' },
    btn: { dx: 170, w: 96, h: 46, hint: '6.1px' }
  },
  nim: {
    top: 126, h: 60, gap: 6,
    textDx: -206, wrap: 296,
    name: { dy: 9.5, hint: '6.5px' },
    desc: { dy: 25.5, hint: '5.7px' },
    btn: { dx: 160, w: 116, h: 44, hint: '5.9px', spacing: 2 }
  },
  back: { x: 62, fromBottom: 26, w: 104, h: 36, hint: '6.9px' },
  preview: {
    dx: 118, fromBottom: 26, w: 224, h: 40,
    heroDx: -80, heroScale: 1.0, iconDx: -36, iconSize: 28,
    textDxIcon: -14, textDxPlain: -50, hint: '6.1px'
  }
};

export default class ForgeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ForgeScene' });
  }

  create(data) {
    const w = this.cameras?.main?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || GAME_CONFIG.HEIGHT;
    const tall = isTallCanvas(this);
    const L = tall ? TALL : LANDSCAPE;
    this.layout = L;

    pauseService.detachScene();
    sound.playBGM('title');

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Background (the picture is 480 x 270: a taller canvas continues it with its mirror image, so there is no seam)
    this.add.tileSprite(0, 0, w, Math.min(h, GAME_CONFIG.HEIGHT), 'env_bg').setOrigin(0, 0).setTint(0x445544);
    if (h > GAME_CONFIG.HEIGHT) {
      this.add.image(0, GAME_CONFIG.HEIGHT, 'env_bg').setOrigin(0, 0).setFlipY(true).setTint(0x445544);
    }

    // Header
    this.add.text(w / 2, L.title.y, 'ANCIENT HIGH FOREST FORGE', {
      fontFamily: 'Press Start 2P',
      fontSize: L.title.hint,
      color: '#f6c026'
    }).setOrigin(0.5);

    this.add.text(w / 2, L.sub.y, 'Equip Sword Skins & Craft Blades with Forest Materials', {
      fontFamily: 'Press Start 2P',
      fontSize: L.sub.hint,
      color: '#a0c4a0'
    }).setOrigin(0.5);

    // Live Materials Bar
    this.matsText = this.add.text(w / 2, L.mats.y, '', {
      fontFamily: 'Press Start 2P',
      fontSize: L.mats.hint,
      color: '#98ff20'
    }).setOrigin(0.5);
    this.updateHeaderBar();

    // Tab Navigation: 'free', 'skins', or 'nim' (a rotation re-opens the tab that was showing)
    this.currentTab = data?.tab || 'skins'; // Default to sword skins tab to immediately showcase new skins
    this.createTabs(w);

    // Content container
    this.contentContainer = this.add.container(0, 0);

    // Bottom Navigation Bar
    const backY = h - L.back.fromBottom;
    const backBtn = this.add.rectangle(L.back.x, backY, L.back.w, L.back.h, 0x1a2e1a)
      .setStrokeStyle(1, 0x3d5c3d)
      .setInteractive({ useHandCursor: true });
    this.add.text(L.back.x, backY, '◄ MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: L.back.hint,
      color: '#fff'
    }).setOrigin(0.5);
    backBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    });

    // Equipped gear preview container at bottom right
    this.createHeroPreview(w, h);

    // Render active tab items
    this.renderTabContent(w, h);
  }

  updateHeaderBar() {
    const mats = storage.getMaterials();
    this.matsText.setText(`🌲Bark: ${mats.bark} | 🍯Amber: ${mats.amber} | ⚙️Iron: ${mats.iron}`);
  }

  createTabs(w) {
    const T = this.layout.tabs;
    const tabY = T.y;
    const tabW = T.w;
    const tabH = T.h;
    const h = this.cameras.main.height;

    // Tab 1: Standard Blades
    this.tabFree = this.add.rectangle(T.xs[0], tabY, tabW, tabH, 0x142414)
      .setStrokeStyle(1, 0x4a7d4a)
      .setInteractive({ useHandCursor: true });
    this.txtTabFree = this.add.text(T.xs[0], tabY, 'STANDARD BLADES', {
      fontFamily: 'Press Start 2P',
      fontSize: T.hint,
      color: '#8cb38c'
    }).setOrigin(0.5);

    // Tab 2: Sword Skins
    this.tabSkins = this.add.rectangle(T.xs[1], tabY, tabW, tabH, 0x3a2010)
      .setStrokeStyle(1, 0xff7733)
      .setInteractive({ useHandCursor: true });
    this.txtTabSkins = this.add.text(T.xs[1], tabY, '⚔️ SWORD SKINS (3)', {
      fontFamily: 'Press Start 2P',
      fontSize: T.hint,
      color: '#ff9944'
    }).setOrigin(0.5);

    // Tab 3: Celestial Blades & Satchel Pet
    this.tabNim = this.add.rectangle(T.xs[2], tabY, tabW, tabH, 0x241d0a)
      .setStrokeStyle(1, 0x8a7024)
      .setInteractive({ useHandCursor: true });
    this.txtTabNim = this.add.text(T.xs[2], tabY, 'CELESTIAL & PET', {
      fontFamily: 'Press Start 2P',
      fontSize: T.hint,
      color: '#bfa770'
    }).setOrigin(0.5);

    this.tabFree.on('pointerdown', () => {
      this.currentTab = 'free';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, h);
    });

    this.tabSkins.on('pointerdown', () => {
      this.currentTab = 'skins';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, h);
    });

    this.tabNim.on('pointerdown', () => {
      this.currentTab = 'nim';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, h);
    });

    this.refreshTabs();
  }

  refreshTabs() {
    // Tab 1
    const isFree = this.currentTab === 'free';
    this.tabFree.setFillStyle(isFree ? 0x2d522d : 0x142414);
    this.tabFree.setStrokeStyle(1, isFree ? 0x98ff20 : 0x3d5c3d);
    this.txtTabFree.setColor(isFree ? '#ffffff' : '#8cb38c');

    // Tab 2
    const isSkins = this.currentTab === 'skins';
    this.tabSkins.setFillStyle(isSkins ? 0x5a2e10 : 0x241508);
    this.tabSkins.setStrokeStyle(1, isSkins ? 0xff8833 : 0x6a3818);
    this.txtTabSkins.setColor(isSkins ? '#ffffff' : '#ff9944');

    // Tab 3
    const isNim = this.currentTab === 'nim';
    this.tabNim.setFillStyle(isNim ? 0x524214 : 0x241d0a);
    this.tabNim.setStrokeStyle(1, isNim ? 0xe9b213 : 0x66501a);
    this.txtTabNim.setColor(isNim ? '#ffffff' : '#bfa770');
  }

  createHeroPreview(w, h) {
    const P = this.layout.preview;
    this.previewContainer = this.add.container(w - P.dx, h - P.fromBottom);

    // Small subtle background panel
    const pBg = this.add.rectangle(0, 0, P.w, P.h, 0x111c14, 0.85)
      .setStrokeStyle(1, 0x2e4e2e);
    this.previewContainer.add(pBg);

    // Hero idle sprite
    this.heroPreview = this.add.sprite(P.heroDx, 0, 'char_idle').setScale(P.heroScale);
    this.heroPreview.play('player_idle');
    this.previewContainer.add(this.heroPreview);

    // Equipped weapon icon
    this.previewIcon = this.add.image(P.iconDx, 0, 'sword_flame').setDisplaySize(P.iconSize, P.iconSize).setVisible(false);
    this.previewContainer.add(this.previewIcon);

    // Equipped weapon text
    this.previewText = this.add.text(P.textDxIcon, 0, '', {
      fontFamily: 'Press Start 2P',
      fontSize: P.hint,
      color: '#98ff20'
    }).setOrigin(0, 0.5);
    this.previewContainer.add(this.previewText);

    this.updateHeroPreview();
  }

  updateHeroPreview() {
    const P = this.layout.preview;
    const equippedId = storage.getEquippedWeapon();
    const weap = Object.values(GAME_CONFIG.WEAPONS).find(w => w.id === equippedId) || GAME_CONFIG.WEAPONS.STARTER;

    if (weap.iconKey && this.textures.exists(weap.iconKey)) {
      this.previewIcon.setTexture(weap.iconKey).setVisible(true);
      this.previewText.setX(P.textDxIcon);
    } else {
      this.previewIcon.setVisible(false);
      this.previewText.setX(P.textDxPlain);
    }

    // Short name if necessary
    const shortName = weap.name.length > 15 ? weap.name.substring(0, 14) + '…' : weap.name;
    this.previewText.setText(shortName);

    if (weap.slashColor) {
      this.heroPreview.setTint(weap.slashAccent || 0xffffff);
    } else {
      this.heroPreview.clearTint();
    }
  }

  renderTabContent(w, h) {
    this.contentContainer.removeAll(true);
    const equipped = storage.getEquippedWeapon();
    const L = this.layout;

    if (this.currentTab === 'skins') {
      // DEDICATED COSMETIC SWORD SKINS TAB
      const C = L.skins;
      const skins = [
        GAME_CONFIG.WEAPONS.SKIN_FLAME,
        GAME_CONFIG.WEAPONS.SKIN_FROST,
        GAME_CONFIG.WEAPONS.SKIN_VERDANT
      ];

      skins.forEach((weap, idx) => {
        const top = C.top + idx * (C.h + C.gap);
        const y = top + C.h / 2;
        const unlocked = storage.isWeaponUnlocked(weap.id);
        const isEquipped = equipped === weap.id;

        // Card Container
        const cardBg = this.add.rectangle(w / 2, y, L.cardW, C.h, 0x121820, 0.94)
          .setStrokeStyle(1.5, isEquipped ? 0x98ff20 : (weap.slashColor || 0x3d5c3d));
        this.contentContainer.add(cardBg);

        // Weapon Thumbnail Frame & Icon
        const iconBox = this.add.rectangle(w / 2 + C.iconDx, y, C.iconBox, C.iconBox, 0x0a0e14)
          .setStrokeStyle(1, weap.slashColor || 0xffaa00);
        this.contentContainer.add(iconBox);

        if (this.textures.exists(weap.iconKey)) {
          const iconImg = this.add.image(w / 2 + C.iconDx, y, weap.iconKey).setDisplaySize(C.iconImg, C.iconImg);
          this.contentContainer.add(iconImg);
        }

        // Title
        const titleTxt = this.add.text(w / 2 + C.textDx, top + C.title.dy, weap.name, {
          fontFamily: 'Press Start 2P',
          fontSize: C.title.hint,
          color: isEquipped ? '#98ff20' : (weap.slashColor ? '#' + weap.slashColor.toString(16).padStart(6, '0') : '#ffffff')
        });
        this.contentContainer.add(titleTxt);

        // Cosmetic & Fair play badge
        const badgeTxt = this.add.text(w / 2 + C.textDx, top + C.badge.dy, 'Pure Cosmetic Skin • Dmg: x1.0 (Zero P2W)', {
          fontFamily: 'Press Start 2P',
          fontSize: C.badge.hint,
          color: '#ffd166'
        });
        this.contentContainer.add(badgeTxt);

        // Lore & FX Description
        const descTxt = this.add.text(w / 2 + C.textDx, top + C.desc.dy, weap.cosmeticDescription, {
          fontFamily: 'Press Start 2P',
          fontSize: C.desc.hint,
          color: '#a0b0b8',
          wordWrap: { width: C.wrap }
        });
        this.contentContainer.add(descTxt);

        // Action Button
        let btnText = 'EQUIP';
        let btnColor = 0x1d3f58;
        let strokeColor = 0x38e1ff;

        if (isEquipped) {
          btnText = 'EQUIPPED';
          btnColor = 0x163416;
          strokeColor = 0x98ff20;
        } else if (!unlocked && weap.cost) {
          btnText = `CRAFT\n(${weap.cost.bark || 0}B/${weap.cost.amber || 0}A/${weap.cost.iron || 0}I)`;
          btnColor = 0x472810;
          strokeColor = 0xff9933;
        }

        const btn = this.add.rectangle(w / 2 + C.btn.dx, y, C.btn.w, C.btn.h, btnColor)
          .setStrokeStyle(1.2, strokeColor)
          .setInteractive({ useHandCursor: !isEquipped });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + C.btn.dx, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: C.btn.hint,
          color: '#ffffff',
          align: 'center',
          lineSpacing: C.btn.spacing
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        if (!isEquipped) {
          btn.on('pointerdown', () => {
            if (unlocked) {
              storage.equipWeapon(weap.id);
              sound.playCoin();
              this.updateHeroPreview();
              this.renderTabContent(w, h);
            } else if (weap.cost) {
              const spent = storage.spendMaterials(weap.cost);
              if (spent) {
                storage.unlockWeapon(weap.id);
                storage.equipWeapon(weap.id);
                sound.playVictory();
                try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
                this.updateHeaderBar();
                this.updateHeroPreview();
                this.renderTabContent(w, h);
              } else {
                sound.playHit();
                const reqParts = [];
                if (weap.cost.bark) reqParts.push(`${weap.cost.bark} Bark`);
                if (weap.cost.amber) reqParts.push(`${weap.cost.amber} Amber`);
                if (weap.cost.iron) reqParts.push(`${weap.cost.iron} Iron`);
                alert(`Not enough materials gathered from Forest yet!\nRequires: ${reqParts.join(', ')}`);
              }
            }
          });
        }
      });
    } else if (this.currentTab === 'free') {
      // STANDARD BLADES
      const C = L.free;
      const freeWeapons = [
        GAME_CONFIG.WEAPONS.STARTER,
        GAME_CONFIG.WEAPONS.IRON_BROADSWORD,
        GAME_CONFIG.WEAPONS.FOREST_GLAIVE
      ];

      freeWeapons.forEach((weap, idx) => {
        const top = C.top + idx * (C.h + C.gap);
        const y = top + C.h / 2;
        const unlocked = storage.isWeaponUnlocked(weap.id);
        const isEquipped = equipped === weap.id;

        const card = this.add.rectangle(w / 2, y, L.cardW, C.h, 0x122212, 0.9)
          .setStrokeStyle(1, isEquipped ? 0x98ff20 : 0x2e4e2e);
        this.contentContainer.add(card);

        const name = this.add.text(w / 2 + C.textDx, top + C.name.dy, weap.name, {
          fontFamily: 'Press Start 2P',
          fontSize: C.name.hint,
          color: isEquipped ? '#98ff20' : '#ffffff'
        });
        this.contentContainer.add(name);

        const stats = this.add.text(w / 2 + C.textDx, top + C.stats.dy, `Dmg: x${weap.damageMul} • Reach: x${weap.rangeMul} • ${weap.tier}`, {
          fontFamily: 'Press Start 2P',
          fontSize: C.stats.hint,
          color: '#8cb38c'
        });
        this.contentContainer.add(stats);

        // Action Button
        let btnText = 'EQUIP';
        let btnColor = 0x2a542a;

        if (isEquipped) {
          btnText = 'EQUIPPED';
          btnColor = 0x183318;
        } else if (!unlocked && weap.cost) {
          btnText = `CRAFT (${weap.cost.bark || 0}B/${weap.cost.iron || 0}I)`;
          btnColor = 0x3d4414;
        }

        const btn = this.add.rectangle(w / 2 + C.btn.dx, y, C.btn.w, C.btn.h, btnColor)
          .setStrokeStyle(1, isEquipped ? 0x98ff20 : 0x4a7d4a)
          .setInteractive({ useHandCursor: !isEquipped });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + C.btn.dx, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: C.btn.hint,
          color: '#ffffff'
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        if (!isEquipped) {
          btn.on('pointerdown', () => {
            if (unlocked) {
              storage.equipWeapon(weap.id);
              sound.playCoin();
              this.updateHeroPreview();
              this.renderTabContent(w, h);
            } else if (weap.cost) {
              const spent = storage.spendMaterials(weap.cost);
              if (spent) {
                storage.unlockWeapon(weap.id);
                storage.equipWeapon(weap.id);
                sound.playVictory();
                try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
                this.updateHeaderBar();
                this.updateHeroPreview();
                this.renderTabContent(w, h);
              } else {
                sound.playHit();
                alert('Not enough materials gathered from Forest yet!');
              }
            }
          });
        }
      });
    } else {
      // Celestial Blades, Companions & Perk Re-roll
      const C = L.nim;
      const prestigeItems = [
        {
          id: GAME_CONFIG.WEAPONS.GOLDEN_ALBATROSS.id,
          name: 'Golden Solar Blade',
          desc: 'Sun-forged golden sword trail & sparkling embers.',
          cost: { amber: 8, iron: 6 },
          costLabel: '8 Amber, 6 Iron',
          type: 'weapon'
        },
        {
          id: GAME_CONFIG.WEAPONS.CORRUPTED_VOID.id,
          name: 'Corrupted Void Edge',
          desc: 'Ancient twilight essence. Dark obsidian shadow slashes.',
          cost: { amber: 10, iron: 8 },
          costLabel: '10 Amber, 8 Iron',
          type: 'weapon'
        },
        {
          id: 'satchel_pet',
          name: 'Moon Sprite Satchel (Sylva)',
          desc: 'Cosmetic Moon Sprite fairy hovering by your shoulder in trials.',
          cost: { bark: 8, amber: 6 },
          costLabel: '8 Bark, 6 Amber',
          type: 'satchel'
        },
        {
          id: 'relic_reroll',
          name: 'Stat Catalyst Re-roll',
          desc: `Current Perk: ${storage.getActivePerk().toUpperCase()}. Re-roll relic perk.`,
          cost: { bark: 2, amber: 2 },
          costLabel: '2 Bark, 2 Amber',
          type: 'reroll'
        }
      ];

      prestigeItems.forEach((item, idx) => {
        const top = C.top + idx * (C.h + C.gap);
        const y = top + C.h / 2;
        const unlocked = item.type === 'weapon' ? storage.isWeaponUnlocked(item.id) :
                         (item.type === 'satchel' ? storage.data.satchelUnlocked : false);
        const isEquipped = item.type === 'weapon' ? (equipped === item.id) :
                           (item.type === 'satchel' ? storage.isCompanionActive() : false);

        const card = this.add.rectangle(w / 2, y, L.cardW, C.h, 0x221d0f, 0.9).setStrokeStyle(1, 0x5a4818);
        this.contentContainer.add(card);

        const name = this.add.text(w / 2 + C.textDx, top + C.name.dy, item.name, {
          fontFamily: 'Press Start 2P',
          fontSize: C.name.hint,
          color: '#f6c026'
        });
        this.contentContainer.add(name);

        const desc = this.add.text(w / 2 + C.textDx, top + C.desc.dy, item.desc, {
          fontFamily: 'Press Start 2P',
          fontSize: C.desc.hint,
          color: '#bfa770',
          wordWrap: { width: C.wrap }
        });
        this.contentContainer.add(desc);

        // Button label (the price goes on its own line so it always fits the button)
        let btnText = `CRAFT\n(${item.costLabel})`;
        if (unlocked && item.type === 'weapon') {
          btnText = isEquipped ? 'EQUIPPED' : 'EQUIP';
        } else if (unlocked && item.type === 'satchel') {
          btnText = isEquipped ? 'PET ON' : 'PET OFF';
        } else if (item.type === 'reroll') {
          btnText = `REROLL\n(${item.costLabel})`;
        }

        const btn = this.add.rectangle(w / 2 + C.btn.dx, y, C.btn.w, C.btn.h, isEquipped ? 0x1e3a1e : 0x4a3a14)
          .setStrokeStyle(1, 0xe9b213)
          .setInteractive({ useHandCursor: true });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + C.btn.dx, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: C.btn.hint,
          color: '#ffffff',
          align: 'center',
          lineSpacing: C.btn.spacing
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        btn.on('pointerdown', () => {
          if (unlocked && item.type === 'weapon') {
            storage.equipWeapon(item.id);
            sound.playCoin();
            this.updateHeroPreview();
            this.renderTabContent(w, h);
          } else if (unlocked && item.type === 'satchel') {
            storage.toggleCompanion();
            sound.playCoin();
            this.renderTabContent(w, h);
          } else {
            // Material craft / unlock
            const success = storage.spendMaterials(item.cost);
            if (success) {
              sound.playVictory();
              try { confetti({ particleCount: 40, spread: 50 }); } catch (e) {}

              if (item.type === 'weapon') {
                storage.unlockWeapon(item.id);
                storage.equipWeapon(item.id);
                this.updateHeroPreview();
              } else if (item.type === 'satchel') {
                storage.unlockSatchel();
              } else if (item.type === 'reroll') {
                const perks = GAME_CONFIG.PERKS;
                const current = storage.getActivePerk();
                const others = perks.filter(p => p.id !== current);
                const nextPerk = Phaser.Utils.Array.GetRandom(others);
                storage.setActivePerk(nextPerk.id);
                alert(`Relic Perk Re-rolled! Now equipped with: ${nextPerk.name} (${nextPerk.desc})`);
              }

              this.updateHeaderBar();
              this.renderTabContent(w, h);
            } else {
              sound.playHit();
              alert(`Not enough materials gathered! Requires: ${item.costLabel}`);
            }
          }
        });
      });
    }
  }

  // Portrait and landscape have different layouts: lay the screen out again when the phone is turned,
  // on the tab that was showing.
  onViewportResize(w, h) {
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(w, h);
    }
    this.scene.restart({ tab: this.currentTab });
  }
}

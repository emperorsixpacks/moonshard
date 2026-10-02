import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import { isTallCanvas } from '../engine/uiScale.js';
import { gdService } from '../engine/GdService.js';
import { describeOutcome } from '../gd/outcome.js';
import { formatG } from '../gd/format.js';
import { forgeOffer, materialsLabel } from '../ui/forgeOffer.js';
import { showToast } from '../ui/toast.js';
import confetti from 'canvas-confetti';

/** Each tab's button colours (the ones the Forge always had), and gold for everything paid in G$, whichever tab it is on. */
const SKINS_TONE = { equip: { fill: 0x1d3f58, stroke: 0x38e1ff }, equipped: { fill: 0x163416, stroke: 0x98ff20 }, craft: { fill: 0x472810, stroke: 0xff9933 } };
const FREE_TONE = { equip: { fill: 0x2a542a, stroke: 0x4a7d4a }, equipped: { fill: 0x183318, stroke: 0x98ff20 }, craft: { fill: 0x3d4414, stroke: 0x4a7d4a } };
// a materials-only craft on this gold tab is forest green, so it never looks like a G$ purchase
const NIM_TONE = { equip: { fill: 0x4a3a14, stroke: 0xe9b213 }, equipped: { fill: 0x1e3a1e, stroke: 0xe9b213 }, craft: { fill: 0x2c3a14, stroke: 0x7fae4a } };
const G_TONE = { fill: 0x3d3410, stroke: 0xf6c026 };
const LOCKED_TONE = { fill: 0x24241f, stroke: 0x5c5c4c };
function buttonTone(offer, tone) {
  if (offer.priceG !== undefined || offer.action === 'wait') return G_TONE;
  if (offer.action === 'locked') return LOCKED_TONE;
  if (offer.action === 'none' || (offer.action === 'toggle' && offer.label === 'PET ON')) return tone.equipped;
  if (offer.action === 'craft' || offer.action === 'short') return tone.craft;
  return tone.equip;
}

/** G$ in a wallet, rounded down (a balance shown as "20" can pay 20). */
const walletG = (g) => formatG(Math.floor(Number(g) * 100) / 100, 2);
const NEEDS = { bark: 'Bark', amber: 'Amber', iron: 'Iron' };
const needsText = (cost = {}) => Object.entries(NEEDS).filter(([k]) => cost[k] > 0).map(([k, name]) => `${cost[k]} ${name}`).join(', ');

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
    btn: { dx: 152, w: 92, h: 30, hint: '4.5px', spacing: 1 }
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
    btn: { dx: 170, w: 96, h: 46, hint: '6.1px', spacing: 2 }
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

    this.subText = this.add.text(w / 2, L.sub.y, '', {
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

    // Render the active tab now, and again whenever the G$ side changes while the screen is open (the catalog arrives, a
    // payment is confirmed, the balance moves, the player connects)
    this.unsubscribeGd = gdService.subscribe(() => {
      this.updateHeaderBar();
      this.renderTabContent(w, h);
    });
    this.events.once('shutdown', () => this.unsubscribeGd?.());
  }

  updateHeaderBar() {
    const mats = storage.getMaterials();
    const { balance, shop } = gdService.getStatus();
    const g = balance == null ? '' : ` | G$: ${walletG(balance)}`;
    this.matsText.setText(`🌲Bark: ${mats.bark} | 🍯Amber: ${mats.amber} | ⚙️Iron: ${mats.iron}${g}`);
    this.subText.setText(shop?.enabled
      ? 'Blades: forest materials + a G$ fee • Looks: G$'
      : 'Equip Sword Skins & Craft Blades with Forest Materials');
  }

  /**
   * A card's action button: what it says and does come from forgeOffer(). `item` carries what forgeOffer() reads plus what
   * crafting needs (`type`: weapon / satchel / reroll). `tone` is the tab's colours for equip / equipped / craft.
   */
  addOfferButton(item, { x, y, C, tone }, w, h) {
    const offer = forgeOffer(item, gdService.getStatus());
    const { fill, stroke } = buttonTone(offer, tone);
    const live = !['none', 'wait', 'locked'].includes(offer.action);
    const btn = this.add.rectangle(x, y, C.btn.w, C.btn.h, fill)
      .setStrokeStyle(1.2, stroke)
      .setInteractive({ useHandCursor: live });
    const lbl = this.add.text(x, y, offer.label, {
      fontFamily: 'Press Start 2P',
      fontSize: C.btn.hint,
      color: '#ffffff',
      align: 'center',
      lineSpacing: C.btn.spacing ?? 1
    }).setOrigin(0.5);
    this.contentContainer.add([btn, lbl]);
    if (live) btn.on('pointerdown', () => this.pressOffer(offer, item, w, h));
  }

  pressOffer(offer, item, w, h) {
    switch (offer.action) {
      case 'equip':
        storage.equipWeapon(item.id);
        sound.playCoin();
        this.updateHeroPreview();
        this.renderTabContent(w, h);
        return;
      case 'toggle':
        storage.toggleCompanion();
        sound.playCoin();
        this.renderTabContent(w, h);
        return;
      case 'short':
        sound.playHit();
        showToast(`Not enough forest materials yet. Needs ${needsText(item.cost)}.`, { type: 'warn' });
        return;
      case 'wallet':
        sound.playCoin();
        globalThis.window?.__gdPanel?.open();
        return;
      case 'craft':
        this.craft(item, w, h);
        return;
      case 'buy':
      case 'forge':
        this.payWithG(offer, item, w, h);
        return;
      default:
    }
  }

  /** A material craft (no Moon Shop on the server, or an item it does not sell). */
  craft(item, w, h) {
    if (!storage.spendMaterials(item.cost)) {
      sound.playHit();
      showToast(`Not enough forest materials yet. Needs ${needsText(item.cost)}.`, { type: 'warn' });
      return;
    }
    sound.playVictory();
    try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
    if (item.type === 'satchel') {
      storage.unlockSatchel();
    } else if (item.type === 'reroll') {
      const current = storage.getActivePerk();
      const nextPerk = Phaser.Utils.Array.GetRandom(GAME_CONFIG.PERKS.filter(p => p.id !== current));
      storage.setActivePerk(nextPerk.id);
      showToast(`Relic perk re-rolled: ${nextPerk.name} (${nextPerk.desc})`);
    } else {
      storage.unlockWeapon(item.id);
      storage.equipWeapon(item.id);
      this.updateHeroPreview();
    }
    this.updateHeaderBar();
    this.renderTabContent(w, h);
  }

  /**
   * A G$ purchase: the price goes from the player's wallet into the prize vault (GdService.buy). A forged blade's materials
   * are spent only once the payment went through and was not refused, so a failed payment costs no materials.
   */
  async payWithG(offer, item, w, h) {
    if (this.paying) return;
    this.paying = true;
    try {
      const res = await gdService.buy(item.id);
      const toast = describeOutcome('buy', res);
      if (toast) showToast(toast.text, { type: toast.type });
      if (!res.ok || res.confirmRejected) {
        sound.playHit();
        return;
      }
      if (offer.action === 'forge') storage.spendMaterials(item.cost);
      if (storage.isWeaponUnlocked(item.id)) storage.equipWeapon(item.id); // recorded: owned already
      sound.playVictory();
      try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
    } finally {
      this.paying = false;
      if (this.sys.isActive()) {
        this.updateHeaderBar();
        this.updateHeroPreview();
        this.renderTabContent(w, h);
      }
    }
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
        this.addOfferButton(
          { id: weap.id, type: 'weapon', cost: weap.cost, unlocked, equipped: isEquipped, hasMaterials: this.hasMaterials(weap.cost) },
          { x: w / 2 + C.btn.dx, y, C, tone: SKINS_TONE },
          w, h,
        );
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
        this.addOfferButton(
          { id: weap.id, type: 'weapon', cost: weap.cost, unlocked, equipped: isEquipped, hasMaterials: this.hasMaterials(weap.cost) },
          { x: w / 2 + C.btn.dx, y, C, tone: FREE_TONE },
          w, h,
        );
      });
    } else {
      // Celestial Blades, Companions & Perk Re-roll
      const C = L.nim;
      const prestigeItems = [
        {
          id: GAME_CONFIG.WEAPONS.GOLDEN_ALBATROSS.id,
          name: 'Golden Solar Blade',
          desc: "Glaive's power, a new look: golden trail & embers.",
          cost: { amber: 8, iron: 6 },
          type: 'weapon'
        },
        {
          id: GAME_CONFIG.WEAPONS.CORRUPTED_VOID.id,
          name: 'Corrupted Void Edge',
          desc: "Glaive's power, a new look: obsidian shadow slashes.",
          cost: { amber: 10, iron: 8 },
          type: 'weapon'
        },
        {
          id: 'satchel_pet',
          name: 'Moon Sprite Satchel (Sylva)',
          desc: 'Looks only: a Moon Sprite hovering by your shoulder.',
          cost: { bark: 8, amber: 6 },
          type: 'satchel'
        },
        {
          id: 'relic_reroll',
          name: 'Stat Catalyst Re-roll',
          desc: `Current Perk: ${storage.getActivePerk().toUpperCase()}. Re-roll relic perk.`,
          cost: { bark: 2, amber: 2 },
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

        // Action Button (a re-roll can be bought again and again: it is never "owned")
        const offerItem = { id: item.id, type: item.type, cost: item.cost, unlocked, equipped: isEquipped, hasMaterials: this.hasMaterials(item.cost), pet: item.type === 'satchel' };
        if (item.type === 'reroll') {
          this.addRerollButton(offerItem, { x: w / 2 + C.btn.dx, y, C }, w, h);
        } else {
          this.addOfferButton(offerItem, { x: w / 2 + C.btn.dx, y, C, tone: NIM_TONE }, w, h);
        }
      });
    }
  }

  hasMaterials(cost = {}) {
    const mats = storage.getMaterials();
    return Object.keys(NEEDS).every((k) => (mats[k] ?? 0) >= (cost[k] ?? 0));
  }

  /** The relic re-roll is crafted from materials only, whatever the server sells. */
  addRerollButton(item, { x, y, C }, w, h) {
    const btn = this.add.rectangle(x, y, C.btn.w, C.btn.h, NIM_TONE.craft.fill)
      .setStrokeStyle(1.2, NIM_TONE.craft.stroke)
      .setInteractive({ useHandCursor: true });
    const lbl = this.add.text(x, y, `REROLL\n(${materialsLabel(item.cost)})`, {
      fontFamily: 'Press Start 2P',
      fontSize: C.btn.hint,
      color: '#ffffff',
      align: 'center',
      lineSpacing: C.btn.spacing ?? 1
    }).setOrigin(0.5);
    this.contentContainer.add([btn, lbl]);
    btn.on('pointerdown', () => this.craft(item, w, h));
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

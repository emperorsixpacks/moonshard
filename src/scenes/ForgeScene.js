import Phaser from 'phaser';
import confetti from 'canvas-confetti';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import { gdService } from '../engine/GdService.js';
import { describeOutcome } from '../gd/outcome.js';
import { createShopScreen } from '../ui/shopScreen.js';
import { TABS, shopModel } from '../ui/shopView.js';
import { showToast } from '../ui/toast.js';

const NEEDS = { bark: 'Bark', amber: 'Amber', iron: 'Iron' };
const needsText = (cost = {}) => Object.entries(NEEDS).filter(([k]) => cost[k] > 0).map(([k, name]) => `${cost[k]} ${name}`).join(', ');

/**
 * The shop (the menu's "Shop" tile; the scene keeps the Forge's key, which the links to it use). The cards and the buttons
 * are page elements under the page header (src/ui/shopScreen.js), so this scene is a thin shell: it gives the screen what the
 * wallet service and this device hold (src/ui/shopView.js), carries out what the player taps (equip, craft from forest
 * materials, pay in G$), and tidies up when the player leaves. The game canvas stays idle behind the screen.
 */
export default class ForgeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ForgeScene' });
  }

  create(data) {
    pauseService.detachScene();
    this.cameras.main.resetFX();
    sound.playBGM('title');
    if (typeof window !== 'undefined') window.touchController?.hide();

    this.tab = TABS.some((t) => t.key === data?.tab) ? data.tab : 'blades';
    this.paying = false;

    const el = (id) => document.getElementById(id);
    this.screen = createShopScreen({ host: el('ms-menu'), onAction: (act, target) => this.onAction(act, target) });
    // Draw again whenever the G$ side changes while the screen is open (the catalog arrives, a payment is confirmed, the
    // balance moves, the player connects)
    this.stopWatching = gdService.subscribe(() => this.draw());
    // Esc goes back to the menu, unless it is closing a sheet (the wallet panel; caught before the sheet's own handler runs)
    this.onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('#ms-sheets .sheet:not(.out)')) this.goMenu();
    };
    document.addEventListener('keydown', this.onKey, true);
    this.events.once('shutdown', () => this.teardown());

    this.draw();
  }

  /** What the screen shows now: this device's blades, armour and materials, and what the wallet service says of the shop. */
  model() {
    const worn = storage.getEquippedArmour();
    return shopModel({
      tab: this.tab,
      status: gdService.getStatus(),
      mats: storage.getMaterials(),
      weaponId: storage.getEquippedWeapon(),
      helmId: worn.helm,
      shieldId: worn.shield,
      unlockedWeapons: storage.data.unlockedWeapons,
      unlockedArmour: storage.data.unlockedArmour ?? [],
      petUnlocked: storage.data.satchelUnlocked,
      petOn: storage.isCompanionActive(),
      perkId: storage.getActivePerk(),
      bestLevel: storage.getBestLevel(),
    });
  }

  draw(opts) {
    this.screen?.render(this.model(), opts);
  }

  onAction(act, target) {
    switch (act) {
      case 'tab':
        if (this.tab !== target.dataset.tab && TABS.some((t) => t.key === target.dataset.tab)) {
          sound.playSlash(1);
          this.tab = target.dataset.tab;
          this.draw({ top: true });
        }
        break;
      case 'offer':
        this.pressOffer(target.dataset.id);
        break;
      case 'wallet':
        sound.playCoin();
        window.__gdPanel?.open();
        break;
      case 'menu':
        this.goMenu();
        break;
      case 'endless':
        sound.playCoin();
        this.scene.start('SurvivalScene');
        break;
      default:
    }
  }

  /** What a card's button does, decided from the card as it is now (not as it was when it was drawn). */
  pressOffer(id) {
    const card = this.model().sections.flatMap((s) => s.cards).find((c) => c.id === id);
    if (!card) return;
    const { action } = card.offer;
    switch (action) {
      case 'equip':
        this.equip(card.press);
        sound.playCoin();
        this.draw();
        return;
      case 'toggle':
        storage.toggleCompanion();
        sound.playCoin();
        this.draw();
        return;
      case 'short':
        sound.playHit();
        showToast(`Not enough forest materials yet. Needs ${needsText(card.press.cost)}.`, { type: 'warn' });
        return;
      case 'wallet':
        sound.playCoin();
        window.__gdPanel?.open();
        return;
      case 'craft':
        this.craft(card.press);
        return;
      case 'buy':
      case 'forge':
        this.payWithG(action, card.press);
        return;
      default:
    }
  }

  /** Wear a blade or a piece of armour that is owned. */
  equip({ id, type }) {
    if (type === 'armour') storage.equipArmour(id);
    else storage.equipWeapon(id);
  }

  /** A material craft (no shop on the server, or an item it does not sell, and the relic re-roll). */
  craft(item) {
    if (this.paying) return; // a forged piece's materials are taken once its fee is through: nothing else spends them meanwhile
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
      const nextPerk = Phaser.Utils.Array.GetRandom(GAME_CONFIG.PERKS.filter((p) => p.id !== current));
      storage.setActivePerk(nextPerk.id);
      showToast(`Relic perk re-rolled: ${nextPerk.name} (${nextPerk.desc})`);
    } else if (item.type === 'armour') {
      storage.unlockArmour(item.id);
      storage.equipArmour(item.id);
    } else {
      storage.unlockWeapon(item.id);
      storage.equipWeapon(item.id);
    }
    this.draw();
  }

  /**
   * A G$ purchase: the price goes from the player's wallet into the prize vault (GdService.buy). A forged piece's materials
   * are spent only once the payment went through and was not refused, so a failed payment costs no materials.
   */
  async payWithG(action, item) {
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
      if (action === 'forge' && !storage.spendMaterials(item.cost)) {
        // the fee is paid and the piece is theirs; only another tab can have used the materials meanwhile, so none are taken
        showToast('Forged. The forest materials were already spent elsewhere, so none were taken.', { type: 'warn' });
      }
      // what was bought is owned now (the sync that follows a payment recorded it): put it on
      if (item.type === 'armour' ? storage.isArmourUnlocked(item.id) : storage.isWeaponUnlocked(item.id)) this.equip(item);
      sound.playVictory();
      try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
    } finally {
      this.paying = false;
      if (this.sys.isActive()) this.draw();
    }
  }

  goMenu() {
    sound.playCoin();
    this.scene.start('MenuScene');
  }

  teardown() {
    document.removeEventListener('keydown', this.onKey, true);
    this.stopWatching?.();
    this.stopWatching = null;
    this.screen?.destroy();
    this.screen = null;
  }
}

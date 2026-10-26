import { GAME_CONFIG } from '../config.js';
import { isBlessed } from '../gd/blessing.js';

const STORAGE_KEY = 'MOONSHARD_SAVE_V1';

const DEFAULT_STATE = {
  inventory: {
    bark: 25,
    amber: 15,
    iron: 10,
  },
  equippedWeapon: 'iron_starter',
  unlockedWeapons: ['iron_starter'],
  unlockedArmour: [], // ids of GAME_CONFIG.ARMOUR
  equippedHelm: null,
  equippedShield: null,
  satchelUnlocked: false,
  tutorialDone: false,
  prologueSeen: false,
  companionEquipped: false,
  activePerk: 'magnet',
  storyProgress: {
    chapter1: { completed: false, highKills: 0 },
    chapter2: { completed: false, highKills: 0 },
    chapter3: { completed: false, highKills: 0 },
    chapter4: { completed: false, highKills: 0 },
    chapter5: { completed: false, highKills: 0 },
  },
  dailyRecords: {}, // keyed by date string
  highScore: 0,
  bestLevel: 0, // the deepest Endless level this device has seen
  walletAccount: null,
  settings: {
    soundMuted: false,
    musicMuted: false,
  },
};

const armourOf = (id) => Object.values(GAME_CONFIG.ARMOUR).find((piece) => piece.id === id) ?? null;
const SLOT_KEY = { helm: 'equippedHelm', shield: 'equippedShield' };

class StorageManager {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch (e) {
      console.warn('Failed to parse save data, resetting:', e);
      return { ...DEFAULT_STATE };
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }
  }

  getMaterials() {
    return this.data.inventory;
  }

  addMaterials({ bark = 0, amber = 0, iron = 0 }) {
    // Citizen's Blessing: +25% drops, with the fractional part carried so four single drops yield five.
    const mult = isBlessed() ? 1.25 : 1;
    const carry = (this.blessCarry ||= { bark: 0, amber: 0, iron: 0 });
    for (const [key, base] of Object.entries({ bark, amber, iron })) {
      const exact = base * mult + carry[key];
      const whole = Math.floor(exact + 1e-9);
      carry[key] = exact - whole;
      this.data.inventory[key] += whole;
    }
    this.save();
    return this.data.inventory;
  }

  spendMaterials({ bark = 0, amber = 0, iron = 0 }) {
    if (
      this.data.inventory.bark >= bark &&
      this.data.inventory.amber >= amber &&
      this.data.inventory.iron >= iron
    ) {
      this.data.inventory.bark -= bark;
      this.data.inventory.amber -= amber;
      this.data.inventory.iron -= iron;
      this.save();
      return true;
    }
    return false;
  }

  consumeMaterials(cost) {
    return this.spendMaterials(cost);
  }

  getEquippedWeapon() {
    return this.data.equippedWeapon;
  }

  equipWeapon(weaponId) {
    if (this.data.unlockedWeapons.includes(weaponId)) {
      this.data.equippedWeapon = weaponId;
      this.save();
      return true;
    }
    return false;
  }

  unlockWeapon(weaponId) {
    if (!this.data.unlockedWeapons.includes(weaponId)) {
      this.data.unlockedWeapons.push(weaponId);
      this.save();
    }
  }

  isWeaponUnlocked(weaponId) {
    return this.data.unlockedWeapons.includes(weaponId);
  }

  /** The pieces of armour this device can wear (GAME_CONFIG.ARMOUR ids): bought in the shop, or forged where there is none. */
  isArmourUnlocked(armourId) {
    return (this.data.unlockedArmour ?? []).includes(armourId);
  }

  unlockArmour(armourId) {
    if (!armourOf(armourId) || this.isArmourUnlocked(armourId)) return;
    this.data.unlockedArmour = [...(this.data.unlockedArmour ?? []), armourId];
    this.save();
  }

  /** What the hero wears: the id in each slot, or null for a bare slot. */
  getEquippedArmour() {
    return { helm: this.data.equippedHelm ?? null, shield: this.data.equippedShield ?? null };
  }

  equipArmour(armourId) {
    const piece = armourOf(armourId);
    if (!piece || !this.isArmourUnlocked(armourId)) return false;
    this.data[SLOT_KEY[piece.slot]] = armourId;
    this.save();
    return true;
  }

  unequipArmour(slot) {
    if (!SLOT_KEY[slot]) return false;
    this.data[SLOT_KEY[slot]] = null;
    this.save();
    return true;
  }

  /** Put on the best piece owned in every slot that is bare, and take off what is no longer owned. */
  tidyArmour() {
    const owned = this.data.unlockedArmour ?? [];
    for (const [slot, key] of Object.entries(SLOT_KEY)) {
      if (this.data[key] && !owned.includes(this.data[key])) this.data[key] = null;
      if (!this.data[key]) {
        const best = Object.values(GAME_CONFIG.ARMOUR).filter((a) => a.slot === slot && owned.includes(a.id)).sort((a, b) => b.cut - a.cut)[0];
        if (best) this.data[key] = best.id;
      }
    }
  }

  unlockSatchel() {
    this.data.satchelUnlocked = true;
    this.data.companionEquipped = true;
    this.save();
  }

  toggleCompanion() {
    if (this.data.satchelUnlocked) {
      this.data.companionEquipped = !this.data.companionEquipped;
      this.save();
    }
    return this.data.companionEquipped;
  }

  isCompanionActive() {
    return this.data.satchelUnlocked && this.data.companionEquipped;
  }

  /** With no Moon Shop on the server the first blade is free, as it was before the shop existed. */
  applyShopClosed() {
    this.unlockWeapon(GAME_CONFIG.WEAPONS.STARTER.id);
  }

  /**
   * With the Moon Shop open, the items it sells (`itemIds`) are paid for in G$ and belong to the person, so each one is
   * unlocked on this device exactly when the server lists it in `owned`. Anything the shop does not sell is left alone.
   * A newly owned pet comes out at once, as a forged one does; an equipped blade no longer owned is put away.
   */
  applyShopOwnership(itemIds, owned) {
    const sold = new Set(itemIds);
    const has = new Set(owned);
    const weapons = Object.values(GAME_CONFIG.WEAPONS).map((w) => w.id);
    this.data.unlockedWeapons = [
      ...this.data.unlockedWeapons.filter((id) => !sold.has(id)),
      ...weapons.filter((id) => sold.has(id) && has.has(id)),
    ];
    if (!this.data.unlockedWeapons.includes(this.data.equippedWeapon)) this.data.equippedWeapon = GAME_CONFIG.WEAPONS.STARTER.id;
    const armour = Object.values(GAME_CONFIG.ARMOUR).map((a) => a.id);
    this.data.unlockedArmour = [
      ...(this.data.unlockedArmour ?? []).filter((id) => !sold.has(id)),
      ...armour.filter((id) => sold.has(id) && has.has(id)),
    ];
    this.tidyArmour();
    if (sold.has('satchel_pet')) {
      const pet = has.has('satchel_pet');
      if (pet && !this.data.satchelUnlocked) this.data.companionEquipped = true;
      if (!pet) this.data.companionEquipped = false;
      this.data.satchelUnlocked = pet;
    }
    this.save();
  }

  setActivePerk(perkId) {
    this.data.activePerk = perkId;
    this.save();
  }

  getActivePerk() {
    return this.data.activePerk;
  }

  /** Whether the player has been through (or skipped) the combat tutorial. Anyone who has already cleared a chapter has. */
  isTutorialDone() {
    if (this.data.tutorialDone) return true;
    return Object.values(this.data.storyProgress || {}).some((c) => c?.completed);
  }

  setTutorialDone() {
    this.data.tutorialDone = true;
    this.save();
  }

  /** Whether the player has seen the Prologue (the story's opening cards). Anyone who has cleared a chapter has. */
  hasSeenPrologue() {
    if (this.data.prologueSeen) return true;
    return Object.values(this.data.storyProgress || {}).some((c) => c?.completed);
  }

  setPrologueSeen() {
    this.data.prologueSeen = true;
    this.save();
  }

  /** The chapter "Continue" goes to: the furthest one the player has unlocked (1 to 5). */
  furthestChapter() {
    let n = 1;
    while (n < 5 && this.isChapterUnlocked(n + 1)) n += 1;
    return n;
  }

  markChapterComplete(chapterNum, kills = 0) {
    const key = `chapter${chapterNum}`;
    if (!this.data.storyProgress) this.data.storyProgress = {};
    if (!this.data.storyProgress[key]) {
      this.data.storyProgress[key] = { completed: false, highKills: 0 };
    }
    this.data.storyProgress[key].completed = true;
    this.data.storyProgress[key].highKills = Math.max(this.data.storyProgress[key].highKills || 0, kills);
    this.save();
  }

  isChapterUnlocked(chapterNum) {
    if (chapterNum === 1) return true;
    const prevKey = `chapter${chapterNum - 1}`;
    return !!this.data.storyProgress[prevKey]?.completed;
  }

  recordDailyTrial(dateStr, score, details) {
    if (!this.data.dailyRecords) this.data.dailyRecords = {};
    const prev = this.data.dailyRecords[dateStr];
    if (!prev || score > prev.score) {
      this.data.dailyRecords[dateStr] = {
        score,
        details,
        timestamp: Date.now()
      };
      this.data.highScore = Math.max(this.data.highScore, score);
      this.save();
    }
  }

  addScore(score) {
    if (!score || score <= 0) return;
    this.data.highScore = Math.max(this.data.highScore || 0, (this.data.highScore || 0) + score);
    this.save();
  }

  getBestLevel() {
    return this.data.bestLevel || 0;
  }

  /** The deepest Endless level this device has seen. It opens a blade only where there is no Moon Shop (the server counts otherwise). */
  recordBestLevel(level) {
    if (!Number.isInteger(level) || level <= this.getBestLevel()) return;
    this.data.bestLevel = level;
    this.save();
  }

  getDailyRecord(dateStr) {
    if (!this.data.dailyRecords) this.data.dailyRecords = {};
    return this.data.dailyRecords[dateStr] || null;
  }

  getWalletAccount() {
    return this.data.walletAccount || null;
  }

  setWalletAccount(account) {
    this.data.walletAccount = account;
    this.save();
  }

  isSoundMuted() {
    if (!this.data.settings) this.data.settings = { soundMuted: false, musicMuted: false };
    return Boolean(this.data.settings.soundMuted);
  }

  setSoundMuted(muted) {
    if (!this.data.settings) this.data.settings = { soundMuted: false, musicMuted: false };
    this.data.settings.soundMuted = Boolean(muted);
    this.save();
    return this.data.settings.soundMuted;
  }

  isMusicMuted() {
    if (!this.data.settings) this.data.settings = { soundMuted: false, musicMuted: false };
    return Boolean(this.data.settings.musicMuted);
  }

  setMusicMuted(muted) {
    if (!this.data.settings) this.data.settings = { soundMuted: false, musicMuted: false };
    this.data.settings.musicMuted = Boolean(muted);
    this.save();
    return this.data.settings.musicMuted;
  }

  getSettings() {
    if (!this.data.settings) this.data.settings = { soundMuted: false, musicMuted: false };
    return { ...this.data.settings };
  }
}

export const storage = new StorageManager();

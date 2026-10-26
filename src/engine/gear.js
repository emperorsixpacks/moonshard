import { GAME_CONFIG } from '../config.js';
import { BEASTS, REALMS } from './levels.js';

/*
 * What the hero wears and wields, as pure functions (no Phaser, no storage): how much a helmet and a shield take off a hit, and how
 * much harder a blade hits the beasts of the realm it was forged for. The scenes ask these, the shop (ui/shopView.js) writes them
 * in words, and the tests pin the numbers. The pieces themselves are GAME_CONFIG.ARMOUR and GAME_CONFIG.WEAPONS.
 */

export const SLOTS = Object.freeze(['helm', 'shield']);

/** Every piece of armour, helmets then shields, each slot from its first tier to its last. */
export const ARMOUR = Object.freeze(
  SLOTS.flatMap((slot) => Object.values(GAME_CONFIG.ARMOUR).filter((piece) => piece.slot === slot).sort((a, b) => a.cut - b.cut)),
);

export const armourById = (id) => ARMOUR.find((piece) => piece.id === id) ?? null;
export const armourFor = (slot) => ARMOUR.filter((piece) => piece.slot === slot);

/** What a hit comes from: a foe's own body and weapons ('contact'), or what it throws ('ranged'). The helmet turns aside the first, the shield the second. */
export const SOURCES = Object.freeze(['contact', 'ranged']);
const SLOT_OF_SOURCE = Object.freeze({ contact: 'helm', ranged: 'shield' });

/**
 * The share of a hit that the worn armour takes off: 0 to 1, 0 for a hit that is not one of the two kinds, or a slot left bare.
 * @param {{ helm?: {cut: number}|null, shield?: {cut: number}|null }} worn
 * @param {string} source 'contact' or 'ranged'
 */
export function cutFor(worn = {}, source = 'contact') {
  const slot = SLOT_OF_SOURCE[source];
  const cut = slot ? worn[slot]?.cut : 0;
  return Number.isFinite(cut) ? Math.min(0.9, Math.max(0, cut)) : 0;
}

/** What a hit of `amount` costs through a `cut`: whole points, and never less than 1 (armour thins a blow, it does not stop one). */
export function takenDamage(amount, cut = 0) {
  const raw = Number(amount);
  if (!(raw > 0)) return 0;
  if (!(cut > 0)) return raw;
  return Math.max(1, Math.round(raw * (1 - cut)));
}

/** The realm a foe belongs to: a beast's own `home`, and for a boss (Gorgok in the coat of its realm) the realm of the level it came in. */
export const homeOf = (type, levelRealm = null) => (BEASTS[type]?.home ?? (String(type).startsWith('boss_') ? levelRealm : null));

/** What a blade multiplies its damage by against a foe: its bane against the foe's realm, otherwise 1. */
export function baneMul(weapon, type, levelRealm = null) {
  const bane = weapon?.bane;
  if (!bane) return 1;
  return homeOf(type, levelRealm) === bane.realm ? bane.mul : 1;
}

/** A cut as the shop and the HUD say it: "-14%". */
export const cutLabel = (cut) => `-${Math.round(cut * 100)}%`;

/** What a piece of armour does, in words: "Takes 14% off blows from foes" / "...off what they throw". */
export function armourEffect(piece) {
  const pct = Math.round(piece.cut * 100);
  return piece.slot === 'helm' ? `Takes ${pct}% off blows from foes` : `Takes ${pct}% off what foes throw`;
}

/** The realm a piece or a blade was made for, as the shop names it: "The Hive Canopy". */
export const realmName = (key) => REALMS[key]?.name ?? String(key);

/** The beasts that live in a realm, in a sentence: "bees, flying eyes and hornet guards". */
export function beastsList(realm) {
  const names = Object.values(BEASTS).filter((beast) => beast.home === realm).map((beast) => `${beast.name.toLowerCase()}s`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? 'its beasts';
}

/** A blade's bane in words: how much harder, and against which beasts: "+30% against bees, flying eyes and hornet guards". Null for a blade with none. */
export function baneLine(weapon) {
  const bane = weapon?.bane;
  if (!bane) return null;
  return `+${Math.round((bane.mul - 1) * 100)}% against ${beastsList(bane.realm)}`;
}

/** What the HUD says of the armour worn: "⛑ -14%  🛡 -22%", or nothing for a hero who wears none. */
export function gearStrip({ helm = null, shield = null } = {}) {
  return [helm && `⛑ ${cutLabel(helm.cut)}`, shield && `🛡 ${cutLabel(shield.cut)}`].filter(Boolean).join('  ');
}

/**
 * The three numbers that sum up a kit for the shop's preview: blade damage, what the helmet takes off, what the shield takes off.
 * @returns {{ damage: string, contact: string, ranged: string }} e.g. { damage: 'x1.8', contact: '-14%', ranged: '-22%' }
 */
export function kitSummary({ weapon = null, helm = null, shield = null } = {}) {
  const worn = { helm, shield };
  const label = (cut) => (cut > 0 ? cutLabel(cut) : 'none');
  return {
    damage: `x${weapon?.damageMul ?? 1}`,
    contact: label(cutFor(worn, 'contact')),
    ranged: label(cutFor(worn, 'ranged')),
  };
}

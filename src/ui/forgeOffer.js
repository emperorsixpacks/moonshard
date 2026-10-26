import { formatG } from '../gd/format.js';
import { gateStep } from '../engine/playGateRules.js';

/**
 * What the Forge offers for one item, as a pure function of the item and the wallet service's status (so every case is
 * testable without a canvas). With a Moon Shop on the server (server/config.js GAME.SHOP): the first blade is bought with
 * G$, a stronger blade is forged from forest materials plus a G$ fee, and looks are bought with G$. With no shop,
 * everything is crafted from materials, as it was before the shop.
 */

const MATERIALS = [['bark', 'B'], ['amber', 'A'], ['iron', 'I']];

/** "10B/5I": the materials a cost needs, in a fixed order. */
export const materialsLabel = (cost = {}) => MATERIALS.filter(([k]) => cost[k] > 0).map(([k, l]) => `${cost[k]}${l}`).join('/');

function ownedOffer({ pet, equipped }) {
  if (pet) return { label: equipped ? 'PET ON' : 'PET OFF', action: 'toggle' };
  return equipped ? { label: 'EQUIPPED', action: 'none' } : { label: 'EQUIP', action: 'equip' };
}

/** The blade that asks for a level shows it, until the player has been that deep in Endless. */
const levelLocked = (minLevel) => ({ label: `REACH\nLEVEL ${minLevel}`, action: 'locked' });

/**
 * @param {{ id: string, cost?: object, unlocked: boolean, equipped: boolean, hasMaterials: boolean, pet?: boolean,
 *   minLevel?: number, levelReached?: number, needs?: string }} item
 *   `unlocked`: on this device (with the shop open, that is what the server says the player owns); `hasMaterials`: the
 *   device holds `cost`; `minLevel` and `levelReached`: the Endless level a blade asks for and the deepest this device
 *   has seen, and `needs`: the name of the piece it requires that this device does not have yet, all three read only for
 *   an item the shop does not sell (the shop lists its own `requires` and `minLevel`, and the server knows what the player
 *   owns and how deep they went: status.owned, status.bestLevel). Crafted from materials alone, the tiers still go in order.
 * @param {object} status gdService.getStatus()
 * @returns {{ label: string, action: string, priceG?: string }} `action` is what pressing the button does:
 *   equip / toggle (the pet) / none (equipped already) / buy / forge (materials and the fee) / craft (materials only) /
 *   short (not enough materials) / wallet (connect and verify first) / wait (a payment is on its way) / locked
 */
export function forgeOffer(item, status) {
  if (item.unlocked) return ownedOffer(item);
  const { shop } = status;
  if (!shop) return status.offline ? { label: 'SHOP\nOFFLINE', action: 'locked' } : { label: 'LOADING…', action: 'locked' };

  const sold = shop.enabled ? shop.items.find((x) => x.id === item.id) : null;
  if (!sold) {
    if (!item.cost) return { label: 'LOCKED', action: 'locked' };
    if (item.needs) return { label: `NEEDS\n${String(item.needs).toUpperCase()}`, action: 'locked' };
    if (item.minLevel && (item.levelReached ?? 0) < item.minLevel) return levelLocked(item.minLevel);
    return { label: `CRAFT\n(${materialsLabel(item.cost)})`, action: item.hasMaterials ? 'craft' : 'short' };
  }
  if (status.awaiting?.shop?.[item.id]) return { label: 'PAYING…', action: 'wait' };
  if (sold.requires && !(status.owned ?? []).includes(sold.requires)) {
    const need = shop.items.find((x) => x.id === sold.requires)?.name ?? sold.requires;
    return { label: `NEEDS\n${String(need).toUpperCase()}`, action: 'locked' };
  }
  if (sold.minLevel && (status.bestLevel ?? 0) < sold.minLevel) return levelLocked(sold.minLevel);

  const { priceG } = sold;
  const price = `${formatG(priceG, 2)} G$`;
  const forge = sold.kind === 'forge';
  const label = forge ? `FORGE + ${price}\n${materialsLabel(item.cost)}` : `BUY\n${price}`;
  // buying is for verified humans: anyone else is sent to the wallet panel (connect, prove you are human) first
  if (!['ready', 'blade'].includes(gateStep(status))) return { label, action: 'wallet', priceG };
  if (forge && !item.hasMaterials) return { label, action: 'short', priceG };
  return { label, action: forge ? 'forge' : 'buy', priceG };
}

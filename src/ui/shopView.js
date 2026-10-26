import { GAME_CONFIG } from '../config.js';
import { BLADE_TIERS, REALM_ORDER, REALMS, realmSpan } from '../engine/levels.js';
import { ARMOUR, armourById, armourEffect, baneLine, beastsList, kitSummary } from '../engine/gear.js';
import { formatG } from '../gd/format.js';
import { forgeOffer } from './forgeOffer.js';
import { icoUse } from './icons.js';
import { escapeHtml as esc } from './sheet.js';

/*
 * The shop, as pure functions of what the wallet service says and what this device holds (no DOM, no service, no storage), so
 * every state it can be in is testable. `shopModel` decides what to show (what each card offers is forgeOffer's call, the same
 * one the old Forge made); `shopHtml` draws it. The screen that owns them (ui/shopScreen.js) places the markup, and the scene
 * (scenes/ForgeScene.js) feeds it and carries out what the player taps. Everything that comes from the server or the player
 * is escaped, or is a number, or is looked up in a fixed table.
 */

const W = GAME_CONFIG.WEAPONS;
const MATERIALS = [['bark', 'Bark'], ['amber', 'Amber'], ['iron', 'Iron']];

export const TABS = Object.freeze([
  { key: 'blades', label: 'Blades' },
  { key: 'armour', label: 'Armour' },
  { key: 'looks', label: 'Looks' },
]);

/** The fine print at the end of each tab: where the money goes, and what it does not buy. */
const NOTES = {
  blades: 'Forged from forest materials and a G$ fee, which goes to the prize vault.',
  armour: 'Forged from forest materials and a G$ fee, which goes to the prize vault.',
  looks: 'Looks only: nothing here adds power. Paid in G$, into the prize vault.',
};

const BLADE_ICON = {
  iron_starter: 'sword', iron_broadsword: 'sword_clean', forest_glaive: 'blade_leaf', moonsteel_blade: 'blade_honey', starforged_edge: 'blade_frost',
  cinderbrand: 'blade_ember', voidglass_reaver: 'blade_violet', golden_albatross: 'blade_gold', corrupted_void: 'blade_void',
};
/** The icons the shop draws, for ui/shopScreen.js to make into a sprite once: a card then refers to an icon instead of repeating its pixels. */
export const SHOP_ICONS = Object.freeze([...new Set([
  'bark', 'amber', 'iron', 'coin', 'tick', 'lock', 'sparkle', 'sword', 'sword_clean',
  ...Object.values(BLADE_ICON),
  ...['helm', 'shield'].flatMap((slot) => REALM_ORDER.map((realm) => `${slot}_${realm}`)),
  ...REALM_ORDER.map((realm) => `realm_${realm}`),
])]);

const SKIN_IMAGE = { sword_flame: '/assets/weapons/sword_flame.png', sword_frost: '/assets/weapons/sword_frost.png', sword_verdant: '/assets/weapons/sword_verdant.png' };
const PET_IMAGE = '/assets/companion/fairy_portrait.png';

/** The picture of a blade: a skin has its own, every other blade is a sword in its realm's metal. */
const weaponArt = (weapon) => (SKIN_IMAGE[weapon.iconKey] ? { img: SKIN_IMAGE[weapon.iconKey] } : { ico: BLADE_ICON[weapon.id] ?? 'sword_clean' });

/** What a piece is called, as the server's label spells it in capitals ("NEEDS\nFOREST GLAIVE"): for putting its name back in a sentence. */
const KNOWN_NAMES = [...Object.values(W), ...ARMOUR].map((piece) => piece.name);

/** G$ in a wallet, rounded down (a balance shown as "20" can pay 20). */
export const walletG = (g) => formatG(Math.floor(Number(g) * 100) / 100, 2);

const hasMaterials = (mats = {}, cost = {}) => MATERIALS.every(([key]) => (mats[key] ?? 0) >= (cost[key] ?? 0));

/** The materials a piece costs, each with whether the device holds enough of it. */
const costChips = (mats = {}, cost = {}) => MATERIALS
  .filter(([key]) => cost[key] > 0)
  .map(([key, name]) => ({ key, name, n: cost[key], short: (mats[key] ?? 0) < cost[key] }));

/** What a button says when it is locked, in words: the offer's label is made for the old canvas, this is for a phone. */
function lockedText(offer) {
  const flat = offer.label.replace(/\n/g, ' ');
  if (/^REACH LEVEL/.test(flat)) return `Reach level ${flat.replace(/\D+/g, '')} in Endless`;
  if (/^NEEDS /.test(flat)) {
    const upper = flat.slice('NEEDS '.length);
    return `Needs ${KNOWN_NAMES.find((name) => name.toUpperCase() === upper) ?? upper.toLowerCase()}`;
  }
  if (/OFFLINE/.test(flat)) return 'Shop offline';
  if (/LOADING/.test(flat)) return 'Loading the shop…';
  return 'Not for sale';
}

/**
 * The button of a card, from what forgeOffer says. `tone`: gold (a G$ price), plain (equip, craft), on (what is worn), off
 * (locked, or a payment on its way). A button that is `short` of materials is not disabled: pressing it says what is missing.
 */
function buttonFor(offer) {
  const verb = offer.label.startsWith('FORGE') ? 'Forge' : 'Buy';
  const price = offer.priceG === undefined ? '' : `${verb} · ${formatG(offer.priceG, 2)} G$`;
  switch (offer.action) {
    case 'equip': return { text: 'Equip', tone: 'plain' };
    case 'none': return { text: 'Equipped', tone: 'on', tick: true };
    case 'toggle': return offer.label === 'PET ON' ? { text: 'Pet on', tone: 'on', tick: true } : { text: 'Pet off', tone: 'plain' };
    case 'craft': return { text: 'Craft', tone: 'plain' };
    case 'wait': return { text: 'Paying…', tone: 'off', busy: true };
    case 'locked': return { text: lockedText(offer), tone: 'off', lock: true };
    case 'short': return price ? { text: price, tone: 'gold', short: true } : { text: 'Craft', tone: 'plain', short: true };
    default: return { text: price, tone: 'gold' }; // buy, forge, wallet
  }
}

/**
 * One card. `item` is what forgeOffer reads (`cost`, and `chips`, the materials as the card lists them).
 * @returns {{ id: string, type: string, art: object, name: string, tag: string, stats: string, note: string|null, noteTone: string,
 *   cost: object[], state: string, offer: { action: string }, button: object, press: object }}
 */
function card({ type, art, name, tag, stats, note = null, noteTone = 'plain', item, status }) {
  const offer = forgeOffer(item, status);
  const sold = status.shop?.enabled ? status.shop.items.find((x) => x.id === item.id) : null;
  // Materials are what a piece costs where it is forged or crafted; one bought outright with G$ costs none. A piece the player
  // cannot buy yet shows its G$ price (a payable one has the price on its button).
  const materials = !sold || sold.kind === 'forge' ? item.chips : [];
  const price = sold && !item.unlocked && offer.priceG === undefined ? [{ key: 'coin', name: 'G$', n: formatG(sold.priceG, 2), g: true }] : [];
  return {
    id: item.id, type, art, name, tag, stats, note, noteTone,
    cost: item.unlocked ? [] : [...price, ...materials],
    state: item.equipped ? 'equipped' : item.unlocked ? 'owned' : '',
    offer: { action: offer.action },
    button: buttonFor(offer),
    // what a press of the button needs: the scene crafts, spends and equips from this
    press: { id: item.id, type, cost: item.cost, hasMaterials: item.hasMaterials },
  };
}

/** What forgeOffer reads for a blade, an armour piece or a look: owned and worn, the materials, the level asked for. */
const itemOf = (piece, ctx, { unlocked, equipped }) => ({
  id: piece.id, cost: piece.cost, unlocked, equipped, hasMaterials: hasMaterials(ctx.mats, piece.cost),
  minLevel: piece.minLevel, levelReached: ctx.bestLevel, chips: costChips(ctx.mats, piece.cost),
});

function bladeCard(weapon, ctx, status) {
  const item = itemOf(weapon, ctx, { unlocked: ctx.unlockedWeapons.includes(weapon.id), equipped: ctx.weaponId === weapon.id });
  return card({
    type: 'weapon', art: weaponArt(weapon), name: weapon.name, tag: weapon.tier.replace(/ \(Crafted\)/, ''),
    stats: `x${weapon.damageMul} damage · x${weapon.rangeMul} reach`, note: baneLine(weapon), noteTone: 'bane', item, status,
  });
}

function armourCard(piece, ctx, status) {
  const worn = piece.slot === 'helm' ? ctx.helmId : ctx.shieldId;
  const item = itemOf(piece, ctx, { unlocked: ctx.unlockedArmour.includes(piece.id), equipped: worn === piece.id });
  return card({
    type: 'armour', art: { ico: `${piece.slot}_${piece.realm}` }, name: piece.name, tag: piece.tier,
    stats: piece.slot === 'helm' ? 'Helm · against blows' : 'Shield · against what is thrown',
    note: armourEffect(piece), noteTone: 'armour', item, status,
  });
}

/** A look (a skin or a Celestial blade) is a blade that is owned and worn like any other, with no power of its own to add. */
function lookCard(weapon, ctx, status) {
  const item = itemOf(weapon, ctx, { unlocked: ctx.unlockedWeapons.includes(weapon.id), equipped: ctx.weaponId === weapon.id });
  return card({
    type: 'weapon', art: weaponArt(weapon), name: weapon.name, tag: weapon.isSkin ? 'Skin' : 'Celestial',
    stats: weapon.isSkin ? 'Look only · x1 damage' : `Look only · the Glaive's x${weapon.damageMul} damage`,
    note: weapon.cosmeticDescription, item, status,
  });
}

function petCard(ctx, status) {
  const cost = { bark: 8, amber: 6, iron: 0 };
  const item = {
    id: 'satchel_pet', cost, unlocked: ctx.petUnlocked, equipped: ctx.petOn, pet: true,
    hasMaterials: hasMaterials(ctx.mats, cost), chips: costChips(ctx.mats, cost),
  };
  return card({
    type: 'satchel', art: { img: PET_IMAGE }, name: 'Moon Sprite Satchel', tag: 'Companion',
    stats: 'Look only · a Moon Sprite by your shoulder', note: 'Sylva flies beside you through every run.', item, status,
  });
}

/** The relic re-roll is crafted from materials only, whatever the server sells. */
function rerollCard(ctx) {
  const cost = { bark: 2, amber: 2, iron: 0 };
  const perk = GAME_CONFIG.PERKS.find((p) => p.id === ctx.perkId) ?? GAME_CONFIG.PERKS[0];
  const enough = hasMaterials(ctx.mats, cost);
  return {
    id: 'relic_reroll', type: 'reroll', art: { ico: 'sparkle' }, name: 'Relic Re-roll', tag: 'Relic',
    stats: `Perk now: ${perk.name}`, note: `${perk.desc}. Re-roll to draw another.`, noteTone: 'plain',
    cost: costChips(ctx.mats, cost), state: '', offer: { action: enough ? 'craft' : 'short' },
    button: { text: 'Re-roll', tone: 'plain', ...(enough ? {} : { short: true }) },
    press: { id: 'relic_reroll', type: 'reroll', cost, hasMaterials: enough },
  };
}

function realmSection(tab, key, cards) {
  const span = realmSpan(key);
  const levels = span ? `Levels ${span.from} to ${span.to}` : '';
  return { key, icon: `realm_${key}`, title: REALMS[key].name, sub: tab === 'blades' ? `${levels} · home of ${beastsList(key)}` : levels, cards };
}

/** The notice at the top of the list: why a button asks for the wallet, or why nothing can be bought. Null when there is nothing to say. */
export function noticeFor(status) {
  const { shop } = status;
  if (!shop) return status.offline ? { text: "Can't reach the server, so prices are unavailable right now.", tone: 'warn' } : { text: 'Loading the shop…', tone: 'plain' };
  if (!shop.enabled) return { text: 'No shop is open on this server: gear is forged from forest materials alone.', tone: 'plain' };
  if (!status.connected) return { text: 'Connect a wallet to buy with G$. Tap here.', tone: 'plain', act: 'wallet' };
  if (!status.verified) return { text: 'Verify you are human to buy with G$. Tap here.', tone: 'warn', act: 'wallet' };
  return null;
}

/**
 * @param {{
 *   tab: 'blades'|'armour'|'looks',
 *   status: object,                      gdService.getStatus()
 *   mats: { bark: number, amber: number, iron: number },
 *   weaponId: string, helmId: string|null, shieldId: string|null,
 *   unlockedWeapons: string[], unlockedArmour: string[],
 *   petUnlocked: boolean, petOn: boolean, perkId: string, bestLevel: number,
 * }} ctx
 */
export function shopModel(ctx) {
  const tab = TABS.some((t) => t.key === ctx.tab) ? ctx.tab : 'blades';
  const { status } = ctx;
  const weapon = Object.values(W).find((w) => w.id === ctx.weaponId) ?? W.STARTER;
  const helm = armourById(ctx.helmId);
  const shield = armourById(ctx.shieldId);

  let sections;
  if (tab === 'blades') {
    // the three blades of the woods, then the blade of each realm after it
    const blades = [W.STARTER, W.IRON_BROADSWORD, W.FOREST_GLAIVE, ...BLADE_TIERS];
    sections = REALM_ORDER
      .map((key) => realmSection(tab, key, blades.filter((b) => (b.bane?.realm ?? 'woods') === key).map((b) => bladeCard(b, ctx, status))))
      .filter((s) => s.cards.length > 0);
  } else if (tab === 'armour') {
    sections = REALM_ORDER
      .map((key) => realmSection(tab, key, ARMOUR.filter((p) => p.realm === key).map((p) => armourCard(p, ctx, status))))
      .filter((s) => s.cards.length > 0);
    sections.push({ key: 'relic', icon: 'sparkle', title: 'Relic', sub: 'The charm you carry: its perk helps in every run', cards: [rerollCard(ctx)] });
  } else {
    sections = [
      { key: 'skins', icon: 'sparkle', title: 'Sword skins', sub: 'Looks only: while one is worn your damage is x1', cards: [W.SKIN_FLAME, W.SKIN_FROST, W.SKIN_VERDANT].map((w) => lookCard(w, ctx, status)) },
      { key: 'celestial', icon: 'sparkle', title: 'Celestial blades', sub: "The Glaive's power in a new look: they need the Glaive first", cards: [W.GOLDEN_ALBATROSS, W.CORRUPTED_VOID].map((w) => lookCard(w, ctx, status)) },
      { key: 'companion', icon: 'sparkle', title: 'Companion', sub: 'Someone to fly beside you', cards: [petCard(ctx, status)] },
    ];
  }

  return {
    tab,
    tabs: TABS,
    note: NOTES[tab],
    balance: status.balance == null ? null : walletG(status.balance),
    mats: MATERIALS.map(([key, name]) => ({ key, name, n: ctx.mats?.[key] ?? 0 })),
    notice: noticeFor(status),
    kit: {
      blade: { name: weapon.name, art: weaponArt(weapon) },
      helm: helm && { name: helm.name, art: { ico: `helm_${helm.realm}` } },
      shield: shield && { name: shield.name, art: { ico: `shield_${shield.realm}` } },
      summary: kitSummary({ weapon, helm, shield }),
    },
    sections,
  };
}

/* ---- markup ---- */

const artHtml = (a, px) => (a.img
  ? `<img class="sh-img" src="${esc(a.img)}" width="${px}" height="${px}" alt="" draggable="false">`
  : icoUse(a.ico, px));

const chipHtml = (c) => `<li class="sh-cost${c.short ? ' lack' : ''}${c.g ? ' g' : ''}" title="${esc(c.name)}">${icoUse(c.key, 22)}<b>${esc(c.n)}</b><small>${esc(c.name)}</small></li>`;

function buttonHtml(c) {
  const b = c.button;
  const cls = b.tone === 'gold' ? 'gold btn' : b.tone === 'plain' ? 'btn-2' : '';
  const icon = b.tick ? icoUse('tick', 20) : b.lock ? icoUse('lock', 18) : '';
  const spin = b.busy ? '<span class="spin" aria-hidden="true"><i></i><i></i><i></i></span>' : '';
  const off = b.tone === 'off' || c.offer.action === 'none';
  return `<button type="button" class="sh-btn ${cls} ${b.tone}${b.short ? ' short' : ''}" data-act="offer" data-id="${esc(c.id)}" data-action="${esc(c.offer.action)}"${off ? ' disabled' : ''}>${icon}${spin}<span>${esc(b.text)}</span></button>`;
}

function cardHtml(c) {
  const note = c.note ? `<p class="sh-cn ${esc(c.noteTone)}">${esc(c.note)}</p>` : '';
  const cost = c.cost.length ? `<ul class="sh-costs" aria-label="Costs">${c.cost.map(chipHtml).join('')}</ul>` : '';
  const cls = [c.state, c.button.lock ? 'locked' : ''].filter(Boolean).join(' ');
  return `<li class="sh-card${cls ? ` ${cls}` : ''}" data-id="${esc(c.id)}">
      <div class="sh-art">${artHtml(c.art, 44)}</div>
      <div class="sh-ct"><h3>${esc(c.name)}</h3><span class="sh-tag">${esc(c.tag)}</span><p class="sh-cs">${esc(c.stats)}</p></div>
      ${note}${cost}${buttonHtml(c)}
    </li>`;
}

const sectionHtml = (s) => `<section class="sh-sec" data-sec="${esc(s.key)}">
    <h2 class="sh-sec-h">${icoUse(s.icon, 22)}<span>${esc(s.title)}</span></h2>
    ${s.sub ? `<p class="sh-sec-sub">${esc(s.sub)}</p>` : ''}
    <ul class="sh-cards">${s.cards.map(cardHtml).join('')}</ul>
  </section>`;

function kitHtml(k) {
  const slot = (piece, ghost, value, bare) => `<li>${piece ? artHtml(piece.art, 30) : `<span class="sh-ghost">${icoUse(ghost, 30)}</span>`}<span class="sh-sl"><b>${esc(piece ? piece.name : bare)}</b><small>${esc(value)}</small></span></li>`;
  return `<section class="sh-kit" aria-label="What you carry">
      <div class="sh-hero" aria-hidden="true"></div>
      <ul class="sh-slots">
        ${slot(k.blade, 'sword_clean', `${k.summary.damage} damage`)}
        ${slot(k.helm, 'helm_woods', k.helm ? `${k.summary.contact} from blows` : 'bare-headed', 'No helm')}
        ${slot(k.shield, 'shield_woods', k.shield ? `${k.summary.ranged} from what is thrown` : 'unshielded', 'No shield')}
      </ul>
    </section>`;
}

function noticeHtml(n) {
  const text = esc(n.text);
  return n.act
    ? `<button type="button" class="sh-notice ${esc(n.tone)}" data-act="${esc(n.act)}">${text}</button>`
    : `<p class="sh-notice ${esc(n.tone)}" role="status">${text}</p>`;
}

/** The markup of the whole screen (inside its root). */
export function shopHtml(m) {
  const tab = (t) => `<button type="button" role="tab" class="sh-tab${m.tab === t.key ? ' on' : ''}" aria-selected="${m.tab === t.key}" data-act="tab" data-tab="${t.key}">${esc(t.label)}</button>`;
  return `<header class="sh-head">
      <h1 class="sh-title">Shop</h1>
      <ul class="sh-mats" aria-label="Your forest materials">${m.mats.map((x) => `<li title="${esc(x.name)}" aria-label="${esc(x.n)} ${esc(x.name)}">${icoUse(x.key, 22)}<b>${esc(x.n)}</b></li>`).join('')}</ul>
      ${m.balance === null ? '' : `<div class="sh-purse" title="Your G$">${icoUse('coin', 24)}<b>${esc(m.balance)}</b><small>G$</small></div>`}
      <div class="sh-tabs" role="tablist" aria-label="What to browse">${m.tabs.map(tab).join('')}</div>
    </header>
    <div class="sh-scroll">
      ${m.notice ? noticeHtml(m.notice) : ''}
      ${kitHtml(m.kit)}
      ${m.sections.map(sectionHtml).join('')}
      <p class="sh-note">${esc(m.note)}</p>
    </div>
    <footer class="sh-foot">
      <div class="sh-bar"><button type="button" class="btn-2" data-act="menu">Menu</button><button type="button" class="gold btn" data-act="endless">Play Endless</button></div>
    </footer>`;
}

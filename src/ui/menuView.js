import { ico, moonSvg } from './icons.js';
import { openSheet, escapeHtml } from './sheet.js';

/*
 * The main menu, drawn as page elements over the whole screen (not inside the game canvas): a moonlit forest with the
 * moon and the title, one big gold button, and three tiles. Everything a thumb needs sits at the bottom. The game
 * canvas stays behind it, idle. The scene that owns the menu (MenuScene) gives this view its data and its actions.
 */

const MOON = moonSvg(false);

const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

function stars() {
  const rnd = seeded(7);
  let r = '';
  for (let i = 0; i < 40; i++) {
    const big = rnd() > 0.8;
    r += `<i class="star${big ? ' b' : ''}" style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 50).toFixed(1)}%"></i>`;
  }
  return r;
}

function fireflies() {
  const rnd = seeded(23);
  let r = '';
  for (let i = 0; i < 11; i++) {
    r += `<i class="fly" style="left:${(6 + rnd() * 88).toFixed(1)}%;top:${(38 + rnd() * 52).toFixed(1)}%;--x:${(rnd() * 44 - 22).toFixed(0)}px;--y:${(rnd() * 34 - 17).toFixed(0)}px;--t:${(5 + rnd() * 6).toFixed(1)}s;--b:${(2 + rnd() * 3).toFixed(1)}s"></i>`;
  }
  return r;
}

/** The moonlit forest. The sprite is the player's own hero; Sylva hovers beside the hero only if the player owns her. */
function worldHtml({ companion }) {
  return `<div class="world night-w"><div class="sky night">${stars()}</div>
  <div class="back"><div class="haze"></div>
    <div class="layer l-mtn"></div><div class="layer l-p0"></div><div class="layer l-p0 off"></div><div class="layer l-p1"></div>
    <i class="shaft" style="left:36%"></i><i class="shaft s2" style="left:56%"></i>
    <img class="pine" style="left:-3%" src="/assets/env/n_pine_dark.png" alt=""><img class="pine" style="right:-5%" src="/assets/env/n_pine_green.png" alt="">
    ${fireflies()}<div class="fog"></div></div>
  <div class="actors"><div class="actor hero" style="--hx:20"></div>${companion ? '<div class="actor fairy" style="--hx:20"></div>' : ''}<div class="actor boar"></div></div>
  <div class="ground"></div><div class="vig"></div></div>`;
}

const chipInner = (chip) => `${ico('coin', 26, 'coin')}<span>${escapeHtml(chip.text)}</span>${chip.verified ? `<span class="tick">${ico('check', 16)}</span>` : ''}${chip.claimReady ? '<i class="ping" title="Daily G$ ready"></i>' : ''}`;
const chipClass = (chip) => `chip${chip.dim ? ' dim' : ''}`;

function menuHtml({ chip, play, showChapters }, enter) {
  return `<div class="menu ui${enter ? ' enter' : ''}" style="position:absolute;inset:0">
    <header class="topbar"><button class="${chipClass(chip)}" data-act="wallet" type="button" aria-label="Wallet: ${escapeHtml(chip.text)}">${chipInner(chip)}</button>
      <button class="icon-btn" data-act="settings" type="button" aria-label="Settings">${ico('gear', 26)}</button></header>
    <div class="brand"><div class="moonwrap">${MOON}<span class="shard s1">${ico('shard', 16)}</span><span class="shard s2">${ico('shard', 11)}</span><span class="shard s3">${ico('shard', 9)}</span></div>
      <h1 class="logo">MOONSHARD</h1><p class="tag">The High Forest</p></div>
    <div class="dock">
      <button class="btn-main gold" data-act="play" type="button">${ico('play', 26)}<span class="bm-txt"><b>${escapeHtml(play.title)}</b><small>${escapeHtml(play.sub)}</small></span></button>
      <button class="lnk chapters" data-act="chapters" type="button"${showChapters ? '' : ' hidden'}>All chapters</button>
      <div class="tiles">
        <button class="tile" data-act="endless" type="button"><span class="ti">${ico('loop', 34)}</span>Endless</button>
        <button class="tile" data-act="forge" type="button"><span class="ti">${ico('anvil', 34)}</span>Forge</button>
        <button class="tile" data-act="ranks" type="button"><span class="ti">${ico('trophy', 34)}</span>Ranks</button>
      </div></div></div>`;
}

const sw = (act, on, label) => `<button class="sw" role="switch" type="button" aria-checked="${on}" aria-label="${label}" data-act="${act}"><i></i></button>`;

function settingsBody({ soundOn, musicOn }) {
  return `<div class="rows">
    <div class="row"><span class="r-ico${soundOn ? '' : ' off'}">${ico(soundOn ? 'spk_on' : 'spk_off', 26)}</span><b>Sound effects</b>${sw('sound', soundOn, 'Sound effects')}</div>
    <div class="row"><span class="r-ico${musicOn ? '' : ' off'}">${ico(musicOn ? 'note_on' : 'note_off', 24)}</span><b>Music</b>${sw('music', musicOn, 'Music')}</div>
    <button class="row" data-act="replay" type="button"><b>Replay tutorial</b>${ico('chev', 16, 'rot')}</button>
    <a class="row" href="/stats.html" target="_blank" rel="noopener"><b>Public stats</b>${ico('chev', 16, 'rot')}</a></div>`;
}

function chaptersBody(rows) {
  return `<div class="rows">${rows.map((r) => (r.open
    ? `<button class="row" type="button" data-act="chapter" data-n="${r.n}"><span class="t"><b>${r.n === 0 ? 'Prologue' : `Chapter ${r.n}`}: ${escapeHtml(r.name)}</b><small>${escapeHtml(r.note)}</small></span>${ico('chev', 16, 'rot')}</button>`
    : `<div class="row locked" aria-disabled="true"><span class="t"><b>Chapter ${r.n}: ${escapeHtml(r.name)}</b><small>${escapeHtml(r.note)}</small></span>${ico('lock', 20)}</div>`)).join('')}</div>`;
}

/**
 * @param {{world: HTMLElement, ui: HTMLElement, sheets: HTMLElement, stage: HTMLElement}} host the elements inside #ms-ui
 * @param {{play(): void, endless(): void, forge(): void, ranks(): void, wallet(): void, chapters(): void, chapter(n: number): void, replay(): void}} actions
 * @param {{soundOn(): boolean, musicOn(): boolean, toggleSound(): void, toggleMusic(): void}} audio
 * @param {{companion?: boolean}} [options]
 */
export function createMenu(host, actions, audio, { companion = false } = {}) {
  let sheet = null;
  const fade = document.createElement('div');
  fade.id = 'fade';
  host.stage.appendChild(fade);

  host.world.innerHTML = worldHtml({ companion });
  let model = null;

  const drawSettings = () => sheet?.setBody(settingsBody({ soundOn: audio.soundOn(), musicOn: audio.musicOn() }));

  host.ui.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'settings') api.openSettings();
    else actions[act]?.();
  };

  const api = {
    /** Draw (the first time, with the entrance) or refresh the parts that follow the player. */
    update(next) {
      const first = !model;
      model = next;
      if (first) { host.ui.innerHTML = menuHtml(next, true); return; }
      const chipEl = host.ui.querySelector('.chip');
      chipEl.className = chipClass(next.chip);
      chipEl.innerHTML = chipInner(next.chip);
      chipEl.setAttribute('aria-label', `Wallet: ${next.chip.text}`);
      const btn = host.ui.querySelector('.btn-main');
      btn.querySelector('b').textContent = next.play.title;
      btn.querySelector('small').textContent = next.play.sub;
      host.ui.querySelector('.chapters').hidden = !next.showChapters;
    },
    openSettings() {
      sheet = openSheet(host.sheets, {
        title: 'Settings', name: 'settings',
        body: settingsBody({ soundOn: audio.soundOn(), musicOn: audio.musicOn() }),
        onAction: (act) => {
          if (act === 'sound') { audio.toggleSound(); drawSettings(); }
          else if (act === 'music') { audio.toggleMusic(); drawSettings(); }
          else if (act === 'replay') { sheet.close(); actions.replay(); }
        },
      });
    },
    openChapters(rows) {
      sheet = openSheet(host.sheets, {
        title: 'Chapters', name: 'chapters', body: chaptersBody(rows),
        onAction: (act, el) => { if (act === 'chapter') { const n = Number(el.dataset.n); sheet.close(); actions.chapter(n); } },
      });
    },
    closeSheet() { sheet?.close(); },
    /** Fade to the screen's dark, so the next scene starts from black. Resolves when it is dark. */
    fadeOut(ms = 200) {
      fade.classList.add('on');
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    destroy() {
      sheet?.close();
      host.ui.onclick = null;
      host.ui.innerHTML = '';
      host.world.innerHTML = '';
      host.sheets.innerHTML = '';
      fade.remove();
    },
  };
  return api;
}

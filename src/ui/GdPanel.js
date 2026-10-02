import { gdService } from '../engine/GdService.js';
import { describeOutcome } from '../gd/outcome.js';
import { showToast } from './toast.js';
import { renderGuideHtml, renderPanelHtml } from './gdPanelView.js';
import { rememberGate } from '../engine/gateMemory.js';
import { fetchConfig } from '../gd/leaderboard.js';

export class GdPanel {
  constructor() {
    this.el = null;
    this.gate = null; // { label, launch } while the verified-human gate is showing
    this.guide = false; // true while the G$ guide is showing
    this.config = null; // /api/config, for the amounts the guide names
  }

  mount() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.id = 'gd-panel';
    this.el.className = 'modal-overlay hidden';
    this.el.innerHTML = `
      <div class="modal-card gd-card" role="dialog" aria-modal="true" aria-label="G$ wallet">
        <div class="modal-header">
          <h3 id="gd-title">G$ WALLET</h3>
          <button id="gd-close" class="pixel-close-btn" type="button" aria-label="Close">✖</button>
        </div>
        <div id="gd-body" class="modal-body gd-body"></div>
      </div>`;
    document.body.appendChild(this.el);
    // Phaser also listens for pointer and keyboard events on `window`, so a click or a key press on this panel would
    // otherwise fall through to whatever game button sits behind it (e.g. "Connect" landing on the Menu's Leaderboard
    // entry, or Space on a focused panel button advancing a game dialogue).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown', 'keyup']) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }
    this.el.querySelector('#gd-close').addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('click', (e) => this.onClick(e));
    gdService.subscribe(() => this.render());
  }

  /** The verified-human gate: the player asked to start `label`; `launch()` carries it out once they may play. */
  openGate(request) {
    this.gate = request;
    this.open();
  }

  /** The G$ guide: what G$ does in Moonshard, and this player's next step. */
  openGuide() {
    this.gate = null;
    this.open({ guide: true });
    if (!this.config) {
      fetchConfig().then((config) => { this.config = config; this.render(); }).catch(() => { /* the guide says less */ });
    }
  }

  open({ guide = false } = {}) {
    this.guide = guide;
    this.mount();
    this.el.classList.remove('hidden');
    this.render();
    gdService.refreshAll().catch(() => {});
  }

  close() {
    this.gate = null;
    this.guide = false;
    this.el?.classList.add('hidden');
    // The button that was clicked is hidden now but would keep the keyboard until the browser notices, and this panel
    // swallows key presses meant for itself: give the keyboard back to the game at once.
    if (this.el?.contains(document.activeElement)) document.activeElement.blur();
  }

  render() {
    if (!this.el) return;
    const status = gdService.getStatus();
    this.el.querySelector('#gd-title').textContent = this.guide ? 'G$ IN MOONSHARD' : 'G$ WALLET';
    this.el.querySelector('#gd-body').innerHTML = this.guide
      ? renderGuideHtml(status, { config: this.config, now: Date.now() })
      : renderPanelHtml(status, Date.now(), { gate: this.gate ? { label: this.gate.label } : null });
  }

  async onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'play') {
      const request = this.gate;
      this.close();
      request?.launch();
      return;
    }
    // the face scan leaves the page: remember what the player asked to play so they can pick it up on return
    if (act === 'verify' && this.gate?.key) rememberGate(globalThis.sessionStorage, this.gate);
    const actions = {
      connect: () => gdService.connect(el.dataset.id), // the wallet picked, when several are installed
      reconnect: () => gdService.connect(),
      disconnect: async () => { gdService.disconnect(); return { ok: true }; },
      switch: () => gdService.switchToCelo(),
      verify: () => gdService.verifyHuman(),
      recheck: () => gdService.recheck(),
      ubi: () => gdService.claimUbi(),
      bounty: () => gdService.claimBounty(),
      redeem: () => gdService.redeem(el.dataset.id),
      buy: () => gdService.buy(el.dataset.id),
    };
    const res = await actions[act]?.();
    if (!res) return;
    const toast = describeOutcome(act, res, { blessing: gdService.getStatus().blessing });
    if (toast) showToast(toast.text, { type: toast.type });
  }
}

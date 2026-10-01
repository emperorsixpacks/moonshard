import { gdService } from '../engine/GdService.js';
import { describeOutcome } from '../gd/outcome.js';
import { showToast } from './toast.js';
import { renderPanelHtml } from './gdPanelView.js';

export class GdPanel {
  constructor() {
    this.el = null;
  }

  mount() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.id = 'gd-panel';
    this.el.className = 'modal-overlay hidden';
    this.el.innerHTML = `
      <div class="modal-card gd-card" role="dialog" aria-modal="true" aria-label="G$ wallet">
        <div class="modal-header">
          <h3>G$ WALLET</h3>
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

  open() {
    this.mount();
    this.el.classList.remove('hidden');
    this.render();
    gdService.refreshAll().catch(() => {});
  }

  close() {
    this.el?.classList.add('hidden');
  }

  render() {
    if (!this.el) return;
    this.el.querySelector('#gd-body').innerHTML = renderPanelHtml(gdService.getStatus());
  }

  async onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    const actions = {
      connect: () => gdService.connect(),
      reconnect: () => gdService.connect(),
      disconnect: async () => { gdService.disconnect(); return { ok: true }; },
      switch: () => gdService.switchToCelo(),
      verify: () => gdService.verifyHuman(),
      recheck: () => gdService.recheck(),
      ubi: () => gdService.claimUbi(),
      bounty: () => gdService.claimBounty(),
      redeem: () => gdService.redeem(el.dataset.id),
    };
    const res = await actions[act]?.();
    if (!res) return;
    const toast = describeOutcome(act, res, { blessing: gdService.getStatus().blessing });
    if (toast) showToast(toast.text, { type: toast.type });
  }
}

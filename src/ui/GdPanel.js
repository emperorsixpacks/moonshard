import { gdService } from '../engine/GdService.js';
import { describeOutcome } from '../gd/outcome.js';
import { showToast } from './toast.js';
import { panelTitle, renderPanelHtml } from './gdPanelView.js';
import { openSheet } from './sheet.js';
import { rememberGate } from '../engine/gateMemory.js';
import { fetchConfig } from '../gd/leaderboard.js';

/**
 * The wallet and the way into the game, drawn as one sheet over the screen (src/ui/sheet.js). What it says is decided by
 * gdPanelView.js from the wallet service's status; this class opens and closes it, keeps it fresh and carries out taps.
 */
export class GdPanel {
  constructor() {
    this.host = null;
    this.sheet = null;
    this.gate = null; // { label, launch } while the verified-human gate is showing
    this.config = null; // /api/config, for the amounts "How G$ works" names
    this.howOpen = false;
    this.unsubscribe = null;
  }

  mount() {
    if (this.unsubscribe) return;
    this.host = document.getElementById('ms-sheets');
    // Phaser also listens for pointer and keyboard events on `window`, so a click or a key press on a sheet would otherwise
    // fall through to whatever game button sits behind it (e.g. "Connect" landing on a menu tile, or Space on a focused
    // button advancing a game dialogue).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown', 'keyup']) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    this.unsubscribe = gdService.subscribe(() => this.render());
  }

  /** The verified-human gate: the player asked to start `label`; `launch()` carries it out once they may play. */
  openGate(request) {
    this.gate = request;
    this.open();
  }

  open() {
    this.mount();
    const status = gdService.getStatus();
    this.sheet = openSheet(this.host, {
      title: panelTitle(status, { gate: this.gate }),
      name: this.gate ? 'gate' : 'wallet',
      body: renderPanelHtml(status, Date.now(), this.view()),
      onClose: () => {
        this.gate = null;
        this.sheet = null;
        // The button that was clicked is gone now but would keep the keyboard until the browser notices, and this sheet
        // swallows key presses meant for itself: give the keyboard back to the game at once.
        if (this.host.contains(document.activeElement)) document.activeElement.blur();
      },
      onAction: (act, el) => this.onAction(act, el),
    });
    this.sheet.el.addEventListener('toggle', (e) => {
      if (e.target.classList?.contains('how')) this.howOpen = e.target.open;
    }, true);
    gdService.refreshAll().catch(() => {});
    if (!this.config) {
      fetchConfig().then((config) => { this.config = config; this.render(); }).catch(() => { /* the amounts say less */ });
    }
  }

  close() {
    this.sheet?.close();
  }

  view() {
    return { gate: this.gate ? { label: this.gate.label } : null, config: this.config, howOpen: this.howOpen };
  }

  render() {
    if (!this.sheet?.isOpen()) return;
    const status = gdService.getStatus();
    this.sheet.setTitle(panelTitle(status, { gate: this.gate }));
    this.sheet.setBody(renderPanelHtml(status, Date.now(), this.view()));
  }

  async onAction(act, el) {
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

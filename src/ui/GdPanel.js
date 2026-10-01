import { gdService } from '../engine/GdService.js';
import { explorerTx } from '../gd/config.js';
import { formatCountdown, formatG } from '../gd/format.js';
import { identiconSvg } from '../gd/identicon.js';
import { showToast } from './toast.js';

const LABELS = {
  anonymous: 'NOT CONNECTED',
  unverified: 'NOT VERIFIED',
  verified: 'VERIFIED HUMAN',
  expired: 'VERIFICATION EXPIRED',
};

const DONE = {
  connect: '⚡ Wallet connected',
  reconnect: '⚡ Wallet reconnected',
  ubi: "💚 G$ claimed — Citizen's Blessing active!",
  bounty: '🌟 Bounty claimed!',
  redeem: '🏆 Spoils redeemed!',
};

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const button = (act, label, { disabled = false, id = '', cls = '' } = {}) =>
  `<button type="button" class="pixel-modal-btn gd-btn ${cls.includes('gd-ghost') ? '' : 'btn-resume'} ${cls}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;

const section = (title, inner) => `<section class="gd-sec"><h4>${title}</h4>${inner}</section>`;

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
    // Phaser also listens for pointer events on `window`, so a click on this panel would otherwise fall through
    // to whatever game button sits behind it (e.g. "Connect" landing on the Menu's Leaderboard entry).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
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
    const s = gdService.getStatus();
    const busy = Boolean(s.busy);
    const txDisabled = busy || s.wrongChain || s.needsReconnect;
    const status = Object.hasOwn(LABELS, s.status) ? s.status : 'anonymous'; // never interpolate server text into markup
    const out = [];

    out.push(`<div class="gd-status gd-st-${status}">
      ${s.connected ? `<span class="gd-avatar">${identiconSvg(s.address)}</span>` : '<span class="gd-dot"></span>'}
      <div class="gd-status-text"><b>${LABELS[status]}</b>${
        s.connected ? `<small>${esc(s.shortAddress)}${s.host !== 'browser' ? ` • ${esc(s.host.toUpperCase())}` : ''}</small>` : ''
      }</div></div>`);

    if (busy) out.push('<p class="gd-muted">Working… confirm in your wallet if asked.</p>');

    if (!s.connected) {
      out.push('<p class="gd-muted">You can play everything without a wallet. Connect a Celo wallet to join the ranked board, claim your daily G$ and earn Spoils.</p>');
      out.push(button('connect', 'CONNECT WALLET', { disabled: busy }));
      if (!s.hasWallet) {
        out.push('<p class="gd-warn">No wallet detected. Open Moonshard inside <b>MiniPay</b> or a Celo-compatible wallet browser.</p>');
      }
    } else {
      if (s.offline) out.push('<p class="gd-warn">Server unreachable. You can still play; rewards resume when it is back.</p>');
      if (s.needsReconnect) {
        out.push('<p class="gd-warn">Reconnect your wallet to claim rewards.</p>');
        out.push(button('reconnect', 'RECONNECT WALLET', { disabled: busy }));
      }
      if (s.wrongChain) {
        out.push('<p class="gd-warn">Your wallet is not on the Celo network.</p>');
        out.push(button('switch', 'SWITCH TO CELO', { disabled: busy }));
      }

      if (status !== 'verified') {
        const copy = status === 'expired'
          ? 'Your GoodDollar verification has expired. Re-verify to keep earning.'
          : "Moonshard rewards one human, one slot. GoodDollar's quick face scan proves you are a real person. Moonshard never sees your face.";
        out.push(section("PROVE YOU'RE HUMAN", `<p>${copy}</p>${button('verify', 'VERIFY (FACE SCAN)', { disabled: txDisabled })}${button('recheck', "I'M DONE — CHECK AGAIN", { disabled: busy, cls: 'gd-ghost' })}`));
      } else {
        out.push(section('DAILY G$', this.dailyHtml(s, txDisabled)));
        out.push(section('FIRST-BOSS BOUNTY', this.bountyHtml(s, txDisabled)));
        out.push(section('SPOILS', this.spoilsHtml(s, txDisabled)));
      }
      out.push(button('disconnect', 'DISCONNECT', { disabled: busy, cls: 'gd-ghost' }));
    }

    out.push('<a class="gd-link" href="/stats.html" target="_blank" rel="noopener">PUBLIC STATS ▸</a>');
    this.el.querySelector('#gd-body').innerHTML = out.join('');
  }

  dailyHtml(s, txDisabled) {
    const ubi = s.ubi;
    let html;
    if (!ubi) html = '<p class="gd-muted">UBI status unavailable right now.</p>';
    else if (ubi.canClaim) html = `<p>Your daily G$ is ready: <b>${formatG(ubi.entitlementG, 2)} G$</b></p>${button('ubi', 'CLAIM DAILY G$', { disabled: txDisabled })}`;
    else html = `<p>Claimed today. Next claim in <b>${formatCountdown((ubi.nextClaimAt || 0) - Date.now())}</b></p>`;
    html += s.blessing
      ? "<p class=\"gd-blessing\">✨ CITIZEN'S BLESSING ACTIVE — +25% Forge materials today</p>"
      : "<p class=\"gd-muted\">Claim your daily G$ to receive the Citizen's Blessing (+25% Forge materials).</p>";
    const c = s.rewards?.crystalStatus;
    if (c) html += `<p class="gd-muted">Shards today: ${formatG(c.gdEarned)} / ${formatG(c.dailyCapGd)} G$ (paid after UTC midnight)</p>`;
    return html;
  }

  bountyHtml(s, txDisabled) {
    const b = s.bounty;
    if (!b || !b.configured) return '<p class="gd-muted">Boss bounty is coming soon.</p>';
    if (b.claimedHere) return '<p class="gd-blessing">✔ First-boss bounty claimed.</p>';
    if (b.pendingRunId) {
      if (b.canClaim === false) return `<p class="gd-warn">${esc(b.reason || 'Not claimable right now.')}</p>`;
      return `<p>Boss defeated! Claim your one-time reward.</p>${button('bounty', `CLAIM ${formatG(b.rewardG)} G$ BOUNTY`, { disabled: txDisabled })}`;
    }
    return `<p class="gd-muted">Defeat a chapter boss in Story Mode to unlock a one-time bounty of ${formatG(b.rewardG)} G$.</p>`;
  }

  spoilsHtml(s, txDisabled) {
    if (!s.spoils.length) {
      return '<p class="gd-muted">No Spoils yet. Reach the top 3 of the verified daily board or collect Shards. Settled after UTC midnight.</p>';
    }
    return s.spoils.map((sp) => {
      const label = sp.kind === 'TRIAL_PRIZE' ? `DAILY PRIZE #${Number(sp.rank) || '-'}` : 'SHARD HARVEST';
      let action;
      if (sp.claimed) action = '<span class="gd-blessing">✔ CLAIMED</span>';
      else if (sp.voucher) action = button('redeem', 'REDEEM', { id: sp.id, disabled: txDisabled });
      else action = '<span class="gd-muted">unavailable</span>';
      return `<div class="gd-spoil"><span>${label}<small>${esc(sp.day)} • ${formatG(sp.amountG)} G$</small></span>${action}</div>`;
    }).join('');
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
      recheck: async () => { await gdService.refreshAll({ force: true }); return { ok: true }; },
      ubi: () => gdService.claimUbi(),
      bounty: () => gdService.claimBounty(),
      redeem: () => gdService.redeem(el.dataset.id),
    };
    const res = await actions[act]?.();
    if (!res) return;
    if (!res.ok) {
      showToast(res.message || 'Something went wrong.', { type: 'error' });
      return;
    }
    if (act === 'ubi' && res.confirmPending) {
      showToast('💚 G$ claimed! Your blessing applies as soon as the server confirms (retrying automatically).');
    } else if (DONE[act]) {
      showToast(res.hash ? `${DONE[act]}  ${explorerTx(res.hash).replace('https://', '')}` : DONE[act]);
    }
  }
}

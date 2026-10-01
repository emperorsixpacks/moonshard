import { nimiqService } from '../engine/NimiqService.js';
import { getHostLanguage, defaultWalletLanguage } from '../nimiq/host.js';

/**
 * Connect-first gate. Blocks access to the game until the player connects a
 * Nimiq wallet (primary) or explicitly continues offline (secondary).
 */
export class ConnectGate {
  constructor() {
    this.el = null;
    this.language = defaultWalletLanguage(getHostLanguage());
  }

  /**
   * Show the gate; resolves with `{ connected, address? }` once the player
   * proceeds. Never resolves while the player is still on the gate.
   */
  show({ allowSkip = true } = {}) {
    return new Promise((resolve) => {
      this.destroy();
      this.el = document.createElement('div');
      this.el.id = 'connect-gate';
      this.el.className = 'connect-gate';
      this.el.innerHTML = `
        <div class="gate-card">
          <div class="gate-brand-row">
            <span class="gate-icon-tree">🌲</span>
            <h1 class="gate-title">MOONSHARD</h1>
          </div>
          <div class="gate-subtitle">THE HIGH FOREST</div>

          <div class="gate-body">
            <div class="gate-identicon-slot">
              <span class="gate-identicon-emoji">⚡</span>
            </div>
            <p class="gate-intro">Sign in with your Nimiq wallet to enter the realm.<br/>Your scores are signed by your wallet and verified on-chain.</p>

            <button id="gate-connect-btn" class="gate-connect-btn" type="button">
              <span class="gate-btn-bolt">⚡</span> CONNECT WALLET
            </button>

            <div id="gate-status" class="gate-status hidden"></div>

            <button id="gate-guest-btn" class="gate-guest-btn ${allowSkip ? '' : 'hidden'}" type="button">
              Continue Offline — scores unverified
            </button>
            <div class="gate-footnote">NIMIQ PAY • TESTNET</div>
          </div>
        </div>
      `;
      document.body.appendChild(this.el);

      const btn = this.el.querySelector('#gate-connect-btn');
      const statusEl = this.el.querySelector('#gate-status');
      const guestBtn = this.el.querySelector('#gate-guest-btn');

      const showStatus = (text, kind = 'info') => {
        statusEl.textContent = text;
        statusEl.className = `gate-status ${kind}`;
      };

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'WAITING FOR WALLET…';
        showStatus(this.language === 'de' ? 'Wallet wird geöffnet…' : 'Opening wallet…', 'info');
        const res = await nimiqService.connect();
        if (res.success) {
          showStatus(`✔ ${res.address}`, 'ok');
          btn.textContent = 'ENTERING REALM…';
          setTimeout(() => finish({ connected: true, address: res.address }), 650);
        } else {
          btn.disabled = false;
          btn.textContent = 'CONNECT WALLET';
          if (res.offline) {
            showStatus('Moonshard API unreachable — connect is unavailable right now.', 'error');
            guestBtn.classList.remove('hidden');
          } else if (res.cancelled) {
            showStatus('Sign-in cancelled.', 'warn');
          } else {
            showStatus(`Could not sign in — ${res.error || 'unknown error'}`, 'error');
            guestBtn.classList.remove('hidden');
          }
        }
      });

      guestBtn.addEventListener('click', () => finish({ connected: false }));

      const finish = (result) => {
        this.el.querySelector('.gate-card').classList.add('gate-card-leave');
        setTimeout(() => {
          this.destroy();
          resolve(result);
        }, 260);
      };
    });
  }

  destroy() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
import { emailLogin } from '../gd/magic.js';
import { openSheet } from './sheet.js';
import { codeProblem, emailProblem, emailSheetHtml, emailTitle } from './emailView.js';

/**
 * The sign-in-with-email sheet: email, then the code Magic sends, then the wallet is connected to the game.
 *
 * It is a sheet of its own, not part of the wallet's: the wallet's sheet is redrawn whenever the service's status changes,
 * which would wipe what the player is typing.
 *
 * @param {HTMLElement} host where sheets are drawn
 * @param {{
 *   login?: ReturnType<import('../gd/magic.js').createEmailLogin>,
 *   connect: () => Promise<{ ok: boolean, message?: string }>,
 *   onBack: () => void,                   the player left without signing in
 *   onConnected: (result: object) => void the wallet is connected (the result of `connect`)
 * }} deps
 */
export function openEmailSheet(host, { login = emailLogin, connect, onBack = () => {}, onConnected = () => {} }) {
  let step = 'email';
  let email = '';
  let error = null;
  let flow = null;
  let finished = false;
  let sheet = null;

  const render = () => {
    if (!sheet?.isOpen()) return;
    sheet.setTitle(emailTitle(step));
    sheet.setBody(emailSheetHtml({ step, email, error }));
    // the keyboard goes to the field that is waiting for the player, unless they are waiting on us
    sheet.el.querySelector('input:not([disabled])')?.focus();
  };
  const go = (nextStep, nextError = null) => { step = nextStep; error = nextError; render(); };

  function stopFlow() {
    flow?.cancel();
    flow = null;
  }

  async function sendCode() {
    flow = null;
    go('sending');
    let started;
    try {
      started = await login.begin(email, {
        onCodeSent: () => go('code'),
        onWrongCode: () => go('code', 'wrong_code'),
        onExpired: () => { flow = null; go('email', 'expired'); },
      });
    } catch {
      go('email', 'failed');
      return;
    }
    flow = started;
    started.done.then(async () => {
      if (flow !== started || finished) return;
      go('connecting');
      const res = await connect();
      if (finished) return;
      if (res?.ok) {
        finished = true;
        sheet.close();
        onConnected(res);
      } else {
        flow = null;
        go('email', 'failed');
      }
    }, (e) => {
      if (flow !== started || finished) return; // cancelled by us, or a newer attempt is running
      flow = null;
      go('email', ['throttled', 'too_many_attempts', 'mfa_unsupported'].includes(e?.message) ? e.message : 'failed');
    });
  }

  sheet = openSheet(host, {
    title: emailTitle(step),
    name: 'email',
    body: emailSheetHtml({ step, email, error }),
    onClose: () => {
      stopFlow();
      if (!finished) { finished = true; onBack(); }
    },
    onAction: (act) => {
      if (act !== 'back') return;
      if (step === 'code') { stopFlow(); go('email'); } else sheet.close();
    },
  });
  sheet.el.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === 'email') {
      email = String(new FormData(form).get('email') ?? '').trim();
      const problem = emailProblem(email);
      if (problem) { go('email', problem); return; }
      sendCode();
    } else if (form.dataset.form === 'code' && flow) {
      const code = String(new FormData(form).get('code') ?? '').trim();
      const problem = codeProblem(code);
      if (problem) { go('code', problem); return; }
      go('checking');
      flow.submit(code);
    }
  });
  sheet.el.querySelector('input')?.focus();
  return sheet;
}

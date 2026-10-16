import { EMAIL_PATTERN } from '../gd/magic.js';

/**
 * Signing in with an email, as pure functions of where the player is in it (no DOM, no service), so every step and every
 * thing that can go wrong is testable. The email is escaped wherever it is shown; the messages come from a fixed table.
 *
 * Steps: 'email' (type it), 'sending' (waiting for Magic to send the code), 'code' (type the code), 'checking' (Magic is
 * checking it), 'connecting' (signed in: connecting the wallet to the game).
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CODE_LENGTH = 6;

/** What went wrong, in words a player can act on. Anything not listed gets the generic line. */
const ERRORS = {
  invalid_email: "That doesn't look like an email address.",
  invalid_code: `The code is ${CODE_LENGTH} digits.`,
  wrong_code: "That code isn't right. Check it and try again.",
  expired: 'That code has run out. Send a new one.',
  throttled: 'Too many tries. Wait a minute, then try again.',
  too_many_attempts: 'Too many wrong codes. Send a new one.',
  mfa_unsupported: "This account needs a second step that isn't available here. Use another email or a wallet.",
  failed: "Couldn't sign in. Check your connection and try again.",
};
export const errorText = (code) => ERRORS[code] || ERRORS.failed;

/** Why an email (or a code) cannot be sent on yet: an error code, or null when it is fine. */
export const emailProblem = (email) => (EMAIL_PATTERN.test(String(email ?? '').trim()) ? null : 'invalid_email');
export const codeProblem = (code) => (new RegExp(`^\\d{${CODE_LENGTH}}$`).test(String(code ?? '').trim()) ? null : 'invalid_code');

export const emailTitle = (step) => (step === 'connecting' ? 'Signing you in' : 'Sign in with email');

const err = (code) => (code ? `<p class="note gd-warn" role="alert">${esc(errorText(code))}</p>` : '');

/** @param {{ step?: string, email?: string, error?: string|null }} s */
export function emailSheetHtml({ step = 'email', email = '', error = null } = {}) {
  if (step === 'connecting') {
    return '<p class="lead">Signed in. Connecting your wallet…</p>';
  }
  if (step === 'code' || step === 'checking') {
    const checking = step === 'checking';
    return `<form class="email-form" data-form="code" novalidate>
      <p class="lead">We sent a ${CODE_LENGTH}-digit code to <b class="who">${esc(email)}</b>.</p>
      ${err(error)}
      <label class="field"><span>Code</span>
        <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="${CODE_LENGTH}" placeholder="${'0'.repeat(CODE_LENGTH)}" required ${checking ? 'disabled' : ''}>
      </label>
      <button type="submit" class="gold btn"${checking ? ' disabled' : ''}>${checking ? 'Checking…' : 'Sign in'}</button>
      <button type="button" class="btn-ghost" data-act="back"${checking ? ' disabled' : ''}>Use a different email</button>
    </form>`;
  }
  const sending = step === 'sending';
  return `<form class="email-form" data-form="email" novalidate>
    <p class="lead">Play with just your email. We make a wallet for you, so there is nothing to install.</p>
    ${err(error)}
    <label class="field"><span>Email</span>
      <input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(email)}" required ${sending ? 'disabled' : ''}>
    </label>
    <button type="submit" class="gold btn"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send me a code'}</button>
    <button type="button" class="btn-ghost" data-act="back"${sending ? ' disabled' : ''}>Back</button>
    <p class="note">Your email goes to Magic, the service that keeps your wallet. Moonshard never sees it.</p>
  </form>`;
}

import { GD } from './config.js';

/**
 * Sign in with an email through Magic (magic.link): the player types their email, gets a six-digit code, types it, and has
 * a wallet on Celo, with nothing to install. Magic keeps the wallet's key; this page gets an ordinary EIP-1193 provider
 * for it (`magic.rpcProvider`), which the wallet manager (wallet.js) uses like any other wallet's.
 *
 * Moonshard never sees the email address: it goes from the player's screen to Magic, and only the wallet address comes back.
 * The SDK is loaded the first time it is needed, so a player who never signs in by email never downloads it.
 *
 * The event names are the SDK's own (LoginWithEmailOTPEventOnReceived / LoginWithEmailOTPEventEmit in @magic-sdk/types).
 */
const SENT = 'email-otp-sent';
const WRONG_CODE = 'invalid-email-otp';
const EXPIRED = 'expired-email-otp';
const THROTTLED = 'login-throttled';
const TOO_MANY = 'max-attempts-reached';
const VERIFY = 'verify-email-otp';
const CANCEL = 'cancel';
/** Magic asks for a second factor or a recovery code from accounts that turned them on: not something this page offers. */
const MFA = ['mfa-sent-handle', 'recovery-code-sent-handle'];

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @param {{ key?: string, chainId?: number, rpcUrl?: string, load?: () => Promise<{ Magic: Function }> }} [opts]
 *   `load` is how the SDK is fetched (a test supplies a stand-in).
 */
export function createEmailLogin({ key = GD.magicKey, chainId = GD.chainId, rpcUrl = GD.rpcUrl, load = () => import('magic-sdk') } = {}) {
  let magic = null;
  async function sdk() {
    if (!magic) {
      const { Magic } = await load();
      magic = new Magic(key, { network: { rpcUrl, chainId } });
    }
    return magic;
  }

  return {
    available: Boolean(key),

    /** The wallet's provider when the player is signed in with Magic (now, or from an earlier visit); otherwise null. */
    async provider() {
      if (!key) return null;
      const m = await sdk();
      return (await m.user.isLoggedIn()) ? m.rpcProvider : null;
    },

    /**
     * Start signing in `email`. The returned flow reports what Magic says through the callbacks and finishes by resolving
     * `done` (signed in) or rejecting it with an Error whose message is a code: 'cancelled', 'too_many_attempts',
     * 'throttled', 'mfa_unsupported' or whatever Magic threw.
     *   onCodeSent()        the email is on its way: ask for the code
     *   onWrongCode()       the code was wrong: ask again
     *   onExpired()         the code ran out: start again
     */
    async begin(email, { onCodeSent = () => {}, onWrongCode = () => {}, onExpired = () => {} } = {}) {
      const m = await sdk();
      const handle = m.auth.loginWithEmailOTP({ email, showUI: false });
      let fail = () => {};
      const stopped = new Promise((_, reject) => { fail = reject; });
      handle.on(SENT, () => onCodeSent());
      handle.on(WRONG_CODE, () => onWrongCode());
      handle.on(EXPIRED, () => onExpired());
      handle.on(THROTTLED, () => { handle.emit(CANCEL); fail(new Error('throttled')); });
      handle.on(TOO_MANY, () => fail(new Error('too_many_attempts')));
      for (const event of MFA) handle.on(event, () => { handle.emit(CANCEL); fail(new Error('mfa_unsupported')); });
      // `handle` is also a promise: it settles when the login succeeds, or fails
      const done = Promise.race([Promise.resolve(handle).then(() => undefined), stopped]);
      done.catch(() => {}); // the caller decides what to do with a failure; never an unhandled rejection
      return {
        done,
        submit: (code) => handle.emit(VERIFY, String(code).trim()),
        cancel: () => { try { handle.emit(CANCEL); } catch { /* already over */ } fail(new Error('cancelled')); },
      };
    },

    /** Sign the player out of Magic (the wallet stays theirs: signing in again with the same email brings it back). */
    async logout() {
      if (!key) return;
      await (await sdk()).user.logout();
    },
  };
}

/** The one the game uses. */
export const emailLogin = createEmailLogin();

/** Best-effort host detection. 'minipay' is reliable (window.ethereum.isMiniPay); 'goodwallet' is a UA heuristic. */
export function detectHost(win = globalThis.window) {
  if (win?.ethereum?.isMiniPay) return 'minipay';
  if (/GoodWallet|GoodDapp/i.test(win?.navigator?.userAgent || '')) return 'goodwallet';
  return 'browser';
}

export const isEmbeddedHost = (win) => detectHost(win) !== 'browser';

/**
 * MiniPay cannot sign messages and its review rules forbid asking users to sign in order to log in
 * (docs.minipay.xyz best practices). Every other host signs a login message.
 */
export const canSignMessages = (host) => host !== 'minipay';

export function hostLanguage(win = globalThis.window) {
  return String(win?.navigator?.language || 'en').split('-')[0] || 'en';
}

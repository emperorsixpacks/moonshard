/** Best-effort host detection. 'minipay' is reliable (window.ethereum.isMiniPay); 'goodwallet' is a UA heuristic. */
export function detectHost(win = globalThis.window) {
  if (win?.ethereum?.isMiniPay) return 'minipay';
  if (/GoodWallet|GoodDapp/i.test(win?.navigator?.userAgent || '')) return 'goodwallet';
  return 'browser';
}

export const isEmbeddedHost = (win) => detectHost(win) !== 'browser';

export function hostLanguage(win = globalThis.window) {
  return String(win?.navigator?.language || 'en').split('-')[0] || 'en';
}

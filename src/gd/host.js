/** Best-effort host label. 'goodwallet' is a user-agent heuristic and is only used as a label (analytics / panel). */
export function detectHost(win = globalThis.window) {
  if (/GoodWallet|GoodDapp/i.test(win?.navigator?.userAgent || '')) return 'goodwallet';
  return 'browser';
}

export const isEmbeddedHost = (win) => detectHost(win) !== 'browser';

export function hostLanguage(win = globalThis.window) {
  return String(win?.navigator?.language || 'en').split('-')[0] || 'en';
}

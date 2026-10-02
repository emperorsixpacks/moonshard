const KEY = 'moonshard.guide.seen.v1';

/**
 * Whether the G$ guide should open by itself: true the first time this is asked on a device (which is remembered), false
 * after that, and false when storage is blocked (better never than on every visit).
 */
export function takeFirstVisit(storage = globalThis.localStorage) {
  try {
    if (storage.getItem(KEY)) return false;
    storage.setItem(KEY, '1');
    return true;
  } catch {
    return false;
  }
}

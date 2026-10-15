/**
 * How the player is playing right now: with a keyboard ('keys') or with their fingers ('touch').
 *
 * It decides what the screen shows: the on-screen pad appears only for fingers, and the tutorial names keys or buttons
 * to match. A phone starts as touch and a computer as keys; the first real touch or game key press switches it, so a
 * laptop with a touch screen and a phone with a keyboard both end up right.
 */

/** The keys that play the game (KeyboardEvent.code). Other keys, such as a browser shortcut, say nothing about how someone plays. */
export const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyE', 'KeyJ', 'KeyK', 'Enter',
]);

/** A mode holder; `coarse` is whether the device's main pointer is a finger. */
export function createInputMode({ coarse = false } = {}) {
  let mode = coarse ? 'touch' : 'keys';
  const listeners = new Set();
  const set = (next) => {
    if (next === mode) return;
    mode = next;
    for (const fn of [...listeners]) fn(mode);
  };
  return {
    get mode() { return mode; },
    /** A finger touched the screen. */
    touched: () => set('touch'),
    /** A key was pressed (`code` is KeyboardEvent.code). */
    keyed: (code) => { if (GAME_KEYS.has(code)) set('keys'); },
    /** Calls `fn(mode)` whenever the mode changes. Returns a function that stops it. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const coarsePointer = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

/** The page's one input mode. */
export const input = createInputMode({ coarse: coarsePointer() });

let watching = false;
/** Start following the page's touches and key presses. Call once, before the game starts. */
export function watchInput(win = window) {
  if (watching) return;
  watching = true;
  win.addEventListener('touchstart', () => input.touched(), { capture: true, passive: true });
  win.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') input.touched(); }, { capture: true, passive: true });
  win.addEventListener('keydown', (e) => input.keyed(e.code), { capture: true });
}

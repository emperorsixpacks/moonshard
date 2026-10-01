// The game's two typefaces are bundled with the app (SIL Open Font License), not fetched from a font CDN: they are
// always there, offline or on a bad connection, and nothing about the player is sent to a third party.
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';

const FACES = ['16px "Press Start 2P"', '16px "VT323"'];
// the characters the game's text actually uses, so the browser fetches the right piece of each font
const SAMPLE = 'Aa0123456789 .,:;!?+-/%&()#$•';

/**
 * Resolves when both typefaces are ready. Canvas text is drawn once, at the moment it is created, in whatever font
 * the browser has at that moment, so the game must not build any text before this resolves. Never rejects and never
 * waits forever: after `timeoutMs` the game starts anyway (with the fallback font).
 */
export async function loadGameFonts({ timeoutMs = 4000, fonts = typeof document !== 'undefined' ? document.fonts : null } = {}) {
  if (!fonts?.load) return false;
  const ready = Promise.all(FACES.map((face) => fonts.load(face, SAMPLE))).then(() => true, () => false);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([ready, timeout]);
}

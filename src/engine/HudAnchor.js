/**
 * Where the game picture is on the page, published as CSS custom properties on <html>, so the page's floating
 * controls (wallet, timer, pause) sit against the picture instead of floating over the window:
 *
 *   --ms-canvas-top / --ms-canvas-right   gap between the window edge and the picture (px)
 *   --ms-unit                             CSS px per game unit
 *   --ms-hud-height                       height of the in-game HUD bar in game units (0 when a scene has none)
 *
 * A scene with a HUD bar calls `useHudHeight(scene, units)`, and the controls then sit just below the bar.
 */

/** Pure: the numbers to publish for a canvas rectangle in a window. */
export function computeAnchor({ canvasRect, viewportWidth, gameWidth } = {}) {
  const width = canvasRect?.width;
  if (!(width > 0) || !(gameWidth > 0)) return { top: 0, right: 0, unit: 1 };
  return {
    top: Math.max(0, canvasRect.top),
    right: Math.max(0, viewportWidth - canvasRect.right),
    unit: width / gameWidth,
  };
}

const root = () => (typeof document !== 'undefined' ? document.documentElement : null);

function publish(game) {
  const el = root();
  if (!el || !game?.canvas) return;
  const a = computeAnchor({
    canvasRect: game.canvas.getBoundingClientRect(),
    viewportWidth: window.innerWidth,
    gameWidth: game.scale.gameSize.width,
  });
  el.style.setProperty('--ms-canvas-top', `${a.top}px`);
  el.style.setProperty('--ms-canvas-right', `${a.right}px`);
  el.style.setProperty('--ms-unit', `${a.unit}px`);
}

/** Keep the properties up to date as the window, the orientation and the game size change. */
export function installHudAnchor(game) {
  const update = () => publish(game);
  game.scale.on('resize', update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(game.canvas);
  update();
}

export function setHudHeight(units) {
  root()?.style.setProperty('--ms-hud-height', String(Number(units) || 0));
}

/** For a scene with an in-game HUD bar: the controls sit below it for as long as the scene runs. */
export function useHudHeight(scene, units) {
  setHudHeight(units);
  scene.events.once('shutdown', () => setHudHeight(0));
}

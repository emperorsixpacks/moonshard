import Phaser from 'phaser';
import { chooseRenderScale, pixelBudget } from './renderScale.js';
import { resolveTextStyle } from './typography.js';

/**
 * Sharp rendering at any screen size.
 *
 * The game lives in a small coordinate space (480 x 270, or 480 x 440 in portrait) and the browser used to stretch
 * that tiny picture over the whole window, which is why text was blurry. Here the drawing buffer is made N times
 * larger and the same game coordinates are rendered into it, so every unit of the game covers N x N real pixels:
 *
 *  - the renderer's projection stays in game units, so cameras, physics, input and every scene are untouched;
 *  - only the final GL viewport and scissor of the CANVAS are multiplied by N (off-screen framebuffers are not);
 *  - text is rasterised at N x, so letters are drawn with real pixels instead of being stretched.
 *
 * N comes from the on-screen size and the display density (see renderScale.js).
 */

let renderScale = 1;
let patched = false;

/** The current multiplier (1 until `installHiRes` has measured the screen). */
export const getRenderScale = () => renderScale;

const drawsToCanvas = (glWrapper) => {
  const framebuffer = glWrapper.state.bindings.framebuffer;
  return !framebuffer || framebuffer.webGLFramebuffer === null;
};

function patchRenderer() {
  if (patched) return;
  patched = true;

  const Wrapper = Phaser.Renderer.WebGL.Wrappers.WebGLGlobalWrapper.prototype;
  const updateScissorBox = Wrapper.updateScissorBox;
  const updateViewport = Wrapper.updateViewport;
  const times = (box) => box.map((v) => v * renderScale);

  Wrapper.updateScissorBox = function scaledScissorBox(state, force) {
    if (renderScale === 1 || !drawsToCanvas(this)) return updateScissorBox.call(this, state, force);
    return updateScissorBox.call(this, { scissor: { box: times(state.scissor.box) } }, force);
  };
  Wrapper.updateViewport = function scaledViewport(state, force) {
    if (renderScale === 1 || !drawsToCanvas(this)) return updateViewport.call(this, state, force);
    return updateViewport.call(this, { viewport: times(state.viewport) }, force);
  };

  // New text gets a font the canvas will accept (see typography.js) and is rasterised at the current multiplier,
  // unless the caller asked for something specific.
  const sharp = (style) => ({ resolution: renderScale, ...resolveTextStyle(style) });
  for (const Host of [Phaser.GameObjects.GameObjectFactory, Phaser.GameObjects.GameObjectCreator]) {
    const make = Host.prototype.text;
    Host.prototype.text = function sharpText(x, y, text, style) {
      return make.call(this, x, y, text, sharp(style));
    };
  }
}

/** Re-rasterise text that already exists (the window moved to a denser screen, or was resized). */
function sharpenExistingText(game) {
  const visit = (object) => {
    if (object instanceof Phaser.GameObjects.Text && object.style.resolution !== renderScale) object.setResolution(renderScale);
    object.list?.forEach(visit);
  };
  game.scene.scenes.forEach((scene) => scene.children?.list.forEach(visit));
}

function applyScale(game) {
  const base = game.scale.baseSize;
  const shown = game.canvas.getBoundingClientRect().width || game.scale.parentSize.width || window.innerWidth;
  const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const next = chooseRenderScale({
    cssWidth: shown,
    dpr: window.devicePixelRatio || 1,
    baseWidth: base.width,
    baseHeight: base.height,
    budgetPixels: pixelBudget(coarse),
  });
  const width = Math.round(base.width * next);
  const height = Math.round(base.height * next);
  if (next === renderScale && game.canvas.width === width && game.canvas.height === height) return;

  renderScale = next;
  game.canvas.width = width;
  game.canvas.height = height;
  // Scaling a larger buffer DOWN should be smooth; only a 1x buffer needs the blocky "pixelated" upscale.
  game.canvas.style.imageRendering = next > 1 ? 'auto' : '';
  // GL keeps the viewport and scissor it had for the old buffer: forget what the wrapper believes is set.
  const gl = game.renderer.glWrapper.state;
  gl.viewport = [-1, -1, -1, -1];
  gl.scissor.box = [-1, -1, -1, -1];
  sharpenExistingText(game);
}

/**
 * Call once the game has booted. Keeps the buffer matched to the window, the orientation and the display density.
 * Does nothing on the Canvas renderer (no WebGL): the game then renders 1:1 as before.
 */
export function installHiRes(game) {
  if (game.renderer?.type !== Phaser.WEBGL) return;
  patchRenderer();
  const update = () => applyScale(game);
  game.scale.on(Phaser.Scale.Events.RESIZE, update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  // Dragging the window to another monitor (or zooming the page) changes the density without resizing it.
  const watchDensity = () => {
    const query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query?.addEventListener?.('change', () => { update(); watchDensity(); }, { once: true });
  };
  watchDensity();
  update();
}

import { GAME_CONFIG } from '../config.js';

/**
 * Reliable portrait mode detector across standard desktop browsers,
 * mobile Chrome/Safari, and embedded WebViews (e.g. Nimiq Pay mini-app).
 */
export function isPortraitMode() {
  if (typeof window === 'undefined') return false;

  // 1. Check CSS matchMedia (browser layout engine)
  if (window.matchMedia) {
    try {
      const mq = window.matchMedia('(orientation: portrait)');
      if (mq && typeof mq.matches === 'boolean') {
        return mq.matches;
      }
    } catch {
      // Ignore older matchMedia errors
    }
  }

  // 2. Check window.screen.orientation
  if (window.screen && window.screen.orientation && window.screen.orientation.type) {
    return window.screen.orientation.type.includes('portrait');
  }

  // 3. Check legacy window.orientation (0 or 180 is portrait)
  if (typeof window.orientation === 'number') {
    return window.orientation === 0 || window.orientation === 180;
  }

  // 4. Viewport dimensions comparison
  const w = window.innerWidth || document.documentElement?.clientWidth || 0;
  const h = window.innerHeight || document.documentElement?.clientHeight || 0;
  if (w > 0 && h > 0) {
    return h >= w;
  }

  // 5. Mobile screen dimension fallback
  if (window.screen && window.screen.width && window.screen.height) {
    return window.screen.height >= window.screen.width;
  }

  return false;
}

/**
 * Manages responsive viewport sizing and aspect-ratio adaptation
 * between mobile portrait and mobile/desktop landscape modes.
 * 
 * - Landscape: 480 x 270 (16:9 widescreen arcade)
 * - Portrait:  480 x 440 (expanded vertical viewport, +64% more viewable area)
 */
export class ViewportManager {
  constructor(game) {
    this.game = game;
    this.isPortrait = this.detectPortrait();
    this.currentWidth = GAME_CONFIG.WIDTH;
    this.currentHeight = this.isPortrait ? (GAME_CONFIG.PORTRAIT_HEIGHT || 440) : GAME_CONFIG.HEIGHT;
    this.boundOnResize = this.onResize.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundOnResize);
      window.addEventListener('orientationchange', this.boundOnResize);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.addEventListener('change', this.boundOnResize);
      }
      if (window.matchMedia) {
        try {
          const mq = window.matchMedia('(orientation: portrait)');
          if (mq.addEventListener) {
            mq.addEventListener('change', this.boundOnResize);
          } else if (mq.addListener) {
            mq.addListener(this.boundOnResize);
          }
        } catch {}
      }

      this.applyContainerStyles(this.currentWidth, this.currentHeight);
      this.syncGameScale(this.currentWidth, this.currentHeight);
    }
  }

  detectPortrait() {
    return isPortraitMode();
  }

  applyContainerStyles(w, h) {
    if (typeof document === 'undefined') return;
    const gc = document.getElementById('game-container');
    const gw = document.getElementById('game-wrapper');
    const portrait = this.detectPortrait();

    if (gc) {
      if (portrait) {
        gc.style.aspectRatio = `${w} / ${h}`;
        gc.setAttribute('data-orientation', 'portrait');
      } else {
        gc.style.aspectRatio = '';
        gc.setAttribute('data-orientation', 'landscape');
      }
    }

    if (gw) {
      gw.setAttribute('data-orientation', portrait ? 'portrait' : 'landscape');
    }
  }

  syncGameScale(targetW, targetH) {
    if (!this.game || !this.game.scale) return;
    if (this.game.scale.width !== targetW || this.game.scale.height !== targetH) {
      this.game.scale.resize(targetW, targetH);
      this.notifyScenes(targetW, targetH);
    }
  }

  onResize() {
    const newPortrait = this.detectPortrait();
    const targetW = GAME_CONFIG.WIDTH;
    const targetH = newPortrait ? (GAME_CONFIG.PORTRAIT_HEIGHT || 440) : GAME_CONFIG.HEIGHT;

    this.isPortrait = newPortrait;
    this.applyContainerStyles(targetW, targetH);

    const scaleNeedsResize = !this.game?.scale || this.game.scale.width !== targetW || this.game.scale.height !== targetH;
    if (this.currentWidth !== targetW || this.currentHeight !== targetH || scaleNeedsResize) {
      this.currentWidth = targetW;
      this.currentHeight = targetH;
      this.syncGameScale(targetW, targetH);
    }
  }

  notifyScenes(w, h) {
    if (!this.game || !this.game.scene) return;
    this.game.scene.getScenes(true).forEach(scene => {
      if (scene && typeof scene.onViewportResize === 'function') {
        scene.onViewportResize(w, h);
      }
    });
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundOnResize);
      window.removeEventListener('orientationchange', this.boundOnResize);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.removeEventListener('change', this.boundOnResize);
      }
    }
  }
}

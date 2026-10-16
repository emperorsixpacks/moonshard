import { GAME_CONFIG } from '../config.js';
import { playStageSize, groundLift } from './playStage.js';

/**
 * Reliable portrait mode detector across standard desktop browsers,
 * mobile Chrome/Safari, and embedded WebViews (e.g. wallet mini-app).
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
 * - Portrait, a run in progress (a scene called enterPlay): the picture takes the whole screen under the page header,
 *   narrower and as tall as the screen is (engine/playStage.js), with the pad floating on top.
 */
export class ViewportManager {
  constructor(game) {
    this.game = game;
    this.isPortrait = this.detectPortrait();
    this.playOwner = null; // the scene whose run is on, if any (see enterPlay)
    this.playSize = null;
    this.playLift = 0; // units the ground is raised so the hero stands above the pad (engine/playStage.js groundLift)
    const first = this.stageSize(this.isPortrait);
    this.currentWidth = first.width;
    this.currentHeight = first.height;
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
      if (portrait && !this.playOwner) {
        gc.style.aspectRatio = `${w} / ${h}`;
        gc.setAttribute('data-orientation', 'portrait');
      } else {
        gc.style.aspectRatio = '';
        gc.setAttribute('data-orientation', 'landscape');
      }
    }

    if (gw) {
      gw.setAttribute('data-orientation', portrait ? 'portrait' : 'landscape');
      gw.setAttribute('data-stage', this.playOwner ? 'play' : 'screen');
    }
  }

  /**
   * The picture's size in game units for the orientation. During a run held upright it is the shape of the screen under
   * the header, measured once when the run starts (and again after a rotation), so the picture does not change size
   * under the player when a browser bar slides away.
   */
  stageSize(portrait) {
    if (!portrait) { this.playLift = 0; return { width: GAME_CONFIG.WIDTH, height: GAME_CONFIG.HEIGHT }; }
    if (!this.playOwner) return { width: GAME_CONFIG.WIDTH, height: GAME_CONFIG.PORTRAIT_HEIGHT || 440 };
    if (!this.playSize) {
      const area = typeof document !== 'undefined' ? document.getElementById('game-wrapper')?.getBoundingClientRect() : null;
      this.playSize = playStageSize({ width: area?.width, height: area?.height });
      this.playLift = this.measureLift(area, this.playSize);
    }
    return this.playSize;
  }

  /** How far the pad reaches up over the picture, as a lift for the ground (0 when the pad is not shown). */
  measureLift(area, size) {
    if (typeof document === 'undefined' || !(area?.width > 0)) return 0;
    const cluster = document.querySelector('#touch-controls .touch-actions');
    const padRect = cluster && cluster.offsetParent !== null ? cluster.getBoundingClientRect() : null;
    if (!padRect || !(padRect.height > 0)) return 0;
    // the picture is fitted into the area and centred: its top and its size on screen
    const unit = Math.min(area.width / size.width, area.height / size.height);
    const top = area.top + (area.height - size.height * unit) / 2;
    return groundLift((padRect.top - top) / unit);
  }

  /**
   * A run starts: the picture takes the whole screen (held upright) and the scene lays itself out for the size it finds
   * in create(). Call it from the scene's init(); `leavePlay` undoes it when the scene shuts down.
   */
  enterPlay(owner) {
    this.playOwner = owner;
    this.playSize = null;
    this.onResize();
    this.game?.scale?.refresh?.(); // the picture's parent changed size even if the game's own size did not
  }

  /** The run is over. Only the scene that entered can leave, so a new run's stage is not undone by the old one's shutdown. */
  leavePlay(owner) {
    if (this.playOwner !== owner) return;
    this.playOwner = null;
    this.playSize = null;
    this.playLift = 0;
    this.onResize();
    this.game?.scale?.refresh?.();
  }

  syncGameScale(targetW, targetH) {
    if (!this.game || !this.game.scale) return;
    if (this.game.scale.width !== targetW || this.game.scale.height !== targetH) {
      // setGameSize (not resize): under the FIT scale mode only setGameSize updates the aspect ratio the picture is
      // fitted to, so after a rotation `resize` left it squashed to the old shape.
      this.game.scale.setGameSize(targetW, targetH);
      this.notifyScenes(targetW, targetH);
    }
  }

  onResize() {
    const newPortrait = this.detectPortrait();
    if (newPortrait !== this.isPortrait) this.playSize = null; // a rotation: measure the area again
    this.isPortrait = newPortrait;
    this.applyContainerStyles(this.currentWidth, this.currentHeight); // the page's orientation and stage first: the area is measured under them
    const { width: targetW, height: targetH } = this.stageSize(newPortrait);
    this.applyContainerStyles(targetW, targetH);

    const scaleNeedsResize = !this.game?.scale || this.game.scale.width !== targetW || this.game.scale.height !== targetH;
    if (this.currentWidth !== targetW || this.currentHeight !== targetH || scaleNeedsResize) {
      this.currentWidth = targetW;
      this.currentHeight = targetH;
      this.syncGameScale(targetW, targetH);
    }
  }

  /**
   * Tells every screen that is showing the new size. Each one re-lays itself out in its own way (a level adapts in
   * place, the menu closes its dialog and restarts, the forge restarts on the same tab), so the manager never
   * restarts one for them. A handler must compare with the size it LAID OUT for, not with its camera: by the time it
   * is called Phaser has already resized the camera.
   */
  notifyScenes(w, h) {
    if (!this.game || !this.game.scene) return;
    this.game.scene.getScenes(true).forEach(scene => {
      if (typeof scene?.onViewportResize === 'function') scene.onViewportResize(w, h);
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

import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { nimiqService } from '../engine/NimiqService.js';

export class TouchController {
  constructor(game) {
    this.game = game;
    this.state = {
      left: false,
      right: false,
      up: false,
      down: false,
      justJump: false,
      justAttack: false,
      justUpSlash: false
    };

    this.touchContainer = document.getElementById('touch-controls');
    this.isVisible = false;
    const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    if (isPortrait) {
      this.show();
    } else {
      this.hide();
    }
    this.initTouchButtons();
    this.initHeaderButtons();
    this.initNimiqIntegration();
    this.initViewportListener();
  }

  show() {
    this.isVisible = true;
    if (this.touchContainer) {
      this.touchContainer.classList.remove('hidden');
    }
  }

  hide(force = false) {
    const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    if (isPortrait && !force) {
      // In portrait mode, keep touch controls active throughout to prevent lower area from looking empty
      this.show();
      return;
    }
    this.isVisible = false;
    if (this.touchContainer) {
      this.touchContainer.classList.add('hidden');
    }
    // Clear any held directional / action states so inputs do not stick
    for (const k of Object.keys(this.state)) {
      this.state[k] = false;
    }
    if (this.touchContainer) {
      this.touchContainer.querySelectorAll('.touch-btn').forEach((btn) => btn.classList.remove('pressed'));
    }
  }

  setTutorialHighlight(btnIds = []) {
    this.clearTutorialHighlights();
    const ids = Array.isArray(btnIds) ? btnIds : [btnIds];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('tutorial-highlight');
      }
    });
  }

  clearTutorialHighlights() {
    if (this.touchContainer) {
      this.touchContainer.querySelectorAll('.touch-btn.tutorial-highlight').forEach((btn) => {
        btn.classList.remove('tutorial-highlight');
      });
    }
  }

  initViewportListener() {
    const handleResize = () => {
      if (this.game && this.game.scale) {
        this.game.scale.refresh();
      }

      if (typeof window !== 'undefined' && this.touchContainer) {
        this.touchContainer.style.removeProperty('--keyboard-or-bar-offset');
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      handleResize();
      setTimeout(handleResize, 100);
      setTimeout(handleResize, 300);
    });
    if (typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.addEventListener('change', () => {
        handleResize();
        setTimeout(handleResize, 100);
        setTimeout(handleResize, 300);
      });
    }
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }

    // Prevent default touch gestures that cause page scroll or pull-to-refresh
    document.addEventListener(
      'touchmove',
      (e) => {
        if (e.target.closest('#nimiq-modal-body') || e.target.closest('.modal-body')) {
          return;
        }
        e.preventDefault();
      },
      { passive: false }
    );

    // Prevent iOS Safari multi-touch pinch zoom during two-thumb gameplay
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('gestureend', (e) => e.preventDefault());

    // Prevent contextual menu on long press on controls or canvas
    window.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#touch-controls') || e.target.closest('#game-container')) {
        e.preventDefault();
      }
    });

    // Prevent double-tap zoom on virtual controls and canvas
    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('#touch-controls') || e.target.closest('#game-wrapper')) {
        e.preventDefault();
      }
    });
  }

  triggerHaptic() {
    try { sound.resume(); } catch {}
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(12); } catch {}
    }
  }

  initTouchButtons() {
    // DPAD state tracking with sliding gesture and multi-touch support
    const dpadContainer = document.querySelector('.touch-dpad');
    const dpadBtns = {
      'touch-left': { key: 'left', el: document.getElementById('touch-left') },
      'touch-right': { key: 'right', el: document.getElementById('touch-right') }
    };

    let activeDpadPointerId = null;
    let currentDpadKey = null;

    const setDpadKey = (key) => {
      if (currentDpadKey === key) return;
      if (currentDpadKey) {
        this.state[currentDpadKey] = false;
        const prevEl = Object.values(dpadBtns).find((b) => b.key === currentDpadKey)?.el;
        if (prevEl) prevEl.classList.remove('pressed');
      }
      currentDpadKey = key;
      if (key) {
        this.state[key] = true;
        const nextEl = Object.values(dpadBtns).find((b) => b.key === key)?.el;
        if (nextEl) {
          nextEl.classList.add('pressed');
          this.triggerHaptic();
        }
      }
    };

    const getDpadBtnFromPoint = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const btn = el.closest('.dpad-btn');
      if (!btn) return null;
      return Object.values(dpadBtns).find((b) => b.el === btn)?.key || null;
    };

    const getNearestDpadKey = (x, y) => {
      if (!dpadContainer) return null;
      const rect = dpadContainer.getBoundingClientRect();
      const margin = 20;
      if (
        x < rect.left - margin ||
        x > rect.right + margin ||
        y < rect.top - margin ||
        y > rect.bottom + margin
      ) {
        return null;
      }

      const directKey = getDpadBtnFromPoint(x, y);
      if (directKey) return directKey;

      let closestKey = null;
      let minDistanceSq = Infinity;
      for (const item of Object.values(dpadBtns)) {
        if (!item.el) continue;
        const bRect = item.el.getBoundingClientRect();
        const centerX = bRect.left + bRect.width / 2;
        const centerY = bRect.top + bRect.height / 2;
        const distSq = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestKey = item.key;
        }
      }
      return closestKey;
    };

    if (dpadContainer) {
      dpadContainer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        activeDpadPointerId = e.pointerId;
        try { dpadContainer.setPointerCapture(e.pointerId); } catch {}
        const key = getNearestDpadKey(e.clientX, e.clientY);
        setDpadKey(key);
      });

      dpadContainer.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activeDpadPointerId) return;
        e.preventDefault();
        const key = getNearestDpadKey(e.clientX, e.clientY);
        setDpadKey(key);
      });

      const releaseDpad = (e) => {
        if (activeDpadPointerId !== null && e.pointerId !== activeDpadPointerId) return;
        e.preventDefault();
        try { dpadContainer.releasePointerCapture(e.pointerId); } catch {}
        activeDpadPointerId = null;
        setDpadKey(null);
      };

      dpadContainer.addEventListener('pointerup', releaseDpad);
      dpadContainer.addEventListener('pointercancel', releaseDpad);
      dpadContainer.addEventListener('lostpointercapture', releaseDpad);
      dpadContainer.addEventListener('pointerleave', (e) => {
        if (activeDpadPointerId !== null && (!dpadContainer.hasPointerCapture || !dpadContainer.hasPointerCapture(e.pointerId))) {
          releaseDpad(e);
        }
      });
    }

    // Action buttons with pointer capture to prevent input drops on rolling thumb taps
    const bindActionBtn = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;

      let activePointerId = null;

      const handlePress = (e) => {
        e.preventDefault();
        activePointerId = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch {}
        el.classList.add('pressed');
        this.state[key] = true;
        this.triggerHaptic();

        if (key === 'jump') this.state.justJump = true;
        if (key === 'attack') {
          if (this.state.up) {
            this.state.justUpSlash = true;
          } else {
            this.state.justAttack = true;
          }
        }
        if (key === 'upslash') this.state.justUpSlash = true;
      };

      const handleRelease = (e) => {
        if (activePointerId !== null && e.pointerId !== activePointerId) return;
        e.preventDefault();
        try { el.releasePointerCapture(e.pointerId); } catch {}
        activePointerId = null;
        el.classList.remove('pressed');
        this.state[key] = false;
      };

      el.addEventListener('pointerdown', handlePress);
      el.addEventListener('pointerup', handleRelease);
      el.addEventListener('pointercancel', handleRelease);
      el.addEventListener('lostpointercapture', handleRelease);
      el.addEventListener('pointerleave', (e) => {
        if (activePointerId !== null && (!el.hasPointerCapture || !el.hasPointerCapture(e.pointerId))) {
          handleRelease(e);
        }
      });
    };

    bindActionBtn('touch-upslash', 'upslash');
    bindActionBtn('touch-attack', 'attack');
    bindActionBtn('touch-jump', 'jump');

    // Reset inputs when user switches apps or browser loses focus
    const resetAllInputs = () => {
      for (const k of Object.keys(this.state)) {
        this.state[k] = false;
      }
      setDpadKey(null);
      document.querySelectorAll('.touch-btn').forEach((btn) => btn.classList.remove('pressed'));
    };

    window.addEventListener('blur', resetAllInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetAllInputs();
    });
  }

  initHeaderButtons() {
    // Audio Toggle
    const btnAudio = document.getElementById('btn-audio');
    if (btnAudio) {
      btnAudio.addEventListener('click', () => {
        const muted = sound.toggleMute();
        btnAudio.textContent = muted ? '🔇' : '🔊';
      });
    }

    // Touch Controls Toggle
    const btnTouch = document.getElementById('btn-touch');
    if (btnTouch && this.touchContainer) {
      btnTouch.addEventListener('click', () => {
        if (this.touchContainer.classList.contains('hidden')) {
          this.show();
        } else {
          this.hide();
        }
      });
    }

    // CRT Scanlines Toggle
    const btnCrt = document.getElementById('btn-crt');
    const crtOverlay = document.getElementById('crt-overlay');
    if (btnCrt && crtOverlay) {
      btnCrt.addEventListener('click', () => {
        crtOverlay.classList.toggle('active');
        btnCrt.style.opacity = crtOverlay.classList.contains('active') ? '1.0' : '0.5';
      });
    }

    // Fullscreen Toggle
    const btnFs = document.getElementById('btn-fullscreen');
    if (btnFs) {
      btnFs.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  initNimiqIntegration() {
    const btnNimiq = document.getElementById('btn-nimiq');
    const txtNimiq = document.getElementById('nimiq-btn-text');
    const dotNimiq = document.getElementById('nimiq-dot');

    const btnNimiqLand = document.getElementById('btn-nimiq-landscape');
    const txtNimiqLand = document.getElementById('nimiq-btn-text-landscape');
    const dotNimiqLand = document.getElementById('nimiq-dot-landscape');

    const openAltar = () => {
      if (nimiqService.getStatus().connected) return;
      if (window.__lunaGate) window.__lunaGate.show().then(() => {});
    };

    if (btnNimiq) btnNimiq.addEventListener('click', openAltar);
    if (btnNimiqLand) btnNimiqLand.addEventListener('click', openAltar);

    // Subscribe to Nimiq status changes to update header indicator
    nimiqService.subscribe((status) => {
      const updateBadge = (txt, dot) => {
        if (!txt || !dot) return;
        if (status.connected) {
          dot.classList.remove('offline');
          dot.classList.add('online');
          txt.textContent = status.shortAddress || 'CONNECTED';
        } else {
          dot.classList.remove('online');
          dot.classList.add('offline');
          txt.textContent = 'NIMIQ';
        }
      };

      updateBadge(txtNimiq, dotNimiq);
      updateBadge(txtNimiqLand, dotNimiqLand);
    });
  }

  consumeTriggers() {
    const triggers = {
      justJump: this.state.justJump,
      justAttack: this.state.justAttack,
      justUpSlash: this.state.justUpSlash
    };
    this.state.justJump = false;
    this.state.justAttack = false;
    this.state.justUpSlash = false;
    return triggers;
  }
}

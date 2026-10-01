/**
 * Immersive layout helper for embeddable webviews (wallet mini apps (MiniPay and similar), mobile
 * browsers, in-app browser tabs).
 *
 * Host chrome — the wallet app header / "site address" bar and the phone's
 * system bars (Android 3-button navigation, iOS home indicator) — can overlap
 * the document. We measure the true visible region and publish it as CSS
 * custom properties:
 *   --ms-inset-top / -right / -bottom / -left   (px)
 * so the canvas, floating controls, and overlays self-adjust to the safe area
 * instead of being pushed under or off the edge.
 */

let installed = false;
let probe = null;

function px(value) {
  const n = parseFloat(String(value ?? '').replace(/px$/, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Resolve CSS env(safe-area-inset-*) to real pixels via a probe element. */
function safeArea() {
  if (!probe) {
    probe = document.createElement('div');
    probe.id = '__ms-safe-area-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;pointer-events:none;visibility:hidden;width:0;height:0';
    document.documentElement.appendChild(probe);
  }
  const s = probe.style;
  s.left = 'env(safe-area-inset-left, 0px)';
  s.top = 'env(safe-area-inset-top, 0px)';
  s.right = 'env(safe-area-inset-right, 0px)';
  s.bottom = 'env(safe-area-inset-bottom, 0px)';
  const cs = getComputedStyle(probe);
  return {
    top: px(cs.top === 'auto' ? 0 : cs.top),
    right: px(cs.right === 'auto' ? 0 : cs.right),
    bottom: px(cs.bottom === 'auto' ? 0 : cs.bottom),
    left: px(cs.left === 'auto' ? 0 : cs.left),
  };
}

/** Offsets implied by the visual viewport (host chrome pinching the page). */
function visualOffsets() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return { top: 0, right: 0, bottom: 0, left: 0 };
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const offsetTop = px(vv.offsetTop);
  const offsetLeft = px(vv.offsetLeft);
  const height = vv.height || ih;
  const width = vv.width || iw;

  const heightShortfall = Math.max(0, ih - height);
  const isInputFocused =
    typeof document !== 'undefined' &&
    document.activeElement &&
    (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

  let topInset = offsetTop;
  let bottomInset = 0;

  if (isInputFocused) {
    // Soft keyboard active at bottom
    bottomInset = Math.max(0, ih - (height + offsetTop));
  }

  return {
    top: topInset,
    left: offsetLeft,
    bottom: bottomInset,
    right: Math.max(0, iw - (width + offsetLeft)),
  };
}

/** Recompute and publish the combined insets as CSS custom properties. */
export function updateImmersiveInsets() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const sa = safeArea();
  const vv = visualOffsets();
  const root = document.documentElement;

  const apply = (name, value) => {
    if (parseFloat(root.style.getPropertyValue(name)) !== value) {
      root.style.setProperty(name, `${value}px`);
    }
  };

  apply('--ms-inset-top', Math.max(sa.top, vv.top));
  apply('--ms-inset-right', Math.max(sa.right, vv.right));
  apply('--ms-inset-bottom', Math.max(sa.bottom, vv.bottom));
  apply('--ms-inset-left', Math.max(sa.left, vv.left));
}

/**
 * Install resize/toolbar/orientation listeners that keep the insets up to
 * date. Safe to call more than once; only one listener set is ever attached.
 */
export function setupImmersiveLayout() {
  if (installed) return;
  installed = true;

  let rafId = null;
  const schedule = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      updateImmersiveInsets();
    });
  };

  updateImmersiveInsets();

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }

  // Some hosts settle layout a few frames (or a couple hundred ms) after a
  // rotation or toolbar show/hide — reschedule until the geometry stops moving.
  const settle = () => {
    schedule();
    setTimeout(schedule, 150);
    setTimeout(schedule, 350);
  };
  window.addEventListener('orientationchange', settle);
  window.addEventListener('resize', settle);
}
import { iconSprite } from './icons.js';
import { SHOP_ICONS, shopHtml } from './shopView.js';

/**
 * The shop's place on the page: a screen drawn as page elements (not in the game canvas), filling the space under the page
 * header so the header's wallet button stays where it is. What it shows comes from shopView.js; the scene
 * (scenes/ForgeScene.js) feeds it and carries out the taps.
 *
 * @param {{ host: HTMLElement, onAction: (act: string, el: HTMLElement) => void }} deps `host` is where screens go (#ms-menu)
 */
export function createShopScreen({ host, onAction }) {
  host.innerHTML = '';
  // the icons every card refers to, drawn once beside the screen: render() replaces what is inside the root, never this
  host.insertAdjacentHTML('beforeend', iconSprite(SHOP_ICONS));
  const sprite = host.lastElementChild;
  const root = document.createElement('div');
  root.className = 'sh';
  host.appendChild(root);

  // Under the page header, whatever its height (it is not there at all when the phone is on its side).
  const place = () => {
    const header = document.getElementById('arcade-header');
    const bottom = header && header.offsetParent !== null ? header.getBoundingClientRect().bottom : 0;
    root.style.top = `${Math.max(0, Math.round(bottom))}px`;
  };
  place();
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', place);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) onAction(b.dataset.act, b);
  });

  /** What has the keyboard's focus, as a selector for the same control after the screen is drawn again. */
  const focused = () => {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset.act) return null;
    const attr = (name) => (a.dataset[name] ? `[data-${name}="${CSS.escape(a.dataset[name])}"]` : '');
    return `[data-act="${CSS.escape(a.dataset.act)}"]${attr('tab')}${attr('id')}`;
  };

  return {
    /** Draw the model, keeping the list where the player had scrolled it (`top`: from its start, for another tab). */
    render(model, { top = false } = {}) {
      const before = root.querySelector('.sh-scroll');
      const scrolled = before && !top ? before.scrollTop : 0;
      const refocus = focused();
      root.innerHTML = shopHtml(model);
      const after = root.querySelector('.sh-scroll');
      if (after) after.scrollTop = scrolled;
      if (refocus) root.querySelector(`${refocus}:not([disabled])`)?.focus({ preventScroll: true });
    },
    destroy() {
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
      root.remove();
      sprite.remove();
    },
  };
}

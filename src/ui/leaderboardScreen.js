import { openSheet } from './sheet.js';
import { leaderboardHtml, spoilsSheetHtml } from './leaderboardView.js';

/**
 * The leaderboard's place on the page: a screen drawn as page elements (not in the game canvas), filling the space under the
 * page header so the header's wallet button stays where it is. What it shows comes from leaderboardView.js; the scene
 * (scenes/LeaderboardScene.js) feeds it and carries out the taps.
 *
 * @param {{ host: HTMLElement, sheets: HTMLElement, onAction: (act: string, el: HTMLElement) => void }} deps
 *   `host` is where screens go (#ms-menu), `sheets` where sheets go (#ms-sheets)
 */
export function createLeaderboardScreen({ host, sheets, onAction }) {
  const root = document.createElement('div');
  root.className = 'lb';
  host.innerHTML = '';
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

  let sheet = null;
  return {
    /** Draw the model, keeping the list where the player had scrolled it. */
    render(model) {
      const before = root.querySelector('.lb-scroll');
      const scrolled = before ? before.scrollTop : 0;
      root.innerHTML = leaderboardHtml(model);
      const after = root.querySelector('.lb-scroll');
      if (after) after.scrollTop = scrolled;
    },
    openSpoils(model) {
      sheet = openSheet(sheets, { title: 'Daily Spoils', name: 'spoils', body: spoilsSheetHtml(model) });
    },
    destroy() {
      sheet?.close();
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
      root.remove();
    },
  };
}

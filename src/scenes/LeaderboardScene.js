import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';
import { gdService } from '../engine/GdService.js';
import { pauseService } from '../engine/PauseService.js';
import { fetchDailyBoard, fetchAllTimeBoard, fetchConfig, getBoardView, setBoardView } from '../gd/leaderboard.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { getAddress } from '../gd/session.js';
import { createLeaderboardScreen } from '../ui/leaderboardScreen.js';
import { leaderboardModel, loadErrorText } from '../ui/leaderboardView.js';

/**
 * The leaderboard. The list and the buttons are page elements under the page header (src/ui/leaderboardScreen.js), so this
 * scene is a thin shell: it loads the boards, gives the screen its data (src/ui/leaderboardView.js), carries out what the
 * player taps, and tidies up when the player leaves. The game canvas stays idle behind the screen.
 */
export default class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LeaderboardScene' });
  }

  create() {
    pauseService.detachScene();
    this.cameras.main.resetFX();
    sound.playBGM('title');
    if (typeof window !== 'undefined') window.touchController?.hide();

    this.tab = 'alltime';
    this.load = { state: 'loading' };
    this.boards = { daily: null, alltime: null, cfg: null, rewards: null };
    this.loadId = (this.loadId || 0) + 1;

    const el = (id) => document.getElementById(id);
    this.screen = createLeaderboardScreen({ host: el('ms-menu'), sheets: el('ms-sheets'), onAction: (act, target) => this.onAction(act, target) });
    this.stopWatching = gdService.subscribe(() => this.draw());
    // Esc goes back to the menu, unless it is closing a sheet (caught before the sheet's own handler runs)
    this.onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('#ms-sheets .sheet:not(.out)')) this.goMenu();
    };
    document.addEventListener('keydown', this.onKey, true);
    this.events.once('shutdown', () => this.teardown());

    this.loadBoards();
  }

  /** True once the boards have come back (the screen shows them, or says why it cannot). */
  get boardsReady() {
    return this.load?.state === 'ready';
  }

  /** Whether this server pays the daily prizes and the Shard Harvest (PRIZES_ENABLED). Unknown counts as no. */
  prizesOn() {
    return (this.boards.cfg?.prizesEnabled ?? gdService.getStatus().prizes) === true;
  }

  model() {
    return leaderboardModel({
      tab: this.tab, view: getBoardView(), load: this.load, ...this.boards,
      status: gdService.getStatus(), myWallet: getAddress(), prizesOn: this.prizesOn(),
    });
  }

  draw() {
    this.screen?.render(this.model());
  }

  async loadBoards() {
    const id = (this.loadId = (this.loadId || 0) + 1);
    this.load = { state: 'loading' };
    this.draw();
    try {
      const [daily, alltime, cfg, rewards] = await Promise.all([
        fetchDailyBoard(),
        fetchAllTimeBoard(),
        // only supplies the prize amounts in the daily header (the daily board repeats them): never a reason to hide the boards
        fetchConfig().catch(() => null),
        fetchRewardsStatus().catch(() => null),
      ]);
      if (id !== this.loadId || !this.screen) return; // the player left, or asked again, while the boards loaded
      this.boards = { daily, alltime, cfg, rewards };
      this.load = { state: 'ready' };
    } catch (err) {
      if (id !== this.loadId || !this.screen) return;
      this.load = { state: 'error', error: loadErrorText(err) };
    }
    this.draw();
  }

  onAction(act, target) {
    switch (act) {
      case 'tab':
        if (this.tab !== target.dataset.tab) {
          sound.playBlip(true);
          this.tab = target.dataset.tab === 'daily' ? 'daily' : 'alltime';
          this.draw();
        }
        break;
      case 'view':
        sound.playBlip(true);
        setBoardView(getBoardView() === 'ranked' ? 'open' : 'ranked');
        this.loadBoards();
        break;
      case 'retry':
        this.loadBoards();
        break;
      case 'wallet':
        window.__gdPanel?.open();
        break;
      case 'spoils':
        this.screen.openSpoils(this.model());
        break;
      case 'menu':
        this.goMenu();
        break;
      case 'endless':
        sound.playCoin();
        this.scene.start('SurvivalScene');
        break;
      default:
    }
  }

  goMenu() {
    sound.playCoin();
    this.scene.start('MenuScene');
  }

  teardown() {
    this.loadId += 1; // a load still on its way is dropped
    document.removeEventListener('keydown', this.onKey, true);
    this.stopWatching?.();
    this.stopWatching = null;
    this.screen?.destroy();
    this.screen = null;
  }
}

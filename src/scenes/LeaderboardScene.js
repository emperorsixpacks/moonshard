import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { gdService } from '../engine/GdService.js';
import { pauseService } from '../engine/PauseService.js';
import { fetchDailyBoard, fetchAllTimeBoard, fetchConfig, getBoardView, setBoardView } from '../gd/leaderboard.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { identiconDataUrl } from '../gd/identicon.js';
import { getAddress } from '../gd/session.js';
import { positiveNumber, prizeLabel, rewardsPillText, secondsLabel, shortAddress, spoilsPanelDetail } from '../ui/leaderboardText.js';

/*
 * Positions and sizes for the two canvases (480x270 landscape, 480x440 tall), in game units.
 *
 * A text hint of 7px or more is drawn in the pixel font at that size; a smaller hint is drawn in VT323 at 2.3x the hint
 * (engine/typography.js), so '6.3px' is a 14.5-unit VT323 line and '14px' is a 14-unit pixel-font heading.
 * The tall canvas is the one shown upright on a phone, at about 0.81 CSS px per unit, so its sizes are picked to read as
 * >= 9 CSS px for captions, >= 10 for body text and >= 11 for headings there. The landscape canvas is shown at 1.4 to
 * 2.1 CSS px per unit, where the sizes below are already large enough.
 *
 * `col` are x offsets from the middle of the screen, one per table column: the header label and the cells of a column
 * are centred on the same x.
 */
const LAYOUT = {
  land: {
    title: { y: 14, size: '10px' },
    back: { x: 60, y: 14, w: 78, h: 20, size: '6px' },
    tab: { y: 31, w: 104, h: 16, dx: 58, size: '5.5px' },
    // the wallet button floats over the top right corner of the canvas on a phone held sideways: keep clear of it
    toggle: { y: 33, right: 14, size: '4.5px', pad: 0 },
    prizes: { y: 47, size: '4.8px' },
    band: { y: 56, yDaily: 63, w: 390, h: 14, size: '5.5px' },
    col: { rank: -180, avatar: -158, name: -120, time: 10, score: 65, honors: 140 },
    fit: { name: 62, time: 32, score: 72, honors: 56 },
    row: { y: 72, yDaily: 81, pitch: 19, h: 18, max: 7, w: 390, rank: '6px', name: '5.5px', time: '5.5px', score: '6px', honors: '5.5px', avatar: 12 },
    empty: { y: 130, size: '7px', hintY: 148, hint: '4.5px' },
    footer: { status: 207, pill: 218, spoils: 229, statusSize: '4.5px', pillSize: '4.2px', spoilsSize: '4.5px' },
    bar: { dy: 22, h: 20, back: { x: 55, w: 75, size: '5.5px' }, play: { x: 155, w: 95, size: '5.5px' }, spoils: { right: 68, w: 105, size: '5.2px' } },
    tip: { size: '4px', dy: -46 },
    spoilsPanel: { y: 197, w: 380, h: 78, titleDy: -26, title: '5.5px', detail: '4.5px', detailDy: 6, spacing: 4 },
    error: { y: 130, size: '4.5px', wrap: 360 },
    loading: { size: '6px' },
  },
  tall: {
    title: { y: 22, size: '14px' },
    back: { x: 62, y: 22, w: 96, h: 30, size: '6.5px' },
    tab: { y: 62, w: 104, h: 30, dx: 56, size: '6.5px' },
    toggle: { y: 62, right: 14, size: '6.3px', pad: 6 },
    prizes: { y: 92, size: '6.2px' },
    band: { y: 96, yDaily: 112, w: 448, h: 22, size: '6.3px' },
    col: { rank: -200, avatar: -172, name: -118, time: -10, score: 78, honors: 172 },
    fit: { name: 80, time: 50, score: 96, honors: 78 },
    row: { y: 120, yDaily: 136, pitch: 24, h: 22, max: 9, w: 448, rank: '6.8px', name: '6.3px', time: '6.3px', score: '6.8px', honors: '6.3px', avatar: 18 },
    empty: { y: 190, size: '12px', hintY: 216, hint: '6.3px' },
    footer: { status: 354, pill: 371, spoils: 388, statusSize: '6.3px', pillSize: '6.3px', spoilsSize: '6.3px' },
    bar: { dy: 22, h: 30, back: { x: 62, w: 96, size: '6.3px' }, play: { x: 180, w: 128, size: '6.3px' }, spoils: { right: 76, w: 136, size: '6.3px' } },
    tip: { size: '6.3px', dy: -38 },
    spoilsPanel: { y: 343, w: 448, h: 112, titleDy: -38, title: '6.8px', detail: '6.3px', detailDy: 12, spacing: 5 },
    error: { y: 190, size: '6.5px', wrap: 420 },
    loading: { size: '6.8px' },
  },
};

const FALLBACK_BOARD = { entries: [], prizesG: [] };
/** Side of the identicon texture, in pixels: four per cell of its 5x5 grid. */
const AVATAR_PX = 20;

export default class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LeaderboardScene' });
  }

  async create() {
    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    this.layoutSize = { w, h };
    this.lastScore = 0;
    this.activeTab = 'alltime';
    this.boardsReady = false;
    this.chrome = [];
    this.tabButtons = [];
    this.spoilsPanel = null;
    this.errorText = null;
    // Which call of create() is current: a load that finishes after the scene was restarted or left is dropped
    const load = (this.loadId = (this.loadId || 0) + 1);
    pauseService.detachScene();
    sound.playBGM('title');

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    this.bgTile = this.add.tileSprite(0, 0, w, h, 'env_bg').setOrigin(0, 0).setTint(0x334433).setDepth(0);
    // the backdrop picture is as tall as the landscape canvas: stretch it over the tall one instead of repeating it
    this.bgTile.tileScaleY = h > 270 ? h / 270 : 1;
    this.boardLayer = this.add.container(0, 0).setDepth(10);

    this.buildChrome(w, h);

    if (this.input?.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => this.scene.start('MenuScene'));
    }

    const L = this.layout(h);
    this.loadingText = this.add.text(w / 2, h / 2, 'LOADING SCORES…', {
      fontFamily: 'Press Start 2P',
      fontSize: L.loading.size,
      color: '#8cb38c'
    }).setOrigin(0.5).setDepth(25);

    let loaded;
    try {
      loaded = await Promise.all([
        fetchDailyBoard(),
        fetchAllTimeBoard(),
        // only supplies the prize amounts in the daily header (the daily board repeats them): never a reason to hide the boards
        fetchConfig().catch(() => null),
        fetchRewardsStatus().catch(() => null),
      ]);
    } catch (err) {
      if (load !== this.loadId || !this.sys.isActive()) return;
      this.loadingText?.destroy();
      this.showError(err?.status === 0
        ? "Can't reach the server. The boards are unavailable right now."
        : 'The boards are unavailable right now. Try again in a moment.');
      return;
    }
    if (load !== this.loadId || !this.sys.isActive()) return; // the scene was restarted or left while the boards loaded

    const [daily, alltime, cfg, rewards] = loaded;
    this.daily = daily;
    this.alltime = alltime;
    this.cfg = cfg;
    this.rewardsStatus = rewards;
    this.loadingText?.destroy();
    this.boardsReady = true;
    this.setActiveTab('alltime');
  }

  layout(h) {
    return h > 300 ? LAYOUT.tall : LAYOUT.land;
  }

  /** Remembers a game object of the header, tabs or bottom bar, so a change of canvas can rebuild them. */
  keep(obj) {
    this.chrome.push(obj);
    return obj;
  }

  /** Title, back buttons, tabs, view switch and bottom bar: everything that does not depend on the loaded boards. */
  buildChrome(w, h) {
    this.chrome.forEach((obj) => obj.destroy());
    this.chrome = [];
    this.tabButtons = [];
    const L = this.layout(h);

    this.titleText = this.keep(this.add.text(w / 2, L.title.y, '⚡ LEADERBOARD', {
      fontFamily: 'Press Start 2P',
      fontSize: L.title.size,
      color: '#f6c026',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(15));

    this.buildTabs(w, L);
    this.renderBottomBar(w, h);
    this.addHeaderBackButton(L);
  }

  buildTabs(w, L) {
    const y = L.tab.y;

    const mkTab = (key, label, x) => {
      const bg = this.keep(this.add.rectangle(x, y, L.tab.w, L.tab.h, 0x142014).setStrokeStyle(1, 0x3c6e3c).setDepth(15).setInteractive({ useHandCursor: true }));
      const txt = this.keep(this.add.text(x, y, label, { fontFamily: 'Press Start 2P', fontSize: L.tab.size, color: '#a0c4a0' }).setOrigin(0.5).setDepth(16));
      const setHover = (on) => {
        if (this.activeTab === key) return;
        bg.setFillStyle(on ? 0x1e3320 : 0x142014);
      };
      bg.on('pointerover', () => setHover(true));
      bg.on('pointerout', () => setHover(false));
      const activate = () => {
        if (this.activeTab === key || !this.boardsReady) return;
        sound.playBlip(true);
        this.setActiveTab(key);
      };
      bg.on('pointerdown', activate);
      txt.setInteractive({ useHandCursor: true });
      txt.on('pointerdown', activate);
      this.tabButtons.push({ key, bg, txt });
    };

    mkTab('alltime', 'ALL-TIME', w / 2 - L.tab.dx);
    mkTab('daily', 'DAILY', w / 2 + L.tab.dx);

    const toggle = this.keep(this.add.text(w - L.toggle.right, L.toggle.y, getBoardView() === 'ranked' ? 'VIEW: VERIFIED ▸' : 'VIEW: OPEN ▸', {
      fontFamily: 'Press Start 2P',
      fontSize: L.toggle.size,
      color: '#38e1ff',
      padding: { x: L.toggle.pad, y: L.toggle.pad } // a bigger tap target; the glyphs stay where they are
    }).setOrigin(1, 0.5).setDepth(30).setInteractive({ useHandCursor: true }));
    toggle.on('pointerdown', () => {
      setBoardView(getBoardView() === 'ranked' ? 'open' : 'ranked');
      this.scene.restart();
    });

    if (this.activeTab) this.styleTabs(this.activeTab);
  }

  styleTabs(tab) {
    for (const t of this.tabButtons) {
      const active = t.key === tab;
      t.bg.setFillStyle(active ? 0x284428 : 0x142014);
      t.bg.setStrokeStyle(1, active ? 0x98ff20 : 0x3c6e3c);
      t.txt.setColor(active ? '#f6c026' : '#a0c4a0');
    }
  }

  setActiveTab(tab) {
    this.activeTab = tab;
    this.rebuildBoard();
    this.styleTabs(tab);
  }

  /** Whether this server pays the daily prizes and the Shard Harvest (PRIZES_ENABLED). Unknown counts as no. */
  prizesOn() {
    return (this.cfg?.prizesEnabled ?? gdService.getStatus().prizes) === true;
  }

  /** The three daily prize amounts, from the config or else from the daily board itself, or null when neither has them. */
  dailyPrizes() {
    for (const source of [this.cfg?.prizesG, this.daily?.prizesG]) {
      if (!Array.isArray(source) || source.length < 3) continue;
      const top = source.slice(0, 3);
      if (top.every((p) => positiveNumber(p) !== null)) return top.map(String);
    }
    return null;
  }

  rebuildBoard() {
    this.boardLayer.removeAll(true);

    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    const L = this.layout(h);
    const isDaily = this.activeTab === 'daily';
    const board = isDaily ? (this.daily || FALLBACK_BOARD) : (this.alltime || FALLBACK_BOARD);
    const entries = Array.isArray(board.entries) ? board.entries : [];

    const prizes = isDaily ? this.dailyPrizes() : null;
    if (prizes) {
      this.addToLayer(w / 2, L.prizes.y, `🏆 DAILY PRIZES: 1st ${prizes[0]} | 2nd ${prizes[1]} | 3rd ${prizes[2]} G$ • verified humans only`, L.prizes.size, '#ffd166', 2);
    }

    const headerY = isDaily ? L.band.yDaily : L.band.y;
    const headerBand = this.add.rectangle(w / 2, headerY, L.band.w, L.band.h, 0x142014).setStrokeStyle(1, 0x2e4e2e);
    this.boardLayer.add(headerBand);
    // One label per column, centred over the same x positions the rows use (a single long string centred at
    // x = w/2 - 180 ran off the left edge of the screen).
    [['RANK', L.col.rank], ['WARRIOR', L.col.name], ['TIME', L.col.time], ['SCORE', L.col.score], [isDaily ? 'HONORS' : 'LEGEND', L.col.honors]]
      .forEach(([label, dx]) => this.addToLayer(w / 2 + dx, headerY, label, L.band.size, '#8cb38c'));

    const myWallet = getAddress();
    const rows = entries.map((e, i) => ({
      rank: i + 1,
      name: shortAddress(e.wallet),
      score: e.score,
      time: secondsLabel(e.durationMs),
      prize: prizeLabel(i, isDaily && getBoardView() === 'ranked' ? board.prizesG?.[i] : null),
      isPlayer: e.wallet === myWallet,
      wallet: e.wallet,
    }));

    const rowStartY = isDaily ? L.row.yDaily : L.row.y;

    if (rows.length === 0) {
      this.addToLayer(w / 2, L.empty.y, isDaily ? 'NO VERIFIED RUNS TODAY' : 'NO VERIFIED RUNS YET', L.empty.size, '#8cb38c');
      this.addToLayer(w / 2, L.empty.hintY, 'Play a Trial and your verified score appears here.', L.empty.hint, '#a0b8a0');
    } else {
      rows.slice(0, L.row.max).forEach((row, idx) => {
        const y = rowStartY + idx * L.row.pitch;
        const rowBox = this.add.rectangle(w / 2, y, L.row.w, L.row.h, row.isPlayer ? 0x223d22 : 0x111e11)
          .setStrokeStyle(1, row.isPlayer ? 0x98ff20 : 0x223822);
        rowBox.setInteractive({ useHandCursor: true });
        this.boardLayer.add(rowBox);
        if (row.wallet) this.attachWalletTooltip(rowBox, `Address: ${row.wallet}`, L.tip);

        this.addToLayer(w / 2 + L.col.rank, y, `${idx + 1}.`, L.row.rank,
          idx === 0 ? '#ffd700' : (idx === 1 ? '#e0e0e0' : (idx === 2 ? '#cd7f32' : '#888')));

        // Identicon avatar thumbnail
        if (row.wallet) this.addAvatar(w / 2 + L.col.avatar, y, row.wallet, L.row.avatar);

        this.addToLayer(w / 2 + L.col.name, y, row.name, L.row.name, row.isPlayer ? '#98ff20' : '#ffffff', 0, L.fit.name);
        this.addToLayer(w / 2 + L.col.time, y, row.time, L.row.time, '#a0b8a0', 0, L.fit.time);
        this.addToLayer(w / 2 + L.col.score, y, `${row.score} pts`, L.row.score, '#ffd700', 0, L.fit.score);
        this.addToLayer(w / 2 + L.col.honors, y, row.prize, L.row.honors, '#e9b213', 0, L.fit.honors);
      });
    }

    this.renderPlayerStatus(w, h, myWallet, isDaily);
    if (isDaily && this.prizesOn()) this.renderSpoilsStatus(w, h);
    // the Spoils button belongs to the prizes: shown, and tappable, only while the server pays them
    for (const part of [this.spoilsBtn, this.spoilsTxt]) part?.setVisible(this.prizesOn());
    if (this.spoilsBtn?.input) this.spoilsBtn.input.enabled = this.prizesOn();
  }

  /** The wallet's identicon in a `size` x `size` square, with a dot in its place until the picture has loaded. */
  addAvatar(x, y, wallet, size) {
    const texKey = `identicon_${wallet}`;
    if (this.textures && this.textures.exists(texKey)) {
      this.boardLayer.add(this.add.image(x, y, texKey).setDisplaySize(size, size).setOrigin(0.5));
      return;
    }
    const dot = this.add.circle(x, y, size / 3, 0x38e1ff, 0.7);
    this.boardLayer.add(dot);
    // The texture is added asynchronously: the picture can only be made once it says it is there
    this.textures.once(Phaser.Textures.Events.ADD_KEY + texKey, () => {
      if (!dot.active) return;
      const avatar = this.add.image(dot.x, dot.y, texKey).setDisplaySize(size, size).setOrigin(0.5);
      this.boardLayer.add(avatar);
      dot.destroy();
    });
    this.avatarsRequested = this.avatarsRequested || new Set();
    if (this.avatarsRequested.has(texKey)) return;
    this.avatarsRequested.add(texKey);
    identiconDataUrl(wallet).then(rasterise).then((canvas) => {
      if (!this.textures.exists(texKey)) this.textures.addCanvas(texKey, canvas);
    }).catch(() => { this.avatarsRequested.delete(texKey); });
  }

  /** Adds centred text to the board. A `maxWidth` shrinks a value that is longer than its column has room for. */
  addToLayer(x, y, text, fontSize, color, strokeThickness = 0, maxWidth = 0) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Press Start 2P',
      fontSize,
      color,
      stroke: strokeThickness ? '#000000' : undefined,
      strokeThickness,
    }).setOrigin(0.5);
    if (maxWidth > 0 && t.width > maxWidth) t.setScale(maxWidth / t.width);
    this.boardLayer.add(t);
    return t;
  }

  attachWalletTooltip(obj, text, tip) {
    const tipText = this.add.text(obj.x, obj.y + tip.dy, text, {
      fontFamily: 'Press Start 2P',
      fontSize: tip.size,
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5).setDepth(900).setVisible(false);
    obj.on('pointerover', () => tipText.setVisible(true));
    obj.on('pointerout', () => tipText.setVisible(false));
    obj.once('destroy', () => tipText.destroy());
  }

  renderPlayerStatus(w, h, myWallet, isDaily) {
    const L = this.layout(h);
    const status = gdService.getStatus();
    let line;
    if (!myWallet) {
      line = '⚡ Not connected — tap to connect a wallet and join the board.';
    } else if (!status.verified) {
      line = `🛡 ${status.shortAddress} — verify you are human to compete for G$ prizes (tap).`;
    } else {
      const myRow = (isDaily ? this.daily : this.alltime)?.entries?.find((e) => e.wallet === myWallet);
      line = myRow
        ? `✔ ${status.shortAddress} — you're rank #${myRow.rank}${myRow.rank <= 3 ? ' 🏆' : ''}`
        : `✔ ${status.shortAddress} — verified. Play a Trial to claim a spot.`;
    }
    const lineObj = this.add.text(w / 2, L.footer.status, line, {
      fontFamily: 'Press Start 2P',
      fontSize: L.footer.statusSize,
      color: '#a0c4a0',
      stroke: '#000000',
      strokeThickness: 2,
      padding: { x: 6, y: 3 } // a bigger tap target
    }).setOrigin(0.5);
    lineObj.setInteractive({ useHandCursor: true });
    lineObj.on('pointerdown', () => {
      window.__gdPanel?.open();
    });
    this.boardLayer.add(lineObj);

    // If connected, show player's personal rewards status pill
    if (myWallet && this.rewardsStatus) {
      const rewardsPill = rewardsPillText(this.rewardsStatus);
      const isCapped = Boolean(this.rewardsStatus.crystalStatus?.isCapped);
      this.addToLayer(w / 2, L.footer.pill, rewardsPill, L.footer.pillSize, isCapped ? '#f59e0b' : '#ffd700', 1);
    }
  }

  renderSpoilsStatus(w, h) {
    const L = this.layout(h);
    this.addToLayer(w / 2, L.footer.spoils, 'Spoils settle after UTC midnight — redeem them in the G$ wallet (header).', L.footer.spoilsSize, '#8cb38c', 2);
  }

  renderBottomBar(w, h) {
    this.bottomBarLayer = this.keep(this.add.container(0, 0).setDepth(20));

    const B = this.layout(h).bar;
    const barY = h - B.dy;

    const backBtn = this.add.rectangle(B.back.x, barY, B.back.w, B.h, 0x1e331e).setStrokeStyle(1, 0x3d5c3d).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(B.back.x, barY, '◄ MENU', { fontFamily: 'Press Start 2P', fontSize: B.back.size, color: '#fff' }).setOrigin(0.5);
    backBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    });
    this.bottomBarLayer.add(backBtn);
    this.bottomBarLayer.add(backTxt);

    const playBtn = this.add.rectangle(B.play.x, barY, B.play.w, B.h, 0x224422).setStrokeStyle(1, 0x98ff20).setInteractive({ useHandCursor: true });
    const playTxt = this.add.text(B.play.x, barY, 'PLAY ENDLESS', { fontFamily: 'Press Start 2P', fontSize: B.play.size, color: '#f6c026' }).setOrigin(0.5);
    playBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('SurvivalScene');
    });
    this.bottomBarLayer.add(playBtn);
    this.bottomBarLayer.add(playTxt);

    const spoilsX = w - B.spoils.right;
    const spoilsBtn = this.add.rectangle(spoilsX, barY, B.spoils.w, B.h, 0x332814).setStrokeStyle(1, 0x8a6f2d).setInteractive({ useHandCursor: true });
    const spoilsTxt = this.add.text(spoilsX, barY, 'SPOILS STATUS', { fontFamily: 'Press Start 2P', fontSize: B.spoils.size, color: '#ffd166' }).setOrigin(0.5);
    spoilsBtn.on('pointerdown', () => {
      this.toggleSpoilsPanel();
    });
    this.bottomBarLayer.add(spoilsBtn);
    this.bottomBarLayer.add(spoilsTxt);
    this.spoilsBtn = spoilsBtn;
    this.spoilsTxt = spoilsTxt;
    spoilsBtn.setVisible(this.prizesOn());
    spoilsTxt.setVisible(this.prizesOn());
    spoilsBtn.input.enabled = this.prizesOn();
  }

  addHeaderBackButton(L) {
    const { x, y, w, h, size } = L.back;
    const backBtn = this.keep(this.add.rectangle(x, y, w, h, 0x1a2e1a)
      .setStrokeStyle(1, 0x3d5c3d)
      .setDepth(50)
      .setInteractive({ useHandCursor: true }));
    const backTxt = this.keep(this.add.text(x, y, '◄ MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: size,
      color: '#fff'
    }).setOrigin(0.5).setDepth(51));
    const goBack = () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    };
    backBtn.on('pointerdown', goBack);
    backTxt.setInteractive({ useHandCursor: true });
    backTxt.on('pointerdown', goBack);
    this.headerBackBtn = backBtn;
    this.headerBackTxt = backTxt;
  }

  onViewportResize(w, h) {
    // Compared with the canvas the scene was laid out for: by the time this is called the camera has already been
    // resized by the scale manager, so comparing with the camera would never see a change.
    if (this.layoutSize && this.layoutSize.w === w && this.layoutSize.h === h) return;
    this.layoutSize = { w, h };
    if (this.bgTile) {
      this.bgTile.setSize(w, h);
      this.bgTile.tileScaleY = h > 270 ? h / 270 : 1;
    }
    this.buildChrome(w, h);
    const L = this.layout(h);
    this.loadingText?.setPosition(w / 2, h / 2);
    if (this.errorText) this.errorText.setPosition(w / 2, L.error.y);
    if (this.boardsReady) this.setActiveTab(this.activeTab);
    if (this.spoilsPanel) {
      // the panel is sized for the canvas: close it and open it again on the new one
      this.toggleSpoilsPanel();
      this.toggleSpoilsPanel();
    }
  }

  toggleSpoilsPanel() {
    if (this.spoilsPanel) {
      this.spoilsPanel.destroy();
      this.spoilsPanel = null;
      return;
    }
    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    const P = this.layout(h).spoilsPanel;
    // One container holds the whole panel, so that closing it takes everything away
    const panel = this.add.container(w / 2, P.y).setDepth(300);
    panel.add(this.add.rectangle(0, 0, P.w, P.h, 0x141c14).setStrokeStyle(1, 0xe9b213));
    panel.add(this.add.text(0, P.titleDy, 'DAILY SPOILS SETTLEMENT', {
      fontFamily: 'Press Start 2P', fontSize: P.title, color: '#ffd166'
    }).setOrigin(0.5));
    // the amounts are the server's own (the prizes from /config or the daily board, the cap from the player's rewards); a figure it did not send is left out
    const detail = spoilsPanelDetail({ prizes: this.dailyPrizes(), shardCapG: this.rewardsStatus?.crystalStatus?.dailyCapGd });
    panel.add(this.add.text(0, P.detailDy, detail, {
      fontFamily: 'Press Start 2P', fontSize: P.detail, color: '#a0c4a0', align: 'center', lineSpacing: P.spacing
    }).setOrigin(0.5));
    this.spoilsPanel = panel;
  }

  showError(msg) {
    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    const E = this.layout(h).error;
    this.errorText = this.add.text(w / 2, E.y, msg, {
      fontFamily: 'Press Start 2P',
      fontSize: E.size,
      color: '#d06a6a',
      align: 'center',
      wordWrap: { width: E.wrap }
    }).setOrigin(0.5).setDepth(25);
  }
}

/**
 * Draws an SVG picture (a data URL) onto a small canvas. The identicon SVG has no size of its own, and the browser refuses
 * to upload such an image to the GPU as a texture (it showed up black); a canvas it can.
 */
function rasterise(dataUrl, size = AVATAR_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('identicon failed to load'));
    img.src = dataUrl;
  });
}

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { gdService } from '../engine/GdService.js';
import { pauseService } from '../engine/PauseService.js';
import { fetchDailyBoard, fetchAllTimeBoard, fetchConfig, getBoardView, setBoardView } from '../gd/leaderboard.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { identiconDataUrl } from '../gd/identicon.js';
import { getAddress } from '../gd/session.js';


export default class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LeaderboardScene' });
  }

  async create() {
    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    this.lastScore = 0;
    this.activeTab = 'alltime';
    pauseService.detachScene();
    sound.playBGM('title');

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    this.bgTile = this.add.tileSprite(0, 0, w, h, 'env_bg').setOrigin(0, 0).setTint(0x334433).setDepth(0);
    this.boardLayer = this.add.container(0, 0).setDepth(10);
    this.bottomBarLayer = this.add.container(0, 0).setDepth(20);

    this.titleText = this.add.text(w / 2, 14, '⚡ LEADERBOARD', {
      fontFamily: 'Press Start 2P',
      fontSize: '10px',
      color: '#f6c026',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(15);

    this.buildTabs();
    this.renderBottomBar(w, h);
    this.addHeaderBackButton(w);

    if (this.input?.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => this.scene.start('MenuScene'));
    }

    this.loadingText = this.add.text(w / 2, h / 2, 'LOADING SCORES…', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',

      color: '#8cb38c'
    }).setOrigin(0.5).setDepth(25);

    try {
      const [daily, alltime, cfg, rewards] = await Promise.all([
        fetchDailyBoard(),
        fetchAllTimeBoard(),
        fetchConfig(),
        fetchRewardsStatus().catch(() => null),
      ]);
      this.daily = daily;
      this.alltime = alltime;
      this.cfg = cfg;
      this.rewardsStatus = rewards;
      this.loadingText?.destroy();
      this.setActiveTab('alltime');
    } catch (err) {
      this.loadingText?.destroy();
      this.showError(`Server unreachable — board unavailable (${err?.message || 'error'})`);
    }

  }

  buildTabs() {
    const w = GAME_CONFIG.WIDTH;
    const y = 31;
    this.tabButtons = [];

    const mkTab = (key, label, x) => {
      const bg = this.add.rectangle(x, y, 104, 16, 0x142014).setStrokeStyle(1, 0x3c6e3c).setDepth(15).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, y, label, { fontFamily: 'Press Start 2P', fontSize: '5.5px', color: '#a0c4a0' }).setOrigin(0.5).setDepth(16);
      const setHover = (on) => {
        if (this.activeTab === key) return;
        bg.setFillStyle(on ? 0x1e3320 : 0x142014);
      };
      bg.on('pointerover', () => setHover(true));
      bg.on('pointerout', () => setHover(false));
      const activate = () => {
        if (this.activeTab === key) return;
        sound.playBlip(true);
        this.setActiveTab(key);
      };
      bg.on('pointerdown', activate);
      txt.setInteractive({ useHandCursor: true });
      txt.on('pointerdown', activate);
      this.tabButtons.push({ key, bg, txt });
    };

    mkTab('alltime', 'ALL-TIME', w / 2 - 58);
    mkTab('daily', 'DAILY', w / 2 + 58);

    const toggle = this.add.text(w - 14, y - 5, getBoardView() === 'ranked' ? 'VIEW: VERIFIED ▸' : 'VIEW: OPEN ▸', {
      fontFamily: 'Press Start 2P', fontSize: '4.5px', color: '#38e1ff',
    }).setOrigin(1, 0.5).setDepth(30).setInteractive({ useHandCursor: true });
    toggle.on('pointerdown', () => {
      setBoardView(getBoardView() === 'ranked' ? 'open' : 'ranked');
      this.scene.restart();
    });
  }

  setActiveTab(tab) {
    this.activeTab = tab;
    this.rebuildBoard();
    for (const t of this.tabButtons) {
      const active = t.key === tab;
      t.bg.setFillStyle(active ? 0x284428 : 0x142014);
      t.bg.setStrokeStyle(1, active ? 0x98ff20 : 0x3c6e3c);
      t.txt.setColor(active ? '#f6c026' : '#a0c4a0');
    }
  }

  rebuildBoard() {
    this.boardLayer.removeAll(true);

    const w = this.cameras?.main?.width || this.scale?.width || GAME_CONFIG.WIDTH;
    const h = this.cameras?.main?.height || this.scale?.height || GAME_CONFIG.HEIGHT;
    const isPortrait = h > 300;
    const isDaily = this.activeTab === 'daily';
    const board = isDaily ? (this.daily || { entries: [], prizesG: [] }) : (this.alltime || { entries: [] });

    if (isDaily && this.cfg) {
      const prizes = Array.isArray(this.cfg.prizesG) ? this.cfg.prizesG : ['1000', '600', '300'];
      this.addToLayer(w / 2, 48, `🏆 DAILY PRIZES: 1st ${prizes[0]} | 2nd ${prizes[1]} | 3rd ${prizes[2]} G$ • verified humans only`, '4.8px', '#ffd166', 2);
    }

    const headerY = isDaily ? 62 : 56;
    const headerBand = this.add.rectangle(w / 2, headerY, 390, 14, 0x142014).setStrokeStyle(1, 0x2e4e2e);
    this.boardLayer.add(headerBand);
    // One label per column, centred over the same x positions the rows use (a single long string centred at
    // x = w/2 - 180 ran off the left edge of the screen).
    [['RANK', -180], ['WARRIOR', -120], ['TIME', 10], ['SCORE', 65], [isDaily ? 'HONORS' : 'LEGEND', 140]]
      .forEach(([label, dx]) => this.addToLayer(w / 2 + dx, headerY - 3, label, '5.5px', '#8cb38c'));

    const myWallet = getAddress();
    const rows = board.entries.map((e, i) => ({
      rank: i + 1,
      name: shortAddress(e.wallet),
      score: e.score,
      time: secondsLabel(e.durationMs),
      prize: prizeLabel(i, isDaily && getBoardView() === 'ranked' ? board.prizesG?.[i] : null),
      isPlayer: e.wallet === myWallet,
      wallet: e.wallet,
    }));

    const rowStartY = isDaily ? 80 : 72;
    const maxRows = isPortrait ? 9 : 7;
    const rowSpacing = isPortrait ? 22 : 19;

    if (rows.length === 0) {
      this.addToLayer(w / 2, isPortrait ? 180 : 130, isDaily ? 'NO VERIFIED RUNS TODAY' : 'NO VERIFIED RUNS YET', '7px', '#8cb38c');
      this.addToLayer(w / 2, isPortrait ? 200 : 148, 'Play a Trial and your verified score appears here.', '4.5px', '#a0b8a0');
    } else {
      rows.slice(0, maxRows).forEach((row, idx) => {
        const y = rowStartY + idx * rowSpacing;
        const rowBox = this.add.rectangle(w / 2, y, 390, isPortrait ? 20 : 18, row.isPlayer ? 0x223d22 : 0x111e11)
          .setStrokeStyle(1, row.isPlayer ? 0x98ff20 : 0x223822);
        rowBox.setInteractive({ useHandCursor: true });
        this.boardLayer.add(rowBox);
        if (row.wallet) this.attachWalletTooltip(rowBox, `Address: ${row.wallet}`);

        this.addToLayer(w / 2 - 180, y - 3, `${idx + 1}.`, '6px',
          idx === 0 ? '#ffd700' : (idx === 1 ? '#e0e0e0' : (idx === 2 ? '#cd7f32' : '#888')));

        // Identicon avatar thumbnail
        if (row.wallet) {
          const texKey = `identicon_${row.wallet}`;
          if (this.textures && this.textures.exists(texKey)) {
            const avatar = this.add.image(w / 2 - 158, y - 2, texKey).setDisplaySize(12, 12).setOrigin(0.5);
            this.boardLayer.add(avatar);
          } else {
            const dot = this.add.circle(w / 2 - 158, y - 2, 4, 0x38e1ff, 0.7);
            this.boardLayer.add(dot);
            identiconDataUrl(row.wallet).then((dataUrl) => {
              if (this.textures && !this.textures.exists(texKey)) {
                this.textures.addBase64(texKey, dataUrl);
              }
              if (dot && dot.active) {
                const avatar = this.add.image(dot.x, dot.y, texKey).setDisplaySize(12, 12).setOrigin(0.5);
                this.boardLayer.add(avatar);
                dot.destroy();
              }
            }).catch(() => {});
          }
        }

        this.addToLayer(w / 2 - 120, y - 3, row.name, '5.5px', row.isPlayer ? '#98ff20' : '#ffffff');
        this.addToLayer(w / 2 + 10, y - 3, row.time, '5.5px', '#a0b8a0');
        this.addToLayer(w / 2 + 65, y - 3, `${row.score} pts`, '6px', '#ffd700');
        this.addToLayer(w / 2 + 140, y - 3, row.prize, '5.5px', '#e9b213');
      });
    }

    this.renderPlayerStatus(w, h, myWallet, isDaily);
    if (isDaily) this.renderSpoilsStatus(w, h);
    this.renderBottomBar(w, h);
  }

  addToLayer(x, y, text, fontSize, color, strokeThickness = 0) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Press Start 2P',
      fontSize,
      color,
      stroke: strokeThickness ? '#000000' : undefined,
      strokeThickness,
    }).setOrigin(0.5);
    this.boardLayer.add(t);
    return t;
  }

  attachWalletTooltip(obj, text) {
    const tip = this.add.text(obj.x, obj.y - 46, text, {
      fontFamily: 'Press Start 2P',
      fontSize: '4px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5).setDepth(900).setVisible(false);
    obj.on('pointerover', () => tip.setVisible(true));
    obj.on('pointerout', () => tip.setVisible(false));
    obj.once('destroy', () => tip.destroy());
  }

  renderPlayerStatus(w, h, myWallet, isDaily) {
    const isPortrait = h > 300;
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
    const statusY = isPortrait ? h - 74 : 207;
    const lineObj = this.add.text(w / 2, statusY, line, {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#a0c4a0',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);
    lineObj.setInteractive({ useHandCursor: true });
    lineObj.on('pointerdown', () => {
      window.__gdPanel?.open();
    });
    this.boardLayer.add(lineObj);

    // If connected, show player's personal rewards status pill
    if (myWallet && this.rewardsStatus) {
      const bossText = this.rewardsStatus.firstBossClaimed ? `CLAIMED (+${this.rewardsStatus.firstBossPrizeG} G$)` : `UNCLAIMED (${this.rewardsStatus.firstBossPrizeG} G$)`;
      const cap = Number(this.rewardsStatus.crystalStatus?.dailyCapGd ?? 100);
      const earned = Number(this.rewardsStatus.crystalStatus?.gdEarned || 0).toFixed(0);
      const isCapped = Boolean(this.rewardsStatus.crystalStatus?.isCapped);
      const harvestText = isCapped ? `${earned} / ${cap.toFixed(0)} G$ (MAX 🔒)` : `${earned} / ${cap.toFixed(0)} G$`;
      const rewardsPill = `🏆 1st Boss: ${bossText}  |  💎 Harvest: ${harvestText}`;
      this.addToLayer(w / 2, isPortrait ? h - 60 : 218, rewardsPill, '4.2px', isCapped ? '#f59e0b' : '#ffd700', 1);
    }
  }

  renderSpoilsStatus(w, h) {
    const isPortrait = h > 300;
    this.addToLayer(w / 2, isPortrait ? h - 46 : 229, 'Spoils settle after UTC midnight — redeem them in the G$ wallet (header).', '4.5px', '#8cb38c', 2);
  }

  renderBottomBar(w, h) {
    if (this.bottomBarLayer) {
      this.bottomBarLayer.removeAll(true);
    } else {
      this.bottomBarLayer = this.add.container(0, 0).setDepth(20);
    }

    const isPortrait = h > 300;
    const barY = h - 22;

    const backBtn = this.add.rectangle(55, barY, 75, 20, 0x1e331e).setStrokeStyle(1, 0x3d5c3d).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(55, barY, '◄ MENU', { fontFamily: 'Press Start 2P', fontSize: '5.5px', color: '#fff' }).setOrigin(0.5);
    backBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    });
    this.bottomBarLayer.add(backBtn);
    this.bottomBarLayer.add(backTxt);

    const playBtn = this.add.rectangle(155, barY, 95, 20, 0x224422).setStrokeStyle(1, 0x98ff20).setInteractive({ useHandCursor: true });
    const playTxt = this.add.text(155, barY, 'PLAY ENDLESS', { fontFamily: 'Press Start 2P', fontSize: '5.5px', color: '#f6c026' }).setOrigin(0.5);
    playBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('SurvivalScene');
    });
    this.bottomBarLayer.add(playBtn);
    this.bottomBarLayer.add(playTxt);

    const spoilsBtn = this.add.rectangle(w - 68, barY, 105, 20, 0x332814).setStrokeStyle(1, 0x8a6f2d).setInteractive({ useHandCursor: true });
    const spoilsTxt = this.add.text(w - 68, barY, 'SPOILS STATUS', { fontFamily: 'Press Start 2P', fontSize: '5.2px', color: '#ffd166' }).setOrigin(0.5);
    spoilsBtn.on('pointerdown', () => {
      this.toggleSpoilsPanel();
    });
    this.bottomBarLayer.add(spoilsBtn);
    this.bottomBarLayer.add(spoilsTxt);
  }

  addHeaderBackButton(w) {
    const x = 60;
    const y = 14;
    const backBtn = this.add.rectangle(x, y, 78, 20, 0x1a2e1a)
      .setStrokeStyle(1, 0x3d5c3d)
      .setDepth(50)
      .setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(x, y, '◄ MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#fff'
    }).setOrigin(0.5).setDepth(51);
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
    if (this.bgTile) this.bgTile.setSize(w, h);
    if (this.titleText) this.titleText.setPosition(w / 2, 14);
    if (this.headerBackBtn && this.headerBackTxt) {
      this.headerBackBtn.setPosition(60, 14);
      this.headerBackTxt.setPosition(60, 14);
    }
    if (this.tabButtons) {
      this.tabButtons.forEach((t) => {
        if (t.key === 'alltime') {
          t.bg.setPosition(w / 2 - 58, 31);
          t.txt.setPosition(w / 2 - 58, 31);
        } else {
          t.bg.setPosition(w / 2 + 58, 31);
          t.txt.setPosition(w / 2 + 58, 31);
        }
      });
    }
    this.rebuildBoard();
  }

  toggleSpoilsPanel() {
    if (this.spoilsPanel) {
      this.spoilsPanel.destroy();
      this.spoilsPanel = null;
      return;
    }
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;
    const panel = this.add.rectangle(w / 2, 195, 380, 70, 0x141c14).setStrokeStyle(1, 0xe9b213).setDepth(300);
    this.add.text(w / 2, 172, 'DAILY SPOILS SETTLEMENT', {
      fontFamily: 'Press Start 2P', fontSize: '5px', color: '#ffd166'
    }).setOrigin(0.5).setDepth(301);
    const detail = 'Top-3 verified daily runs win 1000/600/300 G$ at UTC midnight.\n'
      + 'Shards you collect are paid as G$ too (up to 100 G$/day).\n'
      + 'Open the G$ wallet in the header to redeem your Spoils.';
    this.add.text(w / 2, 196, detail, {
      fontFamily: 'Press Start 2P', fontSize: '4px', color: '#a0c4a0', align: 'center', lineSpacing: 3
    }).setOrigin(0.5).setDepth(301);
    this.spoilsPanel = panel;
  }

  showError(msg) {
    this.add.text(GAME_CONFIG.WIDTH / 2, 130, msg, {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#d06a6a',
      align: 'center',
      wordWrap: { width: 360 }
    }).setOrigin(0.5).setDepth(25);
  }
}

function shortAddress(addr) {
  const clean = String(addr || '').replace(/\s+/g, '');
  if (clean.length < 10) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function secondsLabel(durationMs) {
  const s = Number(durationMs) || 0;
  return `${Math.floor(s / 1000)}s`;
}

function prizeLabel(idx, nim) {
  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
  if (idx < 3) return medal && nim ? `${medal} ${nim} G$` : (medal || '🌲');
  return '🌲';
}
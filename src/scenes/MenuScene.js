import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { gdService } from '../engine/GdService.js';
import { pauseService } from '../engine/PauseService.js';
import { requirePlay, startIsBlocked } from '../engine/playGate.js';
import { createMenu } from '../ui/menuView.js';
import { chapterRows, chipModel, playModel } from '../ui/menuModel.js';

/**
 * The main menu. The picture and the buttons are page elements drawn over the whole screen (src/ui/menuView.js), so this
 * scene is a thin shell: it plays the title music, gives the view its data (src/ui/menuModel.js), carries out what the
 * player taps, and tidies up when the player leaves. The game canvas stays idle behind the menu.
 */
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    pauseService.detachScene();
    this.cameras.main.resetFX();
    sound.playBGM('title');
    this.leaving = false;

    if (typeof window !== 'undefined') {
      window.touchController?.hide();
      // the first screen is ready: the page's loading curtain can go
      if (typeof window.__dismissGameLoader === 'function') window.__dismissGameLoader();
    }

    const el = (id) => document.getElementById(id);
    this.view = createMenu(
      { world: el('ms-world'), ui: el('ms-menu'), sheets: el('ms-sheets'), stage: document.querySelector('#ms-ui .ms-stage') },
      {
        play: () => this.onPlay(),
        endless: () => this.leaveFor('SurvivalScene'),
        forge: () => this.leaveFor('ForgeScene'),
        ranks: () => this.leaveFor('LeaderboardScene'),
        wallet: () => window.__gdPanel?.open(),
        // the chapter list is part of the story, which is for verified humans: ask the gate first
        chapters: () => requirePlay('STORY MODE', () => {
          if (this.scene.isActive()) this.view.openChapters(chapterRows((n) => storage.isChapterUnlocked(n)));
        }),
        chapter: (n) => this.leaveFor(n === 0 ? 'StoryIntroScene' : 'StoryScene', n === 0 ? undefined : { chapter: n }),
        replay: () => this.leaveFor('TutorialScene'),
      },
      {
        soundOn: () => !sound.isSoundMuted(),
        musicOn: () => !sound.isMusicMuted(),
        toggleSound: () => { if (!sound.toggleSound()) sound.playBlip(true); },
        toggleMusic: () => { sound.toggleMusic(); sound.playBlip(true); },
      },
      { companion: storage.isCompanionActive() },
    );
    this.view.update(this.model());

    this.stopWatching = gdService.subscribe(() => this.view?.update(this.model()));
    this.events.once('shutdown', () => this.teardown());
  }

  progress() {
    return { tutorialDone: storage.isTutorialDone(), furthest: storage.furthestChapter() };
  }

  /** What the menu shows right now: the wallet chip, the big button, and whether the chapter list is worth offering. */
  model() {
    const status = gdService.getStatus();
    const progress = this.progress();
    const play = playModel(status, progress);
    return { chip: chipModel(status), play, showChapters: progress.tutorialDone && play.action === 'story' };
  }

  onPlay() {
    const play = playModel(gdService.getStatus(), this.progress());
    sound.playCoin();
    if (play.action === 'tutorial') this.leaveFor('TutorialScene');
    else if (play.action === 'gate') requirePlay('STORY MODE', () => { if (this.scene.isActive()) this.startStory(); });
    else this.startStory();
  }

  /** "Play" the first time (the Prologue, then Chapter 1), "Continue" at the furthest chapter after that. */
  startStory() {
    const furthest = storage.furthestChapter();
    if (furthest === 1 && !storage.hasSeenPrologue()) this.leaveFor('StoryIntroScene');
    else this.leaveFor('StoryScene', { chapter: furthest });
  }

  /**
   * Leave the menu for another screen, with a short fade. If the verified-human gate would stop that start, there is no
   * fade: the start goes through at once and the gate opens over the menu (engine/playGate.js).
   */
  leaveFor(sceneKey, data) {
    if (startIsBlocked(sceneKey)) {
      this.scene.start(sceneKey, data);
      return;
    }
    if (this.leaving) return;
    this.leaving = true;
    this.view.fadeOut(200).then(() => { if (this.scene.isActive()) this.scene.start(sceneKey, data); });
  }

  teardown() {
    this.stopWatching?.();
    this.stopWatching = null;
    this.view?.destroy();
    this.view = null;
  }
}

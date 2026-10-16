import { sound } from './Audio.js';
import { startIsBlocked } from './playGate.js';
import { audioHtml, pauseHtml } from '../ui/pauseView.js';

export class PauseService {
  constructor() {
    this.activeScene = null;
    this.modeName = '';
    this.isPaused = false;
    this.buttonsVisible = false;

    this.btnHeader = null;
    this.btnLandscape = null;
    this.modal = null;
    this.txtMode = null;

    if (typeof window !== 'undefined') {
      window.addEventListener('DOMContentLoaded', () => this.initDOM());
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        this.initDOM();
      }
    }
  }

  initDOM() {
    if (this.modal) return;

    this.btnHeader = document.getElementById('btn-pause-header');
    this.btnLandscape = document.getElementById('btn-pause-landscape');
    this.landscapeGroup = document.getElementById('landscape-pause-group');
    this.landscapeTimerBadge = document.getElementById('landscape-timer-badge');
    this.landscapeTimerText = document.getElementById('landscape-timer-text');
    this.headerTimerBadge = document.getElementById('header-timer-badge');
    this.headerTimerText = document.getElementById('header-timer-text');
    this.modal = document.getElementById('pause-modal');
    if (this.modal) {
      this.modal.innerHTML = pauseHtml({ soundOn: !sound.isSoundMuted(), musicOn: !sound.isMusicMuted() });
      this.txtMode = document.getElementById('pause-mode-desc');
      this.audioEl = document.getElementById('pause-audio');
      // one listener serves every button in the pause menu (and the dimmed screen behind it)
      this.modal.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'resume') this.resume();
        else if (act === 'retry') this.retry();
        else if (act === 'menu') this.goToMenu();
        else if (act === 'sound') {
          const isMuted = sound.toggleSound();
          this.updateAudioButtons();
          if (!isMuted) sound.playBlip(true);
        } else if (act === 'music') {
          sound.toggleMusic();
          this.updateAudioButtons();
          sound.playBlip(true);
        }
      });
    }

    if (this.btnHeader) {
      this.btnHeader.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    if (this.btnLandscape) {
      this.btnLandscape.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    if (this.landscapeTimerBadge) {
      this.landscapeTimerBadge.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    if (this.headerTimerBadge) {
      this.headerTimerBadge.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.activeScene) {
          if (this.isPaused) {
            e.preventDefault();
            this.resume();
          } else if (this.canPause()) {
            e.preventDefault();
            this.pause();
          }
        }
      }
    });
  }

  canPause() {
    if (!this.activeScene) return false;
    if (this.activeScene.inDialogue) return false;
    if (this.activeScene.isVictory) return false;
    if (this.activeScene.isGameOver) return false;
    if (this.activeScene.player && this.activeScene.player.isDead) return false;
    return true;
  }

  attachScene(scene, modeName = '', { showTimer = true } = {}) {
    this.initDOM();
    this.activeScene = scene;
    this.modeName = modeName;
    this.isPaused = false;
    this.showTimer = showTimer;
    this.showButtons();
  }

  detachScene() {
    if (this.isPaused) {
      this.resume();
    }
    this.activeScene = null;
    this.modeName = '';
    this.showTimer = true;
    this.hideButtons();
  }

  updateTimer(seconds) {
    const text = `TIME: ${seconds}s`;
    if (this.landscapeTimerText) this.landscapeTimerText.textContent = text;
    if (this.headerTimerText) this.headerTimerText.textContent = text;
  }

  showButtons() {
    this.buttonsVisible = true;
    if (this.landscapeGroup) this.landscapeGroup.classList.remove('hidden');
    if (this.btnHeader) this.btnHeader.classList.remove('hidden');
    if (this.showTimer !== false) {
      if (this.landscapeTimerBadge) this.landscapeTimerBadge.classList.remove('hidden');
      if (this.headerTimerBadge) this.headerTimerBadge.classList.remove('hidden');
    } else {
      if (this.landscapeTimerBadge) this.landscapeTimerBadge.classList.add('hidden');
      if (this.headerTimerBadge) this.headerTimerBadge.classList.add('hidden');
    }
  }

  hideButtons() {
    this.buttonsVisible = false;
    if (this.landscapeGroup) this.landscapeGroup.classList.add('hidden');
    if (this.btnHeader) this.btnHeader.classList.add('hidden');
    if (this.headerTimerBadge) this.headerTimerBadge.classList.add('hidden');
  }

  toggle() {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    if (!this.canPause()) return;
    this.isPaused = true;

    if (this.activeScene && this.activeScene.physics) {
      this.activeScene.physics.pause();
    }

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    if (this.txtMode) {
      this.txtMode.textContent = this.modeName || 'BATTLE IN PROGRESS';
    }

    if (this.modal) {
      this.updateAudioButtons();
      this.modal.classList.remove('hidden');
    }

    sound.playSelect();
  }

  updateAudioButtons() {
    if (this.audioEl) this.audioEl.innerHTML = audioHtml({ soundOn: !sound.isSoundMuted(), musicOn: !sound.isMusicMuted() });
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;

    if (this.modal) {
      this.modal.classList.add('hidden');
    }

    // the scene may have been stopped while paused: its physics world is gone and there is nothing left to resume
    if (this.activeScene?.physics?.world) {
      this.activeScene.physics.resume();
    }

    if (this.canPause() && typeof window !== 'undefined' && window.touchController) {
      window.touchController.show();
    }

    sound.playSelect();
  }

  retry() {
    if (!this.activeScene) return;
    try {
      const sceneToRestart = this.activeScene;
      if (startIsBlocked(sceneToRestart.scene.key)) {
        // the gate refuses (the verification lapsed since the run began): it opens over the pause menu, the run stays
        // paused, and closing the gate leaves the player where they were
        sceneToRestart.scene.restart({ chapter: sceneToRestart.chapterId || 1, skipIntroCard: true, skipDialogue: true });
        return;
      }
      sceneToRestart.endRunOnLeave?.(); // the run being left is settled, not dropped (the next start waits for it)
      this.isPaused = false;
      if (this.modal) {
        this.modal.classList.add('hidden');
      }
      if (sceneToRestart.physics && sceneToRestart.physics.world) {
        sceneToRestart.physics.resume();
        sceneToRestart.physics.world.isPaused = false;
      }
      sound.playCoin();

      const chId = sceneToRestart.chapterId || 1;
      sceneToRestart.scene.restart({ chapter: chId, skipIntroCard: true, skipDialogue: true });
    } catch (err) {
      console.error('Error in retry():', err);
    }
  }

  goToMenu() {
    this.isPaused = false;
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
    sound.playSelect();

    const scene = this.activeScene;
    scene?.endRunOnLeave?.(); // the run being left is settled, not dropped
    this.detachScene();

    if (scene && scene.scene) {
      scene.scene.start('MenuScene');
    } else if (typeof window !== 'undefined' && window.game) {
      window.game.scene.start('MenuScene');
    }
  }
}

export const pauseService = new PauseService();
if (typeof window !== 'undefined') {
  window.pauseService = pauseService;
}

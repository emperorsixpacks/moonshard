import Phaser from 'phaser';
import { GAME_CONFIG } from './config.js';
import { ViewportManager, isPortraitMode } from './engine/ViewportManager.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import StoryIntroScene from './scenes/StoryIntroScene.js';
import StoryScene from './scenes/StoryScene.js';
import StoryEndingScene from './scenes/StoryEndingScene.js';
import SurvivalScene from './scenes/SurvivalScene.js';
import TutorialScene from './scenes/TutorialScene.js';
import ForgeScene from './scenes/ForgeScene.js';
import LeaderboardScene from './scenes/LeaderboardScene.js';
import { TouchController } from './ui/TouchControls.js';
import { watchInput } from './engine/inputMode.js';
import { gdService } from './engine/GdService.js';
import { pauseService } from './engine/PauseService.js';
import { sound } from './engine/Audio.js';
import { GdPanel } from './ui/GdPanel.js';
import { setupImmersiveLayout } from './engine/ImmersiveLayout.js';
import { installHiRes } from './engine/HiRes.js';
import { installHudAnchor } from './engine/HudAnchor.js';
import { installPlayGate, resumeRememberedGate } from './engine/playGate.js';
import { loadGameFonts } from './engine/fonts.js';

// Phaser 3 Game Configuration
const phaserConfig = {
  type: Phaser.AUTO,
  width: GAME_CONFIG.WIDTH,
  height: isPortraitMode() ? (GAME_CONFIG.PORTRAIT_HEIGHT || 440) : GAME_CONFIG.HEIGHT,
  parent: 'game-container',
  pixelArt: true,
  autoFocus: true,
  pauseOnBlur: false,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GAME_CONFIG.GRAVITY },
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [
    BootScene,
    MenuScene,
    TutorialScene,
    StoryIntroScene,
    StoryScene,
    StoryEndingScene,
    SurvivalScene,
    ForgeScene,
    LeaderboardScene
  ]
};

function startGame() {
  // Re-evaluate orientation dynamically right when starting game
  const isPortrait = isPortraitMode();
  phaserConfig.width = GAME_CONFIG.WIDTH;
  phaserConfig.height = isPortrait ? (GAME_CONFIG.PORTRAIT_HEIGHT || 440) : GAME_CONFIG.HEIGHT;

  const game = new Phaser.Game(phaserConfig);
  window.game = game;
  window.__GAME__ = game;

  // Render at the screen's real resolution (before any scene creates its text).
  if (game.isBooted) installHiRes(game);
  else game.events.once(Phaser.Core.Events.BOOT, () => installHiRes(game));

  // Initialize ViewportManager for dynamic portrait/landscape aspect ratio
  window.viewportManager = new ViewportManager(game);
  installHudAnchor(game);

  // Initialize Virtual Touch Controls & Header Actions
  watchInput();
  window.touchController = new TouchController(game);
  window.gdService = gdService;
  window.pauseService = pauseService;
  window.sound = sound;

  // Ensure game canvas dynamically updates whenever container dimensions adapt
  if (typeof ResizeObserver !== 'undefined') {
    const container = document.getElementById('game-container');
    if (container) {
      let rafId = null;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (game && game.scale) {
            game.scale.refresh();
          }
        });
      });
      ro.observe(container);
    }
  }

  console.log('🌲 Moonshard: The High Forest initialized successfully!');
}

// Host language, applied to the document for correct copy/layout.
document.documentElement.lang = gdService.getStatus().language || 'en';

// Keep the canvas inside the visible area of embedded webviews (wallet header + system bars).
setupImmersiveLayout();

// The wallet panel is available from the first frame; connecting is always optional.
window.__gdPanel = new GdPanel();
window.__gdPanel.mount();

// A player must be a verified human before any game mode starts.
installPlayGate();

// Canvas text is drawn once, when it is created: the typefaces must be ready before any scene builds its text.
loadGameFonts().finally(() => {
  startGame();
  resumeRememberedGate();
});

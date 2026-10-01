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
import { nimiqService } from './engine/NimiqService.js';
import { pauseService } from './engine/PauseService.js';
import { sound } from './engine/Audio.js';
import { ConnectGate } from './ui/ConnectGate.js';
import { getAddress } from './nimiq/session.js';
import { setupImmersiveLayout } from './nimiq/immersive.js';

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

  // Initialize ViewportManager for dynamic portrait/landscape aspect ratio
  window.viewportManager = new ViewportManager(game);

  // Initialize Virtual Touch Controls & Header Actions
  window.touchController = new TouchController(game);
  window.nimiqService = nimiqService;
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

// Nimiq Pay host language, applied to the document for correct copy/layout.
document.documentElement.lang = nimiqService.getStatus().language || 'en';

// Keep the canvas inside the visible area of embedded webviews — Nimiq app
// header/address bar on top + phone system nav bars on the edges.
setupImmersiveLayout();

const urlParams = new URLSearchParams(window.location.search);
if (getAddress() || urlParams.get('skipGate') === 'true' || urlParams.get('scene')) {
  startGame();
} else {
  window.__lunaGate = new ConnectGate();
  window.__lunaGate.show().then(() => startGame());
}
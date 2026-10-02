import Phaser from 'phaser';
import { sound } from '../engine/Audio.js';
import { GAME_CONFIG } from '../config.js';
import { cssPerUnitOf, isTallCanvas } from '../engine/uiScale.js';

const half = (n) => Math.round(n * 2) / 2;

const SPEAKER_CONFIGS = {
  LUNA: {
    name: 'SELENE',
    color: '#48cae4',
    bgColor: 0x032830,
    borderColor: 0x00b4d8,
    spriteKey: 'portrait_luna',
    scale: 0.95,
    frame: 0,
    soundPitch: true
  },
  COMPANION: {
    name: 'SYLVA (MOON SPRITE)',
    color: '#64dfdf',
    bgColor: 0x032226,
    borderColor: 0x48cae4,
    spriteKey: 'fairy_portrait',
    scale: 0.95,
    frame: 0,
    soundPitch: true
  },
  GORGOK: {
    name: 'CHIEFTAIN GORGOK',
    color: '#f77f00',
    bgColor: 0x2e1003,
    borderColor: 0xd62828,
    spriteKey: 'portrait_gorgok',
    scale: 0.9,
    frame: 0,
    soundPitch: false
  },
  MALAKOR: {
    name: 'ARCHMAGE MALAKOR',
    color: '#ff7744',
    bgColor: 0x2e0808,
    borderColor: 0xdd3838,
    spriteKey: 'portrait_malakor',
    scale: 0.95,
    frame: 0,
    soundPitch: false
  },
  SHRINE: {
    name: 'LORE OF THE HIGH FOREST',
    color: '#06d6a0',
    bgColor: 0x022e23,
    borderColor: 0x118ab2,
    spriteKey: 'portrait_shrine',
    scale: 0.95,
    frame: 0,
    soundPitch: true
  },
  VORGATH: {
    name: 'VORGATH, BONE SOVEREIGN',
    color: '#e0e1dd',
    bgColor: 0x1b263b,
    borderColor: 0x778da9,
    spriteKey: 'portrait_vorgath',
    scale: 0.95,
    frame: 0,
    soundPitch: false
  },
  IGNIS: {
    name: 'IGNIS, CINDER DRAKE',
    color: '#ff7b00',
    bgColor: 0x3d0000,
    borderColor: 0xff5400,
    spriteKey: 'portrait_ignis',
    scale: 0.95,
    frame: 0,
    soundPitch: false
  },
  UMBRA: {
    name: 'UMBRA, SHATTERED SOVEREIGN',
    color: '#b5179e',
    bgColor: 0x10002b,
    borderColor: 0x7209b7,
    spriteKey: 'portrait_umbra',
    scale: 0.95,
    frame: 0,
    soundPitch: false
  }
};

export default class StoryDialogueBox extends Phaser.GameObjects.Container {
  constructor(scene) {
    const w = scene.cameras?.main?.width || scene.scale?.width || GAME_CONFIG.WIDTH;
    const h = scene.cameras?.main?.height || scene.scale?.height || GAME_CONFIG.HEIGHT;
    // Room for the longest lines (about 200 characters, three lines in landscape and four in the narrower portrait
    // measure), and type that stays readable wherever the game is shown small (an upright phone shows a unit at 0.8 CSS px).
    const tall = isTallCanvas(scene);
    const unit = cssPerUnitOf(scene);
    const bodyPx = Math.max(12.5, half(13 / unit));
    const labelPx = Math.max(12.5, half(12 / unit));
    const promptPx = Math.max(11.5, half(11 / unit));
    const boxH = tall ? 124 : 82;
    const bottomGap = 23;
    super(scene, w / 2, h - bottomGap - boxH / 2);
    scene.add.existing(this);

    this.scene = scene;
    this.lines = [];
    this.currentLineIdx = 0;
    this.isTyping = false;
    this.typingTimer = null;
    this.currentDisplayedChars = 0;
    this.onCompleteCallback = null;

    this.setScrollFactor(0);
    this.setDepth(600);

    const boxW = 444;
    this.boxW = boxW;
    this.boxH = boxH;

    // Dark backdrop overlay behind dialogue to dim the world slightly
    this.dimOverlay = scene.add.rectangle(-w / 2, -this.y, w, h, 0x000000, 0.35)
      .setOrigin(0, 0)
      .setInteractive();
    this.add(this.dimOverlay);

    // Main box background
    this.bgBox = scene.add.rectangle(0, 0, boxW, boxH, 0x060d11, 0.95);
    this.bgBox.setStrokeStyle(2, 0x1e3a47);
    this.add(this.bgBox);

    // Subtle inner trim line
    this.innerTrim = scene.add.rectangle(0, 0, boxW - 6, boxH - 6, 0x000000, 0);
    this.innerTrim.setStrokeStyle(1, 0x0e2530);
    this.add(this.innerTrim);

    // Portrait frame on left
    this.portraitBg = scene.add.rectangle(-boxW / 2 + 32, 0, 44, 44, 0x0a161c, 1);
    this.portraitBg.setStrokeStyle(1.5, 0x3a5a6b);
    this.add(this.portraitBg);

    // Portrait sprite container
    this.portraitSprite = scene.add.sprite(-boxW / 2 + 32, 0, 'char_idle').setVisible(false);
    this.add(this.portraitSprite);

    this.portraitIcon = scene.add.text(-boxW / 2 + 32, 0, '✨', {
      fontSize: '20px'
    }).setOrigin(0.5).setVisible(false);
    this.add(this.portraitIcon);

    // Speaker Nameplate Container (top-left above text)
    this.nameplateBg = scene.add.rectangle(-boxW / 2 + 62, -boxH / 2, 130, labelPx + 5, 0x032830, 0.95)
      .setOrigin(0, 0.5);
    this.nameplateBg.setStrokeStyle(1, 0x00b4d8);
    this.add(this.nameplateBg);

    this.labelPx = labelPx;
    this.nameplateText = scene.add.text(-boxW / 2 + 70, -boxH / 2, 'SELENE', {
      fontFamily: 'VT323',
      fontSize: `${labelPx}px`,
      color: '#48cae4'
    }).setOrigin(0, 0.5);
    this.add(this.nameplateText);

    // Dialogue Body Text
    this.dialogueText = scene.add.text(-boxW / 2 + 64, -boxH / 2 + labelPx + 4, '', {
      fontFamily: 'VT323',
      fontSize: `${bodyPx}px`,
      color: '#e0f0f5',
      lineSpacing: 4,
      wordWrap: { width: boxW - 85 }
    });
    this.add(this.dialogueText);

    // Prompt to advance [TAP TO CONTINUE ▼]
    this.promptArrow = scene.add.text(boxW / 2 - 12, boxH / 2 - promptPx / 2 - 3, 'TAP TO CONTINUE ▼', {
      fontFamily: 'VT323',
      fontSize: `${promptPx}px`,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(1, 0.5);
    this.add(this.promptArrow);

    this.arrowTween = scene.tweens.add({
      targets: this.promptArrow,
      y: boxH / 2 - promptPx / 2,
      duration: 400,
      yoyo: true,
      loop: -1
    });

    // Skip Button in upper right (prominent pill button)
    this.skipBtnBg = scene.add.rectangle(boxW / 2 - 38, -boxH / 2 + 4, 64, labelPx + 6, 0x162c1e, 0.95);
    this.skipBtnBg.setStrokeStyle(1.5, 0x48e4b6);
    this.skipBtnBg.setOrigin(0.5, 0.5);
    this.add(this.skipBtnBg);

    this.btnSkip = scene.add.text(boxW / 2 - 38, -boxH / 2 + 4, 'SKIP ⏭', {
      fontFamily: 'VT323',
      fontSize: `${labelPx}px`,
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5, 0.5);
    this.add(this.btnSkip);
    // size the button to its label, keeping its right edge where it was
    const skipW = Math.max(64, Math.ceil(this.btnSkip.width) + 16);
    this.skipBtnBg.setSize(skipW, labelPx + 6);
    this.skipBtnBg.x = this.btnSkip.x = boxW / 2 - 6 - skipW / 2;

    // Set scrollFactor 0 on all children so Phaser hit testing does not suffer camera scroll offsets
    this.each((child) => {
      if (child.setScrollFactor) child.setScrollFactor(0);
    });

    this.lastActionTime = 0;
    this.isClosing = false;
    this.closeTween = null;

    const triggerAction = (isSkip = false) => {
      if (this.isClosing || !this.active || !this.visible) return;
      const now = performance.now();
      if (now - this.lastActionTime < 180) return;
      this.lastActionTime = now;
      if (isSkip) {
        this.skipAll();
      } else {
        this.handleAction();
      }
    };

    // 1. Phaser scene pointer listener: receives all canvas taps with raw viewport coords (0 to 480, 0 to 270)
    this.scenePointerListener = (pointer) => {
      if (!this.active || !this.visible) return;
      triggerAction(this.isSkipAt(pointer.x, pointer.y));
    };
    scene.input.on('pointerdown', this.scenePointerListener);

    // 2. Direct DOM canvas pointer listener for absolute mobile browser responsiveness
    const canvas = scene.game && scene.game.canvas ? scene.game.canvas : null;
    if (canvas) {
      this.canvasPointerListener = (e) => {
        if (!this.active || !this.visible) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const curW = scene.cameras?.main?.width || scene.scale?.width || GAME_CONFIG.WIDTH;
        const curH = scene.cameras?.main?.height || scene.scale?.height || GAME_CONFIG.HEIGHT;
        const touchX = (clientX - rect.left) * (curW / rect.width);
        const touchY = (clientY - rect.top) * (curH / rect.height);
        triggerAction(this.isSkipAt(touchX, touchY));
      };
      canvas.addEventListener('pointerdown', this.canvasPointerListener);
      canvas.addEventListener('touchstart', this.canvasPointerListener, { passive: true });
    }

    // 3. Direct game object interaction fallback
    this.skipBtnBg.setInteractive({ useHandCursor: true }).on('pointerdown', () => triggerAction(true));
    this.btnSkip.setInteractive({ useHandCursor: true }).on('pointerdown', () => triggerAction(true));
    this.bgBox.setInteractive({ useHandCursor: true }).on('pointerdown', () => triggerAction(false));
    this.dimOverlay.setInteractive().on('pointerdown', () => triggerAction(false));

    // 4. Global window/document touch & pointer fallback for mobile phones
    // In portrait mode, the canvas is only on the top ~40% of the screen.
    // This guarantees that tapping anywhere on the device (including the empty virtual controls area) advances dialogue.
    this.globalPointerListener = (e) => {
      if (!this.active || !this.visible) return;
      if (canvas && e.target === canvas) return; // Handled by canvas listener
      triggerAction(false);
    };
    window.addEventListener('pointerdown', this.globalPointerListener);
    window.addEventListener('touchstart', this.globalPointerListener, { passive: true });

    // 5. Touch virtual triggers fallback
    this.touchListener = () => {
      if (typeof window !== 'undefined' && window.touchController) {
        const triggers = window.touchController.consumeTriggers();
        if (triggers.justAttack || triggers.justJump || triggers.justUpSlash) {
          triggerAction(false);
        }
      }
    };
    scene.events.on('update', this.touchListener);

    // 6. Keyboard handlers (Space, Enter, E, Esc)
    this.onKeyDown = (event) => {
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyE') {
        triggerAction(false);
      } else if (event.code === 'Escape') {
        triggerAction(true);
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True when a tap at (x, y) game units lands on the SKIP button, with generous padding for thumbs. */
  isSkipAt(x, y) {
    const cx = this.x + this.skipBtnBg.x;
    const cy = this.y + this.skipBtnBg.y;
    return Math.abs(x - cx) <= this.skipBtnBg.width / 2 + 16 && Math.abs(y - cy) <= this.skipBtnBg.height / 2 + 18;
  }

  startDialogue(lines, onComplete) {
    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }
    this.lines = lines;
    this.currentLineIdx = 0;
    this.onCompleteCallback = onComplete;
    this.setVisible(true);
    this.showLine(this.currentLineIdx);
  }

  showLine(idx) {
    if (idx >= this.lines.length) {
      this.close();
      return;
    }

    const line = this.lines[idx];
    const speaker = SPEAKER_CONFIGS[line.speaker] || SPEAKER_CONFIGS.LUNA;

    // Update nameplate
    this.nameplateText.setText(speaker.name);
    this.nameplateText.setColor(speaker.color);
    this.nameplateBg.setFillStyle(speaker.bgColor, 0.95);
    this.nameplateBg.setStrokeStyle(1, speaker.borderColor);

    this.nameplateBg.setSize(Math.max(100, Math.ceil(this.nameplateText.width) + 18), this.labelPx + 5);

    // Update Portrait
    if (speaker.spriteKey) {
      this.portraitIcon.setVisible(false);
      this.portraitSprite.setVisible(true);
      this.portraitSprite.setTexture(speaker.spriteKey, speaker.frame || 0);
      this.portraitSprite.setScale(speaker.scale || 0.8);
      this.portraitBg.setStrokeStyle(1.5, speaker.borderColor);
    } else {
      this.portraitSprite.setVisible(false);
      this.portraitIcon.setVisible(true);
      this.portraitIcon.setText(speaker.icon || '✨');
      this.portraitBg.setStrokeStyle(1.5, speaker.borderColor);
    }

    // Typewriter effect
    this.targetText = line.text;
    this.dialogueText.setText('');
    this.currentDisplayedChars = 0;
    this.isTyping = true;
    this.promptArrow.setVisible(false);

    if (this.typingTimer) this.typingTimer.remove();

    this.typingTimer = this.scene.time.addEvent({
      delay: 20,
      repeat: this.targetText.length - 1,
      callback: () => {
        this.currentDisplayedChars++;
        this.dialogueText.setText(this.targetText.substring(0, this.currentDisplayedChars));

        if (this.currentDisplayedChars % 3 === 0) {
          sound.playBlip(speaker.soundPitch);
        }

        if (this.currentDisplayedChars >= this.targetText.length) {
          this.isTyping = false;
          this.promptArrow.setVisible(true);
        }
      }
    });
  }

  handleAction() {
    if (this.isTyping) {
      // Instantly finish line
      if (this.typingTimer) this.typingTimer.remove();
      this.dialogueText.setText(this.targetText);
      this.isTyping = false;
      this.promptArrow.setVisible(true);
      sound.playBlip(true);
    } else {
      // Proceed to next line
      sound.playBlip(false);
      this.currentLineIdx++;
      this.showLine(this.currentLineIdx);
    }
  }

  skipAll() {
    if (this.isClosing) return;
    if (this.typingTimer) this.typingTimer.remove();
    this.close();
  }

  cleanUpListeners() {
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.scene && this.scene.input && this.scenePointerListener) {
      this.scene.input.off('pointerdown', this.scenePointerListener);
      this.scenePointerListener = null;
    }
    const canvas = this.scene && this.scene.game ? this.scene.game.canvas : null;
    if (canvas && this.canvasPointerListener) {
      canvas.removeEventListener('pointerdown', this.canvasPointerListener);
      canvas.removeEventListener('touchstart', this.canvasPointerListener);
      this.canvasPointerListener = null;
    }
    if (this.globalPointerListener) {
      window.removeEventListener('pointerdown', this.globalPointerListener);
      window.removeEventListener('touchstart', this.globalPointerListener);
      this.globalPointerListener = null;
    }
    if (this.scene && this.scene.events && this.touchListener) {
      this.scene.events.off('update', this.touchListener);
      this.touchListener = null;
    }
    // Parts of the box can already be destroyed when the scene is torn down around it (a destroyed object has no scene or
    // input left, and disableInteractive() on it throws, which used to stop the scene from stopping and the next dialogue
    // from starting).
    const quiet = (part) => { if (part?.scene && part.input && part.disableInteractive) part.disableInteractive(); };
    quiet(this.skipBtnBg);
    quiet(this.btnSkip);
    quiet(this.bgBox);
    quiet(this.dimOverlay);
    if (this.arrowTween) {
      this.arrowTween.stop();
      this.arrowTween = null;
    }
    if (this.typingTimer) {
      this.typingTimer.remove();
      this.typingTimer = null;
    }
    if (this.closeTween) {
      this.closeTween.stop();
      this.closeTween = null;
    }
  }

  close() {
    if (this.isClosing) return;
    this.isClosing = true;
    this.cleanUpListeners();

    if (!this.scene || !this.scene.tweens) {
      const cb = this.onCompleteCallback;
      this.onCompleteCallback = null;
      this.destroy();
      if (cb) cb();
      return;
    }

    this.closeTween = this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + 15,
      duration: 250,
      onComplete: () => {
        this.closeTween = null;
        const cb = this.onCompleteCallback;
        this.onCompleteCallback = null;
        this.destroy();
        if (cb) cb();
      }
    });
  }

  destroy() {
    this.isClosing = true;
    this.cleanUpListeners();
    super.destroy();
  }
}

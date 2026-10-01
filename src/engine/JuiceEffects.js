import Phaser from 'phaser';

/**
 * JuiceEffects Engine
 * Handles combat impact freezes (hitstop), screen micro-shakes,
 * and bouncing arcade floating damage numbers with distinct typography.
 */
class JuiceEffectsEngine {
  constructor() {
    this._hitStopActive = false;
  }

  /**
   * Freezes animations and physics for a brief window on heavy strikes or boss hits
   * to provide physical weight and crunch to combat.
   */
  triggerHitStop(scene, durationMs = 40, shakeIntensity = 0) {
    if (!scene || this._hitStopActive) return;
    this._hitStopActive = true;

    // Camera shake if requested
    if (shakeIntensity > 0 && scene.cameras && scene.cameras.main) {
      scene.cameras.main.shake(Math.max(60, durationMs + 20), shakeIntensity);
    }

    // Pause physics engine
    let pausedPhysics = false;
    if (scene.physics && scene.physics.world && !scene.physics.world.isPaused) {
      scene.physics.world.pause();
      pausedPhysics = true;
    }

    // Pause hero animation
    let pausedHeroAnim = false;
    if (scene.player && scene.player.anims && scene.player.anims.isPlaying) {
      scene.player.anims.pause();
      pausedHeroAnim = true;
    }

    // Use wall-clock setTimeout so it safely executes regardless of engine state
    window.setTimeout(() => {
      this._hitStopActive = false;
      if (!scene || !scene.sys || !scene.physics || !scene.physics.world) return;

      if (pausedPhysics) {
        scene.physics.world.resume();
      }
      if (pausedHeroAnim && scene.player && scene.player.anims && scene.player.anims.isPaused) {
        scene.player.anims.resume();
      }
    }, durationMs);
  }

  hitStop(scene, durationMs = 35) {
    this.triggerHitStop(scene, durationMs, 0.006);
  }

  hitStopLight(scene) {
    this.triggerHitStop(scene, 32, 0.004);
  }

  hitStopHeavy(scene) {
    this.triggerHitStop(scene, 48, 0.009);
  }

  hitStopCrit(scene) {
    this.triggerHitStop(scene, 65, 0.015);
  }

  screenShake(scene, intensity = 8, durationMs = 120) {
    if (!scene || !scene.cameras || !scene.cameras.main) return;
    let dur = 120;
    let inten = 0.012;
    if (typeof durationMs === 'number' && durationMs > 1) {
      dur = durationMs;
      inten = (typeof intensity === 'number' && intensity > 1) ? intensity * 0.0015 : intensity;
    } else if (typeof intensity === 'number' && intensity > 1) {
      dur = intensity;
      inten = typeof durationMs === 'number' ? durationMs : 0.012;
    } else if (typeof intensity === 'number') {
      inten = intensity;
      dur = typeof durationMs === 'number' ? durationMs : 120;
    }
    const clampedIntensity = Phaser.Math.Clamp(inten || 0.012, 0.003, 0.04);
    scene.cameras.main.shake(dur || 120, clampedIntensity);
  }

  /**
   * Flashes sprite solid white/bright tint upon taking damage
   */
  flashWhite(sprite, durationMs = 90) {
    if (!sprite || !sprite.scene) return;
    try {
      if (typeof sprite.setTint === 'function') {
        sprite.setTint(0xffffff);
      }
      const scene = sprite.scene;
      if (scene && scene.time) {
        scene.time.delayedCall(durationMs, () => {
          if (sprite && typeof sprite.clearTint === 'function' && sprite.state !== 'DEAD') {
            sprite.clearTint();
          }
        });
      }
    } catch (e) {
      if (sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
    }
  }

  /**
   * Spawns a floating combat banner text
   */
  spawnFloatingText(scene, x, y, textStr, color = '#ffffff') {
    if (!scene || !scene.add) return null;
    const txt = scene.add.text(x, y, textStr, {
      fontFamily: 'Press Start 2P',
      fontSize: '7px',
      color: color,
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(260);

    scene.tweens.add({
      targets: txt,
      y: y - 24,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => txt.destroy()
    });
    return txt;
  }

  /**
   * Spawns death burst particles
   */
  spawnDeathParticles(scene, x, y, color = 0xffffff, count = 12) {
    if (!scene || !scene.add) return;
    for (let i = 0; i < count; i++) {
      const p = scene.add.circle(x, y, Phaser.Math.Between(2, 4), color, 0.9).setDepth(25);
      const angle = (Math.PI * 2 * i) / count + Phaser.Math.FloatBetween(-0.2, 0.2);
      const speed = Phaser.Math.Between(60, 140);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 40;

      scene.tweens.add({
        targets: p,
        x: x + vx * 0.4,
        y: y + vy * 0.4,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(280, 420),
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy()
      });
    }
  }

  /**
   * Spawns a bouncing arcade damage number with distinct color, scale punch,
   * and parabolic arc physics.
   */
  spawnDamageNumber(scene, x, y, damage, type = 'normal', customLabel = null) {
    if (!scene || !scene.add) return null;

    let textStr = `-${damage}`;
    let color = '#ffffff';
    let strokeColor = '#000000';
    let strokeThickness = 2;
    let fontSize = '7px';
    let punchScale = 1.35;

    switch (type) {
      case 'crit':
      case 'backstab':
        color = '#ffd700'; // Gleaming Gold
        strokeColor = '#3a2e00';
        strokeThickness = 3;
        fontSize = '9px';
        punchScale = 1.6;
        textStr = customLabel || `🗡️ CRIT -${damage}!`;
        break;

      case 'counter':
        color = '#ff9e00'; // Vibrant Orange
        strokeColor = '#4a1e00';
        strokeThickness = 3;
        fontSize = '9px';
        punchScale = 1.6;
        textStr = customLabel || `💥 COUNTER -${damage}!`;
        break;

      case 'stomp':
        color = '#ffd166'; // Solar Amber
        strokeColor = '#3d2600';
        strokeThickness = 2.5;
        fontSize = '8px';
        punchScale = 1.45;
        textStr = customLabel || `👢 STOMP -${damage}`;
        break;

      case 'upslash':
      case 'heavy':
        color = '#98ff20'; // Neon Forest Lime
        strokeColor = '#0d2b0d';
        strokeThickness = 2.5;
        fontSize = '8px';
        punchScale = 1.4;
        textStr = customLabel || `-${damage}`;
        break;

      case 'shatter':
        color = '#ff66cc'; // Radiant Magenta
        strokeColor = '#3b003b';
        strokeThickness = 3;
        fontSize = '9px';
        punchScale = 1.55;
        textStr = customLabel || `💥 SHATTER -${damage}!`;
        break;

      case 'player':
        color = '#ff3838'; // Crimson
        strokeColor = '#450000';
        strokeThickness = 2.5;
        fontSize = '8px';
        punchScale = 1.4;
        textStr = customLabel || `-${damage}`;
        break;

      case 'normal':
      default:
        color = '#ffffff';
        strokeColor = '#000000';
        strokeThickness = 2;
        fontSize = '7px';
        punchScale = 1.3;
        textStr = customLabel || `-${damage}`;
        break;
    }

    // Slight randomized horizontal arc drift
    const startX = x + Phaser.Math.Between(-8, 8);
    const startY = y - 10;
    const targetX = startX + Phaser.Math.Between(-14, 14);
    const peakY = startY - 26;
    const endY = peakY + 8;

    const dmgText = scene.add.text(startX, startY, textStr, {
      fontFamily: 'Press Start 2P',
      fontSize: fontSize,
      color: color,
      stroke: strokeColor,
      strokeThickness: strokeThickness
    }).setOrigin(0.5).setDepth(260);

    // Initial scale punch
    dmgText.setScale(punchScale);

    // Parabolic arc & scale bounce tween
    scene.tweens.add({
      targets: dmgText,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 140,
      ease: 'Back.easeOut'
    });

    // Horizontal drift
    scene.tweens.add({
      targets: dmgText,
      x: targetX,
      duration: 700,
      ease: 'Linear'
    });

    // Vertical parabolic bounce
    scene.tweens.add({
      targets: dmgText,
      y: peakY,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!dmgText.active) return;
        scene.tweens.add({
          targets: dmgText,
          y: endY,
          alpha: 0,
          duration: 420,
          ease: 'Quad.easeIn',
          onComplete: () => dmgText.destroy()
        });
      }
    });

    return dmgText;
  }
}

export const juice = new JuiceEffectsEngine();

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { legibleSize } from '../engine/uiScale.js';

const MOBS = GAME_CONFIG.MOBS;
/** What a hit costs, by kind; a kind that is not here costs 25. */
const DAMAGE = {
  spore: 15, eye_dart: 15, mud_glob: 16, arcane_orb: 30, arcane_meteor: 30,
  hornet_quill: MOBS.HORNET_GUARD.DAMAGE, magma_glob: MOBS.CINDER_DRAKE.DAMAGE, lunar_crescent: MOBS.ASTRAL_SHADE.DAMAGE,
};

/** The kinds that fly in a straight line (the rest fall with the world's pull, as they always have). */
const STRAIGHT = new Set(['hornet_quill', 'lunar_crescent']);

export default class Projectile extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, type, vx, vy, isDeflectable = false) {
    let texture = 'spark';
    if (type === 'spore') texture = 'mushroom_spore';
    else if (type === 'eye_dart') texture = 'eye_projectile';
    else if (type === 'goblin_bomb') texture = 'goblin_bomb';
    else if (type === 'arcane_orb' || type === 'arcane_meteor') texture = 'spark';
    else if (type === 'shockwave') texture = 'boulders';

    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.projType = type;
    this.isDeflected = false;
    this.isDeflectable = isDeflectable;
    this.damage = DAMAGE[type] ?? 25;
    this.isDead = false;
    this.setDepth(22);

    if (type === 'spore') {
      this.body.setSize(16, 16);
      this.body.setOffset(17, 17);
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.setRotation(Math.atan2(vy, vx));
      this.play('mushroom_spore_anim');
    } else if (type === 'eye_dart') {
      this.body.setSize(18, 18);
      this.body.setOffset(15, 15);
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.play('eye_projectile_anim');
    } else if (type === 'goblin_bomb') {
      this.body.setSize(20, 20);
      this.body.setOffset(45, 45);
      this.body.setBounce(0.5);
      this.body.setDragX(40);
      this.setVelocity(vx, vy);
      this.play('goblin_bomb_anim');

      // Explode after 1.8s fuse
      this.fuseTimer = scene.time.delayedCall(1800, () => {
        if (!this.isDead) this.explode();
      });
    } else if (type === 'arcane_orb') {
      this.body.setSize(16, 16);
      this.body.setOffset(-8, -8);
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.setTint(0xc044ff);
      this.setScale(2.0);

      // Trail particles
      this.glow = scene.add.circle(x, y, 9, 0xaa22ee, 0.7);
      this.scene.tweens.add({
        targets: this.glow,
        scale: 1.4,
        alpha: 0.3,
        yoyo: true,
        repeat: -1,
        duration: 150
      });
    } else if (type === 'arcane_meteor') {
      this.body.setSize(20, 20);
      this.body.setOffset(-10, -10);
      this.body.setAllowGravity(false);
      this.setVelocity(0, vy);
      this.setTint(0xff3366);
      this.setScale(2.2);
    } else if (type === 'shockwave') {
      this.body.setSize(20, 16);
      this.body.setOffset(0, 0);
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.setScale(0.7);
      this.setTint(0x997755);
    } else if (type === 'mud_glob') {
      this.body.setSize(12, 12);
      this.body.setOffset(2, 2);
      this.body.setAllowGravity(true);
      this.body.setGravityY(180);
      this.setVelocity(vx, vy);
      this.setScale(1.3);
      this.setTint(0x4a7c59);
    } else if (type === 'hornet_quill') {
      // a stinger: a short amber streak that flies straight
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.setRotation(Math.atan2(vy, vx));
      this.setScale(3.2, 1.4);
      this.setTint(0xfbbf24);
    } else if (type === 'magma_glob') {
      // a lob of molten rock: it arcs and falls with the world's pull
      this.setVelocity(vx, vy);
      this.setScale(3.2);
      this.setTint(0xff5522);
      this.glow = scene.add.circle(x, y, 8, 0xff7733, 0.6).setDepth(21);
    } else if (type === 'lunar_crescent') {
      // a pale blade of moonlight that flies straight
      this.body.setAllowGravity(false);
      this.setVelocity(vx, vy);
      this.setScale(4, 2.4);
      this.setTint(0xe9d5ff);
      this.glow = scene.add.circle(x, y, 9, 0xc084fc, 0.55).setDepth(21);
    }

    // Auto-cull after 5 seconds
    scene.time.delayedCall(5000, () => {
      if (!this.isDead) this.destroyProj();
    });
  }

  /**
   * Sets the projectile off, once it is in the scene's projectile group: a body that joins a physics group is given the
   * group's defaults (the world's pull on it, no speed), so the flight a kind needs is put back here.
   */
  launch(vx, vy) {
    if (STRAIGHT.has(this.projType)) this.body.setAllowGravity(false);
    this.setVelocity(vx, vy);
  }

  update() {
    if (this.isDead) return;

    if (this.glow) {
      this.glow.x = this.x;
      this.glow.y = this.y;
    }
  }

  deflect(player) {
    if (this.isDead) return;
    this.isDeflected = true;
    sound.playRicochet();

    // Visual flare
    this.scene.cameras.main.shake(80, 0.01);
    this.setTint(0xffd700);

    const dir = player.flipX ? -1 : 1;
    this.setVelocity(-this.body.velocity.x * 1.5 || dir * 260, -80);

    const text = this.scene.add.text(this.x, this.y - 14, 'DEFLECT! ⚡', {
      fontFamily: 'Press Start 2P',
      fontSize: `${legibleSize(this.scene, 7, 9)}px`,
      color: '#ffd700',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: text,
      y: this.y - 30,
      alpha: 0,
      duration: 500,
      onComplete: () => text.destroy()
    });
  }

  explode() {
    if (this.isDead) return;
    this.isDead = true;
    this.setVelocity(0, 0);
    this.body.setEnable(false);
    sound.playRicochet();

    // Explosion puff
    const puff = this.scene.add.circle(this.x, this.y, 22, 0xff5500, 0.8);
    this.scene.tweens.add({
      targets: puff,
      scale: 1.8,
      alpha: 0,
      duration: 250,
      onComplete: () => puff.destroy()
    });

    this.destroyProj();
  }

  destroyProj() {
    this.isDead = true;
    if (this.glow) this.glow.destroy();
    if (this.fuseTimer) this.fuseTimer.remove();
    this.destroy();
  }
}

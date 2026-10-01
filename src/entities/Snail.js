import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { juice } from '../engine/JuiceEffects.js';
import EnemyHealthBar from '../ui/EnemyHealthBar.js';

export default class Snail extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'snail_walk');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Snail frame is 48x32. Collider:
    this.body.setSize(24, 18);
    this.body.setOffset(12, 14);
    this.setDepth(19);

    this.mobType = 'snail';
    this.hp = GAME_CONFIG.MOBS.SNAIL.HP;
    this.maxHp = GAME_CONFIG.MOBS.SNAIL.HP;
    this.state = 'WALK'; // WALK, SHELLED, SLIDING, DEAD
    this.patrolDir = -1;
    this.bounceCount = 0;
    this.maxBounces = 2; // Shatters after 2 wall bounces
    this.shellSlideSpeed = GAME_CONFIG.MOBS.SNAIL.SHELL_SPEED;

    this.healthBar = new EnemyHealthBar(scene, this, 22, 3.5, 6);
    this.play('snail_walk_anim');
  }

  update() {
    if (this.healthBar) this.healthBar.update(this.hp, this.maxHp);
    if (this.state === 'DEAD') return;
    if (this.scene && this.scene.inDialogue) {
      if (this.state !== 'SLIDING') this.setVelocityX(0);
      return;
    }

    const hitWall = this.body.blocked.left || this.body.blocked.right;

    if (this.state === 'WALK') {
      // Check for wall or ledge edge ahead
      if (hitWall || this.isLedgeAhead(this.patrolDir)) {
        this.patrolDir *= -1;
      }

      // Proximity aggro: if player is close (< 100px), aggressively crawl towards player
      let moveSpeed = GAME_CONFIG.MOBS.SNAIL.WALK_SPEED;
      if (this.scene.player && !this.scene.player.isDead) {
        const player = this.scene.player;
        const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
        const dy = Math.abs(this.y - player.y);
        if (dist < 110 && dy < 40) {
          const chaseDir = player.x < this.x ? -1 : 1;
          if (!this.isLedgeAhead(chaseDir)) {
            this.patrolDir = chaseDir;
            moveSpeed *= 1.6; // Aggressive crawl lunge
          }
        }
      }

      this.setVelocityX(this.patrolDir * moveSpeed);
      this.setFlipX(this.patrolDir > 0);
    } else if (this.state === 'SHELLED') {
      this.setVelocityX(0);
    } else if (this.state === 'SLIDING') {
      if (hitWall) {
        this.bounceCount++;
        sound.playRicochet();
        this.scene.cameras.main.shake(60, 0.006);

        if (this.bounceCount >= this.maxBounces) {
          this.shatter();
          return;
        }
      }

      // Maintain high slide speed in current direction
      const currentDir = this.body.velocity.x >= 0 ? 1 : -1;
      this.setVelocityX(currentDir * this.shellSlideSpeed);
      this.setAngle(this.angle + (currentDir * 18)); // Shell spinning
    }
  }

  isLedgeAhead(dir) {
    if (!this.body.blocked.down || !this.scene.platforms) return false;

    // In Survival arena, allow walking off upper platforms if player is below
    if (this.scene.scene && this.scene.scene.key === 'SurvivalScene') {
      const player = this.scene.player;
      if (player && !player.isDead && player.y > this.y + 35) {
        return false;
      }
    }

    const lookX = this.x + (dir * (this.body.width / 2 + 8));
    const footY = this.body.bottom + 6;

    const hasGround = this.scene.platforms.getChildren().some(plat => {
      const pb = plat.body;
      if (!pb) return false;
      return lookX >= pb.left && lookX <= pb.right && footY >= pb.top && footY <= pb.bottom + 14;
    });

    return !hasGround;
  }

  takeDamage(amount, attackFromX, isUpwardSlash = false) {
    if (this.state === 'DEAD') return false;

    if (this.state === 'WALK') {
      this.hp -= amount;
      sound.playHit();
      juice.spawnDamageNumber(this.scene, this.x, this.y - 12, amount, isUpwardSlash ? 'upslash' : 'normal');
      juice.hitStopLight(this.scene);

      // Enter shelled state
      this.enterShelled();
      return { killed: false, pts: 0, shelled: true };
    } else if (this.state === 'SLIDING') {
      // Any sword strike on a sliding shell shatters it immediately!
      juice.spawnDamageNumber(this.scene, this.x, this.y - 12, 99, 'shatter');
      juice.hitStopHeavy(this.scene);
      this.shatter();
      return { killed: true, pts: GAME_CONFIG.MOBS.SNAIL.PTS * 1.5, shattered: true };
    } else if (this.state === 'SHELLED') {
      if (isUpwardSlash) {
        // Upward slash shatters the stationary shell directly
        juice.spawnDamageNumber(this.scene, this.x, this.y - 12, 99, 'shatter');
        juice.hitStopHeavy(this.scene);
        this.shatter();
        return { killed: true, pts: GAME_CONFIG.MOBS.SNAIL.PTS * 1.5, shattered: true };
      } else {
        // Horizontal attack kicks the stationary shell as a rolling weapon!
        const kickDir = attackFromX < this.x ? 1 : -1;
        this.kickShell(kickDir);
        return { killed: false, pts: 0, kicked: true };
      }
    }
  }

  enterShelled() {
    this.state = 'SHELLED';
    this.setVelocity(0, 0);
    sound.playHit();
    this.play('snail_hide_anim');

    // Pop up clear guidance prompt
    const tipText = this.scene.add.text(this.x, this.y - 18, 'SHELL READY! (SLASH TO BREAK / KICK)', {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#98ff20',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: tipText,
      y: this.y - 30,
      alpha: 0,
      duration: 700,
      onComplete: () => tipText.destroy()
    });
  }

  kickShell(dir) {
    this.state = 'SLIDING';
    this.bounceCount = 0;
    this.body.setBounce(1, 0);
    this.setVelocityX(dir * this.shellSlideSpeed);
    sound.playShellKick();

    // Speed particles & hint
    const kickText = this.scene.add.text(this.x, this.y - 18, 'SHELL SLIDE! (SLASH TO BREAK)', {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#f6c026',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: kickText,
      y: this.y - 32,
      alpha: 0,
      duration: 600,
      onComplete: () => kickText.destroy()
    });
  }

  shatter() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();

    if (this.scene.onEnemyShattered) {
      this.scene.onEnemyShattered(this);
    }

    // Spawn shell fragments
    for (let i = 0; i < 4; i++) {
      const frag = this.scene.add.rectangle(this.x, this.y, 4, 4, 0x8a6f4d);
      this.scene.physics.add.existing(frag);
      frag.body.setVelocity((Math.random() - 0.5) * 150, -100 - Math.random() * 80);
      this.scene.tweens.add({
        targets: frag,
        alpha: 0,
        duration: 350,
        onComplete: () => frag.destroy()
      });
    }

    this.destroy();
  }

  die() {
    this.state = 'DEAD';
    this.body.setEnable(false);
    if (this.healthBar) this.healthBar.setVisible(false);
    sound.playEnemyDeath();
    this.play('snail_dead_anim');

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 8,
      duration: 350,
      onComplete: () => this.destroy()
    });
  }

  destroy(fromScene) {
    if (this.healthBar) {
      this.healthBar.destroy();
      this.healthBar = null;
    }
    super.destroy(fromScene);
  }
}

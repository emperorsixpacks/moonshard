import { storage } from './Storage.js';

const BGM_TRACKS = {
  title: '/assets/audio/bgm_title.mp3',
  forest: '/assets/audio/bgm_forest.mp3',
  battle: '/assets/audio/bgm_battle.mp3',
  boss: '/assets/audio/bgm_boss.mp3',
  victory: '/assets/audio/bgm_victory.mp3'
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.soundMuted = false;
    this.musicMuted = false;
    this.bgmPlaying = false;
    this.currentTrack = null;
    this.currentAudio = null;
    this.audioCache = new Map();
    this.bgmVolume = 0.45;
    this.unlocked = false;
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
  }

  init() {
    if (!this.unlocked) {
      try {
        this.soundMuted = storage.isSoundMuted();
        this.musicMuted = storage.isMusicMuted();
      } catch (e) {
        this.soundMuted = false;
        this.musicMuted = false;
      }
    }

    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 1.0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime((this.muted || this.soundMuted) ? 0 : 0.7, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.bgmGain.connect(this.masterGain);
    } catch (e) {
      console.warn('WebAudio not supported:', e);
    }

    if (typeof window !== 'undefined' && !this.unlocked) {
      const unlock = () => {
        this.resume();
        if (this.currentAudio && this.currentAudio.paused && !this.muted && !this.musicMuted && this.currentTrack) {
          this.currentAudio.play().catch(() => {});
        }
        this.unlocked = true;
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true });
    }
  }

  resume() {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  isSoundMuted() {
    return Boolean(this.soundMuted);
  }

  isMusicMuted() {
    return Boolean(this.musicMuted);
  }

  setSoundMuted(muted) {
    this.init();
    this.soundMuted = Boolean(muted);
    try {
      storage.setSoundMuted(this.soundMuted);
    } catch (e) {}
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime((this.muted || this.soundMuted) ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.soundMuted;
  }

  setMusicMuted(muted) {
    this.init();
    this.musicMuted = Boolean(muted);
    try {
      storage.setMusicMuted(this.musicMuted);
    } catch (e) {}
    if (this.currentAudio) {
      this.currentAudio.volume = (this.muted || this.musicMuted) ? 0 : this.bgmVolume;
      if (!this.muted && !this.musicMuted && this.currentAudio.paused && this.currentTrack) {
        this.currentAudio.play().catch(() => {});
      }
    }
    return this.musicMuted;
  }

  toggleSound() {
    return this.setSoundMuted(!this.soundMuted);
  }

  toggleMusic() {
    return this.setMusicMuted(!this.musicMuted);
  }

  toggleMute() {
    this.init();
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 1.0, this.ctx.currentTime);
    }
    if (this.currentAudio) {
      this.currentAudio.volume = (this.muted || this.musicMuted) ? 0 : this.bgmVolume;
    }
    return this.muted;
  }

  playSlash(combo = 1) {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    
    // Noise buffer for swoosh
    const bufferSize = this.ctx.sampleRate * 0.12;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(combo === 1 ? 1200 : 800, t);
    filter.frequency.exponentialRampToValueAtTime(combo === 1 ? 300 : 150, t + 0.12);
    filter.Q.value = 3.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(combo === 1 ? 0.6 : 0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(t);

    // Tonal sword chime for combo 2
    if (combo === 2) {
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.18);
      oscGain.gain.setValueAtTime(0.4, t);
      oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }

  playElementalSlash(effect) {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;

    if (effect === 'crimson_flame') {
      // Blazing fire crackle & low whoosh
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.16);
      oscGain.gain.setValueAtTime(0.35, t);
      oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.16);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + 0.16);

      osc.connect(filter);
      filter.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.16);
    } else if (effect === 'frost_moon') {
      // Crystalline frost chime
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1480, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.22);
      oscGain.gain.setValueAtTime(0.28, t);
      oscGain.gain.exponentialRampToValueAtTime(0.005, t + 0.22);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.22);
    } else if (effect === 'verdant_bloom') {
      // Flora whip / wind chime
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.2);
      oscGain.gain.setValueAtTime(0.25, t);
      oscGain.gain.exponentialRampToValueAtTime(0.008, t + 0.2);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  playWaterSplash() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;

    // Rushing water noise splash
    const bufferSize = this.ctx.sampleRate * 0.25;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.25);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(t);

    // Droplet bloop
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    oscGain.gain.setValueAtTime(0.35, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.16);
    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  playHoneySquish() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;

    // Gooey amber squelch / pop
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.22);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, t);
    filter.Q.value = 4.0;

    oscGain.gain.setValueAtTime(0.65, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);

    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  playSpikeHit() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;

    // Sharp metallic sting
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.18);

    oscGain.gain.setValueAtTime(0.55, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  playUpwardSlash() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.15);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.15);
  }

  playJump(doubleJump = false) {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    
    const startFreq = doubleJump ? 380 : 220;
    const endFreq = doubleJump ? 750 : 520;
    
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.12);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  playWallSlide() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, t);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.08);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  playHit() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.14);

    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  playEnemyDeath() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(350, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playShellKick() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    
    // Impact thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.18);
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  playRicochet() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.15);
    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playCoin() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, t); // B5
    osc.frequency.setValueAtTime(1318.51, t + 0.08); // E6
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  playObelisk() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.08);
      gain.gain.setValueAtTime(0.3, t + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + idx * 0.08);
      osc.stop(t + 1.2);
    });
  }

  playVictory() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C E G C
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t + idx * 0.12);
      gain.gain.setValueAtTime(0.3, t + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + idx * 0.12);
      osc.stop(t + idx * 0.12 + 0.35);
    });
  }

  playGameOver() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const notes = [440, 415.30, 392, 349.23];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t + idx * 0.18);
      gain.gain.setValueAtTime(0.4, t + idx * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.18 + 0.3);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + idx * 0.18);
      osc.stop(t + idx * 0.18 + 0.3);
    });
  }

  playBlip(high = false) {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(high ? 580 : 380, t);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playSelect() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(780, t + 0.08);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  playBack() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.07);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  playCancel() {
    this.playBack();
  }

  playConfirm() {
    this.playSelect();
  }

  playLevelUp() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const noteTime = t + i * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);
      gain.gain.setValueAtTime(0.2, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.15);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(noteTime);
      osc.stop(noteTime + 0.15);
    });
  }

  playSparkle() {
    this.playLevelUp();
  }

  playImpact() {
    this.playHit();
  }

  playSwordSlash() {
    this.playSlash(1);
  }

  playBoarChargeHit() {
    this.playHit();
  }

  playWhoosh() {
    this.playSlash(1);
  }

  playMonsterDeath() {
    this.playEnemyDeath();
  }

  playBossStomp() {
    this.playRumble();
  }

  playEnemyAttack() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  playRumble() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.75);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.005, t + 0.8);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, t);
    filter.frequency.exponentialRampToValueAtTime(40, t + 0.8);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.8);
  }

  playThunder() {
    if (this.muted || this.soundMuted || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const duration = 2.2;

    // Noise buffer for atmospheric crackle & rumble
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    // Brown noise approximation for deep thunder rumble
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + (0.04 * white)) / 1.04;
      lastOut = data[i];
      data[i] *= 3.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 0.6);
    filter.frequency.exponentialRampToValueAtTime(50, t + duration);
    filter.Q.value = 3.0;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.01, t);
    noiseGain.gain.linearRampToValueAtTime(0.7, t + 0.06);
    noiseGain.gain.exponentialRampToValueAtTime(0.3, t + 0.5);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    noise.start(t);
    noise.stop(t + duration);

    // Deep sub-bass resonance oscillator
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(55, t);
    subOsc.frequency.exponentialRampToValueAtTime(26, t + 1.2);

    subGain.gain.setValueAtTime(0.01, t);
    subGain.gain.linearRampToValueAtTime(0.45, t + 0.08);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);

    subOsc.connect(subGain);
    subGain.connect(this.sfxGain);

    subOsc.start(t);
    subOsc.stop(t + 1.4);
  }

  playBGM(key = 'title') {
    this.init();
    const url = BGM_TRACKS[key] || BGM_TRACKS.title;

    // If this track is already playing, do nothing
    if (this.currentTrack === key && this.currentAudio && !this.currentAudio.paused) {
      return;
    }

    let audio = this.audioCache.get(url);
    if (!audio) {
      audio = new Audio(url);
      audio.loop = true;
      audio.preload = 'auto';
      this.audioCache.set(url, audio);
    }

    // Crossfade out previous audio if playing and different
    const oldAudio = this.currentAudio;
    if (oldAudio && oldAudio !== audio && !oldAudio.paused) {
      let v = oldAudio.volume;
      const fadeStep = v / 8;
      const fadeOutTimer = setInterval(() => {
        v = Math.max(0, v - fadeStep);
        oldAudio.volume = v;
        if (v <= 0.01) {
          clearInterval(fadeOutTimer);
          oldAudio.pause();
          oldAudio.currentTime = 0;
        }
      }, 25);
    }

    audio.currentTime = 0;
    audio.volume = (this.muted || this.musicMuted) ? 0 : this.bgmVolume;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Handled by user-interaction unlock
      });
    }

    this.currentAudio = audio;
    this.currentTrack = key;
    this.bgmPlaying = true;
  }

  startBGM(key = 'title') {
    this.playBGM(key);
  }

  stopBGM(fade = true) {
    this.bgmPlaying = false;
    this.currentTrack = null;
    const a = this.currentAudio;
    if (!a) return;

    if (fade && a.volume > 0.05 && !a.paused) {
      let v = a.volume;
      const fadeStep = v / 10;
      const timer = setInterval(() => {
        v = Math.max(0, v - fadeStep);
        a.volume = v;
        if (v <= 0.01) {
          clearInterval(timer);
          a.pause();
          a.currentTime = 0;
        }
      }, 30);
    } else {
      a.pause();
      a.currentTime = 0;
    }
  }
}

export const sound = new SoundEngine();

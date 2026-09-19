/**
 * AudioManager: generated WebAudio sound effects, zero audio assets
 * (spec §44–45). All sounds are synthesized with oscillators + filtered
 * noise so the game is fully self-contained.
 *
 * Usage:
 *   const audio = new AudioManager();
 *   audio.unlock();          // call from a user gesture at least once
 *   audio.play('crossbow-fire');
 *   audio.setMuted(true);
 *
 * Master mute covers SFX + music. `musicEnabled` gates the ambient pad.
 */

export type SoundName =
  | 'tower-place'
  | 'tower-upgrade'
  | 'tower-sell'
  | 'crossbow-fire'
  | 'cannon-fire'
  | 'bomb-fire'
  | 'explosion'
  | 'enemy-hit'
  | 'enemy-death'
  | 'wave-start'
  | 'wave-complete'
  | 'base-hit'
  | 'game-over'
  | 'victory'
  | 'click'
  | 'error';

interface ToneOptions {
  /** Oscillator frequency (or start frequency for sweeps). */
  freq: number;
  /** End frequency for pitch sweeps. */
  freqEnd?: number;
  /** Seconds. */
  duration: number;
  /** 0–1 peak gain. */
  volume?: number;
  type?: OscillatorType;
  /** Delay before starting, in seconds. */
  delay?: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private muted = false;
  private musicOn = false;
  private musicNodes: OscillatorNode[] = [];
  private lastPlay = new Map<SoundName, number>();
  /** Minimum gap between identical sounds (rapid-fire throttling). */
  private throttleMs = new Map<SoundName, number>([
    ['crossbow-fire', 60],
    ['enemy-hit', 70],
    ['enemy-death', 50],
    ['cannon-fire', 120],
    ['explosion', 90],
  ]);

  // ------------------------------------------------------------ lifecycle

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.05;
      this.musicGain.connect(this.master);
      if (this.musicOn) this.startPad();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startPad();
    else this.stopPad();
  }

  isMusicEnabled(): boolean {
    return this.musicOn;
  }

  // ------------------------------------------------------------------ API

  play(name: SoundName): void {
    if (this.muted) return;
    if (!this.ctx || !this.master) return;
    const now = performance.now();
    const throttle = this.throttleMs.get(name) ?? 0;
    const last = this.lastPlay.get(name) ?? -Infinity;
    if (now - last < throttle) return;
    this.lastPlay.set(name, now);
    try {
      SOUNDS[name](this);
    } catch (err) {
      console.warn(`[audio] failed to play ${name}`, err);
    }
  }

  // --------------------------------------------------------------- primitives

  tone({ freq, freqEnd, duration, volume = 0.25, type = 'sine', delay = 0 }: ToneOptions): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  noise(duration: number, volume = 0.3, filterFreq = 1200, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  // ------------------------------------------------------------------ music

  private startPad(): void {
    if (!this.ctx || !this.musicGain || this.musicNodes.length > 0) return;
    // Quiet two-note drone (A2 + E3), well below SFX level.
    for (const freq of [110, 164.81]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(this.musicGain);
      osc.start();
      this.musicNodes.push(osc);
    }
  }

  private stopPad(): void {
    for (const osc of this.musicNodes) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
    }
    this.musicNodes = [];
  }
}

// ------------------------------------------------------------ sound recipes

type Player = AudioManager;

const SOUNDS: Record<SoundName, (a: Player) => void> = {
  'tower-place': (a) => {
    a.tone({ freq: 220, freqEnd: 440, duration: 0.14, volume: 0.3, type: 'triangle' });
    a.tone({ freq: 660, duration: 0.1, volume: 0.18, type: 'sine', delay: 0.08 });
  },
  'tower-upgrade': (a) => {
    a.tone({ freq: 440, duration: 0.09, volume: 0.25, type: 'square' });
    a.tone({ freq: 554, duration: 0.09, volume: 0.25, type: 'square', delay: 0.08 });
    a.tone({ freq: 659, duration: 0.16, volume: 0.28, type: 'square', delay: 0.16 });
  },
  'tower-sell': (a) => {
    a.tone({ freq: 659, freqEnd: 330, duration: 0.16, volume: 0.22, type: 'triangle' });
  },
  'crossbow-fire': (a) => {
    a.tone({ freq: 1400 + Math.random() * 500, freqEnd: 500, duration: 0.07, volume: 0.1, type: 'sawtooth' });
  },
  'cannon-fire': (a) => {
    a.noise(0.25, 0.4, 500);
    a.tone({ freq: 120, freqEnd: 40, duration: 0.28, volume: 0.4, type: 'sine' });
  },
  'bomb-fire': (a) => {
    a.tone({ freq: 300, freqEnd: 600, duration: 0.12, volume: 0.2, type: 'sine' });
  },
  explosion: (a) => {
    a.noise(0.5, 0.45, 900);
    a.tone({ freq: 90, freqEnd: 30, duration: 0.45, volume: 0.4, type: 'sine' });
  },
  'enemy-hit': (a) => {
    a.tone({ freq: 700 + Math.random() * 300, freqEnd: 400, duration: 0.05, volume: 0.08, type: 'square' });
  },
  'enemy-death': (a) => {
    a.tone({ freq: 500, freqEnd: 120, duration: 0.14, volume: 0.16, type: 'sawtooth' });
    a.noise(0.08, 0.1, 2500, 0, 'highpass');
  },
  'wave-start': (a) => {
    a.tone({ freq: 196, duration: 0.16, volume: 0.3, type: 'sawtooth' });
    a.tone({ freq: 262, duration: 0.16, volume: 0.3, type: 'sawtooth', delay: 0.14 });
    a.tone({ freq: 392, duration: 0.28, volume: 0.32, type: 'sawtooth', delay: 0.28 });
  },
  'wave-complete': (a) => {
    a.tone({ freq: 523, duration: 0.12, volume: 0.28, type: 'triangle' });
    a.tone({ freq: 659, duration: 0.12, volume: 0.28, type: 'triangle', delay: 0.11 });
    a.tone({ freq: 784, duration: 0.24, volume: 0.3, type: 'triangle', delay: 0.22 });
  },
  'base-hit': (a) => {
    a.tone({ freq: 160, freqEnd: 60, duration: 0.25, volume: 0.4, type: 'square' });
    a.noise(0.15, 0.25, 700);
  },
  'game-over': (a) => {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => a.tone({ freq: f, duration: 0.3, volume: 0.3, type: 'sawtooth', delay: i * 0.26 }));
    a.tone({ freq: 98, freqEnd: 40, duration: 1.2, volume: 0.3, type: 'sine', delay: 0.9 });
  },
  victory: (a) => {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => a.tone({ freq: f, duration: 0.18, volume: 0.28, type: 'triangle', delay: i * 0.15 }));
  },
  click: (a) => {
    a.tone({ freq: 800, freqEnd: 600, duration: 0.05, volume: 0.12, type: 'sine' });
  },
  error: (a) => {
    a.tone({ freq: 180, duration: 0.12, volume: 0.2, type: 'square' });
    a.tone({ freq: 140, duration: 0.16, volume: 0.2, type: 'square', delay: 0.1 });
  },
};

import type { SoundPreset } from './types';

export class SoundEngine {
  private audioCtx: AudioContext | null = null;
  private soundEnabled = true;
  private silentAudio: HTMLAudioElement | null = null;
  private keepAliveActive = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.ensureContext();
        }
      });
    }
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }

    if (
      this.audioCtx &&
      (this.audioCtx.state === 'suspended' || (this.audioCtx.state as string) === 'interrupted')
    ) {
      this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Play silent buffer node to activate WebKit audio pipeline on mobile
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {}

    // Prepare HTML5 silent audio element to prevent mobile browser audio sleep
    if (!this.silentAudio && typeof Audio !== 'undefined') {
      try {
        this.silentAudio = new Audio(
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
        );
        this.silentAudio.loop = true;
        (this.silentAudio as any).playsInline = true;
        this.silentAudio.volume = 0.001;
      } catch {}
    }

    if (this.silentAudio && !this.keepAliveActive) {
      this.silentAudio.play().then(() => {
        if (!this.keepAliveActive && this.silentAudio) {
          this.silentAudio.pause();
        }
      }).catch(() => {});
    }
  }

  startKeepAlive(): void {
    this.keepAliveActive = true;
    if (!this.soundEnabled) return;
    this.ensureContext();
    if (this.silentAudio) {
      this.silentAudio.play().catch(() => {});
    }
  }

  stopKeepAlive(): void {
    this.keepAliveActive = false;
    if (this.silentAudio) {
      try {
        this.silentAudio.pause();
      } catch {}
    }
  }

  playTick(): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.02);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };

    osc.start(now);
    osc.stop(now + 0.025);
  }

  playTicking(type: 'subtle' | 'clock'): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'subtle') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.exponentialRampToValueAtTime(250, now + 0.015);
      gain.gain.setValueAtTime(0.015, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.01);
      gain.gain.setValueAtTime(0.02, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };
    osc.start(now);
    osc.stop(now + 0.02);
  }

  playPop(): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };

    osc.start(now);
    osc.stop(now + 0.065);
  }

  playModeSwitch(mode: 'work' | 'shortBreak' | 'longBreak'): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = mode === 'work' ? [523.25, 659.25] : mode === 'shortBreak' ? [659.25, 523.25] : [440, 554.37, 659.25];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.06;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  playCelebration(): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.07;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(start);
      osc.stop(start + 0.6);
    });
  }

  // Procedural ambient sound generators
  private ambientSource: AudioNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientModulator: AudioScheduledSourceNode | null = null;
  private ambientModulatorGain: GainNode | null = null;
  private ambientInterval: number | null = null;

  startAmbient(type: 'rain' | 'binaural' | 'waves', volume = 0.3): void {
    this.stopAmbient();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime);
    master.connect(ctx.destination);
    this.ambientGain = master;

    if (type === 'rain' || type === 'waves') {
      // Procedural pink/brown noise
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.96 * b1 + white * 0.11;
        b2 = 0.86 * b2 + white * 0.25;
        output[i] = (b0 + b1 + b2) * 0.5;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(type === 'rain' ? 900 : 500, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(master);
      whiteNoise.start();
      this.ambientSource = whiteNoise;

      if (type === 'waves') {
        // Modulate swell for ocean waves
        const swellOsc = ctx.createOscillator();
        const swellGain = ctx.createGain();
        swellOsc.frequency.setValueAtTime(0.12, ctx.currentTime); // ~8s wave cycle
        swellGain.gain.setValueAtTime(250, ctx.currentTime);
        swellOsc.connect(swellGain);
        swellGain.connect(filter.frequency);
        swellOsc.start();
        this.ambientModulator = swellOsc;
        this.ambientModulatorGain = swellGain;
      }
    } else if (type === 'binaural') {
      // 200Hz carrier + 40Hz gamma beat
      const merger = ctx.createChannelMerger(2);
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();
      oscL.frequency.setValueAtTime(200, ctx.currentTime);
      oscR.frequency.setValueAtTime(240, ctx.currentTime);

      const gainL = ctx.createGain();
      const gainR = ctx.createGain();
      gainL.gain.setValueAtTime(0.15, ctx.currentTime);
      gainR.gain.setValueAtTime(0.15, ctx.currentTime);

      oscL.connect(gainL);
      oscR.connect(gainR);
      gainL.connect(merger, 0, 0);
      gainR.connect(merger, 0, 1);
      merger.connect(master);

      oscL.start();
      oscR.start();
      this.ambientSource = merger;
    }
  }

  setAmbientVolume(volume: number): void {
    if (this.ambientGain && this.audioCtx) {
      this.ambientGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.audioCtx.currentTime, 0.05);
    }
  }

  stopAmbient(): void {
    if (this.ambientInterval !== null) {
      clearInterval(this.ambientInterval);
      this.ambientInterval = null;
    }
    if (this.ambientModulator) {
      try {
        if ('stop' in this.ambientModulator && typeof (this.ambientModulator as AudioScheduledSourceNode).stop === 'function') {
          (this.ambientModulator as AudioScheduledSourceNode).stop();
        }
        this.ambientModulator.disconnect();
      } catch {}
      this.ambientModulator = null;
    }
    if (this.ambientModulatorGain) {
      try {
        this.ambientModulatorGain.disconnect();
      } catch {}
      this.ambientModulatorGain = null;
    }
    if (this.ambientSource) {
      try {
        if ('stop' in this.ambientSource && typeof (this.ambientSource as AudioScheduledSourceNode).stop === 'function') {
          (this.ambientSource as AudioScheduledSourceNode).stop();
        }
        this.ambientSource.disconnect();
      } catch {}
      this.ambientSource = null;
    }
    if (this.ambientGain) {
      try {
        this.ambientGain.disconnect();
      } catch {}
      this.ambientGain = null;
    }
  }

  playChime(preset: SoundPreset = 'chord'): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (preset === 'bowl') {
      // Singing bowl resonance (432Hz + 864Hz)
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.28, now);
      masterGain.connect(ctx.destination);

      const notes = [432, 864, 1296];
      let finishedCount = 0;
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.3 / (idx + 1), now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
        osc.connect(gain);
        gain.connect(masterGain);

        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
          finishedCount++;
          if (finishedCount === notes.length) {
            try { masterGain.disconnect(); } catch {}
          }
        };

        osc.start(now);
        osc.stop(now + 3.6);
      });
      return;
    }

    if (preset === 'marimba') {
      // Wood mallet marimba strikes
      const notes = [523.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.1;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        };

        osc.start(start);
        osc.stop(start + 0.45);
      });
      return;
    }

    if (preset === 'synth') {
      // 4-note ascending bright arpeggio
      const notes = [523.25, 659.25, 783.99, 987.77];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.09;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        };

        osc.start(start);
        osc.stop(start + 0.85);
      });
      return;
    }

    // Default 'chord': E5 (659.25Hz), B5 (987.77Hz), E6 (1318.51Hz) harmonic chord
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.3, now);
    masterGain.connect(ctx.destination);

    const freqs = [659.25, 987.77, 1318.51];
    let finishedCount = 0;
    freqs.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = now + index * 0.08;
      const decayDuration = 2.4;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(0.25 / (index + 1), startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decayDuration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
        finishedCount++;
        if (finishedCount === freqs.length) {
          try {
            masterGain.disconnect();
          } catch {}
        }
      };

      osc.start(startTime);
      osc.stop(startTime + decayDuration);
    });
  }

  triggerHaptic(enabled = true, pattern: number[] = [120, 60, 180]): void {
    if (!enabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  destroy(): void {
    this.stopKeepAlive();
    this.silentAudio = null;
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

"use client";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

// Soothing felt-piano / warm Rhodes chord progression (Fmaj9 -> Cmaj9 -> Am9 -> G6add9)
const CHORD_PROGRESSION: number[][] = [
  [174.61, 220.0, 261.63, 329.63, 392.0],
  [130.81, 196.0, 261.63, 329.63, 392.0],
  [110.0, 164.81, 220.0, 261.63, 329.63],
  [98.0, 146.83, 196.0, 246.94, 293.66],
];

// Harmonized C-major pentatonic sparkle notes
const SPARKLE_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

class SwarmAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private chordIndex = 0;
  private sparkleIndex = 0;
  private enabled = false;
  private lastKeyAt = 0;
  private lastPopAt = 0;

  public init(): boolean {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("bp-swarm-music");
    if (saved !== null) {
      this.enabled = saved === "true";
    }
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AudioCtor) return null;
      try {
        this.ctx = new AudioCtor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public startMusic(): void {
    this.enabled = true;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("bp-swarm-music", "true");
    }
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
    this.masterGain.gain.linearRampToValueAtTime(0.55, now + 1.2);

    if (this.musicTimer === null && typeof window !== "undefined") {
      this.playWarmChord();
      this.musicTimer = window.setInterval(() => {
        if (this.enabled && document.visibilityState === "visible") {
          this.playWarmChord();
        }
      }, 3600);
    }
  }

  public stopMusic(): void {
    this.enabled = false;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("bp-swarm-music", "false");
    }
    if (this.musicTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    }
  }

  public toggle(): boolean {
    if (this.enabled) {
      this.stopMusic();
    } else {
      this.startMusic();
    }
    return this.enabled;
  }

  private playWarmChord(): void {
    const ctx = this.ctx;
    const out = this.masterGain;
    if (!ctx || !out || ctx.state !== "running") return;

    const notes = CHORD_PROGRESSION[this.chordIndex % CHORD_PROGRESSION.length];
    this.chordIndex += 1;

    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i];
      const start = ctx.currentTime + i * 0.21 + (Math.random() * 0.03 - 0.015);
      const dur = 3.2;

      const oscMain = ctx.createOscillator();
      const oscWarm = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const noteGain = ctx.createGain();

      oscMain.type = "sine";
      oscMain.frequency.setValueAtTime(freq, start);

      oscWarm.type = "triangle";
      oscWarm.frequency.setValueAtTime(freq * 2, start);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(720, start);
      filter.frequency.exponentialRampToValueAtTime(280, start + dur);

      const warmMix = ctx.createGain();
      warmMix.gain.setValueAtTime(0.08, start);

      const peak = i === 0 ? 0.042 : 0.028;
      noteGain.gain.setValueAtTime(0.0001, start);
      noteGain.gain.linearRampToValueAtTime(peak, start + 0.065);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      oscMain.connect(filter);
      oscWarm.connect(warmMix);
      warmMix.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(out);

      oscMain.start(start);
      oscWarm.start(start);
      oscMain.stop(start + dur + 0.05);
      oscWarm.stop(start + dur + 0.05);
    }
  }

  public playKeyTick(): void {
    if (!this.enabled || !this.ctx || !this.masterGain || this.ctx.state !== "running") return;
    const nowMs = performance.now();
    if (nowMs - this.lastKeyAt < 52) return;
    this.lastKeyAt = nowMs;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    const f = 240 + (Math.random() - 0.5) * 45;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.022);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.028, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.028);
  }

  public playSparklePop(): void {
    if (!this.enabled || !this.ctx || !this.masterGain || this.ctx.state !== "running") return;
    const nowMs = performance.now();
    if (nowMs - this.lastPopAt < 75) return;
    this.lastPopAt = nowMs;

    const freq = SPARKLE_NOTES[this.sparkleIndex % SPARKLE_NOTES.length];
    this.sparkleIndex += 1;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.004, now + 0.24);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.036, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }
}

export const swarmAudio = new SwarmAudioEngine();

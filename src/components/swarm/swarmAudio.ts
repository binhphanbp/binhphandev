"use client";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

class SwarmAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private lastHoverAt = 0;
  private listenersAttached = false;

  public init() {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("bp_swarm_sound");
    if (saved !== null) {
      this.enabled = saved === "true";
    }
    if (!this.listenersAttached) {
      this.listenersAttached = true;
      const unlock = () => {
        if (this.enabled) {
          this.ensureContext(true);
        }
      };
      window.addEventListener("pointerdown", unlock, { passive: true });
      window.addEventListener("keydown", unlock, { passive: true });
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean): void {
    this.enabled = next;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("bp_swarm_sound", String(next));
    }
    if (next) {
      this.ensureContext(true);
      this.playSnap();
    }
  }

  public unlockNow(): void {
    if (this.enabled) {
      this.ensureContext(true);
    }
  }

  private ensureContext(resumeIfSuspended = false): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AudioCtor) return null;
      try {
        this.ctx = new AudioCtor();
      } catch {
        return null;
      }
    }
    if (resumeIfSuspended && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx.state !== "running") return null;
    return this.ctx;
  }

  private playTone(
    startFreq: number,
    endFreq: number,
    durationMs: number,
    peakGain: number,
    type: OscillatorType = "sine",
    delaySec = 0,
  ) {
    const ctx = this.ensureContext(false);
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const dur = durationMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, endFreq), start + dur);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peakGain, start + Math.min(0.004, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + dur + 0.005);
  }

  public playKey() {
    const jitter = (Math.random() - 0.5) * 55;
    this.playTone(215 + jitter, 78, 24, 0.032, "triangle");
    this.playTone(1150 + jitter * 2, 420, 9, 0.012, "sine");
  }

  public playDragStart() {
    this.playTone(330, 510, 26, 0.022, "sine");
  }

  public playSnap() {
    this.playTone(790, 390, 32, 0.036, "sine");
  }

  public playDuplicate() {
    this.playTone(460, 560, 26, 0.024, "sine", 0);
    this.playTone(690, 820, 32, 0.026, "sine", 0.035);
  }

  public playHoverTick() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.lastHoverAt < 85) return;
    this.lastHoverAt = now;
    this.playTone(960, 620, 12, 0.01, "sine");
  }

  public playComplete() {
    const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];
    for (let idx = 0; idx < chord.length; idx++) {
      const freq = chord[idx];
      this.playTone(freq, freq * 0.998, 280, 0.026, "sine", idx * 0.042);
    }
  }
}

export const swarmAudio = new SwarmAudioEngine();

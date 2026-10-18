export type MusicMood = 'lobby' | 'journey' | 'outer' | 'decision' | 'review';
export type SoundCue = 'turn' | 'dice' | 'result' | 'milestone' | 'settlement';
export interface AudioSettings { music: number; effects: number }
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { music: 25, effects: 45 };
export function normalizeAudioSettings(value: unknown): AudioSettings {
  const v = value as Partial<AudioSettings> | null;
  const level = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
  return { music: level(v?.music, 25), effects: level(v?.effects, 45) };
}

// Original pentatonic score, generated locally; no recordings, tracking or remote assets.
const CHORDS = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 62]];
const MELODY = [72, 76, 79, 0, 76, 74, 72, 0, 69, 72, 76, 79, 76, 0, 74, 72,
  72, 77, 81, 0, 79, 77, 76, 72, 74, 79, 83, 0, 81, 79, 74, 0];
const CUES: Record<SoundCue, number[]> = {
  turn: [67, 72], dice: [60, 65, 62, 69, 64, 72], result: [72, 76],
  milestone: [60, 64, 67, 72, 79], settlement: [67, 72, 76],
};

/** One engine per display. Nothing starts before an explicit user gesture. */
export class GameAudio {
  private context?: AudioContext;
  private musicBus?: GainNode;
  private effectsBus?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private nodes = new Set<OscillatorNode>();
  private step = 0;
  private enabled = false;
  private active = true;
  private disposed = false;
  private mood: MusicMood = 'lobby';
  private settings = DEFAULT_AUDIO_SETTINGS;
  private lastCueAt = -Infinity;

  async enable() {
    if (this.disposed) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus.gain.value = 0;
      this.effectsBus.gain.value = 0;
      this.musicBus.connect(this.context.destination);
      this.effectsBus.connect(this.context.destination);
    }
    await this.context.resume();
    if (this.disposed) return;
    if (this.context.state !== 'running') throw new Error('audio_blocked');
    this.enabled = true;
    this.update();
  }
  mute() { this.enabled = false; this.update(); }
  configure(settings: AudioSettings, mood: MusicMood, active: boolean) {
    this.settings = normalizeAudioSettings(settings);
    if (mood !== this.mood) this.step = 0;
    this.mood = mood;
    this.active = active;
    this.update();
  }
  private update() {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    const audible = this.enabled && this.active;
    const duck = this.mood === 'decision' ? 0.3 : this.mood === 'review' ? 0.5 : 1;
    this.musicBus!.gain.setTargetAtTime(audible ? this.settings.music / 100 * 0.26 * duck : 0, ctx.currentTime, 0.12);
    this.effectsBus!.gain.setTargetAtTime(audible ? this.settings.effects / 100 * 0.22 : 0, ctx.currentTime, 0.03);
    if (!audible || !this.settings.music) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    } else if (!this.timer) {
      this.tick();
      // 112 BPM, eighth-note pulse: light plucked melody with a bouncing bass.
      this.timer = setInterval(() => this.tick(), 268);
    }
    // Stop queued notes when muted/hidden; returning never replays a backlog.
    if (!audible) {
      for (const node of this.nodes) { try { node.stop(); } catch { /* already ended */ } }
      this.nodes.clear();
    }
  }
  private note(midi: number, time: number, duration: number, bus: GainNode, volume: number, type: OscillatorType = 'sine') {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(envelope); envelope.connect(bus);
    this.nodes.add(osc);
    osc.onended = () => { osc.disconnect(); envelope.disconnect(); this.nodes.delete(osc); };
    osc.start(time); osc.stop(time + duration + 0.03);
  }
  private tick() {
    if (this.context?.state !== 'running' || !this.enabled || !this.active) return;
    const t = this.context.currentTime + 0.03;
    const chord = CHORDS[Math.floor(this.step / 8) % CHORDS.length];
    const shift = this.mood === 'outer' ? 5 : 0;
    if (this.step % 8 === 0) chord.forEach(n => this.note(n + shift, t, 2.05, this.musicBus!, 0.08));
    if (this.mood !== 'decision' && this.mood !== 'review' && this.step % 2 === 0) {
      this.note(chord[this.step % 4 === 0 ? 0 : 1] - 12 + shift, t, 0.22, this.musicBus!, 0.22);
      this.note(chord[2] + 12 + shift, t + 0.13, 0.13, this.musicBus!, 0.08, 'triangle');
    }
    const melody = MELODY[this.step % MELODY.length];
    if (melody && this.mood !== 'decision' && (this.mood !== 'review' || this.step % 2 === 0)) this.note(melody + shift, t, 0.38, this.musicBus!, 0.15, 'triangle');
    this.step = (this.step + 1) % 32;
  }
  play(cue: SoundCue) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.enabled || !this.active || !this.settings.effects) return;
    if (ctx.currentTime - this.lastCueAt < 0.5) return;
    this.lastCueAt = ctx.currentTime;
    CUES[cue].forEach((n, i) => this.note(n, ctx.currentTime + 0.02 + i * (cue === 'dice' ? 0.07 : 0.14), 0.35, this.effectsBus!, 0.45, 'triangle'));
  }
  dispose() {
    this.mute();
    this.disposed = true;
    if (this.context) void this.context.close().catch(() => {});
  }
}

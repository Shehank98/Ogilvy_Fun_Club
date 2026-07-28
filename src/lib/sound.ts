"use client";

/**
 * Tiny WebAudio blips — a "pop" on join and a chime on team reveal.
 *
 * Synthesised rather than shipped as audio files: two short tones cost nothing
 * to download and can't fail to load. Muted by default (nobody wants a phone
 * chirping unannounced in a bar); the preference lives in localStorage.
 */

const STORAGE_KEY = "ofc:sound";

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "on";
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  // Browsers only allow audio to start from a user gesture; unmuting is one.
  if (enabled) void audioContext()?.resume();
}

type ToneOptions = {
  freq: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

function tone(
  ctx: AudioContext,
  { freq, start, duration, gain = 0.12, type = "sine" }: ToneOptions
) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export function playPop(): void {
  if (!isSoundEnabled()) return;
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume();
  tone(ctx, { freq: 660, start: 0, duration: 0.09, gain: 0.1, type: "triangle" });
}

export function playChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume();
  // A major triad arpeggio: C-E-G.
  tone(ctx, { freq: 523.25, start: 0, duration: 0.28 });
  tone(ctx, { freq: 659.25, start: 0.09, duration: 0.28 });
  tone(ctx, { freq: 783.99, start: 0.18, duration: 0.42, gain: 0.14 });
}

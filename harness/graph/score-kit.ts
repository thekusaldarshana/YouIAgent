// Small deterministic sound primitives. The film agent owns the composition and cue timings.
// This file is compiled to ESM and staged into each film as `score-kit.mjs`; keep it dependency-free
// (Node built-ins only) because the generated score script runs under Node's permission model.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function midiToHz(note: number): number { return 440 * 2 ** ((note - 69) / 12); }

export type SampleFunction = (t: number, index: number) => number;
export type ToneShape = 'sine' | 'triangle' | 'soft-saw' | 'bell';

export interface ScoreEvent {
  at: number;
  length: number;
  gain?: number | undefined;
  pan?: number | undefined;
  attack?: number | undefined;
  release?: number | undefined;
  decay?: number | null | undefined;
  sample: SampleFunction;
}

type EventOptions = Omit<ScoreEvent, 'at' | 'length' | 'sample'>;

export interface ToneEvent extends EventOptions {
  at: number;
  length: number;
  midi?: number | undefined;
  frequency?: number | undefined;
  shape?: ToneShape | undefined;
}

export interface NoiseEvent extends EventOptions {
  at: number;
  length: number;
  color?: 'bright' | 'dark' | undefined;
}

export interface KickEvent extends EventOptions {
  at: number;
  length?: number | undefined;
}

export interface WavOptions {
  peakDb?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export class Score {
  readonly duration: number;
  readonly sampleRate: number;
  readonly length: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
  private seed: number;

  constructor({ duration, sampleRate = 44_100, seed = 1 }: { duration: number; sampleRate?: number; seed?: number }) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error('Score duration must be 0–180 seconds.');
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.length = Math.ceil(duration * sampleRate);
    this.left = new Float32Array(this.length);
    this.right = new Float32Array(this.length);
    this.seed = seed >>> 0 || 1;
  }

  random(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 2 ** 32 * 2 - 1;
  }

  add({ at, length, gain = 0.1, pan = 0, attack = 0.01, release = 0.1, decay = null, sample }: ScoreEvent): this {
    if (![at, length, gain, pan, attack, release].every(Number.isFinite) || length <= 0 || typeof sample !== 'function') throw new Error('Invalid score event.');
    const start = Math.max(0, Math.floor(at * this.sampleRate));
    const end = Math.min(this.length, Math.ceil((at + length) * this.sampleRate));
    const leftGain = Math.sqrt((1 - Math.max(-1, Math.min(1, pan))) / 2);
    const rightGain = Math.sqrt((1 + Math.max(-1, Math.min(1, pan))) / 2);
    for (let i = start; i < end; i++) {
      const t = i / this.sampleRate - at;
      const envelope = Math.min(1, t / Math.max(attack, 1 / this.sampleRate), (length - t) / Math.max(release, 1 / this.sampleRate));
      const value = sample(t, i) * gain * Math.max(0, envelope) * (decay ? Math.exp(-t / decay) : 1);
      this.left[i] = (this.left[i] ?? 0) + value * leftGain;
      this.right[i] = (this.right[i] ?? 0) + value * rightGain;
    }
    return this;
  }

  tone({ at, length, midi, frequency = midi === undefined ? Number.NaN : midiToHz(midi), shape = 'sine', gain = 0.12, ...options }: ToneEvent): this {
    if (!Number.isFinite(frequency) || frequency <= 0) throw new Error('Tone needs a MIDI note or frequency.');
    return this.add({ at, length, gain, ...options, sample: (t) => {
      const phase = (t * frequency) % 1;
      if (shape === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
      if (shape === 'soft-saw') return Math.sin(2 * Math.PI * phase) + 0.3 * Math.sin(4 * Math.PI * phase) + 0.12 * Math.sin(6 * Math.PI * phase);
      if (shape === 'bell') return Math.sin(2 * Math.PI * phase) + 0.35 * Math.sin(2 * Math.PI * phase * 2.01);
      return Math.sin(2 * Math.PI * phase);
    } });
  }

  noise({ at, length, gain = 0.04, color = 'bright', ...options }: NoiseEvent): this {
    let low = 0;
    return this.add({ at, length, gain, ...options, sample: () => {
      const white = this.random();
      low += (white - low) * (color === 'dark' ? 0.015 : 0.15);
      return color === 'dark' ? low : white - low;
    } });
  }

  kick({ at, gain = 0.23, length = 0.34, ...options }: KickEvent): this {
    return this.add({ at, length, gain, attack: 0.002, release: 0.12, decay: 0.11, ...options, sample: (t) => {
      const phase = 2 * Math.PI * (45 * t + 100 * 0.028 * (1 - Math.exp(-t / 0.028)));
      return Math.sin(phase);
    } });
  }

  delay({ seconds = 0.19, gain = 0.15 }: { seconds?: number; gain?: number } = {}): this {
    const shift = Math.floor(seconds * this.sampleRate);
    if (shift < 1 || shift >= this.length || gain < 0 || gain > 0.8) throw new Error('Invalid delay.');
    for (let i = shift; i < this.length; i++) {
      this.left[i] = (this.left[i] ?? 0) + (this.right[i - shift] ?? 0) * gain;
      this.right[i] = (this.right[i] ?? 0) + (this.left[i - shift] ?? 0) * gain;
    }
    return this;
  }

  async writeWav(path: string, { peakDb = -3, fadeIn = 0.08, fadeOut = 0.7 }: WavOptions = {}): Promise<{ path: string; durationSeconds: number; peakDb: number }> {
    let peak = 0;
    for (let i = 0; i < this.length; i++) peak = Math.max(peak, Math.abs(this.left[i] ?? 0), Math.abs(this.right[i] ?? 0));
    if (peak < 0.00001) throw new Error('Score has no audible events.');
    const scale = Math.min(4, 10 ** (peakDb / 20) / peak);
    const buffer = Buffer.alloc(44 + this.length * 4);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
    buffer.writeUInt32LE(this.sampleRate, 24); buffer.writeUInt32LE(this.sampleRate * 4, 28);
    buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
    buffer.writeUInt32LE(this.length * 4, 40);
    for (let i = 0; i < this.length; i++) {
      const t = i / this.sampleRate;
      const fade = Math.max(0, Math.min(1, t / Math.max(fadeIn, 0.001), (this.duration - t) / Math.max(fadeOut, 0.001)));
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (this.left[i] ?? 0) * scale * fade)) * 32767), 44 + i * 4);
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (this.right[i] ?? 0) * scale * fade)) * 32767), 46 + i * 4);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return { path, durationSeconds: this.duration, peakDb };
  }
}

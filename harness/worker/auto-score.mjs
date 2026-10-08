import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RATE = 44100;
const TAU = Math.PI * 2;

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function midi(note) { return 440 * 2 ** ((note - 69) / 12); }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

export function createScorePcm(plan, direction = '') {
  const duration = Number(plan?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('A valid film duration is required for automatic music.');
  const count = Math.round(duration * RATE);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const seed = hash(`${direction}|${JSON.stringify(plan.scenes || [])}`);
  const calm = /calm|quiet|warm|gentle|reflective|delicate|soft/i.test(direction);
  const bpm = Number.isFinite(Number(plan.bpm)) ? clamp(Number(plan.bpm), 60, 180) : calm ? 94 + seed % 9 : 108 + seed % 17;
  const beat = 60 / bpm;
  const root = [45, 47, 48, 50, 52][seed % 5];
  const minor = /dark|tense|frustrat|absurd|problem|dramatic/i.test(direction) && !/bright|joy|playful/i.test(direction);
  const third = minor ? 3 : 4;
  const progression = [0, -2, -5, -7];
  const reveal = clamp(Number(plan.scenes?.[1]?.start) || duration * 0.24, 1, duration * 0.55);
  const phrases = Math.max(2, Math.ceil((duration - reveal) / (beat * 4)));

  function tone(start, length, note, gain, voice = 'pad', pan = 0) {
    const from = Math.max(0, Math.floor(start * RATE));
    const to = Math.min(count, Math.ceil((start + length) * RATE));
    const frequency = midi(note);
    const attack = voice === 'pad' ? 0.42 : voice === 'bass' ? 0.035 : 0.006;
    const release = voice === 'pad' ? 0.65 : voice === 'bass' ? 0.22 : 0.16;
    const angle = (pan + 1) * Math.PI / 4;
    for (let i = from; i < to; i++) {
      const t = i / RATE - start;
      const remaining = length - t;
      const envelope = Math.min(1, t / attack) * Math.min(1, remaining / release);
      if (envelope <= 0) continue;
      const phase = TAU * frequency * t;
      let wave;
      if (voice === 'pad') wave = Math.sin(phase + 0.16 * Math.sin(TAU * 0.29 * t)) * 0.78 + Math.sin(phase * 2.002) * 0.16 + Math.sin(phase * 0.501) * 0.12;
      else if (voice === 'bass') wave = Math.sin(phase) * 0.88 + Math.sin(phase * 2) * 0.12;
      else wave = (Math.sin(phase) * 0.78 + Math.sin(phase * 2.01) * 0.22) * Math.exp(-2.8 * t);
      const sample = wave * envelope * gain;
      left[i] += sample * Math.cos(angle);
      right[i] += sample * Math.sin(angle);
    }
  }

  function tick(start, gain, low = false) {
    const from = Math.floor(start * RATE);
    let noise = (seed ^ from) >>> 0;
    for (let j = 0; j < RATE * (low ? 0.14 : 0.055); j++) {
      const i = from + j;
      if (i < 0 || i >= count) break;
      noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
      const t = j / RATE;
      const sample = ((noise >>> 0) / 2147483648 - 1) * Math.exp(-(low ? 32 : 95) * t) * gain;
      left[i] += sample * 0.6;
      right[i] += sample * 0.6;
    }
  }

  // The opening uses tension and space; the scene transition introduces harmony.
  for (let at = 0.15, index = 0; at < reveal - 0.15; at += beat / 2, index++) {
    tick(at, index % 2 ? 0.055 : 0.09);
    if (index % 4 === 0) tone(at, Math.min(beat * 1.3, reveal - at), root - 12, 0.10, 'bass');
  }
  for (let phrase = 0; phrase < phrases; phrase++) {
    const start = reveal + phrase * beat * 4;
    if (start >= duration - 0.2) break;
    const length = Math.min(beat * 4.25, duration - start);
    const base = root + progression[phrase % progression.length];
    tone(start, length, base, 0.105, 'pad', -0.35);
    tone(start, length, base + third, 0.075, 'pad', 0.35);
    tone(start, length, base + 7, 0.080, 'pad', 0.05);
    for (let pulse = 0; pulse < 4; pulse++) {
      const at = start + pulse * beat;
      if (at >= duration - 0.25) break;
      tone(at, Math.min(beat * 0.76, duration - at), base - 12, calm ? 0.11 : 0.14, 'bass');
      if (!calm && pulse % 2 === 0) tick(at, 0.10, true);
      if (pulse === 1 || pulse === 3) {
        const steps = [12, 7, third + 12, 14, 7, 12];
        tone(at + beat * 0.1, Math.min(beat * 1.15, duration - at - beat * 0.1), base + steps[(phrase * 2 + pulse + seed) % steps.length], calm ? 0.09 : 0.12, 'pluck', pulse === 1 ? -0.3 : 0.3);
      }
    }
  }
  // Resolve on the last scene without looping the earlier phrase.
  const ending = Number(plan.scenes?.at(-1)?.start) || duration - 2.5;
  if (ending > reveal && ending < duration - 0.5) {
    tone(ending, duration - ending, root, 0.10, 'pad', -0.2);
    tone(ending, duration - ending, root + third + 12, 0.065, 'pad', 0.3);
  }

  const delay = Math.floor(RATE * 0.19);
  for (let i = delay; i < count; i++) {
    const l = left[i - delay];
    left[i] += right[i - delay] * 0.08;
    right[i] += l * 0.08;
  }
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / (RATE * 0.12), (count - i - 1) / (RATE * 0.85));
    left[i] *= fade;
    right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const scale = peak > 0 ? Math.min(1, 0.78 / peak) : 1;
  const pcm = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    pcm.writeInt16LE(Math.round(clamp(left[i] * scale, -1, 1) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(clamp(right[i] * scale, -1, 1) * 32767), i * 4 + 2);
  }
  return { pcm, sampleRate: RATE, channels: 2, bpm, durationSeconds: duration, style: calm ? 'warm restrained instrumental' : 'rhythmic instrumental' };
}

export async function writeScoreWav(path, plan, direction = '') {
  const score = createScorePcm(plan, direction);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + score.pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(score.pcm.length, 40);
  await writeFile(path, Buffer.concat([header, score.pcm]));
  return { path, bpm: score.bpm, style: score.style };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
  });
}

export async function addAutomaticScore(output, workspace, ffmpegBin = 'ffmpeg') {
  const plan = JSON.parse(await readFile(join(workspace, 'film-output', 'plan-data.json'), 'utf8'));
  const direction = await readFile(join(workspace, 'film-output', 'film-plan.md'), 'utf8').catch(() => '');
  const wav = output.replace(/\.mp4$/i, '.auto-score.wav');
  const scoredOutput = output.replace(/\.mp4$/i, '.with-sound.mp4');
  const score = await writeScoreWav(wav, plan, direction);
  await run(ffmpegBin, ['-v', 'error', '-y', '-i', output, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(plan.durationSeconds), '-movflags', '+faststart', scoredOutput]);
  if (!(await stat(scoredOutput)).size) throw new Error('Automatic soundtrack mux produced an empty file.');
  return { source: 'original local score', ...score, output: scoredOutput, originalVideo: output };
}

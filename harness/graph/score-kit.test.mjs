import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Score, midiToHz } from './score-kit.mjs';

test('score primitives write an audible stereo WAV with the requested duration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'score-kit-test-'));
  try {
    const path = join(root, 'score.wav');
    const score = new Score({ duration: 1.5, sampleRate: 24_000, seed: 7 });
    assert.equal(midiToHz(69), 440);
    score.tone({ at: 0, length: 1.4, midi: 57, shape: 'soft-saw', gain: 0.12, release: 0.4 });
    score.kick({ at: 0.2 });
    score.noise({ at: 0.6, length: 0.08, gain: 0.04 });
    score.delay();
    await score.writeWav(path);
    const wav = await readFile(path);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.length, 44 + 1.5 * 24_000 * 4);
    assert.ok(wav.some((byte, index) => index > 44 && byte !== 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

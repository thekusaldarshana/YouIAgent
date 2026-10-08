import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createScorePcm, writeScoreWav } from './auto-score.mjs';

test('automatic score creates audible stereo PCM with a soft ending and a valid WAV', async () => {
  const plan = { durationSeconds: 4, scenes: [{ name: 'problem', start: 0, duration: 1 }, { name: 'reveal', start: 1, duration: 2 }, { name: 'ending', start: 3, duration: 1 }] };
  const score = createScorePcm(plan, 'Calm opening, warm reveal and final resolution.');
  assert.equal(score.pcm.length, 4 * 44100 * 4);
  let active = 0;
  for (let i = 0; i < score.pcm.length; i += 4) if (score.pcm.readInt16LE(i) !== 0) active++;
  assert.ok(active > 44100, 'score should contain sustained sound');
  assert.ok(Math.abs(score.pcm.readInt16LE(score.pcm.length - 4)) < 100, 'score should fade out');
  const dir = await mkdtemp(join(tmpdir(), 'youiagent-score-'));
  try {
    const path = join(dir, 'score.wav');
    await writeScoreWav(path, plan, 'Calm opening, warm reveal and final resolution.');
    const wav = await readFile(path);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(40), score.pcm.length);
    assert.deepEqual(wav.subarray(44), score.pcm);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

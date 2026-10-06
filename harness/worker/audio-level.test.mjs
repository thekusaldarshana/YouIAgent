import assert from 'node:assert/strict';
import test from 'node:test';
import { musicGainDb, parseEbur128 } from './audio-level.mjs';

test('parse EBU R128 summary, not rolling measurements', () => {
  const log = 't: 1 I: -30.0 LUFS\nSummary:\nIntegrated loudness:\n    I: -24.5 LUFS\nTrue peak:\n    Peak: -11.8 dBFS\n';
  assert.deepEqual(parseEbur128(log), { loudnessLufs: -24.5, truePeakDbfs: -11.8 });
});

test('linear music gain targets loudness and preserves a peak margin', () => {
  assert.equal(musicGainDb({ loudnessLufs: -24.5, truePeakDbfs: -11.8 }), 6.5);
  assert.equal(musicGainDb({ loudnessLufs: -18, truePeakDbfs: -4 }), 0);
  assert.equal(musicGainDb({ loudnessLufs: -30, truePeakDbfs: -6 }), 3);
});

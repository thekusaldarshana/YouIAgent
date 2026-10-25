import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewRenderedFilm } from './review.js';

test('a missing rendered film produces an honest unreviewed report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'film-review-test-'));
  try {
    const state = { workspace: root, jobDir: root, render: { output: join(root, 'missing.mp4'), durationSeconds: 18 }, input: {} };
    const result = await reviewRenderedFilm(state, async () => { throw new Error('review agent must not be called'); });
    assert.equal(result.status, 'unreviewed');
    assert.match(await readFile(result.report, 'utf8'), /Rendered video is unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

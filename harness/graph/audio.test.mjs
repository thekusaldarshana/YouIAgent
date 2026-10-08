import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageAudioCatalog, stageSelectedAudio, validateOriginalScore } from './audio.mjs';

test('optional library offers bundled music and stages a chosen track', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'film-audio-test-'));
  try {
    const result = await stageAudioCatalog(workspace, null, 'library');
    assert.deepEqual(result.tracks, ['airy', 'magic-space', 'party-sector', 'urgent']);
    const catalog = JSON.parse(await readFile(join(workspace, 'film-audio', 'catalog.json')));
    assert.equal(catalog.sourceKind, 'bundled');
    assert.match(await readFile(join(workspace, 'film-audio', 'CATALOG.md'), 'utf8'), /CC0 by CodeManu/);
    const selected = await stageSelectedAudio(workspace, null, 'magic-space');
    assert.match(selected.destination.replaceAll('\\', '/'), /composition\/assets\/music\/magic-space\.mp3$/);
    assert.ok((await readFile(selected.destination)).length > 100_000);
    await assert.rejects(stageSelectedAudio(workspace, null, 'none'), /soundtrack was requested/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('default soundtrack mode requires a new score inside this job', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'film-audio-test-'));
  try {
    assert.deepEqual((await stageAudioCatalog(workspace)).tracks, ['original']);
    const catalog = JSON.parse(await readFile(join(workspace, 'film-audio', 'catalog.json')));
    assert.equal(catalog.sourceKind, 'original');
    const selected = await stageSelectedAudio(workspace, null, 'original');
    assert.match(selected.destination.replaceAll('\\', '/'), /composition\/assets\/music\/original-score\.wav$/);
    assert.match(await readFile(join(workspace, 'film-output', 'composition', 'score-kit.mjs'), 'utf8'), /class Score/);
    assert.match(await readFile(join(workspace, 'film-audio', 'SELECTED.md'), 'utf8'), /Compose a new soundtrack for this film/);
    await assert.rejects(validateOriginalScore(workspace, 20), /Original score is missing or empty/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('silence is explicit and a custom directory replaces bundled music', async () => {
  const root = await mkdtemp(join(tmpdir(), 'film-audio-test-'));
  try {
    const custom = join(root, 'custom');
    const workspace = join(root, 'job');
    await mkdir(custom);
    await writeFile(join(custom, 'My Track.wav'), 'fixture audio');
    assert.deepEqual((await stageAudioCatalog(workspace, custom, 'library')).tracks, ['my-track']);
    const selected = await stageSelectedAudio(workspace, custom, 'my-track');
    assert.equal((await readFile(selected.destination, 'utf8')), 'fixture audio');
    assert.deepEqual((await stageAudioCatalog(workspace, null, 'silent')).tracks, []);
    assert.equal((await stageSelectedAudio(workspace, null, 'none')).source, null);
    await assert.rejects(stageAudioCatalog(workspace, join(root, 'missing'), 'library'), /not a directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

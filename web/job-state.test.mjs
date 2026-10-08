import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJobStatus } from './job-state.mjs';

test('a completed graph report survives a web server restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'youiagent-web-'));
  try {
    await writeFile(join(dir, 'web-job.json'), JSON.stringify({ id: 'test', state: 'running', input: { websiteUrl: 'https://example.com/' } }));
    await writeFile(join(dir, 'graph-events.jsonl'), `${JSON.stringify({ node: 'capture', state: 'complete' })}\n${JSON.stringify({ node: 'render', state: 'start' })}\n`);
    assert.equal((await readJobStatus(dir, true)).stage, 'render');
    assert.equal((await readJobStatus(dir, false)).state, 'interrupted');
    await writeFile(join(dir, 'graph-report.json'), JSON.stringify({ plan: { musicChoice: 'airy' }, music: { choice: 'airy', title: 'Airy', author: 'SRG774', license: 'CC0' }, render: { output: '/tmp/film.mp4', durationSeconds: 22, hasAudio: true, video: { width: 1920, height: 1080 } } }));
    const result = await readJobStatus(dir, false);
    assert.equal(result.state, 'complete');
    assert.equal(result.filmReady, true);
    assert.equal(result.render.durationSeconds, 22);
    assert.equal(result.render.hasAudio, true);
    assert.equal(result.musicChoice, 'airy');
    assert.equal(result.music.license, 'CC0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

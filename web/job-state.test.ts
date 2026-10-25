import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defined } from '../test/helpers.js';
import { readJobStatus } from './job-state.js';

test('a completed graph report survives a web server restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'youiagent-web-'));
  try {
    await writeFile(join(dir, 'web-job.json'), JSON.stringify({ id: 'test', state: 'running', input: { websiteUrl: 'https://example.com/' } }));
    await writeFile(join(dir, 'graph-events.jsonl'), `${JSON.stringify({ node: 'capture', state: 'complete' })}\n${JSON.stringify({ node: 'render', state: 'start' })}\n`);
    assert.equal(defined(await readJobStatus(dir, true)).stage, 'render');
    assert.equal(defined(await readJobStatus(dir, false)).state, 'interrupted');
    await writeFile(join(dir, 'graph-report.json'), JSON.stringify({ plan: { musicChoice: 'airy' }, music: { choice: 'airy', title: 'Airy', author: 'SRG774', license: 'CC0' }, render: { output: '/tmp/film.mp4', durationSeconds: 22, hasAudio: true, video: { width: 1920, height: 1080 } } }));
    const result = defined(await readJobStatus(dir, false));
    assert.equal(result.state, 'complete');
    assert.equal(result.filmReady, true);
    assert.equal(result.render?.durationSeconds, 22);
    assert.equal(result.render?.hasAudio, true);
    assert.equal(result.musicChoice, 'airy');
    assert.equal(result.music?.license, 'CC0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed composition can resume with source, plan and composition checkpoints', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'youiagent-resume-'));
  try {
    const output = join(dir, 'workspace', 'film-output');
    await mkdir(join(output, 'composition'), { recursive: true });
    await writeFile(join(dir, 'web-job.json'), JSON.stringify({ id: 'fixture', state: 'failed', input: { websiteUrl: 'https://example.com/', repositoryUrl: 'https://github.com/a/b' } }));
    await writeFile(join(dir, 'source-manifest.json'), '{}');
    await writeFile(join(dir, 'graph-events.jsonl'), ['capture', 'prepare', 'plan', 'planGate', 'compose'].map((node) => JSON.stringify({ node, state: 'complete', at: new Date().toISOString() })).join('\n') + '\n' + JSON.stringify({ node: 'repairComposition', state: 'failed', error: 'Validation failed', at: new Date().toISOString() }));
    await writeFile(join(dir, 'plan-gate.json'), JSON.stringify({ passed: true }));
    await writeFile(join(dir, 'check-result.json'), JSON.stringify({ passed: false, output: JSON.stringify({ lint: { findings: [{ severity: 'error', message: 'Overlay starts visible.' }] } }) }));
    await writeFile(join(output, 'plan-data.json'), '{}');
    await writeFile(join(output, 'composition', 'index.html'), '<html></html>');
    await writeFile(join(output, 'render-handoff.json'), '{}');
    const job = defined(await readJobStatus(dir, false));
    assert.deepEqual(job.resume, { eligible: true, source: true, plan: true, composition: true, from: 'composition check' });
    assert.equal(job.finding, 'Overlay starts visible.');
    assert.equal(job.phases.story, true);
    assert.equal(job.phases.composition, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

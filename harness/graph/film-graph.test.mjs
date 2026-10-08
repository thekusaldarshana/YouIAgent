import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFilmGraph, inspectPlan, runFilm } from './film-graph.mjs';
import { claimRequest, evaluateClaim } from '../eval/claim-jev.mjs';
import { stageAudioCatalog } from './audio.mjs';

test('automatic soundtrack plan cannot quietly select silence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'film-plan-audio-test-'));
  try {
    await mkdir(join(workspace, 'source-repo'), { recursive: true });
    await mkdir(join(workspace, 'film-output'), { recursive: true });
    await writeFile(join(workspace, 'source-repo', 'README.md'), 'Source fact.');
    await stageAudioCatalog(workspace);
    const plan = { durationSeconds: 18, posterAtSeconds: 17, musicChoice: 'none', claims: [{ claim: 'Source fact', quote: 'Source fact.', sourcePath: 'source-repo/README.md' }], scenes: [{ name: 'a', start: 0, duration: 6 }, { name: 'b', start: 6, duration: 6 }, { name: 'c', start: 12, duration: 6 }] };
    await writeFile(join(workspace, 'film-output', 'plan-data.json'), JSON.stringify(plan));
    const evaluate = async () => ({ probabilitySupported: 1 });
    assert.match((await inspectPlan(workspace, evaluate)).issues.join(' '), /musicChoice must be one of/);
    plan.musicChoice = 'airy';
    await writeFile(join(workspace, 'film-output', 'plan-data.json'), JSON.stringify(plan));
    assert.equal((await inspectPlan(workspace, evaluate)).passed, true);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('Jev claim request uses a single typed supported proposition', async () => {
  const request = claimRequest('A', 'B', 'README.md');
  assert.deepEqual(Object.keys(request.questions), ['supported']);
  assert.equal(request.questions.supported.type, 'noul');
  const result = await evaluateClaim('A', 'B', 'README.md', {
    apiKey: 'fixture',
    fetcher: async (_url, options) => {
      assert.equal(JSON.parse(options.body).state.exactSourceExcerpt, 'B');
      return { ok: true, status: 200, json: async () => ({ model: 'typesafe/jev-1.13', answers: { supported: { type: 'noul', noul: 0.91 } }, usage: { input_tokens: 30, output_tokens: 1 } }) };
    },
  });
  assert.equal(result.probabilitySupported, 0.91);
});

test('LangGraph executes deterministic gates and one repair before rendering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'film-graph-test-'));
  try {
    const jobDir = join(root, 'job');
    const calls = [];
    let checks = 0;
    const graph = createFilmGraph({
      capture: async (dir) => {
        const workspace = join(dir, 'workspace');
        await mkdir(join(workspace, 'source-repo'), { recursive: true });
        await writeFile(join(workspace, 'source-repo', 'README.md'), 'One typed send() call.');
        return { website: { url: 'https://example.com' }, repository: { commit: 'abc' } };
      },
      prep: async () => {},
      agent: async (workspace, _job, stage) => {
        calls.push(stage);
        const output = join(workspace, 'film-output');
        await mkdir(output, { recursive: true });
        if (stage === 'plan') {
          await writeFile(join(output, 'film-plan.md'), '# Fixture plan\n');
          await writeFile(join(output, 'plan-data.json'), JSON.stringify({ durationSeconds: 18, posterAtSeconds: 17, musicChoice: 'none', claims: [{ claim: 'One typed send call', quote: 'One typed send() call.', sourcePath: 'source-repo/README.md' }], scenes: [{ name: 'a', start: 0, duration: 6 }, { name: 'b', start: 6, duration: 6 }, { name: 'c', start: 12, duration: 6 }] }));
        } else if (stage === 'compose') {
          await mkdir(join(output, 'composition'), { recursive: true });
          await writeFile(join(output, 'composition', 'index.html'), '<html></html>');
          await writeFile(join(output, 'render-handoff.json'), JSON.stringify({ composition: 'film-output/composition', output: 'film-output/film.mp4', posterAtSeconds: 17 }));
        }
      },
      evaluator: async () => ({ probabilitySupported: 0.99, model: 'fixture' }),
      selectedAudio: async () => ({ choice: 'none' }),
      run: async (_name, _args, workspace) => {
        if (workspace.endsWith('composition')) {
          checks++;
          return { code: checks === 1 ? 1 : 0, output: checks === 1 ? 'layout overlap' : '{"ok":true}', error: '' };
        }
        await writeFile(join(workspace, 'film-output', 'film.mp4'), 'fixture');
        await writeFile(join(workspace, 'film-output', 'render-report.json'), JSON.stringify({ output: 'fixture', durationSeconds: 18, hasAudio: true }));
        return { code: 0, output: '', error: '' };
      },
    });
    const { result } = await runFilm({ websiteUrl: 'https://example.com', repositoryUrl: 'https://github.com/example/repo', audioDir: null, musicMode: 'silent', model: 'fixture', effort: 'high' }, { jobDir, graph });
    assert.equal(result.render.durationSeconds, 18);
    assert.equal(result.compositionRepairs, 1);
    assert.deepEqual(calls, ['plan', 'compose', 'repair-composition-0']);
    assert.equal(checks, 2);
    assert.match(await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8'), /"node":"render"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateClaim } from '../harness/eval/claim-jev.js';
import { stageAudioCatalog } from '../harness/graph/audio.js';
import { CodexAppServer } from '../harness/graph/codex-app-server.js';
import { inspectPlan } from '../harness/graph/film-graph.js';
import { filmInputFromEnvironment } from '../harness/graph/run.js';
import { render, parseRenderArguments } from '../harness/worker/render.js';
import { extractStyleguide } from '../web/context-style.js';
import { readJobStatus } from '../web/job-state.js';
import { renderHandoffSchema } from '../shared/film.js';
import { readJsonWith } from '../shared/json.js';
import { defined, withTempDir } from './helpers.js';

/** Writes an agent-style plan into a workspace whose only source is a README. */
async function workspaceWithPlan(directory: string, plan: string): Promise<string> {
  await mkdir(join(directory, 'source-repo'), { recursive: true });
  await mkdir(join(directory, 'film-output'), { recursive: true });
  await writeFile(join(directory, 'source-repo', 'README.md'), 'Source fact.');
  await stageAudioCatalog(directory);
  await writeFile(join(directory, 'film-output', 'plan-data.json'), plan);
  return directory;
}

const accept = async () => ({ probabilitySupported: 1 });

test('agent-written plan data is validated, not trusted: malformed shapes become findings, never crashes', async () => {
  await withTempDir('youiagent-plan-', async (directory) => {
    await workspaceWithPlan(directory, '[1, 2, 3]');
    assert.match((await inspectPlan(directory, accept)).issues.join(' '), /plan-data\.json must be a JSON object/);

    await workspaceWithPlan(directory, JSON.stringify({ durationSeconds: '18', posterAtSeconds: null, musicChoice: 7, scenes: [null, 4, 'x'], claims: [null, { claim: 'A', quote: 7, sourcePath: 'source-repo/README.md' }, { claim: 'B', quote: 'Source fact.', sourcePath: '../../etc/passwd' }] }));
    const issues = (await inspectPlan(directory, accept)).issues.join(' | ');
    assert.match(issues, /durationSeconds must be/);
    assert.match(issues, /posterAtSeconds must be inside the film/);
    assert.match(issues, /Scene timings must be finite positive numbers/);
    assert.match(issues, /musicChoice must be one of/);
    assert.match(issues, /Every claim needs claim, exact quote and sourcePath/);
    assert.match(issues, /Missing source path for claim: \.\.\/\.\.\/etc\/passwd/, 'a claim cannot read outside the workspace');
    assert.equal((await inspectPlan(directory, accept)).passed, false);
  });
});

test('persisted JSON that is the wrong shape fails with the file named', async () => {
  await withTempDir('youiagent-json-', async (directory) => {
    const path = join(directory, 'render-handoff.json');
    await writeFile(path, JSON.stringify({ composition: 'film-output/composition', output: 7 }));
    await assert.rejects(readJsonWith(path, renderHandoffSchema, 'render-handoff.json'), /render-handoff\.json is malformed/);
  });
});

test('the render worker refuses handoffs that point outside the workspace', async () => {
  await withTempDir('youiagent-handoff-', async (workspace) => {
    await mkdir(join(workspace, 'film-output', 'composition'), { recursive: true });
    await writeFile(join(workspace, 'film-output', 'composition', 'index.html'), '<html></html>');
    const attempt = async (handoff: object): Promise<void> => {
      await writeFile(join(workspace, 'film-output', 'render-handoff.json'), JSON.stringify(handoff));
      await render({ workspace, handoffPath: undefined, validateOnly: true, checkedReport: undefined });
    };
    await assert.rejects(attempt({ composition: '../elsewhere', output: 'film-output/film.mp4', posterAtSeconds: 1 }), /composition must be a relative path inside the workspace/);
    await assert.rejects(attempt({ composition: 'film-output/composition', output: '/tmp/film.mp4', posterAtSeconds: 1 }), /output must be a relative path/);
    await assert.rejects(attempt({ composition: 'film-output/composition', output: 'film-output/film.mov', posterAtSeconds: 1 }), /output must end in \.mp4/);
    await assert.rejects(attempt({ composition: 'film-output/composition', output: 'film-output/film.mp4', posterAtSeconds: -1 }), /nonnegative/);
    await attempt({ composition: 'film-output/composition', output: 'film-output/film.mp4', posterAtSeconds: 1 });
  });
});

test('render worker arguments separate flags from positional paths', () => {
  assert.equal(parseRenderArguments([]), null);
  assert.deepEqual(parseRenderArguments(['job', 'handoff.json', '--validate-only', '--checked-report=check.json']), { workspace: 'job', handoffPath: 'handoff.json', validateOnly: true, checkedReport: 'check.json' });
});

test('environment configuration is parsed and rejected by name', () => {
  const input = filmInputFromEnvironment('A goal', { FILM_PROVIDER: 'claude', FILM_MUSIC_MODE: 'silent', FILM_RESUME_PLAN: '1' });
  assert.equal(input.provider, 'claude');
  assert.equal(input.model, '');
  assert.equal(input.musicMode, 'silent');
  assert.equal(input.claimMode, 'exact');
  assert.equal(input.resumePlan, true);
  assert.equal(input.resumeComposition, false);
  assert.throws(() => filmInputFromEnvironment('g', { FILM_PROVIDER: 'gemini' }), /FILM_PROVIDER must be codex or claude/);
  assert.throws(() => filmInputFromEnvironment('g', { FILM_CLAIM_MODE: 'vibes' }), /FILM_CLAIM_MODE must be exact or semantic/);
  assert.throws(() => filmInputFromEnvironment('g', { FILM_MUSIC_MODE: 'loud' }), /FILM_MUSIC_MODE/);
  assert.throws(() => filmInputFromEnvironment('g', { FILM_PROFILE: 'cinema' }), /Unknown film profile/);
});

test('provider responses are validated before use', async () => {
  const reply = (body: unknown, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
  await assert.rejects(evaluateClaim('A', 'B', 'README.md', { apiKey: 'k', fetcher: reply({ answers: { supported: { type: 'noul', noul: 'high' } } }) }), /Jev claim check failed \(200\)/);
  await assert.rejects(evaluateClaim('A', 'B', 'README.md', { apiKey: 'k', fetcher: reply({}) }), /Jev claim check failed/);
  await assert.rejects(evaluateClaim('A', 'B', 'README.md', { apiKey: 'k', fetcher: reply({ answers: { supported: { type: 'noul', noul: 1 } } }, false, 503) }), /\(503\)/);
  const garbage = await extractStyleguide('example.com', { key: 'k', fetcher: async () => ({ ok: true, headers: { get: () => null }, json: async () => 'not an object' }) });
  assert.deepEqual(garbage, { available: false, reason: 'No styleguide returned', creditsUsed: 0 });
});

test('a saved job with unexpected field types is still listed instead of disappearing', async () => {
  await withTempDir('youiagent-tolerant-', async (directory) => {
    await writeFile(join(directory, 'web-job.json'), JSON.stringify({ id: 'x', state: 'complete', input: { websiteUrl: 'https://example.com/' }, attempt: 2 }));
    await writeFile(join(directory, 'graph-report.json'), JSON.stringify({ render: { output: 'film.mp4', durationSeconds: 'twenty', hasAudio: 'yes' }, music: 'none', review: 5 }));
    const status = defined(await readJobStatus(directory, false));
    assert.equal(status.state, 'complete');
    assert.equal(status.filmReady, true);
    assert.equal(status.render?.hasAudio, false);
    assert.equal(status.music, null);
    assert.equal(status.review, null);
  });
});

test('provider quirks do not discard otherwise valid responses', async () => {
  const claim = await evaluateClaim('A', 'B', 'README.md', { apiKey: 'k', fetcher: async () => ({ ok: true, status: 200, json: async () => ({ model: null, answers: { supported: { type: 'noul', noul: 0.9 } }, usage: { cost: null, input_tokens: 'many' } }) }) });
  assert.equal(claim.probabilitySupported, 0.9);
  const style = await extractStyleguide('example.com', { key: 'k', fetcher: async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ request_id: null, cache_metadata: { status: null }, key_metadata: { credits_consumed: '5' }, styleguide: { mode: 'light' } }) }) });
  assert.equal(style.available, true);
  assert.equal(style.creditsUsed, 5);
});

test('Codex messages with null ids or string errors are tolerated, not fatal', () => {
  const server = new CodexAppServer({ cwd: '.' });
  assert.doesNotThrow(() => server.receive({ id: null, error: 'boom' }));
  assert.doesNotThrow(() => server.receive({ id: 99, result: {} }));
});

test('a job staged by the pre-TypeScript build resumes at source preparation', async () => {
  await withTempDir('youiagent-legacy-motion-', async (directory) => {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const { packageRoot } = await import('../harness/runtime/paths.js');
    const { stageMotion } = await import('../harness/cli.js');
    const legacy = await readFile(join(packageRoot(), 'test', 'fixtures', 'legacy-mechanics.js'), 'utf8');
    assert.equal(createHash('sha256').update(legacy).digest('hex'), '17c86a6a9e64d7dcc769b6b0590545f52544e4d542d62441485c72738859db44');
    await mkdir(join(directory, 'workspace', 'film-motion'), { recursive: true });
    await writeFile(join(directory, 'workspace', 'film-motion', 'mechanics.js'), legacy);
    assert.equal((await stageMotion(directory)).staged, true, 'the unmodified legacy helper is replaced');
    await writeFile(join(directory, 'workspace', 'film-motion', 'mechanics.js'), '// edited by an agent');
    await assert.rejects(stageMotion(directory), /modified mechanics\.js already exists/);
  });
});

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { z } from 'zod';
import { packageRoot } from '../harness/runtime/paths.js';
import { createApp, type App } from '../web/server.js';
import { graphEventSchema, webJobSchema } from '../shared/film.js';
import { parseJsonLines, readJsonWith } from '../shared/json.js';
import { freePort, waitFor } from './helpers.js';
import { createFakeToolchain, toolchainSkipReason } from './support/toolchain.js';

const skip = await toolchainSkipReason() ?? false;
const FAILED = '11111111-1111-4111-8111-111111111111';
const jobSchema = z.looseObject({ id: z.string(), state: z.string(), attempt: z.number().optional(), input: z.looseObject({ repositoryName: z.string().optional(), repositoryUrl: z.string().nullish() }) });
const listSchema = z.looseObject({ jobs: z.array(z.looseObject({ id: z.string(), state: z.string(), repositoryName: z.string(), resumeEligible: z.boolean(), filmReady: z.boolean() })) });

describe('the local web server, driving the compiled pipeline with a deterministic provider', { skip }, () => {
  let scratch = '';
  let app: App;
  let origin = '';
  let stateDir = '';
  const savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'youiagent-web-jobs-'));
    const toolchain = await createFakeToolchain(scratch);
    for (const [key, value] of Object.entries(toolchain.env)) { savedEnv[key] = process.env[key]; process.env[key] = value; }
    stateDir = join(scratch, 'state');
    const port = await freePort();
    app = createApp({ port, stateDir });
    await app.prepare();
    await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    // The finished pipeline's child may still be flushing its last log when the last assertion passes.
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  });

  const json = async (response: Response): Promise<unknown> => response.json();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  async function waitForComplete(id: string): Promise<z.infer<typeof jobSchema>> {
    return waitFor(`job ${id} to finish`, async () => {
      const job = jobSchema.parse(await json(await fetch(`${origin}/api/jobs/${id}`)));
      if (job.state === 'failed' || job.state === 'interrupted') throw new Error(`job ${id} ended ${job.state}: ${await readFile(join(stateDir, 'jobs', id, 'graph-events.jsonl'), 'utf8').catch(() => '')}`);
      return job.state === 'complete' ? job : null;
    });
  }

  test('requires a source, protects local routes, and rejects unsafe or oversized uploads', async () => {
    const empty = await post('/api/jobs', {});
    assert.equal(empty.status, 400);
    assert.match(JSON.stringify(await json(empty)), /Enter a website URL/);

    assert.equal((await post('/api/jobs', { websiteUrl: 'https://example.com' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/uploads', { name: 'x' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await fetch(`${origin}/%2e%2e/package.json`)).status, 404);

    const created = z.looseObject({ id: z.string() }).parse(await json(await post('/api/uploads', { name: 'Scratch' })));
    const put = (path: string, body: Uint8Array | string): Promise<Response> => fetch(`${origin}/api/uploads/${created.id}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body });
    for (const bad of ['../secret', '.env', 'node_modules/pkg/index.js', 'a/../../secret', 'a\\b']) assert.equal((await put(bad, 'x')).status, 400, `${bad} must be rejected`);
    const big = await put('big.bin', new Uint8Array(25_000_001));
    assert.equal(big.status, 400);
    assert.match(JSON.stringify(await json(big)), /25 MB/);
    assert.equal((await fetch(`${origin}/api/uploads/${created.id}`, { method: 'DELETE' })).status, 200);
  });

  test('an uploaded nested folder becomes a job with a stable display name and resume path', async () => {
    const created = z.looseObject({ id: z.string(), name: z.string() }).parse(await json(await post('/api/uploads', { name: 'Nested Project' })));
    const put = async (path: string, body: string): Promise<void> => {
      const response = await fetch(`${origin}/api/uploads/${created.id}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body });
      assert.equal(response.status, 201, `${path} should upload`);
    };
    await put('README.md', '# Nested Project\n\nOne typed send() call.\n');
    await put('src/lib/index.ts', 'export const ready = true;\n');
    await put('docs/guide/intro.md', 'Guide.\n');

    const started = await post('/api/jobs', { uploadId: created.id, provider: 'codex', musicMode: 'silent', goal: 'Fixture film' });
    assert.equal(started.status, 202);
    const job = jobSchema.parse(await json(started));
    assert.equal(job.input.repositoryName, 'Nested Project');
    assert.equal(job.input.repositoryUrl, join(stateDir, 'jobs', job.id, 'uploaded-source'), 'the resume path is inside the job, not the transient upload');

    await waitForComplete(job.id);
    const jobDir = join(stateDir, 'jobs', job.id);
    const saved = await readJsonWith(join(jobDir, 'web-job.json'), webJobSchema);
    assert.equal(saved.state, 'complete');
    assert.equal(saved.input.repositoryName, 'Nested Project');
    assert.ok((await stat(join(jobDir, 'uploaded-source', 'src', 'lib', 'index.ts'))).isFile(), 'nested files are preserved');
    assert.ok((await stat(join(jobDir, 'workspace', 'source-repo', 'docs', 'guide', 'intro.md'))).isFile(), 'the snapshot keeps the nested structure');

    const library = listSchema.parse(await json(await fetch(`${origin}/api/jobs`)));
    const listed = library.jobs.find((entry) => entry.id === job.id);
    assert.equal(listed?.repositoryName, 'Nested Project');
    assert.equal(listed?.filmReady, true);

    const film = await fetch(`${origin}/api/jobs/${job.id}/film.mp4`, { headers: { range: 'bytes=0-99' } });
    assert.equal(film.status, 206);
    assert.equal((await film.arrayBuffer()).byteLength, 100);
    for (const artifact of ['poster.jpg', 'visual-review.md', 'contact-sheet.jpg', 'plan.md', 'source-manifest.json']) {
      assert.equal((await fetch(`${origin}/api/jobs/${job.id}/${artifact}`)).status, 200, artifact);
    }
    assert.equal((await fetch(`${origin}/api/jobs/${job.id}/unknown.bin`)).status, 404);
  });

  test('a job saved by the JavaScript build is listed, resumed from its checkpoints, and left intact', async () => {
    const jobDir = join(stateDir, 'jobs', FAILED);
    await cp(join(packageRoot(), 'test', 'fixtures', 'legacy-jobs', FAILED), jobDir, { recursive: true });
    const manifestBefore = await readFile(join(jobDir, 'source-manifest.json'));

    const library = listSchema.parse(await json(await fetch(`${origin}/api/jobs`)));
    const listed = library.jobs.find((entry) => entry.id === FAILED);
    assert.equal(listed?.state, 'failed');
    assert.equal(listed?.resumeEligible, true);

    const resumed = await post(`/api/jobs/${FAILED}/resume`, {});
    assert.equal(resumed.status, 202);
    assert.equal(jobSchema.parse(await json(resumed)).attempt, 2);
    await waitForComplete(FAILED);

    assert.ok(manifestBefore.equals(await readFile(join(jobDir, 'source-manifest.json'))), 'the saved source record is not rewritten');
    const events = parseJsonLines(await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8'), graphEventSchema);
    const resumeEvent = events.find((event) => event.node === 'resume');
    assert.equal(resumeEvent?.reuse?.source, true);
    assert.equal(resumeEvent?.reuse?.plan, true);
    assert.equal(resumeEvent?.reuse?.composition, true);
    assert.ok(events.some((event) => event.node === 'render' && event.state === 'complete'));
    assert.equal((await post(`/api/jobs/${FAILED}/resume`, {})).status, 409, 'a finished film is not resumable');
  });
});


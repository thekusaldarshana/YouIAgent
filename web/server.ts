import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, rename, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ConfigResponse, JobSummary, JobsResponse, ProviderId } from '../shared/api.js';
import { claimModeSchema, graphInputSchema, musicModeSchema, providerSchema, webJobSchema, type FilmInput, type WebJob } from '../shared/film.js';
import { errorMessage, isRecord, parseJson, readJsonOrNull } from '../shared/json.js';
import { agentStatus, binaryStatus, renderBinary } from '../harness/graph/local-agent.js';
import { resolveFilmProfile } from '../harness/graph/motion-profile.js';
import { isEntryPoint, harnessAsset, packageRoot, stateRoot } from '../harness/runtime/paths.js';
import { APP_NAME } from './config.js';
import { readJobStatus } from './job-state.js';
import { cancelProviderLogin, getProviderLogin, startProviderLogin } from './provider-login.js';
import { normalizeSources } from './source-input.js';
import { createUploadStore, MAX_UPLOAD_FILE_BYTES } from './uploads.js';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const JSON_TYPE = 'application/json; charset=utf-8';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_JSON_BYTES = 16_000;

/** Compiled static files (`dist/web/public`) sit beside this module. */
const publicRoot = join(dirname(fileURLToPath(import.meta.url)), 'public');

function isWithin(directory: string, path: string): boolean {
  const remainder = relative(directory, resolve(path));
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': JSON_TYPE, 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function requestBytes(req: IncomingMessage, limit: number, message: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > limit) throw new Error(message);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

/** Reads a small JSON object body. The body is untrusted, so callers receive `unknown` fields. */
async function requestRecord(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await requestBytes(req, MAX_JSON_BYTES, 'Request is too large.')).toString('utf8');
  const body = parseJson(text || '{}');
  if (!isRecord(body)) throw new Error('Request body must be a JSON object.');
  return body;
}

function processAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const ffmpegPath = (): string => renderBinary('ffmpeg', process.env['FFMPEG_BIN']);
const ffprobePath = (): string => renderBinary('ffprobe', process.env['FFPROBE_BIN']);

async function assertReady(provider: ProviderId): Promise<void> {
  const status = await agentStatus(provider);
  if (!status.ready) throw new Error(`${provider} is not ready: ${status.detail}`);
  const [ffmpeg, ffprobe] = await Promise.all([binaryStatus(ffmpegPath()), binaryStatus(ffprobePath())]);
  if (!ffmpeg || !ffprobe) throw new Error('FFmpeg and FFprobe must be available before starting a film.');
}

const artifactReportSchema = z.looseObject({
  render: z.looseObject({ output: z.string().optional(), poster: z.string().optional() }).optional(),
  review: z.looseObject({ contactSheet: z.string().nullish(), report: z.string().optional() }).nullish(),
});

const MEDIA_ARTIFACTS = ['film.mp4', 'poster.jpg', 'contact-sheet.jpg', 'visual-review.md'];

interface ReuseCheckpoints { plan: boolean; composition: boolean }

export interface AppOptions {
  port: number;
  /** Where jobs and uploads are stored. Defaults to the install's `.youiagent` folder. */
  stateDir?: string;
}

export interface App {
  server: Server;
  /** Create the jobs folder; call once before `server.listen`. */
  prepare(): Promise<void>;
}

export function createApp({ port, stateDir = stateRoot() }: AppOptions): App {
  const jobsRoot = join(stateDir, 'jobs');
  const uploads = createUploadStore(join(stateDir, 'uploads'));
  const graphRunner = harnessAsset('graph', 'run.js');
  const active = new Set<string>();

  function localOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return !origin || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin);
  }

  async function startJob(input: FilmInput & { websiteUrl: string | null; repositoryUrl: string | null }, uploadId: string | null): Promise<WebJob> {
    const id = randomUUID();
    const jobDir = join(jobsRoot, id);
    await mkdir(jobDir, { recursive: true });
    let jobInput: FilmInput = input;
    if (uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload?.files) throw new Error('The selected folder has no files to upload.');
      const destination = join(jobDir, 'uploaded-source');
      await rename(upload.directory, destination);
      uploads.take(uploadId);
      jobInput = { ...input, repositoryUrl: destination, repositoryName: upload.name };
    }
    const profile = resolveFilmProfile(process.env['FILM_PROFILE']);
    const job: WebJob = { id, createdAt: new Date().toISOString(), state: 'running', input: { ...jobInput }, profile: profile.id, claimMode: process.env['FILM_CLAIM_MODE'] || (process.env['OPENROUTER_API_KEY'] ? profile.claimMode : 'exact'), attempt: 1 };
    return launchJob(jobDir, job, { plan: false, composition: false });
  }

  async function launchJob(jobDir: string, job: WebJob, reuse: ReuseCheckpoints): Promise<WebJob> {
    if (active.has(job.id)) throw new Error('This film is already running.');
    active.add(job.id);
    const attempt = job.attempt ?? 1;
    const suffix = attempt > 1 ? `-${attempt}` : '';
    let stdout: FileHandle | undefined;
    let stderr: FileHandle | undefined;
    try {
      await writeFile(join(jobDir, 'web-job.json'), JSON.stringify(job, null, 2));
      if (attempt > 1) await writeFile(join(jobDir, 'graph-events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), node: 'resume', state: 'start', attempt, reuse })}\n`, { flag: 'a' });
      stdout = await open(join(jobDir, `web-run${suffix}.stdout`), 'w');
      stderr = await open(join(jobDir, `web-run${suffix}.stderr`), 'w');
    } catch (error) {
      active.delete(job.id);
      await Promise.all([stdout?.close(), stderr?.close()]);
      throw error;
    }
    const out = stdout;
    const err = stderr;
    const child = spawn(process.execPath, [graphRunner, job.input.websiteUrl || '-', job.input.repositoryUrl || '-', job.input.goal ?? ''], {
      cwd: packageRoot(), stdio: ['ignore', out.fd, err.fd],
      env: { ...process.env, FILM_JOB_DIR: jobDir, FILM_PROVIDER: job.input.provider, FILM_MODEL: job.input.model, FILM_MUSIC_MODE: job.input.musicMode || 'silent', FILM_PROFILE: job.profile, FILM_CLAIM_MODE: job.claimMode, FILM_RESUME_PLAN: reuse.plan ? '1' : '0', FILM_RESUME_COMPOSITION: reuse.composition ? '1' : '0', FFMPEG_BIN: ffmpegPath(), FFPROBE_BIN: ffprobePath() },
    });
    job.pid = child.pid || null;
    const started = writeFile(join(jobDir, 'web-job.json'), JSON.stringify(job, null, 2));
    const finish = async (error: string | null): Promise<void> => {
      if (!active.delete(job.id)) return;
      await Promise.all([out.close(), err.close()]);
      await started;
      await writeFile(join(jobDir, 'web-job.json'), JSON.stringify({ ...job, pid: null, state: error ? 'failed' : 'complete', error, finishedAt: new Date().toISOString() }, null, 2));
    };
    child.on('error', (error) => { finish(error.message).catch(console.error); });
    child.on('exit', (code, signal) => { finish(code === 0 ? null : `Film pipeline exited with ${signal || code}. See the failed stage and validation finding below.`).catch(console.error); });
    await started;
    return job;
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return sendJson(res, 404, { error: 'Artifact is not ready.' });
    const range = type === 'video/mp4' ? req.headers.range?.match(/^bytes=(\d+)-(\d*)$/) : null;
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || end < start) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      res.end();
      return;
    }
    res.writeHead(range ? 206 : 200, { 'content-type': type, 'content-length': end - start + 1, ...(range ? { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${info.size}` } : {}), 'cache-control': 'private, no-store' });
    createReadStream(path, { start, end }).pipe(res);
  }

  async function listJobs(): Promise<JobsResponse> {
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory() && idPattern.test(entry.name)).map(async (entry): Promise<JobSummary | null> => {
      const job = await readJobStatus(join(jobsRoot, entry.name), active.has(entry.name));
      if (!job) return null;
      return { id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt, state: job.state, stage: job.stage, attempt: job.attempt, filmReady: job.filmReady, hasAudio: job.render?.hasAudio || false, resumeEligible: job.resume.eligible, websiteUrl: job.input.websiteUrl || '', repositoryUrl: job.input.repositoryUrl || '', repositoryName: job.input.repositoryName || '', provider: job.input.provider || 'codex', model: job.input.model || '' };
    }));
    const jobs = summaries.filter((job): job is JobSummary => job !== null).sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
    return { jobs };
  }

  async function createJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await requestRecord(req);
      const provider = providerSchema.safeParse(String(body['provider'] || 'codex'));
      if (!provider.success) throw new Error('Choose Codex or Claude Code.');
      const model = String(body['model'] || '').trim();
      if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model)) throw new Error('Invalid model name.');
      const musicMode = musicModeSchema.safeParse(String(body['musicMode'] || 'original'));
      if (!musicMode.success) throw new Error('Choose Original score, Music library, or No music.');
      const uploadId = String(body['uploadId'] || '');
      if (uploadId && (!idPattern.test(uploadId) || body['repositoryUrl'])) throw new Error('Choose a repository URL or path, or upload a folder.');
      const upload = uploadId ? uploads.get(uploadId) : null;
      if (uploadId && !upload) throw new Error('Folder upload not found. Select the folder again.');
      const sources = await normalizeSources({ websiteUrl: body['websiteUrl'], repositoryUrl: upload?.directory || body['repositoryUrl'] });
      await assertReady(provider.data);
      const input = { ...sources, goal: String(body['goal'] || 'Create a short product launch film.').slice(0, 500), provider: provider.data, model: model || (provider.data === 'codex' ? process.env['FILM_MODEL'] || 'gpt-6-sol' : ''), musicMode: musicMode.data };
      sendJson(res, 202, await startJob(input, uploadId || null));
    } catch (error) { sendJson(res, 400, { error: errorMessage(error) }); }
  }

  async function resumeJob(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
    const jobDir = join(jobsRoot, id);
    const saved = await readJsonOrNull(join(jobDir, 'web-job.json'), webJobSchema);
    if (!saved) return sendJson(res, 404, { error: 'Job not found.' });
    if (active.has(id) || saved.state === 'running' && processAlive(saved.pid)) return sendJson(res, 409, { error: 'This film is still running.' });
    const status = await readJobStatus(jobDir, false);
    if (!status?.resume.eligible) return sendJson(res, 409, { error: 'No completed source checkpoint is available for this film.' });
    try {
      const provider = providerSchema.safeParse(saved.input.provider || 'codex');
      if (!provider.success) throw new Error('This film was started with an unknown provider.');
      await assertReady(provider.data);
      const graphInput = await readJsonOrNull(join(jobDir, 'graph-input.json'), graphInputSchema);
      const claimMode = claimModeSchema.safeParse(saved.claimMode || graphInput?.claimMode || 'exact');
      const job: WebJob = { ...saved, state: 'running', error: null, finishedAt: null, startedAt: new Date().toISOString(), attempt: (saved.attempt || 1) + 1, profile: saved.profile || graphInput?.profile || 'product', claimMode: claimMode.success ? claimMode.data : 'exact' };
      sendJson(res, 202, await launchJob(jobDir, job, status.resume));
    } catch (error) { sendJson(res, 400, { error: errorMessage(error) }); }
  }

  async function sendJobArtifact(req: IncomingMessage, res: ServerResponse, id: string, name: string | undefined): Promise<void> {
    const jobDir = join(jobsRoot, id);
    const job = await readJobStatus(jobDir, active.has(id));
    if (!job) return sendJson(res, 404, { error: 'Job not found.' });
    if (!name) return sendJson(res, 200, job);
    const report = await readJsonOrNull(join(jobDir, 'graph-report.json'), artifactReportSchema);
    const workspace = join(jobDir, 'workspace');
    const paths: Record<string, string | null | undefined> = { 'film.mp4': report?.render?.output, 'poster.jpg': report?.render?.poster, 'contact-sheet.jpg': report?.review?.contactSheet, 'visual-review.md': report?.review?.report, 'plan.md': join(workspace, 'film-output', 'film-plan.md'), 'design.md': join(workspace, 'source-design.md'), 'source-manifest.json': join(jobDir, 'source-manifest.json') };
    const path = paths[name];
    if (!path || (MEDIA_ARTIFACTS.includes(name) && (job.state !== 'complete' || !isWithin(workspace, path)))) return sendJson(res, 404, { error: 'Artifact is not ready.' });
    return serveFile(req, res, path, name === 'film.mp4' ? 'video/mp4' : name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.json') ? JSON_TYPE : 'text/plain; charset=utf-8');
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const path = resolve(publicRoot, requested);
    if (!isWithin(publicRoot, path)) return sendJson(res, 404, { error: 'Not found.' });
    const file = await readFile(path).catch(() => null);
    if (!file) return sendJson(res, 404, { error: 'Not found.' });
    const body = requested === 'index.html' ? Buffer.from(file.toString().replaceAll('__APP_NAME__', APP_NAME)) : file;
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/uploads' && req.method === 'POST') {
      if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
      try { return sendJson(res, 201, await uploads.create((await requestRecord(req))['name'])); }
      catch (error) { return sendJson(res, 400, { error: errorMessage(error) }); }
    }
    const uploadMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})(?:\/files)?$/);
    const uploadId = uploadMatch?.[1];
    if (uploadId && idPattern.test(uploadId)) {
      if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
      if (req.method === 'DELETE' && url.pathname === `/api/uploads/${uploadId}`) return sendJson(res, await uploads.cancel(uploadId) ? 200 : 404, { cancelled: true });
      if (req.method === 'PUT' && url.pathname.endsWith('/files')) {
        try { return sendJson(res, 201, await uploads.add(uploadId, url.searchParams.get('path'), await requestBytes(req, MAX_UPLOAD_FILE_BYTES, 'A folder file exceeds the 25 MB limit.'))); }
        catch (error) { return sendJson(res, 400, { error: errorMessage(error) }); }
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const providerLogin = url.pathname.match(/^\/api\/providers\/(codex|claude)\/connect(?:\/([0-9a-f-]{36}))?$/);
    if (providerLogin) {
      if ((req.method === 'POST' || req.method === 'DELETE') && !localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
      const [, provider = '', id] = providerLogin;
      if (req.method === 'POST' && !id) return sendJson(res, 200, await startProviderLogin(provider));
      if (req.method === 'GET' && id && idPattern.test(id)) {
        const login = getProviderLogin(provider, id);
        return sendJson(res, login ? 200 : 404, login || { error: 'Sign-in session not found.' });
      }
      if (req.method === 'DELETE' && id && idPattern.test(id)) return sendJson(res, await cancelProviderLogin(provider, id) ? 200 : 404, { cancelled: true });
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const [codex, claude, ffmpeg, ffprobe] = await Promise.all([agentStatus('codex'), agentStatus('claude'), binaryStatus(ffmpegPath()), binaryStatus(ffprobePath())]);
      const config: ConfigResponse = { name: APP_NAME, mode: 'local', model: process.env['FILM_MODEL'] || 'gpt-6-sol', profile: process.env['FILM_PROFILE'] || 'product', providers: { codex, claude }, renderTools: { ffmpeg, ffprobe } };
      return sendJson(res, 200, config);
    }
    if (url.pathname === '/api/jobs' && req.method === 'GET') return sendJson(res, 200, await listJobs());
    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
      return createJob(req, res);
    }
    const resumeId = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/resume$/)?.[1];
    if (resumeId && req.method === 'POST' && idPattern.test(resumeId)) return resumeJob(req, res, resumeId);
    const match = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/([\w.-]+))?$/);
    const jobId = match?.[1];
    if (jobId && req.method === 'GET' && idPattern.test(jobId)) return sendJobArtifact(req, res, jobId, match[2]);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
    return serveStatic(res, url.pathname);
  }

  const server = createServer((req, res) => { handle(req, res).catch((error: unknown) => sendJson(res, 500, { error: errorMessage(error) })); });
  return { server, prepare: async () => { await mkdir(jobsRoot, { recursive: true }); } };
}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] || 4174);
  const app = createApp({ port });
  await app.prepare();
  app.server.listen(port, '127.0.0.1', () => console.log(`${APP_NAME} local web app: http://127.0.0.1:${port}`));
}

if (isEntryPoint(import.meta.url)) await main();

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from './config.mjs';
import { readJobStatus } from './job-state.mjs';
import { startProviderLogin, getProviderLogin, cancelProviderLogin } from './provider-login.mjs';
import { agentStatus, binaryStatus, renderBinary } from '../harness/graph/local-agent.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '..');
const publicRoot = join(root, 'public');
const jobsRoot = join(repoRoot, '.youiagent', 'jobs');
const graphRunner = join(repoRoot, 'harness', 'graph', 'run.mjs');
const port = Number(process.env.PORT || 4174);
const active = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isWithin(directory, path) {
  const remainder = relative(directory, resolve(path));
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function requestJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_000) throw new Error('Request is too large.');
  }
  return JSON.parse(body || '{}');
}

function validUrl(value, repository = false) {
  const url = new URL(String(value || ''));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP(S) URL.');
  if (repository && (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname.split('/').filter(Boolean).length < 2)) throw new Error('Use a public github.com repository URL.');
  return url.href;
}

async function startJob(input) {
  const id = randomUUID();
  const jobDir = join(jobsRoot, id);
  await mkdir(jobDir, { recursive: true });
  const job = { id, createdAt: new Date().toISOString(), state: 'running', input, profile: process.env.FILM_PROFILE || 'product', claimMode: process.env.FILM_CLAIM_MODE || (process.env.OPENROUTER_API_KEY ? 'semantic' : 'exact'), attempt: 1 };
  return launchJob(jobDir, job, { plan: false, composition: false });
}

function localOrigin(req) {
  return !req.headers.origin || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function assertReady(provider) {
  const status = await agentStatus(provider);
  if (!status.ready) throw new Error(`${provider} is not ready: ${status.detail}`);
  const [ffmpeg, ffprobe] = await Promise.all([binaryStatus(renderBinary('ffmpeg', process.env.FFMPEG_BIN)), binaryStatus(renderBinary('ffprobe', process.env.FFPROBE_BIN))]);
  if (!ffmpeg || !ffprobe) throw new Error('FFmpeg and FFprobe must be available before starting a film.');
}

async function launchJob(jobDir, job, reuse) {
  if (active.has(job.id)) throw new Error('This film is already running.');
  active.add(job.id);
  const suffix = job.attempt > 1 ? `-${job.attempt}` : '';
  let stdout;
  let stderr;
  try {
    await writeFile(join(jobDir, 'web-job.json'), JSON.stringify(job, null, 2));
    if (job.attempt > 1) await writeFile(join(jobDir, 'graph-events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), node: 'resume', state: 'start', attempt: job.attempt, reuse })}\n`, { flag: 'a' });
    stdout = await open(join(jobDir, `web-run${suffix}.stdout`), 'w');
    stderr = await open(join(jobDir, `web-run${suffix}.stderr`), 'w');
  } catch (error) {
    active.delete(job.id);
    await Promise.all([stdout?.close(), stderr?.close()]);
    throw error;
  }
  const child = spawn(process.execPath, [graphRunner, job.input.websiteUrl, job.input.repositoryUrl, job.input.goal], {
    cwd: repoRoot, stdio: ['ignore', stdout.fd, stderr.fd], env: { ...process.env, FILM_JOB_DIR: jobDir, FILM_PROVIDER: job.input.provider, FILM_MODEL: job.input.model, FILM_MUSIC_MODE: job.input.musicMode || 'silent', FILM_PROFILE: job.profile, FILM_CLAIM_MODE: job.claimMode, FILM_RESUME_PLAN: reuse.plan ? '1' : '0', FILM_RESUME_COMPOSITION: reuse.composition ? '1' : '0', FFMPEG_BIN: renderBinary('ffmpeg', process.env.FFMPEG_BIN), FFPROBE_BIN: renderBinary('ffprobe', process.env.FFPROBE_BIN) },
  });
  job.pid = child.pid || null;
  const started = writeFile(join(jobDir, 'web-job.json'), JSON.stringify(job, null, 2));
  const finish = async (error) => {
    if (!active.delete(job.id)) return;
    await Promise.all([stdout.close(), stderr.close()]);
    await started;
    await writeFile(join(jobDir, 'web-job.json'), JSON.stringify({ ...job, pid: null, state: error ? 'failed' : 'complete', error: error || null, finishedAt: new Date().toISOString() }, null, 2));
  };
  child.on('error', (error) => { finish(error.message).catch(console.error); });
  child.on('exit', (code, signal) => { finish(code === 0 ? null : `Film pipeline exited with ${signal || code}. See the failed stage and validation finding below.`).catch(console.error); });
  await started;
  return job;
}

async function serveFile(req, res, path, type) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return sendJson(res, 404, { error: 'Artifact is not ready.' });
  const range = type === 'video/mp4' && req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  if (start >= info.size || end < start) {
    res.writeHead(416, { 'content-range': `bytes */${info.size}` });
    return res.end();
  }
  res.writeHead(range ? 206 : 200, { 'content-type': type, 'content-length': end - start + 1, ...(range ? { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${info.size}` } : {}), 'cache-control': 'private, no-store' });
  createReadStream(path, { start, end }).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const providerLogin = url.pathname.match(/^\/api\/providers\/(codex|claude)\/connect(?:\/([0-9a-f-]{36}))?$/);
  if (providerLogin) {
    if ((req.method === 'POST' || req.method === 'DELETE') && !localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
    const [, provider, id] = providerLogin;
    if (req.method === 'POST' && !id) return sendJson(res, 200, await startProviderLogin(provider));
    if (req.method === 'GET' && id && idPattern.test(id)) {
      const login = getProviderLogin(provider, id);
      return sendJson(res, login ? 200 : 404, login || { error: 'Sign-in session not found.' });
    }
    if (req.method === 'DELETE' && id && idPattern.test(id)) return sendJson(res, await cancelProviderLogin(provider, id) ? 200 : 404, { cancelled: true });
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (url.pathname === '/api/config' && req.method === 'GET') {
    const [codex, claude, ffmpeg, ffprobe] = await Promise.all([agentStatus('codex'), agentStatus('claude'), binaryStatus(renderBinary('ffmpeg', process.env.FFMPEG_BIN)), binaryStatus(renderBinary('ffprobe', process.env.FFPROBE_BIN))]);
    return sendJson(res, 200, { name: APP_NAME, mode: 'local', model: process.env.FILM_MODEL || 'gpt-6-sol', profile: process.env.FILM_PROFILE || 'product', providers: { codex, claude }, renderTools: { ffmpeg, ffprobe } });
  }
  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    const jobs = (await Promise.all(entries.filter((entry) => entry.isDirectory() && idPattern.test(entry.name)).map(async (entry) => {
      const job = await readJobStatus(join(jobsRoot, entry.name), active.has(entry.name));
      if (!job) return null;
      return { id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt, state: job.state, stage: job.stage, attempt: job.attempt, filmReady: job.filmReady, hasAudio: job.render?.hasAudio || false, resumeEligible: job.resume.eligible, websiteUrl: job.input?.websiteUrl || '', provider: job.input?.provider || 'codex', model: job.input?.model || '' };
    }))).filter(Boolean).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return sendJson(res, 200, { jobs });
  }
  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
    try {
      const body = await requestJson(req);
      const provider = String(body.provider || 'codex');
      if (!['codex', 'claude'].includes(provider)) throw new Error('Choose Codex or Claude Code.');
      const model = String(body.model || '').trim();
      if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model)) throw new Error('Invalid model name.');
      await assertReady(provider);
      const musicMode = String(body.musicMode || 'original');
      if (!['original', 'library', 'silent'].includes(musicMode)) throw new Error('Choose Original score, Music library, or No music.');
      const input = { websiteUrl: validUrl(body.websiteUrl), repositoryUrl: validUrl(body.repositoryUrl, true), goal: String(body.goal || 'Create a short product launch film.').slice(0, 500), provider, model: model || (provider === 'codex' ? process.env.FILM_MODEL || 'gpt-6-sol' : ''), musicMode };
      return sendJson(res, 202, await startJob(input));
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const resumeMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/resume$/);
  if (resumeMatch && req.method === 'POST' && idPattern.test(resumeMatch[1])) {
    if (!localOrigin(req)) return sendJson(res, 403, { error: 'Local origin required.' });
    const id = resumeMatch[1];
    const jobDir = join(jobsRoot, id);
    const saved = await readFile(join(jobDir, 'web-job.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!saved) return sendJson(res, 404, { error: 'Job not found.' });
    if (active.has(id) || saved.state === 'running' && processAlive(saved.pid)) return sendJson(res, 409, { error: 'This film is still running.' });
    const status = await readJobStatus(jobDir, false);
    if (!status.resume.eligible) return sendJson(res, 409, { error: 'No completed source checkpoint is available for this film.' });
    try {
      await assertReady(saved.input.provider || 'codex');
      const graphInput = await readFile(join(jobDir, 'graph-input.json'), 'utf8').then(JSON.parse).catch(() => ({}));
      const job = { ...saved, state: 'running', error: null, finishedAt: null, startedAt: new Date().toISOString(), attempt: (saved.attempt || 1) + 1, profile: saved.profile || graphInput.profile || 'product', claimMode: saved.claimMode || graphInput.claimMode || 'exact' };
      return sendJson(res, 202, await launchJob(jobDir, job, status.resume));
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const match = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/([\w.-]+))?$/);
  if (match && req.method === 'GET' && idPattern.test(match[1])) {
    const jobDir = join(jobsRoot, match[1]);
    const job = await readJobStatus(jobDir, active.has(match[1]));
    if (!job) return sendJson(res, 404, { error: 'Job not found.' });
    if (!match[2]) return sendJson(res, 200, job);
    const report = await readFile(join(jobDir, 'graph-report.json'), 'utf8').then(JSON.parse).catch(() => null);
    const workspace = join(jobDir, 'workspace');
    const paths = { 'film.mp4': report?.render?.output, 'poster.jpg': report?.render?.poster, 'contact-sheet.jpg': report?.review?.contactSheet, 'visual-review.md': report?.review?.report, 'plan.md': join(workspace, 'film-output', 'film-plan.md'), 'design.md': join(workspace, 'source-design.md'), 'source-manifest.json': join(jobDir, 'source-manifest.json') };
    const path = paths[match[2]];
    if (!path || (['film.mp4', 'poster.jpg', 'contact-sheet.jpg', 'visual-review.md'].includes(match[2]) && (job.state !== 'complete' || !isWithin(workspace, path)))) return sendJson(res, 404, { error: 'Artifact is not ready.' });
    return serveFile(req, res, path, match[2] === 'film.mp4' ? 'video/mp4' : match[2].endsWith('.jpg') ? 'image/jpeg' : match[2].endsWith('.json') ? MIME['.json'] : 'text/plain; charset=utf-8');
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const path = resolve(publicRoot, relative);
  if (!isWithin(publicRoot, path)) return sendJson(res, 404, { error: 'Not found.' });
  const file = await readFile(path).catch(() => null);
  if (!file) return sendJson(res, 404, { error: 'Not found.' });
  const body = relative === 'index.html' ? Buffer.from(file.toString().replaceAll('__APP_NAME__', APP_NAME)) : file;
  res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'content-length': body.length });
  res.end(body);
}

await mkdir(jobsRoot, { recursive: true });
createServer((req, res) => { handle(req, res).catch((error) => sendJson(res, 500, { error: error.message })); })
  .listen(port, '127.0.0.1', () => console.log(`${APP_NAME} local web app: http://127.0.0.1:${port}`));

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from './config.mjs';
import { readJobStatus } from './job-state.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '..');
const publicRoot = join(root, 'public');
const jobsRoot = join(repoRoot, '.youiagent', 'jobs');
const graphRunner = join(repoRoot, 'harness', 'graph', 'run.mjs');
const port = Number(process.env.PORT || 4174);
const active = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  const job = { id, createdAt: new Date().toISOString(), state: 'running', input };
  await writeFile(join(jobDir, 'web-job.json'), JSON.stringify(job, null, 2));
  const stdout = await open(join(jobDir, 'web-run.stdout'), 'w');
  const stderr = await open(join(jobDir, 'web-run.stderr'), 'w');
  const child = spawn(process.execPath, [graphRunner, input.websiteUrl, input.repositoryUrl, input.goal], {
    cwd: repoRoot, stdio: ['ignore', stdout.fd, stderr.fd], env: { ...process.env, FILM_JOB_DIR: jobDir },
  });
  active.add(id);
  const finish = async (error) => {
    if (!active.delete(id)) return;
    await Promise.all([stdout.close(), stderr.close()]);
    await writeFile(join(jobDir, 'web-job.json'), JSON.stringify({ ...job, state: error ? 'failed' : 'complete', error: error || null, finishedAt: new Date().toISOString() }, null, 2));
  };
  child.on('error', (error) => { finish(error.message).catch(console.error); });
  child.on('exit', (code, signal) => { finish(code === 0 ? null : `Film pipeline exited with ${signal || code}. Inspect web-run.stderr in the local job directory.`).catch(console.error); });
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
  if (url.pathname === '/api/config' && req.method === 'GET') return sendJson(res, 200, { name: APP_NAME, mode: 'local', model: process.env.FILM_MODEL || 'gpt-6-sol', profile: process.env.FILM_PROFILE || 'product' });
  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return sendJson(res, 403, { error: 'Local origin required.' });
    try {
      const body = await requestJson(req);
      const input = { websiteUrl: validUrl(body.websiteUrl), repositoryUrl: validUrl(body.repositoryUrl, true), goal: String(body.goal || 'Create a short product launch film.').slice(0, 500) };
      return sendJson(res, 202, await startJob(input));
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
    const paths = { 'film.mp4': report?.render?.output, 'poster.jpg': report?.render?.poster, 'plan.md': join(workspace, 'film-output', 'film-plan.md'), 'design.md': join(workspace, 'source-design.md'), 'source-manifest.json': join(jobDir, 'source-manifest.json') };
    const path = paths[match[2]];
    if (!path || (match[2] === 'film.mp4' || match[2] === 'poster.jpg') && (job.state !== 'complete' || !resolve(path).startsWith(`${workspace}/`))) return sendJson(res, 404, { error: 'Artifact is not ready.' });
    return serveFile(req, res, path, match[2] === 'film.mp4' ? 'video/mp4' : match[2] === 'poster.jpg' ? 'image/jpeg' : match[2].endsWith('.json') ? MIME['.json'] : 'text/plain; charset=utf-8');
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const path = resolve(publicRoot, relative);
  if (!path.startsWith(`${publicRoot}/`)) return sendJson(res, 404, { error: 'Not found.' });
  const file = await readFile(path).catch(() => null);
  if (!file) return sendJson(res, 404, { error: 'Not found.' });
  const body = relative === 'index.html' ? Buffer.from(file.toString().replaceAll('__APP_NAME__', APP_NAME)) : file;
  res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'content-length': body.length });
  res.end(body);
}

await mkdir(jobsRoot, { recursive: true });
createServer((req, res) => { handle(req, res).catch((error) => sendJson(res, 500, { error: error.message })); })
  .listen(port, '127.0.0.1', () => console.log(`${APP_NAME} local web app: http://127.0.0.1:${port}`));

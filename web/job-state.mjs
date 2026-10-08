import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function json(path) { return readFile(path, 'utf8').then(JSON.parse).catch(() => null); }

export async function readJobStatus(jobDir, running = false) {
  const job = await json(join(jobDir, 'web-job.json'));
  if (!job) return null;
  const report = await json(join(jobDir, 'graph-report.json'));
  const raw = await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8').catch(() => '');
  const events = raw.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const latest = events.at(-1);
  const stages = Object.fromEntries(events.filter((event) => event.state === 'complete').map((event) => [event.node, 'complete']));
  if (latest?.state === 'start') stages[latest.node] = 'running';
  if (latest?.state === 'failed') stages[latest.node] = 'failed';
  const state = report ? 'complete' : job.state === 'failed' ? 'failed' : running ? 'running' : 'interrupted';
  return { id: job.id, input: job.input, createdAt: job.createdAt, finishedAt: job.finishedAt || null, state, stage: latest?.node || 'starting', stages, error: job.error || (latest?.state === 'failed' ? latest.error : null), filmReady: Boolean(report?.render?.output), render: report?.render ? { durationSeconds: report.render.durationSeconds, width: report.render.video?.width, height: report.render.video?.height } : null };
}

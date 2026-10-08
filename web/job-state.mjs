import { open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

async function json(path) { return readFile(path, 'utf8').then(JSON.parse).catch(() => null); }
async function exists(path) { return Boolean((await stat(path).catch(() => null))?.isFile()); }

async function agentActivity(jobDir, event) {
  if (!event || event.state !== 'start' || !['plan', 'repairPlan', 'compose', 'repairComposition'].includes(event.node)) return null;
  const prefix = event.node === 'repairPlan' ? 'agent-repair-plan' : event.node === 'repairComposition' ? 'agent-repair-composition-' : `agent-${event.node}`;
  const files = (await readdir(jobDir).catch(() => [])).filter((name) => name.startsWith(prefix) && name.endsWith('.stdout'));
  const entries = await Promise.all(files.map(async (name) => ({ name, info: await stat(join(jobDir, name)).catch(() => null) })));
  const latest = entries.filter((entry) => entry.info && entry.info.mtimeMs >= new Date(event.at).getTime()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0];
  if (!latest) return null;
  const handle = await open(join(jobDir, latest.name), 'r');
  let raw;
  try {
    const length = Math.min(128_000, latest.info.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, latest.info.size - length);
    raw = buffer.toString('utf8');
  } finally { await handle.close(); }
  for (const line of raw.split('\n').reverse()) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const tool = item.message?.content?.findLast?.((part) => part?.type === 'tool_use');
    if (tool) {
      const path = tool.input?.file_path || tool.input?.path || '';
      const target = path ? ` ${basename(path)}` : '';
      const verbs = { Read: 'Reading', Write: 'Writing', Edit: 'Editing', Glob: 'Finding files', Grep: 'Searching source', Bash: 'Running a local command' };
      return { message: `${verbs[tool.name] || `Using ${tool.name}`}${target}`, at: latest.info.mtime.toISOString() };
    }
    if (item.type === 'item.started' || item.type === 'item.completed') {
      const kind = item.item?.type;
      if (kind === 'command_execution') return { message: 'Running a local command', at: latest.info.mtime.toISOString() };
      if (kind === 'file_change') return { message: 'Editing composition files', at: latest.info.mtime.toISOString() };
    }
  }
  return { message: 'The model is working', at: latest.info.mtime.toISOString() };
}

export async function readJobStatus(jobDir, running = false) {
  const job = await json(join(jobDir, 'web-job.json'));
  if (!job) return null;
  const [report, gate, check, manifest, raw] = await Promise.all([
    json(join(jobDir, 'graph-report.json')),
    json(join(jobDir, 'plan-gate.json')),
    json(join(jobDir, 'check-result.json')),
    json(join(jobDir, 'source-manifest.json')),
    readFile(join(jobDir, 'graph-events.jsonl'), 'utf8').catch(() => ''),
  ]);
  const events = raw.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const latest = events.at(-1);
  const completed = (node) => events.some((event) => event.node === node && event.state === 'complete');
  const stages = Object.fromEntries(events.filter((event) => event.state === 'complete').map((event) => [event.node, 'complete']));
  if (latest?.state === 'start') stages[latest.node] = 'running';
  if (latest?.state === 'failed') stages[latest.node] = 'failed';
  const state = report ? 'complete' : job.state === 'failed' ? 'failed' : running ? 'running' : 'interrupted';
  const sourceSaved = Boolean(manifest && completed('capture'));
  const planSaved = sourceSaved && completed('plan') && await exists(join(jobDir, 'workspace', 'film-output', 'plan-data.json'));
  const compositionSaved = planSaved && completed('compose') && await exists(join(jobDir, 'workspace', 'film-output', 'composition', 'index.html')) && await exists(join(jobDir, 'workspace', 'film-output', 'render-handoff.json'));
  const resume = { eligible: ['failed', 'interrupted'].includes(state) && sourceSaved, source: sourceSaved, plan: planSaved, composition: compositionSaved, from: compositionSaved ? 'composition check' : planSaved ? 'plan check' : 'source preparation' };
  const finding = check?.passed === false ? (() => { try { return JSON.parse(check.output).lint?.findings?.find((item) => item.severity === 'error')?.message || check.error?.trim(); } catch { return check.error?.trim(); } })() : null;
  const error = latest?.state === 'failed' ? latest.error : job.error || null;
  const activeEvent = latest?.state === 'start' ? latest : null;
  return {
    id: job.id, input: job.input, createdAt: job.createdAt, finishedAt: job.finishedAt || null, attempt: job.attempt || 1,
    state, stage: latest?.node || 'starting', stages, error, finding, resume,
    events: events.slice(-28), activity: running ? await agentActivity(jobDir, activeEvent) : null,
    activeSince: activeEvent?.at || null,
    phases: { source: completed('prepare'), story: Boolean(gate?.passed && completed('planGate')), composition: Boolean(check?.passed), render: Boolean(report?.render) },
    filmReady: Boolean(report?.render?.output), music: report?.music || null, musicChoice: report?.plan?.musicChoice || null,
    render: report?.render ? { durationSeconds: report.render.durationSeconds, width: report.render.video?.width, height: report.render.video?.height, hasAudio: report.render.hasAudio === true, audioSource: report.render.audioSource || null, audioFallback: report.render.audioFallback || false } : null,
  };
}

import { open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { JobState, JobStatus, StageStatus } from '../shared/api.js';
import { graphEventSchema, webJobSchema } from '../shared/film.js';
import { isFile, parseJsonLines, readJsonOrNull } from '../shared/json.js';

/*
 * Job files are written by this and earlier builds and read back after restarts. These schemas are
 * deliberately tolerant: a field that is missing or the wrong type is dropped, never a reason to hide a job.
 */
const gateSchema = z.looseObject({ passed: z.boolean().optional().catch(undefined) });

const checkSummarySchema = z.looseObject({
  passed: z.boolean().optional().catch(undefined),
  output: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

const checkOutputSchema = z.looseObject({
  lint: z.looseObject({ findings: z.array(z.looseObject({ severity: z.string().optional(), message: z.string().optional() })).optional() }).optional(),
});

const reportSchema = z.looseObject({
  plan: z.looseObject({ musicChoice: z.string().optional().catch(undefined) }).optional().catch(undefined),
  music: z.looseObject({
    choice: z.string().optional(), title: z.string().nullish(), author: z.string().nullish(),
    license: z.string().nullish(), sourceUrl: z.string().nullish(),
  }).nullish().catch(null),
  review: z.looseObject({ status: z.string(), report: z.string(), contactSheet: z.string().nullish() }).nullish().catch(null),
  render: z.looseObject({
    output: z.string().optional().catch(undefined),
    durationSeconds: z.number().optional().catch(undefined),
    hasAudio: z.boolean().optional().catch(undefined),
    audioSource: z.string().nullish().catch(undefined),
    audioFallback: z.boolean().optional().catch(undefined),
    video: z.looseObject({ width: z.number().optional(), height: z.number().optional() }).optional().catch(undefined),
  }).optional().catch(undefined),
});

const activityLineSchema = z.looseObject({
  type: z.string().optional(),
  message: z.looseObject({
    content: z.array(z.looseObject({
      type: z.string().optional(),
      name: z.string().optional(),
      input: z.looseObject({ file_path: z.string().optional(), path: z.string().optional() }).optional(),
    })).optional(),
  }).optional(),
  item: z.looseObject({ type: z.string().optional() }).optional(),
});

const AGENT_NODES = ['plan', 'repairPlan', 'compose', 'repairComposition', 'review'];
const TOOL_VERBS: Record<string, string> = { Read: 'Reading', Write: 'Writing', Edit: 'Editing', Glob: 'Finding files', Grep: 'Searching source', Bash: 'Running a local command' };

interface Activity { message: string; at: string }

async function agentActivity(jobDir: string, event: { node: string; state: string; at?: string | undefined } | null): Promise<Activity | null> {
  if (!event || event.state !== 'start' || !AGENT_NODES.includes(event.node)) return null;
  const prefix = event.node === 'repairPlan' ? 'agent-repair-plan' : event.node === 'repairComposition' ? 'agent-repair-composition-' : `agent-${event.node}`;
  const files = (await readdir(jobDir).catch(() => [])).filter((name) => name.startsWith(prefix) && name.endsWith('.stdout'));
  const entries = await Promise.all(files.map(async (name) => ({ name, info: await stat(join(jobDir, name)).catch(() => null) })));
  const startedAt = new Date(event.at ?? Number.NaN).getTime();
  const latest = entries.flatMap((entry) => entry.info && entry.info.mtimeMs >= startedAt ? [{ name: entry.name, info: entry.info }] : [])
    .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0];
  if (!latest) return null;
  const handle = await open(join(jobDir, latest.name), 'r');
  let raw: string;
  try {
    const length = Math.min(128_000, latest.info.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, latest.info.size - length);
    raw = buffer.toString('utf8');
  } finally { await handle.close(); }
  const at = latest.info.mtime.toISOString();
  for (const line of raw.split('\n').reverse()) {
    const [item] = parseJsonLines(line, activityLineSchema);
    if (!item) continue;
    const tool = item.message?.content?.findLast((part) => part.type === 'tool_use');
    if (tool) {
      const path = tool.input?.file_path || tool.input?.path || '';
      const target = path ? ` ${basename(path)}` : '';
      return { message: `${(tool.name && TOOL_VERBS[tool.name]) || `Using ${tool.name}`}${target}`, at };
    }
    if (item.type === 'item.started' || item.type === 'item.completed') {
      const kind = item.item?.type;
      if (kind === 'command_execution') return { message: 'Running a local command', at };
      if (kind === 'file_change') return { message: 'Editing composition files', at };
    }
  }
  return { message: 'The model is working', at };
}

function firstFinding(check: z.infer<typeof checkSummarySchema>): string | undefined {
  try {
    const output = checkOutputSchema.parse(JSON.parse(check.output ?? ''));
    return output.lint?.findings?.find((item) => item.severity === 'error')?.message || check.error?.trim();
  } catch { return check.error?.trim(); }
}

export async function readJobStatus(jobDir: string, running = false): Promise<JobStatus | null> {
  const job = await readJsonOrNull(join(jobDir, 'web-job.json'), webJobSchema);
  if (!job) return null;
  const [report, gate, check, manifest, raw] = await Promise.all([
    readJsonOrNull(join(jobDir, 'graph-report.json'), reportSchema),
    readJsonOrNull(join(jobDir, 'plan-gate.json'), gateSchema),
    readJsonOrNull(join(jobDir, 'check-result.json'), checkSummarySchema),
    readJsonOrNull(join(jobDir, 'source-manifest.json'), z.looseObject({})),
    readFile(join(jobDir, 'graph-events.jsonl'), 'utf8').catch(() => ''),
  ]);
  const events = parseJsonLines(raw, graphEventSchema);
  const latest = events.at(-1);
  const completed = (node: string): boolean => events.some((event) => event.node === node && event.state === 'complete');
  const stages: Record<string, StageStatus> = Object.fromEntries(events.filter((event) => event.state === 'complete').map((event) => [event.node, 'complete' as const]));
  if (latest?.state === 'start') stages[latest.node] = 'running';
  if (latest?.state === 'failed') stages[latest.node] = 'failed';
  const state: JobState = report ? 'complete' : job.state === 'failed' ? 'failed' : running ? 'running' : 'interrupted';
  const sourceSaved = Boolean(manifest && completed('capture'));
  const planSaved = sourceSaved && completed('plan') && await isFile(join(jobDir, 'workspace', 'film-output', 'plan-data.json'));
  const compositionSaved = planSaved && completed('compose') && await isFile(join(jobDir, 'workspace', 'film-output', 'composition', 'index.html')) && await isFile(join(jobDir, 'workspace', 'film-output', 'render-handoff.json'));
  const resume = { eligible: (state === 'failed' || state === 'interrupted') && sourceSaved, source: sourceSaved, plan: planSaved, composition: compositionSaved, from: compositionSaved ? 'composition check' : planSaved ? 'plan check' : 'source preparation' };
  const finding = check?.passed === false ? firstFinding(check) : null;
  const error = latest?.state === 'failed' ? latest.error ?? null : job.error || null;
  const activeEvent = latest?.state === 'start' ? latest : null;
  const render = report?.render;
  return {
    id: job.id, input: job.input, createdAt: job.createdAt, finishedAt: job.finishedAt || null, attempt: job.attempt || 1,
    state, stage: latest?.node || 'starting', stages, error, finding, resume,
    events: events.slice(-28), activity: running ? await agentActivity(jobDir, activeEvent) : null,
    activeSince: activeEvent?.at || null,
    phases: { source: completed('prepare'), story: Boolean(gate?.passed && completed('planGate')), composition: Boolean(check?.passed), render: Boolean(render) },
    filmReady: Boolean(render?.output), music: report?.music || null, musicChoice: report?.plan?.musicChoice || null, review: report?.review || null,
    render: render ? { durationSeconds: render.durationSeconds ?? 0, width: render.video?.width, height: render.video?.height, hasAudio: render.hasAudio === true, audioSource: render.audioSource || null, audioFallback: render.audioFallback || false } : null,
  };
}

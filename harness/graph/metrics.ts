import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { graphEventSchema, graphInputSchema, graphReportSchema, planGateSchema, sourceManifestSchema, type GraphEvent } from '../../shared/film.js';
import { isEntryPoint } from '../runtime/paths.js';
import { errorMessage, parseJsonLines, readJsonOrNull } from '../../shared/json.js';

const agentEntrySchema = z.looseObject({
  type: z.string().optional(),
  usage: z.looseObject({
    input_tokens: z.number().optional(),
    cached_input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  }).nullish(),
});

interface StageTiming { node: string; state: string; seconds: number | undefined }

function timing({ node, state, seconds }: GraphEvent): StageTiming {
  return { node, state, seconds };
}

const finished = (event: GraphEvent): boolean => event.state === 'complete' || event.state === 'failed';

export async function collectMetrics(jobDir: string) {
  const manifest = await readJsonOrNull(join(jobDir, 'source-manifest.json'), sourceManifestSchema);
  const gate = await readJsonOrNull(join(jobDir, 'plan-gate.json'), planGateSchema);
  const report = await readJsonOrNull(join(jobDir, 'graph-report.json'), graphReportSchema);
  const rawEvents = await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8').catch(() => '');
  const events = parseJsonLines(rawEvents, graphEventSchema);
  const lastCapture = events.findLastIndex((event) => event.node === 'capture' && event.state === 'start');
  const currentEvents = lastCapture >= 0 ? events.slice(lastCapture) : events;
  const stages = events.filter(finished).map(timing);
  const latestAttemptStages = currentEvents.filter(finished).map(timing);
  const agents: { stage: string; observableCompletedItems: number; usage: z.infer<typeof agentEntrySchema>['usage'] | null }[] = [];
  for (const name of (await readdir(jobDir)).filter((entry) => /^agent-.*\.stdout$/.test(entry)).sort()) {
    const entries = parseJsonLines(await readFile(join(jobDir, name), 'utf8'), agentEntrySchema);
    const usage = entries.findLast((event) => event.type === 'turn.completed')?.usage ?? null;
    agents.push({ stage: name.replace(/^agent-/, '').replace(/\.stdout$/, ''), observableCompletedItems: entries.filter((event) => event.type === 'item.completed').length, usage });
  }
  const tokenTotals = agents.reduce((total, agent) => {
    const usage = agent.usage || {};
    total.input += usage.input_tokens || 0;
    total.cachedInput += usage.cached_input_tokens || 0;
    total.output += usage.output_tokens || 0;
    return total;
  }, { input: 0, cachedInput: 0, output: 0 });
  const jev = (gate?.evaluated || []).reduce((total, item) => {
    total.calls++;
    total.inputTokens += item.usage?.input_tokens || 0;
    total.reportedUsd += item.usage?.cost || 0;
    return total;
  }, { calls: 0, inputTokens: 0, reportedUsd: 0 });
  const model = (await readJsonOrNull(join(jobDir, 'graph-input.json'), graphInputSchema))?.model;
  const baseRateEstimateUsd = model === 'gpt-6-sol'
    ? Math.round((((tokenTotals.input - tokenTotals.cachedInput) * 2 + tokenTotals.cachedInput * 0.2 + tokenTotals.output * 10) / 1_000_000) * 10000) / 10000
    : null;
  const metrics = {
    source: { website: manifest?.website?.url, sourceSha256: manifest?.website?.capturedSourceSha256, contextCredits: manifest?.website?.contextStyleguide?.creditsUsed, localStyleCache: manifest?.website?.contextStyleguide?.localCache, upstreamCacheStatus: manifest?.website?.contextStyleguide?.upstreamCacheStatus, repositoryCommit: manifest?.repository?.commit },
    stages, latestAttemptStages, totalRecordedNodeSeconds: Math.round(stages.reduce((sum, stage) => sum + (stage.seconds || 0), 0) * 1000) / 1000,
    agents, tokenTotals, jevRecordedFinalGate: jev, render: report?.render || null,
    model, baseRateEstimateUsd,
    pricingNote: 'Base public token-rate estimate only. This local Codex subscription run has no API invoice; compute, Context.dev credits, possible per-request surcharges, and Jev checks overwritten by later resume attempts are excluded. Stage seconds include all recorded attempts, not a continuous wall clock.',
  };
  await writeFile(join(jobDir, 'graph-metrics.json'), JSON.stringify(metrics, null, 2));
  return metrics;
}

if (isEntryPoint(import.meta.url)) {
  const jobDir = process.argv[2];
  if (!jobDir) {
    console.error('Usage: node metrics.js <job-directory>');
    process.exitCode = 2;
  } else {
    collectMetrics(jobDir).then(
      (metrics) => console.log(JSON.stringify(metrics, null, 2)),
      (error: unknown) => { console.error(`metrics: ${errorMessage(error)}`); process.exitCode = 1; },
    );
  }
}

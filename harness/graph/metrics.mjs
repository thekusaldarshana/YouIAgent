import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function optionalJson(path) { return readFile(path, 'utf8').then(JSON.parse).catch(() => null); }

export async function collectMetrics(jobDir) {
  const manifest = await optionalJson(join(jobDir, 'source-manifest.json'));
  const gate = await optionalJson(join(jobDir, 'plan-gate.json'));
  const report = await optionalJson(join(jobDir, 'graph-report.json'));
  const rawEvents = await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8').catch(() => '');
  const events = rawEvents.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const lastCapture = events.findLastIndex((event) => event.node === 'capture' && event.state === 'start');
  const currentEvents = lastCapture >= 0 ? events.slice(lastCapture) : events;
  const stages = events.filter((event) => event.state === 'complete' || event.state === 'failed').map(({ node, state, seconds }) => ({ node, state, seconds }));
  const latestAttemptStages = currentEvents.filter((event) => event.state === 'complete' || event.state === 'failed').map(({ node, state, seconds }) => ({ node, state, seconds }));
  const agents = [];
  for (const name of (await readdir(jobDir)).filter((entry) => /^agent-.*\.stdout$/.test(entry)).sort()) {
    const raw = await readFile(join(jobDir, name), 'utf8');
    const entries = raw.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
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
  const model = (await optionalJson(join(jobDir, 'graph-input.json')))?.model;
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

if (process.argv[1]?.endsWith('/metrics.mjs')) console.log(JSON.stringify(await collectMetrics(process.argv[2]), null, 2));

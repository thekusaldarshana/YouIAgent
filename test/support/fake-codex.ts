#!/usr/bin/env node
/*
 * A deterministic stand-in for `codex app-server` used by the offline integration tests. It speaks the
 * same JSON-RPC lines the real client expects and performs each graph stage by writing the files a
 * well-behaved agent would, from what it finds in the job workspace.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { isRecord, parseJson, readJson } from '../../shared/json.js';

const requestSchema = z.looseObject({ id: z.number().optional(), method: z.string(), params: z.unknown().optional() });
const turnParamsSchema = z.looseObject({ input: z.array(z.looseObject({ text: z.string().optional() })) });
const threadParamsSchema = z.looseObject({ cwd: z.string().optional() });

const out = (message: object): void => { process.stdout.write(`${JSON.stringify(message)}\n`); };
let workspace = process.cwd();
let turns = 0;

async function firstSourceLine(): Promise<string> {
  const readme = await readFile(join(workspace, 'source-repo', 'README.md'), 'utf8');
  const line = readme.split('\n').map((text) => text.replace(/^#+\s*/, '').trim()).find(Boolean);
  if (!line) throw new Error('The fixture project has no README text to quote.');
  return line;
}

async function planStage(): Promise<void> {
  const catalog = await readJson(join(workspace, 'film-audio', 'catalog.json'));
  const sourceKind = isRecord(catalog) ? catalog['sourceKind'] : undefined;
  const quote = await firstSourceLine();
  await mkdir(join(workspace, 'film-output'), { recursive: true });
  await writeFile(join(workspace, 'film-output', 'film-plan.md'), '# Fixture plan\n');
  await writeFile(join(workspace, 'film-output', 'plan-data.json'), JSON.stringify({
    durationSeconds: 16, posterAtSeconds: 15,
    musicChoice: sourceKind === 'original' ? 'original' : sourceKind === 'none' ? 'none' : 'airy',
    claims: [{ claim: quote, quote, sourcePath: 'source-repo/README.md' }],
    scenes: [{ name: 'a', start: 0, duration: 5 }, { name: 'b', start: 5, duration: 5 }, { name: 'c', start: 10, duration: 6 }],
  }));
}

const SCORE_SCRIPT = `import { fileURLToPath } from 'node:url';
import { Score } from './score-kit.mjs';
const score = new Score({ duration: 16, seed: 3 });
score.tone({ at: 0, length: 15, midi: 57, shape: 'soft-saw', gain: 0.12, release: 0.5 });
score.tone({ at: 2, length: 4, midi: 64, shape: 'bell', gain: 0.1 });
score.kick({ at: 1 });
score.noise({ at: 4, length: 0.2, gain: 0.04 });
score.delay();
await score.writeWav(fileURLToPath(new URL('./assets/music/original-score.wav', import.meta.url)));
`;

async function composeStage(): Promise<void> {
  const composition = join(workspace, 'film-output', 'composition');
  await mkdir(composition, { recursive: true });
  await writeFile(join(composition, 'index.html'), '<html><body><div class="clip"></div></body></html>');
  await writeFile(join(workspace, 'film-output', 'render-handoff.json'), JSON.stringify({ composition: 'film-output/composition', output: 'film-output/film.mp4', posterAtSeconds: 15 }));
  const selected = await readFile(join(workspace, 'film-audio', 'SELECTED.md'), 'utf8').catch(() => '');
  if (/Original score/.test(selected)) await writeFile(join(composition, 'make-score.mjs'), SCORE_SCRIPT);
}

async function reviewStage(): Promise<void> {
  await mkdir(join(workspace, 'film-output'), { recursive: true });
  await writeFile(join(workspace, 'film-output', 'visual-review.md'), '# Visual review\n\n## Inspected\n\nThe contact sheet (fixture).\n\n## Verdict\n\nAcceptable for a fixture.\n');
}

async function performStage(prompt: string): Promise<string> {
  if (/Review only the rendered film/.test(prompt)) { await reviewStage(); return 'review'; }
  if (/execute only PLANNING/.test(prompt)) { await planStage(); return 'plan'; }
  if (/execute only COMPOSITION/.test(prompt)) { await composeStage(); return 'compose'; }
  throw new Error(`fake-codex was asked for an unexpected stage: ${prompt.slice(0, 80)}`);
}

async function handle(line: string): Promise<void> {
  const request = requestSchema.parse(parseJson(line));
  const { id, method } = request;
  if (id === undefined) return; // `initialized` and other notifications need no reply.
  if (method === 'initialize') return out({ id, result: {} });
  if (method === 'account/read') return out({ id, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: false } });
  if (method === 'thread/start') {
    const params = threadParamsSchema.parse(request.params);
    if (params.cwd) workspace = params.cwd;
    return out({ id, result: { thread: { id: 'thread-1' } } });
  }
  if (method === 'turn/start') {
    const turnId = `turn-${++turns}`;
    const prompt = turnParamsSchema.parse(request.params).input.map((part) => part.text ?? '').join('\n');
    out({ id, result: { turn: { id: turnId } } });
    const stage = await performStage(prompt);
    const text = `fixture ${stage} complete`;
    out({ method: 'item/completed', params: { item: { type: 'agentMessage', text } } });
    out({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: turnId, status: 'completed', items: [{ type: 'agentMessage', text }] } } });
    return;
  }
  out({ id, error: { code: -32601, message: `fake-codex does not implement ${method}` } });
}

const lines = createInterface({ input: process.stdin });
let chain: Promise<void> = Promise.resolve();
lines.on('line', (line) => {
  chain = chain.then(() => handle(line)).catch((error: unknown) => {
    console.error(`fake-codex: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
});

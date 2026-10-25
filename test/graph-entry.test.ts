import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { z } from 'zod';
import { graphEventSchema, graphReportSchema, planGateSchema } from '../shared/film.js';
import { parseJsonLines, readJsonWith } from '../shared/json.js';
import { withTempDir } from './helpers.js';
import { createFakeToolchain, toolchainSkipReason } from './support/toolchain.js';

const execFileAsync = promisify(execFile);
/** The file the web server spawns for every film, compiled exactly as shipped. */
const runEntry = fileURLToPath(new URL('../harness/graph/run.js', import.meta.url));
const skip = await toolchainSkipReason() ?? false;

const STAGE_ORDER = ['capture', 'prepare', 'plan', 'planGate', 'audio', 'compose', 'check', 'render', 'review'];

test('the compiled graph entry point turns a source folder into a checked, rendered, reviewed film', { skip, timeout: 180_000 }, async () => {
  await withTempDir('youiagent-graph-entry-', async (directory) => {
    const toolchain = await createFakeToolchain(directory);
    const project = join(directory, 'project');
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, 'README.md'), '# Fixture Project\n\nOne typed send() call.\n');
    await writeFile(join(project, 'src', 'index.ts'), 'export const ready = true;\n');
    const jobDir = join(directory, 'job');

    const { stdout } = await execFileAsync(process.execPath, [runEntry, '-', project, 'Make a fixture film'], {
      env: { ...process.env, ...toolchain.env, FILM_JOB_DIR: jobDir, FILM_PROVIDER: 'codex', FILM_MUSIC_MODE: 'original' },
      timeout: 170_000,
    });
    const summary = z.looseObject({ jobDir: z.string(), render: z.looseObject({ hasAudio: z.boolean() }) }).parse(JSON.parse(stdout));
    assert.equal(summary.jobDir, jobDir);
    assert.equal(summary.render.hasAudio, true);

    // Stage ordering, from the graph's own event log.
    const events = parseJsonLines(await readFile(join(jobDir, 'graph-events.jsonl'), 'utf8'), graphEventSchema);
    assert.deepEqual(events.filter((event) => event.state === 'complete').map((event) => event.node), STAGE_ORDER);
    assert.equal(events.some((event) => event.state === 'failed'), false);

    // Claim gate: the exact-quote gate approved the one claim.
    const gate = await readJsonWith(join(jobDir, 'plan-gate.json'), planGateSchema);
    assert.equal(gate.passed, true);
    assert.equal(gate.evaluated.length, 1);
    assert.equal(gate.evaluated[0]?.model, 'exact-source-quote');

    // Output paths and the published artifact names.
    const output = join(jobDir, 'workspace', 'film-output');
    for (const name of ['film.mp4', 'film.jpg', 'render-report.json', 'visual-review.md', join('composition', 'index.html'), join('composition', 'make-score.mjs'), join('composition', 'score-kit.mjs'), join('composition', 'assets', 'music', 'original-score.wav'), join('review', 'contact-sheet.jpg')]) {
      assert.ok((await stat(join(output, name)).catch(() => null))?.isFile(), `${name} should exist`);
    }
    const report = await readJsonWith(join(jobDir, 'graph-report.json'), graphReportSchema);
    assert.equal(report.render?.hasAudio, true);
    assert.equal(report.render?.audioFallback, true, 'the silent fake render needs the graph to add the original score');
    assert.equal(report.review?.status, 'reported');
    assert.equal(report.music?.choice, 'original');

    // Assets resolved from the compiled tree: skills, the motion helper, GSAP, and the score kit.
    const workspace = join(jobDir, 'workspace');
    for (const name of [join('.agents', 'skills', 'film-graph', 'SKILL.md'), join('film-motion', 'mechanics.js'), join('film-runtime', 'gsap.min.js')]) {
      assert.ok((await stat(join(workspace, name)).catch(() => null))?.isFile(), `${name} should be staged`);
    }
  });
});
